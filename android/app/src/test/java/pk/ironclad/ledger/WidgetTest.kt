package pk.ironclad.ledger

import android.app.Application
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Looper
import android.widget.TextView
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
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
import pk.ironclad.ledger.data.Entry
import pk.ironclad.ledger.data.Line
import pk.ironclad.ledger.data.Repo
import pk.ironclad.ledger.data.Type
import pk.ironclad.ledger.ui.LedgerTheme

/** The home-screen widget: what it says, and where its buttons go. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class WidgetTest {

    @get:Rule val compose = createComposeRule()

    private lateinit var app: Application
    private lateinit var repo: Repo

    @Before
    fun setUp() {
        Repo.resetForTests()
        app = ApplicationProvider.getApplicationContext()
        repo = Repo.get(app)
        settle { repo.state.value.ready && repo.state.value.accounts.isNotEmpty() }
    }

    @After
    fun tearDown() = Repo.resetForTests()

    private fun settle(until: () -> Boolean) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until()) return
            Thread.sleep(25)
        }
    }

    private fun widgetText(): String {
        val manager = AppWidgetManager.getInstance(app)
        val shadow = shadowOf(manager)
        val id = shadow.createWidget(QuickEntryWidget::class.java, R.layout.widget_quick_entry)
        settle { false }
        val view = shadow.getViewFor(id)
        return (view.findViewById<TextView>(R.id.widget_amount)).text.toString()
    }

    @Test
    fun `with nothing spent today the widget shows zero`() {
        assertEquals("Rs 0", widgetText())
    }

    @Test
    fun `the widget adds up what has gone out today`() = runBlocking {
        val account = repo.state.value.accounts.first().name
        repo.save(
            Entry(id = "", date = repo.today(), type = Type.EXPENSE, account = account,
                lines = listOf(Line(category = "Generator fuel", amountMinor = 186000))),
        )
        repo.save(
            Entry(id = "", date = repo.today(), type = Type.EXPENSE, account = account,
                lines = listOf(Line(category = "Courier", amountMinor = 50000))),
        )
        // yesterday's spending, and money coming in, are not today's spend
        repo.save(
            Entry(id = "", date = java.time.LocalDate.parse(repo.today()).minusDays(1).toString(),
                type = Type.EXPENSE, account = account,
                lines = listOf(Line(category = "Courier", amountMinor = 999900))),
        )
        repo.save(
            Entry(id = "", date = repo.today(), type = Type.INCOME, account = account,
                lines = listOf(Line(category = "Client payment", amountMinor = 5000000))),
        )
        settle { repo.state.value.entries.size == 4 }
        assertEquals("Rs 2,360", widgetText())
    }

    @Test
    fun `a voided entry stops counting towards today`() = runBlocking {
        val account = repo.state.value.accounts.first().name
        repo.save(
            Entry(id = "void-me", date = repo.today(), type = Type.EXPENSE, account = account,
                lines = listOf(Line(category = "Courier", amountMinor = 70000))),
        )
        settle { repo.state.value.entries.isNotEmpty() }
        assertEquals("Rs 700", widgetText())
        repo.void("void-me")
        settle { repo.state.value.entries.first().status == "Void" }
        assertEquals("Rs 0", widgetText())
    }

    @Test
    fun `the widget buttons carry the right instruction`() {
        val intent = Intent(app, MainActivity::class.java).apply {
            action = QuickEntryWidget.QUICK_ENTRY
            putExtra(QuickEntryWidget.EXTRA_KIND, Type.EXPENSE)
        }
        assertEquals(QuickEntryWidget.QUICK_ENTRY, intent.action)
        assertEquals(Type.EXPENSE, intent.getStringExtra(QuickEntryWidget.EXTRA_KIND))
    }

    @Test
    fun `being opened from the widget drops straight into a new expense`() {
        val vm = Vm(app)
        vm.setPref("me", "Ali")
        settle { repo.state.value.prefs.onboarded }
        val asked = mutableStateOf<String?>(Type.EXPENSE)

        compose.setContent { LedgerTheme { App(vm, asked) } }
        repeat(12) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            Thread.sleep(20)
        }

        assertNotNull("the entry sheet is already open", vm.ui.value.draft)
        assertEquals(Type.EXPENSE, vm.ui.value.draft!!.type)
        assertTrue("and the instruction is not repeated", asked.value == null)
    }

    @Test
    fun `being opened from the widget for a payment in opens that instead`() {
        val vm = Vm(app)
        vm.setPref("me", "Ali")
        settle { repo.state.value.prefs.onboarded }
        val asked = mutableStateOf<String?>(Type.INCOME)

        compose.setContent { LedgerTheme { App(vm, asked) } }
        repeat(12) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            Thread.sleep(20)
        }
        assertEquals(Type.INCOME, vm.ui.value.draft!!.type)
    }

    @Test
    fun `asking for a refresh with no widget on the screen is harmless`() {
        QuickEntryWidget.refresh(app)
        shadowOf(Looper.getMainLooper()).idle()
    }
}
