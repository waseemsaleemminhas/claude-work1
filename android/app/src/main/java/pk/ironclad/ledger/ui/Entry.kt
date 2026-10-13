package pk.ironclad.ledger.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pk.ironclad.ledger.Draft
import pk.ironclad.ledger.Ui
import pk.ironclad.ledger.Vm
import pk.ironclad.ledger.data.Allocator
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Method
import pk.ironclad.ledger.data.Type

data class AllocLabel(val title: String, val subtitle: String, val needed: Boolean)

/**
 * What the campaign chip says. It describes what the line is SET to, not what has
 * been worked out, so a category that shares itself out reads as settled before
 * any amount has been typed.
 */
fun allocLabel(line: Line, state: LedgerState): AllocLabel {
    val chosen = when (line.allocationMethod) {
        Method.RULE -> state.rules.any { it.name == line.allocationRule }
        Method.SPLIT -> line.allocations.isNotEmpty()
        else -> state.campaigns.any { it.name == line.campaign }
    }
    if (!chosen) return AllocLabel("Needs a campaign", "Tap to say which campaign this is for", true)

    val settled = Allocator.settle(line, state.campaigns, state.rules).allocations
    return when {
        settled.isEmpty() && line.allocationMethod == Method.RULE -> {
            val rule = state.rules.first { it.name == line.allocationRule }
            val over = Allocator.ruleWeights(rule, state.campaigns).count { it.weight > 0 }
            AllocLabel(line.allocationRule, "shared over $over " + if (over == 1) "campaign" else "campaigns", false)
        }
        settled.isEmpty() -> AllocLabel(line.campaign.ifBlank { "Custom split" }, "the whole amount", false)
        settled.size == 1 -> {
            val campaign = state.campaign(settled.first().campaign)
            AllocLabel((campaign?.icon?.plus(" ") ?: "") + settled.first().campaign, "the whole amount", false)
        }
        else -> AllocLabel(
            (if (line.allocationMethod == Method.RULE) line.allocationRule else "Custom split") +
                " · ${settled.size} campaigns",
            settled.joinToString(" · ") { it.campaign + " " + (it.bp / 100) + "%" },
            false,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntrySheet(vm: Vm, state: LedgerState, ui: Ui, draft: Draft) {
    val transfer = draft.type == Type.TRANSFER
    val line = draft.line
    val scroll = rememberScrollState()

    Column(
        Modifier.fillMaxWidth().verticalScroll(scroll).padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        if (!draft.editing) {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(Type.EXPENSE to "Money out", Type.INCOME to "Money in", Type.TRANSFER to "Move").forEach { (type, label) ->
                    Tab(label, draft.type == type, Modifier.weight(1f)) {
                        vm.editDraft { d ->
                            d.copy(
                                type = type,
                                toAccount = if (type == Type.TRANSFER)
                                    state.liveAccounts.firstOrNull { it.name != d.account }?.name.orEmpty() else "",
                                lines = d.lines.map { l ->
                                    if (state.category(l.category)?.kind != type) l.copy(category = "", allocations = emptyList()) else l
                                },
                            )
                        }
                    }
                }
            }
        }

        if (draft.lines.size > 1) {
            LazyRow(
                Modifier.fillMaxWidth().padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(draft.lines.size) { i ->
                    val amount = if (i == draft.index) draft.calc.amountMinor else draft.lines[i].amountMinor
                    Chip(
                        text = (draft.lines[i].category.ifBlank { "line ${i + 1}" }) + "  " + state.money(amount),
                        selected = i == draft.index,
                    ) { vm.goToLine(i) }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.Bottom,
        ) {
            if (draft.calc.pending.isNotBlank()) {
                Text(draft.calc.pending, fontSize = 15.sp, color = Ink.muted, modifier = Modifier.padding(end = 8.dp, bottom = 6.dp))
            }
            Text(
                state.prefs.currency + " " + draft.calc.shown,
                fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Ink.text,
            )
        }

        if (transfer) {
            Text("From", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                state.liveAccounts.forEach { account ->
                    Chip(account.icon + " " + account.name, draft.account == account.name) {
                        vm.editDraft { d ->
                            d.copy(
                                account = account.name,
                                toAccount = if (d.toAccount == account.name)
                                    state.liveAccounts.firstOrNull { it.name != account.name }?.name.orEmpty() else d.toAccount,
                            )
                        }
                    }
                }
            }
            Text("To", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                state.liveAccounts.forEach { account ->
                    Chip(account.icon + " " + account.name, draft.toAccount == account.name) {
                        vm.editDraft { d ->
                            d.copy(
                                toAccount = account.name,
                                account = if (d.account == account.name)
                                    state.liveAccounts.firstOrNull { it.name != account.name }?.name.orEmpty() else d.account,
                            )
                        }
                    }
                }
            }
        } else {
            val categories = state.categoriesOf(draft.type).let { list ->
                if (line.category.isNotBlank() && list.none { it.name == line.category }) {
                    listOfNotNull(state.category(line.category)) + list
                } else list
            }
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                modifier = Modifier.fillMaxWidth().heightIn(max = 168.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(categories, key = { it.id }) { category ->
                    Column(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (line.category == category.name) Ink.card2 else Ink.card)
                            .border(
                                BorderStroke(1.dp, if (line.category == category.name) Ink.brand else Ink.line),
                                RoundedCornerShape(12.dp),
                            )
                            .clickable { vm.pickCategory(category.name) }
                            .padding(vertical = 8.dp, horizontal = 2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(category.icon, fontSize = 18.sp)
                        Text(category.name, fontSize = 9.sp, color = Ink.muted, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    }
                }
                item {
                    Column(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Ink.card)
                            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(12.dp))
                            .clickable { vm.set { it.copy(newCategoryOpen = true) } }
                            .padding(vertical = 8.dp, horizontal = 2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("＋", fontSize = 18.sp, color = Ink.muted)
                        Text("New", fontSize = 9.sp, color = Ink.muted)
                    }
                }
            }

            val label = allocLabel(line, state)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (label.needed) Ink.warn.copy(alpha = 0.08f) else Ink.card)
                    .border(
                        BorderStroke(1.dp, if (label.needed) Ink.warn.copy(alpha = 0.55f) else Ink.line),
                        RoundedCornerShape(12.dp),
                    )
                    .clickable { vm.set { it.copy(allocOpen = true) } }
                    .padding(horizontal = 11.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(if (label.needed) "⚠️" else "🎯", fontSize = 17.sp)
                Column(Modifier.weight(1f)) {
                    Text(label.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(label.subtitle, fontSize = 11.sp, color = Ink.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("change ›", fontSize = 12.sp, color = Ink.muted)
            }

            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                state.liveAccounts.forEach { account ->
                    Chip(account.icon + " " + account.name, draft.account == account.name) {
                        vm.editDraft { it.copy(account = account.name) }
                    }
                }
            }
        }

        Text(
            if (draft.more) "Fewer details ▴" else "Date, bill no., who it was paid to ▾",
            fontSize = 13.sp, color = Ink.brand,
            modifier = Modifier.padding(vertical = 10.dp).clickable { vm.editDraft { it.copy(more = !it.more) } },
        )

        if (draft.more) {
            Field("Date (yyyy-mm-dd)", draft.date) { value -> vm.editDraft { it.copy(date = value) } }
            if (!transfer) {
                Field("Paid to", draft.vendor) { value -> vm.editDraft { it.copy(vendor = value) } }
                Field("Bill / receipt no.", draft.reference) { value -> vm.editDraft { it.copy(reference = value) } }
                Field("What this line was for", line.description) { value ->
                    vm.editDraft { d -> d.withLine { it.copy(description = value) } }
                }
            }
            Field("Note on the voucher", draft.note) { value -> vm.editDraft { it.copy(note = value) } }
        }

        Keypad(vm)

        val saveLabel = when {
            draft.calc.op != null -> "="
            draft.editing -> "Save changes"
            transfer -> "Move the money"
            draft.lines.size > 1 -> "Add expense · " + state.money(draft.totalMinor(state))
            draft.type == Type.INCOME -> "Add money in"
            else -> "Add expense"
        }
        Button(
            onClick = { vm.save() },
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
            shape = RoundedCornerShape(12.dp),
        ) { Text(saveLabel, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }

        if (!transfer) {
            GhostButton("＋ Another line on this bill") { vm.addLine() }
        }
        if (draft.editing) {
            GhostButton(
                if (draft.armed) "Tap again to void it" else "Void this entry",
                colour = Ink.bad,
            ) { vm.voidEntry() }
        }
        if (draft.lines.size > 1) {
            GhostButton("Remove this line") { vm.dropLine() }
        }
        GhostButton("Close") { vm.closeEntry() }
        Box(Modifier.size(18.dp))
    }
}

@Composable
private fun Tab(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) Ink.card2 else Ink.card)
            .border(BorderStroke(1.dp, if (selected) Ink.brand else Ink.line), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 13.sp, color = Ink.text) }
}

@Composable
fun GhostButton(label: String, colour: androidx.compose.ui.graphics.Color = Ink.text, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Ink.card2)
            .border(BorderStroke(1.dp, if (colour == Ink.text) Ink.line else colour), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 15.sp, color = colour, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun Field(label: String, value: String, keyboard: KeyboardType = KeyboardType.Text, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, fontSize = 12.sp) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        shape = RoundedCornerShape(10.dp),
    )
}

@Composable
private fun Keypad(vm: Vm) {
    val rows = listOf(
        listOf("7", "8", "9", "÷"),
        listOf("4", "5", "6", "×"),
        listOf("1", "2", "3", "−"),
        listOf(".", "0", "⌫", "+"),
    )
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                row.forEach { key ->
                    val operator = key in listOf("÷", "×", "−", "+", "⌫")
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (operator) Ink.card2 else Ink.card)
                            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(12.dp))
                            .clickable {
                                when (key) {
                                    "⌫" -> vm.backspace()
                                    "÷" -> vm.operate('/')
                                    "×" -> vm.operate('*')
                                    "−" -> vm.operate('-')
                                    "+" -> vm.operate('+')
                                    else -> vm.key(key)
                                }
                            }
                            .padding(vertical = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(key, fontSize = if (operator) 17.sp else 19.sp,
                            color = if (operator) Ink.muted else Ink.text)
                    }
                }
            }
        }
    }
}

