package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
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
import pk.ironclad.ledger.data.Category
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.Ink
import pk.ironclad.ledger.ui.LedgerTheme
import pk.ironclad.ledger.ui.budgetColour
import pk.ironclad.ledger.ui.budgets
import pk.ironclad.ledger.ui.spentInMonth
import java.time.LocalDate

/**
 * The Monthly Budget column of the sheet, against what has actually gone out.
 * The budgets come down on a sync, exactly as they will in use.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class BudgetTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo
    private lateinit var vm: Vm

    private fun settle(until: (Unit) -> Boolean = { repo.state.value.ready && repo.state.value.accounts.isNotEmpty() }) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until(Unit)) return
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    /** What a sync brings down when somebody fills in the Monthly Budget column. */
    private suspend fun budgetFromSheet(name: String, rupees: Long, group: String = "Premises") {
        repo.acceptFromServer(
            entries = emptyList(),
            categories = listOf(
                Category(
                    id = "csheet-" + name.lowercase().replace(" ", "-"), name = name, group = group,
                    kind = Type.EXPENSE, icon = "🔌", colour = "#43A047",
                    budgetMinor = rupees * 100, sort = 10,
                ),
            ),
            accounts = emptyList(),
        )
        // wait for the whole arrival: the sheet's copy in, and our stand-in gone
        settle {
            repo.state.value.categories.count { it.name == name } == 1 &&
                repo.state.value.categories.any { it.name == name && it.budgetMinor > 0 }
        }
    }

    private suspend fun spend(category: String, rupees: Long, on: String = repo.today()) {
        val before = repo.state.value.entries.size
        repo.save(
            Entry(
                id = "", date = on, type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = category, amountMinor = rupees * 100)),
            ),
        )
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

    @Test
    fun `a budget set on the sheet arrives on the phone`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 25_000)
        val category = repo.state.value.categories.first { it.name == "Generator fuel" }
        assertEquals("twenty five thousand, in paisa", 2_500_000L, category.budgetMinor)
        assertEquals("and only one of it", 1,
            repo.state.value.categories.count { it.name == "Generator fuel" })
    }

    @Test
    fun `only this month's expenses count against it`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 25_000)
        val today = LocalDate.parse(repo.today())
        spend("Generator fuel", 8_000)
        spend("Generator fuel", 4_000)
        spend("Generator fuel", 9_000, today.minusMonths(2).withDayOfMonth(5).toString())
        spend("Headsets", 15_000)

        assertEquals("this month's fuel only", 1_200_000L,
            spentInMonth(repo.state.value, "Generator fuel", today))
        assertEquals("the old month keeps its own", 900_000L,
            spentInMonth(repo.state.value, "Generator fuel", today.minusMonths(2)))
    }

    @Test
    fun `a voided entry stops counting`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 25_000)
        spend("Generator fuel", 8_000)
        val entry = repo.state.value.entries.first()
        repo.void(entry.id)
        settle { repo.state.value.entries.first().status == Status.VOID }
        assertEquals(0L, spentInMonth(repo.state.value, "Generator fuel", LocalDate.parse(repo.today())))
    }

    @Test
    fun `money coming in is not spending`() = runBlocking {
        settle()
        budgetFromSheet("Client collections", 25_000, group = "Income")
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.INCOME, account = "Petty cash",
                lines = listOf(Line(category = "Client collections", amountMinor = 500_000)),
            ),
        )
        settle { repo.state.value.entries.isNotEmpty() }
        assertEquals("income never eats a budget", 0L,
            spentInMonth(repo.state.value, "Client collections", LocalDate.parse(repo.today())))
    }

    @Test
    fun `the list is worst off first, and leaves out what has no budget`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 10_000)
        budgetFromSheet("Headsets", 10_000)
        budgetFromSheet("Overtime", 10_000)
        spend("Generator fuel", 2_000)      // a fifth gone
        spend("Headsets", 12_000)           // over
        spend("Overtime", 8_000)            // close

        val rows = budgets(repo.state.value, LocalDate.parse(repo.today()))
        assertEquals("only the three with budgets", 3, rows.size)
        assertEquals("the one that is over comes first", "Headsets", rows[0].category.name)
        assertEquals("then the one close to it", "Overtime", rows[1].category.name)
        assertEquals("the comfortable one last", "Generator fuel", rows[2].category.name)

        assertTrue(rows[0].over)
        assertEquals("by two thousand", -200_000L, rows[0].leftMinor)
        assertFalse(rows[1].over)
        assertEquals("two thousand still to spend", 200_000L, rows[1].leftMinor)
        assertEquals(0.8f, rows[1].share, 0.001f)
    }

    @Test
    fun `an archived category drops off the budget list`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 10_000)
        assertEquals(1, budgets(repo.state.value, LocalDate.parse(repo.today())).size)

        repo.acceptFromServer(
            entries = emptyList(),
            categories = listOf(
                Category(
                    id = "csheet-generator-fuel", name = "Generator fuel", kind = Type.EXPENSE,
                    budgetMinor = 1_000_000, archived = true,
                ),
            ),
            accounts = emptyList(),
        )
        settle { repo.state.value.categories.first { it.name == "Generator fuel" }.archived }
        assertEquals("archived on the sheet, gone from the bars", 0,
            budgets(repo.state.value, LocalDate.parse(repo.today())).size)
    }

    @Test
    fun `the colour says how close it is`() {
        assertEquals("plenty left", Ink.good, budgetColour(0.1f))
        assertEquals("still fine", Ink.good, budgetColour(0.79f))
        assertEquals("running out", Ink.warn, budgetColour(0.8f))
        assertEquals("nearly gone", Ink.warn, budgetColour(1f))
        assertEquals("past it", Ink.bad, budgetColour(1.01f))
    }

    @Test
    fun `the home screen shows the bars once a budget exists`() = runBlocking {
        settle()
        budgetFromSheet("Generator fuel", 10_000)
        spend("Generator fuel", 12_000)
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.HomeScreen(vm, repo.state.value, vm.ui.value)
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("BUDGETS", substring = true).assertExists()
        compose.onNodeWithText("Rs 2,000 over", substring = true).assertExists()
        compose.onNodeWithText("1 over", substring = true).assertExists()
        Unit
    }

    @Test
    fun `no budgets means no card at all`() = runBlocking {
        settle()
        spend("Headsets", 5_000)
        compose.setContent {
            LedgerTheme {
                pk.ironclad.ledger.ui.HomeScreen(vm, repo.state.value, vm.ui.value)
            }
        }
        compose.waitForIdle()
        compose.onAllNodesWithText("BUDGETS", substring = true).fetchSemanticsNodes().let {
            assertEquals("nobody who does not use budgets has to look at them", 0, it.size)
        }
        Unit
    }
}
