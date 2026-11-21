package kr.eumsoft.purchasenote.data

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kr.eumsoft.purchasenote.reminder.Reminders
import java.io.File

/** 저장·삭제·사진 정리·알림 재설정을 한 곳에서 일관되게 처리한다. */
class Repo(private val c: Context) {
    val db = AppDb.get(c)
    val dao = db.dao()

    data class Imported(val image: StoredImage, val existing: List<Purchase>)

    companion object {
        /** 작성 중인(아직 저장 전) 화면이 붙잡고 있는 사진. 정리 대상에서 제외 */
        private val held = java.util.Collections.synchronizedSet(HashSet<Long>())
        private val lock = Mutex()
        fun release(ids: Collection<Long>) { held.removeAll(ids.toSet()) }
    }

    /** 이미지 사본 저장(같은 사진이면 기존 사본 재사용) + 그 사진을 쓰는 기존 구매 목록 */
    suspend fun importImage(uri: Uri): Imported = lock.withLock {
        val r = importLocked(uri); held += r.image.id; r
    }

    private suspend fun importLocked(uri: Uri): Imported {
        val copied = ImageStore.copyToTemp(c, uri)
        val same = dao.imageBySha(copied.sha256)
        if (same != null && ImageStore.file(c, same.fileName).exists()) {
            copied.temp.delete()
            return Imported(same, dao.purchasesWithImage(same.id))
        }
        if (same != null) dao.deleteImage(same.id) // 파일이 사라진 기록은 정리 후 새로 저장
        val name = java.util.UUID.randomUUID().toString() + "." + ImageStore.extFor(copied.mime)
        val dest = ImageStore.file(c, name)
        if (!copied.temp.renameTo(dest)) {
            try { copied.temp.copyTo(dest, overwrite = true) } catch (e: Exception) { dest.delete(); throw ImageStore.ImportError(ImageStore.Reason.COPY_FAILED) }
            finally { copied.temp.delete() }
        }
        val img = StoredImage(fileName = name, sha256 = copied.sha256, mime = copied.mime)
        val id = dao.insertImage(img)
        return Imported(img.copy(id = id), emptyList())
    }

    /** 구매 저장(신규/수정) + 사진 연결 동기화 + 남는 사진 정리 + 알림 재설정 */
    suspend fun save(p: Purchase, imageIds: List<Long>): Long {
        val id = db.withTransaction {
            val id = if (p.id == 0L) dao.insert(p) else { dao.update(p.copy(updatedAt = System.currentTimeMillis())); p.id }
            val now = dao.imagesOfOnce(id).map { it.id }.toSet()
            (now - imageIds.toSet()).forEach { dao.unlink(id, it) }
            imageIds.filter { it !in now }.forEach { dao.link(PurchaseImage(id, it)) }
            id
        }
        cleanupOrphans()
        dao.get(id)?.let { Reminders.schedule(c, it) }
        return id
    }

    suspend fun delete(id: Long) {
        Reminders.cancel(c, id)
        db.withTransaction { dao.unlinkAll(id); dao.delete(id) }
        cleanupOrphans()
    }

    /**
     * 상태 변경 규칙: 반품 완료 → 남은 알림 모두 끔. 교환 완료 → 교환 알림 끄고 다른 기한은 사용자가 다시 확인할 때까지 보류.
     */
    suspend fun setStatus(id: Long, s: Status) {
        val p = dao.get(id) ?: return
        val np = p.copy(status = s, needsReview = if (s == Status.EXCHANGED) true else if (s == Status.KEEPING) false else p.needsReview,
            updatedAt = System.currentTimeMillis())
        dao.update(np)
        Reminders.schedule(c, np)
    }

    suspend fun markReviewed(id: Long) {
        val p = dao.get(id) ?: return
        val np = p.copy(needsReview = false, updatedAt = System.currentTimeMillis())
        dao.update(np); Reminders.schedule(c, np)
    }

    /** 어떤 구매에도 연결되지 않은 앱 내 사본만 삭제(갤러리 원본은 손대지 않음) */
    suspend fun cleanupOrphans(): Int = lock.withLock {
        val orphans = dao.orphanImages().filter { it.id !in held }
        orphans.forEach { File(ImageStore.dir(c), it.fileName).delete(); dao.deleteImage(it.id) }
        orphans.size
    }

    suspend fun deleteAll() {
        dao.allOnce().forEach { Reminders.cancel(c, it.id) }
        db.withTransaction { dao.deleteAllLinks(); dao.deleteAll(); dao.deleteAllImages() }
        ImageStore.dir(c).listFiles()?.forEach { it.delete() }
    }
}
