package pk.ironclad.ledger

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import pk.ironclad.ledger.data.Repo

/** Does the app actually start? */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class LaunchTest {

    @Test
    fun `the activity starts and stays up`() {
        Repo.resetForTests()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.moveToState(Lifecycle.State.RESUMED)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
            scenario.onActivity { activity ->
                assertEquals(false, activity.isFinishing)
            }
        }
        Repo.resetForTests()
    }

    @Test
    fun `it survives being rotated`() {
        Repo.resetForTests()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.recreate()
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
        Repo.resetForTests()
    }
}
