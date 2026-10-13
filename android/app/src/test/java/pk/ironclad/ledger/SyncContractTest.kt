package pk.ironclad.ledger

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.ironclad.ledger.data.Allocator
import pk.ironclad.ledger.data.Basis
import pk.ironclad.ledger.data.Method
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.SyncPull
import pk.ironclad.ledger.data.SyncPush
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Type

/**
 * The two halves have to agree about what a voucher looks like on the wire.
 * This parses a reply captured from the real Apps Script code, so the contract is
 * checked against what the server actually sends rather than what we hope it does.
 */
class SyncContractTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun captured(): String =
        javaClass.classLoader!!.getResourceAsStream("sync-response.json")!!
            .bufferedReader().use { it.readText() }

    @Test
    fun `a real reply from the sheet parses`() {
        val reply = json.decodeFromString(SyncPull.serializer(), captured())
        assertTrue(reply.ok)
        assertTrue("entries came down", reply.entries.isNotEmpty())
        assertEquals("the whole chart of accounts came down", 48, reply.categories.size)
        assertTrue("campaigns came down", reply.campaigns.size >= 3)
        assertEquals("the three allocation rules came down", 3, reply.rules.size)
        assertTrue("accounts came down", reply.accounts.isNotEmpty())
    }

    @Test
    fun `an entry off the wire keeps its line items and its campaign splits`() {
        val reply = json.decodeFromString(SyncPull.serializer(), captured())
        val entry = reply.entries.first { it.lines.isNotEmpty() }
        val line = entry.lines.first()
        assertTrue("the line carries an amount in paisa", line.amountMinor > 0)
        assertTrue("and a campaign split", line.allocations.isNotEmpty())
        assertEquals(
            "the split adds up to the line, to the paisa",
            line.amountMinor, line.allocations.sumOf { it.amountMinor },
        )
        assertTrue("every voucher total matches its lines", reply.entries.all { e ->
            e.type == Type.TRANSFER || e.lines.sumOf { it.amountMinor } == e.totalMinor
        })
    }

    @Test
    fun `a shared cost comes down marked as shared, not direct`() {
        val reply = json.decodeFromString(SyncPull.serializer(), captured())
        val shared = reply.entries.flatMap { it.lines }.firstOrNull { it.basis == Basis.APPORTIONED }
        assertTrue("there is an apportioned line in the sample", shared != null)
        assertEquals(Method.RULE, shared!!.allocationMethod)
        assertTrue("it names the rule it was split by", shared.allocationRule.isNotBlank())
        assertTrue("over more than one campaign", shared.allocations.size > 1)
    }

    @Test
    fun `what the phone sends serialises the way the server reads it`() {
        val push = SyncPush(
            code = "ABC123", device = "Ali", since = 0,
            entries = listOf(
                Entry(
                    id = "phone-1", date = "2026-10-12", type = Type.EXPENSE, status = Status.RECORDED,
                    totalMinor = 186000, account = "Petty cash", vendor = "Shell", enteredBy = "Ali",
                    lines = listOf(
                        Line(
                            no = 1, category = "Generator fuel", amountMinor = 186000,
                            allocationMethod = Method.RULE, allocationRule = "By seats",
                            basis = Basis.APPORTIONED,
                            allocations = Allocator.splitExact(
                                186000,
                                listOf(Allocator.Weight("Final Expense", 20.0), Allocator.Weight("Medicare", 10.0)),
                            ),
                        ),
                    ),
                ),
            ),
        )
        val text = json.encodeToString(SyncPush.serializer(), push)
        listOf("\"op\":\"sync\"", "\"amountMinor\"", "\"allocationRule\"", "\"campaign\"", "\"basis\"")
            .forEach { assertTrue("the wire text contains $it", text.contains(it)) }
        // and it survives the round trip back into our own types
        val back = json.decodeFromString(SyncPush.serializer(), text)
        assertEquals(186000L, back.entries.first().lines.first().allocations.sumOf { it.amountMinor })
    }

    @Test
    fun `balances are worked out the same way the sheet does`() {
        val reply = json.decodeFromString(SyncPull.serializer(), captured())
        val accounts = Repo.withBalances(reply.accounts, reply.entries)
        val spent = reply.entries
            .filter { it.status != Status.VOID && it.type == Type.EXPENSE }
            .sumOf { it.totalMinor }
        assertEquals(
            "everything held is the opening balances less what was spent",
            reply.accounts.sumOf { it.openingMinor } - spent,
            accounts.sumOf { it.balanceMinor },
        )
    }
}
