package kr.eumsoft.quick.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.ImageStore
import kr.eumsoft.quick.core.Ocr
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.core.SaveException
import kr.eumsoft.quick.core.TextTools
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** 가리기(불투명·모자이크)를 실제 픽셀에 합성 */
object Masker {
    data class Mask(val r: RectF, val mosaic: Boolean)

    fun mosaic(canvas: Canvas, src: Bitmap, r: Rect) {
        val w = r.width(); val h = r.height()
        if (w <= 0 || h <= 0) return
        val block = max(8, min(w, h) / 6)
        val part = Bitmap.createBitmap(src, r.left, r.top, w, h)
        val small = Bitmap.createScaledBitmap(part, max(1, w / block), max(1, h / block), true)
        canvas.drawBitmap(small, null, r, Paint().apply { isFilterBitmap = false })
    }

    /** 자르기 + 가리기를 합성한 새 비트맵 (공유·저장은 항상 이 결과만 사용) */
    fun render(src: Bitmap, crop: Rect, masks: List<Mask>): Bitmap {
        val c = Rect(crop); c.intersect(0, 0, src.width, src.height)
        val out = Bitmap.createBitmap(src, c.left, c.top, c.width(), c.height()).copy(Bitmap.Config.ARGB_8888, true)
        val cv = Canvas(out)
        val black = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }
        for (m in masks) {
            val r = Rect(); m.r.roundOut(r); r.offset(-c.left, -c.top)
            if (!r.intersect(0, 0, out.width, out.height)) continue
            if (m.mosaic) mosaic(cv, out, r) else cv.drawRect(r, black)
        }
        return out
    }
}

class EditView(ctx: Context, var bmp: Bitmap) : View(ctx) {
    var crop = RectF(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat())
    val masks = ArrayList<Masker.Mask>()
    val candidates = ArrayList<RectF>()
    var maskMode = false
    var mosaic = false
    var onChange: (() -> Unit)? = null

