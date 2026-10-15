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

/**
 * Spend on one category in the month [day] falls in. A budget is a monthly
 * figure, so the bar always talks about a whole month however the screen is
 * being browsed — a week in October is measured against October's budget.
 */
fun spentInMonth(state: LedgerState, category: String, day: LocalDate): Long {
    val from = day.withDayOfMonth(1).toString()
    val to = day.withDayOfMonth(day.lengthOfMonth()).toString()
    return state.entries
        .filter { it.status != Status.VOID && it.type == Type.EXPENSE }
        .filter { it.date >= from && it.date <= to }
        .flatMap { it.lines }
        .filter { it.category == category }
        .sumOf { it.amountMinor }
}

/** The categories carrying a budget, worst off first. */
fun budgets(state: LedgerState, day: LocalDate): List<Budgeted> =
    state.categories
        .filter { it.budgetMinor > 0 && !it.archived && it.mergedInto.isBlank() }
        .map { Budgeted(it, spentInMonth(state, it.name, day)) }
        .sortedWith(compareByDescending<Budgeted> { it.share }.thenBy { it.category.sort })

data class Budgeted(val category: pk.ironclad.ledger.data.Category, val spentMinor: Long) {
    val budgetMinor: Long get() = category.budgetMinor
    val leftMinor: Long get() = budgetMinor - spentMinor
    val share: Float get() = if (budgetMinor <= 0) 0f else spentMinor.toFloat() / budgetMinor.toFloat()
    val over: Boolean get() = spentMinor > budgetMinor
}
