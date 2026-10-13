package pk.ironclad.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.ironclad.ledger.data.Allocation
import pk.ironclad.ledger.data.Allocator
import pk.ironclad.ledger.data.Allocator.Weight
import pk.ironclad.ledger.data.Basis
import pk.ironclad.ledger.data.Campaign
import pk.ironclad.ledger.data.Category
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Method
import pk.ironclad.ledger.data.Money
import pk.ironclad.ledger.data.Rule

class AllocatorTest {

    private val campaigns = listOf(
        Campaign(id = "p1", name = "Final Expense", seats = 20, agents = 18),
        Campaign(id = "p2", name = "Medicare", seats = 10, agents = 9),
        Campaign(id = "p3", name = "Solar", seats = 10, agents = 8),
        Campaign(id = "p4", name = "Internal", kind = "Internal", seats = 0, agents = 0),
        Campaign(id = "p5", name = "Old thing", status = "Closed", seats = 50, agents = 50),
    )
    private val rules = listOf(
        Rule(id = "r1", name = "By seats", method = "Seats"),
        Rule(id = "r2", name = "By agents", method = "Agents"),
        Rule(id = "r3", name = "Equal split", method = "Equal"),
    )

    @Test
    fun `a three way split keeps every paisa`() {
        val parts = Allocator.splitExact(10000, listOf(Weight("a", 1.0), Weight("b", 1.0), Weight("c", 1.0)))
        assertEquals(listOf(3334L, 3333L, 3333L), parts.map { it.amountMinor })
        assertEquals(10000L, parts.sumOf { it.amountMinor })
    }

    @Test
    fun `the spare paisa goes by campaign name, so every device agrees`() {
        val one = Allocator.splitExact(10000, listOf(Weight("zebra", 1.0), Weight("apple", 1.0), Weight("mango", 1.0)))
        val two = Allocator.splitExact(10000, listOf(Weight("mango", 1.0), Weight("zebra", 1.0), Weight("apple", 1.0)))
        assertEquals(3334L, one.first { it.campaign == "apple" }.amountMinor)
        assertEquals(
            one.sortedBy { it.campaign }.map { it.campaign to it.amountMinor },
            two.sortedBy { it.campaign }.map { it.campaign to it.amountMinor },
        )
    }

    @Test
    fun `awkward amounts still add back to the whole`() {
        listOf(1L, 7L, 99L, 100L, 1860000L, 33333L, 999999999L).forEach { amount ->
            listOf(2, 3, 5, 7).forEach { n ->
                val weights = (1..n).map { Weight("c$it", it.toDouble()) }
                val parts = Allocator.splitExact(amount, weights)
                assertEquals("amount $amount over $n", amount, parts.sumOf { it.amountMinor })
            }
        }
    }

    @Test
    fun `nothing to share means nothing is made up`() {
        assertTrue(Allocator.splitExact(5000, emptyList()).isEmpty())
        assertTrue(Allocator.splitExact(0, listOf(Weight("a", 1.0))).isEmpty())
        assertTrue(Allocator.splitExact(5000, listOf(Weight("a", 0.0))).isEmpty())
    }

    @Test
    fun `by seats shares a generator bill the way the floor is filled`() {
        val line = Line(category = "Generator fuel", amountMinor = 1860000, allocationMethod = Method.RULE, allocationRule = "By seats")
        val settled = Allocator.settle(line, campaigns, rules)
        assertEquals(3, settled.allocations.size)
        assertEquals(930000L, settled.allocations.first { it.campaign == "Final Expense" }.amountMinor)
        assertEquals(465000L, settled.allocations.first { it.campaign == "Medicare" }.amountMinor)
        assertEquals(1860000L, settled.allocations.sumOf { it.amountMinor })
        assertEquals(Basis.APPORTIONED, settled.basis)
    }

    @Test
    fun `closed and internal campaigns take no share of the overhead`() {
        val line = Line(amountMinor = 100000, allocationMethod = Method.RULE, allocationRule = "Equal split")
        val settled = Allocator.settle(line, campaigns, rules)
        assertEquals(listOf("Final Expense", "Medicare", "Solar"), settled.allocations.map { it.campaign }.sorted().sorted())
        assertTrue(settled.allocations.none { it.campaign == "Internal" || it.campaign == "Old thing" })
    }

    @Test
    fun `a direct cost belongs to one campaign`() {
        val line = Line(amountMinor = 125000, allocationMethod = Method.DIRECT, campaign = "Medicare")
        val settled = Allocator.settle(line, campaigns, rules)
        assertEquals(listOf(Allocation("Medicare", 10000, 125000)), settled.allocations)
        assertEquals(Basis.DIRECT, settled.basis)
    }

    @Test
    fun `a custom split is scaled to the line, not taken on trust`() {
        val line = Line(
            amountMinor = 24000, allocationMethod = Method.SPLIT,
            allocations = listOf(Allocation("Medicare", 5000, 0), Allocation("Solar", 5000, 0)),
        )
        val settled = Allocator.settle(line, campaigns, rules)
        assertEquals(24000L, settled.allocations.sumOf { it.amountMinor })
        assertEquals(12000L, settled.allocations.first { it.campaign == "Medicare" }.amountMinor)
    }

    @Test
    fun `a line with no campaign settles to nothing, so it becomes a draft`() {
        val line = Line(amountMinor = 50000, allocationMethod = Method.DIRECT, campaign = "")
        assertTrue(Allocator.settle(line, campaigns, rules).allocations.isEmpty())
        val unknown = Line(amountMinor = 50000, allocationMethod = Method.RULE, allocationRule = "By moonlight")
        assertTrue(Allocator.settle(unknown, campaigns, rules).allocations.isEmpty())
    }

    @Test
    fun `a category that shares itself out needs no taps`() {
        val category = Category(id = "c1", name = "Electricity", rule = "By seats")
        val line = Allocator.preset(Line(category = "Electricity", amountMinor = 40000), category, "", campaigns, rules)
        assertEquals(Method.RULE, line.allocationMethod)
        assertEquals(3, line.allocations.size)
    }

    @Test
    fun `a category without a rule falls back to the person's own campaign`() {
        val category = Category(id = "c2", name = "Headsets")
        val line = Allocator.preset(Line(category = "Headsets", amountMinor = 40000), category, "Medicare", campaigns, rules)
        assertEquals(Method.DIRECT, line.allocationMethod)
        assertEquals("Medicare", line.campaign)
        assertEquals(40000L, line.allocations.single().amountMinor)
    }

    @Test
    fun `money reads the way a rupee should`() {
        assertEquals("Rs 1,860", Money.format(186000))
        assertEquals("Rs 0", Money.format(0))
        assertEquals("-Rs 1,234", Money.format(-123400))
        assertEquals("Rs 1,234.56", Money.format(123456, decimals = 2))
        // three-digit grouping, to match the number format the sheet exports with
        assertEquals("Rs 1,234,567", Money.format(123456700))
        assertEquals(123450L, Money.parse("1234.50"))
        assertEquals(0L, Money.parse("nonsense"))
    }
}
