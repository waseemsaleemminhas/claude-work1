package pk.ironclad.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.ironclad.ledger.data.Sync

/**
 * When the book turns an entry down it says why. Showing the count and
 * swallowing the reason leaves somebody staring at a number.
 */
class RejectionTest {

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
}
