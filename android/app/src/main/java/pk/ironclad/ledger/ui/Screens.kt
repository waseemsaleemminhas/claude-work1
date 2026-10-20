package pk.ironclad.ledger.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.Brush
import pk.ironclad.ledger.data.Account
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pk.ironclad.ledger.R
import pk.ironclad.ledger.Screen
import pk.ironclad.ledger.Ui
import pk.ironclad.ledger.Vm
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type
import java.time.LocalDate

@Composable
fun ScreenHeader(title: String, vm: Vm, trailing: @Composable () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).clickable { vm.go(Screen.HOME) },
            Alignment.Center,
        ) {
            Text("‹", fontSize = 20.sp, color = Ink.text)
        }
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink.text, modifier = Modifier.weight(1f))
        trailing()
    }
}

/** Every voucher, newest first. */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun RecordsScreen(vm: Vm, state: LedgerState, ui: Ui) {
    val everything = visibleEntries(state, ui).sortedWith(
        compareByDescending<Entry> { it.date }.thenByDescending { it.at },
    )
    val people = everything.map { it.enteredBy.trim() }.filter { it.isNotBlank() }.distinct().sorted()
    val entries = if (ui.who.isBlank()) everything else everything.filter { it.enteredBy.trim() == ui.who }
    val totals = totalsOf(entries)
    val today = LocalDate.now()
    // What each account held after each voucher, over the whole book
    val balances = runningBalances(state)

    Box(Modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("Records", vm)
                PeriodBar(vm, ui)
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    InlineAction("＋  Money out", Ink.bad, Modifier.weight(1f)) {
                        vm.startEntry(Type.EXPENSE)
                    }
                    InlineAction("＋  Money in", Ink.good, Modifier.weight(1f)) {
                        vm.startEntry(Type.INCOME)
                    }
                    InlineAction("Export", Ink.brand) { vm.exportSpreadsheet() }
                }

                if (people.size > 1) {
                    // Who spent it, and how much of it was theirs.
                    FlowRow(
                        Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Chip("Everyone", ui.who.isBlank()) { vm.showWho("") }
                        people.forEach { person ->
                            val theirs = everything.filter { it.enteredBy.trim() == person }
                            val out = totalsOf(theirs).outMinor
                            Chip(
                                person + "  " + state.money(out),
                                ui.who == person,
                            ) { vm.showWho(person) }
                        }
                    }
                }
            }
        }
        if (entries.isEmpty()) {
            item {
                Empty(
                    if (ui.who.isNotBlank()) ui.who + " has nothing in this period."
                    else "Nothing in this period yet.\nTap PKR OUT or PKR IN to put something in.",
                )
            }
        }
        entries.groupBy { it.date }.forEach { (date, dayEntries) ->
            item {
                val net = dayEntries.sumOf {
                    when (it.type) {
                        Type.INCOME -> it.totalMinor
                        Type.EXPENSE -> -it.totalMinor
                        else -> 0L
                    }
                }
                SectionLabel(
                    runCatching { Period.dayLabel(LocalDate.parse(date), today) }.getOrDefault(date),
                    if (net != 0L) (if (net > 0) "+" else "") + state.money(net) else "",
                )
            }
            items(dayEntries.size) { i ->
                val entry = dayEntries[i]
                EntryRow(vm, state, ui, entry, balances[entry.id])
            }
        }
        // room for the footer, so the last voucher is never hidden behind it
        item { Box(Modifier.size(124.dp)) }
    }

    // The two numbers that matter, to scale, wherever you have scrolled to.
    Column(
        Modifier.align(Alignment.BottomCenter).padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        val waiting = entries.count { it.id in state.unsent }
        Row(
            Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 4.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                (if (ui.who.isBlank()) "Everyone" else ui.who) + " · " +
                    Period.label(ui.unit, ui.anchor, today) + " · " + entries.size +
                    (if (entries.size == 1) " voucher" else " vouchers"),
                fontSize = 10.sp, color = Ink.muted, modifier = Modifier.weight(1f),
            )
            if (waiting > 0) {
                Text(
                    waiting.toString() + " waiting to go up",
                    fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Ink.warn,
                )
            }
        }
        InOutBar(totals.inMinor, totals.outMinor, { state.money(it) })
    }
    }
}

