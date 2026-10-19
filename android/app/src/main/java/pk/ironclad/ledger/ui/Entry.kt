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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
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
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Type
import java.time.LocalDate

/**
 * Putting something in: tap the category, type the amount, Add.
 *
 * One book for the whole company, so a voucher is a category and an amount. The
 * date is right here because an expense is often written up a day or two late;
 * everything else sits behind "More" so the common case stays three taps.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntrySheet(vm: Vm, state: LedgerState, ui: Ui, draft: Draft) {
    val transfer = draft.type == Type.TRANSFER
    val line = draft.line

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
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
                                line = if (state.category(d.line.category)?.kind != type) d.line.copy(category = "") else d.line,
                            )
                        }
                    }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.Bottom,
        ) {
            if (draft.calc.pending.isNotBlank()) {
                Text(draft.calc.pending, fontSize = 15.sp, color = Ink.muted,
                    modifier = Modifier.padding(end = 8.dp, bottom = 6.dp))
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
            val all = state.categoriesOf(draft.type).let { list ->
                if (line.category.isNotBlank() && list.none { it.name == line.category }) {
                    listOfNotNull(state.category(line.category)) + list
                } else list
            }
            // Forty-odd categories is a lot to hunt through with a thumb. Type
            // three letters and only what matches is left: "wate" finds Water.
            val query = ui.catQuery.trim()
            val categories = if (query.isBlank()) all else {
                val hit = all.filter { it.name.contains(query, ignoreCase = true) }
                val near = all.filter {
                    !hit.contains(it) && it.group.contains(query, ignoreCase = true)
                }
                hit + near
            }
            OutlinedTextField(
                value = ui.catQuery,
                onValueChange = { vm.searchCategories(it) },
                placeholder = { Text("Search categories", fontSize = 13.sp, color = Ink.muted) },
                leadingIcon = { Text("🔍", fontSize = 14.sp) },
                trailingIcon = {
                    if (ui.catQuery.isNotEmpty()) {
                        Box(
                            Modifier.size(36.dp).clickable { vm.searchCategories("") },
                            Alignment.Center,
                        ) { Text("✕", fontSize = 14.sp, color = Ink.muted) }
                    }
                },
                singleLine = true,
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                shape = RoundedCornerShape(12.dp),
            )
            if (query.isNotBlank() && categories.isEmpty()) {
                Text(
                    "Nothing matches \"" + query + "\". Tap ＋ New to add it.",
                    fontSize = 12.sp, color = Ink.muted,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                modifier = Modifier.fillMaxWidth()
                    .heightIn(max = if (query.isBlank()) 168.dp else 228.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(categories, key = { it.id }) { category ->
                    Column(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (line.category == category.name) Ink.card2 else Ink.card)
                            .border(
                                BorderStroke(
                                    1.dp,
                                    when {
                                        line.category == category.name -> Ink.brand
                                        query.isNotBlank() &&
                                            category.name.contains(query, ignoreCase = true) -> Ink.good
                                        else -> Ink.line
                                    },
                                ),
                                RoundedCornerShape(12.dp),
                            )
                            .clickable { vm.pickCategory(category.name) }
                            .padding(vertical = 8.dp, horizontal = 2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        val matches = query.isNotBlank() &&
                            category.name.contains(query, ignoreCase = true)
                        Text(category.icon, fontSize = 18.sp)
                        Text(
                            category.name, fontSize = 9.sp, maxLines = 1,
                            color = if (matches) Ink.text else Ink.muted,
                            fontWeight = if (matches) FontWeight.Bold else FontWeight.Normal,
                            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                        )
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
            Box(Modifier.size(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                state.liveAccounts.forEach { account ->
                    Chip(account.icon + " " + account.name, draft.account == account.name) {
                        vm.editDraft { it.copy(account = account.name) }
                    }
                }
            }
        }

        Box(Modifier.size(10.dp))
        Chip("📅  " + dateLabel(draft.date)) { vm.set { it.copy(datePickerOpen = true) } }

        if (draft.bill.isNotBlank()) {
            val context = LocalContext.current
            val file = pk.ironclad.ledger.data.ShareIn.fileFor(context, draft.bill)
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Ink.good.copy(alpha = 0.14f))
                    .border(1.dp, Ink.good.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (pk.ironclad.ledger.data.ShareIn.isImage(draft.bill)) "🧾" else "📄",
                    fontSize = 20.sp,
                )
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Text("Bill attached", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ink.text)
                    Text(
                        (if (file.exists()) (file.length() / 1024).toString() + " KB · " else "") +
                            draft.bill.substringAfterLast('.').uppercase(),
                        fontSize = 11.sp, color = Ink.muted,
                    )
                }
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp)).clickable { vm.openBill(draft.bill) }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                ) { Text("View", fontSize = 12.sp, color = Ink.brand, fontWeight = FontWeight.SemiBold) }
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp)).clickable { vm.dropBill() }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                ) { Text("Remove", fontSize = 12.sp, color = Ink.bad) }
            }
        }

        // A proper row you can hit with a thumb, not a line of text to aim at.
        val filled = listOf(draft.vendor, draft.reference, line.description, draft.note).count { it.isNotBlank() }
        Row(
            Modifier.fillMaxWidth().padding(vertical = 10.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Ink.card)
                .border(1.dp, if (draft.more) Ink.brand else Ink.line, RoundedCornerShape(12.dp))
                .clickable { vm.editDraft { it.copy(more = !it.more) } }
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("📝", fontSize = 15.sp, modifier = Modifier.padding(end = 10.dp))
            Column(Modifier.weight(1f)) {
                Text("Paid to, bill no., note", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Ink.text)
                if (filled > 0 && !draft.more) {
                    Text(
                        listOf(draft.vendor, draft.reference, line.description, draft.note)
                            .filter { it.isNotBlank() }.joinToString(" · "),
                        fontSize = 12.sp, color = Ink.muted, maxLines = 1,
                    )
                } else {
                    Text(if (draft.more) "Tap to fold away" else "Optional", fontSize = 12.sp, color = Ink.muted)
                }
            }
            Text(if (draft.more) "▴" else "▾", fontSize = 16.sp, color = Ink.brand)
        }

        if (draft.more) {
            if (!transfer) {
                Field("Paid to", draft.vendor) { value -> vm.editDraft { it.copy(vendor = value) } }
                Field("Bill / receipt no.", draft.reference) { value -> vm.editDraft { it.copy(reference = value) } }
                Field("What it was for", line.description) { value ->
                    vm.editDraft { d -> d.withLine { it.copy(description = value) } }
                }
            }
            Field("Note", draft.note) { value -> vm.editDraft { it.copy(note = value) } }
        }

        Keypad(vm)

        val saveLabel = when {
            draft.calc.op != null -> "="
            draft.editing -> "Save changes"
            transfer -> "Move the money"
            draft.type == Type.INCOME -> "Add payment"
            else -> "Add expense"
        }
        Button(
            onClick = { vm.save() },
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
            shape = RoundedCornerShape(12.dp),
        ) { Text(saveLabel, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }

        if (draft.editing) {
            val who = state.entries.firstOrNull { it.id == draft.id }?.enteredBy.orEmpty()
            if (who.isNotBlank()) {
                Text(
                    "Entered by " + who,
                    fontSize = 11.sp, color = Ink.muted,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        if (draft.editing) {
            GhostButton(
                if (draft.armed) "Tap again to void it" else "Void this entry",
                colour = Ink.bad,
            ) { vm.voidEntry() }
        }
        GhostButton(if (draft.started) "Discard this entry" else "Close") { vm.tryClose() }
        Box(Modifier.size(18.dp))
    }
}

/**
 * Which days the calendar lets you tap. The sheet turns down anything past
 * tomorrow, so the app does not offer it: better a day that cannot be chosen
 * than a voucher turned down at sync, after the person has gone home. Back the
 * other way there is no limit — last month's bill is a real thing to write up.
 */
fun dayOffered(utcMillis: Long, today: LocalDate = LocalDate.now()): Boolean =
    utcMillis <= today.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()

/** "Today", "Yesterday", or a plain date. */
fun dateLabel(iso: String): String = runCatching {
    val date = LocalDate.parse(iso)
    val today = LocalDate.now()
    when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> Period.dayLabel(date, today).substringAfter(", ")
    }
}.getOrDefault(iso)

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
