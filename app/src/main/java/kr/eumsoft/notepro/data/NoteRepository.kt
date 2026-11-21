package kr.eumsoft.notepro.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import kr.eumsoft.notepro.core.CorruptDataException
import kr.eumsoft.notepro.core.FolderData
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.NotebookSnapshot
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.core.StrokeCodec
import java.io.File
import java.util.UUID

/**
 * 모든 DB 읽기·쓰기. 반드시 [Io] 단일 스레드에서 호출한다.
 * 쓰기는 한 트랜잭션 안에서 데이터 + sync_operations(변경 기록)를 함께 커밋 → 둘 중 하나만 남는 일이 없다.
 */
class NoteRepository(private val context: Context, private val helper: NoteDb) {

    val db: SQLiteDatabase get() = helper.writableDatabase
    val deviceId: String by lazy { Prefs(context).deviceId }

    /** 읽다가 손상이 감지된 획 수(마지막 로드 기준). */
    @Volatile var lastCorruptCount = 0

    // ---------------- 폴더 ----------------
    fun folders(): List<FolderData> = db.rawQuery(
        "SELECT id,parent_id,name,created_at,updated_at FROM notebook_folders WHERE deleted=0 ORDER BY name", null,
    ).use { c -> c.map { FolderData(it.getString(0), it.getStringOrNull(1), it.getString(2), it.getLong(3), it.getLong(4)) } }

    fun createFolder(name: String, parentId: String?): String {
        val id = UUID.randomUUID().toString(); val now = now()
        tx {
            db.insertOrThrow("notebook_folders", null, ContentValues().apply {
                put("id", id); put("parent_id", parentId); put("name", name); put("created_at", now); put("updated_at", now)
            })
            op(id, null, id, "folder.create")
        }
        return id
    }

    fun renameFolder(id: String, name: String) = tx {
        db.execSQL("UPDATE notebook_folders SET name=?, updated_at=? WHERE id=?", arrayOf(name, now(), id)); op(id, null, id, "folder.rename")
    }

