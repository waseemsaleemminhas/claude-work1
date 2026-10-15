package pk.ironclad.ledger

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Export
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Money
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Sync
import pk.ironclad.ledger.data.Type
import java.time.LocalDate
import kotlin.math.floor

enum class Screen { ONBOARD, HOME, RECORDS, ACCOUNTS, SETTINGS }

/** The keypad is a small calculator, the way Monefy's is. */
data class Calc(val cur: String = "", val acc: Double? = null, val op: Char? = null) {
    val shown: String get() = cur.ifEmpty { "0" }

    val pending: String
        get() = op?.let { trim(acc ?: 0.0) + " " + when (it) {
            '*' -> "×"; '/' -> "÷"; else -> it.toString()
        } } ?: ""

    fun digit(k: String): Calc = when {
        k == "." && cur.contains('.') -> this
        k == "." -> copy(cur = (cur.ifEmpty { "0" }) + ".")
        cur.count { it.isDigit() } >= 12 -> this
        else -> copy(cur = (if (cur == "0") "" else cur) + k)
    }

    fun operate(next: Char): Calc {
        val carried = when {
            op != null && cur.isNotEmpty() -> apply(acc, op, cur.toDoubleOrNull() ?: 0.0)
            cur.isNotEmpty() -> cur.toDoubleOrNull() ?: 0.0
            else -> acc ?: 0.0
        }
        return Calc(cur = "", acc = carried, op = next)
    }

    fun back(): Calc = when {
        cur.isNotEmpty() -> copy(cur = cur.dropLast(1))
        op != null -> Calc(cur = acc?.let { trim(it) } ?: "", acc = null, op = null)
        else -> this
    }

    /** The first tap on a pending sum works it out; the next one saves. */
    fun equals(): Calc? {
        if (op == null) return null
        val value = apply(acc, op, if (cur.isEmpty()) 0.0 else cur.toDoubleOrNull() ?: 0.0)
        return Calc(cur = trim(if (value < 0) 0.0 else value))
    }

    val amountMinor: Long
        get() {
            val value = if (op != null) {
                apply(acc, op, if (cur.isEmpty()) 0.0 else cur.toDoubleOrNull() ?: 0.0)
            } else {
                cur.toDoubleOrNull() ?: 0.0
            }
            return Math.round(value * 100)
        }

    companion object {
        fun of(minor: Long): Calc = if (minor == 0L) Calc() else Calc(cur = trim(minor / 100.0))

        private fun apply(a: Double?, op: Char, b: Double): Double {
            val left = a ?: 0.0
            return when (op) {
                '+' -> left + b
                '-' -> left - b
                '*' -> left * b
                '/' -> if (b == 0.0) 0.0 else left / b
                else -> b
            }
        }

        fun trim(v: Double): String {
            val rounded = Math.round(v * 100) / 100.0
            return if (rounded == floor(rounded)) rounded.toLong().toString() else rounded.toString()
        }
    }
}

/** The voucher being filled in. Nothing here is written until Save is tapped. */
data class Draft(
    val id: String = "",
    val type: String = Type.EXPENSE,
    val date: String,
    val account: String,
    val toAccount: String = "",
    val vendor: String = "",
    val reference: String = "",
    val note: String = "",
    val line: Line = Line(),
    val calc: Calc = Calc(),
    val more: Boolean = false,
    val armed: Boolean = false,
    /** What an entry opened for a look held when it was opened. */
    val origin: String = "",
) {
    val editing: Boolean get() = id.isNotBlank()

    /** Has anything been typed? An untouched draft can close without a word. */
    val started: Boolean get() = calc.amountMinor > 0 || calc.cur.isNotBlank() || calc.op != null ||
        line.category.isNotBlank() || line.description.isNotBlank() ||
        vendor.isNotBlank() || reference.isNotBlank() || note.isNotBlank()

    /** Everything that would be written, as one string, for telling changes apart. */
    fun stamp(): String = listOf(
        date, type, account, toAccount, vendor, reference, note,
        line.category, line.description, calc.amountMinor.toString(),
    ).joinToString("|")

    /**
     * Is there anything here that would be lost? For a new voucher, anything
     * typed. For one opened to look at, only a real change — opening an entry
     * and pressing back should simply close it.
     */
    val worthKeeping: Boolean get() = if (origin.isBlank()) started else stamp() != origin

    fun withLine(change: (Line) -> Line): Draft = copy(line = change(line))

    /** The amount being typed is this voucher's amount. */
    fun lines(): List<Line> = listOf(line.copy(no = 1, amountMinor = calc.amountMinor))

    val totalMinor: Long get() = calc.amountMinor
}

