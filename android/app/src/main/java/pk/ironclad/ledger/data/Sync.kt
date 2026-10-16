package pk.ironclad.ledger.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

@Serializable
data class SyncPush(
    val op: String = "sync",
    val code: String,
    val device: String,
    val since: Long,
    val entries: List<Entry>,
    val categories: List<Category> = emptyList(),
)

@Serializable
data class SyncPull(
    val ok: Boolean = false,
    val message: String = "",
    val now: Long = 0,
    val accepted: List<String> = emptyList(),
    val rejected: Map<String, String> = emptyMap(),
    val addedCategories: List<String> = emptyList(),
    val sheetUrl: String = "",
    val entries: List<Entry> = emptyList(),
    val categories: List<Category> = emptyList(),
    val accounts: List<Account> = emptyList(),
)

/**
 * Catching up with the book the rest of the team shares.
 *
 * The phone is never waiting on this. Entries are written locally and marked
 * dirty; this pushes whatever is dirty and takes back whatever changed elsewhere.
 * With no server set, or no signal, the app simply carries on being a ledger.
 */
object Sync {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** The last sync's refusals, by entry id, so the screens can point at them. */
    @Volatile
    var lastRejected: Map<String, String> = emptyMap()
        private set

    /**
     * The reasons the book gave, each said once however many entries hit it:
     * "2 entries turned down — Line 1: pick a category."
     */
    fun rejectionNote(rejected: Map<String, String>): String {
        if (rejected.isEmpty()) return ""
        val reasons = rejected.values.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        val head = rejected.size.toString() +
            (if (rejected.size == 1) " entry" else " entries") + " turned down"
        return if (reasons.isEmpty()) head + ", with no reason given." else head + " — " + reasons.joinToString("  ")
    }

    suspend fun runOnce(context: Context): String = withContext(Dispatchers.IO) {
        val repo = Repo.get(context)
        val prefs = repo.state.value.prefs
        if (!prefs.canSync) return@withContext "No server set yet — everything is on this phone."

        val mine = repo.dirtyEntries()
        val invented = repo.unsentCategories()
        val body = json.encodeToString(
            SyncPush.serializer(),
            SyncPush(
                code = prefs.code, device = prefs.me, since = prefs.lastSync,
                entries = mine, categories = invented,
            ),
        )

        val reply = try {
            post(prefs.endpoint, body)
        } catch (e: Exception) {
            return@withContext "Could not reach the server. Your entries are safe here and will go up later."
        }

        val answer = runCatching { json.decodeFromString(SyncPull.serializer(), reply) }
            .getOrElse { return@withContext "The server sent something unexpected." }

        if (!answer.ok) return@withContext answer.message.ifBlank { "The server turned that down." }

        runCatching {
            repo.acceptFromServer(answer.entries, answer.categories, answer.accounts)
        }.onFailure { return@withContext "Could not file what came back: " + (it.message ?: "unknown") }
        if (answer.accepted.isNotEmpty()) repo.markSynced(answer.accepted)
        repo.setPref("lastSync", answer.now.toString())
        if (answer.sheetUrl.isNotBlank()) repo.setPref("sheetUrl", answer.sheetUrl)
        pk.ironclad.ledger.QuickEntryWidget.refresh(context)

        // What the book refused, and why, in its own words. Counting them and
        // keeping the reason to ourselves leaves somebody staring at a number.
        // A voided entry the book never had is not a problem to keep raising:
        // we asked for it gone, it was never there, and that is the end we
        // wanted. Settle it here so the phone stops asking every sync. (The
        // book says yes to these itself once the script is re-deployed; this
        // clears the ones already stuck.)
        val settled = answer.rejected.filter { (id, why) ->
            why.contains("No such entry", ignoreCase = true) &&
                mine.firstOrNull { it.id == id }?.status == Status.VOID
        }.keys.toList()
        if (settled.isNotEmpty()) repo.markSynced(settled)

        val stillWrong = answer.rejected - settled.toSet()
        lastRejected = stillWrong
        repo.setPref("lastRejected", rejectionNote(stillWrong))

        val pushed = answer.accepted.size + settled.size
        val pulled = answer.entries.size
        when {
            stillWrong.isNotEmpty() ->
                "Sent $pushed, took back $pulled. " + rejectionNote(stillWrong)
            pushed == 0 && pulled == 0 && answer.addedCategories.isEmpty() -> "Already up to date."
            answer.addedCategories.isNotEmpty() ->
                "Sent $pushed, took back $pulled, and ${answer.addedCategories.size} new " +
                    (if (answer.addedCategories.size == 1) "category." else "categories.")
            else -> "Sent $pushed, took back $pulled."
        }
    }

    /**
     * Apps Script answers a POST with a redirect to where the real answer lives,
     * and Java will not follow that by itself, so we do.
     */
    private fun post(endpoint: String, body: String): String {
        var url = URL(endpoint)
        var method = "POST"
        var payload: String? = body
        repeat(4) {
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 20000
                readTimeout = 40000
                instanceFollowRedirects = false
                if (method == "POST") {
                    doOutput = true
                    setRequestProperty("Content-Type", "text/plain;charset=utf-8")
                }
            }
            payload?.let { text ->
                connection.outputStream.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (code in 300..399) {
                val next = connection.getHeaderField("Location")
                    ?: throw IllegalStateException("redirect with nowhere to go")
                connection.disconnect()
                url = URL(next)
                method = "GET"
                payload = null
                return@repeat
            }
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            connection.disconnect()
            if (code !in 200..299) throw IllegalStateException("server said $code")
            return text
        }
        throw IllegalStateException("too many redirects")
    }

    private const val WORK = "ledger-sync"
    private const val ROUNDS = "ledger-sync-rounds"

    /** Ask for a sync when there is a network. Harmless to call often. */
    fun nudge(context: Context) {
        // Never let catching up with the others get in the way of recording a cost.
        runCatching {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
        }
    }

    /**
     * Catch up on a quiet schedule, so each of us sees the other's entries
     * without anybody remembering to tap anything. Half an hour is often
     * enough for a day's costs and gentle on a phone's battery; Android may
     * hold it back a little when the phone is idle, which is fine.
     */
    fun schedule(context: Context) {
        runCatching {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(ROUNDS, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val message = Sync.runOnce(applicationContext)
        return if (message.startsWith("Could not reach")) Result.retry() else Result.success()
    }
}
