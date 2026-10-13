package pk.ironclad.ledger

import android.app.Application
import pk.ironclad.ledger.data.Sync

class LedgerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Crash.install(this)
        // A standing round, so each of us sees the other's entries without asking.
        Sync.schedule(this)
    }
}
