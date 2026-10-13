package pk.ironclad.ledger

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import pk.ironclad.ledger.data.LedgerDb

@RunWith(RobolectricTestRunner::class)
class SmokeTest {
    @Test
    fun `the database opens`() {
        val db = LedgerDb.get(ApplicationProvider.getApplicationContext())
        assertTrue(db.openHelper.writableDatabase.isOpen)
    }
}
