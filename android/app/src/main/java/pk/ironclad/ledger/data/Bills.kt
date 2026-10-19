package pk.ironclad.ledger.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Getting a bill to the shared book.
 *
 * A phone photograph is several megabytes and a receipt needs none of that, so
 * a picture is shrunk to something a person can still read before it goes up.
 * A PDF is sent as it is. Nothing is sent twice.
 */
object Bills {

    /** Enough to read a receipt by, and small enough to post in one go. */
    private const val LONGEST = 1600
    private const val QUALITY = 72

    /** As much as we will hand over in one sync, so a round trip stays quick. */
    const val ROOM_PER_SYNC = 1_500_000

    data class Outgoing(
        val id: String,
        val name: String,
        val mime: String,
        val data: String,
        val bytes: Int,
    )

    fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "heic", "heif" -> "image/heic"
        "pdf" -> "application/pdf"
        else -> "application/octet-stream"
    }

    /** The bytes to send: a shrunk picture where we can manage it, else the file. */
    fun bodyOf(context: Context, fileName: String): ByteArray? {
        val file = ShareIn.fileFor(context, fileName)
        if (!file.exists() || file.length() == 0L) return null
        if (!ShareIn.isImage(fileName)) return file.readBytes()
        return runCatching { shrink(file.readBytes()) }.getOrNull() ?: file.readBytes()
    }

    private fun shrink(raw: ByteArray): ByteArray {
        val sizing = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, sizing)
        val widest = max(sizing.outWidth, sizing.outHeight)
        if (widest <= 0) return raw

        var step = 1
        while (widest / (step * 2) >= LONGEST) step *= 2
        val decoded = BitmapFactory.decodeByteArray(
            raw, 0, raw.size,
            BitmapFactory.Options().apply { inSampleSize = step },
        ) ?: return raw

        val out = ByteArrayOutputStream()
        decoded.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
        decoded.recycle()
        val smaller = out.toByteArray()
        // if shrinking did not help, send what we were given
        return if (smaller.isNotEmpty() && smaller.size < raw.size) smaller else raw
    }

    /**
     * The bills worth sending this round: ones kept against a voucher the book
     * already has, that it does not know the whereabouts of yet. Oldest first,
     * and only as many as fit.
     */
    fun waiting(
        context: Context,
        bills: Map<String, String>,
        known: Set<String>,
        unsent: Set<String>,
        order: List<String>,
    ): List<Outgoing> {
        val out = mutableListOf<Outgoing>()
        var room = ROOM_PER_SYNC
        order.asSequence()
            .filter { id -> bills[id] != null && id !in known && id !in unsent }
            .forEach { id ->
                if (room <= 0) return@forEach
                val name = bills.getValue(id)
                val body = bodyOf(context, name) ?: return@forEach
                if (body.size > room && out.isNotEmpty()) return@forEach
                out += Outgoing(
                    id = id,
                    name = name,
                    mime = mimeOf(name),
                    data = Base64.encodeToString(body, Base64.NO_WRAP),
                    bytes = body.size,
                )
                room -= body.size
            }
        return out
    }
}