data class Ui(
    val screen: Screen = Screen.HOME,
    val mode: String = Type.EXPENSE,
    val unit: String = "month",
    val anchor: LocalDate = LocalDate.now(),
    val draft: Draft? = null,
    val datePickerOpen: Boolean = false,
    val newCategoryOpen: Boolean = false,
    val pickerOpen: String = "",
    val toast: String = "",
    val syncing: Boolean = false,
    val confirmDiscard: Boolean = false,
    /** What has been typed into the category search box. */
    val catQuery: String = "",
    /** The ring slice being asked about, by category name. */
    val picked: String = "",
    /** Whose entries Records is showing; empty means everybody's. */
    val who: String = "",
)

class Vm(app: Application) : AndroidViewModel(app) {

    private val repo = Repo.get(app)
    val ledger: StateFlow<LedgerState> = repo.state

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    fun set(change: (Ui) -> Ui) { _ui.value = change(_ui.value) }

    /**
     * Anything that touches the database or the network. If it goes wrong the
     * person is told, in words, instead of the app vanishing.
     */
    private fun work(where: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (failure: Throwable) {
                Crash.note(getApplication(), where, failure)
                toast("Could not " + where + ": " + (failure.message ?: failure.javaClass.simpleName))
            }
        }
    }

    fun toast(message: String) = set { it.copy(toast = message) }
    fun clearToast() = set { it.copy(toast = "") }

    fun go(screen: Screen) = set { it.copy(screen = screen, pickerOpen = "") }

    fun step(direction: Long) = set {
        it.copy(
            anchor = when (it.unit) {
                "day" -> it.anchor.plusDays(direction)
                "week" -> it.anchor.plusWeeks(direction)
                "year" -> it.anchor.plusYears(direction)
                else -> it.anchor.plusMonths(direction)
            },
        )
    }

    // ---- putting something in

    /**
     * Today is the day unless somebody says otherwise, so the keypad comes up
     * ready to use and the date chip is there for the cost that is being
     * written up late. [askDate] opens the calendar first instead.
     */
    fun startEntry(type: String = Type.EXPENSE, category: String = "", askDate: Boolean = false) {
        val state = ledger.value
        val account = state.prefs.myAccount.takeIf { name -> state.liveAccounts.any { it.name == name } }
            ?: state.liveAccounts.firstOrNull()?.name.orEmpty()
        set {
            it.copy(
                draft = Draft(
                    type = type,
                    date = repo.today(),
                    account = account,
                    toAccount = if (type == Type.TRANSFER) state.liveAccounts.firstOrNull { a -> a.name != account }?.name.orEmpty() else "",
                    line = Line(category = category),
                ),
                datePickerOpen = askDate,
                catQuery = "",
            )
        }
    }

    fun openEntry(entry: Entry) {
        if (entry.status == Status.VOID) return toast("That entry was voided.")
        val opened = Draft(
            id = entry.id, type = entry.type, date = entry.date, account = entry.account,
            toAccount = entry.toAccount, vendor = entry.vendor, reference = entry.reference,
            note = entry.note,
            line = entry.lines.firstOrNull() ?: Line(),
            calc = Calc.of(entry.lines.firstOrNull()?.amountMinor ?: entry.totalMinor),
        )
        set { it.copy(draft = opened.copy(origin = opened.stamp()), catQuery = "") }
    }

    fun closeEntry() = set {
        it.copy(
            draft = null, datePickerOpen = false, newCategoryOpen = false,
            confirmDiscard = false, catQuery = "",
        )
    }

    /**
     * Anything but Add or Discard leaves the entry exactly where it was. A
     * half-written voucher is somebody's work: a stray swipe while scrolling,
     * a tap outside, the back button — none of them may throw it away.
     */
    fun tryClose() = set {
        when {
            it.draft == null -> it
            it.newCategoryOpen -> it.copy(newCategoryOpen = false)
            it.draft.worthKeeping -> it.copy(confirmDiscard = true)
            else -> it.copy(draft = null, datePickerOpen = false, catQuery = "")
        }
    }

    fun keepWriting() = set { it.copy(confirmDiscard = false) }

    fun discardEntry() {
        val wasEdit = ui.value.draft?.editing == true
        closeEntry()
        toast(if (wasEdit) "Changes dropped." else "Entry discarded.")
    }

    fun searchCategories(text: String) = set { it.copy(catQuery = text) }

    /** Tapping a slice of the ring, or its label, asks what it is. */
    fun pickSlice(name: String) = set { it.copy(picked = name) }

    /** Show one person's entries, or everybody's again. */
    fun showWho(name: String) = set { it.copy(who = if (it.who == name) "" else name) }

    fun setDate(date: String) = set {
        it.copy(draft = it.draft?.copy(date = date), datePickerOpen = false)
    }

    fun editDraft(change: (Draft) -> Draft) = set { it.copy(draft = it.draft?.let(change)) }

    fun pickCategory(name: String) = editDraft { d ->
        d.withLine { it.copy(category = name, group = ledger.value.category(name)?.group.orEmpty()) }
    }

    fun key(k: String) = editDraft { it.copy(calc = it.calc.digit(k)) }
    fun operate(op: Char) = editDraft { it.copy(calc = it.calc.operate(op)) }
    fun backspace() = editDraft { it.copy(calc = it.calc.back()) }

    fun save() {
        val draft = ui.value.draft ?: return
        val state = ledger.value

        draft.calc.equals()?.let { worked ->
            editDraft { it.copy(calc = worked) }
            return
        }
        if (draft.type == Type.TRANSFER) {
            if (draft.calc.amountMinor <= 0) return toast("Put in an amount above zero.")
            if (draft.account.isBlank() || draft.toAccount.isBlank() || draft.account == draft.toAccount) {
                return toast("Pick two different accounts.")
            }
        } else {
            if (draft.line.category.isBlank()) return toast("Pick a category first.")
            if (draft.calc.amountMinor <= 0) return toast("Put in an amount above zero.")
            if (draft.account.isBlank()) return toast("Pick the account it came from.")
        }

        val entry = Entry(
            id = draft.id,
            date = draft.date,
            type = draft.type,
            account = draft.account,
            toAccount = if (draft.type == Type.TRANSFER) draft.toAccount else "",
            vendor = draft.vendor,
            reference = draft.reference,
            note = draft.note,
            totalMinor = draft.calc.amountMinor,
            lines = if (draft.type == Type.TRANSFER) emptyList() else draft.lines(),
        )
        work("save that") {
            val saved = repo.save(entry)
            closeEntry()
            toast(if (draft.editing) "Saved." else "Added " + state.money(saved.totalMinor))
            QuickEntryWidget.refresh(getApplication())
            Sync.nudge(getApplication())
        }
    }

    fun voidEntry() {
        val draft = ui.value.draft ?: return
        if (!draft.editing) return
        if (!draft.armed) return editDraft { it.copy(armed = true) }
        work("void that") {
            repo.void(draft.id)
            closeEntry()
            toast("Voided. It stays in the book, marked void.")
            QuickEntryWidget.refresh(getApplication())
            Sync.nudge(getApplication())
        }
    }

    // ---- the chart of accounts, and me

    fun addCategory(name: String, group: String, icon: String, colour: String) {
        val type = ui.value.draft?.type ?: ui.value.mode
        work("add that category") {
            val category = repo.addCategory(
                name, if (type == Type.INCOME) Type.INCOME else Type.EXPENSE, group, icon, colour,
            )
            set { it.copy(newCategoryOpen = false) }
            if (ui.value.draft != null) pickCategory(category.name)
            toast("Added \"${category.name}\".")
        }
    }

    fun setPref(key: String, value: String) = work("remember that") { repo.setPref(key, value) }

    /** Hand the whole book to whatever app can take a spreadsheet. */
    fun exportSpreadsheet() = work("export the spreadsheet") {
        val entries = repo.state.value.entries
        if (entries.isEmpty()) { toast("Nothing to export yet."); return@work }
        val file = withContext(Dispatchers.IO) { Export.write(getApplication(), entries) }
        getApplication<Application>().startActivity(Export.shareIntent(getApplication(), file))
        toast(entries.size.toString() + " vouchers ready to send.")
    }

    /** Open the Google Sheet itself, once a sync has told us where it is. */
    fun openSpreadsheet() = work("open the spreadsheet") {
        val url = repo.state.value.prefs.sheetUrl
        if (url.isBlank()) { toast("Sync once first, then the sheet opens from here."); return@work }
        getApplication<Application>().startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun syncNow() {
        if (ui.value.syncing) return
        set { it.copy(syncing = true) }
        viewModelScope.launch {
            val result = try {
                Sync.runOnce(getApplication())
            } catch (failure: Throwable) {
                Crash.note(getApplication(), "sync", failure)
                "Sync did not work: " + (failure.message ?: failure.javaClass.simpleName)
            }
            set { it.copy(syncing = false) }
            toast(result)
        }
    }

    fun money(minor: Long): String = ledger.value.money(minor)
}
