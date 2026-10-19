package pk.ironclad.ledger

import android.app.Application
import android.content.Intent
import android.net.Uri
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
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.ShareIn
import pk.ironclad.ledger.data.Type
import java.io.File

/**
 * A bill arriving from WhatsApp or anywhere else that can share. The file is
 * copied the moment it arrives, because the permission to read it does not
 * last, and it is kept against the voucher it belongs to.
 */
@RunWith(RobolectricTestRunner::class)
class ShareInTest {

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

    /**
     * Something another app would hand us: a Uri we can read for a moment.
     * Our own provider deliberately publishes only the two folders it owns, so
     * a stand-in for somebody else's file is a plain one outside them.
     */
    private fun shareable(name: String, bytes: ByteArray): Uri {
        val outside = File(app.cacheDir, "incoming").apply { mkdirs() }
        val file = File(outside, name)
        file.writeBytes(bytes)
        return Uri.fromFile(file)
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
    fun `a shared photo is copied into our own keeping`() {
        val bytes = ByteArray(2048) { 7 }
        val name = ShareIn.keep(app, shareable("bill.jpg", bytes))
        assertTrue("it was kept", name.isNotBlank())
        assertTrue("under a name of our own", name.startsWith("bill-"))
        assertTrue("keeping the kind of file it is", name.endsWith(".jpg"))

        val ours = ShareIn.fileFor(app, name)
        assertTrue("the copy is there", ours.exists())
        assertEquals("all of it", bytes.size.toLong(), ours.length())
        assertTrue("and it is inside the app's own folder", ours.absolutePath.contains("/files/bills/"))
    }

    @Test
    fun `a pdf invoice is kept as a pdf`() {
        val name = ShareIn.keep(app, shareable("invoice.pdf", ByteArray(128) { 3 }))
        assertTrue(name.endsWith(".pdf"))
        assertFalse("and is not treated as a picture", ShareIn.isImage(name))
    }

    @Test
    fun `an empty share leaves nothing behind`() {
        val name = ShareIn.keep(app, shareable("nothing.jpg", ByteArray(0)))
        assertEquals("", name)
        assertEquals("no stray files", 0, ShareIn.folder(app).listFiles()?.size ?: 0)
    }

    @Test
    fun `the words that came with it are kept too`() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "Paid Rs 4,500 to Shell Gulberg for fuel")
        }
        val came = ShareIn.take(app, intent)
        assertTrue(came.file.isBlank())
        assertTrue(came.text.contains("Shell Gulberg"))
        assertFalse(came.empty)
    }

    @Test
    fun `a file and its words arrive together`() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"
            putExtra(Intent.EXTRA_STREAM, shareable("together.jpg", ByteArray(64) { 1 }))
            putExtra(Intent.EXTRA_TEXT, "generator diesel")
        }
        val came = ShareIn.take(app, intent)
        assertTrue("the file", came.file.endsWith(".jpg"))
        assertEquals("and the words", "generator diesel", came.text)
    }

    @Test
    fun `anything that is not a share is ignored`() {
        assertTrue(ShareIn.take(app, null).empty)
        assertTrue(ShareIn.take(app, Intent(Intent.ACTION_MAIN)).empty)
    }

    @Test
    fun `an amount is read out of the words when there is one`() {
        assertEquals(450000L, ShareIn.amountIn("Paid Rs 4,500 to Shell"))
        assertEquals(125050L, ShareIn.amountIn("Debit of PKR 1,250.50 from your account"))
        assertEquals("the money, not the reference", 1_800_000L,
            ShareIn.amountIn("Invoice 23 dated 16/10/2026 for Rs 18,000"))
        assertEquals("nothing to find", 0L, ShareIn.amountIn("thanks bhai"))
        assertEquals("nothing to find", 0L, ShareIn.amountIn(""))
    }

    @Test
    fun `the bill stays with its voucher`() = runBlocking {
        settle { repo.state.value.accounts.isNotEmpty() }
        val name = ShareIn.keep(app, shareable("kept.jpg", ByteArray(32) { 9 }))
        val saved = repo.save(
            pk.ironclad.ledger.data.Entry(
                id = "", date = repo.today(), type = Type.EXPENSE, account = "Petty cash",
                lines = listOf(Line(category = "Generator fuel", amountMinor = 450000)),
            ),
        )
        repo.attachBill(saved.id, name)
        settle { repo.state.value.bills[saved.id] == name }

        assertEquals("the voucher knows its bill", name, repo.state.value.bills[saved.id])
        assertTrue("and the file is still there", ShareIn.fileFor(app, name).exists())
    }
}
