package kr.eumsoft.notepro.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.LruCache
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.text.PDFTextStripper
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageElement
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenModel
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.ShapeKind
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.FileStore
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.render.ElementRenderer
import kr.eumsoft.notepro.render.PaperPainter
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

/** PDF·이미지·텍스트 문서 가져오기(원본 보존), 배경 렌더, 검색 색인, 병합·분할, 원본 유지 내보내기. */
class PdfStore(private val context: Context, private val repo: NoteRepository, private val files: FileStore) {

    class UnsupportedPdf(msg: String) : Exception(msg)

    init { try { PDFBoxResourceLoader.init(context) } catch (_: Throwable) { } }

    private fun copyIn(uri: Uri, attachId: String): Pair<Long, String> {
        val md = MessageDigest.getInstance("SHA-256")
        var size = 0L
        files.writeAtomic(files.attachmentFile(attachId)) { out ->
            context.contentResolver.openInputStream(uri)?.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) { val n = input.read(buf); if (n < 0) break; out.write(buf, 0, n); md.update(buf, 0, n); size += n }
            } ?: throw UnsupportedPdf("cannot open")
        }
        return size to md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun pdfSizes(f: File): List<Pair<Float, Float>> = try {
        ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { r -> List(r.pageCount) { i -> r.openPage(i).use { p -> p.width.toFloat() to p.height.toFloat() } } }
        }
    } catch (e: SecurityException) { f.delete(); throw UnsupportedPdf("password") } catch (e: UnsupportedPdf) { throw e } catch (e: Exception) { f.delete(); throw UnsupportedPdf(e.message ?: "invalid") }

    private fun newNotebook(nbId: String, title: String, color: Int) {
        val now = System.currentTimeMillis()
        repo.db.insertOrThrow("notebooks", null, android.content.ContentValues().apply {
            put("id", nbId); put("title", title); put("description", ""); put("cover_color", color); put("created_at", now); put("updated_at", now)
        })
        repo.opEntity("notebook", nbId, nbId, "upsert")
    }

    /** Io 스레드에서 호출. 원본 PDF를 앱 내부에 그대로 복사한 뒤 페이지마다 PDF 배경 페이지를 만든다. */
    fun importPdf(uri: Uri, title: String?, color: Int): String {
        val nbId = UUID.randomUUID().toString()
        val name = displayName(uri) ?: "document.pdf"
        appendPdfInternal(uri, nbId, 0, createNotebook = { newNotebook(nbId, title ?: name.substringBeforeLast('.'), color) })
        return nbId
    }

    /** PDF 병합: 기존 노트 뒤에 다른 PDF 페이지를 덧붙인다. */
    fun appendPdf(uri: Uri, nbId: String): Int {
        val start = repo.pages(nbId).size
        return appendPdfInternal(uri, nbId, start, createNotebook = {})
    }

    private fun appendPdfInternal(uri: Uri, nbId: String, startIndex: Int, createNotebook: () -> Unit): Int {
        val attachId = UUID.randomUUID().toString()
        val (size, sha) = copyIn(uri, attachId)
        val sizes = pdfSizes(files.attachmentFile(attachId))
        if (sizes.isEmpty()) { files.attachmentFile(attachId).delete(); throw UnsupportedPdf("empty") }
        val name = displayName(uri) ?: "document.pdf"
        val now = System.currentTimeMillis()
        val pages = sizes.mapIndexed { i, (w, h) ->
            PageData(UUID.randomUUID().toString(), nbId, startIndex + i, w, h, PaperStyle.BLANK, PageTemplate.NONE, BackgroundType.PDF, attachId, i, now, now)
        }
        repo.tx {
            createNotebook()
            repo.addAttachment(attachId, nbId, "pdf", name, "application/pdf", size, sha)
            repo.opEntity("attachment", attachId, nbId, "upsert")
        }
        repo.upsertPages(nbId, pages, "pdf.import")
        indexPdfText(nbId, attachId, pages)
        return pages.size
    }

    /** PDF 글자 추출 → 검색 색인(page_text). 글자가 없는(스캔) PDF는 4단계 OCR이 채운다. */
    fun indexPdfText(nbId: String, attachId: String, pages: List<PageData>) {
        try {
            PDDocument.load(files.attachmentFile(attachId)).use { doc ->
                val st = PDFTextStripper()
                for (p in pages) {
                    if (p.pdfPage !in 0 until doc.numberOfPages) continue
                    st.startPage = p.pdfPage + 1; st.endPage = p.pdfPage + 1
                    val t = st.getText(doc).trim()
                    if (t.isNotEmpty()) repo.setPageText(p.id, nbId, "pdf", t)
                }
            }
        } catch (e: Throwable) { repo.logError("pdf.index", e.toString()) }
    }

    /** 이미지 가져오기: 이미지마다 한 페이지(원본 파일 보존). nbId=null 이면 새 노트. */
    fun importImages(uris: List<Uri>, nbId: String?, title: String, color: Int): String {
        val id = nbId ?: UUID.randomUUID().toString()
        var index = if (nbId != null) repo.pages(id).size else 0
        val now = System.currentTimeMillis()
        val pages = ArrayList<PageData>()
        repo.tx { if (nbId == null) newNotebook(id, title, color) }
        for (u in uris) {
            val att = UUID.randomUUID().toString()
            val (size, sha) = copyIn(u, att)
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(files.attachmentFile(att).path, o)
            if (o.outWidth <= 0) { files.attachmentFile(att).delete(); throw UnsupportedPdf("image") }
            val w = 595f; val h = 595f * o.outHeight / o.outWidth
            repo.tx {
                repo.addAttachment(att, id, "image", displayName(u) ?: "image", o.outMimeType ?: "image/*", size, sha)
                repo.opEntity("attachment", att, id, "upsert")
            }
            pages.add(PageData(UUID.randomUUID().toString(), id, index++, w, h, PaperStyle.BLANK, PageTemplate.NONE, BackgroundType.IMAGE, att, 0, now, now))
        }
        repo.upsertPages(id, pages, "image.import")
        return id
    }

    /** 텍스트 파일 → A4 PDF로 변환해 가져오기(원본 글자는 검색 색인에도 저장). */
    fun importText(uri: Uri, color: Int): String {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw UnsupportedPdf("cannot open")
        val text = decodeText(bytes)
        val tmp = File(context.cacheDir, "text-import.pdf")
        val doc = PdfDocument()
        val tp = TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { textSize = 11f; color = Color.BLACK }
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, tp, 595 - 100).setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(2f, 1f).build()
        val pageH = 842 - 100
        var line = 0; var pageNo = 1
        while (line < layout.lineCount || pageNo == 1) {
            val page = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNo).create())
            val top = if (layout.lineCount == 0) 0 else layout.getLineTop(line)
            var last = line
            while (last < layout.lineCount && layout.getLineBottom(last) - top <= pageH) last++
            page.canvas.save(); page.canvas.translate(50f, 50f - top)
            page.canvas.clipRect(0, top, 595, top + pageH)
            layout.draw(page.canvas); page.canvas.restore()
            doc.finishPage(page)
            if (last == line) break
            line = last; pageNo++
        }
        tmp.outputStream().use { doc.writeTo(it) }; doc.close()
        val nbId = importPdf(Uri.fromFile(tmp), displayName(uri)?.substringBeforeLast('.') ?: "text", color)
        tmp.delete()
        return nbId
    }

    private fun decodeText(b: ByteArray): String {
        val utf8 = Charsets.UTF_8.newDecoder()
        return try { utf8.decode(java.nio.ByteBuffer.wrap(b)).toString().removePrefix("﻿") } catch (e: Exception) {
            String(b, charset("MS949")) // 한국어 윈도우 메모장(EUC-KR/CP949)
        }
    }

    fun displayName(uri: Uri): String? = try {
        if (uri.scheme == "file") uri.lastPathSegment else
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
        val base = "$att#${page.pdfPage}#${page.rotation}#"
        val key = base + bucket
        cache.get(key)?.let { return it }
        synchronized(inFlight) { if (!inFlight.add(key)) return lowerRes(base, bucket) }
        renderThread.execute {
            val bmp = renderSync(page, bucket)
            if (bmp != null) cache.put(key, bmp)
            synchronized(inFlight) { inFlight.remove(key) }
            android.os.Handler(android.os.Looper.getMainLooper()).post { onReady() }
        }
        return lowerRes(base, bucket)
    }

    private fun lowerRes(base: String, bucket: Int): Bitmap? {
        var b = bucket / 2
        while (b >= 256) { cache.get(base + b)?.let { return it }; b /= 2 }
        b = bucket * 2
        while (b <= 4096) { cache.get(base + b)?.let { return it }; b *= 2 }
        return null
    }

    private fun bucketWidth(px: Int): Int { var b = 256; while (b < px && b < 4096) b *= 2; return b }

    /** 회전 적용 행렬: 원래 크기(nw×nh)로 그린 뒤 r도 돌려 출력(w×h)에 맞춤 */
    private fun rotationMatrix(srcW: Float, srcH: Float, w: Int, h: Int, rot: Int): Matrix {
        val nw = if (rot % 180 == 0) w else h; val nh = if (rot % 180 == 0) h else w
        return Matrix().apply {
            setScale(nw / srcW, nh / srcH)
            postRotate(rot.toFloat())
            when (rot) { 90 -> postTranslate(w.toFloat(), 0f); 180 -> postTranslate(w.toFloat(), h.toFloat()); 270 -> postTranslate(0f, h.toFloat()) }
        }
    }

    fun renderSync(page: PageData, widthPx: Int): Bitmap? {
        val att = page.attachmentId ?: return null
        val w = widthPx
        val h = (widthPx * page.height / page.width).toInt().coerceAtLeast(1)
        if (page.bgType == BackgroundType.IMAGE) {
            return try {
                val f = files.attachmentFile(att)
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(f.path, o)
                var sample = 1
                val natW = if (page.rotation % 180 == 0) w else h
                while (o.outWidth / (sample * 2) >= natW) sample *= 2
                val src = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bmp.eraseColor(Color.WHITE)
                Canvas(bmp).drawBitmap(src, rotationMatrix(src.width.toFloat(), src.height.toFloat(), w, h, page.rotation), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
                src.recycle(); bmp
            } catch (e: Throwable) { null }
        }
        synchronized(renderers) {
            val r = renderer(att) ?: return null
            if (page.pdfPage !in 0 until r.pageCount) return null
            return try {
                r.openPage(page.pdfPage).use { p ->
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(Color.WHITE)
                    p.render(bmp, null, rotationMatrix(p.width.toFloat(), p.height.toFloat(), w, h, page.rotation), PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bmp
                }
            } catch (e: Exception) { null }
        }
    }

    fun originalFile(attachId: String): File = files.attachmentFile(attachId)

    // ---------------- 내보내기 ----------------
    /**
     * 필기 포함 PDF 내보내기. PDF 배경 페이지는 원본 페이지를 그대로 가져와(글자·벡터 보존) 위에 필기를 벡터로 덧그린다.
     * pdfbox가 실패하면 이미지 방식으로 대신 만든다(내보내기는 항상 성공하도록).
     */
    fun export(pages: List<PageData>, strokesOf: (String) -> List<Stroke>, out: OutputStream,
               elementsOf: (String) -> List<PageElement> = { emptyList() }, progress: (Int) -> Unit) {
        val tmp = File(context.cacheDir, "export-${System.nanoTime()}.pdf")
        try {
            exportVector(pages, strokesOf, elementsOf, tmp, progress)
        } catch (e: Throwable) {
            repo.logError("pdf.export.vector", e.toString(), e.stackTraceToString())
            tmp.outputStream().use { exportRaster(pages, strokesOf, elementsOf, it, progress) }
        }
        tmp.inputStream().use { it.copyTo(out) }
        tmp.delete()
    }

    private fun exportVector(pages: List<PageData>, strokesOf: (String) -> List<Stroke>, elementsOf: (String) -> List<PageElement>, target: File, progress: (Int) -> Unit) {
        val sources = HashMap<String, PDDocument>()
        val doc = PDDocument()
        try {
            pages.forEachIndexed { i, p ->
                val page: PDPage
                var baseRot = 0
                if (p.bgType == BackgroundType.PDF && p.attachmentId != null) {
                    val src = sources.getOrPut(p.attachmentId) { PDDocument.load(files.attachmentFile(p.attachmentId)) }
                    page = doc.importPage(src.getPage(p.pdfPage))
                    baseRot = page.rotation
                    page.rotation = ((page.rotation + p.rotation) % 360 + 360) % 360
                } else {
                    page = PDPage(PDRectangle(p.width, p.height)); doc.addPage(page)
                }
                val rot = ((baseRot + if (p.bgType == BackgroundType.PDF) p.rotation else 0) % 360 + 360) % 360
                val box = page.cropBox
                val llx = box.lowerLeftX; val lly = box.lowerLeftY; val cw = box.width; val ch = box.height
                PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                    // 화면 좌표(왼쪽 위, y 아래로) → PDF 사용자 좌표
                    val m = when (rot) {
                        90 -> com.tom_roush.pdfbox.util.Matrix(0f, 1f, 1f, 0f, llx, lly)
                        180 -> com.tom_roush.pdfbox.util.Matrix(-1f, 0f, 0f, 1f, llx + cw, lly)
                        270 -> com.tom_roush.pdfbox.util.Matrix(0f, -1f, -1f, 0f, llx + cw, lly + ch)
                        else -> com.tom_roush.pdfbox.util.Matrix(1f, 0f, 0f, -1f, llx, lly + ch)
                    }
                    cs.transform(m)
                    if (p.bgType == BackgroundType.IMAGE) {
                        renderSync(p, (p.width * 2.5f).toInt().coerceAtMost(2500))?.let { bmp ->
                            val img = LosslessFactory.createFromImage(doc, bmp); bmp.recycle()
                            cs.drawImage(img, 0f, p.height, p.width, -p.height)
                        }
                    } else if (p.bgType == BackgroundType.PAPER) {
                        paperVector(doc, cs, p)
                    }
                    for (s in strokesOf(p.id)) strokeVector(doc, cs, s)
                    for (e in elementsOf(p.id)) {
                        val eh = ElementRenderer.height(e) + 12f
                        val k = 3f
                        val bmp = Bitmap.createBitmap(((e.w + 14f) * k).toInt().coerceAtLeast(1), (eh * k).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                        Canvas(bmp).apply { scale(k, k); translate(-e.x + 7f, -e.y + 5f) }.let { ElementRenderer.draw(it, e) }
                        val img = LosslessFactory.createFromImage(doc, bmp); bmp.recycle()
                        cs.drawImage(img, e.x - 7f, e.y - 5f + eh, e.w + 14f, -eh)
                    }
                }
                progress(i + 1)
            }
            doc.save(target)
        } finally {
            doc.close(); sources.values.forEach { runCatching { it.close() } }
        }
    }

    private fun paperVector(doc: PDDocument, cs: PDPageContentStream, p: PageData) {
        if (p.paper == PaperStyle.BLANK && p.template == PageTemplate.NONE) return
        // 용지 선은 이미지로(템플릿 글자 포함) — 연한 선이라 화질 영향 적음
        val k = 2f
        val bmp = Bitmap.createBitmap((p.width * k).toInt(), (p.height * k).toInt(), Bitmap.Config.ARGB_8888)
        Canvas(bmp).apply { scale(k, k) }.let { PaperPainter.draw(it, p, 1f, forExport = true) }
        val img = LosslessFactory.createFromImage(doc, bmp); bmp.recycle()
        cs.drawImage(img, 0f, p.height, p.width, -p.height)
    }

    private fun strokeVector(doc: PDDocument, cs: PDPageContentStream, s: Stroke) {
        val c = s.color
        cs.setStrokingColor(Color.red(c) / 255f, Color.green(c) / 255f, Color.blue(c) / 255f)
        val gs = PDExtendedGraphicsState().apply { strokingAlphaConstant = s.opacity.coerceIn(0.05f, 1f) }
        cs.setGraphicsStateParameters(gs)
        cs.setLineCapStyle(if (s.pen == PenType.HIGHLIGHTER) 2 else 1)
        cs.setLineJoinStyle(1)
        val p = s.points; val n = s.count
        if (n == 0) return
        if (s.pen == PenType.HIGHLIGHTER || s.shape != ShapeKind.NONE || s.opacity < 0.99f) {
            cs.setLineWidth(if (s.pen == PenType.HIGHLIGHTER) s.width else PenModel.widthAt(s.pen, s.width, p[2], p[3], true))
            cs.moveTo(p[0], p[1])
            if (n == 1) cs.lineTo(p[0] + 0.1f, p[1])
            for (i in 1 until n) cs.lineTo(p[i * 4], p[i * 4 + 1])
            cs.stroke()
            return
        }
        if (n == 1) { cs.setLineWidth(PenModel.widthAt(s.pen, s.width, p[2], p[3], true)); cs.moveTo(p[0], p[1]); cs.lineTo(p[0] + 0.1f, p[1]); cs.stroke(); return }
        var prev = PenModel.widthAt(s.pen, s.width, p[2], p[3], true)
        for (i in 1 until n) {
            val w = PenModel.widthAt(s.pen, s.width, p[i * 4 + 2], p[i * 4 + 3], true)
            cs.setLineWidth((prev + w) / 2f)
            cs.moveTo(p[(i - 1) * 4], p[(i - 1) * 4 + 1]); cs.lineTo(p[i * 4], p[i * 4 + 1]); cs.stroke()
            prev = w
        }
    }

    /** 예비 방식: 페이지를 이미지로 그려 PDF 생성. */
    private fun exportRaster(pages: List<PageData>, strokesOf: (String) -> List<Stroke>, elementsOf: (String) -> List<PageElement>, out: OutputStream, progress: (Int) -> Unit) {
        val doc = PdfDocument()
        try {
            pages.forEachIndexed { i, p ->
                val page = doc.startPage(PdfDocument.PageInfo.Builder(p.width.toInt(), p.height.toInt(), i + 1).create())
                val c: Canvas = page.canvas
                if (p.bgType != BackgroundType.PAPER) {
                    renderSync(p, (p.width * 2.5f).toInt().coerceAtMost(3000))?.let { c.drawBitmap(it, null, android.graphics.RectF(0f, 0f, p.width, p.height), null); it.recycle() }
                } else PaperPainter.draw(c, p, 1f, forExport = true)
                kr.eumsoft.notepro.render.StrokeRenderer.drawAll(c, strokesOf(p.id))
                elementsOf(p.id).forEach { ElementRenderer.draw(c, it) }
                doc.finishPage(page)
                progress(i + 1)
            }
            doc.writeTo(out)
        } finally { doc.close() }
    }

    fun close() {
        synchronized(renderers) { renderers.values.forEach { runCatching { it.second.close(); it.first.close() } }; renderers.clear() }
        cache.evictAll()
    }
}
