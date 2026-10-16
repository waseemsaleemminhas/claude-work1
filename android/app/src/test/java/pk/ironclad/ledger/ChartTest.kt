package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
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
import pk.ironclad.ledger.ui.InOutBar
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.RingLabels
import pk.ironclad.ledger.ui.Slice
import pk.ironclad.ledger.ui.sliceAt

/** The ring answers when you tap it, and the labels say what the colours mean. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class ChartTest {

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

    private val quarters = listOf(
        Slice(250, Color.Red, "Rent"),
        Slice(250, Color.Green, "Salaries"),
        Slice(250, Color.Blue, "Internet"),
        Slice(250, Color.Yellow, "Fuel"),
    )

    @Test
    fun `a tap finds the slice it landed on`() {
        val middle = Offset(100f, 100f)
        // twelve o'clock is where the first slice starts, then clockwise
        assertEquals("Rent", sliceAt(quarters, 1000, Offset(100f, 20f), middle))
        assertEquals("Salaries", sliceAt(quarters, 1000, Offset(180f, 100f), middle))
        assertEquals("Internet", sliceAt(quarters, 1000, Offset(100f, 180f), middle))
        assertEquals("Fuel", sliceAt(quarters, 1000, Offset(20f, 100f), middle))
    }

    @Test
    fun `slices of different sizes land where they should`() {
        val slices = listOf(
            Slice(750, Color.Red, "Salaries"),      // three quarters, from the top
            Slice(250, Color.Green, "Rent"),        // the last quarter
        )
        assertEquals("Salaries", sliceAt(slices, 1000, Offset(100f, 20f), Offset(100f, 100f)))
        assertEquals("Salaries", sliceAt(slices, 1000, Offset(100f, 180f), Offset(100f, 100f)))
        assertEquals("Rent", sliceAt(slices, 1000, Offset(20f, 100f), Offset(100f, 100f)))
    }

    @Test
    fun `an empty ring has nothing to find`() {
        assertEquals("", sliceAt(emptyList(), 0, Offset(10f, 10f), Offset(100f, 100f)))
        assertEquals("", sliceAt(quarters, 0, Offset(10f, 10f), Offset(100f, 100f)))
    }

    @Test
    fun `picking a slice is remembered, and tapping it again lets go`() {
        vm.pickSlice("Headsets")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("Headsets", vm.ui.value.picked)
        vm.pickSlice("")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("", vm.ui.value.picked)
    }

    @Test
    fun `the labels name each colour, with its share`() {
        compose.setContent {
            LedgerTheme {
                RingLabels(quarters, 1000, { "Rs " + it }, "Rent", { vm.pickSlice(it) })
            }
        }
        compose.waitForIdle()
        // the top three are spelled out; the rest are a tap on the ring away
        listOf("Rent", "Salaries", "Internet").forEach {
            compose.onNodeWithText(it, substring = true).assertExists()
        }
        compose.onNodeWithText("and 1 more", substring = true).assertExists()
        compose.onAllNodesWithText("25%")[0].assertExists()
    }

    @Test
    fun `tapping a label picks that slice`() {
        compose.setContent {
            LedgerTheme {
                RingLabels(quarters, 1000, { "Rs " + it }, "", { vm.pickSlice(it) })
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Internet", substring = true).performClick()
        compose.waitForIdle()
        assertEquals("Internet", vm.ui.value.picked)
    }

    @Test
    fun `the records footer shows both numbers and what is left`() {
        settle()
        compose.setContent {
            LedgerTheme { InOutBar(500000, 125000, { "Rs " + it / 100 }) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("PKR IN").assertExists()
        compose.onNodeWithText("PKR OUT").assertExists()
        compose.onNodeWithText("Rs 5000").assertExists()
        compose.onNodeWithText("Rs 1250").assertExists()
        compose.onNodeWithText("Left over Rs 3750").assertExists()
    }

    @Test
    fun `spending more than came in says so plainly`() {
        compose.setContent {
            LedgerTheme { InOutBar(100000, 250000, { "Rs " + it / 100 }) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Short by Rs 1500").assertExists()
    }

    @Test
    fun `the home ring is drawn from what was actually spent`() = runBlocking {
        settle()
        listOf("Headsets" to 125000L, "Overtime" to 75000L).forEach { (category, amount) ->
            repo.save(
                Entry(
                    id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                    lines = listOf(Line(category = category, amountMinor = amount)),
                ),
            )
        }
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (repo.state.value.entries.size >= 2) return@repeat
            Thread.sleep(25)
        }
        val sums = pk.ironclad.ledger.ui.byCategory(repo.state.value.entries, Type.EXPENSE)
        assertEquals(125000L, sums["Headsets"])
        assertEquals(75000L, sums["Overtime"])
        assertTrue("the categories carry a colour to draw with",
            repo.state.value.categories.first { it.name == "Headsets" }.colour.startsWith("#"))
    }
}
