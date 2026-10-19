package pk.ironclad.ledger.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.util.UUID

/**
 * A bill arriving from somewhere else.
 *
 * WhatsApp, Gmail, the camera roll — anything that can share hands us a file we
 * may read for a moment only, so the first thing we do is copy it into our own
 * storage. After that it is ours and the sender can forget about it.
 */
object ShareIn {

    /** What came in: a file we now own, some words, or both. */
    data class Shared(val file: String = "", val text: String = "") {
        val empty: Boolean get() = file.isBlank() && text.isBlank()
    }

    private val KNOWN = mapOf(
        "image/jpeg" to "jpg", "image/jpg" to "jpg", "image/png" to "png",
        "image/webp" to "webp", "image/heic" to "heic", "image/heif" to "heif",
        "application/pdf" to "pdf",
    )

    fun folder(context: Context): File = File(context.filesDir, "bills").apply { mkdirs() }

    fun fileFor(context: Context, name: String): File = File(folder(context), name)

    /**
     * Takes what an app shared and keeps it. Returns the name of our own copy,
     * and any words that came with it.
     */
    fun take(context: Context, intent: Intent?): Shared {
        if (intent == null) return Shared()
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
            return Shared()
        }
        val words = listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
            intent.getStringExtra(Intent.EXTRA_TEXT),
        ).filter { it.isNotBlank() }.distinct().joinToString(" — ").take(400)

        val uri: Uri? = when (intent.action) {
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.firstOrNull()
        }
        val kept = uri?.let { keep(context, it) }.orEmpty()
        return Shared(kept, words)
    }

    /** Copies what is behind a Uri into our own folder, and says what we called it. */
    fun keep(context: Context, uri: Uri): String = runCatching {
        val type = context.contentResolver.getType(uri).orEmpty()
        val name = nameOf(context, uri)
        val suffix = KNOWN[type.lowercase()]
            ?: name.substringAfterLast('.', "").lowercase().takeIf { it.length in 1..5 }
            ?: "bin"
        val ours = "bill-" + UUID.randomUUID().toString().take(8) + "." + suffix
        val into = fileFor(context, ours)
        context.contentResolver.openInputStream(uri)?.use { source ->
            into.outputStream().use { source.copyTo(it) }
        } ?: return ""
        if (into.length() == 0L) {
            into.delete()
            return ""
        }
        ours
    }.getOrDefault("")

    /**
     * What the sender calls it. Most apps answer the question; some hand over a
     * plain file address and answer nothing, and then the address itself is the
     * only clue to what kind of file this is — without it a PDF arrives as
     * ".bin" and no viewer will open it.
     */
    private fun nameOf(context: Context, uri: Uri): String {
        val asked = runCatching {
            context.contentResolver.query(uri, null, null, null, null)?.use { row ->
                val column = row.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0 && row.moveToFirst()) row.getString(column).orEmpty() else ""
            }.orEmpty()
        }.getOrDefault("")
        if (asked.isNotBlank()) return asked
        return uri.lastPathSegment.orEmpty().substringAfterLast('/')
    }

    fun isImage(name: String): Boolean =
        name.substringAfterLast('.', "").lowercase() in setOf("jpg", "jpeg", "png", "webp", "heic", "heif")

    /**
     * An amount buried in shared words: "Rs 4,500 paid to Shell" or a bank's
     * "Debit of PKR 1,250.00". The biggest number wins, since a reference or a
     * date is usually smaller than the money.
     */
    fun amountIn(text: String): Long {
        val found = Regex("""\d[\d,]*(?:\.\d{1,2})?""").findAll(text)
            .mapNotNull { match ->
                val raw = match.value.replace(",", "")
                if (raw.length > 12) null else raw.toDoubleOrNull()
            }
            .filter { it >= 1.0 }
            .toList()
        val most = found.maxOrNull() ?: return 0
        return Math.round(most * 100)
    }
}
