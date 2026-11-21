package kr.eumsoft.notepro.data

import kr.eumsoft.notepro.core.CorruptDataException
import kr.eumsoft.notepro.core.NotebookSnapshot
import kr.eumsoft.notepro.core.SnapshotCodec
import java.util.UUID

/** 노트 수정 이력(자동 복구 지점) 관리. Io 스레드에서 실행. */
class VersionManager(private val repo: NoteRepository, private val files: FileStore) {

    fun createAsync(nbId: String, reason: String, keep: Int, done: ((Result<NoteRepository.VersionRow?>) -> Unit)? = null) {
        Io.async({ create(nbId, reason, keep) }) { done?.invoke(it) }
    }

    fun create(nbId: String, reason: String, keep: Int): NoteRepository.VersionRow? {
        val snap = repo.snapshot(nbId) ?: return null
        val bytes = SnapshotCodec.encode(snap)
        val sha = SnapshotCodec.sha256(bytes)
        // 직전 버전과 내용이 같으면 새로 만들지 않음
        val last = repo.versions(nbId).firstOrNull()
        if (last != null && last.sha == sha && reason != REASON_MANUAL) return last
        val id = UUID.randomUUID().toString()
        val name = "$nbId-$id.snap"
        files.writeAtomic(files.versionFile(name), bytes)
        val row = NoteRepository.VersionRow(id, reason, name, bytes.size.toLong(), sha, snap.pages.size, snap.strokes.size, System.currentTimeMillis())
        repo.addVersion(row, nbId)
        prune(nbId, keep)
        return row
    }

    private fun prune(nbId: String, keep: Int) {
        val all = repo.versions(nbId)
        // 수동 복구 지점은 보관 개수와 별도로 유지
        val auto = all.filter { it.reason != REASON_MANUAL }
        auto.drop(keep.coerceAtLeast(3)).forEach { v ->
            repo.deleteVersion(v.id); files.versionFile(v.fileName).delete()
        }
    }

    /** 버전 파일 읽기 + SHA-256 검증. */
    fun load(row: NoteRepository.VersionRow): NotebookSnapshot {
        val f = files.versionFile(row.fileName)
        if (!f.exists()) throw CorruptDataException("version file missing")
        val bytes = f.readBytes()
        if (SnapshotCodec.sha256(bytes) != row.sha) throw CorruptDataException("version checksum mismatch")
        return SnapshotCodec.decode(bytes)
    }

    /** 특정 버전으로 복원. 복원 직전 상태도 복구 지점으로 남긴다(되돌릴 수 있게). */
    fun restore(nbId: String, row: NoteRepository.VersionRow, keep: Int) {
        val snap = load(row)
        create(nbId, REASON_BEFORE_RESTORE, keep)
        repo.replaceWithSnapshot(snap)
    }

    companion object {
        const val REASON_AUTO = "auto"
        const val REASON_CLOSE = "close"
        const val REASON_MANUAL = "manual"
        const val REASON_BEFORE_RESTORE = "before_restore"
        const val REASON_IMPORT = "import"
    }
}