/** Picking who the money was spent for. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AllocationSheet(vm: Vm, state: LedgerState, draft: Draft) {
    val line = draft.line.copy(amountMinor = draft.calc.amountMinor)
    var tab by remember {
        mutableStateOf(
            when {
                line.allocationMethod == Method.RULE -> "rule"
                line.allocations.size > 1 -> "split"
                else -> "one"
            },
        )
    }
    val shares = remember {
        mutableStateMapOf<String, String>().apply {
            line.allocations.forEach { put(it.campaign, (it.bp / 100).toString()) }
        }
    }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp)) {
        Text("Which campaign is this for?", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
        Text(
            (line.category.ifBlank { "this line" }) + " · " + state.money(line.amountMinor),
            fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 10.dp),
        )
        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Tab("One campaign", tab == "one", Modifier.weight(1f)) { tab = "one" }
            Tab("Share it out", tab == "rule", Modifier.weight(1f)) { tab = "rule" }
            Tab("Custom split", tab == "split", Modifier.weight(1f)) { tab = "split" }
        }

        when (tab) {
            "one" -> {
                Text("Everything on this line goes to one campaign.", fontSize = 12.sp, color = Ink.muted,
                    modifier = Modifier.padding(bottom = 8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.liveCampaigns.forEach { campaign ->
                        Chip(
                            campaign.icon + " " + campaign.name,
                            line.allocationMethod == Method.DIRECT && line.campaign == campaign.name,
                        ) { vm.setAllocationToCampaign(campaign.name) }
                    }
                }
            }

            "rule" -> {
                Text(
                    "Shared costs are split over the campaigns that are running. The numbers are worked " +
                        "out now and kept with the entry, so last month's report never changes later.",
                    fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp),
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.rules.forEach { rule ->
                        Chip(rule.name, line.allocationMethod == Method.RULE && line.allocationRule == rule.name) {
                            vm.setAllocationToRule(rule.name)
                        }
                    }
                }
                val preview = Allocator.settle(line, state.campaigns, state.rules).allocations
                if (preview.isNotEmpty()) {
                    Column(Modifier.padding(top = 10.dp)) {
                        preview.forEach {
                            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                                Text(it.campaign, fontSize = 13.sp, color = Ink.text, modifier = Modifier.weight(1f))
                                Text((it.bp / 100.0).toString() + "%", fontSize = 12.sp, color = Ink.muted,
                                    modifier = Modifier.padding(end = 10.dp))
                                Text(state.money(it.amountMinor), fontSize = 13.sp, color = Ink.text)
                            }
                        }
                    }
                }
            }

            else -> {
                Text(
                    "Put a share against each campaign. They do not have to add up to 100 — whatever you " +
                        "type is used as the ratio.",
                    fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp),
                )
                val weights = shares.mapNotNull { (name, text) ->
                    val value = text.toDoubleOrNull() ?: 0.0
                    if (value > 0) Allocator.Weight(name, value) else null
                }
                val preview = Allocator.splitExact(line.amountMinor, weights).associateBy { it.campaign }
                state.liveCampaigns.forEach { campaign ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(campaign.icon + " " + campaign.name, fontSize = 13.sp, color = Ink.text,
                            modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        OutlinedTextField(
                            value = shares[campaign.name].orEmpty(),
                            onValueChange = { shares[campaign.name] = it },
                            modifier = Modifier.size(width = 92.dp, height = 56.dp),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            shape = RoundedCornerShape(10.dp),
                        )
                        Text(
                            preview[campaign.name]?.let { state.money(it.amountMinor) } ?: "—",
                            fontSize = 12.sp, color = Ink.muted, textAlign = TextAlign.End,
                            modifier = Modifier.padding(start = 8.dp).size(width = 86.dp, height = 20.dp),
                        )
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { GhostButton("Cancel") { vm.set { it.copy(allocOpen = false) } } }
            Box(Modifier.weight(1f)) {
                Button(
                    onClick = {
                        if (tab == "split") {
                            vm.setCustomSplit(
                                shares.mapNotNull { (name, text) ->
                                    val value = (text.toDoubleOrNull() ?: 0.0)
                                    if (value > 0) name to Math.round(value * 100).toInt() else null
                                }.toMap(),
                            )
                        }
                        vm.set { it.copy(allocOpen = false) }
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
                    shape = RoundedCornerShape(12.dp),
                ) { Text("Use this", fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
        Box(Modifier.size(18.dp))
    }
}
