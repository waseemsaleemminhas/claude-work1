package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.dayOffered
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Tapping − or + asks the day first, on today, because a cost is often
 * written up after the fact. Cancel keeps today; an earlier day sticks.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class BackdateTest {

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
    fun `tapping minus asks the day first, already on today`() {
        vm.startEntry(Type.EXPENSE, askDate = true)
        shadowOf(Looper.getMainLooper()).idle()
        val ui = vm.ui.value
        assertTrue("the calendar is up", ui.datePickerOpen)
        assertEquals("on today, so the usual case is one tap", repo.today(), ui.draft?.date)
        assertEquals("and it is still an expense", Type.EXPENSE, ui.draft?.type)
    }

    @Test
    fun `an earlier day sticks, and goes on the voucher`() = runBlocking {
        vm.startEntry(Type.EXPENSE, askDate = true)
        val threeDaysBack = LocalDate.parse(repo.today()).minusDays(3).toString()
        vm.setDate(threeDaysBack)
        shadowOf(Looper.getMainLooper()).idle()

        assertFalse("the calendar closes once a day is chosen", vm.ui.value.datePickerOpen)
        assertEquals(threeDaysBack, vm.ui.value.draft?.date)

        vm.editDraft { it.copy(line = Line(category = "Headsets")) }
        listOf("1", "2", "5", "0").forEach { vm.key(it) }   // the keypad is where the amount lives
        vm.save()
        var written = repo.state.value.entries.firstOrNull()
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            written = repo.state.value.entries.firstOrNull()
            if (written != null) return@repeat
            Thread.sleep(25)
        }
        val entry = written ?: throw AssertionError("the voucher was never written: " + vm.ui.value.toast)
        assertEquals("the voucher carries the day that was chosen", threeDaysBack, entry.date)
        assertEquals(125000L, entry.totalMinor)
        assertEquals(Status.RECORDED, entry.status)
    }

    @Test
    fun `backing out of the calendar keeps today and leaves the keypad open`() {
        vm.startEntry(Type.INCOME, askDate = true)
        vm.set { it.copy(datePickerOpen = false) }
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(vm.ui.value.datePickerOpen)
        assertEquals("still today", repo.today(), vm.ui.value.draft?.date)
        assertTrue("and the entry is still being written", vm.ui.value.draft != null)
    }

    @Test
    fun `the date chip in the sheet still opens the calendar for a second thought`() {
        vm.startEntry(Type.EXPENSE, askDate = true)
        vm.set { it.copy(datePickerOpen = false) }
        shadowOf(Looper.getMainLooper()).idle()
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.EntrySheet(vm, repo.state.value, vm.ui.value, vm.ui.value.draft!!)
            }
        }
        compose.onNodeWithText("📅  Today").performClick()
        compose.waitForIdle()
        assertTrue("the calendar comes back", vm.ui.value.datePickerOpen)
    }

    @Test
    fun `the calendar offers the past freely and stops at tomorrow`() {
        val today = LocalDate.parse(repo.today())
        fun day(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

        assertTrue("today", dayOffered(day(today), today))
        assertTrue("yesterday", dayOffered(day(today.minusDays(1)), today))
        assertTrue("a bill from last month", dayOffered(day(today.minusMonths(1)), today))
        assertTrue("and one from last year", dayOffered(day(today.minusYears(1)), today))
        assertTrue("tomorrow, which the sheet still takes", dayOffered(day(today.plusDays(1)), today))
        assertFalse("but not the day after", dayOffered(day(today.plusDays(2)), today))
        assertFalse("and not next month", dayOffered(day(today.plusMonths(1)), today))
    }
}