@Composable
fun EntryRow(vm: Vm, state: LedgerState, ui: Ui, entry: Entry, balanceAfter: Long? = null) {
    val refused = ui.refused[entry.id]
    val waiting = entry.id in state.unsent
    val first = entry.lines.firstOrNull()
    val category = first?.let { state.category(it.category) }
    val transfer = entry.type == Type.TRANSFER
    val bill = state.bills[entry.id].orEmpty().ifBlank { state.billUrls[entry.id].orEmpty() }
    val title = (if (transfer) "Moved money" else first?.category.orEmpty().ifBlank { "—" }) +
        (if (bill.isNotBlank()) "  📎" else "")
    // What was left in that account afterwards, next to the account it belongs
    // to — a balance on its own says nothing about whose money it is.
    val where = entry.account + (balanceAfter?.let { " ▸ " + state.money(it) } ?: "")
    val subtitle = if (transfer) "${entry.account} → ${entry.toAccount}"
    else listOf(entry.vendor, where, first?.description.orEmpty())
        .filter { it.isNotBlank() }.joinToString(" · ")
    ListRow(
        icon = if (transfer) "🔁" else category?.icon ?: "•",
        colour = if (transfer) Ink.muted else hexColour(category?.colour ?: "#90A4AE"),
        title = title,
        subtitle = subtitle,
        amount = state.signed(entry.totalMinor, entry.type),
        amountColour = when (entry.type) {
            Type.INCOME -> Ink.good
            Type.EXPENSE -> Ink.bad
            else -> Ink.muted
        },
        // Whose entry this is. With two people keeping one book, this is the
        // difference between a number and an account of what happened.
        // The name stays whatever else is true of the entry: who wrote it is
        // the thing being read every day, and everything is "waiting" for a
        // while after it is written.
        note = when {
            refused != null -> entry.enteredBy.ifBlank { "someone" } + " · not accepted"
            waiting -> entry.enteredBy.ifBlank { "someone" } + " · waiting"
            else -> entry.enteredBy
        },
        warn = refused != null,
    ) { vm.openEntry(entry) }
    if (refused != null) {
        Text(
            "⚠  " + refused,
            fontSize = 11.sp, color = Ink.warn,
            modifier = Modifier.padding(start = 14.dp, bottom = 8.dp, end = 14.dp),
        )
    }
}

/** One account: whose it is, what is in it, and what you can do with it. */
@Composable
private fun AccountCard(vm: Vm, state: LedgerState, account: Account, stranded: Boolean) {
    val colour = hexColour(account.colour)
    Column(
        Modifier.fillMaxWidth().padding(bottom = 10.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Brush.verticalGradient(listOf(colour.copy(alpha = 0.16f), Ink.card)))
            .border(
                BorderStroke(1.dp, if (stranded) Ink.warn else colour.copy(alpha = 0.3f)),
                RoundedCornerShape(18.dp),
            )
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(colour.copy(alpha = 0.26f)),
                contentAlignment = Alignment.Center,
            ) { Text(account.icon, fontSize = 19.sp) }
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(
                    account.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    account.kind + if (account.heldBy.isNotBlank()) " · held by " + account.heldBy else "",
                    fontSize = 11.sp, color = Ink.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    state.money(account.balanceMinor), fontSize = 17.sp, fontWeight = FontWeight.Bold,
                    color = when {
                        account.balanceMinor < 0 -> Ink.bad
                        stranded -> Ink.warn
                        else -> Ink.text
                    },
                )
                Text("in hand", fontSize = 10.sp, color = Ink.muted)
            }
        }
        if (stranded) {
            Text(
                "Hidden on the sheet but still holding money. Move it out and it will go.",
                fontSize = 11.sp, color = Ink.warn, modifier = Modifier.padding(top = 8.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            InlineAction("Move money", Ink.brand, Modifier.weight(1f)) { vm.startEntry(Type.TRANSFER) }
            InlineAction("Spend from here", Ink.bad, Modifier.weight(1f)) {
                vm.startEntry(Type.EXPENSE)
                vm.editDraft { it.copy(account = account.name) }
            }
        }
    }
}

