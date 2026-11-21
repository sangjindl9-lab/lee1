package kr.eumsoft.notepro.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import kr.eumsoft.notepro.core.BackupArchive
import kr.eumsoft.notepro.core.BackupCrypto
import kr.eumsoft.notepro.core.SnapshotCodec
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 전체 노트 백업(.npbak, AES-256-GCM 암호화) 만들기·가져오기.
 * 가져오기는 항목별 SHA-256 검증을 모두 통과해야 DB에 반영된다.
 */
class BackupManager(private val context: Context, private val repo: NoteRepository, private val files: FileStore) {

    class Result(val notebooks: Int, val attachments: Int, val bytes: Long)

    fun export(target: Uri, password: CharArray, includeTrash: Boolean): Result {
        val entries = ArrayList<BackupArchive.Entry>()
        val ids = repo.notebooks(NoteRepository.Filter.ALL, null, "").map { it.id }.toMutableSet()
        // 폴더 안 노트 포함(Filter.ALL은 최상위만 돌려주므로 전체 조회)
        repo.db.rawQuery("SELECT id FROM notebooks WHERE deleted=0" + if (includeTrash) " OR deleted=1" else "", null).use { c -> while (c.moveToNext()) ids.add(c.getString(0)) }
        var att = 0
        val folders = StringBuilder()
        repo.folders().forEach { folders.append(it.id).append('\t').append(it.parentId ?: "").append('\t').append(it.name.replace('\t', ' ').replace('\n', ' ')).append('\n') }
        entries.add(BackupArchive.Entry("folders.tsv", folders.toString().toByteArray()))
        val folderOf = StringBuilder()
        for (id in ids) {
            val snap = repo.snapshot(id) ?: continue
            entries.add(BackupArchive.Entry("notebooks/$id.snap", SnapshotCodec.encode(snap)))
            folderOf.append(id).append('\t').append(snap.notebook.folderId ?: "").append('\n')
            for (row in repo.attachmentRows(id)) {
                val aid = row.getAsString("id")
                val f = files.attachmentFile(aid)
                if (!f.exists()) continue
                entries.add(BackupArchive.Entry("attachments/$aid.bin", f.readBytes()))
                entries.add(BackupArchive.Entry("attachments/$aid.meta", meta(row).toByteArray()))
                att++
            }
        }
        entries.add(BackupArchive.Entry("notebook_folders.tsv", folderOf.toString().toByteArray()))
        val zip = ByteArrayOutputStream()
        BackupArchive.write(zip, entries, System.currentTimeMillis())
        val tmp = File(context.cacheDir, "backup.tmp")
        tmp.outputStream().use { BackupCrypto.encrypt(ByteArrayInputStream(zip.toByteArray()), it, password) }
        // 만든 직후 다시 열어 검증(백업 무결성 검사)
        tmp.inputStream().use { inp -> val out = ByteArrayOutputStream(); BackupCrypto.decrypt(inp, out, password); BackupArchive.read(ByteArrayInputStream(out.toByteArray())) }
        context.contentResolver.openOutputStream(target, "w")?.use { o -> tmp.inputStream().use { it.copyTo(o) } } ?: error("cannot open target")
        val size = tmp.length(); tmp.delete()
        return Result(ids.size, att, size)
    }

    fun import(source: Uri, password: CharArray, copySuffix: String): Result {
        val plain = ByteArrayOutputStream()
        context.contentResolver.openInputStream(source)?.use { BackupCrypto.decrypt(it, plain, password) } ?: error("cannot open source")
        val entries = BackupArchive.read(ByteArrayInputStream(plain.toByteArray())).associateBy { it.name }
        var count = 0; var att = 0
        for ((name, e) in entries) {
            if (!name.startsWith("notebooks/") || !name.endsWith(".snap")) continue
            val snap = SnapshotCodec.decode(e.bytes)
            val rows = snap.pages.mapNotNull { it.attachmentId }.distinct().mapNotNull { aid ->
                entries["attachments/$aid.meta"]?.let { parseMeta(aid, String(it.bytes)) }
            }
            repo.importSnapshot(snap, rows, copySuffix) { oldId, newId ->
                val data = entries["attachments/$oldId.bin"]?.bytes ?: return@importSnapshot
                files.writeAtomic(files.attachmentFile(newId), data); att++
            }
            count++
        }
        return Result(count, att, plain.size().toLong())
    }

    private fun meta(cv: ContentValues) = listOf("kind", "file_name", "mime", "size", "sha256", "created_at", "updated_at")
        .joinToString("\n") { "$it=${cv.get(it)}" }

    private fun parseMeta(id: String, s: String): ContentValues {
        val m = s.lines().filter { '=' in it }.associate { it.substringBefore('=') to it.substringAfter('=') }
        return ContentValues().apply {
            put("id", id); put("kind", m["kind"] ?: "pdf"); put("file_name", m["file_name"] ?: "$id.pdf"); put("mime", m["mime"] ?: "application/pdf")
            put("size", m["size"]?.toLongOrNull() ?: 0L); put("sha256", m["sha256"] ?: ""); put("created_at", m["created_at"]?.toLongOrNull() ?: 0L)
            put("updated_at", m["updated_at"]?.toLongOrNull() ?: 0L)
        }
    }
}
