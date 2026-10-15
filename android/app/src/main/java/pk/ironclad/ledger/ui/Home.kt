package pk.ironclad.ledger.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pk.ironclad.ledger.Screen
import pk.ironclad.ledger.Ui
import pk.ironclad.ledger.Vm
import pk.ironclad.ledger.data.Category
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Type

@Composable
fun HomeScreen(vm: Vm, state: LedgerState, ui: Ui) {
    val entries = visibleEntries(state, ui)
    val totals = totalsOf(entries)
    val sums = byCategory(entries, ui.mode)

    val shown: List<Category> = buildList {
        addAll(state.categoriesOf(ui.mode))
        sums.keys.forEach { name ->
            if (none { it.name == name }) state.category(name)?.let { add(it) }
        }
    }.sortedWith(compareByDescending<Category> { sums[it.name] ?: 0L }.thenBy { it.sort })

    val modeTotal = if (ui.mode == Type.INCOME) totals.inMinor else totals.outMinor
    val slices = shown.filter { (sums[it.name] ?: 0L) > 0L }
        .map { Slice(sums.getValue(it.name), hexColour(it.colour), it.name, it.icon) }
    val picked = slices.firstOrNull { it.name == ui.picked }

    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                TopBar(vm, state, ui)
                PeriodBar(vm, ui)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Pill("Money in", state.money(totals.inMinor), Ink.good, ui.mode == Type.INCOME, Modifier.weight(1f)) {
                        vm.set { it.copy(mode = Type.INCOME) }
                    }
                    Pill("Money out", state.money(totals.outMinor), Ink.bad, ui.mode == Type.EXPENSE, Modifier.weight(1f)) {
                        vm.set { it.copy(mode = Type.EXPENSE) }
                    }
                }
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Ring(
                        slices, modeTotal, Modifier.fillMaxWidth(0.72f),
                        picked = ui.picked, onPick = { vm.pickSlice(it) },
                    ) {
                        if (picked != null) {
                            // what the tapped slice is, in the hole in the middle
                            Text(picked.icon, fontSize = 20.sp)
                            Text(
                                picked.name, fontSize = 12.sp, color = Ink.muted,
                                textAlign = TextAlign.Center, maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.fillMaxWidth(0.62f),
                            )
                            Text(
                                state.money(picked.value),
                                fontSize = 21.sp, fontWeight = FontWeight.Bold, color = Ink.text,
                            )
                            Text(
                                (picked.value * 100.0 / modeTotal.coerceAtLeast(1)).let {
                                    if (it < 1) "<1%" else it.toInt().toString() + "% of " +
                                        (if (ui.mode == Type.INCOME) "money in" else "money out")
                                },
                                fontSize = 10.sp, color = Ink.muted, textAlign = TextAlign.Center,
                            )
                        } else {
                            Text(
                                "Money we hold",
                                fontSize = 11.sp, color = Ink.muted, textAlign = TextAlign.Center,
                            )
                            Text(
                                state.money(state.totalHeldMinor),
                                fontSize = 24.sp, fontWeight = FontWeight.Bold,
                                color = if (state.totalHeldMinor < 0) Ink.bad else Ink.text,
                            )
                            Text(
                                if (modeTotal > 0) {
                                    (if (ui.mode == Type.INCOME) "out: " else "out: ")
                                        .let { _ -> if (ui.mode == Type.INCOME) "in: " else "out: " } +
                                        state.money(modeTotal)
                                } else "tap a slice to see it",
                                fontSize = 10.sp, color = Ink.muted,
                            )
                        }
                    }
                }
                RingLabels(
                    slices, modeTotal, { state.money(it) }, ui.picked, { vm.pickSlice(it) },
                )
                BudgetsCard(vm, state, ui)
                Box(Modifier.padding(bottom = 6.dp))
            }
        }

        items(shown, key = { it.id }) { category ->
            CategoryTile(
                category, sums[category.name] ?: 0L, state,
                highlight = ui.picked.isNotBlank() && ui.picked == category.name,
                budget = category.budgetMinor,
                monthSpent = if (category.budgetMinor > 0)
                    spentInMonth(state, category.name, ui.anchor) else 0L,
            ) { vm.startEntry(category.kind, category.name) }
        }

        item {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(Ink.card)
                    .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(14.dp))
                    .clickable { vm.set { it.copy(newCategoryOpen = true) } }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("＋", fontSize = 20.sp, color = Ink.muted)
                    Text("New", fontSize = 10.sp, color = Ink.muted)
                }
            }
        }

        item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.size(90.dp)) }
    }
}

