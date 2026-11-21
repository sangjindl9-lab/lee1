package kr.eumsoft.notepro

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteDb
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.data.NotebookSession
import kr.eumsoft.notepro.data.VersionManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** 실제 기기/에뮬레이터 SQLite에서 데이터 보존을 검증한다. */
@RunWith(AndroidJUnit4::class)
class DataSafetyTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NoteProApp

    private fun newNotebook(repo: NoteRepository, title: String): Pair<NotebookData, PageData> {
        val now = System.currentTimeMillis()
        val nb = NotebookData(UUID.randomUUID().toString(), null, title, "", 0xFF2C6E7F.toInt(), false, false, false, now, now, 0, false, listOf("test"))
        val pg = PageData(UUID.randomUUID().toString(), nb.id, 0, 595f, 842f, PaperStyle.LINED, PageTemplate.NONE, createdAt = now, updatedAt = now)
        repo.createNotebook(nb, listOf(pg))
        return nb to pg
    }

    private fun stroke(pageId: String, i: Int) = Stroke(Stroke.newId(), pageId, PenType.BALLPOINT, -16777216, 2f, 1f,
        FloatArray(40 * 4) { k -> when (k % 4) { 0 -> (k / 4) * 5f; 1 -> i * 3f; 2 -> 0.5f; else -> 0f } }, System.currentTimeMillis())

    @Test fun strokesSurviveDatabaseReopen() {
        val repo = app.repo
        val (nb, pg) = newNotebook(repo, "reopen-test")
        repeat(50) { repo.applyStrokes(nb.id, listOf(stroke(pg.id, it)), emptyList(), "test") }
        // 새 연결로 다시 열기(앱 재시작과 같은 효과)
        val repo2 = NoteRepository(app, NoteDb(app))
        assertEquals(50, repo2.strokes(nb.id).size)
        assertTrue(repo2.integrityCheck().isEmpty())
        repo2.db.close()
    }

    @Test fun eraseIsSoftDeleteAndUndoRestores() {
        val repo = app.repo
        val (nb, pg) = newNotebook(repo, "undo-test")
        val ins = InstrumentationRegistry.getInstrumentation()
        lateinit var session: NotebookSession
        ins.runOnMainSync { session = NotebookSession(repo, nb, listOf(pg), emptyList()) }
        val s1 = stroke(pg.id, 1); val s2 = stroke(pg.id, 2)
        ins.runOnMainSync { session.commit(listOf(s1, s2), emptyList(), "pen") }
        ins.runOnMainSync { session.commit(emptyList(), listOf(s1), "erase") }
        assertTrue(Io.flush())
        assertEquals(1, repo.strokes(nb.id).size)
        ins.runOnMainSync { session.undo() }
        assertTrue(Io.flush())
        assertEquals(2, repo.strokes(nb.id).size)
        // 변경마다 동기화용 작업 기록이 남는다
        assertTrue(repo.pendingSyncOps() >= 3)
    }

    @Test fun versionRestoreKeepsBeforeState() {
        val repo = app.repo
        val (nb, pg) = newNotebook(repo, "version-test")
        repo.applyStrokes(nb.id, listOf(stroke(pg.id, 1)), emptyList(), "test")
        val v1 = app.versions.create(nb.id, VersionManager.REASON_MANUAL, 30)!!
        repeat(5) { repo.applyStrokes(nb.id, listOf(stroke(pg.id, it + 10)), emptyList(), "test") }
        assertEquals(6, repo.strokes(nb.id).size)
        app.versions.restore(nb.id, v1, 30)
        assertEquals(1, repo.strokes(nb.id).size)
        assertTrue(repo.versions(nb.id).any { it.reason == VersionManager.REASON_BEFORE_RESTORE && it.strokes == 6 })
    }

    @Test fun deletedPageCanBeRestored() {
        val repo = app.repo
        val (nb, pg) = newNotebook(repo, "page-test")
        val now = System.currentTimeMillis()
        val pg2 = pg.copy(id = UUID.randomUUID().toString(), index = 1, createdAt = now)
        repo.upsertPages(nb.id, listOf(pg2), "test")
        repo.applyStrokes(nb.id, listOf(stroke(pg2.id, 1)), emptyList(), "test")
        repo.deletePage(nb.id, pg2.id, listOf(pg))
        assertEquals(1, repo.pages(nb.id).size)
        repo.restorePage(nb.id, pg2.id, 1)
        assertEquals(2, repo.pages(nb.id).size)
        assertEquals(1, repo.strokes(nb.id).count { it.pageId == pg2.id })
    }

    @Test fun pdf100PagesImportAnnotateExport() {
        // 100쪽 PDF 생성 → 가져오기 → 필기 → 주석 포함 내보내기 → 다시 열어 쪽수 확인
        val src = File(app.cacheDir, "big.pdf")
        val doc = android.graphics.pdf.PdfDocument()
        val paint = android.graphics.Paint().apply { textSize = 24f }
        for (i in 0 until 100) {
            val page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(595, 842, i + 1).create())
            page.canvas.drawText("Page ${i + 1}", 60f, 80f, paint)
            doc.finishPage(page)
        }
        src.outputStream().use { doc.writeTo(it) }; doc.close()
        val t0 = System.currentTimeMillis()
        val nbId = app.pdf.importPdf(Uri.fromFile(src), "pdf-test", -1)
        val importMs = System.currentTimeMillis() - t0
        val pages = app.repo.pages(nbId)
        assertEquals(100, pages.size)
        val att = pages[0].attachmentId!!
        assertTrue(app.pdf.originalFile(att).readBytes().contentEquals(src.readBytes())) // 원본 그대로 보존
        app.repo.applyStrokes(nbId, listOf(stroke(pages[5].id, 1)), emptyList(), "test")
        val out = File(app.cacheDir, "out.pdf")
        val t1 = System.currentTimeMillis()
        out.outputStream().use { o -> app.pdf.export(pages, { id -> app.repo.strokes(nbId).filter { it.pageId == id } }, o) {} }
        val exportMs = System.currentTimeMillis() - t1
        val count = android.os.ParcelFileDescriptor.open(out, android.os.ParcelFileDescriptor.MODE_READ_ONLY).use { android.graphics.pdf.PdfRenderer(it).use { r -> r.pageCount } }
        assertEquals(100, count)
        File(app.filesDir, "perf_pdf.txt").writeText("pdf100_import_ms=$importMs pdf100_export_ms=$exportMs out_bytes=${out.length()}")
        src.delete(); out.delete()
    }

    @Test fun perfRender5000Strokes() {
        val strokes = (0 until 5000).map { stroke("p", it % 280) }
        val bmp = android.graphics.Bitmap.createBitmap(1600, 2400, android.graphics.Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bmp)
        val t0 = System.nanoTime()
        kr.eumsoft.notepro.render.StrokeRenderer.drawAll(c, strokes)
        val ms = (System.nanoTime() - t0) / 1_000_000
        val rt = Runtime.getRuntime()
        File(app.filesDir, "perf_render.txt").writeText("render_5000_strokes_ms=$ms heap_used_mb=${(rt.totalMemory() - rt.freeMemory()) / 1048576}")
        bmp.recycle()
        assertTrue(ms < 20_000)
    }

    @Test fun encryptedBackupRoundTripNeverOverwrites() {
        val repo = app.repo
        val (nb, pg) = newNotebook(repo, "backup-test")
        repeat(20) { repo.applyStrokes(nb.id, listOf(stroke(pg.id, it)), emptyList(), "test") }
        val f = File(app.cacheDir, "t.npbak")
        val res = app.backup.export(Uri.fromFile(f), "test-password".toCharArray(), false)
        assertTrue(res.notebooks >= 1)
        val before = repo.db.rawQuery("SELECT COUNT(*) FROM notebooks", null).use { it.moveToFirst(); it.getInt(0) }
        app.backup.import(Uri.fromFile(f), "test-password".toCharArray(), " (restored)")
        val after = repo.db.rawQuery("SELECT COUNT(*) FROM notebooks", null).use { it.moveToFirst(); it.getInt(0) }
        assertTrue(after >= before + 1) // 기존 노트는 그대로, 사본이 추가됨
        assertEquals(20, repo.strokes(nb.id).size)
        f.delete()
    }
}
