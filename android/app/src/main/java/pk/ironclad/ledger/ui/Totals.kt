package pk.ironclad.ledger.ui

import pk.ironclad.ledger.Ui
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type
import java.time.LocalDate

/** What the screen is looking at: the period. */
fun visibleEntries(state: LedgerState, ui: Ui): List<Entry> {
    val (from, to) = Period.range(ui.unit, ui.anchor)
    val start = from.toString()
    val end = to.toString()
    return state.entries.filter {
        it.status != Status.VOID && it.date >= start && it.date <= end
    }
}

data class Totals(val inMinor: Long = 0, val outMinor: Long = 0) {
    val leftMinor: Long get() = inMinor - outMinor
}

fun totalsOf(entries: List<Entry>): Totals {
    var income = 0L
    var spend = 0L
    entries.forEach {
        when (it.type) {
            Type.INCOME -> income += it.totalMinor
            Type.EXPENSE -> spend += it.totalMinor
        }
    }
    return Totals(income, spend)
}

fun byCategory(entries: List<Entry>, type: String): Map<String, Long> {
    val out = mutableMapOf<String, Long>()
    entries.filter { it.type == type }.forEach { entry ->
        entry.lines.forEach { line ->
            if (line.amountMinor > 0) {
                out[line.category] = (out[line.category] ?: 0L) + line.amountMinor
            }
        }
    }
    return out
}

/** This month's spend on one category, for the budget bars. */
fun spentThisMonth(state: LedgerState, category: String, today: LocalDate): Long {
    val from = today.withDayOfMonth(1).toString()
    val to = today.withDayOfMonth(today.lengthOfMonth()).toString()
    return state.entries
        .filter { it.status != Status.VOID && it.date >= from && it.date <= to }
        .flatMap { it.lines }
        .filter { it.category == category }
        .sumOf { it.amountMinor }
}
