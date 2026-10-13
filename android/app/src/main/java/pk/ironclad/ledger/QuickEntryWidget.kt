package pk.ironclad.ledger

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import pk.ironclad.ledger.data.LedgerDb
import pk.ironclad.ledger.data.Money
import java.time.LocalDate

/**
 * Quick entry from the home screen.
 *
 * Shows what has gone out today and gives the two buttons that matter: one drops
 * straight into a new expense with the keypad up, the other into a payment in.
 * Tapping the figure opens the book.
 */
class QuickEntryWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            draw(context, manager, manager.getAppWidgetIds(ComponentName(context, QuickEntryWidget::class.java)))
        }
    }

    /**
     * Reading the day's spending touches the database, so the widget is drawn once
     * with what we already know and again when the figure comes back.
     */
    private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
        if (ids.isEmpty()) return
        // goAsync only exists while a broadcast is being delivered; the launcher
        // sometimes asks for a redraw by other means.
        val pending = runCatching { goAsync() }.getOrNull()
        CoroutineScope(Dispatchers.IO).launch {
            val spent = runCatching {
                LedgerDb.get(context).dao().spentOn(LocalDate.now().toString()) ?: 0L
            }.getOrDefault(0L)
            val currency = runCatching {
                LedgerDb.get(context).dao().meta("currency") ?: "Rs"
            }.getOrDefault("Rs")
            val views = views(context, Money.format(spent, currency, 0))
            runCatching { ids.forEach { manager.updateAppWidget(it, views) } }
            pending?.finish()
        }
    }

    private fun views(context: Context, amount: String): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_quick_entry).apply {
            setTextViewText(R.id.widget_amount, amount)
            setOnClickPendingIntent(R.id.widget_open, open(context, null, 1))
            setOnClickPendingIntent(R.id.widget_expense, open(context, "Expense", 2))
            setOnClickPendingIntent(R.id.widget_income, open(context, "Income", 3))
        }

    private fun open(context: Context, kind: String?, request: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = QUICK_ENTRY
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (kind != null) putExtra(EXTRA_KIND, kind)
        }
        return PendingIntent.getActivity(
            context, request, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val QUICK_ENTRY = "pk.ironclad.ledger.QUICK_ENTRY"
        const val EXTRA_KIND = "kind"
        private const val REFRESH = "pk.ironclad.ledger.WIDGET_REFRESH"

        /** Called after anything that changes today's figure. Harmless with no widget on screen. */
        fun refresh(context: Context) {
            runCatching {
                context.sendBroadcast(
                    Intent(context, QuickEntryWidget::class.java).setAction(REFRESH),
                )
            }
        }
    }
}
