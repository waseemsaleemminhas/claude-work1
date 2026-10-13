package pk.ironclad.ledger.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Ignore
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** The ledger as it sits on this phone. Everything works from here, online or not. */
@Entity(tableName = "entries")
data class EntryRow(
    @PrimaryKey val id: String,
    val date: String,
    val type: String,
    val status: String,
    val totalMinor: Long,
    val account: String,
    val toAccount: String,
    val vendor: String,
    val reference: String,
    val note: String,
    val enteredBy: String,
    val at: Long,
    val lines: List<Line>,
    val updatedAt: Long,
    /** true until the server has acknowledged this version of the row. */
    val dirty: Boolean = true,
) {
    fun toEntry() = Entry(id, date, type, status, totalMinor, account, toAccount, vendor,
        reference, note, enteredBy, at, lines, updatedAt)

    companion object {
        fun of(e: Entry, dirty: Boolean = true) = EntryRow(
            e.id, e.date, e.type, e.status, e.totalMinor, e.account, e.toAccount, e.vendor,
            e.reference, e.note, e.enteredBy, e.at, e.lines, e.updatedAt, dirty,
        )
    }
}

/**
 * Kept, unused, so that upgrading does not change the database and throw away
 * what is already in it. The ledger is one book for the whole company for now.
 */
@Entity(tableName = "campaigns")
data class CampaignRow(
    @PrimaryKey val id: String, val name: String, val client: String, val code: String,
    val kind: String, val status: String, val seats: Int, val agents: Int,
    val icon: String, val colour: String, val updatedAt: Long,
) {
    fun toCampaign() = Campaign(id, name, client, code, kind, status, seats, agents, icon, colour, updatedAt)
    companion object {
        fun of(c: Campaign) = CampaignRow(c.id, c.name, c.client, c.code, c.kind, c.status,
            c.seats, c.agents, c.icon, c.colour, c.updatedAt)
    }
}

@Entity(tableName = "categories")
data class CategoryRow(
    @PrimaryKey val id: String, val name: String, val groupName: String, val kind: String,
    val icon: String, val colour: String, val rule: String, val costCentre: String,
    val budgetMinor: Long, val isNew: Boolean, val mergedInto: String, val archived: Boolean,
    val sort: Int, val updatedAt: Long,
) {
    fun toCategory() = Category(id, name, groupName, kind, icon, colour, rule, costCentre,
        budgetMinor, isNew, mergedInto, archived, sort, updatedAt)

    companion object {
        fun of(c: Category) = CategoryRow(c.id, c.name, c.group, c.kind, c.icon, c.colour,
            c.rule, c.costCentre, c.budgetMinor, c.isNew, c.mergedInto, c.archived, c.sort, c.updatedAt)
    }
}

@Entity(tableName = "accounts")
data class AccountRow(
    @PrimaryKey val id: String, val name: String, val kind: String, val heldBy: String,
    val openingMinor: Long, val icon: String, val colour: String, val archived: Boolean,
    val updatedAt: Long,
) {
    fun toAccount() = Account(id, name, kind, heldBy, openingMinor, icon, colour, archived, updatedAt)
    companion object {
        fun of(a: Account) = AccountRow(a.id, a.name, a.kind, a.heldBy, a.openingMinor,
            a.icon, a.colour, a.archived, a.updatedAt)
    }
}

@Entity(tableName = "rules")
data class RuleRow(
    @PrimaryKey val id: String, val name: String, val method: String, val version: Int,
    val updatedAt: Long,
) {
    fun toRule() = Rule(id, name, method, version, updatedAt)
    companion object { fun of(r: Rule) = RuleRow(r.id, r.name, r.method, r.version, r.updatedAt) }
}

@Entity(tableName = "meta")
data class MetaRow(@PrimaryKey val key: String, val value: String)

class Converters {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @TypeConverter
    fun linesToJson(lines: List<Line>): String =
        json.encodeToString(ListSerializer(Line.serializer()), lines)

    @TypeConverter
    fun jsonToLines(text: String): List<Line> =
        if (text.isBlank()) emptyList()
        else runCatching { json.decodeFromString(ListSerializer(Line.serializer()), text) }
            .getOrDefault(emptyList())
}

@Dao
interface LedgerDao {
    @Query("SELECT * FROM entries ORDER BY date DESC, at DESC")
    fun watchEntries(): Flow<List<EntryRow>>

    @Query("SELECT * FROM entries WHERE id = :id")
    suspend fun entry(id: String): EntryRow?

    @Query("SELECT * FROM entries WHERE dirty = 1")
    suspend fun dirtyEntries(): List<EntryRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putEntry(row: EntryRow)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putEntries(rows: List<EntryRow>)

    @Query("UPDATE entries SET dirty = 0 WHERE id IN (:ids)")
    suspend fun markClean(ids: List<String>)

    @Query("SELECT * FROM campaigns ORDER BY name")
    fun watchCampaigns(): Flow<List<CampaignRow>>

    @Query("SELECT * FROM categories ORDER BY sort, name")
    fun watchCategories(): Flow<List<CategoryRow>>

    @Query("SELECT * FROM accounts ORDER BY name")
    fun watchAccounts(): Flow<List<AccountRow>>

    @Query("SELECT * FROM rules ORDER BY name")
    fun watchRules(): Flow<List<RuleRow>>

    @Query("SELECT * FROM meta")
    fun watchMeta(): Flow<List<MetaRow>>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCampaigns(rows: List<CampaignRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCategories(rows: List<CategoryRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putAccounts(rows: List<AccountRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putRules(rows: List<RuleRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putMeta(row: MetaRow)

    @Query("SELECT COUNT(*) FROM categories") suspend fun categoryCount(): Int

    /** What has gone out on one day — the figure the home-screen widget shows. */
    @Query("SELECT SUM(totalMinor) FROM entries WHERE type = 'Expense' AND status != 'Void' AND date = :date")
    suspend fun spentOn(date: String): Long?
    @Query("SELECT value FROM meta WHERE key = :key") suspend fun meta(key: String): String?
}

@Database(
    entities = [EntryRow::class, CampaignRow::class, CategoryRow::class, AccountRow::class,
        RuleRow::class, MetaRow::class],
    version = 1,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class LedgerDb : RoomDatabase() {
    abstract fun dao(): LedgerDao

    companion object {
        @Volatile private var instance: LedgerDb? = null

        fun get(context: Context): LedgerDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext, LedgerDb::class.java, "ledger.db",
            ).fallbackToDestructiveMigration().build().also { instance = it }
        }

        /** Tests start from a clean book, the way a fresh install does. */
        fun resetForTests() = synchronized(this) { instance = null }
    }
}
