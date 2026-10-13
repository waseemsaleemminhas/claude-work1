package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type

/**
 * The app put through its paces for real: Room on disk, the repository, the view
 * model and the keypad, exactly as they run on a phone. One book for the whole
 * company — a voucher is a category and an amount.
 */
@RunWith(RobolectricTestRunner::class)
class LedgerFlowTest {

    private lateinit var app: Application
    private lateinit var repo: Repo

    /** Lets the database threads and the main looper catch up, as a phone would. */
    private fun settle(until: (LedgerState) -> Boolean = { it.ready && it.accounts.isNotEmpty() }): LedgerState {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            val now = repo.state.value
            if (until(now)) return now
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
        val now = repo.state.value
        throw AssertionError(
            "the ledger never got there: ready=${now.ready} accounts=${now.accounts.size} " +
                "entries=${now.entries.size} me='${now.prefs.me}' myAccount='${now.prefs.myAccount}'",
        )
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
        val state = settle()
        assertEquals("the BPO chart of accounts", 48, state.categories.size)
        assertTrue("some accounts to spend from", state.accounts.isNotEmpty())
    }

    @Test
    fun `an expense is written, and the money comes off the account`() = runBlocking {
        val state = settle()
        val account = state.accounts.first().name
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = account,
                lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
            ),
        )
        val after = settle { it.entries.isNotEmpty() }
        val entry = after.entries.first()
        assertEquals(Status.RECORDED, entry.status)
        assertEquals(125000L, entry.totalMinor)
        assertEquals("the balance followed it", -125000L,
            after.accounts.first { it.name == account }.balanceMinor)
    }

    @Test
    fun `the whole tap-tap flow through the view model`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        vm.setPref("me", "Ali")
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.me == "Ali" && it.prefs.myAccount.isNotBlank() }

        vm.startEntry(Type.EXPENSE, "Generator fuel")
        assertNotNull("the sheet opened", vm.ui.value.draft)
        assertEquals("the category is already chosen", "Generator fuel", vm.ui.value.draft!!.line.category)
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
        assertEquals("Generator fuel", entry.lines.single().category)
    }

    @Test
    fun `the date can be set to a day gone by`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.myAccount.isNotBlank() }

        vm.startEntry(Type.EXPENSE, "Courier")
        vm.setDate("2026-10-01")
        assertEquals("2026-10-01", vm.ui.value.draft!!.date)
        assertEquals("the picker closes behind it", false, vm.ui.value.datePickerOpen)
        listOf("5", "0", "0").forEach { vm.key(it) }
        vm.save()

        val after = settle { it.entries.isNotEmpty() }
        assertEquals("the voucher keeps that date", "2026-10-01", after.entries.first().date)
    }

    @Test
    fun `the keypad adds up, and the first tap on a sum works it out`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.myAccount.isNotBlank() }

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
        settle()
        vm.startEntry(Type.EXPENSE)
        vm.save()
        assertTrue("it said something", vm.ui.value.toast.isNotBlank())
        assertNotNull("and kept the sheet open", vm.ui.value.draft)
        assertEquals("and wrote nothing", 0, repo.state.value.entries.size)
    }

    @Test
    fun `a payment in is recorded against the account it landed in`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        val account = state.accounts.first().name
        vm.setPref("myAccount", account)
        settle { it.prefs.myAccount.isNotBlank() }

        vm.startEntry(Type.INCOME, "Client payment")
        listOf("5", "0", "0", "0", "0").forEach { vm.key(it) }
        vm.save()
        val after = settle { it.entries.isNotEmpty() }
        assertEquals(Type.INCOME, after.entries.first().type)
        assertEquals(5000000L, after.accounts.first { it.name == account }.balanceMinor)
    }

    @Test
    fun `voiding gives the money back and keeps the row`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        val account = state.accounts.first().name
        vm.setPref("myAccount", account)
        settle { it.prefs.myAccount.isNotBlank() }

        vm.startEntry(Type.EXPENSE, "Courier")
        listOf("5", "0", "0").forEach { vm.key(it) }
        vm.save()
        val saved = settle { it.entries.isNotEmpty() }
        assertEquals(-50000L, saved.accounts.first { it.name == account }.balanceMinor)

        vm.openEntry(saved.entries.first())
        vm.voidEntry()
        assertTrue("the first tap only arms it", vm.ui.value.draft!!.armed)
        vm.voidEntry()
        val after = settle { it.entries.first().status == Status.VOID }
        assertEquals("the money came back", 0L,
            after.accounts.first { it.name == account }.balanceMinor)
        assertEquals("and the row is still there", 1, after.entries.size)
    }

    @Test
    fun `an entry can be opened again and changed`() = runBlocking {
        val vm = Vm(app)
        val state = settle()
        vm.setPref("myAccount", state.accounts.first().name)
        settle { it.prefs.myAccount.isNotBlank() }

        vm.startEntry(Type.EXPENSE, "Courier")
        listOf("5", "0", "0").forEach { vm.key(it) }
        vm.save()
        val saved = settle { it.entries.isNotEmpty() }

        vm.openEntry(saved.entries.first())
        assertEquals("the amount comes back into the keypad", 50000L, vm.ui.value.draft!!.calc.amountMinor)
        vm.pickCategory("Printing & stationery")
        vm.save()
        val after = settle { it.entries.first().lines.first().category == "Printing & stationery" }
        assertEquals("still one voucher", 1, after.entries.size)
        assertEquals(50000L, after.entries.first().totalMinor)
    }
}
