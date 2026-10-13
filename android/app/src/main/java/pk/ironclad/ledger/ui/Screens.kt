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
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RecordsScreen(vm: Vm, state: LedgerState, ui: Ui) {
    val entries = visibleEntries(state, ui).sortedWith(
        compareByDescending<Entry> { it.date }.thenByDescending { it.at },
    )
    val totals = totalsOf(entries)
    val today = LocalDate.now()

    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("Records", vm)
                PeriodBar(vm, ui)
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("In", state.money(totals.inMinor), Ink.good, false, Modifier.weight(1f)) {}
                    Pill("Out", state.money(totals.outMinor), Ink.bad, false, Modifier.weight(1f)) {}
                    Pill("Left", state.money(totals.leftMinor),
                        if (totals.leftMinor < 0) Ink.bad else Ink.good, false, Modifier.weight(1f)) {}
                }
            }
        }
        if (entries.isEmpty()) {
            item { Empty("Nothing in this period yet.\nTap − or + to put something in.") }
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
            items(dayEntries.size) { i -> EntryRow(vm, state, ui, dayEntries[i]) }
        }
        item { Box(Modifier.size(90.dp)) }
    }
}

@Composable
fun EntryRow(vm: Vm, state: LedgerState, ui: Ui, entry: Entry) {
    val first = entry.lines.firstOrNull()
    val category = first?.let { state.category(it.category) }
    val transfer = entry.type == Type.TRANSFER
    val title = if (transfer) "Moved money" else first?.category.orEmpty().ifBlank { "—" }
    val subtitle = if (transfer) "${entry.account} → ${entry.toAccount}"
    else listOf(entry.vendor, entry.account, first?.description.orEmpty())
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
    ) { vm.openEntry(entry) }
}

/** Money we hold, including what people are carrying. */
@Composable
fun AccountsScreen(vm: Vm, state: LedgerState) {
    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("Money we hold", vm)
                Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
                    Column {
                        Text("EVERYTHING TOGETHER", fontSize = 10.sp, color = Ink.muted)
                        Text(
                            state.money(state.totalHeldMinor), fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (state.totalHeldMinor < 0) Ink.bad else Ink.text,
                        )
                    }
                }
            }
        }
        items(state.accounts.size) { i ->
            val account = state.accounts[i]
            ListRow(
                icon = account.icon,
                colour = hexColour(account.colour),
                title = account.name + if (account.archived) "  (hidden)" else "",
                subtitle = account.kind + if (account.heldBy.isNotBlank()) " · held by ${account.heldBy}" else "",
                amount = state.money(account.balanceMinor),
                amountColour = if (account.balanceMinor < 0) Ink.bad else Ink.text,
            )
        }
        item {
            Column {
                GhostButton("Move money between accounts") { vm.startEntry(Type.TRANSFER) }
                Text(
                    "Cash someone is carrying is an account of kind Float, held by them. Giving an advance " +
                        "is a move into it; what is left is what they still hold.",
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
