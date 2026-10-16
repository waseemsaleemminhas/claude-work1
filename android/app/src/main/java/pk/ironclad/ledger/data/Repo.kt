package pk.ironclad.ledger.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID

data class Prefs(
    val me: String = "",
    val myAccount: String = "",
    val currency: String = "Rs",
    val decimals: Int = 0,
    val endpoint: String = "",
    val code: String = "",
    val lastSync: Long = 0,
    val sheetUrl: String = "",
    /** What the book refused last time, in its own words. */
    val lastRejected: String = "",
) {
    val onboarded: Boolean get() = me.isNotBlank()
    val canSync: Boolean get() = endpoint.isNotBlank()
}

data class LedgerState(
    val ready: Boolean = false,
    val entries: List<Entry> = emptyList(),
    /** Entries still waiting to reach the shared book. */
    val unsent: Set<String> = emptySet(),
    val categories: List<Category> = emptyList(),
    val accounts: List<Account> = emptyList(),
    val prefs: Prefs = Prefs(),
) {
    val liveAccounts: List<Account> get() = accounts.filter { !it.archived }

    fun categoriesOf(kind: String, withHidden: Boolean = false): List<Category> =
        categories.filter { it.kind == kind && it.mergedInto.isBlank() && (withHidden || !it.archived) }

    fun category(name: String): Category? = categories.firstOrNull { it.name == name }
    fun account(name: String): Account? = accounts.firstOrNull { it.name == name }

    val totalHeldMinor: Long get() = liveAccounts.sumOf { it.balanceMinor }

    fun money(minor: Long): String = Money.format(minor, prefs.currency, prefs.decimals)
    fun signed(minor: Long, type: String): String = Money.signed(minor, type, prefs.currency, prefs.decimals)
}

/**
 * The ledger on this phone. Every read and every write happens here, with no
 * network in the way — syncing is something that happens later, in the background,
 * and never stands between a person and an entry they are trying to put in.
 */
class Repo private constructor(context: Context) {

    private val dao = LedgerDb.get(context).dao()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val state: StateFlow<LedgerState> = combine(
        dao.watchEntries().map { rows ->
            rows.map { it.toEntry() } to rows.filter { it.dirty }.map { it.id }.toSet()
        },
        dao.watchCategories().map { rows -> rows.map { it.toCategory() } },
        dao.watchAccounts().map { rows -> rows.map { it.toAccount() } },
        dao.watchMeta(),
    ) { both, categories, accounts, meta ->
        val (entries, unsent) = both
        val map = meta.associate { it.key to it.value }
        LedgerState(
            ready = categories.isNotEmpty(),
            entries = entries,
            unsent = unsent,
            categories = categories,
            accounts = withBalances(accounts, entries),
            prefs = Prefs(
                me = map["me"].orEmpty(),
                myAccount = map["myAccount"].orEmpty(),
                currency = map["currency"] ?: "Rs",
                decimals = map["decimals"]?.toIntOrNull() ?: 0,
                endpoint = map["endpoint"].orEmpty(),
                code = map["code"].orEmpty(),
                lastSync = map["lastSync"]?.toLongOrNull() ?: 0,
                sheetUrl = map["sheetUrl"].orEmpty(),
                lastRejected = map["lastRejected"].orEmpty(),
            ),
        )
    }.stateIn(scope, SharingStarted.Eagerly, LedgerState())

    init {
        scope.launch { seedIfEmpty() }
    }

    private suspend fun seedIfEmpty() {
        if (dao.categoryCount() > 0) return
        dao.putCategories(Seed.categories.map { CategoryRow.of(it) })
        dao.putAccounts(Seed.accounts.map { AccountRow.of(it) })
    }

    suspend fun setPref(key: String, value: String) = dao.putMeta(MetaRow(key, value))

    fun today(): String = LocalDate.now().toString()

    /** Writes a voucher. One book for the whole company: a line is a category and an amount. */
    suspend fun save(entry: Entry): Entry {
        val now = System.currentTimeMillis()
        val snapshot = state.value
        val existing = entry.id.takeIf { it.isNotBlank() }?.let { dao.entry(it) }

        val lines = if (entry.type == Type.TRANSFER) emptyList()
        else entry.lines.mapIndexed { i, line -> line.copy(no = i + 1) }
        val total = if (entry.type == Type.TRANSFER) entry.totalMinor else lines.sumOf { it.amountMinor }

        val row = EntryRow.of(
            entry.copy(
                id = entry.id.ifBlank { UUID.randomUUID().toString() },
                lines = lines,
                totalMinor = total,
                status = if (entry.status == Status.VOID) Status.VOID else Status.RECORDED,
                enteredBy = existing?.enteredBy?.ifBlank { snapshot.prefs.me } ?: snapshot.prefs.me,
                at = existing?.at ?: now,
                updatedAt = now,
            ),
        )
        dao.putEntry(row)
        return row.toEntry()
    }

