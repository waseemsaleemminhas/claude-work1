package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import pk.ironclad.ledger.data.Campaign
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.EntrySheet
import pk.ironclad.ledger.ui.LedgerTheme

/**
 * The same sheet, drawn in the ordinary window instead of inside a bottom-sheet
 * dialog. Robolectric cannot aim a touch into a dialog window; this says whether
 * the taps themselves are wired up.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class SheetTouchTest {

    @get:Rule val compose = createComposeRule()

    @Test
    fun `tapping the keypad and Add really does write the voucher`() {
        Repo.resetForTests()
        val app: Application = ApplicationProvider.getApplicationContext()
        val repo = Repo.get(app)
        val vm = Vm(app)
        settle(repo)
        runBlocking { repo.saveCampaign(Campaign(id = "p1", name = "Medicare", seats = 10, agents = 9)) }
        vm.setPref("me", "Ali")
        vm.setPref("myAccount", repo.state.value.accounts.first().name)
        vm.setPref("myCampaign", "Medicare")
        // wait for all of that to actually be in the ledger before opening the sheet
        settleUntil(repo) {
            it.campaigns.any { c -> c.name == "Medicare" } && it.prefs.myCampaign == "Medicare"
        }

        vm.startEntry(Type.EXPENSE, "Headsets")

        compose.setContent {
            LedgerTheme {
                val state by vm.ledger.collectAsState()
                val ui by vm.ui.collectAsState()
                ui.draft?.let { EntrySheet(vm, state, ui, it) }
            }
        }
        compose.waitForIdle()

        listOf("1", "2", "5", "0").forEach {
            compose.onNodeWithText(it).performClick()
            compose.waitForIdle()
        }
        assertEquals("the keypad took the digits", "1250", vm.ui.value.draft?.calc?.cur)

        compose.onNodeWithText("Add expense").performClick()
        compose.waitForIdle()
        repeat(40) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(25) }

        val entries = repo.state.value.entries
        assertEquals("a voucher was written", 1, entries.size)
        assertEquals(125000L, entries.first().totalMinor)
        assertTrue("with its campaign", entries.first().lines.first().allocations.isNotEmpty())
        Repo.resetForTests()
    }

    private fun settle(repo: Repo) =
        settleUntil(repo) { it.ready && it.accounts.isNotEmpty() }

    private fun settleUntil(repo: Repo, until: (pk.ironclad.ledger.data.LedgerState) -> Boolean) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until(repo.state.value)) return
            Thread.sleep(25)
        }
        throw AssertionError("the ledger never reached the state the test was waiting for")
    }
}
