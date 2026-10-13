package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

/** The screens themselves, drawn and tapped. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class ScreenTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo
    private lateinit var vm: Vm

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
        vm = Vm(app)
        waitForLedger()
    }

    @After
    fun tearDown() = Repo.resetForTests()

    private fun waitForLedger() {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.ready && repo.state.value.accounts.isNotEmpty()) return
            Thread.sleep(25)
        }
    }

    private fun pump() {
        repeat(12) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            Thread.sleep(20)
        }
    }

    /**
     * Robolectric cannot aim a touch into the bottom sheet's own window, so taps on
     * anything inside it go through the click action the node publishes. Touches in
     * the main window are tapped for real.
     */
    private fun tapInSheet(label: String) {
        compose.onNodeWithText(label).performSemanticsAction(SemanticsActions.OnClick)
        pump()
    }

    private fun start() {
        compose.setContent { LedgerTheme { App(vm) } }
        pump()
    }

    @Test
    fun `the first screen carries the name and the website`() {
        start()
        compose.onNodeWithText("Ironclad Tech Ledger").assertIsDisplayed()
        compose.onNodeWithText("www.getironcladtech.com").assertExists()
        compose.onNodeWithText("Your name").performTextInput("Ali")
        pump()
        compose.onNodeWithText("Start").performClick()
        pump()
        assertEquals("Ali", repo.state.value.prefs.me)
    }

    @Test
    fun `the home screen draws the ledger`() {
        vm.setPref("me", "Ali")
        waitForLedger()
        start()
        compose.onNodeWithText("MONEY OUT").assertIsDisplayed()
        compose.onNodeWithText("Records").assertIsDisplayed()
        compose.onNodeWithText("Generator fuel").assertExists()
        compose.onNodeWithText("Money we hold").assertExists()
    }

    @Test
    fun `the home screen survives having spending on it`() {
        // The crash was here: category totals are Long and the empty fallback was an
        // Int, so sorting the grid blew up the moment one category had spending and
        // another did not — which is to say, right after the first entry was saved.
        vm.setPref("me", "Ali")
        waitForLedger()
        runBlocking {
            repo.save(
                Entry(
                    id = "", date = repo.today(), type = Type.EXPENSE,
                    account = repo.state.value.accounts.first().name,
                    lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
                ),
            )
        }
        waitForLedger()
        repeat(40) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(25) }
        assertEquals(1, repo.state.value.entries.size)

        start()

        compose.onNodeWithText("MONEY OUT").assertIsDisplayed()
        compose.onNodeWithText("Headsets").assertExists()
        compose.onNodeWithText("Records").assertIsDisplayed()
        assertTrue(
            "the amount is on the screen",
            compose.onAllNodesWithText("Rs 1,250", substring = true).fetchSemanticsNodes().isNotEmpty(),
        )
    }

    @Test
    fun `tapping a category, typing an amount and tapping Add writes the entry`() {
        vm.setPref("me", "Ali")
        waitForLedger()
        repo.state.value.accounts.firstOrNull()?.let { vm.setPref("myAccount", it.name) }
        waitForLedger()
        start()

        compose.onNodeWithText("Generator fuel").performClick()
        pump()
        listOf("1", "8", "6", "0").forEach { tapInSheet(it) }
        tapInSheet("Add expense")
        Thread.sleep(300)
        pump()

        val entries = repo.state.value.entries
        assertEquals("one voucher was written", 1, entries.size)
        assertEquals(186000L, entries.first().totalMinor)
        assertEquals("Generator fuel", entries.first().lines.single().category)
    }

    @Test
    fun `PKR OUT opens the keypad on today, with no calendar in the way`() {
        vm.setPref("me", "Ali")
        waitForLedger()
        start()
        compose.onNodeWithText("PKR OUT").performClick()
        pump()
        assertTrue("the entry is open", vm.ui.value.draft != null)
        assertFalse("and the calendar did not jump up", vm.ui.value.datePickerOpen)
        assertEquals("today is the day unless said otherwise", repo.today(), vm.ui.value.draft?.date)
        assertEquals("money out", Type.EXPENSE, vm.ui.value.draft?.type)

        // the chip is how you reach the calendar when the cost is being written up late
        tapInSheet("📅  Today")
        assertTrue("the date picker opened", vm.ui.value.datePickerOpen)
    }

    @Test
    fun `tapping Add with nothing in it says so rather than going quiet`() {
        vm.setPref("me", "Ali")
        waitForLedger()
        start()
        compose.onNodeWithText("PKR OUT").performClick()
        pump()
        tapInSheet("Add expense")
        assertTrue("it said something", vm.ui.value.toast.isNotBlank())
        assertEquals("and wrote nothing", 0, repo.state.value.entries.size)
        // and the words are inside the sheet, where they can actually be seen —
        // the sheet is its own window and covers anything drawn behind it
        assertTrue(
            "the words are inside the sheet",
            compose.onAllNodesWithText(vm.ui.value.toast, substring = true)
                .fetchSemanticsNodes().isNotEmpty(),
        )
    }
}
