package pk.ironclad.ledger.ui

import pk.ironclad.ledger.Ui
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type
import java.time.LocalDate

/** What the screen is looking at: the period, and maybe one campaign. */
fun visibleEntries(state: LedgerState, ui: Ui): List<Entry> {
    val (from, to) = Period.range(ui.unit, ui.anchor)
    val start = from.toString()
    val end = to.toString()
    return state.entries.filter { entry ->
        entry.status != Status.VOID &&
            entry.date >= start && entry.date <= end &&
            (ui.campaignFilter.isBlank() || entry.campaigns.contains(ui.campaignFilter))
    }
}

/** With a campaign chosen, only that campaign's slice of an entry counts. */
fun weightOf(entry: Entry, campaign: String): Long =
    if (campaign.isBlank()) entry.totalMinor
    else entry.lines.flatMap { it.allocations }.filter { it.campaign == campaign }.sumOf { it.amountMinor }

data class Totals(val inMinor: Long = 0, val outMinor: Long = 0) {
    val leftMinor: Long get() = inMinor - outMinor
}

fun totalsOf(entries: List<Entry>, campaign: String): Totals {
    var income = 0L
    var spend = 0L
    entries.forEach {
        val amount = weightOf(it, campaign)
        when (it.type) {
            Type.INCOME -> income += amount
            Type.EXPENSE -> spend += amount
        }
    }
    return Totals(income, spend)
}

fun byCategory(entries: List<Entry>, type: String, campaign: String): Map<String, Long> {
    val out = mutableMapOf<String, Long>()
    entries.filter { it.type == type }.forEach { entry ->
        entry.lines.forEach { line ->
            val amount = if (campaign.isBlank()) line.amountMinor
            else line.allocations.filter { it.campaign == campaign }.sumOf { it.amountMinor }
            if (amount > 0) out[line.category] = (out[line.category] ?: 0L) + amount
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