@Composable
private fun CategoryTile(
    category: Category,
    amount: Long,
    state: LedgerState,
    highlight: Boolean,
    budget: Long = 0,
    monthSpent: Long = 0,
    onClick: () -> Unit,
) {
    // Every category already carries a colour in the book. Using it makes the
    // grid something you recognise by sight instead of reading forty labels.
    val colour = hexColour(category.colour)
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (highlight) colour.copy(alpha = 0.18f) else Ink.card)
            .border(
                BorderStroke(1.dp, if (highlight || amount > 0) colour.copy(alpha = 0.7f) else Ink.line),
                RoundedCornerShape(14.dp),
            )
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(colour.copy(alpha = 0.22f)),
            contentAlignment = Alignment.Center,
        ) { Text(category.icon, fontSize = 18.sp) }
        Text(
            category.name, fontSize = 10.sp, maxLines = 1,
            color = if (amount > 0) Ink.text else Ink.muted,
            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            if (amount > 0) state.money(amount) else "—",
            fontSize = 11.sp, color = if (amount > 0) colour else Ink.muted,
            fontWeight = if (amount > 0) FontWeight.Bold else FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        if (budget > 0) {
            val share = monthSpent.toFloat() / budget.toFloat()
            BudgetBar(share, Modifier.padding(top = 4.dp, start = 2.dp, end = 2.dp), thickness = 4)
        }
    }
}

/**
 * The budgets from the Categories tab of the sheet, against what has gone this
 * month. Worst off first, because that is the one you need to know about. The
 * card is not here at all until a budget is set, so nobody who does not use
 * them has to look at it.
 */
@Composable
private fun BudgetsCard(vm: Vm, state: LedgerState, ui: Ui) {
    val month = ui.anchor
    val rows = budgets(state, month)
    if (rows.isEmpty()) return

    val budgeted = rows.sumOf { it.budgetMinor }
    val spent = rows.sumOf { it.spentMinor }
    val over = rows.count { it.over }

    Column(
        Modifier.fillMaxWidth().padding(top = 10.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, if (over > 0) Ink.bad.copy(alpha = 0.5f) else Ink.line),
                RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "BUDGETS · " + Period.monthName(month).uppercase(),
                fontSize = 10.sp, color = Ink.muted, modifier = Modifier.weight(1f),
            )
            Text(
                if (over > 0) over.toString() + (if (over == 1) " over" else " over") else "all within",
                fontSize = 10.sp, fontWeight = FontWeight.Bold,
                color = if (over > 0) Ink.bad else Ink.good,
            )
        }
        Text(
            state.money(spent) + " of " + state.money(budgeted),
            fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ink.text,
            modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
        )
        rows.take(6).forEach { row ->
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { vm.startEntry(row.category.kind, row.category.name) }
                    .padding(vertical = 5.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(row.category.icon + "  " + row.category.name, fontSize = 12.sp,
                        color = Ink.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f))
                    Text(
                        if (row.over) state.money(-row.leftMinor) + " over"
                        else state.money(row.leftMinor) + " left",
                        fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        color = budgetColour(row.share),
                    )
                }
                BudgetBar(row.share, Modifier.padding(top = 4.dp))
                Text(
                    state.money(row.spentMinor) + " of " + state.money(row.budgetMinor),
                    fontSize = 10.sp, color = Ink.muted, modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        if (rows.size > 6) {
            Text("and " + (rows.size - 6) + " more with budgets set",
                fontSize = 10.sp, color = Ink.muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
fun TopBar(vm: Vm, state: LedgerState, ui: Ui) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).clickable { vm.go(Screen.SETTINGS) },
            contentAlignment = Alignment.Center,
        ) { Text("☰", fontSize = 18.sp, color = Ink.text) }
        Text(
            "Ironclad Tech Ledger", fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
            color = Ink.text, modifier = Modifier.weight(1f),
        )
        Chip(text = unitName(ui.unit) + " ▾") { vm.set { it.copy(pickerOpen = "period") } }
    }
}

fun unitName(unit: String): String = when (unit) {
    "day" -> "Day"; "week" -> "Week"; "year" -> "Year"; "all" -> "All time"; else -> "Month"
}

@Composable
fun PeriodBar(vm: Vm, ui: Ui) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (ui.unit != "all") {
            Box(Modifier.size(34.dp).clip(CircleShape).clickable { vm.step(-1) }, Alignment.Center) {
                Text("‹", fontSize = 20.sp, color = Ink.text)
            }
        }
        Text(
            Period.label(ui.unit, ui.anchor, java.time.LocalDate.now()),
            fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        if (ui.unit != "all") {
            Box(Modifier.size(34.dp).clip(CircleShape).clickable { vm.step(1) }, Alignment.Center) {
                Text("›", fontSize = 20.sp, color = Ink.text)
            }
        }
    }
}

@Composable
fun Pill(label: String, value: String, colour: androidx.compose.ui.graphics.Color,
         selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, if (selected) colour else Ink.line), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(label.uppercase(), fontSize = 10.sp, color = Ink.muted)
        Text(value, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = colour)
    }
}
