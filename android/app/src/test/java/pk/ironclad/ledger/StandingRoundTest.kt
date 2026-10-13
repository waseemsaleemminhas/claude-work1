package pk.ironclad.ledger

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import pk.ironclad.ledger.data.Sync

/**
 * Neither of us should have to remember to tap Sync now. A standing round is
 * booked once, survives the app being closed, and waits for a signal.
 */
@RunWith(RobolectricTestRunner::class)
class StandingRoundTest {

    private lateinit var app: Application

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            app,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
    }

    @Test
    fun `the app books one standing round, and asking again does not book another`() {
        Sync.schedule(app)
        Sync.schedule(app)
        Sync.schedule(app)

        val booked = WorkManager.getInstance(app)
            .getWorkInfosForUniqueWork("ledger-sync-rounds").get()
        assertEquals("one round, however many times we ask", 1, booked.size)
        assertTrue("it is waiting its turn", booked.first().state.isFinished.not())
    }

    @Test
    fun `it waits for a signal rather than failing without one`() {
        Sync.schedule(app)
        val info = WorkManager.getInstance(app)
            .getWorkInfosForUniqueWork("ledger-sync-rounds").get().first()
        assertTrue("held until there is a network", info.constraints.requiredNetworkType == NetworkType.CONNECTED)
    }

    @Test
    fun `a nudge after an entry is its own job, and does not disturb the round`() {
        Sync.schedule(app)
        Sync.nudge(app)
        val manager = WorkManager.getInstance(app)
        assertEquals("the round is still booked", 1,
            manager.getWorkInfosForUniqueWork("ledger-sync-rounds").get().size)
        assertEquals("and the nudge is separate", 1,
            manager.getWorkInfosForUniqueWork("ledger-sync").get().size)
    }
}
