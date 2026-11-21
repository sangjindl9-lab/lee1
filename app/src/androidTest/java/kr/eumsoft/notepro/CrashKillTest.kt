package kr.eumsoft.notepro

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.NoteDb
import kr.eumsoft.notepro.data.NoteRepository
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * 강제 종료 테스트(두 번 나눠 실행).
 * 1) writeAndKill: 획을 계속 저장하다가 프로세스를 kill -9 와 같은 방식으로 즉시 종료.
 *    커밋이 끝난 개수는 매번 표식 파일에 기록(fsync).
 * 2) verifyAfterKill: 새 프로세스에서 표식의 개수 이상이 DB에 남아 있는지, 무결성이 정상인지 확인.
 */
@RunWith(AndroidJUnit4::class)
class CrashKillTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NoteProApp
    private val marker get() = File(app.filesDir, "crash_marker.txt")

    @Test fun writeAndKill() {
        val repo = app.repo
        val now = System.currentTimeMillis()
        val nb = NotebookData(NB_ID, null, "crash-test", "", -1, false, false, false, now, now, 0, false)
        val pg = PageData(PAGE_ID, NB_ID, 0, 595f, 842f, PaperStyle.BLANK, PageTemplate.NONE, createdAt = now, updatedAt = now)
        if (repo.notebook(NB_ID) == null) repo.createNotebook(nb, listOf(pg))
        repo.db.execSQL("DELETE FROM pen_strokes WHERE notebook_id=?", arrayOf(NB_ID))
        var committed = 0
        val killAt = 120 + (System.nanoTime() % 60).toInt()
        while (true) {
            val pts = FloatArray(200 * 4) { k -> if (k % 4 == 2) 0.5f else (k * 0.7f) % 500f }
            repo.applyStrokes(NB_ID, listOf(Stroke(Stroke.newId(), PAGE_ID, PenType.FOUNTAIN, -16777216, 2f, 1f, pts, System.currentTimeMillis())), emptyList(), "crash")
            committed++
            FileOutputStream(marker).use { it.write(committed.toString().toByteArray()); it.fd.sync() }
            if (committed == killAt) {
                // 다른 스레드가 쓰는 도중에 종료되도록
                Thread { while (true) repo.applyStrokes(NB_ID, listOf(Stroke(Stroke.newId(), PAGE_ID, PenType.PENCIL, -16777216, 2f, 1f, pts, 0)), emptyList(), "crash2") }.start()
                Thread.sleep(15)
                android.os.Process.killProcess(android.os.Process.myPid())
            }
        }
    }

    @Test fun verifyAfterKill() {
        val expected = marker.readText().trim().toInt()
        val repo = NoteRepository(app, NoteDb(app))
        val count = repo.db.rawQuery("SELECT COUNT(*) FROM pen_strokes WHERE notebook_id=? AND pen=1", arrayOf(NB_ID)).use { it.moveToFirst(); it.getInt(0) }
        val problems = repo.integrityCheck()
        File(app.filesDir, "crash_result.txt").writeText("committed_before_kill=$expected found_after_restart=$count integrity=${if (problems.isEmpty()) "ok" else problems.joinToString()}")
        assertTrue("expected >= $expected, found $count", count >= expected)
        assertTrue(problems.joinToString(), problems.isEmpty())
    }

    /** UI 자동 조작으로 그린 필기가 강제 종료 후에도 남아 있는지 */
    @Test fun uiDrawnStrokesExist() {
        val repo = NoteRepository(app, NoteDb(app))
        val n = repo.db.rawQuery("SELECT COUNT(*) FROM pen_strokes s JOIN notebooks n ON n.id=s.notebook_id WHERE n.title NOT LIKE '%-test%' AND s.deleted=0", null).use { it.moveToFirst(); it.getInt(0) }
        File(app.filesDir, "ui_result.txt").writeText("ui_strokes_after_force_stop=$n")
        assertTrue("no UI strokes found", n > 0)
    }

    companion object {
        const val NB_ID = "00000000-crash-test-0000-000000000001"
        const val PAGE_ID = "00000000-crash-page-0000-000000000001"
    }
}
