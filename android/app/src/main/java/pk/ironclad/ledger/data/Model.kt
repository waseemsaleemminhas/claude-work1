package pk.ironclad.ledger.data

import kotlinx.serialization.Serializable

/** The words the sheet, the web page and this app all use for the same things. */
object Type {
    const val EXPENSE = "Expense"
    const val INCOME = "Income"
    const val TRANSFER = "Transfer"
}

object Status {
    const val DRAFT = "Draft"
    const val RECORDED = "Recorded"
    const val VOID = "Void"
}

object Method {
    const val DIRECT = "direct"
    const val SPLIT = "split"
    const val RULE = "rule"
}

object Basis {
    const val DIRECT = "direct"
    const val APPORTIONED = "apportioned"
}

/** A slice of one line that belongs to one campaign. Amounts are whole paisa. */
@Serializable
data class Allocation(
    val campaign: String,
    val bp: Int,
    val amountMinor: Long,
)

/** One thing on a bill: five headsets, a filter change, a month of rent. */
@Serializable
data class Line(
    val no: Int = 1,
    val category: String = "",
    val group: String = "",
    val description: String = "",
    val qty: Double? = null,
    val unitPriceMinor: Long? = null,
    val amountMinor: Long = 0,
    val costCentre: String = "",
    val allocationMethod: String = Method.DIRECT,
    val campaign: String = "",
    val allocationRule: String = "",
    val allocationRuleVersion: Int? = null,
    val basis: String = Basis.DIRECT,
    val allocations: List<Allocation> = emptyList(),
) {
    val allocated: Boolean get() = allocations.isNotEmpty()
}

/** A voucher: one payment, one or more lines. */
@Serializable
data class Entry(
    val id: String,
    val date: String,
    val type: String,
    val status: String = Status.RECORDED,
    val totalMinor: Long = 0,
    val account: String = "",
    val toAccount: String = "",
    val vendor: String = "",
    val reference: String = "",
    val note: String = "",
    val enteredBy: String = "",
    val at: Long = 0,
    val lines: List<Line> = emptyList(),
    val updatedAt: Long = 0,
) {
    val campaigns: List<String>
        get() = lines.flatMap { it.allocations }.map { it.campaign }.distinct()

    val categories: List<String>
        get() = lines.map { it.category }.filter { it.isNotBlank() }.distinct()
}

@Serializable
data class Campaign(
    val id: String,
    val name: String,
    val client: String = "",
    val code: String = "",
    val kind: String = "Client",
    val status: String = "Active",
    val seats: Int = 0,
    val agents: Int = 0,
    val icon: String = "🎯",
    val colour: String = "#1E88E5",
    val updatedAt: Long = 0,
) {
    val live: Boolean get() = status == "Active"
    val isClient: Boolean get() = kind == "Client"
}

@Serializable
data class Category(
    val id: String,
    val name: String,
    val group: String = "",
    val kind: String = Type.EXPENSE,
    val icon: String = "•",
    val colour: String = "#90A4AE",
    val rule: String = "",
    val costCentre: String = "",
    val budgetMinor: Long = 0,
    val isNew: Boolean = false,
    val mergedInto: String = "",
    val archived: Boolean = false,
    val sort: Int = 9999,
    val updatedAt: Long = 0,
)

@Serializable
data class Account(
    val id: String,
    val name: String,
    val kind: String = "Cash",
    val heldBy: String = "",
    val openingMinor: Long = 0,
    val icon: String = "💰",
    val colour: String = "#1E88E5",
    val archived: Boolean = false,
    val updatedAt: Long = 0,
) {
    var balanceMinor: Long = openingMinor
}

@Serializable
data class Rule(
    val id: String,
    val name: String,
    val method: String = "Equal",
    val version: Int = 1,
    val updatedAt: Long = 0,
)

/** Money is whole paisa in the data and only becomes words here. */
object Money {
    fun format(minor: Long, currency: String = "Rs", decimals: Int = 0): String {
        val negative = minor < 0
        val units = kotlin.math.abs(minor) / 100.0
        val text = if (decimals == 0) {
            group(kotlin.math.round(units).toLong().toString())
        } else {
            val whole = kotlin.math.abs(minor) / 100
            val paisa = kotlin.math.abs(minor) % 100
            group(whole.toString()) + "." + paisa.toString().padStart(2, '0')
        }
        return (if (negative) "-" else "") + currency + " " + text
    }

    fun signed(minor: Long, type: String, currency: String = "Rs", decimals: Int = 0): String =
        when (type) {
            Type.TRANSFER -> format(minor, currency, decimals)
            Type.INCOME -> "+" + format(minor, currency, decimals)
            else -> "-" + format(minor, currency, decimals)
        }

    private fun group(digits: String): String {
        val out = StringBuilder()
        var count = 0
        for (i in digits.length - 1 downTo 0) {
            out.append(digits[i])
            count++
            if (count % 3 == 0 && i > 0) out.append(',')
        }
        return out.reverse().toString()
    }

    /** "1234.5" -> 123450 paisa. Anything unreadable is zero. */
    fun parse(text: String): Long {
        val cleaned = text.filter { it.isDigit() || it == '.' || it == '-' }
        val value = cleaned.toDoubleOrNull() ?: return 0
        return kotlin.math.round(value * 100).toLong()
    }
}
