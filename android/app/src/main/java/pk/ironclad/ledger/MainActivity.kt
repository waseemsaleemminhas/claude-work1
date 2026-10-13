package pk.ironclad.ledger

import android.content.Intent
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
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
import pk.ironclad.ledger.ui.Chip
import pk.ironclad.ledger.ui.EntrySheet
import pk.ironclad.ledger.ui.Field
import pk.ironclad.ledger.ui.GhostButton
import pk.ironclad.ledger.ui.HomeScreen
import pk.ironclad.ledger.ui.Ink
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.dayOffered
import pk.ironclad.ledger.ui.ListRow
import pk.ironclad.ledger.ui.OnboardScreen
import pk.ironclad.ledger.ui.RecordsScreen
import pk.ironclad.ledger.ui.SettingsScreen
import pk.ironclad.ledger.ui.unitName
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

class MainActivity : ComponentActivity() {

    /** What the home-screen widget asked for, if the app was opened from it. */
    private val quickEntry = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        quickEntry.value = askedFor(intent)
        setContent { LedgerTheme { App(quickEntry = quickEntry) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        quickEntry.value = askedFor(intent)
    }

    private fun askedFor(intent: Intent?): String? =
        if (intent?.action == QuickEntryWidget.QUICK_ENTRY) {
            intent.getStringExtra(QuickEntryWidget.EXTRA_KIND)
        } else {
            null
        }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(vm: Vm = viewModel(), quickEntry: MutableState<String?> = remember { mutableStateOf(null) }) {
    val context = LocalContext.current
    var crashReport by remember { mutableStateOf(Crash.last(context)) }
    if (crashReport != null) {
        CrashScreen(crashReport!!) {
            Crash.clear(context)
            crashReport = null
        }
        return
    }

    val state by vm.ledger.collectAsState()
    val ui by vm.ui.collectAsState()

    // Straight into the keypad when the widget asked for it, once the book is open.
    LaunchedEffect(quickEntry.value, state.ready, state.prefs.onboarded) {
        val kind = quickEntry.value
        if (kind != null && state.ready && state.prefs.onboarded) {
            vm.startEntry(kind, askDate = true)
            quickEntry.value = null
        }
    }

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
            // Only Add or Discard may close this. A swipe while scrolling the
            // categories used to throw away everything typed so far.
            onDismissRequest = { vm.tryClose() },
            sheetState = rememberModalBottomSheetState(
                skipPartiallyExpanded = true,
                confirmValueChange = { value -> value != SheetValue.Hidden },
            ),
            containerColor = Ink.bg,
            contentColor = Ink.text,
            dragHandle = null,
        ) {
            Column(Modifier.fillMaxWidth()) {
                if (ui.toast.isNotBlank()) SheetMessage(ui.toast)
                if (ui.confirmDiscard) DiscardBar(vm)
                when {
                    ui.newCategoryOpen -> NewCategorySheet(vm, state)
                    else -> EntrySheet(vm, state, ui, draft)
                }
            }
        }
    } else if (ui.newCategoryOpen) {
        ModalBottomSheet(
            onDismissRequest = { vm.set { it.copy(newCategoryOpen = false) } },
            containerColor = Ink.bg, contentColor = Ink.text,
        ) { NewCategorySheet(vm, state) }
    }

    if (ui.datePickerOpen && draft != null) {
        val picker = rememberDatePickerState(
            initialSelectedDateMillis = runCatching {
                LocalDate.parse(draft.date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            }.getOrNull(),
            yearRange = (LocalDate.now().year - 3)..LocalDate.now().year,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = dayOffered(utcTimeMillis)
                override fun isSelectableYear(year: Int) = year <= LocalDate.now().year
            },
        )
        DatePickerDialog(
            onDismissRequest = { vm.set { it.copy(datePickerOpen = false) } },
            confirmButton = {
                TextButton(onClick = {
                    val chosen = picker.selectedDateMillis
                    if (chosen == null) {
                        vm.set { it.copy(datePickerOpen = false) }
                    } else {
                        vm.setDate(
                            Instant.ofEpochMilli(chosen).atZone(ZoneOffset.UTC).toLocalDate().toString(),
                        )
                    }
                }) { Text("Use this date") }
            },
            dismissButton = {
                TextButton(onClick = { vm.set { it.copy(datePickerOpen = false) } }) { Text("Cancel") }
            },
            colors = DatePickerDefaults.colors(containerColor = Ink.card),
        ) {
            DatePicker(
                state = picker,
                showModeToggle = false,
                title = {
                    Text(
                        "Which day was this?",
                        fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                        modifier = Modifier.padding(start = 24.dp, top = 16.dp),
                    )
                },
                headline = {
                    Text(
                        picker.selectedDateMillis?.let {
                            pk.ironclad.ledger.ui.dateLabel(
                                Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString(),
                            )
                        } ?: "Pick a day",
                        fontSize = 24.sp, color = Ink.text,
                        modifier = Modifier.padding(start = 24.dp, bottom = 10.dp),
                    )
                },
            )
        }
    }

