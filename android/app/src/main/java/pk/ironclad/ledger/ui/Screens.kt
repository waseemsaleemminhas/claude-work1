package pk.ironclad.ledger.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    val totals = totalsOf(entries, ui.campaignFilter)
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
                        Type.INCOME -> weightOf(it, ui.campaignFilter)
                        Type.EXPENSE -> -weightOf(it, ui.campaignFilter)
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
    val title = when {
        transfer -> "Moved money"
        entry.lines.size > 1 -> "${entry.lines.size} things · ${first?.category.orEmpty()}"
        else -> first?.category.orEmpty().ifBlank { "—" }
    }
    val campaigns = entry.campaigns
    val who = if (transfer) "${entry.account} → ${entry.toAccount}"
    else listOf(entry.vendor, entry.account).filter { it.isNotBlank() }.joinToString(" · ")
    val subtitle = who + when {
        campaigns.isEmpty() -> ""
        campaigns.size > 2 -> " · ${campaigns.size} campaigns"
        else -> " · " + campaigns.joinToString(", ")
    }
    ListRow(
        icon = if (transfer) "🔁" else category?.icon ?: "•",
        colour = if (transfer) Ink.muted else hexColour(category?.colour ?: "#90A4AE"),
        title = title + if (entry.status == Status.DRAFT) "  ⚠️" else "",
        subtitle = subtitle,
        amount = state.signed(weightOf(entry, ui.campaignFilter), entry.type),
        amountColour = when (entry.type) {
            Type.INCOME -> Ink.good
            Type.EXPENSE -> Ink.bad
            else -> Ink.muted
        },
        note = if (entry.lines.size > 1) "${entry.lines.size} lines" else "",
        warn = entry.status == Status.DRAFT,
    ) { vm.openEntry(entry) }
}

/** The queue that wants to be empty. */
@Composable
fun DraftsScreen(vm: Vm, state: LedgerState, ui: Ui) {
    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("Needs a campaign", vm)
                Text(
                    "The money is already off the account. Until a campaign is set, it stays out of the " +
                        "campaign report — so this list wants to be empty.",
                    fontSize = 12.5.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 10.dp),
                )
            }
        }
        if (state.drafts.isEmpty()) item { Empty("Nothing waiting. Good.") }
        items(state.drafts.size) { i -> EntryRow(vm, state, ui, state.drafts[i]) }
        item { Box(Modifier.size(90.dp)) }
    }
}

/** What each campaign cost. */
@Composable
fun ReportScreen(vm: Vm, state: LedgerState, ui: Ui) {
    val entries = visibleEntries(state, ui).filter { it.type != Type.TRANSFER }
    data class Figure(var income: Long = 0, var direct: Long = 0, var shared: Long = 0)

    val rows = linkedMapOf<String, Figure>()
    state.liveCampaigns.forEach { rows[it.name] = Figure() }
    var unallocated = 0L
    entries.forEach { entry ->
        entry.lines.forEach { line ->
            if (line.allocations.isEmpty()) {
                if (entry.type == Type.EXPENSE) unallocated += line.amountMinor
                return@forEach
            }
            line.allocations.forEach { allocation ->
                val figure = rows.getOrPut(allocation.campaign) { Figure() }
                when {
                    entry.type == Type.INCOME -> figure.income += allocation.amountMinor
                    line.basis == "apportioned" -> figure.shared += allocation.amountMinor
                    else -> figure.direct += allocation.amountMinor
                }
            }
        }
    }

    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        item {
            Column {
                ScreenHeader("By campaign", vm)
                PeriodBar(vm, ui)
                if (unallocated > 0) {
                    DraftBanner(state.drafts.size.coerceAtLeast(1), state.money(unallocated)) { vm.go(Screen.DRAFTS) }
                }
            }
        }
        rows.entries.sortedByDescending { it.value.income + it.value.direct + it.value.shared }.forEach { (name, figure) ->
            item {
                val campaign = state.campaign(name)
                val cost = figure.direct + figure.shared
                val net = figure.income - cost
                Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    ListRow(
                        icon = campaign?.icon ?: "🎯",
                        colour = hexColour(campaign?.colour ?: "#90A4AE"),
                        title = name + if (campaign?.kind == "Internal") "  (internal)" else "",
                        subtitle = if ((campaign?.seats ?: 0) > 0)
                            "${campaign?.seats} seats · ${state.money(cost / (campaign?.seats ?: 1))} a seat"
                        else "no seats set",
                        amount = state.money(net),
                        amountColour = if (net < 0) Ink.bad else Ink.good,
                        note = "net",
                    )
                    Row(Modifier.fillMaxWidth().padding(start = 46.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("in ${state.money(figure.income)}", fontSize = 11.sp, color = Ink.good)
                        Text("direct ${state.money(figure.direct)}", fontSize = 11.sp, color = Ink.muted)
                        Text("shared ${state.money(figure.shared)}", fontSize = 11.sp, color = Ink.muted)
                    }
                }
            }
        }
        item {
            Text(
                "Direct is what was bought for that campaign. Shared is its slice of rent, electricity " +
                    "and the rest, worked out when each entry was saved.",
                fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(vertical = 10.dp),
            )
        }
        item { Box(Modifier.size(90.dp)) }
    }
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
                Text("My campaign", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip("Ask me each time", state.prefs.myCampaign.isBlank()) { vm.setPref("myCampaign", "") }
                    state.liveCampaigns.forEach { campaign ->
                        Chip(campaign.name, state.prefs.myCampaign == campaign.name) {
                            vm.setPref("myCampaign", campaign.name)
                        }
                    }
                }
                Text("My account", fontSize = 12.sp, color = Ink.muted,
                    modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
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
            }
        }

        Card(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            Column {
                Text("${state.entries.size} vouchers on this phone", fontSize = 13.sp, color = Ink.text)
                Text("${state.categories.size} categories · ${state.campaigns.size} campaigns",
                    fontSize = 12.sp, color = Ink.muted)
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
        Box(Modifier.size(40.dp))
        Text("Ironclad Ledger", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink.text)
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
    }
}
