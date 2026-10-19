package pk.ironclad.ledger

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import pk.ironclad.ledger.data.Bills
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.ShareIn
import pk.ironclad.ledger.data.Type
import java.io.File

/**
 * Which bills go up on a sync, and which wait. A bill is only worth sending
 * once the voucher it belongs to is in the book, and never twice.
 */
@RunWith(RobolectricTestRunner::class)
class BillsTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private lateinit var app: Application
    private lateinit var repo: Repo

    private fun settle(until: () -> Boolean) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until()) return
            Thread.sleep(25)
        }
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun billOnDisk(name: String, size: Int): String {
        val file = File(ShareIn.folder(app), name)
        file.writeBytes(ByteArray(size) { 5 })
        return name
    }

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
        settle { repo.state.value.ready }
    }

    @After
    fun tearDown() = Repo.resetForTests()

    @Test
    fun `an older script is not posted bills it would only drop`() = runBlocking {
        settle { repo.state.value.ready }
        assertFalse("nothing assumed at the start", repo.state.value.prefs.bookTakesBills)

        // a reply from a script that has never heard of bills leaves out the key
        val older = json.decodeFromString(
            pk.ironclad.ledger.data.SyncPull.serializer(),
            """{"ok":true,"now":1,"accepted":[],"entries":[]}""",
        )
        assertNull("so we can tell, and hold the bills back", older.receipts)

        // a newer one answers with the key, even when there is nothing in it
        val newer = json.decodeFromString(
            pk.ironclad.ledger.data.SyncPull.serializer(),
            """{"ok":true,"now":1,"accepted":[],"entries":[],"receipts":{}}""",
        )
        assertEquals("and then we know it can keep them", emptyMap<String, String>(), newer.receipts)

        repo.setPref("bookTakesBills", "yes")
        settle { repo.state.value.prefs.bookTakesBills }
        assertTrue(repo.state.value.prefs.bookTakesBills)
    }

    @Test
    fun `a bill waits until its voucher is in the book`() {
        billOnDisk("bill-aaa.pdf", 400)
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-aaa.pdf"),
            known = emptySet(),
            unsent = setOf("e1"),           // the voucher has not gone up yet
            order = listOf("e1"),
        )
        assertTrue("nothing to send while the voucher is still here", waiting.isEmpty())
    }

    @Test
    fun `once the voucher is up, the bill goes`() {
        billOnDisk("bill-bbb.pdf", 400)
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-bbb.pdf"),
            known = emptySet(),
            unsent = emptySet(),
            order = listOf("e1"),
        )
        assertEquals(1, waiting.size)
        assertEquals("e1", waiting[0].id)
        assertEquals("application/pdf", waiting[0].mime)
        assertEquals(400, waiting[0].bytes)
        assertTrue("as base64", waiting[0].data.isNotBlank())
    }

    @Test
    fun `a bill the book already holds is not sent again`() {
        billOnDisk("bill-ccc.pdf", 400)
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-ccc.pdf"),
            known = setOf("e1"),            // the book has told us where it is
            unsent = emptySet(),
            order = listOf("e1"),
        )
        assertTrue(waiting.isEmpty())
    }

    @Test
    fun `a missing file is skipped rather than sent empty`() {
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-gone.pdf"),
            known = emptySet(),
            unsent = emptySet(),
            order = listOf("e1"),
        )
        assertTrue(waiting.isEmpty())
        assertNull(Bills.bodyOf(app, "bill-gone.pdf"))
    }

    @Test
    fun `only as many as fit go in one round`() {
        // two of these fit in the allowance; the third would push it over
        val big = (Bills.ROOM_PER_SYNC * 0.45).toInt()
        billOnDisk("bill-1.pdf", big)
        billOnDisk("bill-2.pdf", big)
        billOnDisk("bill-3.pdf", big)
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-1.pdf", "e2" to "bill-2.pdf", "e3" to "bill-3.pdf"),
            known = emptySet(),
            unsent = emptySet(),
            order = listOf("e1", "e2", "e3"),
        )
        assertEquals("two of the three fit", 2, waiting.size)
        assertEquals("oldest first", listOf("e1", "e2"), waiting.map { it.id })
        assertTrue("and the round stays within the allowance",
            waiting.sumOf { it.bytes } <= Bills.ROOM_PER_SYNC)
    }

    @Test
    fun `one bill bigger than the whole allowance still gets its turn`() {
        billOnDisk("bill-huge.pdf", Bills.ROOM_PER_SYNC * 2)
        val waiting = Bills.waiting(
            context = app,
            bills = mapOf("e1" to "bill-huge.pdf"),
            known = emptySet(),
            unsent = emptySet(),
            order = listOf("e1"),
        )
        assertEquals("sent on its own rather than never", 1, waiting.size)
    }

    @Test
    fun `the kind of file is named from its name`() {
        assertEquals("image/jpeg", Bills.mimeOf("bill-x.jpg"))
        assertEquals("image/jpeg", Bills.mimeOf("BILL-X.JPEG"))
        assertEquals("image/png", Bills.mimeOf("a.png"))
        assertEquals("application/pdf", Bills.mimeOf("invoice.pdf"))
        assertEquals("application/octet-stream", Bills.mimeOf("odd.xyz"))
    }

    @Test
    fun `where the book put a bill is remembered, so it is not sent twice`() = runBlocking {
        settle { repo.state.value.accounts.isNotEmpty() }
        val saved = repo.save(
            Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = "Generator fuel", amountMinor = 450000)),
            ),
        )
        val name = billOnDisk("bill-kept.jpg", 256)
        repo.attachBill(saved.id, name)
        settle { repo.state.value.bills[saved.id] == name }

        repo.noteBillUrl(saved.id, "https://drive.google.com/file/d/abc/view")
        settle { repo.state.value.billUrls[saved.id] != null }

        assertEquals("https://drive.google.com/file/d/abc/view", repo.state.value.billUrls[saved.id])
        assertEquals("and the two are kept apart", name, repo.state.value.bills[saved.id])

        val waiting = Bills.waiting(
            context = app,
            bills = repo.state.value.bills,
            known = repo.state.value.billUrls.keys,
            unsent = emptySet(),
            order = listOf(saved.id),
        )
        assertTrue("nothing left to send", waiting.isEmpty())
    }
}
