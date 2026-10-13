package pk.ironclad.ledger.data

import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Splitting a line across campaigns.
 *
 * The same arithmetic as the sheet and the web page, deliberately: largest
 * remainder, ties broken by campaign name. Two phones that settle the same entry
 * offline land on the same paisa, so syncing never has to argue about it.
 */
object Allocator {

    data class Weight(val campaign: String, val weight: Double)

    fun splitExact(amountMinor: Long, weights: List<Weight>): List<Allocation> {
        val useful = weights.filter { it.weight > 0 }
        if (useful.isEmpty() || amountMinor == 0L) return emptyList()
        val total = useful.sumOf { it.weight }

        data class Part(val campaign: String, var amount: Long, val remainder: Double)

        val parts = useful.map {
            val raw = amountMinor * it.weight / total
            val base = floor(raw).toLong()
            Part(it.campaign, base, raw - base)
        }
        var left = amountMinor - parts.sumOf { it.amount }
        parts.sortedWith(
            compareByDescending<Part> { it.remainder }.thenBy { it.campaign }
        ).forEach {
            if (left > 0) {
                it.amount += 1
                left--
            }
        }
        return parts.filter { it.amount > 0 }.map {
            Allocation(
                campaign = it.campaign,
                bp = (it.amount * 10000.0 / amountMinor).roundToInt(),
                amountMinor = it.amount,
            )
        }
    }

    /**
     * Shared costs go out over the campaigns that are actually running. Internal
     * campaigns are somewhere to put company spending, not somewhere rent lands.
     */
    fun ruleWeights(rule: Rule, campaigns: List<Campaign>): List<Weight> =
        campaigns.filter { it.live && it.isClient }.map {
            Weight(
                it.name,
                when (rule.method) {
                    "Seats" -> it.seats.toDouble()
                    "Agents" -> it.agents.toDouble()
                    else -> 1.0
                }
            )
        }

    /**
     * Works out one line's split from whatever it is set to. An empty result is
     * the honest answer "this cannot be settled yet" — which is what makes the
     * voucher a draft instead of a guess.
     */
    fun settle(line: Line, campaigns: List<Campaign>, rules: List<Rule>): Line {
        if (line.amountMinor <= 0) return line.copy(allocations = emptyList())
        return when (line.allocationMethod) {
            Method.RULE -> {
                val rule = rules.firstOrNull { it.name == line.allocationRule }
                    ?: return line.copy(allocations = emptyList())
                line.copy(
                    allocations = splitExact(line.amountMinor, ruleWeights(rule, campaigns)),
                    basis = Basis.APPORTIONED,
                    allocationRuleVersion = rule.version,
                )
            }

            Method.SPLIT -> {
                val wanted = line.allocations
                    .filter { a -> a.bp > 0 && campaigns.any { it.name == a.campaign } }
                    .distinctBy { it.campaign }
                line.copy(
                    allocations = splitExact(
                        line.amountMinor,
                        wanted.map { Weight(it.campaign, it.bp.toDouble()) },
                    ),
                    basis = Basis.DIRECT,
                )
            }

            else -> {
                val hit = campaigns.firstOrNull { it.name == line.campaign }
                    ?: return line.copy(allocations = emptyList())
                line.copy(
                    allocations = listOf(Allocation(hit.name, 10000, line.amountMinor)),
                    basis = Basis.DIRECT,
                )
            }
        }
    }

    /** What a brand-new line should already be set to, so most entries need no taps. */
    fun preset(line: Line, category: Category?, myCampaign: String, campaigns: List<Campaign>, rules: List<Rule>): Line {
        val rule = category?.rule?.takeIf { name -> rules.any { it.name == name } }
        val ready = if (rule != null) {
            line.copy(allocationMethod = Method.RULE, allocationRule = rule, campaign = "")
        } else {
            val mine = myCampaign.takeIf { name -> campaigns.any { it.name == name && it.live } }
                ?: campaigns.filter { it.live && it.isClient }.singleOrNull()?.name
                ?: ""
            line.copy(allocationMethod = Method.DIRECT, allocationRule = "", campaign = mine)
        }
        return settle(ready, campaigns, rules)
    }

    /** Every paisa on the line has to be on a campaign. Nothing else will do. */
    fun addsUp(line: Line): Boolean =
        !line.allocated || line.allocations.sumOf { it.amountMinor } == line.amountMinor
}
