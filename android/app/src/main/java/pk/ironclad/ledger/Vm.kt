package pk.ironclad.ledger

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pk.ironclad.ledger.data.Allocation
import pk.ironclad.ledger.data.Allocator
import pk.ironclad.ledger.data.Campaign
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Method
import pk.ironclad.ledger.data.Money
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Sync
import pk.ironclad.ledger.data.Type
import java.time.LocalDate
import kotlin.math.floor

enum class Screen { ONBOARD, HOME, RECORDS, DRAFTS, REPORT, ACCOUNTS, SETTINGS }

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
    val lines: List<Line> = listOf(Line()),
    val index: Int = 0,
    val calc: Calc = Calc(),
    val more: Boolean = false,
    val armed: Boolean = false,
) {
    val line: Line get() = lines.getOrElse(index) { Line() }
    val editing: Boolean get() = id.isNotBlank()

    fun withLine(change: (Line) -> Line): Draft =
        copy(lines = lines.mapIndexed { i, l -> if (i == index) change(l) else l })

    /** The amount being typed belongs to the line it is being typed on. */
    fun settledLines(state: LedgerState): List<Line> =
        lines.mapIndexed { i, l ->
            val withAmount = if (i == index) l.copy(amountMinor = calc.amountMinor) else l
            Allocator.settle(withAmount, state.campaigns, state.rules)
        }

    fun totalMinor(state: LedgerState): Long =
        if (type == Type.TRANSFER) calc.amountMinor else settledLines(state).sumOf { it.amountMinor }
}

data class Ui(
    val screen: Screen = Screen.HOME,
    val mode: String = Type.EXPENSE,
    val unit: String = "month",
    val anchor: LocalDate = LocalDate.now(),
    val campaignFilter: String = "",
    val draft: Draft? = null,
    val allocOpen: Boolean = false,
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
        var line = Line(category = category)
        if (category.isNotBlank()) {
            line = Allocator.preset(line, state.category(category), state.prefs.myCampaign, state.campaigns, state.rules)
        }
        set {
            it.copy(
                draft = Draft(
                    type = type,
                    date = repo.today(),
                    account = account,
                    toAccount = if (type == Type.TRANSFER) state.liveAccounts.firstOrNull { a -> a.name != account }?.name.orEmpty() else "",
                    lines = listOf(line),
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
                    lines = entry.lines.ifEmpty { listOf(Line()) }.map { line ->
                        line.copy(
                            campaign = if (line.allocationMethod != Method.RULE && line.allocations.size == 1)
                                line.allocations.first().campaign else line.campaign,
                        )
                    },
                    calc = Calc.of(entry.lines.firstOrNull()?.amountMinor ?: entry.totalMinor),
                ),
            )
        }
    }

    fun closeEntry() = set { it.copy(draft = null, allocOpen = false, newCategoryOpen = false) }

    fun editDraft(change: (Draft) -> Draft) = set { it.copy(draft = it.draft?.let(change)) }

    fun pickCategory(name: String) {
        val state = ledger.value
        editDraft { d ->
            d.withLine { line ->
                Allocator.preset(
                    line.copy(category = name, amountMinor = d.calc.amountMinor),
                    state.category(name), state.prefs.myCampaign, state.campaigns, state.rules,
                )
            }
        }
    }

    fun key(k: String) = editDraft { it.copy(calc = it.calc.digit(k)) }
    fun operate(op: Char) = editDraft { it.copy(calc = it.calc.operate(op)) }
    fun backspace() = editDraft { it.copy(calc = it.calc.back()) }

    fun addLine() {
        val draft = ui.value.draft ?: return
        if (draft.line.category.isBlank()) return toast("Finish this line first.")
        if (draft.calc.amountMinor <= 0) return toast("This line needs an amount first.")
        val kept = draft.withLine { it.copy(amountMinor = draft.calc.amountMinor) }
        set {
            it.copy(draft = kept.copy(lines = kept.lines + Line(), index = kept.lines.size, calc = Calc()))
        }
    }

    fun goToLine(i: Int) {
        val draft = ui.value.draft ?: return
        val kept = draft.withLine { it.copy(amountMinor = draft.calc.amountMinor) }
        set { it.copy(draft = kept.copy(index = i, calc = Calc.of(kept.lines[i].amountMinor))) }
    }

    fun dropLine() {
        val draft = ui.value.draft ?: return
        if (draft.lines.size < 2) return
        val lines = draft.lines.toMutableList().also { it.removeAt(draft.index) }
        val index = (draft.index - 1).coerceAtLeast(0)
        set { it.copy(draft = draft.copy(lines = lines, index = index, calc = Calc.of(lines[index].amountMinor))) }
    }

    fun setAllocationToCampaign(campaign: String) = editDraft { d ->
        d.withLine { it.copy(allocationMethod = Method.DIRECT, campaign = campaign, allocationRule = "") }
    }

    fun setAllocationToRule(rule: String) = editDraft { d ->
        d.withLine { it.copy(allocationMethod = Method.RULE, allocationRule = rule) }
    }

    fun setCustomSplit(shares: Map<String, Int>) = editDraft { d ->
        d.withLine { line ->
            line.copy(
                allocationMethod = Method.SPLIT,
                allocations = shares.filter { it.value > 0 }.map { Allocation(it.key, it.value, 0) },
            )
        }
    }

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
            val lines = draft.settledLines(state)
            lines.forEachIndexed { i, line ->
                if (line.category.isBlank()) return toast("Line ${i + 1} needs a category.")
                if (line.amountMinor <= 0) return toast("Line ${i + 1} needs an amount.")
            }
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
            lines = if (draft.type == Type.TRANSFER) emptyList() else draft.settledLines(state),
        )
        viewModelScope.launch {
            val saved = repo.save(entry)
            closeEntry()
            toast(
                when {
                    saved.status == Status.DRAFT -> "Saved — it still needs a campaign."
                    draft.editing -> "Saved."
                    else -> "Added " + state.money(saved.totalMinor)
                },
            )
            Sync.nudge(getApplication())
        }
    }

    fun voidEntry() {
        val draft = ui.value.draft ?: return
        if (!draft.editing) return
        if (!draft.armed) return editDraft { it.copy(armed = true) }
        viewModelScope.launch {
            repo.void(draft.id)
            closeEntry()
            toast("Voided. It stays in the book, marked void.")
            Sync.nudge(getApplication())
        }
    }

    // ---- the chart of accounts, and me

    fun addCategory(name: String, group: String, icon: String, colour: String, rule: String) {
        val type = ui.value.draft?.type ?: ui.value.mode
        viewModelScope.launch {
            val category = repo.addCategory(name, if (type == Type.INCOME) Type.INCOME else Type.EXPENSE, group, icon, colour, rule)
            set { it.copy(newCategoryOpen = false) }
            if (ui.value.draft != null) pickCategory(category.name)
            toast("Added \"${category.name}\".")
        }
    }

    fun saveCampaign(campaign: Campaign) = viewModelScope.launch { repo.saveCampaign(campaign) }

    fun setPref(key: String, value: String) = viewModelScope.launch { repo.setPref(key, value) }

    fun syncNow() {
        if (ui.value.syncing) return
        set { it.copy(syncing = true) }
        viewModelScope.launch {
            val result = Sync.runOnce(getApplication())
            set { it.copy(syncing = false) }
            toast(result)
        }
    }

    fun money(minor: Long): String = ledger.value.money(minor)
}
