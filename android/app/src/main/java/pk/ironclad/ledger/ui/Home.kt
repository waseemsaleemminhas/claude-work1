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
    val totals = totalsOf(entries, ui.campaignFilter)
    val sums = byCategory(entries, ui.mode, ui.campaignFilter)

    val shown: List<Category> = buildList {
        addAll(state.categoriesOf(ui.mode))
        sums.keys.forEach { name ->
            if (none { it.name == name }) state.category(name)?.let { add(it) }
        }
    }.sortedWith(compareByDescending<Category> { sums[it.name] ?: 0L }.thenBy { it.sort })

    val modeTotal = if (ui.mode == Type.INCOME) totals.inMinor else totals.outMinor
    val slices = shown.filter { (sums[it.name] ?: 0L) > 0L }
        .map { Slice(sums.getValue(it.name), hexColour(it.colour)) }

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
                if (state.drafts.isNotEmpty()) {
                    DraftBanner(state.drafts.size, state.money(state.draftMinor)) { vm.go(Screen.DRAFTS) }
                }
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
                    Ring(slices, modeTotal, Modifier.fillMaxWidth(0.72f)) {
                        Text(
                            if (ui.campaignFilter.isNotBlank()) "spent on ${ui.campaignFilter}" else "Money we hold",
                            fontSize = 11.sp, color = Ink.muted, textAlign = TextAlign.Center,
                        )
                        Text(
                            state.money(if (ui.campaignFilter.isNotBlank()) totals.outMinor else state.totalHeldMinor),
                            fontSize = 24.sp, fontWeight = FontWeight.Bold,
                            color = if (ui.campaignFilter.isBlank() && state.totalHeldMinor < 0) Ink.bad else Ink.text,
                        )
                        Text(
                            if (modeTotal > 0) {
                                (if (ui.mode == Type.INCOME) "in: " else "out: ") + state.money(modeTotal)
                            } else "nothing yet",
                            fontSize = 11.sp, color = Ink.muted,
                        )
                    }
                }
                Box(Modifier.padding(bottom = 6.dp))
            }
        }

        items(shown, key = { it.id }) { category ->
            CategoryTile(category, sums[category.name] ?: 0L, state) {
                vm.startEntry(category.kind, category.name)
            }
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
private fun CategoryTile(category: Category, amount: Long, state: LedgerState, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(category.icon, fontSize = 20.sp)
        Text(category.name, fontSize = 10.sp, color = Ink.muted, maxLines = 1,
            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(
            if (amount > 0) state.money(amount) else "—",
            fontSize = 11.sp, color = if (amount > 0) Ink.text else Ink.muted,
            fontWeight = if (amount > 0) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
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
        Chip(
            text = (ui.campaignFilter.ifBlank { "🎯 All campaigns" }) + " ▾",
            modifier = Modifier.weight(1f, fill = false),
        ) { vm.set { it.copy(pickerOpen = "campaign") } }
        Box(Modifier.weight(1f))
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
fun DraftBanner(count: Int, amount: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Ink.warn.copy(alpha = 0.14f))
            .border(BorderStroke(1.dp, Ink.warn.copy(alpha = 0.4f)), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                if (count == 1) "1 entry needs a campaign" else "$count entries need a campaign",
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ink.warn,
            )
            Text("$amount is not on any campaign yet", fontSize = 12.sp, color = Ink.muted)
        }
        Text("›", color = Ink.warn, fontSize = 18.sp)
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
