package kr.eumsoft.purchasenote.backup

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import kr.eumsoft.purchasenote.data.AppDb
import kr.eumsoft.purchasenote.data.ImageStore
import kr.eumsoft.purchasenote.reminder.Reminders
import java.io.File

/** 사용자가 요청할 때만 지정한 위치에 암호화 백업 저장 / 복원. 실패하면 기존 데이터는 그대로 둔다. */
class BackupManager(private val c: Context) {
    private val db = AppDb.get(c); private val dao = db.dao()

    data class Preview(val purchases: Int, val images: Int, val currentPurchases: Int, val payload: BackupFormat.Payload)

    suspend fun exportBytes(pw: CharArray): ByteArray {
        val imgs = dao.images()
        val files = imgs.mapNotNull { i -> ImageStore.file(c, i.fileName).takeIf { it.exists() }?.let { i.fileName to it.readBytes() } }.toMap()
        val keep = imgs.filter { it.fileName in files }
        val links = dao.links().filter { l -> keep.any { it.id == l.imageId } }
        return BackupFormat.encrypt(BackupFormat.toZip(BackupFormat.Payload(dao.allOnce(), keep, links, files)), pw)
    }

    suspend fun export(uri: Uri, pw: CharArray) {
        val bytes = exportBytes(pw)
        (c.contentResolver.openOutputStream(uri, "wt") ?: throw java.io.IOException("open")).use { it.write(bytes) }
    }

    fun readPreview(bytes: ByteArray, pw: CharArray, current: Int): Preview {
        val p = BackupFormat.fromZip(BackupFormat.decrypt(bytes, pw))
        return Preview(p.purchases.size, p.images.size, current, p)
    }

    suspend fun preview(uri: Uri, pw: CharArray): Preview {
        val bytes = (c.contentResolver.openInputStream(uri) ?: throw BackupFormat.Corrupt("open")).use { it.readBytes() }
        return readPreview(bytes, pw, dao.count())
    }

    /** 복원: 사진을 임시 폴더에 먼저 쓰고 → DB를 한 트랜잭션으로 교체 → 성공한 뒤에만 사진 폴더 교체 */
    suspend fun apply(p: BackupFormat.Payload) {
        val stage = File(c.filesDir, "receipts_restore").apply { deleteRecursively(); mkdirs() }
        try {
            p.files.forEach { (n, b) -> File(stage, n).writeBytes(b) }
            val old = dao.allOnce()
            db.withTransaction {
                dao.deleteAllLinks(); dao.deleteAll(); dao.deleteAllImages()
                dao.insertImages(p.images); dao.insertAll(p.purchases); dao.linkAll(p.links)
            }
            old.forEach { Reminders.cancel(c, it.id) }
        } catch (e: Exception) { stage.deleteRecursively(); throw e }
        val dir = ImageStore.dir(c)
        dir.listFiles()?.forEach { it.delete() }
        stage.listFiles()?.forEach { f -> if (!f.renameTo(File(dir, f.name))) { f.copyTo(File(dir, f.name), true); f.delete() } }
        stage.deleteRecursively()
        Reminders.rescheduleAll(c)
    }
}
