package pk.ironclad.ledger.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
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
)

@Serializable
data class SyncPull(
    val ok: Boolean = false,
    val message: String = "",
    val now: Long = 0,
    val accepted: List<String> = emptyList(),
    val rejected: Map<String, String> = emptyMap(),
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

    suspend fun runOnce(context: Context): String = withContext(Dispatchers.IO) {
        val repo = Repo.get(context)
        val prefs = repo.state.value.prefs
        if (!prefs.canSync) return@withContext "No server set yet — everything is on this phone."

        val mine = repo.dirtyEntries()
        val body = json.encodeToString(
            SyncPush.serializer(),
            SyncPush(code = prefs.code, device = prefs.me, since = prefs.lastSync, entries = mine),
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

        val pushed = answer.accepted.size
        val pulled = answer.entries.size
        when {
            answer.rejected.isNotEmpty() ->
                "Sent $pushed, took back $pulled, ${answer.rejected.size} the server would not take."
            pushed == 0 && pulled == 0 -> "Already up to date."
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
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val message = Sync.runOnce(applicationContext)
        return if (message.startsWith("Could not reach")) Result.retry() else Result.success()
    }
}
