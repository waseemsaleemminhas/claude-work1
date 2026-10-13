package pk.ironclad.ledger

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A sideloaded app has nowhere to send a crash, so it keeps the last one itself
 * and shows it on the next start. That is the difference between "it crashed" and
 * knowing what to fix.
 */
object Crash {

    private const val FILE = "last-crash.txt"

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { write(app, thread.name, error) }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Something that went wrong but did not take the app down. */
    fun note(context: Context, where: String, error: Throwable) {
        runCatching { write(context.applicationContext, where, error, fatal = false) }
    }

    private fun write(context: Context, where: String, error: Throwable, fatal: Boolean = true) {
        val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
        val when0 = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.UK).format(Date())
        val text = buildString {
            appendLine(if (fatal) "The app stopped" else "Something went wrong")
            appendLine(when0)
            appendLine("Ledger " + versionName(context) + " · Android " + Build.VERSION.RELEASE +
                " (API " + Build.VERSION.SDK_INT + ") · " + Build.MANUFACTURER + " " + Build.MODEL)
            appendLine("in: " + where)
            appendLine()
            append(trace)
        }
        File(context.filesDir, FILE).writeText(text.take(16000))
    }

    fun last(context: Context): String? {
        val file = File(context.applicationContext.filesDir, FILE)
        return if (file.exists()) runCatching { file.readText() }.getOrNull() else null
    }

    fun clear(context: Context) {
        runCatching { File(context.applicationContext.filesDir, FILE).delete() }
    }

    private fun versionName(context: Context): String = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    }.getOrDefault("?")
}