/** Money we hold, including what people are carrying. */
@Composable
fun AccountsScreen(vm: Vm, state: LedgerState) {
    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("Money we hold", vm)
                HeroCard(
                    label = "Everything together",
                    value = state.money(state.totalHeldMinor),
                    valueColour = if (state.totalHeldMinor < 0) Ink.bad else Ink.text,
                    accent = if (state.totalHeldMinor < 0) Ink.bad else Ink.good,
                    footnote = state.liveAccounts.size.toString() + " accounts · tap one to move money",
                    modifier = Modifier.padding(bottom = 12.dp),
                ) {
                    InlineAction("Move money", Ink.brand) { vm.startEntry(Type.TRANSFER) }
                }
            }
        }
        // An account hidden on the sheet is gone from here, unless it still
        // holds money — then it stays, marked, because money nobody is looking
        // at is how a book goes wrong.
        val shown = state.accounts.filter { !it.archived || it.balanceMinor != 0L }
        items(shown.size) { i ->
            val account = shown[i]
            val stranded = account.archived && account.balanceMinor != 0L
            AccountCard(vm, state, account, stranded)
            // Between one person's card and the next, where the cash goes.
            if (i == 0 && shown.size > 1) {
                // in the gap between the two of them, which is what it crosses
                handoverPair(state)?.let { (mine, theirs) ->
                    Box(
                        Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        HandoverPill(theirs.heldBy.ifBlank { theirs.name }) {
                            vm.handCashOver(mine.name, theirs.name)
                        }
                    }
                }
            }
        }
        item {
            Column {
                Text(
                    "An account is a place money sits — a bank, a wallet, or the cash somebody is " +
                        "carrying. Add or hide them on the Accounts tab of the sheet; a hidden one " +
                        "disappears from here once its balance is nil.",
                    fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(vertical = 10.dp),
                )
                Box(Modifier.size(90.dp))
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(vm: Vm, state: LedgerState) {
    var endpoint by remember(state.prefs.endpoint) { mutableStateOf(state.prefs.endpoint) }
    var code by remember(state.prefs.code) { mutableStateOf(state.prefs.code) }
    var name by remember(state.prefs.me) { mutableStateOf(state.prefs.me) }

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
        ScreenHeader("Settings", vm)

        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            Column {
                Text("What the keypad fills in for you", fontSize = 12.sp, color = Ink.muted,
                    modifier = Modifier.padding(bottom = 8.dp))
                Field("My name (goes on every entry)", name) { name = it; vm.setPref("me", it) }
                Text("My account", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.liveAccounts.forEach { account ->
                        Chip(account.name, state.prefs.myAccount == account.name) {
                            vm.setPref("myAccount", account.name)
                        }
                    }
                }
            }
        }

        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            Column {
                Text("The shared book", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
                Text(
                    "Leave this empty and the app is yours alone, on this phone. Put the web app link in " +
                        "and entries go up and come down whenever there is a signal.",
                    fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp),
                )
                Field("Web app link", endpoint) { endpoint = it; vm.setPref("endpoint", it.trim()) }
                Field("My access code", code) { code = it; vm.setPref("code", it.trim().uppercase()) }
                Button(
                    onClick = { vm.syncNow() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
                    shape = RoundedCornerShape(12.dp),
                ) { Text(if (state.prefs.lastSync == 0L) "Sync now" else "Sync now", fontWeight = FontWeight.SemiBold) }
                Text(
                    if (state.prefs.lastSync == 0L) "Never synced yet." else "Last synced with the sheet.",
                    fontSize = 11.sp, color = Ink.muted, modifier = Modifier.padding(top = 6.dp),
                )
                if (state.prefs.lastRejected.isNotBlank()) {
                    Spacer(Modifier.size(8.dp))
                    Column(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Ink.warn.copy(alpha = 0.14f))
                            .padding(10.dp),
                    ) {
                        Text(
                            "The last sync left something behind",
                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ink.warn,
                        )
                        Text(
                            state.prefs.lastRejected,
                            fontSize = 12.sp, color = Ink.text, modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            "Those entries are still on this phone, marked in Records. Fix what the " +
                                "book objected to and they will go up on the next sync.",
                            fontSize = 11.sp, color = Ink.muted, modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                if (state.prefs.sheetUrl.isNotBlank()) {
                    Spacer(Modifier.size(8.dp))
                    OutlinedButton(
                        onClick = { vm.openSpreadsheet() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) { Text("Open the Google Sheet") }
                }
            }
        }

        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            Column {
                Text("Export", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
                Text(
                    "A spreadsheet of every voucher on this phone, one row per line, ready for Excel " +
                        "or Google Sheets. Works with no signal.",
                    fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 8.dp),
                )
                Button(
                    onClick = { vm.exportSpreadsheet() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
                    shape = RoundedCornerShape(12.dp),
                ) { Text("Export spreadsheet", fontWeight = FontWeight.SemiBold) }
            }
        }

        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            Column {
                Text("${state.entries.size} vouchers on this phone", fontSize = 13.sp, color = Ink.text)
                Text("${state.categories.size} categories", fontSize = 12.sp, color = Ink.muted)
                Text(
                    "Ironclad Tech · www.getironcladtech.com",
                    fontSize = 11.sp, color = Ink.muted, modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
        Box(Modifier.size(90.dp))
    }
}

/** First run: just a name, so entries can be signed. */
@Composable
fun OnboardScreen(vm: Vm) {
    var name by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(24.dp))
        Image(
            painter = painterResource(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.size(64.dp),
        )
        Text("Ironclad Tech Ledger", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink.text)
        Text(
            "The company book, on your phone. It works with no signal — entries go up on their own " +
                "when there is one.",
            fontSize = 14.sp, color = Ink.muted,
        )
        Field("Your name", name, KeyboardType.Text) { name = it }
        Button(
            onClick = {
                if (name.isBlank()) vm.toast("Put your name in.") else {
                    vm.setPref("me", name.trim())
                    vm.go(Screen.HOME)
                }
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
            shape = RoundedCornerShape(12.dp),
        ) { Text("Start", fontWeight = FontWeight.SemiBold) }
        Text(
            "www.getironcladtech.com",
            fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(top = 4.dp),
        )
    }
}
