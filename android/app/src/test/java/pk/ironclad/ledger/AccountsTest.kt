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
 * Two people, two accounts. Hiding the rest on the sheet should leave the app
 * with just those two — unless a hidden one still has money in it, which is
 * worth being told about rather than quietly dropping.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class AccountsTest {

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

    /** What a sync brings down after the Accounts tab has been tidied. */
    private suspend fun fromSheet(vararg accounts: Account) {
        repo.acceptFromServer(emptyList(), emptyList(), accounts.toList())
        // the sheet's copy in, our stand-in of the same name gone: one row each
        settle {
            accounts.all { a ->
                repo.state.value.accounts.count { it.name == a.name } == 1 &&
                    repo.state.value.accounts.any { it.name == a.name && it.id == a.id }
            }
        }
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
    fun `hiding the seeded accounts leaves only the two that matter`() = runBlocking {
        settle()
        val seeded = repo.state.value.liveAccounts.map { it.name }
        assertEquals("a fresh install comes with three", 3, seeded.size)

        fromSheet(
            Account(id = "acash-w", name = "Cash — Waseem", kind = "Cash", heldBy = "Waseem"),
            Account(id = "acash-a", name = "Cash — Anas", kind = "Cash", heldBy = "Anas"),
            *seeded.map { name ->
                val old = repo.state.value.accounts.first { it.name == name }
                Account(id = old.id, name = name, kind = old.kind, archived = true)
            }.toTypedArray(),
        )
        settle { repo.state.value.liveAccounts.size == 2 }

        val live = repo.state.value.liveAccounts.map { it.name }.sorted()
        assertEquals(listOf("Cash — Anas", "Cash — Waseem"), live)
    }

    @Test
    fun `a hidden account with nothing in it disappears from the screen`() = runBlocking {
        settle()
        fromSheet(
            Account(id = "acash-w", name = "Cash — Waseem", kind = "Cash", heldBy = "Waseem"),
            Account(id = "aold", name = "JazzCash", kind = "Mobile wallet", archived = true),
        )
        settle { repo.state.value.accounts.any { it.name == "JazzCash" && it.archived } }

        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Cash — Waseem", substring = true).assertExists()
        assertEquals("an empty hidden account is simply gone", 0,
            compose.onAllNodesWithText("JazzCash", substring = true).fetchSemanticsNodes().size)
    }

    @Test
    fun `a hidden account still holding money says so instead of vanishing`() = runBlocking {
        settle()
        fromSheet(
            Account(id = "aold", name = "Petty cash", kind = "Cash", openingMinor = 500000, archived = true),
        )
        settle { repo.state.value.accounts.any { it.name == "Petty cash" && it.archived } }

        compose.setContent {
            LedgerTheme { pk.ironclad.ledger.ui.AccountsScreen(vm, repo.state.value) }
        }
        compose.waitForIdle()
        compose.onNodeWithText("still holding money", substring = true).assertExists()
        compose.onNodeWithText("Move it out and it will go", substring = true).assertExists()
        Unit
    }

    @Test
    fun `moving the money out first is what empties it`() = runBlocking {
        settle()
        fromSheet(
            Account(id = "aold", name = "Petty cash", kind = "Cash", openingMinor = 500000),
            Account(id = "acash-w", name = "Cash — Waseem", kind = "Cash", heldBy = "Waseem"),
        )
        settle { repo.state.value.accounts.any { it.name == "Cash — Waseem" } }

        repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.TRANSFER, totalMinor = 500000,
                account = "Petty cash", toAccount = "Cash — Waseem",
            ),
        )
        settle { repo.state.value.entries.isNotEmpty() }

        val held = repo.state.value.accounts.associate { it.name to it.balanceMinor }
        assertEquals("emptied", 0L, held["Petty cash"])
        assertEquals("and the money is with its new keeper", 500000L, held["Cash — Waseem"])
        assertEquals("a move is not spending", 0L,
            pk.ironclad.ledger.ui.totalsOf(repo.state.value.entries).outMinor)
    }
}
