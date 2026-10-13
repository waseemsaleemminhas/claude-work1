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
    val myCampaign: String = "",
    val myAccount: String = "",
    val currency: String = "Rs",
    val decimals: Int = 0,
    val endpoint: String = "",
    val code: String = "",
    val lastSync: Long = 0,
) {
    val onboarded: Boolean get() = me.isNotBlank()
    val canSync: Boolean get() = endpoint.isNotBlank()
}

data class LedgerState(
    val ready: Boolean = false,
    val entries: List<Entry> = emptyList(),
    val campaigns: List<Campaign> = emptyList(),
    val categories: List<Category> = emptyList(),
    val accounts: List<Account> = emptyList(),
    val rules: List<Rule> = emptyList(),
    val prefs: Prefs = Prefs(),
) {
    val liveCampaigns: List<Campaign> get() = campaigns.filter { it.live }
    val liveAccounts: List<Account> get() = accounts.filter { !it.archived }

    fun categoriesOf(kind: String, withHidden: Boolean = false): List<Category> =
        categories.filter { it.kind == kind && it.mergedInto.isBlank() && (withHidden || !it.archived) }

    fun category(name: String): Category? = categories.firstOrNull { it.name == name }
    fun campaign(name: String): Campaign? = campaigns.firstOrNull { it.name == name }
    fun account(name: String): Account? = accounts.firstOrNull { it.name == name }

    val drafts: List<Entry> get() = entries.filter { it.status == Status.DRAFT && it.type != Type.TRANSFER }
    val draftMinor: Long get() = drafts.sumOf { it.totalMinor }
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
        dao.watchEntries().map { rows -> rows.map { it.toEntry() } },
        dao.watchCampaigns().map { rows -> rows.map { it.toCampaign() } },
        dao.watchCategories().map { rows -> rows.map { it.toCategory() } },
        dao.watchAccounts().map { rows -> rows.map { it.toAccount() } },
        dao.watchRules().map { rows -> rows.map { it.toRule() } },
    ) { entries, campaigns, categories, accounts, rules ->
        LedgerState(
            ready = categories.isNotEmpty(),
            entries = entries,
            campaigns = campaigns,
            categories = categories,
            accounts = withBalances(accounts, entries),
            rules = rules,
        )
    }.combine(dao.watchMeta()) { partial, meta ->
        val map = meta.associate { it.key to it.value }
        partial.copy(
            prefs = Prefs(
                me = map["me"].orEmpty(),
                myCampaign = map["myCampaign"].orEmpty(),
                myAccount = map["myAccount"].orEmpty(),
                currency = map["currency"] ?: "Rs",
                decimals = map["decimals"]?.toIntOrNull() ?: 0,
                endpoint = map["endpoint"].orEmpty(),
                code = map["code"].orEmpty(),
                lastSync = map["lastSync"]?.toLongOrNull() ?: 0,
            ),
        )
    }.stateIn(scope, SharingStarted.Eagerly, LedgerState())

    init {
        scope.launch { seedIfEmpty() }
    }

    private suspend fun seedIfEmpty() {
        if (dao.categoryCount() > 0) return
        dao.putCategories(Seed.categories.map { CategoryRow.of(it) })
        dao.putRules(Seed.rules.map { RuleRow.of(it) })
        dao.putAccounts(Seed.accounts.map { AccountRow.of(it) })
        dao.putCampaigns(Seed.campaigns.map { CampaignRow.of(it) })
    }

    suspend fun setPref(key: String, value: String) = dao.putMeta(MetaRow(key, value))

    fun today(): String = LocalDate.now().toString()

    /**
     * Writes a voucher. The campaign splits are worked out here and kept with it,
     * so a report of last month never changes when seat counts do. A line that
     * cannot be settled makes the whole voucher a draft: the money still moved,
     * and the entry waits in a queue that wants to be empty.
     */
    suspend fun save(entry: Entry): Entry {
        val now = System.currentTimeMillis()
        val snapshot = state.value
        val existing = entry.id.takeIf { it.isNotBlank() }?.let { dao.entry(it) }

        val settled = if (entry.type == Type.TRANSFER) emptyList() else entry.lines.mapIndexed { i, line ->
            Allocator.settle(line.copy(no = i + 1), snapshot.campaigns, snapshot.rules)
        }
        val total = if (entry.type == Type.TRANSFER) entry.totalMinor else settled.sumOf { it.amountMinor }
        val unsettled = settled.any { !it.allocated }

        val row = EntryRow.of(
            entry.copy(
                id = entry.id.ifBlank { UUID.randomUUID().toString() },
                lines = settled,
                totalMinor = total,
                status = when {
                    entry.status == Status.VOID -> Status.VOID
                    unsettled -> Status.DRAFT
                    else -> Status.RECORDED
                },
                enteredBy = existing?.enteredBy?.ifBlank { snapshot.prefs.me } ?: snapshot.prefs.me,
                at = existing?.at ?: now,
                updatedAt = now,
            ),
        )
        dao.putEntry(row)
        if (row.vendor.isNotBlank()) setPref("lastVendor", row.vendor)
        return row.toEntry()
    }

    /** Nothing is deleted. A wrong entry is voided, and stays visible as voided. */
    suspend fun void(id: String) {
        val row = dao.entry(id) ?: return
        dao.putEntry(row.copy(status = Status.VOID, updatedAt = System.currentTimeMillis(), dirty = true))
    }

    suspend fun addCategory(name: String, kind: String, group: String, icon: String, colour: String, rule: String): Category {
        val category = Category(
            id = "cat-" + UUID.randomUUID().toString().take(8),
            name = name.trim(), group = group, kind = kind, icon = icon, colour = colour,
            rule = rule, isNew = true, sort = 9000, updatedAt = System.currentTimeMillis(),
        )
        dao.putCategories(listOf(CategoryRow.of(category)))
        return category
    }

    suspend fun saveCampaign(campaign: Campaign) =
        dao.putCampaigns(listOf(CampaignRow.of(campaign.copy(updatedAt = System.currentTimeMillis()))))

    suspend fun saveAccount(account: Account) =
        dao.putAccounts(listOf(AccountRow.of(account.copy(updatedAt = System.currentTimeMillis()))))

    suspend fun dirtyEntries(): List<Entry> = dao.dirtyEntries().map { it.toEntry() }

    suspend fun markSynced(ids: List<String>) = dao.markClean(ids)

    /** What the server sent back, written over what we hold, row by row. */
    suspend fun acceptFromServer(entries: List<Entry>, campaigns: List<Campaign>,
                                 categories: List<Category>, accounts: List<Account>, rules: List<Rule>) {
        if (entries.isNotEmpty()) {
            val mine = dao.dirtyEntries().associateBy { it.id }
            // a row we have not pushed yet always wins over the copy coming down
            val keep = entries.filter { mine[it.id] == null }
            if (keep.isNotEmpty()) dao.putEntries(keep.map { EntryRow.of(it, dirty = false) })
        }
        if (campaigns.isNotEmpty()) dao.putCampaigns(campaigns.map { CampaignRow.of(it) })
        if (categories.isNotEmpty()) dao.putCategories(categories.map { CategoryRow.of(it) })
        if (accounts.isNotEmpty()) dao.putAccounts(accounts.map { AccountRow.of(it) })
        if (rules.isNotEmpty()) dao.putRules(rules.map { RuleRow.of(it) })
    }

    companion object {
        @Volatile private var instance: Repo? = null

        fun get(context: Context): Repo = instance ?: synchronized(this) {
            instance ?: Repo(context).also { instance = it }
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
            return accounts.map { it.also { a -> a.balanceMinor = by[a.name] ?: a.openingMinor } }
        }
    }
}