    if (ui.pickerOpen.isNotBlank()) {
        ModalBottomSheet(
            onDismissRequest = { vm.set { it.copy(pickerOpen = "") } },
            containerColor = Ink.bg, contentColor = Ink.text,
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                listOf("day", "week", "month", "year", "all").forEach { unit ->
                    ListRow("", Ink.card2, unitName(unit), "",
                        amount = if (ui.unit == unit) "✓" else "") {
                        vm.set { it.copy(unit = unit, pickerOpen = "") }
                    }
                }
                Box(Modifier.size(20.dp))
            }
        }
    }
}

/** What the app has to say, where it can actually be seen: inside the sheet. */
/**
 * Shown only when something was typed and the sheet was asked to close. Nothing
 * is thrown away until Discard is tapped here, on purpose.
 */
@Composable
fun DiscardBar(vm: Vm) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Ink.bad.copy(alpha = 0.14f))
            .padding(horizontal = 12.dp, vertical = 12.dp),
    ) {
        Text(
            "Throw this entry away?",
            fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
        )
        Text(
            "Nothing has been saved yet.",
            fontSize = 12.sp, color = Ink.muted, modifier = Modifier.padding(top = 2.dp),
        )
        Row(
            Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { vm.keepWriting() },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Ink.brand),
                shape = RoundedCornerShape(10.dp),
            ) { Text("Keep writing", fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
            Button(
                onClick = { vm.discardEntry() },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Ink.bad),
                shape = RoundedCornerShape(10.dp),
            ) { Text("Discard", fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
fun SheetMessage(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Ink.warn.copy(alpha = 0.16f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("⚠️", fontSize = 15.sp)
        Text(
            text, fontSize = 13.sp, color = Ink.warn, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

/** What happened the last time the app stopped, in words that can be sent on. */
@Composable
fun CrashScreen(report: String, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Column(
        Modifier.fillMaxSize().background(Ink.bg)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(16.dp),
    ) {
        Text("The app stopped last time", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink.text)
        Text(
            "Nothing you entered was lost. Send this to whoever looks after the app and it can be fixed.",
            fontSize = 13.sp, color = Ink.muted, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp),
        )
        Box(
            Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(12.dp))
                .background(Ink.card).padding(12.dp),
        ) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(report, fontSize = 11.sp, color = Ink.text)
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) {
                GhostButton("Copy it") { clipboard.setText(AnnotatedString(report)) }
            }
            Box(Modifier.weight(1f)) {
                GhostButton("Carry on", Ink.brand) { onDismiss() }
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
                .clickable { vm.startEntry(Type.EXPENSE, askDate = true) },
            Alignment.Center,
        ) { Text("−", fontSize = 30.sp, color = Color.White) }

        Box(
            Modifier.weight(1f).clip(CircleShape).background(Ink.card)
                .clickable {
                    vm.go(
                        when (ui.screen) {
                            Screen.HOME -> Screen.RECORDS
                            Screen.RECORDS -> Screen.ACCOUNTS
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
                    Screen.RECORDS -> "Money we hold"
                    else -> "Home"
                },
                fontSize = 13.sp, color = Ink.text,
            )
        }

        Box(
            Modifier.size(58.dp).clip(CircleShape).background(Ink.good)
                .clickable { vm.startEntry(Type.INCOME, askDate = true) },
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

        GhostButton("Add it") {
            if (name.isBlank()) vm.toast("Give it a name.")
            else vm.addCategory(name, group, icon, "#5C6BC0")
        }
        GhostButton("Cancel") { vm.set { it.copy(newCategoryOpen = false) } }
        Box(Modifier.size(18.dp))
    }
}
