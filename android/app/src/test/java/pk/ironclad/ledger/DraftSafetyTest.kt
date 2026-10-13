package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme

/**
 * A half-written voucher is somebody's work. Nothing but Add or Discard may
 * throw it away — not a swipe while scrolling the categories, not a tap
 * outside, not the back button.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class DraftSafetyTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo
    private lateinit var vm: Vm

    private fun pump() {
        repeat(40) { shadowOf(Looper.getMainLooper()).idle(); compose.waitForIdle() }
    }

    private fun settle() {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.ready && repo.state.value.accounts.isNotEmpty()) return
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    /** An entry mid-flight: a category, some digits, a vendor. */
    private fun halfWritten() {
        vm.startEntry(Type.EXPENSE, askDate = true)
        vm.set { it.copy(datePickerOpen = false) }
        vm.editDraft { it.copy(line = Line(category = "Headsets"), vendor = "Shell Gulberg") }
        listOf("1", "8", "6", "0").forEach { vm.key(it) }
        shadowOf(Looper.getMainLooper()).idle()
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
    fun `asking the sheet to close keeps every word that was typed`() {
        halfWritten()
        vm.tryClose()
        shadowOf(Looper.getMainLooper()).idle()

        val draft = vm.ui.value.draft
        assertNotNull("the entry is still here", draft)
        assertEquals("the category", "Headsets", draft!!.line.category)
        assertEquals("the amount", 186000L, draft.calc.amountMinor)
        assertEquals("the vendor", "Shell Gulberg", draft.vendor)
        assertTrue("and it is asking what to do", vm.ui.value.confirmDiscard)
    }

    @Test
    fun `keep writing puts you back exactly where you were`() {
        halfWritten()
        vm.tryClose()
        vm.keepWriting()
        shadowOf(Looper.getMainLooper()).idle()

        assertFalse("the question is gone", vm.ui.value.confirmDiscard)
        val draft = vm.ui.value.draft!!
        assertEquals("Headsets", draft.line.category)
        assertEquals(186000L, draft.calc.amountMinor)
        assertEquals("Shell Gulberg", draft.vendor)
    }

    @Test
    fun `discard is the only thing that throws it away`() {
        halfWritten()
        vm.tryClose()
        vm.discardEntry()
        shadowOf(Looper.getMainLooper()).idle()

        assertNull("gone, because it was asked for", vm.ui.value.draft)
        assertFalse(vm.ui.value.confirmDiscard)
        assertEquals("and nothing was written to the book", 0, repo.state.value.entries.size)
    }

    @Test
    fun `an entry nobody has touched closes without a question`() {
        vm.startEntry(Type.EXPENSE, askDate = true)
        vm.set { it.copy(datePickerOpen = false) }
        vm.tryClose()
        shadowOf(Looper.getMainLooper()).idle()

        assertNull("no need to ask about an empty one", vm.ui.value.draft)
        assertFalse(vm.ui.value.confirmDiscard)
    }

    @Test
    fun `closing twice still does not lose it`() {
        halfWritten()
        vm.tryClose()
        vm.tryClose()
        vm.tryClose()
        shadowOf(Looper.getMainLooper()).idle()
        assertNotNull("three stray swipes, nothing lost", vm.ui.value.draft)
        assertEquals(186000L, vm.ui.value.draft!!.calc.amountMinor)
    }

    @Test
    fun `the details row opens the fields and keeps what is in them`() {
        halfWritten()
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.EntrySheet(vm, repo.state.value, vm.ui.value, vm.ui.value.draft!!)
            }
        }
        pump()

        compose.onNodeWithText("Paid to, bill no., note").performClick()
        pump()
        assertTrue("the fields opened", vm.ui.value.draft!!.more)

        compose.onNodeWithText("Paid to, bill no., note").performClick()
        pump()
        assertFalse("and fold away again", vm.ui.value.draft!!.more)
        assertEquals("with what was typed still there", "Shell Gulberg", vm.ui.value.draft!!.vendor)
    }

    @Test
    fun `the discard question offers both ways out`() {
        halfWritten()
        vm.tryClose()
        pump()
        compose.setContent { LedgerTheme { DiscardBar(vm) } }
        pump()
        compose.onNodeWithText("Throw this entry away?").performClick()
        compose.onNodeWithText("Keep writing").performClick()
        pump()
        assertFalse(vm.ui.value.confirmDiscard)
        assertNotNull("still writing", vm.ui.value.draft)
    }
}
