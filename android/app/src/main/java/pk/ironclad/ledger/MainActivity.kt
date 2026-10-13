package pk.ironclad.ledger

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.AccountsScreen
import pk.ironclad.ledger.ui.AllocationSheet
import pk.ironclad.ledger.ui.Chip
import pk.ironclad.ledger.ui.DraftsScreen
import pk.ironclad.ledger.ui.EntrySheet
import pk.ironclad.ledger.ui.Field
import pk.ironclad.ledger.ui.GhostButton
import pk.ironclad.ledger.ui.HomeScreen
import pk.ironclad.ledger.ui.Ink
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.ListRow
import pk.ironclad.ledger.ui.OnboardScreen
import pk.ironclad.ledger.ui.RecordsScreen
import pk.ironclad.ledger.ui.ReportScreen
import pk.ironclad.ledger.ui.SettingsScreen
import pk.ironclad.ledger.ui.hexColour
import pk.ironclad.ledger.ui.unitName

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { LedgerTheme { App() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(vm: Vm = viewModel()) {
    val state by vm.ledger.collectAsState()
    val ui by vm.ui.collectAsState()

    LaunchedEffect(ui.toast) {
        if (ui.toast.isNotBlank()) {
            kotlinx.coroutines.delay(3000)
            vm.clearToast()
        }
    }

    Box(Modifier.fillMaxSize().background(Ink.bg)) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
            Box(Modifier.weight(1f)) {
                when {
                    !state.ready -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text("Setting the book up…", color = Ink.muted)
                    }
                    !state.prefs.onboarded -> OnboardScreen(vm)
                    ui.screen == Screen.RECORDS -> RecordsScreen(vm, state, ui)
                    ui.screen == Screen.DRAFTS -> DraftsScreen(vm, state, ui)
                    ui.screen == Screen.REPORT -> ReportScreen(vm, state, ui)
                    ui.screen == Screen.ACCOUNTS -> AccountsScreen(vm, state)
                    ui.screen == Screen.SETTINGS -> SettingsScreen(vm, state)
                    else -> HomeScreen(vm, state, ui)
                }
            }
            if (state.prefs.onboarded && state.ready) Dock(vm, ui)
        }

        if (ui.toast.isNotBlank()) {
            Box(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp)
                    .clip(RoundedCornerShape(10.dp)).background(Color(0xFF0B1016))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) { Text(ui.toast, fontSize = 13.sp, color = Ink.text) }
        }
    }

    val draft = ui.draft
    if (draft != null) {
        ModalBottomSheet(
            onDismissRequest = { vm.closeEntry() },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Ink.bg,
            contentColor = Ink.text,
        ) {
            when {
                ui.newCategoryOpen -> NewCategorySheet(vm, state)
                ui.allocOpen -> AllocationSheet(vm, state, draft)
                else -> EntrySheet(vm, state, ui, draft)
            }
        }
    } else if (ui.newCategoryOpen) {
        ModalBottomSheet(
            onDismissRequest = { vm.set { it.copy(newCategoryOpen = false) } },
            containerColor = Ink.bg, contentColor = Ink.text,
        ) { NewCategorySheet(vm, state) }
    }

    if (ui.pickerOpen.isNotBlank()) {
        ModalBottomSheet(
            onDismissRequest = { vm.set { it.copy(pickerOpen = "") } },
            containerColor = Ink.bg, contentColor = Ink.text,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (ui.pickerOpen == "campaign") {
                    ListRow("🎯", Ink.muted, "All campaigns", "everything together") {
                        vm.set { it.copy(campaignFilter = "", pickerOpen = "") }
                    }
                    state.liveCampaigns.forEach { campaign ->
                        ListRow(campaign.icon, hexColour(campaign.colour), campaign.name,
                            campaign.client.ifBlank { campaign.kind }) {
                            vm.set { it.copy(campaignFilter = campaign.name, pickerOpen = "") }
                        }
                    }
                } else {
                    listOf("day", "week", "month", "year", "all").forEach { unit ->
                        ListRow("", Ink.card2, unitName(unit), "",
                            amount = if (ui.unit == unit) "✓" else "") {
                            vm.set { it.copy(unit = unit, pickerOpen = "") }
                        }
                    }
                }
                Box(Modifier.size(20.dp))
            }
        }
    }
}

@Composable
fun Dock(vm: Vm, ui: Ui) {
    Row(
        modifier = Modifier.fillMaxWidth()
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(58.dp).clip(CircleShape).background(Ink.bad)
                .clickable { vm.startEntry(Type.EXPENSE) },
            Alignment.Center,
        ) { Text("−", fontSize = 30.sp, color = Color.White) }

        Box(
            Modifier.weight(1f).clip(CircleShape).background(Ink.card)
                .clickable {
                    vm.go(
                        when (ui.screen) {
                            Screen.HOME -> Screen.RECORDS
                            Screen.RECORDS -> Screen.REPORT
                            Screen.REPORT -> Screen.ACCOUNTS
                            else -> Screen.HOME
                        },
                    )
                }
                .padding(vertical = 12.dp),
            Alignment.Center,
        ) {
            Text(
                when (ui.screen) {
                    Screen.HOME -> "Records"
                    Screen.RECORDS -> "By campaign"
                    Screen.REPORT -> "Money we hold"
                    else -> "Home"
                },
                fontSize = 13.sp, color = Ink.text,
            )
        }

        Box(
            Modifier.size(58.dp).clip(CircleShape).background(Ink.good)
                .clickable { vm.startEntry(Type.INCOME) },
            Alignment.Center,
        ) { Text("+", fontSize = 30.sp, color = Color.White) }
    }
}

/** Adding a category without leaving the entry you were in the middle of. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewCategorySheet(vm: Vm, state: LedgerState) {
    var name by remember { mutableStateOf("") }
    var group by remember { mutableStateOf("Admin & financial") }
    var icon by remember { mutableStateOf("🏷️") }
    var rule by remember { mutableStateOf("") }
    val groups = state.categories.map { it.group }.filter { it.isNotBlank() }.distinct()
    val icons = listOf("🏷️", "⚡", "⛽", "🌐", "☎️", "🎧", "💻", "🪑", "🧹", "💂", "🚐", "☕", "🎯", "📣", "🧾", "🏦", "📦", "🛠️")

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp)) {
        Text("New category", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
            modifier = Modifier.padding(bottom = 10.dp))
        Field("What it is called", name) { name = it }

        Text("Group", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            groups.forEach { candidate -> Chip(candidate, group == candidate) { group = candidate } }
        }

        Text("Icon", fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            icons.forEach { candidate -> Chip(candidate, icon == candidate) { icon = candidate } }
        }

        Text("Campaign, by default", fontSize = 12.sp, color = Ink.muted,
            modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("Pick one each time", rule.isBlank()) { rule = "" }
            state.rules.forEach { candidate -> Chip(candidate.name, rule == candidate.name) { rule = candidate.name } }
        }

        GhostButton("Add it") {
            if (name.isBlank()) vm.toast("Give it a name.")
            else vm.addCategory(name, group, icon, "#5C6BC0", rule)
        }
        GhostButton("Cancel") { vm.set { it.copy(newCategoryOpen = false) } }
        Box(Modifier.size(18.dp))
    }
}