    private val m = Matrix()
    private val inv = Matrix()
    private var scale = 1f
    private val dim = Paint().apply { color = 0x99000000.toInt() }
    private val border = Paint().apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 3f }
    private val black = Paint().apply { color = Color.BLACK }
    private val cand = Paint().apply { color = 0xFFF97316.toInt(); style = Paint.Style.STROKE; strokeWidth = 4f; pathEffect = DashPathEffect(floatArrayOf(14f, 8f), 0f) }
    private val drawing = Paint().apply { color = 0x66000000; style = Paint.Style.FILL }
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val mosaicCache = HashMap<Masker.Mask, Bitmap>()

    fun reset(b: Bitmap) {
        bmp = b; crop = RectF(0f, 0f, b.width.toFloat(), b.height.toFloat())
        masks.clear(); candidates.clear(); mosaicCache.clear(); computeMatrix(); invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) = computeMatrix()

    private fun computeMatrix() {
        if (width == 0 || height == 0) return
        scale = min(width / bmp.width.toFloat(), height / bmp.height.toFloat())
        m.reset(); m.postScale(scale, scale)
        m.postTranslate((width - bmp.width * scale) / 2f, (height - bmp.height * scale) / 2f)
        m.invert(inv)
    }

    override fun onDraw(c: Canvas) {
        c.save(); c.concat(m)
        c.drawBitmap(bmp, 0f, 0f, bmpPaint)
        for (mk in masks) {
            if (mk.mosaic) {
                val r = Rect(); mk.r.roundOut(r); r.intersect(0, 0, bmp.width, bmp.height)
                val small = mosaicCache.getOrPut(mk) {
                    val block = max(8, min(r.width(), r.height()) / 6)
                    Bitmap.createScaledBitmap(Bitmap.createBitmap(bmp, r.left, r.top, max(1, r.width()), max(1, r.height())),
                        max(1, r.width() / block), max(1, r.height() / block), true)
                }
                c.drawBitmap(small, null, r, Paint())
            } else c.drawRect(mk.r, black)
        }
        for (r in candidates) c.drawRect(r, cand)
        current?.let { c.drawRect(it, drawing) }
        // 자르기 영역 바깥 어둡게
        val bw = bmp.width.toFloat(); val bh = bmp.height.toFloat()
        c.drawRect(0f, 0f, bw, crop.top, dim); c.drawRect(0f, crop.bottom, bw, bh, dim)
        c.drawRect(0f, crop.top, crop.left, crop.bottom, dim); c.drawRect(crop.right, crop.top, bw, crop.bottom, dim)
        border.strokeWidth = 3f / scale
        c.drawRect(crop, border)
        c.restore()
    }

    private var current: RectF? = null
    private var sx = 0f; private var sy = 0f
    private var edges = 0 // 1 left, 2 top, 4 right, 8 bottom

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val p = floatArrayOf(e.x, e.y); inv.mapPoints(p)
        val x = p[0].coerceIn(0f, bmp.width.toFloat()); val y = p[1].coerceIn(0f, bmp.height.toFloat())
        val tol = 28 * resources.displayMetrics.density / scale
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                sx = x; sy = y
                if (!maskMode) {
                    edges = 0
                    if (abs(x - crop.left) < tol) edges = edges or 1
                    if (abs(x - crop.right) < tol) edges = edges or 4
                    if (abs(y - crop.top) < tol) edges = edges or 2
                    if (abs(y - crop.bottom) < tol) edges = edges or 8
                    if (edges == 0) { // 가장 가까운 변
                        val d = listOf(abs(x - crop.left) to 1, abs(y - crop.top) to 2, abs(x - crop.right) to 4, abs(y - crop.bottom) to 8)
                        edges = d.minByOrNull { it.first }!!.second
                    }
                } else {
                    val hit = candidates.firstOrNull { it.contains(x, y) }
                    if (hit != null) { candidates.remove(hit); addMask(RectF(hit)); return true }
                    current = RectF(x, y, x, y)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                if (!maskMode) {
                    val minSize = 40f
                    if (edges and 1 != 0) crop.left = min(x, crop.right - minSize)
                    if (edges and 4 != 0) crop.right = max(x, crop.left + minSize)
                    if (edges and 2 != 0) crop.top = min(y, crop.bottom - minSize)
                    if (edges and 8 != 0) crop.bottom = max(y, crop.top + minSize)
                } else current?.set(min(sx, x), min(sy, y), max(sx, x), max(sy, y))
                invalidate()
            }
            MotionEvent.ACTION_UP -> {
                val r = current
                current = null
                if (maskMode && r != null && r.width() > 8 && r.height() > 8) addMask(r)
                invalidate(); onChange?.invoke()
            }
        }
        return true
    }

    fun addMask(r: RectF) { masks.add(Masker.Mask(r, mosaic)); invalidate(); onChange?.invoke() }
    fun undo() { if (masks.isNotEmpty()) { mosaicCache.remove(masks.removeAt(masks.size - 1)); invalidate(); onChange?.invoke() } }
    fun cropRect(): Rect = Rect().also { crop.round(it) }
}

