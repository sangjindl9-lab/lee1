package kr.eumsoft.quick.core

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Clip(
    val id: Long, val text: String, val kind: String, val folder: String, val title: String,
    val pinned: Boolean, val source: String, val created: Long
)

data class Capture(val id: Long, val uri: String, val origUri: String, val name: String, val pkg: String, val created: Long)

/** 클립·캡처 기록. 기기 내부 SQLite에만 저장한다. */
class Db private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "eum.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE clips(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, kind TEXT NOT NULL, " +
                "folder TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, " +
                "source TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE captures(id INTEGER PRIMARY KEY AUTOINCREMENT, uri TEXT NOT NULL, orig_uri TEXT NOT NULL DEFAULT '', " +
                "name TEXT NOT NULL, pkg TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)"
        )
        db.execSQL("CREATE TABLE seq(id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL, text TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    enum class AddResult { SAVED, MOVED, EMPTY, SENSITIVE, PAUSED }

    /** 최근 클립 저장. 같은 내용은 새로 만들지 않고 최근으로 올린다. */
    fun addRecent(text: String, source: String, prefs: Prefs, force: Boolean = false): AddResult {
        if (text.isBlank()) return AddResult.EMPTY
        if (prefs.collectPaused && !force) return AddResult.PAUSED
        if (prefs.excludeSensitive && !force && TextTools.sensitiveReason(text) != null) return AddResult.SENSITIVE
        val db = writableDatabase
        val now = System.currentTimeMillis()
        db.rawQuery("SELECT id FROM clips WHERE kind='recent' AND text=? LIMIT 1", arrayOf(text)).use { c ->
            if (c.moveToFirst()) {
                db.execSQL("UPDATE clips SET created=? WHERE id=?", arrayOf<Any>(now, c.getLong(0)))
                return AddResult.MOVED
            }
        }
        db.insert("clips", null, ContentValues().apply {
            put("text", text); put("kind", "recent"); put("source", source); put("created", now)
        })
        // 최근 기록은 고정되지 않은 것 기준 200개까지만 보관
        db.execSQL(
            "DELETE FROM clips WHERE kind='recent' AND pinned=0 AND id NOT IN " +
                "(SELECT id FROM clips WHERE kind='recent' AND pinned=0 ORDER BY created DESC LIMIT 200)"
        )
        return AddResult.SAVED
    }

    fun addItem(text: String, kind: String, folder: String = "", title: String = ""): Long =
        writableDatabase.insert("clips", null, ContentValues().apply {
            put("text", text); put("kind", kind); put("folder", folder); put("title", title)
            put("source", "직접 등록"); put("created", System.currentTimeMillis())
        })

    private fun clipOf(c: Cursor) = Clip(
        c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4),
        c.getInt(5) != 0, c.getString(6), c.getLong(7)
    )

    private fun clips(where: String, args: Array<String>, order: String, limit: Int): List<Clip> {
        val out = ArrayList<Clip>()
        readableDatabase.rawQuery(
            "SELECT id,text,kind,folder,title,pinned,source,created FROM clips WHERE $where ORDER BY $order LIMIT $limit", args
        ).use { c -> while (c.moveToNext()) out.add(clipOf(c)) }
        return out
    }

    /** 패널용 최근 클립 (고정 항목 우선) */
    fun recent(limit: Int = 5) = clips("kind='recent'", arrayOf(), "pinned DESC, created DESC", limit)
    fun favorites(folder: String?) =
        if (folder == null) clips("kind='fav'", arrayOf(), "folder, created DESC", 500)
        else clips("kind='fav' AND folder=?", arrayOf(folder), "created DESC", 500)
    fun templates() = clips("kind='tpl'", arrayOf(), "created DESC", 500)
    fun search(q: String, kind: String) =
        clips("kind=? AND (text LIKE ? OR title LIKE ?)", arrayOf(kind, "%$q%", "%$q%"), "pinned DESC, created DESC", 500)
    fun get(id: Long) = clips("id=?", arrayOf(id.toString()), "id", 1).firstOrNull()

    fun updateText(id: Long, text: String, title: String? = null) {
        val v = ContentValues().apply { put("text", text); if (title != null) put("title", title) }
        writableDatabase.update("clips", v, "id=?", arrayOf(id.toString()))
    }
    fun setPinned(id: Long, pinned: Boolean) =
        writableDatabase.execSQL("UPDATE clips SET pinned=? WHERE id=?", arrayOf<Any>(if (pinned) 1 else 0, id))
    fun delete(id: Long) = writableDatabase.delete("clips", "id=?", arrayOf(id.toString()))
    fun deleteAllRecent() = writableDatabase.delete("clips", "kind='recent'", null)

    /** 보관 기간이 지난 최근 기록 삭제(고정 항목 제외). 삭제 건수 반환 */
    fun purge(days: Int): Int {
        if (days <= 0) return 0
        val limit = System.currentTimeMillis() - days * 86_400_000L
        return writableDatabase.delete("clips", "kind='recent' AND pinned=0 AND created<?", arrayOf(limit.toString()))
    }

    // 순서대로 붙여넣기
    fun sequence(): List<Pair<Long, String>> {
        val out = ArrayList<Pair<Long, String>>()
        readableDatabase.rawQuery("SELECT id,text FROM seq ORDER BY pos, id", null).use { c ->
            while (c.moveToNext()) out.add(c.getLong(0) to c.getString(1))
        }
        return out
    }
    fun setSequence(items: List<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("seq", null, null)
            items.forEachIndexed { i, t -> db.insert("seq", null, ContentValues().apply { put("pos", i); put("text", t) }) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    // 캡처
    fun addCapture(uri: String, origUri: String, name: String, pkg: String): Long =
        writableDatabase.insert("captures", null, ContentValues().apply {
            put("uri", uri); put("orig_uri", origUri); put("name", name); put("pkg", pkg); put("created", System.currentTimeMillis())
        })
    fun captures(): List<Capture> {
        val out = ArrayList<Capture>()
        readableDatabase.rawQuery("SELECT id,uri,orig_uri,name,pkg,created FROM captures ORDER BY created DESC", null).use { c ->
            while (c.moveToNext()) out.add(Capture(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getLong(5)))
        }
        return out
    }
    fun capture(id: Long) = captures().firstOrNull { it.id == id }
    fun updateCapture(id: Long, uri: String, name: String) =
        writableDatabase.update("captures", ContentValues().apply { put("uri", uri); put("name", name) }, "id=?", arrayOf(id.toString()))
    fun deleteCapture(id: Long) = writableDatabase.delete("captures", "id=?", arrayOf(id.toString()))

    companion object {
        @Volatile private var inst: Db? = null
        fun get(ctx: Context): Db = inst ?: synchronized(this) { inst ?: Db(ctx.applicationContext).also { inst = it } }
        val FOLDERS = listOf("개인용", "회사용", "현장용")
    }
}
