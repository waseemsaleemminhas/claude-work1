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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.totalsOf
import pk.ironclad.ledger.ui.visibleEntries

/**
 * Two people keeping one book: every voucher says whose it is, and Records
 * can be narrowed to one of them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class PeopleTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo
    private lateinit var vm: Vm

    private fun settle() {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.ready && repo.state.value.accounts.isNotEmpty()) return
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    /** The phone stamps its owner's name on what it saves, so become them first. */
    private fun beName(person: String) {
        vm.setPref("me", person)
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.prefs.me == person) return
            Thread.sleep(25)
        }
        throw AssertionError("the name never took: '" + repo.state.value.prefs.me + "'")
    }

    private suspend fun saveAs(person: String, amount: Long, category: String) {
        beName(person)
        val before = repo.state.value.entries.size
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = category, amountMinor = amount)),
            ),
        )
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.entries.size > before) return
            Thread.sleep(25)
        }
        throw AssertionError("the entry never landed")
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

    @Test
    fun `an entry keeps the name of whoever wrote it`() = runBlocking {
        settle()
        saveAs("Anas", 125000, "Headsets")
        assertEquals("Anas", repo.state.value.entries.first().enteredBy)
    }

    @Test
    fun `the record row shows who it was`() = runBlocking {
        settle()
        saveAs("Anas", 125000, "Headsets")
        val entry = repo.state.value.entries.first()
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.EntryRow(vm, repo.state.value, vm.ui.value, entry)
            }
        }
        compose.waitForIdle()
        // the name is there whether or not the entry has reached the book yet
        compose.onNodeWithText("Anas", substring = true).assertExists()
        compose.onNodeWithText("Headsets").assertExists()
        Unit
    }

    @Test
    fun `narrowing to one person leaves only their entries`() = runBlocking {
        settle()
        saveAs("Anas", 125000, "Headsets")
        saveAs("Waseem", 75000, "Overtime")
        saveAs("Anas", 50000, "Water")

        vm.showWho("Anas")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("Anas", vm.ui.value.who)

        val all = visibleEntries(repo.state.value, vm.ui.value)
        val theirs = all.filter { it.enteredBy == "Anas" }
        assertEquals("two of the three are his", 2, theirs.size)
        assertEquals("and they add up to his spend", 175000L, totalsOf(theirs).outMinor)
        assertEquals("the other one is not", 75000L, totalsOf(all.filter { it.enteredBy == "Waseem" }).outMinor)
    }

    @Test
    fun `tapping the same person again shows everybody`() {
        vm.showWho("Anas")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("Anas", vm.ui.value.who)
        vm.showWho("Anas")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("", vm.ui.value.who)
    }

    @Test
    fun `the people chips carry each person's spend`() = runBlocking {
        settle()
        saveAs("Anas", 125000, "Headsets")
        saveAs("Waseem", 75000, "Overtime")
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.RecordsScreen(vm, repo.state.value, vm.ui.value)
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Everyone").assertExists()
        // the name shows twice over: on the chip at the top, and on his own row
        assertEquals("on the chip and on the row", 2,
            compose.onAllNodesWithText("Anas", substring = true).fetchSemanticsNodes().size)
        assertEquals(2, compose.onAllNodesWithText("Waseem", substring = true).fetchSemanticsNodes().size)

        // the chip is the first of them, at the top of the screen
        compose.onAllNodesWithText("Anas", substring = true)[0].performClick()
        compose.waitForIdle()
        assertEquals("tapping a chip narrows to that person", "Anas", vm.ui.value.who)
    }

    @Test
    fun `an account held by a person is how the book says who paid`() = runBlocking {
        settle()
        beName("Anas")
        // the sheet route: a cash account per person, so "who paid" is a balance
        repo.saveAccount(
            pk.ironclad.ledger.data.Account(
                id = "acct-cash-anas", name = "Cash — Anas", kind = "Cash", heldBy = "Anas",
                openingMinor = 500000,
            ),
        )
        settle()
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Cash — Anas",
                lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
            ),
        )
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.entries.isNotEmpty()) return@repeat
            Thread.sleep(25)
        }
        val his = repo.state.value.accounts.first { it.name == "Cash — Anas" }
        assertEquals("what he is still carrying", 375000L, his.balanceMinor)
        assertTrue("and the book knows whose it is", his.heldBy == "Anas")
    }
}
