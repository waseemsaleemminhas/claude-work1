package pk.ironclad.ledger

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import android.os.Looper
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import pk.ironclad.ledger.data.Campaign
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Method
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type

/**
 * The app put through its paces for real: Room on disk, the repository, the view
 * model and the keypad, exactly as they run on a phone.
 */
@RunWith(RobolectricTestRunner::class)
class LedgerFlowTest {

    private lateinit var app: Application
    private lateinit var repo: Repo

    /** Lets the database threads and the main looper catch up, as a phone would. */
    private fun settle(until: (LedgerState) -> Boolean): LedgerState {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            val now = repo.state.value
            if (until(now)) return now
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
        throw AssertionError("the ledger never reached the state the test was waiting for")
    }

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
    }

    @After
    fun tearDown() = Repo.resetForTests()

    @Test
    fun `a fresh install seeds itself`() {
        val state = settle { it.ready && it.accounts.isNotEmpty() }
        assertEquals("the BPO chart of accounts", 48, state.categories.size)
        assertEquals("the three sharing rules", 3, state.rules.size)
        assertTrue("some accounts to spend from", state.accounts.isNotEmpty())
        assertTrue("somewhere to put company spending", state.campaigns.any { it.kind == "Internal" })
    }

    @Test
    fun `an expense is written, and the money comes off the account`() = runBlocking {
        settle { it.ready && it.accounts.isNotEmpty() }
        repo.saveCampaign(Campaign(id = "p1", name = "Medicare", seats = 10, agents = 9))
        val state = settle { it.campaigns.any { c -> c.name == "Medicare" } }

        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = state.accounts.first().name,
                lines = listOf(
                    Line(category = "Headsets", amountMinor = 125000,
                        allocationMethod = Method.DIRECT, campaign = "Medicare"),
                ),
            ),
        )

        val after = settle { it.entries.isNotEmpty() }
        val entry = after.entries.first()
        assertEquals(Status.RECORDED, entry.status)
        assertEquals(125000L, entry.totalMinor)
        assertEquals("the split was worked out on save", 125000L,
            entry.lines.first().allocations.sumOf { it.amountMinor })
        assertEquals("and the balance followed it", -125000L,
            after.accounts.first { it.name == state.accounts.first().name }.balanceMinor)
    }

    @Test
    fun `a line with no campaign is kept as a draft, and the money still moves`() = runBlocking {
        val state = settle { it.ready && it.accounts.isNotEmpty() }
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = state.accounts.first().name,
                lines = listOf(Line(category = "Courier", amountMinor = 50000, allocationMethod = Method.DIRECT)),
            ),
        )
        val after = settle { it.entries.isNotEmpty() }
        assertEquals(Status.DRAFT, after.entries.first().status)
        assertEquals(1, after.drafts.size)
        assertEquals("the money left the account anyway", -50000L,
            after.accounts.first { it.name == state.accounts.first().name }.balanceMinor)
    }

    @Test
    fun `the whole tap-tap flow through the view model`() = runBlocking {
        val vm = Vm(app)
        settle { it.ready && it.accounts.isNotEmpty() }
        repo.saveCampaign(Campaign(id = "p2", name = "Final Expense", seats = 20, agents = 18))
        val state = settle { it.campaigns.any { c -> c.name == "Final Expense" } }

        vm.setPref("me", "Ali")
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.me == "Ali" }

        // tap the category, punch in 1860, tap Add
        vm.startEntry(Type.EXPENSE, "Generator fuel")
        assertNotNull("the sheet opened", vm.ui.value.draft)
        assertEquals("a shared category fills its rule in by itself",
            Method.RULE, vm.ui.value.draft!!.line.allocationMethod)
        listOf("1", "8", "6", "0").forEach { vm.key(it) }
        assertEquals(186000L, vm.ui.value.draft!!.calc.amountMinor)
        vm.save()

        val after = settle { it.entries.isNotEmpty() }
        assertEquals("the sheet closed", null, vm.ui.value.draft)
        assertTrue("something was said about it", vm.ui.value.toast.isNotBlank())
        val entry = after.entries.first()
        assertEquals(186000L, entry.totalMinor)
        assertEquals("Ali", entry.enteredBy)
        assertEquals(Status.RECORDED, entry.status)
        assertTrue("it was shared over the campaigns", entry.lines.first().allocations.isNotEmpty())
    }

    @Test
    fun `the keypad adds up, and the first tap on a sum works it out`() = runBlocking {
        val vm = Vm(app)
        val state = settle { it.ready && it.accounts.isNotEmpty() }
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.myAccount.isNotBlank() }
        repo.saveCampaign(Campaign(id = "p3", name = "Solar", seats = 5, agents = 5))
        settle { it.campaigns.any { c -> c.name == "Solar" } }

        vm.startEntry(Type.EXPENSE, "Staff meals & tea")
        listOf("1", "0", "0").forEach { vm.key(it) }
        vm.operate('+')
        listOf("5", "0").forEach { vm.key(it) }
        vm.save()
        assertEquals("the first tap only works out the sum", 15000L, vm.ui.value.draft!!.calc.amountMinor)
        assertNotNull("and nothing was saved yet", vm.ui.value.draft)
        vm.save()
        val after = settle { it.entries.isNotEmpty() }
        assertEquals(15000L, after.entries.first().totalMinor)
    }

    @Test
    fun `saving with nothing in it complains instead of going quiet`() = runBlocking {
        val vm = Vm(app)
        settle { it.ready && it.accounts.isNotEmpty() }
        vm.startEntry(Type.EXPENSE)
        vm.save()
        assertTrue("it said something", vm.ui.value.toast.isNotBlank())
        assertNotNull("and kept the sheet open", vm.ui.value.draft)
        assertEquals("and wrote nothing", 0, repo.state.value.entries.size)
    }

    @Test
    fun `a second line goes on the same bill`() = runBlocking {
        val vm = Vm(app)
        val state = settle { it.ready && it.accounts.isNotEmpty() }
        repo.saveCampaign(Campaign(id = "p4", name = "Medicare", seats = 10, agents = 9))
        settle { it.campaigns.any { c -> c.name == "Medicare" } }
        vm.setPref("myAccount", state.accounts.first().name)
        vm.setPref("myCampaign", "Medicare")
        settle { it.prefs.myCampaign == "Medicare" }

        vm.startEntry(Type.EXPENSE, "Headsets")
        listOf("1", "2", "5", "0").forEach { vm.key(it) }
        vm.addLine()
        assertEquals("a second line opened", 2, vm.ui.value.draft!!.lines.size)
        vm.pickCategory("Peripherals")
        listOf("2", "4", "0").forEach { vm.key(it) }
        vm.save()

        val after = settle { it.entries.isNotEmpty() }
        val entry = after.entries.first()
        assertEquals("both lines are on the voucher", 2, entry.lines.size)
        assertEquals("and the total is the sum of them", 125000L + 24000L, entry.totalMinor)
    }

    @Test
    fun `voiding gives the money back and keeps the row`() = runBlocking {
        val vm = Vm(app)
        val state = settle { it.ready && it.accounts.isNotEmpty() }
        repo.saveCampaign(Campaign(id = "p5", name = "Medicare", seats = 10, agents = 9))
        settle { it.campaigns.any { c -> c.name == "Medicare" } }
        vm.setPref("myAccount", state.accounts.first().name)
        vm.setPref("myCampaign", "Medicare")
        settle { it.prefs.myCampaign == "Medicare" }

        vm.startEntry(Type.EXPENSE, "Courier")
        listOf("5", "0", "0").forEach { vm.key(it) }
        vm.save()
        val saved = settle { it.entries.isNotEmpty() }
        val account = saved.accounts.first { it.name == state.accounts.first().name }
        assertEquals(-50000L, account.balanceMinor)

        vm.openEntry(saved.entries.first())
        vm.voidEntry()
        assertTrue("the first tap only arms it", vm.ui.value.draft!!.armed)
        vm.voidEntry()
        val after = settle { it.entries.first().status == Status.VOID }
        assertEquals("the money came back", 0L,
            after.accounts.first { it.name == state.accounts.first().name }.balanceMinor)
        assertEquals("and the row is still there", 1, after.entries.size)
    }
}
