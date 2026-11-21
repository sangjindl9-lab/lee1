package kr.eumsoft.purchasenote

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kr.eumsoft.purchasenote.data.AppDb
import kr.eumsoft.purchasenote.data.ImageStore
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.reminder.Reminders
import java.io.File

class App : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        Reminders.ensureChannel(this)
        scope.launch { housekeeping() }
    }

    /** 시작 시 정리: 중단된 복원 마무리, 연결 없는 사진 사본·기록 없는 파일 삭제, 임시 파일 삭제 */
    private suspend fun housekeeping() {
        val dir = ImageStore.dir(this)
        val stage = File(filesDir, "receipts_restore")
        if (stage.exists()) { stage.listFiles()?.forEach { f -> val t = File(dir, f.name); if (!t.exists()) f.renameTo(t) }; stage.deleteRecursively() }
        Repo(this).cleanupOrphans()
        val known = AppDb.get(this).dao().images().map { it.fileName }.toSet()
        val cutoff = System.currentTimeMillis() - 10 * 60 * 1000 // 방금 복사 중인 파일은 건드리지 않음
        dir.listFiles()?.forEach { if (it.name !in known && it.lastModified() < cutoff) it.delete() }
        cacheDir.listFiles()?.filter { it.name.startsWith("import-") }?.forEach { it.delete() }
    }
}
