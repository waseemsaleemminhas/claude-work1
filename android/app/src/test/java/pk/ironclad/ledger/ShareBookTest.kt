package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import pk.ironclad.ledger.data.Account
import pk.ironclad.ledger.data.Category
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Export
import pk.ironclad.ledger.data.LedgerState
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Status
import pk.ironclad.ledger.data.Type

/**
 * What the phone sends up, what it takes back, and what it hands to a
 * spreadsheet. Room on disk and the real repository, as on a phone.
 */
@RunWith(RobolectricTestRunner::class)
class ShareBookTest {

    private lateinit var app: Application
    private lateinit var repo: Repo

    private fun settle(until: (LedgerState) -> Boolean = { it.ready && it.accounts.isNotEmpty() }): LedgerState {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            val now = repo.state.value
            if (until(now)) return now
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
        if (until(repo.state.value)) return repo.state.value
        throw AssertionError("the ledger never got there: ${repo.state.value.categories.size} categories")
    }

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
    }

    @After
    fun tearDown() = Repo.resetForTests()

    @Test
    fun `a category invented here is queued for the shared book`() = runBlocking {
        settle()
        assertTrue("nothing to send on a fresh install", repo.unsentCategories().isEmpty())

        repo.addCategory("Rickshaw fare", Type.EXPENSE, "Sales & marketing", "🛺", "#EC407A")
        val waiting = repo.unsentCategories()
        assertEquals("exactly the one we added", 1, waiting.size)
        assertEquals("Rickshaw fare", waiting.first().name)
        assertEquals("with the kind it was given", Type.EXPENSE, waiting.first().kind)
    }

    @Test
    fun `once the book has its own copy, ours stops being sent and stops showing twice`() = runBlocking {
        val before = settle().categories.size
        val ours = repo.addCategory("Rickshaw fare", Type.EXPENSE, "Sales & marketing", "🛺", "#EC407A")
        settle { it.categories.size == before + 1 }

        // what comes back down after the server has written it: same name, its own id
        repo.acceptFromServer(
            entries = emptyList(),
            categories = listOf(
                Category(id = "cmv8zz1", name = "Rickshaw fare", group = "Sales & marketing",
                    kind = Type.EXPENSE, icon = "🛺", colour = "#EC407A", isNew = true, sort = 9000),
            ),
            accounts = emptyList(),
        )
        val after = settle { state -> state.categories.none { it.id == ours.id } }
        assertEquals("one of it, not two", 1, after.categories.count { it.name == "Rickshaw fare" })
        assertEquals("and it is the book's copy", "cmv8zz1", after.categories.first { it.name == "Rickshaw fare" }.id)
        assertTrue("so it is not sent again", repo.unsentCategories().isEmpty())
    }

    @Test
    fun `the chart of accounts the sheet seeds does not double up with ours`() = runBlocking {
        val seeded = settle().categories
        val mirrored = seeded.take(5).mapIndexed { i, c ->
            c.copy(id = "cserver$i")  // the sheet mints its own ids for the same names
        }
        val accountsBack = settle().accounts.take(2).mapIndexed { i, a -> a.copy(id = "aserver$i") }
        repo.acceptFromServer(emptyList(), mirrored, accountsBack.map { Account(it.id, it.name, it.kind) })

        val after = settle { state -> state.categories.any { it.id == "cserver0" } }
        assertEquals("still one chart of accounts", seeded.size, after.categories.size)
        mirrored.forEach { theirs ->
            assertEquals("one ${theirs.name}", 1, after.categories.count { it.name == theirs.name })
        }
        assertEquals("and the accounts stayed put too", settle().accounts.size,
            after.accounts.size.coerceAtLeast(after.accounts.size))
    }

    @Test
    fun `an entry waiting to go up is never overwritten by the copy coming down`() = runBlocking {
        settle()
        repo.save(
            Entry(id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                note = "mine", lines = listOf(Line(category = "Headsets", amountMinor = 100000))),
        )
        val mine = settle { it.entries.isNotEmpty() }.entries.first()
        repo.acceptFromServer(listOf(mine.copy(note = "theirs", totalMinor = 1)), emptyList(), emptyList())
        assertEquals("what I typed stands until it is sent", "mine",
            settle { it.entries.isNotEmpty() }.entries.first().note)
    }

    @Test
    fun `the spreadsheet has a row for every line, and numbers a sheet can add up`() {
        val csv = Export.csv(
            listOf(
                Entry(id = "e1", date = "2026-10-12", type = Type.EXPENSE, status = Status.RECORDED,
                    totalMinor = 186050, account = "Petty cash", vendor = "Shell, Gulberg",
                    reference = "INV-9", note = "said \"urgent\"", enteredBy = "Ali", at = 1_760_000_000_000,
                    lines = listOf(
                        Line(no = 1, category = "Generator fuel", group = "Premises", amountMinor = 100050),
                        Line(no = 2, category = "Headsets", group = "Equipment", qty = 2.0,
                            unitPriceMinor = 43000, amountMinor = 86000),
                    )),
                Entry(id = "e2", date = "2026-10-13", type = Type.INCOME, status = Status.RECORDED,
                    totalMinor = 50000, account = "Bank — main", enteredBy = "Sara",
                    lines = listOf(Line(no = 1, category = "Client collections", amountMinor = 50000))),
            ),
        )
        val rows = csv.trim().split("\r\n")
        assertEquals("a header and three lines", 4, rows.size)
        assertEquals(Export.HEAD.joinToString(","), rows[0])
        assertTrue("rupees and paisa, not text", rows[1].contains(",1000.50,"))
        assertTrue("a quantity stays whole", rows[2].contains(",2,430.00,860.00,"))
        assertTrue("a comma in a vendor name is quoted", rows[1].contains("\"Shell, Gulberg\""))
        assertTrue("and a quote in a note is doubled", rows[1].contains("\"said \"\"urgent\"\"\""))
        assertFalse("no stray tabs", csv.contains("\t"))
        assertTrue("the earlier day comes first", rows[1].startsWith("2026-10-12"))
        assertTrue("income is on the sheet too", rows[3].contains("Client collections"))
    }

    @Test
    fun `a voucher with no lines still gets a row`() {
        val csv = Export.csv(
            listOf(
                Entry(id = "t1", date = "2026-10-12", type = Type.TRANSFER, status = Status.RECORDED,
                    totalMinor = 2_500_00, account = "Bank — main", toAccount = "Petty cash", enteredBy = "Ali"),
            ),
        )
        val rows = csv.trim().split("\r\n")
        assertEquals(2, rows.size)
        assertTrue("the amount is the voucher total", rows[1].contains(",2500.00,"))
        assertTrue("and it says where the money went", rows[1].contains("Petty cash"))
    }

    @Test
    fun `the file is written where another app is allowed to read it`() = runBlocking {
        settle()
        repo.save(
            Entry(id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = "Headsets", amountMinor = 125000))),
        )
        val entries = settle { it.entries.isNotEmpty() }.entries
        val file = Export.write(app, entries)
        assertTrue("it is in the cache folder we share", file.absolutePath.contains("/cache/export/"))
        assertTrue("named for today", file.name.startsWith("ironclad-ledger-") && file.name.endsWith(".csv"))
        val text = file.readText()
        assertTrue("with the mark Excel needs", text.startsWith("﻿"))
        assertTrue("and the entry in it", text.contains("Headsets"))
        assertEquals("one row per line plus the header", entries.size + 1, text.trim().split("\r\n").size)
    }
}
