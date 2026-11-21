package kr.eumsoft.notepro.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.LruCache
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.FileStore
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.render.PaperPainter
import kr.eumsoft.notepro.render.StrokeRenderer
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

/** PDF 가져오기(원본 보존)·배경 렌더링·주석 포함 내보내기. */
class PdfStore(private val context: Context, private val repo: NoteRepository, private val files: FileStore) {

    class UnsupportedPdf(msg: String) : Exception(msg)

    /** Io 스레드에서 호출. 원본 PDF를 앱 내부에 그대로 복사한 뒤 페이지마다 PDF 배경 페이지를 만든다. */
    fun importPdf(uri: Uri, title: String?, color: Int): String {
        val attachId = UUID.randomUUID().toString()
        val target = files.attachmentFile(attachId)
        val md = MessageDigest.getInstance("SHA-256")
        var size = 0L
        files.writeAtomic(target) { out ->
            context.contentResolver.openInputStream(uri)?.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) { val n = input.read(buf); if (n < 0) break; out.write(buf, 0, n); md.update(buf, 0, n); size += n }
            } ?: throw UnsupportedPdf("cannot open")
        }
        val sizes = try {
            ParcelFileDescriptor.open(target, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                PdfRenderer(fd).use { r -> List(r.pageCount) { i -> r.openPage(i).use { p -> p.width.toFloat() to p.height.toFloat() } } }
            }
        } catch (e: SecurityException) {
            target.delete(); throw UnsupportedPdf("password")
        } catch (e: Exception) {
            target.delete(); throw UnsupportedPdf(e.message ?: "invalid")
        }
        if (sizes.isEmpty()) { target.delete(); throw UnsupportedPdf("empty") }
        val name = displayName(uri) ?: "document.pdf"
        val now = System.currentTimeMillis()
        val nbId = UUID.randomUUID().toString()
        val nb = NotebookData(nbId, null, title ?: name.removeSuffix(".pdf"), "", color, false, false, false, now, now, 0, false)
        val pages = sizes.mapIndexed { i, (w, h) ->
            PageData(UUID.randomUUID().toString(), nbId, i, w, h, PaperStyle.BLANK, PageTemplate.NONE, BackgroundType.PDF, attachId, i, now, now)
        }
        // 노트를 먼저 만들고 첨부를 연결(외래키 순서)
        repo.db.beginTransaction()
        try {
            repo.db.insertOrThrow("notebooks", null, android.content.ContentValues().apply {
                put("id", nb.id); put("title", nb.title); put("description", ""); put("cover_color", color)
                put("created_at", now); put("updated_at", now)
            })
            repo.addAttachment(attachId, nbId, "pdf", name, "application/pdf", size, md.digest().joinToString("") { "%02x".format(it) })
            repo.db.setTransactionSuccessful()
        } finally { repo.db.endTransaction() }
        repo.upsertPages(nbId, pages, "pdf.import")
        return nbId
    }

    private fun displayName(uri: Uri): String? = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    } catch (e: Exception) { null }

    // ---------------- 배경 렌더링 ----------------
    private val renderThread = Executors.newSingleThreadExecutor { Thread(it, "notepro-pdf") }
    private val renderers = HashMap<String, Pair<ParcelFileDescriptor, PdfRenderer>>()
    private val cache = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 6).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val inFlight = HashSet<String>()

    private fun renderer(attachId: String): PdfRenderer? {
        renderers[attachId]?.let { return it.second }
        val f = files.attachmentFile(attachId)
        if (!f.exists()) return null
        return try {
            val fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
            val r = PdfRenderer(fd)
            renderers[attachId] = fd to r
            if (renderers.size > 4) {
                val (k, v) = renderers.entries.first().let { it.key to it.value }
                if (k != attachId) { v.second.close(); v.first.close(); renderers.remove(k) }
            }
            r
        } catch (e: Exception) { null }
    }

    /** 캐시에 있으면 즉시 반환, 없으면 백그라운드에서 그린 뒤 onReady 호출. 해상도는 단계별로 묶어 캐시 효율을 높인다. */
    fun background(page: PageData, pxWidth: Int, onReady: () -> Unit): Bitmap? {
        val att = page.attachmentId ?: return null
        val bucket = bucketWidth(pxWidth)
        val key = "$att#${page.pdfPage}#$bucket"
        cache.get(key)?.let { return it }
        synchronized(inFlight) { if (!inFlight.add(key)) return lowerRes(att, page.pdfPage, bucket) }
        renderThread.execute {
            val bmp = renderSync(att, page.pdfPage, bucket, page.width, page.height)
            if (bmp != null) cache.put(key, bmp)
            synchronized(inFlight) { inFlight.remove(key) }
            android.os.Handler(android.os.Looper.getMainLooper()).post { onReady() }
        }
        return lowerRes(att, page.pdfPage, bucket)
    }

    private fun lowerRes(att: String, pg: Int, bucket: Int): Bitmap? {
        var b = bucket / 2
        while (b >= 256) { cache.get("$att#$pg#$b")?.let { return it }; b /= 2 }
        b = bucket * 2
        while (b <= 4096) { cache.get("$att#$pg#$b")?.let { return it }; b *= 2 }
        return null
    }

    private fun bucketWidth(px: Int): Int { var b = 256; while (b < px && b < 4096) b *= 2; return b }

    private fun renderSync(att: String, pg: Int, widthPx: Int, pw: Float, ph: Float): Bitmap? {
      synchronized(renderers) {
        val r = renderer(att) ?: return null
        if (pg !in 0 until r.pageCount) return null
        return try {
            r.openPage(pg).use { p ->
                val w = widthPx
                val h = (widthPx * ph / pw).toInt().coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bmp.eraseColor(Color.WHITE)
                val m = Matrix().apply { setScale(w / p.width.toFloat(), h / p.height.toFloat()) }
                p.render(bmp, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bmp
            }
        } catch (e: Exception) { null }
      }
    }

    fun originalFile(attachId: String): File = files.attachmentFile(attachId)

    // ---------------- 내보내기 ----------------
    /**
     * 주석(필기) 포함 PDF로 내보내기. 필기는 벡터로, PDF 배경은 고해상도 이미지로 들어간다.
     * (원본 PDF의 텍스트 레이어 보존은 3단계 PDF 엔진 교체 시 지원 예정 — 원본은 별도로 내보낼 수 있음.)
     */
    fun export(pages: List<PageData>, strokesOf: (String) -> List<Stroke>, out: OutputStream, progress: (Int) -> Unit) {
        val doc = PdfDocument()
        try {
            pages.forEachIndexed { i, p ->
                val info = PdfDocument.PageInfo.Builder(p.width.toInt(), p.height.toInt(), i + 1).create()
                val page = doc.startPage(info)
                val c: Canvas = page.canvas
                if (p.bgType == BackgroundType.PDF && p.attachmentId != null) {
                    val bmp = renderSync(p.attachmentId, p.pdfPage, (p.width * 2.5f).toInt().coerceAtMost(3000), p.width, p.height)
                    if (bmp != null) {
                        c.drawBitmap(bmp, null, android.graphics.RectF(0f, 0f, p.width, p.height), null)
                        bmp.recycle()
                    }
                } else {
                    PaperPainter.draw(c, p, 1f, forExport = true)
                }
                StrokeRenderer.drawAll(c, strokesOf(p.id))
                doc.finishPage(page)
                progress(i + 1)
            }
            doc.writeTo(out)
        } finally {
            doc.close()
        }
    }

    fun close() {
        synchronized(renderers) { renderers.values.forEach { runCatching { it.second.close(); it.first.close() } }; renderers.clear() }
        cache.evictAll()
    }
}
