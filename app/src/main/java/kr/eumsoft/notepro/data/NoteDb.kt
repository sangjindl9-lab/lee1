package kr.eumsoft.notepro.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

/**
 * 기기 내부 SQLite 데이터베이스.
 * - WAL + synchronous=FULL : 커밋된 트랜잭션은 앱 강제 종료·전원 차단에도 보존된다.
 * - 마이그레이션은 MIGRATIONS 목록으로 단계별 적용, 적용 전 DB 파일을 backups/에 복사(롤백용).
 */
class NoteDb(private val context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
        db.execSQL("PRAGMA synchronous=FULL")
    }

    override fun onCreate(db: SQLiteDatabase) {
        for (v in 1..VERSION) MIGRATIONS[v]?.forEach { db.execSQL(it) }
        markApplied(db, 1, VERSION)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        for (v in (oldVersion + 1)..newVersion) MIGRATIONS[v]?.forEach { db.execSQL(it) }
        markApplied(db, oldVersion + 1, newVersion)
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // 데이터 보호: 구버전 앱으로 내려가도 DB를 지우지 않는다.
        // 롤백은 backups/ 폴더의 마이그레이션 직전 사본으로만 수행(문서 docs/MIGRATIONS.md 참고).
        throw IllegalStateException("Database version $oldVersion is newer than app ($newVersion). Update the app.")
    }

    private fun markApplied(db: SQLiteDatabase, from: Int, to: Int) {
        val now = System.currentTimeMillis()
        for (v in from..to) db.execSQL("INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES($v, $now)")
    }

    companion object {
        const val NAME = "notepro.db"
        const val VERSION = 3

        /** 버전별 마이그레이션 SQL. 이미 출시된 버전의 SQL은 절대 수정하지 않는다. */
        val MIGRATIONS: Map<Int, List<String>> = mapOf(
            1 to listOf(
                """CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)""",
                """CREATE TABLE notebook_folders(
                    id TEXT PRIMARY KEY, parent_id TEXT REFERENCES notebook_folders(id),
                    name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0)""",
                """CREATE TABLE notebooks(
                    id TEXT PRIMARY KEY, folder_id TEXT REFERENCES notebook_folders(id),
                    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_color INTEGER NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, is_infinite INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, opened_at INTEGER NOT NULL DEFAULT 0,
                    deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)""",
                """CREATE INDEX idx_notebooks_folder ON notebooks(folder_id, deleted)""",
                """CREATE INDEX idx_notebooks_opened ON notebooks(opened_at)""",
                """CREATE TABLE attachments(
                    id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id),
                    kind TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0)""",
                """CREATE INDEX idx_attachments_nb ON attachments(notebook_id)""",
                """CREATE TABLE pages(
                    id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id),
                    page_index INTEGER NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
                    paper TEXT NOT NULL, template TEXT NOT NULL, bg_type INTEGER NOT NULL DEFAULT 0,
                    attachment_id TEXT REFERENCES attachments(id), pdf_page INTEGER NOT NULL DEFAULT -1,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)""",
                """CREATE INDEX idx_pages_nb ON pages(notebook_id, deleted, page_index)""",
                """CREATE TABLE pen_strokes(
                    id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), notebook_id TEXT NOT NULL,
                    pen INTEGER NOT NULL, color INTEGER NOT NULL, width REAL NOT NULL, opacity REAL NOT NULL,
                    shape INTEGER NOT NULL DEFAULT 0, points BLOB NOT NULL,
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)""",
                """CREATE INDEX idx_strokes_page ON pen_strokes(page_id, deleted)""",
                """CREATE INDEX idx_strokes_nb ON pen_strokes(notebook_id)""",
                """CREATE TABLE document_versions(
                    id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id), reason TEXT NOT NULL,
                    file_name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
                    page_count INTEGER NOT NULL, stroke_count INTEGER NOT NULL, created_at INTEGER NOT NULL)""",
                """CREATE INDEX idx_versions_nb ON document_versions(notebook_id, created_at)""",
                // 서버 동기화용 변경 작업 기록(아웃박스). 2단계 동기화가 이 표를 전송한다.
                """CREATE TABLE sync_operations(
                    op_id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, page_id TEXT, entity_id TEXT,
                    op_type TEXT NOT NULL, device_id TEXT NOT NULL, created_at INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending')""",
                """CREATE INDEX idx_syncops_status ON sync_operations(status, created_at)""",
                """CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)""",
                """CREATE TABLE note_tags(
                    notebook_id TEXT NOT NULL REFERENCES notebooks(id), tag_id TEXT NOT NULL REFERENCES tags(id),
                    created_at INTEGER NOT NULL, PRIMARY KEY(notebook_id, tag_id))""",
                """CREATE TABLE app_errors(
                    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT NOT NULL,
                    message TEXT NOT NULL, detail TEXT)""",
            ),
            // v2: 서버 동기화(2단계). 기존 기록은 대상 종류가 없으므로, 모든 대상을 새로 전송 대기에 올린다
            //     → 비회원으로 쓰던 노트도 로그인하면 그대로 계정에 연결된다.
            2 to listOf(
                "ALTER TABLE notebook_folders ADD COLUMN server_rev INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE notebooks ADD COLUMN server_rev INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE pages ADD COLUMN server_rev INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE pen_strokes ADD COLUMN server_rev INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE attachments ADD COLUMN server_rev INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE attachments ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE sync_operations ADD COLUMN entity_type TEXT",
                "ALTER TABLE sync_operations ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE sync_operations ADD COLUMN last_error TEXT",
                "UPDATE sync_operations SET status='superseded' WHERE entity_type IS NULL",
                "CREATE INDEX idx_syncops_entity ON sync_operations(entity_id, status)",
                """INSERT INTO sync_operations(op_id, notebook_id, entity_id, entity_type, op_type, device_id, created_at, status)
                   SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), id, id, 'folder', CASE deleted WHEN 1 THEN 'delete' ELSE 'upsert' END, 'migrated', created_at, 'pending' FROM notebook_folders""",
                """INSERT INTO sync_operations(op_id, notebook_id, entity_id, entity_type, op_type, device_id, created_at, status)
                   SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), id, id, 'notebook', 'upsert', 'migrated', created_at, 'pending' FROM notebooks""",
                """INSERT INTO sync_operations(op_id, notebook_id, entity_id, entity_type, op_type, device_id, created_at, status)
                   SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), notebook_id, id, 'attachment', 'upsert', 'migrated', created_at, 'pending' FROM attachments""",
                """INSERT INTO sync_operations(op_id, notebook_id, entity_id, entity_type, op_type, device_id, created_at, status)
                   SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), notebook_id, id, 'page', 'upsert', 'migrated', created_at, 'pending' FROM pages""",
                """INSERT INTO sync_operations(op_id, notebook_id, entity_id, entity_type, op_type, device_id, created_at, status)
                   SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), notebook_id, id, 'stroke', CASE deleted WHEN 1 THEN 'delete' ELSE 'upsert' END, 'migrated', created_at, 'pending' FROM pen_strokes""",
                """CREATE TABLE sync_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)""",
            ),
            // v3: 문서 기능 — 페이지 회전·북마크, 텍스트 주석(사용자/AI), 검색용 페이지 글자(PDF·OCR·손글씨 인식)
            3 to listOf(
                "ALTER TABLE pages ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE pages ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0",
                """CREATE TABLE page_elements(
                    id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id), notebook_id TEXT NOT NULL,
                    kind TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, text TEXT NOT NULL,
                    color INTEGER NOT NULL, size REAL NOT NULL, author TEXT NOT NULL DEFAULT 'user',
                    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
                    server_rev INTEGER NOT NULL DEFAULT 0)""",
                "CREATE INDEX idx_elements_page ON page_elements(page_id, deleted)",
                """CREATE TABLE page_text(
                    page_id TEXT NOT NULL, source TEXT NOT NULL, notebook_id TEXT NOT NULL, text TEXT NOT NULL,
                    updated_at INTEGER NOT NULL, PRIMARY KEY(page_id, source))""",
                "CREATE INDEX idx_page_text_nb ON page_text(notebook_id)",
            ),
        )

        /** 마이그레이션 전 롤백용 사본. */
        fun backupBeforeMigration(context: Context) {
            val f = context.getDatabasePath(NAME)
            if (!f.exists()) return
            val current = try {
                SQLiteDatabase.openDatabase(f.path, null, SQLiteDatabase.OPEN_READONLY).use { it.version }
            } catch (e: Exception) { return }
            if (current in 1 until VERSION) {
                val dir = File(context.filesDir, "backups").apply { mkdirs() }
                for (suffix in listOf("", "-wal", "-shm")) {
                    val src = File(f.path + suffix)
                    if (src.exists()) src.copyTo(File(dir, "notepro-v$current.db$suffix"), overwrite = true)
                }
            }
        }
    }
}
