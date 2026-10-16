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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import pk.ironclad.ledger.data.Account
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme

/**
 * The screens carry their own words and their own buttons: a balance you can
 * read on the home screen, and something to press where you are standing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class LookTest {

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

    private suspend fun twoPeople() {
        repo.acceptFromServer(
            emptyList(), emptyList(),
            listOf(
                Account(id = "acash-w", name = "Cash — Waseem", kind = "Cash", heldBy = "Waseem",
                    openingMinor = 1_500_000, colour = "#43A047"),
                Account(id = "acash-a", name = "Cash — Anas", kind = "Cash", heldBy = "Anas",
                    openingMinor = 2_050_000, colour = "#1E88E5"),
            ) + repo.state.value.accounts.filter { it.id.startsWith("acct-") }
                .map { Account(id = it.id, name = it.name, kind = it.kind, archived = true) },
        )
        settle { repo.state.value.liveAccounts.size == 2 }
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
    fun `home carries what each of them is holding`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.HomeScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Waseem", substring = true).assertExists()
        compose.onNodeWithText("Anas", substring = true).assertExists()
        compose.onNodeWithText("Rs 15,000", substring = true).assertExists()
        compose.onNodeWithText("Rs 20,500", substring = true).assertExists()
        Unit
    }

    @Test
    fun `tapping a balance goes to the accounts screen`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.HomeScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Anas", substring = true).performClick()
        compose.waitForIdle()
        assertEquals(Screen.ACCOUNTS, vm.ui.value.screen)
    }

    @Test
    fun `money we hold has the total and a button on every account`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("EVERYTHING TOGETHER").assertExists()
        compose.onNodeWithText("Rs 35,500", substring = true).assertExists()
        compose.onNodeWithText("2 accounts", substring = true).assertExists()
        compose.onAllNodesWithText("Move money").fetchSemanticsNodes().let {
            assertTrue("one on the hero card and one per account", it.size >= 3)
        }
        compose.onAllNodesWithText("Spend from here").fetchSemanticsNodes().let {
            assertEquals("one per account", 2, it.size)
        }
        Unit
    }

    @Test
    fun `spend from here starts an entry on that account`() = runBlocking {
        settle()
        twoPeople()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onAllNodesWithText("Spend from here")[1].performClick()
        compose.waitForIdle()
        val draft = vm.ui.value.draft
        assertNotNull("an entry opened", draft)
        assertEquals(Type.EXPENSE, draft!!.type)
        assertTrue("on one of the two accounts",
            draft.account == "Cash — Anas" || draft.account == "Cash — Waseem")
    }

    @Test
    fun `records has its own buttons and says what it is showing`() = runBlocking {
        settle()
        twoPeople()
        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Cash — Anas",
                lines = listOf(Line(category = "Headsets", amountMinor = 125000)),
            ),
        )
        settle { repo.state.value.entries.isNotEmpty() }
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.RecordsScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Money out", substring = true).assertExists()
        compose.onNodeWithText("Money in", substring = true).assertExists()
        compose.onNodeWithText("Export").assertExists()
        compose.onNodeWithText("1 voucher", substring = true).assertExists()
        compose.onNodeWithText("PKR IN").assertExists()
        compose.onNodeWithText("PKR OUT").assertExists()
        Unit
    }

    @Test
    fun `the money out button on records opens an expense`() = runBlocking {
        settle()
        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.RecordsScreen(vm, repo.state.value, vm.ui.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Money out", substring = true).performClick()
        compose.waitForIdle()
        assertEquals(Type.EXPENSE, vm.ui.value.draft?.type)
    }
}