    /** 폴더 삭제: 안의 노트는 상위(또는 최상위)로 옮긴다 — 노트가 사라지지 않도록. */
    fun deleteFolder(id: String) = tx {
        val parent = db.rawQuery("SELECT parent_id FROM notebook_folders WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) it.getStringOrNull(0) else null }
        db.execSQL("UPDATE notebooks SET folder_id=? WHERE folder_id=?", arrayOf(parent, id))
        db.execSQL("UPDATE notebook_folders SET parent_id=? WHERE parent_id=?", arrayOf(parent, id))
        db.execSQL("UPDATE notebook_folders SET deleted=1, updated_at=? WHERE id=?", arrayOf(now(), id))
        op(id, null, id, "folder.delete")
    }

    // ---------------- 노트 ----------------
    private val nbCols = "id,folder_id,title,description,cover_color,favorite,locked,is_infinite,created_at,updated_at,opened_at,deleted"

    private fun readNb(c: Cursor) = NotebookData(
        c.getString(0), c.getStringOrNull(1), c.getString(2), c.getString(3), c.getInt(4), c.getInt(5) == 1,
        c.getInt(6) == 1, c.getInt(7) == 1, c.getLong(8), c.getLong(9), c.getLong(10), c.getInt(11) == 1,
        tags = tagsOf(c.getString(0)),
    )

    enum class Filter { ALL, FAVORITES, RECENT, TRASH }

    fun notebooks(filter: Filter, folderId: String?, query: String): List<NotebookData> {
        val where = StringBuilder(); val args = ArrayList<String>()
        when (filter) {
            Filter.TRASH -> where.append("deleted=1")
            Filter.FAVORITES -> where.append("deleted=0 AND favorite=1")
            Filter.RECENT -> where.append("deleted=0 AND opened_at>0")
            Filter.ALL -> {
                where.append("deleted=0")
                if (query.isBlank()) { if (folderId == null) where.append(" AND folder_id IS NULL") else { where.append(" AND folder_id=?"); args.add(folderId) } }
            }
        }
        if (query.isNotBlank()) {
            where.append(" AND (title LIKE ? OR description LIKE ? OR id IN (SELECT nt.notebook_id FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE t.name LIKE ?))")
            val q = "%" + query.trim() + "%"; args.add(q); args.add(q); args.add(q)
        }
        val order = if (filter == Filter.RECENT) "opened_at DESC LIMIT 50" else if (filter == Filter.TRASH) "deleted_at DESC" else "updated_at DESC"
        return db.rawQuery("SELECT $nbCols FROM notebooks WHERE $where ORDER BY $order", args.toTypedArray()).use { c -> c.map(::readNb) }
    }

    fun notebook(id: String): NotebookData? =
        db.rawQuery("SELECT $nbCols FROM notebooks WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) readNb(it) else null }

    fun createNotebook(nb: NotebookData, pages: List<PageData>) = tx {
        db.insertOrThrow("notebooks", null, nbValues(nb))
        pages.forEach { db.insertOrThrow("pages", null, pageValues(it)) }
        setTagsInTx(nb.id, nb.tags)
        recordAll(nb.id)
    }

    fun updateNotebookMeta(nb: NotebookData) = tx {
        db.update("notebooks", nbValues(nb.copy(updatedAt = now())), "id=?", arrayOf(nb.id))
        setTagsInTx(nb.id, nb.tags)
        op(nb.id, null, nb.id, "notebook.update")
    }

    fun touchOpened(id: String) = db.execSQL("UPDATE notebooks SET opened_at=? WHERE id=?", arrayOf(now(), id))

    fun moveToTrash(id: String) = tx {
        db.execSQL("UPDATE notebooks SET deleted=1, deleted_at=?, updated_at=? WHERE id=?", arrayOf(now(), now(), id)); op(id, null, id, "notebook.trash")
    }

    fun restoreFromTrash(id: String) = tx {
        // 폴더가 지워졌으면 최상위로 복원
        db.execSQL("UPDATE notebooks SET folder_id=NULL WHERE id=? AND folder_id IN (SELECT id FROM notebook_folders WHERE deleted=1)", arrayOf(id))
        db.execSQL("UPDATE notebooks SET deleted=0, deleted_at=NULL, updated_at=? WHERE id=?", arrayOf(now(), id)); op(id, null, id, "notebook.restore")
    }

    /** 휴지통에서 영구 삭제(사용자가 확인한 경우에만 호출). */
    fun purge(id: String, files: FileStore) {
        val attach = db.rawQuery("SELECT id FROM attachments WHERE notebook_id=?", arrayOf(id)).use { c -> c.map { it.getString(0) } }
        val versions = db.rawQuery("SELECT file_name FROM document_versions WHERE notebook_id=?", arrayOf(id)).use { c -> c.map { it.getString(0) } }
        tx {
            db.execSQL("DELETE FROM pen_strokes WHERE notebook_id=?", arrayOf(id))
            db.execSQL("DELETE FROM pages WHERE notebook_id=?", arrayOf(id))
            db.execSQL("DELETE FROM note_tags WHERE notebook_id=?", arrayOf(id))
            db.execSQL("DELETE FROM document_versions WHERE notebook_id=?", arrayOf(id))
            db.execSQL("DELETE FROM attachments WHERE notebook_id=?", arrayOf(id))
            db.execSQL("DELETE FROM notebooks WHERE id=?", arrayOf(id))
            op(id, null, id, "notebook.purge")
        }
        attach.forEach { files.attachmentFile(it).delete() }
        versions.forEach { files.versionFile(it).delete() }
    }

    fun duplicate(id: String, newTitle: String, files: FileStore): String {
        val snap = snapshot(id) ?: error("notebook missing")
        val newId = UUID.randomUUID().toString(); val now = now()
        val pageMap = snap.pages.associate { it.id to UUID.randomUUID().toString() }
        val attachIds = snap.pages.mapNotNull { it.attachmentId }.distinct()
        val attachMap = attachIds.associateWith { UUID.randomUUID().toString() }
        attachIds.forEach { old -> files.attachmentFile(old).copyTo(files.attachmentFile(attachMap.getValue(old)), overwrite = true) }
        tx {
            db.insertOrThrow("notebooks", null, nbValues(snap.notebook.copy(id = newId, title = newTitle, createdAt = now, updatedAt = now, openedAt = 0, favorite = false)))
            for (old in attachIds) {
                db.rawQuery("SELECT kind,file_name,mime,size,sha256 FROM attachments WHERE id=?", arrayOf(old)).use { c ->
                    if (c.moveToFirst()) db.insertOrThrow("attachments", null, ContentValues().apply {
                        put("id", attachMap.getValue(old)); put("notebook_id", newId); put("kind", c.getString(0)); put("file_name", c.getString(1))
                        put("mime", c.getString(2)); put("size", c.getLong(3)); put("sha256", c.getString(4)); put("created_at", now); put("updated_at", now)
                    })
                }
            }
            snap.pages.forEach { p -> db.insertOrThrow("pages", null, pageValues(p.copy(id = pageMap.getValue(p.id), notebookId = newId, attachmentId = p.attachmentId?.let { attachMap[it] }, createdAt = now, updatedAt = now))) }
            snap.strokes.forEach { s -> db.insertOrThrow("pen_strokes", null, strokeValues(s.copy(id = Stroke.newId(), pageId = pageMap.getValue(s.pageId)), newId)) }
            setTagsInTx(newId, snap.notebook.tags)
            recordAll(newId)
        }
        return newId
    }

    // ---------------- 태그 ----------------
    fun tagsOf(nbId: String): List<String> = db.rawQuery(
        "SELECT t.name FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.notebook_id=? ORDER BY t.name", arrayOf(nbId),
    ).use { c -> c.map { it.getString(0) } }

    fun setTagsInTx(nbId: String, tags: List<String>) {
        db.execSQL("DELETE FROM note_tags WHERE notebook_id=?", arrayOf(nbId))
        for (name in tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct()) {
            var tagId = db.rawQuery("SELECT id FROM tags WHERE name=?", arrayOf(name)).use { if (it.moveToFirst()) it.getString(0) else null }
            if (tagId == null) {
                tagId = UUID.randomUUID().toString()
                db.insertOrThrow("tags", null, ContentValues().apply { put("id", tagId); put("name", name); put("created_at", now()) })
            }
            db.insertOrThrow("note_tags", null, ContentValues().apply { put("notebook_id", nbId); put("tag_id", tagId); put("created_at", now()) })
        }
    }

    // ---------------- 페이지 ----------------
    private val pageCols = "id,notebook_id,page_index,width,height,paper,template,bg_type,attachment_id,pdf_page,created_at,updated_at,deleted"
    private fun readPage(c: Cursor) = PageData(
        c.getString(0), c.getString(1), c.getInt(2), c.getFloat(3), c.getFloat(4), PaperStyle.of(c.getString(5)),
        PageTemplate.of(c.getString(6)), c.getInt(7), c.getStringOrNull(8), c.getInt(9), c.getLong(10), c.getLong(11), c.getInt(12) == 1,
    )

    fun pages(nbId: String, deleted: Boolean = false): List<PageData> = db.rawQuery(
        "SELECT $pageCols FROM pages WHERE notebook_id=? AND deleted=? ORDER BY page_index", arrayOf(nbId, if (deleted) "1" else "0"),
    ).use { c -> c.map(::readPage) }

    fun upsertPages(nbId: String, pages: List<PageData>, opType: String) = tx {
        for (p in pages) upsert("pages", pageValues(p))
        touchNb(nbId)
        for (p in pages) opEntity("page", p.id, nbId, "upsert")
    }

    /** 페이지 삭제(복구 가능). 획은 그대로 둔다. */
    fun deletePage(nbId: String, pageId: String, reindexed: List<PageData>) = tx {
        db.execSQL("UPDATE pages SET deleted=1, deleted_at=?, updated_at=? WHERE id=?", arrayOf(now(), now(), pageId))
        for (p in reindexed) { db.execSQL("UPDATE pages SET page_index=? WHERE id=?", arrayOf(p.index, p.id)); opEntity("page", p.id, nbId, "upsert") }
        touchNb(nbId); op(nbId, pageId, pageId, "page.delete")
    }

    fun restorePage(nbId: String, pageId: String, atIndex: Int) = tx {
        db.execSQL("UPDATE pages SET page_index=page_index+1 WHERE notebook_id=? AND deleted=0 AND page_index>=?", arrayOf(nbId, atIndex))
        db.execSQL("UPDATE pages SET deleted=0, deleted_at=NULL, page_index=?, updated_at=? WHERE id=?", arrayOf(atIndex, now(), pageId))
        touchNb(nbId); recordAllPages(nbId)
    }

    // ---------------- 획 ----------------
    fun strokes(nbId: String): List<Stroke> {
        var corrupt = 0
        val list = db.rawQuery(
            "SELECT s.id,s.page_id,s.pen,s.color,s.width,s.opacity,s.points,s.created_at,s.shape FROM pen_strokes s WHERE s.notebook_id=? AND s.deleted=0 ORDER BY s.created_at",
            arrayOf(nbId),
        ).use { c ->
            val out = ArrayList<Stroke>(c.count)
            while (c.moveToNext()) {
                try {
                    out.add(Stroke(c.getString(0), c.getString(1), PenType.fromCode(c.getInt(2)), c.getInt(3), c.getFloat(4), c.getFloat(5),
                        StrokeCodec.decode(c.getBlob(6)), c.getLong(7), c.getInt(8)))
                } catch (e: CorruptDataException) {
                    corrupt++
                    logError("stroke.corrupt", "${c.getString(0)}: ${e.message}")
                }
            }
            out
        }
        lastCorruptCount = corrupt
        return list
    }

    /** 획 추가·삭제를 한 트랜잭션으로 커밋(지우개 분할, 이동, 되돌리기 모두 이 함수). */
    fun applyStrokes(nbId: String, add: List<Stroke>, remove: List<String>, opType: String) = tx {
        val now = now()
        for (id in remove) db.execSQL("UPDATE pen_strokes SET deleted=1, updated_at=? WHERE id=?", arrayOf(now, id))
        for (s in add) upsert("pen_strokes", strokeValues(s, nbId))
        touchNb(nbId)
        for (st in add) opEntity("stroke", st.id, nbId, "upsert")
        for (id in remove) opEntity("stroke", id, nbId, "delete")
    }

    fun snapshot(nbId: String): NotebookSnapshot? {
        val nb = notebook(nbId) ?: return null
        return NotebookSnapshot(nb, pages(nbId), strokes(nbId))
    }

    /** 스냅샷으로 노트 내용 교체(버전 복원). 지금 내용은 지우지 않고 deleted=1 로만 표시. */
    fun replaceWithSnapshot(s: NotebookSnapshot) = tx {
        val id = s.notebook.id; val now = now()
        db.execSQL("UPDATE pen_strokes SET deleted=1, updated_at=? WHERE notebook_id=?", arrayOf(now, id))
        db.execSQL("UPDATE pages SET deleted=1, deleted_at=? WHERE notebook_id=? AND deleted=0", arrayOf(now, id))
        s.pages.forEach { upsert("pages", pageValues(it.copy(deleted = false))) }
        s.strokes.forEach { upsert("pen_strokes", strokeValues(it, id)) }
        db.update("notebooks", ContentValues().apply { put("title", s.notebook.title); put("updated_at", now) }, "id=?", arrayOf(id))
        recordAll(id)
    }

    /**
     * 백업 가져오기: 같은 ID의 노트가 이미 있으면 노트·페이지·첨부 모두 새 ID로 복사 가져오기
     * (기존 노트를 덮어쓰지 않음). saveAttachment(원래ID, 새ID)는 파일을 실제로 기록한다.
     */
    fun importSnapshot(s: NotebookSnapshot, attachmentRows: List<ContentValues>, suffix: String, saveAttachment: (String, String) -> Unit): String {
        val exists = notebook(s.notebook.id) != null
        fun newIdOr(old: String) = if (exists) UUID.randomUUID().toString() else old
        val nbId = newIdOr(s.notebook.id)
        val pageMap = s.pages.associate { it.id to newIdOr(it.id) }
        val attMap = attachmentRows.associate { it.getAsString("id") to newIdOr(it.getAsString("id")) }
        attMap.forEach { (old, new) -> saveAttachment(old, new) }
        tx {
            val now = now()
            db.insertOrThrow("notebooks", null, nbValues(s.notebook.copy(id = nbId, folderId = null, title = if (exists) s.notebook.title + suffix else s.notebook.title, updatedAt = now)))
            attachmentRows.forEach { cv ->
                val c2 = ContentValues(cv); c2.put("id", attMap.getValue(cv.getAsString("id"))); c2.put("notebook_id", nbId)
                db.insertOrThrow("attachments", null, c2)
            }
            s.pages.forEach { db.insertOrThrow("pages", null, pageValues(it.copy(id = pageMap.getValue(it.id), notebookId = nbId, attachmentId = it.attachmentId?.let { a -> attMap[a] ?: a }))) }
            s.strokes.forEach { st ->
                val pid = pageMap[st.pageId] ?: return@forEach
                db.insertOrThrow("pen_strokes", null, strokeValues(if (exists) st.copy(id = Stroke.newId(), pageId = pid) else st, nbId))
            }
            setTagsInTx(nbId, s.notebook.tags)
            recordAll(nbId)
        }
        return nbId
    }

    // ---------------- 첨부 ----------------
    fun addAttachment(id: String, nbId: String, kind: String, fileName: String, mime: String, size: Long, sha: String) {
        db.insertOrThrow("attachments", null, ContentValues().apply {
            put("id", id); put("notebook_id", nbId); put("kind", kind); put("file_name", fileName); put("mime", mime)
            put("size", size); put("sha256", sha); put("created_at", now()); put("updated_at", now())
        })
    }

    fun attachmentRows(nbId: String): List<ContentValues> = db.rawQuery(
        "SELECT id,kind,file_name,mime,size,sha256,created_at,updated_at FROM attachments WHERE notebook_id=?", arrayOf(nbId),
    ).use { c -> c.map {
        ContentValues().apply {
            put("id", it.getString(0)); put("kind", it.getString(1)); put("file_name", it.getString(2)); put("mime", it.getString(3))
            put("size", it.getLong(4)); put("sha256", it.getString(5)); put("created_at", it.getLong(6)); put("updated_at", it.getLong(7))
        }
    } }

    fun attachmentName(id: String): String? = db.rawQuery("SELECT file_name FROM attachments WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) it.getString(0) else null }

    // ---------------- 버전 ----------------
    class VersionRow(val id: String, val reason: String, val fileName: String, val size: Long, val sha: String, val pages: Int, val strokes: Int, val createdAt: Long)

    fun versions(nbId: String): List<VersionRow> = db.rawQuery(
        "SELECT id,reason,file_name,size,sha256,page_count,stroke_count,created_at FROM document_versions WHERE notebook_id=? ORDER BY created_at DESC", arrayOf(nbId),
    ).use { c -> c.map { VersionRow(it.getString(0), it.getString(1), it.getString(2), it.getLong(3), it.getString(4), it.getInt(5), it.getInt(6), it.getLong(7)) } }

    fun addVersion(r: VersionRow, nbId: String) {
        db.insertOrThrow("document_versions", null, ContentValues().apply {
            put("id", r.id); put("notebook_id", nbId); put("reason", r.reason); put("file_name", r.fileName); put("size", r.size)
            put("sha256", r.sha); put("page_count", r.pages); put("stroke_count", r.strokes); put("created_at", r.createdAt)
        })
    }

    fun deleteVersion(id: String) = db.execSQL("DELETE FROM document_versions WHERE id=?", arrayOf(id))

    // ---------------- 용량·무결성·오류 ----------------
    fun storageBytes(nbId: String, files: FileStore): Long {
        val strokes = db.rawQuery("SELECT COALESCE(SUM(LENGTH(points)),0) FROM pen_strokes WHERE notebook_id=?", arrayOf(nbId)).use { it.moveToFirst(); it.getLong(0) }
        val att = db.rawQuery("SELECT COALESCE(SUM(size),0) FROM attachments WHERE notebook_id=?", arrayOf(nbId)).use { it.moveToFirst(); it.getLong(0) }
        val ver = db.rawQuery("SELECT COALESCE(SUM(size),0) FROM document_versions WHERE notebook_id=?", arrayOf(nbId)).use { it.moveToFirst(); it.getLong(0) }
        return strokes + att + ver
    }

    fun pendingSyncOps(): Int = db.rawQuery("SELECT COUNT(DISTINCT entity_id) FROM sync_operations WHERE status='pending'", null).use { it.moveToFirst(); it.getInt(0) }

    /** PRAGMA quick_check + 전체 획 CRC 검사. 결과 문자열 목록(비어 있으면 정상). */
    fun integrityCheck(): List<String> {
        val problems = ArrayList<String>()
        db.rawQuery("PRAGMA quick_check", null).use { c -> while (c.moveToNext()) { val r = c.getString(0); if (r != "ok") problems.add(r) } }
        db.rawQuery("SELECT id, points FROM pen_strokes WHERE deleted=0", null).use { c ->
            while (c.moveToNext()) {
                try { StrokeCodec.decode(c.getBlob(1)) } catch (e: CorruptDataException) { problems.add("stroke ${c.getString(0)}: ${e.message}") }
            }
        }
        return problems
    }

    fun logError(kind: String, message: String, detail: String? = null) {
        try {
            db.insert("app_errors", null, ContentValues().apply { put("created_at", now()); put("kind", kind); put("message", message.take(2000)); put("detail", detail?.take(20000)) })
        } catch (_: Exception) { }
    }

    fun recentErrors(limit: Int = 50): List<String> = db.rawQuery("SELECT created_at,kind,message FROM app_errors ORDER BY id DESC LIMIT $limit", null)
        .use { c -> c.map { "${it.getLong(0)} [${it.getString(1)}] ${it.getString(2)}" } }

    // ---------------- 내부 ----------------
    private fun touchNb(nbId: String) = db.execSQL("UPDATE notebooks SET updated_at=? WHERE id=?", arrayOf(now(), nbId))

    /** 예전 형식 호출: "folder.x" / "notebook.x" / "page.delete" 등 → 대상 종류로 변환 */
    private fun op(nbId: String, @Suppress("UNUSED_PARAMETER") pageId: String?, entityId: String?, type: String) {
        val kind = type.substringBefore('.')
        val entity = if (kind in setOf("folder", "notebook", "page", "stroke")) kind else "notebook"
        val opType = if (type.endsWith(".delete") && entity != "notebook" || type == "notebook.purge") "delete" else "upsert"
        opEntity(entity, entityId ?: nbId, nbId, opType)
    }

    /** 동기화 아웃박스 기록(대상 하나당 한 줄). 전송 시점에 대상의 현재 상태를 읽어 보낸다. */
    fun opEntity(entityType: String, entityId: String, nbId: String, opType: String) {
        db.insertOrThrow("sync_operations", null, ContentValues().apply {
            put("op_id", UUID.randomUUID().toString()); put("notebook_id", nbId); put("entity_id", entityId); put("entity_type", entityType)
            put("op_type", opType); put("device_id", deviceId); put("created_at", now())
        })
    }

    /** 노트 한 권의 모든 대상을 전송 대기에 올림(복제·복원·가져오기·생성 후). */
    fun recordAll(nbId: String) {
        opEntity("notebook", nbId, nbId, "upsert")
        db.rawQuery("SELECT id FROM attachments WHERE notebook_id=?", arrayOf(nbId)).use { c -> while (c.moveToNext()) opEntity("attachment", c.getString(0), nbId, "upsert") }
        recordAllPages(nbId)
        db.rawQuery("SELECT id FROM pen_strokes WHERE notebook_id=?", arrayOf(nbId)).use { c -> while (c.moveToNext()) opEntity("stroke", c.getString(0), nbId, "upsert") }
    }

    private fun recordAllPages(nbId: String) {
        db.rawQuery("SELECT id FROM pages WHERE notebook_id=?", arrayOf(nbId)).use { c -> while (c.moveToNext()) opEntity("page", c.getString(0), nbId, "upsert") }
    }

    /** FK가 걸린 행을 지우지 않도록 REPLACE 대신 UPDATE→INSERT. */
    fun upsert(table: String, cv: ContentValues) {
        val id = cv.getAsString("id")
        if (db.update(table, cv, "id=?", arrayOf(id)) == 0) db.insertOrThrow(table, null, cv)
    }

    inline fun <T> tx(block: () -> T): T {
        val d = db
        d.beginTransaction()
        try {
            val r = block()
            d.setTransactionSuccessful()
            return r
        } finally {
            d.endTransaction()
        }
    }

    private fun nbValues(n: NotebookData) = ContentValues().apply {
        put("id", n.id); put("folder_id", n.folderId); put("title", n.title); put("description", n.description); put("cover_color", n.coverColor)
        put("favorite", if (n.favorite) 1 else 0); put("locked", if (n.locked) 1 else 0); put("is_infinite", if (n.infinite) 1 else 0)
        put("created_at", n.createdAt); put("updated_at", n.updatedAt); put("opened_at", n.openedAt); put("deleted", if (n.deleted) 1 else 0)
    }

    private fun pageValues(p: PageData) = ContentValues().apply {
        put("id", p.id); put("notebook_id", p.notebookId); put("page_index", p.index); put("width", p.width); put("height", p.height)
        put("paper", p.paper.key); put("template", p.template.key); put("bg_type", p.bgType); put("attachment_id", p.attachmentId)
        put("pdf_page", p.pdfPage); put("created_at", p.createdAt); put("updated_at", p.updatedAt); put("deleted", if (p.deleted) 1 else 0)
    }

    private fun strokeValues(s: Stroke, nbId: String) = ContentValues().apply {
        put("id", s.id); put("page_id", s.pageId); put("notebook_id", nbId); put("pen", s.pen.code); put("color", s.color)
        put("width", s.width); put("opacity", s.opacity); put("shape", s.shape); put("points", StrokeCodec.encode(s.points))
        put("created_at", s.createdAt); put("updated_at", now()); put("deleted", 0)
    }

    companion object {
        fun now() = System.currentTimeMillis()
    }
}

inline fun <T> Cursor.map(f: (Cursor) -> T): List<T> {
    val out = ArrayList<T>(count)
    while (moveToNext()) out.add(f(this))
    return out
}

fun Cursor.getStringOrNull(i: Int): String? = if (isNull(i)) null else getString(i)

/** 앱 내부 파일 위치. 모든 파일은 임시 파일 → fsync → 이름 변경 방식으로 쓴다. */
class FileStore(private val context: Context) {
    val attachmentsDir = File(context.filesDir, "attachments").apply { mkdirs() }
    val versionsDir = File(context.filesDir, "versions").apply { mkdirs() }
    fun attachmentFile(id: String) = File(attachmentsDir, "$id.bin")
    fun versionFile(name: String) = File(versionsDir, name)

    fun writeAtomic(target: File, bytes: ByteArray) = writeAtomic(target) { it.write(bytes) }

    fun writeAtomic(target: File, writer: (java.io.FileOutputStream) -> Unit) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        java.io.FileOutputStream(tmp).use { fos ->
            writer(fos)
            fos.flush()
            fos.fd.sync()
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            if (!tmp.renameTo(target)) throw java.io.IOException("rename failed: $target")
        }
    }
}
