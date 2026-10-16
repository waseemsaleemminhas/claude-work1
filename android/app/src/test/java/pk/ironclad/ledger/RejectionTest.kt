package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
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
import pk.ironclad.ledger.data.Sync
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme

/**
 * When the book turns an entry down it says why. Showing the count and
 * swallowing the reason leaves somebody staring at a number.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class RejectionTest {

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
    fun `the reason is carried through, not just the count`() {
        val note = Sync.rejectionNote(mapOf("e1" to "Line 1: pick a category."))
        assertEquals("1 entry turned down — Line 1: pick a category.", note)
    }

    @Test
    fun `two entries stopped by the same thing say it once`() {
        val note = Sync.rejectionNote(
            mapOf("e1" to "Line 1: pick a category.", "e2" to "Line 1: pick a category."),
        )
        assertEquals("2 entries turned down — Line 1: pick a category.", note)
        assertEquals("said once", 1, Regex("pick a category").findAll(note).count())
    }

    @Test
    fun `different reasons are both shown`() {
        val note = Sync.rejectionNote(
            mapOf("e1" to "That date is in the future.", "e2" to "\"Anas\" is an income category."),
        )
        assertTrue(note.contains("That date is in the future."))
        assertTrue(note.contains("is an income category."))
        assertTrue(note.startsWith("2 entries turned down"))
    }

    @Test
    fun `a refusal with no words still says something`() {
        assertEquals("1 entry turned down, with no reason given.", Sync.rejectionNote(mapOf("e1" to "")))
    }

    @Test
    fun `nothing refused, nothing said`() {
        assertEquals("", Sync.rejectionNote(emptyMap()))
    }

    @Test
    fun `an entry that has not gone up yet is known to be waiting`() = runBlocking {
        settle()
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
            ),
        )
        settle { repo.state.value.entries.isNotEmpty() }
        val entry = repo.state.value.entries.first()
        assertTrue("saved but not yet sent", entry.id in repo.state.value.unsent)

        repo.markSynced(listOf(entry.id))
        settle { repo.state.value.unsent.isEmpty() }
        assertTrue("once the book has it, it is not waiting", repo.state.value.unsent.isEmpty())
    }

    @Test
    fun `the row says it is waiting, and says the reason once there is one`() = runBlocking {
        settle()
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
            ),
        )
        settle { repo.state.value.entries.isNotEmpty() }
        val entry = repo.state.value.entries.first()

        // collected, as the app collects it — a snapshot would never redraw,
        // which is exactly the bug this is here to catch
        compose.setContent {
            val ui by vm.ui.collectAsState()
            val state by vm.ledger.collectAsState()
            LedgerTheme { pk.ironclad.ledger.ui.EntryRow(vm, state, ui, entry) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("waiting", substring = true).assertExists()

        // what the view model does when a sync comes back with a refusal
        vm.set { it.copy(refused = mapOf(entry.id to "Line 1: pick a category.")) }
        shadowOf(Looper.getMainLooper()).idle()
        compose.waitForIdle()
        compose.onNodeWithText("not accepted", substring = true).assertExists()
        compose.onNodeWithText("pick a category", substring = true).assertExists()
        Unit
    }
}
