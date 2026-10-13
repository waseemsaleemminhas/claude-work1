package pk.ironclad.ledger

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pk.ironclad.ledger.data.Entry
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
) {
    val editing: Boolean get() = id.isNotBlank()

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

    fun startEntry(type: String = Type.EXPENSE, category: String = "") {
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
            )
        }
    }

    fun openEntry(entry: Entry) {
        if (entry.status == Status.VOID) return toast("That entry was voided.")
        set {
            it.copy(
                draft = Draft(
                    id = entry.id, type = entry.type, date = entry.date, account = entry.account,
                    toAccount = entry.toAccount, vendor = entry.vendor, reference = entry.reference,
                    note = entry.note,
                    line = entry.lines.firstOrNull() ?: Line(),
                    calc = Calc.of(entry.lines.firstOrNull()?.amountMinor ?: entry.totalMinor),
                ),
            )
        }
    }

    fun closeEntry() = set { it.copy(draft = null, datePickerOpen = false, newCategoryOpen = false) }

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
