package pk.ironclad.ledger

import android.app.Application

class LedgerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Crash.install(this)
    }
}