/** 자르기 수정 · 개인정보 가리기 · 공유 */
class ImageEditActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var view: EditView
    private lateinit var info: TextView
    private lateinit var tools: LinearLayout
    private var captureId = -1L
    private var pending = ""
    private var pendingOrig = ""
    private var pkg = ""
    private var fromOriginal = false
    private lateinit var deleteOld: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        captureId = intent.getLongExtra("id", -1)
        pending = intent.getStringExtra("pending") ?: ""
        pendingOrig = intent.getStringExtra("pendingOrig") ?: ""
        val cap = if (captureId >= 0) Db.get(this).capture(captureId) else null
        pkg = intent.getStringExtra("pkg") ?: cap?.pkg ?: ""
        val bmp: Bitmap? = try {
            if (pending.isNotEmpty()) BitmapFactory.decodeFile(pending)?.copy(Bitmap.Config.ARGB_8888, true)
            else cap?.let { ImageStore.load(this, Uri.parse(it.uri)) }
        } catch (e: Exception) { null }
        if (bmp == null) { toast("이미지를 열 수 없습니다."); finish(); return }

        val root = vbox(); root.setBackgroundColor(0xFF111827.toInt())
        view = EditView(this, bmp)
        val frame = FrameLayout(this); frame.addView(view)
        root.add(frame, MATCH, 0, 1f)
        val panel = vbox(10); panel.setBackgroundColor(Color.WHITE)
        info = panel.label("", 12f, color = GRAY)
        tools = panel.add(vbox())
        deleteOld = CheckBox(this); deleteOld.text = "편집 전 이미지 삭제 (가린 정보가 남지 않도록)"; deleteOld.isChecked = true; deleteOld.textSize = 12f
        if (captureId >= 0) panel.add(deleteOld)
        panel.buttons("취소" to { finish() }, "저장" to { save(false) }, "저장 후 공유" to { save(true) })
        root.addView(panel)
        applyInsets(root)
        setContentView(root)
        view.onChange = { updateInfo() }
        val mode = intent.getStringExtra("mode") ?: "crop"
        setMode(mode == "mask" || mode == "share")
        if (mode == "share") info.text = "공유 전에 가릴 부분이 있으면 손가락으로 사각형을 그리세요. 그대로 공유하려면 '저장 후 공유'."
    }

    private fun setMode(mask: Boolean) {
        view.maskMode = mask
        tools.removeAllViews()
        tools.buttons(("자르기" + if (!mask) " ✓" else "") to { setMode(false) }, ("가리기" + if (mask) " ✓" else "") to { setMode(true) })
        if (mask) {
            tools.buttons(("불투명" + if (!view.mosaic) " ✓" else "") to { view.mosaic = false; setMode(true) },
                ("모자이크" + if (view.mosaic) " ✓" else "") to { view.mosaic = true; setMode(true) },
                "실행 취소" to { view.undo() })
            tools.buttons("전화번호·이메일 후보 찾기" to { detect() }, "후보 모두 가리기" to {
                view.candidates.toList().forEach { view.addMask(RectF(it)) }; view.candidates.clear(); view.invalidate()
            })
        } else {
            tools.buttons("자르기 원래대로" to {
                view.crop = RectF(0f, 0f, view.bmp.width.toFloat(), view.bmp.height.toFloat()); view.invalidate(); updateInfo()
            }, "원본 불러오기" to { loadOriginal() })
            if (pkg.isNotEmpty()) tools.btn("이 앱의 기본 자르기로 저장") { savePreset() }
        }
        updateInfo()
    }

    private fun updateInfo() {
        val c = view.cropRect()
        info.text = if (view.maskMode) "손가락으로 가릴 영역을 그리세요 · 가림 ${view.masks.size}개 · 주황 점선 = 자동 감지 후보(누르면 가림). 자동 감지는 누락될 수 있으니 직접 확인하세요."
        else "가장자리를 끌어 자르기 영역을 조정하세요 · ${c.width()}×${c.height()}px (원본 ${view.bmp.width}×${view.bmp.height})"
    }

    private fun loadOriginal() {
        val orig = when {
            pendingOrig.isNotEmpty() -> BitmapFactory.decodeFile(pendingOrig)?.copy(Bitmap.Config.ARGB_8888, true)
            captureId >= 0 -> Db.get(this).capture(captureId)?.origUri?.takeIf { it.isNotEmpty() }?.let {
                try { ImageStore.load(this, Uri.parse(it)) } catch (e: Exception) { null }
            }
            else -> null
        }
        if (orig == null) { toast("보관된 원본이 없습니다. 설정 > 저장 방식에서 '원본도 함께 보관'을 켜면 다음 캡처부터 사용할 수 있습니다."); return }
        view.reset(orig); fromOriginal = true; updateInfo()
        toast("자르기 전 원본을 불러왔습니다.")
    }

    private fun savePreset() {
        if (fromOriginal) { toast("원본 기준 편집에서는 프리셋을 저장할 수 없습니다. 자동 크롭된 이미지에서 조정하세요."); return }
        val c = view.cropRect()
        val v = intArrayOf(c.top, view.bmp.height - c.bottom, c.left, view.bmp.width - c.right)
        Prefs(this).setPreset(pkg, v)
        toast("이 앱의 다음 캡처부터 위 ${v[0]}px, 아래 ${v[1]}px, 좌 ${v[2]}px, 우 ${v[3]}px 더 자릅니다.")
    }

    private fun detect() {
        info.text = "개인정보 후보를 찾는 중… (기기 내부 처리)"
        Ocr.run(view.bmp) { text, err ->
            if (text == null) { info.text = "감지 실패: ${err?.message}"; return@run }
            view.candidates.clear()
            for (b in text.textBlocks) for (l in b.lines) {
                val els = l.elements.filter { TextTools.looksPrivate(it.text) }
                if (els.isNotEmpty()) els.forEach { el -> el.boundingBox?.let { view.candidates.add(RectF(it).apply { inset(-4f, -4f) }) } }
                else if (TextTools.looksPrivate(l.text)) l.boundingBox?.let { view.candidates.add(RectF(it).apply { inset(-4f, -4f) }) }
            }
            view.invalidate()
            info.text = "후보 ${view.candidates.size}개를 찾았습니다(주황 점선). 누르면 가려집니다. 자동 감지는 누락될 수 있으니 직접 확인하세요."
        }
    }

    private fun save(share: Boolean) {
        val crop = view.cropRect()
        val masks = view.masks.toList()
        val src = view.bmp
        info.text = "저장 중…"
        io.execute {
            val store = ImageStore(this)
            try {
                val out = Masker.render(src, crop, masks)
                val db = Db.get(this)
                val base = store.newBaseName() + if (captureId >= 0) "_edit" else ""
                val saved = store.save(out, base)
                // 저장된 파일을 다시 읽어 가림이 실제로 합성됐는지 확인
                if (!verify(saved.uri, crop, masks)) throw SaveException("가림 처리 확인에 실패해 공유를 중단했습니다. 다시 저장해 주세요.")
                var id = captureId
                if (captureId >= 0) {
                    val old = db.capture(captureId)
                    if (old != null && deleteOld.isChecked) store.delete(old.uri)
                    db.updateCapture(captureId, saved.uri.toString(), saved.name)
                } else {
                    val origUri = if (pendingOrig.isNotEmpty()) BitmapFactory.decodeFile(pendingOrig)?.let { store.save(it, base + "_orig").uri.toString() } ?: "" else ""
                    id = db.addCapture(saved.uri.toString(), origUri, saved.name, pkg)
                    File(pending).delete(); if (pendingOrig.isNotEmpty()) File(pendingOrig).delete()
                }
                captureId = id; pending = ""
                runOnUiThread {
                    toast("저장됨: ${saved.name}")
                    if (share) startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(if (Prefs(this).jpeg) "image/jpeg" else "image/png")
                        .putExtra(Intent.EXTRA_STREAM, saved.uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "공유"))
                    finish()
                }
            } catch (e: SaveException) {
                runOnUiThread { info.text = e.message; toast(e.message ?: "저장 실패") }
            } catch (e: Exception) {
                runOnUiThread { info.text = "저장 실패: ${e.message}" }
            }
        }
    }

    /** 불투명 가림 영역의 중앙 픽셀이 실제 저장 파일에서 검정인지 확인 */
    private fun verify(uri: Uri, crop: Rect, masks: List<Masker.Mask>): Boolean {
        val solid = masks.filter { !it.mosaic }
        if (solid.isEmpty()) return true
        val b = try { ImageStore.load(this, uri, 100000) } catch (e: Exception) { return false }
        val c = Rect(crop); c.intersect(0, 0, view.bmp.width, view.bmp.height)
        for (m in solid) {
            val cx = (m.r.centerX() - c.left).toInt(); val cy = (m.r.centerY() - c.top).toInt()
            if (cx !in 0 until b.width || cy !in 0 until b.height) continue
            val p = b.getPixel(cx, cy)
            if (Color.red(p) > 24 || Color.green(p) > 24 || Color.blue(p) > 24) return false // JPEG 압축 오차 허용
        }
        return true
    }
}
