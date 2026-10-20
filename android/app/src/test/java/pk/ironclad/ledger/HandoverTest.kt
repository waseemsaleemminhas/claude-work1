package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import pk.ironclad.ledger.data.Account
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.handoverPair
import pk.ironclad.ledger.ui.runningBalances

/**
 * Two people keeping one book: cash crossing between them, and what each of
 * them was left holding after every voucher.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class HandoverTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo
    private lateinit var vm: Vm

    private fun settle(until: () -> Boolean = { repo.state.value.ready && repo.state.value.accounts.isNotEmpty() }) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until()) return
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    /** The book as it really is: Waseem holding Rs 15,000, Anas Rs 20,500. */
    private suspend fun twoPeople() {
        repo.acceptFromServer(
            emptyList(), emptyList(),
            listOf(
                Account(id = "acash-w", name = "Cash — Waseem", kind = "Cash", heldBy = "Waseem",
                    openingMinor = 1_500_000, colour = "#43A047"),
                Account(id = "acash-a", name = "Cash — Anas", kind = "Cash", heldBy = "Anas",
                    openingMinor = 2_050_000, colour = "#1E88E5"),
            ) + repo.state.value.accounts.filter { it.id.startsWith("acct-") }
                .map { Account(id = it.id, name = it.name, kind = it.kind, archived = true) },
        )
        settle { repo.state.value.liveAccounts.size == 2 }
        repo.setPref("myAccount", "Cash — Waseem")
        settle { repo.state.value.prefs.myAccount == "Cash — Waseem" }
    }

    private suspend fun put(entry: Entry) {
        val before = repo.state.value.entries.size
        repo.save(entry)
        settle { repo.state.value.entries.size > before }
    }

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
        vm = Vm(app)
        settle()
    }

    @After
    fun tearDown() = Repo.resetForTests()

    // ---- the balance after each voucher

    @Test
    fun `each voucher carries what its account held afterwards`() = runBlocking {
        settle()
        twoPeople()
        put(Entry(id = "e1", date = "2026-10-01", type = Type.EXPENSE, at = 1,
            account = "Cash — Anas", totalMinor = 50_000,
            lines = listOf(Line(category = "Water", amountMinor = 50_000))))
        put(Entry(id = "e2", date = "2026-10-02", type = Type.TRANSFER, at = 2,
            account = "Cash — Waseem", toAccount = "Cash — Anas", totalMinor = 1_000_000))
        put(Entry(id = "e3", date = "2026-10-03", type = Type.EXPENSE, at = 3,
            account = "Cash — Anas", totalMinor = 200_000,
            lines = listOf(Line(category = "Water", amountMinor = 200_000))))

        val after = runningBalances(repo.state.value)
        // Anas: 20,500 − 500 = 20,000
        assertEquals(2_000_000L, after["e1"])
        // the move leaves Waseem: 15,000 − 10,000 = 5,000
        assertEquals(500_000L, after["e2"])
        // Anas: 20,000 + 10,000 − 2,000 = 28,000
        assertEquals(2_800_000L, after["e3"])
        // and the running figure ends where Money we hold says it does
        assertEquals(
            repo.state.value.account("Cash — Anas")!!.balanceMinor,
            after["e3"],
        )
        Unit
    }

    @Test
    fun `a voided voucher is left out of the running figure`() = runBlocking {
        settle()
        twoPeople()
        put(Entry(id = "v1", date = "2026-10-01", type = Type.EXPENSE, at = 1,
            account = "Cash — Anas", totalMinor = 50_000,
            lines = listOf(Line(category = "Water", amountMinor = 50_000))))
        put(Entry(id = "v2", date = "2026-10-02", type = Type.EXPENSE, at = 2,
            account = "Cash — Anas", totalMinor = 30_000,
            lines = listOf(Line(category = "Water", amountMinor = 30_000))))
        repo.void("v1")
        settle { repo.state.value.entries.none { it.id == "v1" && it.status != pk.ironclad.ledger.data.Status.VOID } }

        val after = runningBalances(repo.state.value)
        assertNull("a voided voucher has no balance of its own", after["v1"])
        // 20,500 − 300, the 500 never having happened
        assertEquals(2_020_000L, after["v2"])
        Unit
    }

    @Test
    fun `the figure is the whole book, not the days on screen`() = runBlocking {
        settle()
        twoPeople()
        put(Entry(id = "old", date = "2026-09-20", type = Type.EXPENSE, at = 1,
            account = "Cash — Anas", totalMinor = 500_000,
            lines = listOf(Line(category = "Water", amountMinor = 500_000))))
        put(Entry(id = "now", date = "2026-10-20", type = Type.EXPENSE, at = 2,
            account = "Cash — Anas", totalMinor = 100_000,
            lines = listOf(Line(category = "Water", amountMinor = 100_000))))

        // October's voucher counts September's against it: 20,500 − 5,000 − 1,000
        assertEquals(1_450_000L, runningBalances(repo.state.value)["now"])
        Unit
    }

    @Test
    fun `an account the book does not know gets no figure`() = runBlocking {
        settle()
        twoPeople()
        put(Entry(id = "stray", date = "2026-10-01", type = Type.EXPENSE, at = 1,
            account = "Somebody else's pocket", totalMinor = 50_000,
            lines = listOf(Line(category = "Water", amountMinor = 50_000))))
        assertNull(runningBalances(repo.state.value)["stray"])
        Unit
    }

    @Test
    fun `records shows the balance beside the account it belongs to`() = runBlocking {
        settle()
        twoPeople()
        put(Entry(id = "r1", date = repo.today(), type = Type.EXPENSE, at = 1,
            account = "Cash — Anas", totalMinor = 50_000,
            lines = listOf(Line(category = "Water", amountMinor = 50_000))))
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.RecordsScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Cash — Anas ▸ Rs 20,000", substring = true).assertExists()
        Unit
    }

    // ---- handing cash over

    @Test
    fun `the offer runs out of mine into theirs`() = runBlocking {
        settle()
        twoPeople()
        val pair = handoverPair(repo.state.value)
        assertNotNull(pair)
        assertEquals("Cash — Waseem", pair!!.first.name)
        assertEquals("Cash — Anas", pair.second.name)
        Unit
    }

    @Test
    fun `one account alone has nobody to hand anything to`() {
        settle()
        val one = repo.state.value.copy(
            accounts = listOf(Account(id = "a", name = "Petty cash", kind = "Cash")),
        )
        assertNull(handoverPair(one))
    }

    @Test
    fun `nothing is offered until the app knows which money is mine`() = runBlocking {
        settle()
        twoPeople()
        repo.setPref("myAccount", "")
        settle { repo.state.value.prefs.myAccount.isBlank() }
        // rather than guess a direction and write the handover backwards
        assertNull(handoverPair(repo.state.value))
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onAllNodesWithText("Hand cash", substring = true).fetchSemanticsNodes().let {
            assertTrue("no offer at all", it.isEmpty())
        }
        Unit
    }

    @Test
    fun `handing cash over opens a move with both ends filled in`() = runBlocking {
        settle()
        twoPeople()
        vm.handCashOver("Cash — Waseem", "Cash — Anas")
        shadowOf(Looper.getMainLooper()).idle()
        val draft = vm.ui.value.draft
        assertNotNull("a move opened", draft)
        assertEquals(Type.TRANSFER, draft!!.type)
        assertEquals("Cash — Waseem", draft.account)
        assertEquals("Cash — Anas", draft.toAccount)
        Unit
    }

    @Test
    fun `the pill sits on money we hold and starts the move`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Hand cash to Anas").assertExists()
        compose.onNodeWithText("Hand cash to Anas").performClick()
        compose.waitForIdle()
        val draft = vm.ui.value.draft
        assertNotNull("a move opened", draft)
        assertEquals(Type.TRANSFER, draft!!.type)
        assertEquals("Cash — Waseem", draft.account)
        assertEquals("Cash — Anas", draft.toAccount)
        Unit
    }

    @Test
    fun `home carries the same offer between the two of them`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.HomeScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Hand cash to Anas").assertExists()
        Unit
    }

    // ---- the notes people hand over

    @Test
    fun `the quick amounts add up`() = runBlocking {
        settle()
        vm.startEntry(Type.EXPENSE)
        shadowOf(Looper.getMainLooper()).idle()

        vm.bump(500)
        assertEquals(50_000L, vm.ui.value.draft!!.calc.amountMinor)
        vm.bump(1000)
        assertEquals("they add to what is already there", 150_000L, vm.ui.value.draft!!.calc.amountMinor)
        vm.bump(100)
        assertEquals(160_000L, vm.ui.value.draft!!.calc.amountMinor)
        Unit
    }

    @Test
    fun `a quick amount settles a sum left part-way through`() = runBlocking {
        settle()
        vm.startEntry(Type.EXPENSE)
        shadowOf(Looper.getMainLooper()).idle()

        // 150 × 2 still hanging, then +100 — the sum is worked out first
        vm.key("1"); vm.key("5"); vm.key("0")
        vm.operate('*')
        vm.key("2")
        vm.bump(100)
        assertEquals(40_000L, vm.ui.value.draft!!.calc.amountMinor)
        assertNull("nothing left hanging", vm.ui.value.draft!!.calc.op)
        Unit
    }

    @Test
    fun `the quick amounts are on the entry sheet, grouped like the figure above them`() = runBlocking {
        settle()
        vm.startEntry(Type.EXPENSE)
        shadowOf(Looper.getMainLooper()).idle()
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.EntrySheet(vm, repo.state.value, vm.ui.value, vm.ui.value.draft!!)
            }
        }
        compose.waitForIdle()
        listOf("+100", "+500", "+1,000", "+5,000").forEach {
            compose.onNodeWithText(it).assertExists()
        }
        compose.onNodeWithText("+5,000").performClick()
        compose.waitForIdle()
        assertEquals(500_000L, vm.ui.value.draft!!.calc.amountMinor)
        Unit
    }
}