    /** Nothing is deleted. A wrong entry is voided, and stays visible as voided. */
    suspend fun void(id: String) {
        val row = dao.entry(id) ?: return
        dao.putEntry(row.copy(status = Status.VOID, updatedAt = System.currentTimeMillis(), dirty = true))
    }

    suspend fun addCategory(name: String, kind: String, group: String, icon: String, colour: String): Category {
        val category = Category(
            id = "cat-" + UUID.randomUUID().toString().take(8),
            name = name.trim(), group = group, kind = kind, icon = icon, colour = colour,
            isNew = true, sort = 9000, updatedAt = System.currentTimeMillis(),
        )
        dao.putCategories(listOf(CategoryRow.of(category)))
        return category
    }

    suspend fun saveAccount(account: Account) =
        dao.putAccounts(listOf(AccountRow.of(account.copy(updatedAt = System.currentTimeMillis()))))

    suspend fun dirtyEntries(): List<Entry> = dao.dirtyEntries().map { it.toEntry() }

    /** Categories somebody invented on this phone that the shared book has not seen. */
    suspend fun unsentCategories(): List<Category> = dao.unsentCategories().map { it.toCategory() }

    suspend fun markSynced(ids: List<String>) = dao.markClean(ids)

    /** What the server sent back, written over what we hold, row by row. */
    suspend fun acceptFromServer(
        entries: List<Entry>,
        categories: List<Category>,
        accounts: List<Account>,
    ) {
        if (entries.isNotEmpty()) {
            val mine = dao.dirtyEntries().associateBy { it.id }
            // a row we have not pushed yet always wins over the copy coming down
            val keep = entries.filter { mine[it.id] == null }
            if (keep.isNotEmpty()) dao.putEntries(keep.map { EntryRow.of(it, dirty = false) })
        }
        if (categories.isNotEmpty()) {
            dao.putCategories(categories.map { CategoryRow.of(it) })
            // The book keeps its own ids. Where a name we already hold now has a
            // copy from the book, our own row goes: entries point at names, so
            // nothing breaks, and the picker shows one of each instead of two.
            dropOurOwn(categories.map { it.id to it.name }, dao.allCategories().map { it.id to it.name })
                .let { if (it.isNotEmpty()) dao.dropCategories(it) }
        }
        if (accounts.isNotEmpty()) {
            dao.putAccounts(accounts.map { AccountRow.of(it) })
            dropOurOwn(accounts.map { it.id to it.name }, dao.allAccounts().map { it.id to it.name })
                .let { if (it.isNotEmpty()) dao.dropAccounts(it) }
        }
    }

    /** Local ids for names the book has now given an id of its own. */
    private fun dropOurOwn(theirs: List<Pair<String, String>>, ours: List<Pair<String, String>>): List<String> {
        val byName = theirs.associate { (id, name) -> name.trim().lowercase() to id }
        return ours.filter { (id, name) ->
            val canonical = byName[name.trim().lowercase()]
            canonical != null && canonical != id
        }.map { it.first }
    }

    companion object {
        @Volatile private var instance: Repo? = null

        fun get(context: Context): Repo = instance ?: synchronized(this) {
            instance ?: Repo(context).also { instance = it }
        }

        fun resetForTests() = synchronized(this) {
            instance = null
            LedgerDb.resetForTests()
        }

        /** Opening balance, plus what came in, less what went out. Voided rows count for nothing. */
        fun withBalances(accounts: List<Account>, entries: List<Entry>): List<Account> {
            val by = accounts.associate { it.name to it.openingMinor }.toMutableMap()
            entries.forEach { e ->
                if (e.status == Status.VOID) return@forEach
                when (e.type) {
                    Type.INCOME -> by[e.account]?.let { by[e.account] = it + e.totalMinor }
                    Type.EXPENSE -> by[e.account]?.let { by[e.account] = it - e.totalMinor }
                    Type.TRANSFER -> {
                        by[e.account]?.let { by[e.account] = it - e.totalMinor }
                        by[e.toAccount]?.let { by[e.toAccount] = it + e.totalMinor }
                    }
                }
            }
            // A fresh object per reckoning: the balance is a var, and handing the
            // same instance to two of these would let one overwrite the other.
            return accounts.map { it.copy().also { a -> a.balanceMinor = by[a.name] ?: a.openingMinor } }
        }
    }
}
