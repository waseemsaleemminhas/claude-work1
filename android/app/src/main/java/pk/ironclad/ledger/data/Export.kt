package pk.ironclad.ledger.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The book as a spreadsheet.
 *
 * One row per line of every voucher, which is the shape an accountant can
 * actually work with: filter a column, sum another. It is built from what is
 * on the phone, so it works with no signal and needs nothing from the server.
 */
object Export {

    val HEAD = listOf(
        "Date", "Voucher", "Type", "Status", "Line", "Category", "Group", "Description",
        "Qty", "Unit price", "Amount", "Account", "To account", "Vendor", "Reference",
        "Note", "Entered by", "Entered at",
    )

    fun csv(entries: List<Entry>): String {
        val out = StringBuilder()
        out.append(HEAD.joinToString(",")).append("\r\n")
        entries.sortedWith(compareBy({ it.date }, { it.at })).forEach { entry ->
            val lines = if (entry.lines.isEmpty()) listOf<Line?>(null) else entry.lines
            lines.forEach { line ->
                out.append(
                    listOf(
                        entry.date,
                        entry.id,
                        entry.type,
                        entry.status,
                        line?.no?.toString() ?: "1",
                        line?.category.orEmpty(),
                        line?.group.orEmpty(),
                        line?.description.orEmpty(),
                        line?.qty?.let { trim(it) }.orEmpty(),
                        line?.unitPriceMinor?.let { rupees(it) }.orEmpty(),
                        rupees(line?.amountMinor ?: entry.totalMinor),
                        entry.account,
                        entry.toAccount,
                        entry.vendor,
                        entry.reference,
                        entry.note,
                        entry.enteredBy,
                        stamp(entry.at),
                    ).joinToString(",") { cell(it) },
                ).append("\r\n")
            }
        }
        return out.toString()
    }

    /** Plain rupees, so a spreadsheet adds them up instead of reading text. */
    private fun rupees(minor: Long): String {
        val negative = minor < 0
        val absolute = if (negative) -minor else minor
        val body = (absolute / 100).toString() + "." + (absolute % 100).toString().padStart(2, '0')
        return if (negative) "-$body" else body
    }

    private fun trim(qty: Double): String =
        if (qty == qty.toLong().toDouble()) qty.toLong().toString() else qty.toString()

    private fun stamp(at: Long): String =
        if (at <= 0) "" else SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.UK).format(Date(at))

    /** A comma or a quote in a note must not break the column after it. */
    private fun cell(text: String): String =
        if (text.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) {
            "\"" + text.replace("\"", "\"\"") + "\""
        } else {
            text
        }

    fun fileName(today: String = SimpleDateFormat("yyyy-MM-dd", Locale.UK).format(Date())): String =
        "ironclad-ledger-$today.csv"

    /** Written where other apps are allowed to read it, and nowhere else. */
    fun write(context: Context, entries: List<Entry>): File {
        val folder = File(context.cacheDir, "export").apply { mkdirs() }
        folder.listFiles()?.forEach { if (it.isFile) it.delete() }
        val file = File(folder, fileName())
        // The mark at the front is what makes Excel read the names correctly.
        file.writeText("﻿" + csv(entries))
        return file
    }

    fun shareIntent(context: Context, file: File): Intent {
        val uri: Uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Ironclad Tech Ledger — " + file.name)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(send, "Send the spreadsheet")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
