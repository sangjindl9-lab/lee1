package kr.eumsoft.notepro.ui.canvas

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.widget.OverScroller
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.Geometry
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PenModel
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.PointBuffer
import kr.eumsoft.notepro.core.ShapeKind
import kr.eumsoft.notepro.core.ShapeRecognizer
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.Change
import kr.eumsoft.notepro.data.NotebookSession
import kr.eumsoft.notepro.data.PenPreset
import kr.eumsoft.notepro.data.Settings
import kr.eumsoft.notepro.pdf.PdfStore
import kr.eumsoft.notepro.render.PaperPainter
import kr.eumsoft.notepro.render.StrokeRenderer
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

enum class Tool { PEN, ERASER, LASSO, TEXT }
enum class EraserMode { STROKE, AREA }

/**
 * 필기 엔진 화면.
 * - 펜(스타일러스)과 손가락 입력을 분리: 펜 = 필기, 손가락 = 스크롤/확대(설정에 따라)
 * - 손바닥 무시: 펜이 닿아 있는 동안·직후, 접촉 면적이 큰 터치는 무시
 * - 확대는 손가락 간격이 일정 이상 변해야 시작(의도치 않은 확대 방지), 확대/스크롤 잠금 지원
 * - 확정된 획은 백그라운드에서 화면 비트맵으로 그려 두고, 쓰는 중인 획만 실시간으로 덧그린다.
 */
@SuppressLint("ViewConstructor")
class NoteCanvasView(context: Context, private val pdf: PdfStore, private val settings: () -> Settings) : View(context) {

    interface Listener {
        fun onTransformChanged(zoomPercent: Int, pageIndex: Int, pageCount: Int) {}
        fun onSelectionChanged(count: Int) {}
        fun onRequestUndo() {}
        fun onUserInteraction() {}
        fun onStylusDetected() {}
        /** 텍스트 도구로 페이지를 눌렀을 때(기존 주석을 눌렀으면 element) */
        fun onTextTap(pageId: String, x: Float, y: Float, element: kr.eumsoft.notepro.core.PageElement?) {}
    }

    var listener: Listener? = null
    private var session: NotebookSession? = null
    private val density = resources.displayMetrics.density

    // ---------------- 도구 ----------------
    var tool = Tool.PEN
        set(v) { field = v; if (v != Tool.LASSO) clearSelection(); invalidate() }
    var pen = PenPreset(PenType.BALLPOINT, 0xFF1F2A44.toInt(), 2.2f, 1f)
    var eraserMode = EraserMode.STROKE
    var eraserSize = 12f // 페이지 포인트
    var deskColor = 0xFFE9EDF2.toInt()
    var stylusSeen = false
        private set

    // ---------------- 레이아웃·변환 ----------------
    private var pages: List<PageData> = emptyList()
    private var tops = FloatArray(0)
    private var maxW = 595f
    private var totalH = 842f
    private val gap = 24f
    var scale = 1f; private set
    var ox = 0f; private set
    var oy = 0f; private set
    private var fitScale = 1f
    private var pendingState: String? = null
    private var laidOut = false

    // ---------------- 렌더 캐시 ----------------
    private val renderThread = HandlerThread("notepro-render").apply { start() }
    private val renderHandler = Handler(renderThread.looper)
    private var front: Bitmap? = null
    private var frontScale = 1f; private var frontOx = 0f; private var frontOy = 0f
    private var contentGen = 0L
    private var renderInFlight = false
    private var renderAgain = false
    private var excluded: Set<String> = emptySet()
    private val drawMatrix = Matrix()
    private val settleRender = Runnable { requestRender() }

    // ---------------- 입력 상태 ----------------
    private var drawPointer = -1
    private var drawTool = Tool.PEN
    private var drawPage = -1
    private var drawIsFinger = false
    private var drawStartTime = 0L
    private val buf = PointBuffer()
    private var stabilizer = PenModel.Stabilizer(0.3f)
    private val tmp = FloatArray(2)
    private var shapeKind = ShapeKind.NONE
    private var shapeSnapped = false
    private var holdX = 0f; private var holdY = 0f
    private val holdRunnable = Runnable { trySnapShape() }
    private var penDown = false
    private var lastPenUp = 0L
    private val ignored = HashSet<Int>()

    // 손가락 제스처
    private val fingers = LinkedHashMap<Int, FloatArray>()
    private var gRefX = 0f; private var gRefY = 0f; private var gRefSpan = 0f; private var gStartSpan = 0f
    private var zooming = false
    private var panning = false
    private var tapStart = 0L
    private var tapMoved = false
    private var tapMaxFingers = 0
    private var velocity: VelocityTracker? = null
    private val scroller = OverScroller(context)
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    // 올가미·선택
    private val lasso = ArrayList<Float>()
    private var lassoPage = -1
    private var selection: List<Stroke> = emptyList()
    private var selPage = -1
    private var moving = false
    private var moveStartX = 0f; private var moveStartY = 0f
    private var moveDx = 0f; private var moveDy = 0f

    // 지우개 커서·펜 호버
    private var cursorX = -1f; private var cursorY = -1f; private var cursorR = 0f

    private val overlayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.5f * density; color = 0xFF2F6FED.toInt() }
    private val dashPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 1.5f * density; color = 0xFF2F6FED.toInt(); pathEffect = DashPathEffect(floatArrayOf(8 * density, 6 * density), 0f)
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = 0x222F6FED }
    private val bgPaint = Paint()
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x22000000 }
    private val lassoPath = Path()

    private val changeListener: (Change) -> Unit = { c -> onSessionChange(c) }

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        contentDescription = context.getString(kr.eumsoft.notepro.R.string.canvas_desc)
    }

    // ================= 세션 연결 =================
    fun bind(s: NotebookSession, state: String?) {
        session?.removeListener(changeListener)
        session = s
        s.addListener(changeListener)
        pendingState = state
        relayout()
        if (width > 0) applyInitialState()
        requestRender()
    }

    fun unbind() {
        session?.removeListener(changeListener)
        session = null
    }

    fun release() {
        unbind()
        renderThread.quitSafely()
    }

    private fun onSessionChange(c: Change) {
        if (c.pagesChanged) { relayout(); clampOffsets() }
        selection = selection.mapNotNull { sel -> session?.strokesOf(sel.pageId)?.firstOrNull { it.id == sel.id } }
        if (selection.isEmpty() && selPage >= 0) { selPage = -1; listener?.onSelectionChanged(0) }
        val f = front
        if (!c.full && c.strokesAdded.isNotEmpty() && f != null && !f.isRecycled) {
            // 빠른 경로: 새 획만 현재 화면 비트맵에 덧그림
            val cv = Canvas(f)
            for (s in c.strokesAdded) {
                val pi = pages.indexOfFirst { it.id == s.pageId }; if (pi < 0) continue
                cv.save()
                cv.translate(frontOx + pageLeft(pi) * frontScale, frontOy + tops[pi] * frontScale)
                cv.scale(frontScale, frontScale)
                StrokeRenderer.draw(cv, s)
                cv.restore()
            }
            contentGen++
            if (renderInFlight) renderAgain = true
        } else {
            contentGen++
            requestRender()
        }
        invalidate()
        notifyTransform()
    }

    private fun relayout() {
        pages = session?.pages ?: emptyList()
        tops = FloatArray(pages.size)
        var y = gap
        maxW = 100f
        for ((i, p) in pages.withIndex()) { tops[i] = y; y += p.height + gap; maxW = max(maxW, p.width) }
        totalH = y
        fitScale = if (width > 0) (width - 24 * density) / maxW else 1f
    }

    private fun pageLeft(i: Int) = (maxW - pages[i].width) / 2f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val oldFit = fitScale
        relayout()
        if (!laidOut) { laidOut = true; applyInitialState() } else {
            // 창 크기를 바꿔도 보고 있던 위치·배율 비율 유지
            val rel = scale / oldFit
            val docX = (-ox) / scale; val docY = (-oy) / scale
            scale = (fitScale * rel); ox = -docX * scale; oy = -docY * scale
            clampOffsets()
        }
        requestRender()
    }

    private fun applyInitialState() {
        val st = pendingState
        pendingState = null
        val parts = st?.split('|')
        if (parts != null && parts.size == 3) {
            val rel = parts[0].toFloatOrNull() ?: 1f
            scale = fitScale * rel.coerceIn(0.3f, 8f)
            ox = -(parts[1].toFloatOrNull() ?: 0f) * scale
            oy = -(parts[2].toFloatOrNull() ?: 0f) * scale
        } else {
            scale = fitScale; ox = 0f; oy = 0f
        }
        clampOffsets()
        notifyTransform()
    }

    /** 창 상태 저장용: "배율비|문서X|문서Y" */
    fun viewState(): String = "${scale / fitScale}|${-ox / scale}|${-oy / scale}"

    // ================= 확대·이동 =================
    private fun minScale() = fitScale * 0.4f
    private fun maxScale() = fitScale * 8f

    private fun clampOffsets() {
        if (width == 0) return
        val cw = maxW * scale; val ch = totalH * scale
        ox = if (cw <= width) (width - cw) / 2f else ox.coerceIn(width - cw - 12 * density, 12 * density)
        oy = if (ch <= height) 0f else oy.coerceIn(height - ch - 48 * density, 0f)
    }

    fun zoomTo(newScale: Float, fx: Float = width / 2f, fy: Float = height / 2f) {
        val s = newScale.coerceIn(minScale(), maxScale())
        ox = fx - (fx - ox) * (s / scale); oy = fy - (fy - oy) * (s / scale)
        scale = s
        clampOffsets(); invalidate(); scheduleSettle(); notifyTransform()
    }

    fun zoomBy(f: Float) = zoomTo(scale * f)
    fun fitWidth() { val docY = (height / 2f - oy) / scale; scale = fitScale; oy = height / 2f - docY * scale; clampOffsets(); invalidate(); scheduleSettle(); notifyTransform() }
    fun zoomPercent() = (scale / fitScale * 100).toInt()

    fun scrollToPage(i: Int) {
        if (i !in pages.indices) return
        scroller.forceFinished(true)
        oy = -(tops[i] - gap / 2) * scale
        clampOffsets(); invalidate(); scheduleSettle(); notifyTransform()
    }

    fun currentPageIndex(): Int {
        if (pages.isEmpty()) return 0
        val docY = (height / 2f - oy) / scale
        for (i in pages.indices.reversed()) if (docY >= tops[i] - gap) return i
        return 0
    }

    private fun scheduleSettle() { removeCallbacks(settleRender); postDelayed(settleRender, 140) }

    private fun notifyTransform() { listener?.onTransformChanged(zoomPercent(), currentPageIndex(), pages.size) }

    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            ox = scroller.currX.toFloat(); oy = scroller.currY.toFloat()
            clampOffsets(); invalidate(); notifyTransform()
            if (scroller.isFinished) requestRender() else postInvalidateOnAnimation()
        }
    }

    // ================= 렌더링 =================
    fun requestRender() {
        if (width == 0 || height == 0) return
        val s = session ?: return
        if (renderInFlight) { renderAgain = true; return }
        renderInFlight = true
        val w = width; val h = height; val sc = scale; val x0 = ox; val y0 = oy
        val gen = contentGen
        val pgs = pages; val tp = tops.copyOf(); val mw = maxW
        val ex = excluded
        // 보이는 페이지(위아래 여유 포함)만 복사
        class Vis(val i: Int, val p: PageData, val strokes: List<Stroke>, val elements: List<kr.eumsoft.notepro.core.PageElement>)
        val visible = ArrayList<Vis>()
        for ((i, p) in pgs.withIndex()) {
            val top = y0 + tp[i] * sc; val bottom = top + p.height * sc
            if (bottom < -h * 0.25f || top > h * 1.25f) continue
            visible.add(Vis(i, p, ArrayList(s.strokesOf(p.id)), ArrayList(s.elementsOf(p.id))))
        }
        val desk = deskColor
        renderHandler.post {
            val bmp = try { Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888) } catch (e: OutOfMemoryError) { null }
            if (bmp != null) {
                val c = Canvas(bmp)
                c.drawColor(desk)
                for (v in visible) {
                    val i = v.i; val p = v.p; val strokes = v.strokes
                    val left = x0 + (mw - p.width) / 2f * sc; val top = y0 + tp[i] * sc
                    c.drawRect(left + 2 * density, top + 3 * density, left + p.width * sc + 2 * density, top + p.height * sc + 3 * density, shadowPaint)
                    c.save()
                    c.translate(left, top)
                    c.clipRect(0f, 0f, p.width * sc, p.height * sc)
                    if (p.bgType == BackgroundType.PDF || p.bgType == BackgroundType.IMAGE) {
                        c.drawColor(Color.WHITE)
                        val pxW = (p.width * sc).toInt()
                        val bg = pdf.background(p, pxW) { post { contentGen++; requestRender() } }
                        if (bg != null && !bg.isRecycled) c.drawBitmap(bg, null, RectF(0f, 0f, p.width * sc, p.height * sc), BITMAP_PAINT)
                    }
                    c.scale(sc, sc)
                    if (p.bgType == BackgroundType.PAPER) PaperPainter.draw(c, p, sc)
                    val vb = visibleBounds(p, i, sc, x0, y0, w, h, tp, mw)
                    for (st in strokes) if (st.id !in ex && st.bounds.intersects(vb)) StrokeRenderer.draw(c, st)
                    for (e in v.elements) kr.eumsoft.notepro.render.ElementRenderer.draw(c, e)
                    c.restore()
                }
            }
            post {
                renderInFlight = false
                if (bmp != null && gen == contentGen) {
                    val old = front
                    front = bmp; frontScale = sc; frontOx = x0; frontOy = y0
                    if (old != null && old !== bmp) old.recycle()
                    invalidate()
                } else bmp?.recycle()
                if (renderAgain || gen != contentGen || sc != scale || x0 != ox || y0 != oy) { renderAgain = false; requestRender() }
            }
        }
    }

    private fun visibleBounds(p: PageData, i: Int, sc: Float, x0: Float, y0: Float, w: Int, h: Int, tp: FloatArray, mw: Float): kr.eumsoft.notepro.core.Bounds {
        val left = x0 / sc + (mw - p.width) / 2f; val top = y0 / sc + tp[i]
        return kr.eumsoft.notepro.core.Bounds(-left, -top, -left + w / sc, -top + h / sc)
    }

    override fun onDraw(canvas: Canvas) {
        bgPaint.color = deskColor
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)
        val f = front
        if (f != null && !f.isRecycled) {
            if (frontScale == scale && frontOx == ox && frontOy == oy) canvas.drawBitmap(f, 0f, 0f, null)
            else {
                val k = scale / frontScale
                drawMatrix.reset(); drawMatrix.postScale(k, k); drawMatrix.postTranslate(ox - frontOx * k, oy - frontOy * k)
                canvas.drawBitmap(f, drawMatrix, BITMAP_PAINT)
            }
        }
        // 선택 영역 이동 중: 선택된 획을 실시간으로
        if (selection.isNotEmpty() && selPage in pages.indices) {
            withPage(canvas, selPage) {
                if (moving) { canvas.translate(moveDx, moveDy); for (s in selection) StrokeRenderer.draw(canvas, s) }
                Geometry.unionBounds(selection)?.let { b ->
                    val r = RectF(b.l, b.t, b.r, b.b)
                    dashPaint.strokeWidth = 1.5f * density / scale
                    canvas.drawRect(r, fillPaint); canvas.drawRect(r, dashPaint)
                }
            }
        }
        // 쓰는 중인 획
        if (drawPointer != -1 && drawTool == Tool.PEN && drawPage in pages.indices && buf.count > 0) {
            withPage(canvas, drawPage) {
                StrokeRenderer.drawPoints(canvas, buf.data, buf.size, pen.pen, pen.color, pen.width, pen.opacity, shapeKind)
            }
        }
        // 올가미 선
        if (lasso.size >= 4 && lassoPage in pages.indices) {
            withPage(canvas, lassoPage) {
                lassoPath.rewind(); lassoPath.moveTo(lasso[0], lasso[1])
                var i = 2; while (i < lasso.size) { lassoPath.lineTo(lasso[i], lasso[i + 1]); i += 2 }
                dashPaint.strokeWidth = 1.5f * density / scale
                canvas.drawPath(lassoPath, dashPaint)
            }
        }
        // 지우개 커서
        if (cursorX >= 0) {
            overlayPaint.color = 0xFF7A869A.toInt()
            canvas.drawCircle(cursorX, cursorY, cursorR, overlayPaint)
        }
    }

    private inline fun withPage(c: Canvas, i: Int, block: () -> Unit) {
        c.save()
        c.translate(ox + pageLeft(i) * scale, oy + tops[i] * scale)
        c.scale(scale, scale)
        block()
        c.restore()
    }

    // ================= 좌표 =================
    /** 화면 좌표 → (페이지번호, 페이지x, 페이지y). 페이지 밖이면 -1 */
    private fun hitPage(sx: Float, sy: Float, out: FloatArray): Int {
        val dx = (sx - ox) / scale; val dy = (sy - oy) / scale
        for (i in pages.indices) {
            val l = pageLeft(i); val t = tops[i]
            if (dx >= l && dx <= l + pages[i].width && dy >= t && dy <= t + pages[i].height) { out[0] = dx - l; out[1] = dy - t; return i }
        }
        return -1
    }

    private fun toPage(i: Int, sx: Float, sy: Float, out: FloatArray) {
        out[0] = (sx - ox) / scale - pageLeft(i); out[1] = (sy - oy) / scale - tops[i]
    }

    // ================= 입력 =================
    private fun isPenTool(t: Int) = t == MotionEvent.TOOL_TYPE_STYLUS || t == MotionEvent.TOOL_TYPE_ERASER

    private fun fingerDraws(): Boolean = when (settings().fingerMode) {
        "FINGER_DRAW" -> true
        "PEN_ONLY" -> false
        else -> !stylusSeen
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (session == null) return false
        val st = settings()
        listener?.onUserInteraction()
        val idx = ev.actionIndex
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                if (ev.actionMasked == MotionEvent.ACTION_DOWN) { scroller.forceFinished(true); ignored.clear() }
                val pid = ev.getPointerId(idx)
                val tt = ev.getToolType(idx)
                val mouseDraw = tt == MotionEvent.TOOL_TYPE_MOUSE && (ev.buttonState and MotionEvent.BUTTON_PRIMARY) != 0
                if (isPenTool(tt) || mouseDraw) {
                    if (isPenTool(tt) && !stylusSeen) { stylusSeen = true; listener?.onStylusDetected() }
                    if (drawPointer != -1 && drawIsFinger) cancelDrawing()
                    if (drawPointer == -1) {
                        penDown = true
                        endFingerGesture(cancel = true)
                        requestUnbufferedDispatch(ev)
                        startInput(ev, idx, finger = false)
                    }
                    return true
                }
                // ---- 손가락 ----
                if (st.palmRejection) {
                    if (penDown) { ignored.add(pid); return true }
                    if (SystemClock.uptimeMillis() - lastPenUp < 350) { ignored.add(pid); return true }
                    if (ev.getTouchMajor(idx) > 42 * density) { ignored.add(pid); return true }
                }
                if (drawPointer != -1 && drawIsFinger) {
                    // 손가락으로 쓰는 도중 두 번째 손가락: 짧은 획이면 취소하고 제스처로 전환
                    if (SystemClock.uptimeMillis() - drawStartTime < 250 || buf.count < 10) {
                        cancelDrawing()
                        val first = ev.findPointerIndex(drawPointerSaved)
                        if (first >= 0) addFinger(ev, first)
                    } else { ignored.add(pid); return true }
                }
                if (fingers.isEmpty() && ev.actionMasked == MotionEvent.ACTION_DOWN && fingerDraws()) {
                    startInput(ev, idx, finger = true)
                    return true
                }
                addFinger(ev, idx)
                if (fingers.size == 1) { tapStart = SystemClock.uptimeMillis(); tapMoved = false; tapMaxFingers = 1 }
                tapMaxFingers = max(tapMaxFingers, fingers.size)
            }
            MotionEvent.ACTION_MOVE -> {
                if (drawPointer != -1) {
                    val i = ev.findPointerIndex(drawPointer)
                    if (i >= 0) moveInput(ev, i)
                }
                if (fingers.isNotEmpty()) moveFingers(ev, st)
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP -> {
                val pid = ev.getPointerId(idx)
                if (pid == drawPointer) {
                    val canceled = Build.VERSION.SDK_INT >= 33 && (ev.flags and MotionEvent.FLAG_CANCELED) != 0
                    if (canceled) cancelDrawing() else endInput(ev, idx)
                    if (!drawIsFinger) { penDown = false; lastPenUp = SystemClock.uptimeMillis() }
                } else if (fingers.containsKey(pid)) {
                    removeFinger(ev, pid)
                }
                ignored.remove(pid)
                if (ev.actionMasked == MotionEvent.ACTION_UP) {
                    if (fingers.isNotEmpty()) endFingerGesture(cancel = false, ev = ev)
                    ignored.clear()
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                cancelDrawing(); endFingerGesture(cancel = true); penDown = false; ignored.clear()
            }
        }
        return true
    }

    override fun onHoverEvent(ev: MotionEvent): Boolean {
        if (isPenTool(ev.getToolType(0))) {
            if (!stylusSeen) { stylusSeen = true; listener?.onStylusDetected() }
            val erasing = tool == Tool.ERASER || ev.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER || (ev.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
            if (ev.actionMasked == MotionEvent.ACTION_HOVER_EXIT || !erasing) { cursorX = -1f } else {
                cursorX = ev.x; cursorY = ev.y; cursorR = eraserSize * scale
            }
            invalidate()
            return true
        }
        return super.onHoverEvent(ev)
    }

    private var drawPointerSaved = -1

    private fun startInput(ev: MotionEvent, idx: Int, finger: Boolean) {
        val x = ev.getX(idx); val y = ev.getY(idx)
        val stylusEraser = ev.getToolType(idx) == MotionEvent.TOOL_TYPE_ERASER || (ev.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
        drawTool = if (stylusEraser) Tool.ERASER else tool
        drawPointer = ev.getPointerId(idx); drawPointerSaved = drawPointer
        drawIsFinger = finger
        drawStartTime = SystemClock.uptimeMillis()
        when (drawTool) {
            Tool.PEN -> {
                drawPage = hitPage(x, y, tmp)
                buf.clear(); shapeKind = ShapeKind.NONE; shapeSnapped = false
                stabilizer = PenModel.Stabilizer(settings().stabilization)
                if (drawPage >= 0) { addPoint(ev, idx, -1); holdX = x; holdY = y; scheduleHold() }
            }
            Tool.ERASER -> {
                session?.beginBatch()
                cursorR = eraserSize * scale
                eraseAt(x, y)
            }
            Tool.TEXT -> { drawPage = hitPage(x, y, tmp); holdX = x; holdY = y }
            Tool.LASSO -> {
                val pi = hitPage(x, y, tmp)
                val b = Geometry.unionBounds(selection)
                if (selection.isNotEmpty() && pi == selPage && b != null && b.outset(8f / scale).contains(tmp[0], tmp[1])) {
                    moving = true; moveStartX = tmp[0]; moveStartY = tmp[1]; moveDx = 0f; moveDy = 0f
                    excluded = selection.map { it.id }.toHashSet(); contentGen++; requestRender()
                } else {
                    clearSelection()
                    lasso.clear(); lassoPage = pi
                    if (pi >= 0) { lasso.add(tmp[0]); lasso.add(tmp[1]) }
                }
            }
        }
        invalidate()
    }

    private fun addPoint(ev: MotionEvent, idx: Int, h: Int) {
        val x = if (h < 0) ev.getX(idx) else ev.getHistoricalX(idx, h)
        val y = if (h < 0) ev.getY(idx) else ev.getHistoricalY(idx, h)
        val st = settings()
        val rawP = if (h < 0) ev.getPressure(idx) else ev.getHistoricalPressure(idx, h)
        val isStylus = isPenTool(ev.getToolType(idx))
        val p = if (st.pressureEnabled && isStylus) rawP.coerceIn(0.05f, 1f) else 0.6f
        val tilt = if (isStylus) (if (h < 0) ev.getAxisValue(MotionEvent.AXIS_TILT, idx) else ev.getHistoricalAxisValue(MotionEvent.AXIS_TILT, idx, h)) else 0f
        toPage(drawPage, x, y, tmp)
        stabilizer.push(tmp[0], tmp[1], tmp)
        if (buf.count > 0) {
            val lx = buf.data[buf.size - 4]; val ly = buf.data[buf.size - 3]
            if (hypot(tmp[0] - lx, tmp[1] - ly) < 0.35f / scale) return // 중복 점 제거
        }
        buf.add(tmp[0], tmp[1], p, tilt)
    }

    private fun moveInput(ev: MotionEvent, idx: Int) {
        val x = ev.getX(idx); val y = ev.getY(idx)
        when (drawTool) {
            Tool.PEN -> {
                if (drawPage < 0 || shapeSnapped) return
                for (h in 0 until ev.historySize) addPoint(ev, idx, h)
                addPoint(ev, idx, -1)
                if (hypot(x - holdX, y - holdY) > 4 * density) { holdX = x; holdY = y; scheduleHold() }
                invalidate()
            }
            Tool.ERASER -> {
                for (h in 0 until ev.historySize) eraseAt(ev.getHistoricalX(idx, h), ev.getHistoricalY(idx, h))
                eraseAt(x, y)
            }
            Tool.TEXT -> {}
            Tool.LASSO -> {
                if (moving) {
                    toPage(selPage, x, y, tmp); moveDx = tmp[0] - moveStartX; moveDy = tmp[1] - moveStartY
                } else if (lassoPage >= 0) {
                    toPage(lassoPage, x, y, tmp); lasso.add(tmp[0]); lasso.add(tmp[1])
                }
                invalidate()
            }
        }
    }

    private fun endInput(ev: MotionEvent, idx: Int) {
        removeCallbacks(holdRunnable)
        val s = session
        when (drawTool) {
            Tool.PEN -> {
                if (!shapeSnapped && drawPage >= 0) addPoint(ev, idx, -1)
                if (s != null && drawPage in pages.indices && buf.count > 0) {
                    val page = pages[drawPage]
                    val stroke = Stroke(Stroke.newId(), page.id, pen.pen, pen.color, pen.width, pen.opacity, buf.toArray(), System.currentTimeMillis(), shapeKind)
                    val pageIdx = drawPage
                    resetDraw()
                    s.commit(listOf(stroke), emptyList(), "pen")
                    // 무한 스크롤 노트: 아래쪽에 쓰면 페이지 연장
                    if (s.notebook.infinite && stroke.bounds.b > page.height - 120f) s.extendPage(page.id, page.height + max(400f, page.height * 0.5f))
                    if (pageIdx != currentPageIndex()) notifyTransform()
                } else resetDraw()
            }
            Tool.ERASER -> { s?.endBatch("erase"); resetDraw(); cursorX = -1f }
            Tool.TEXT -> {
                val x = ev.getX(idx); val y = ev.getY(idx)
                if (s != null && drawPage in pages.indices && hypot(x - holdX, y - holdY) < 12 * density) {
                    val page = pages[drawPage]
                    toPage(drawPage, x, y, tmp)
                    val hit = s.elementsOf(page.id).lastOrNull { e -> tmp[0] in e.x - 6..e.x + e.w + 6 && tmp[1] in e.y - 6..e.y + kr.eumsoft.notepro.render.ElementRenderer.height(e) + 6 }
                    listener?.onTextTap(page.id, tmp[0], tmp[1], hit)
                }
                resetDraw()
            }
            Tool.LASSO -> {
                if (moving) {
                    moving = false
                    val dx = moveDx; val dy = moveDy
                    excluded = emptySet()
                    if (s != null && (abs(dx) > 0.5f || abs(dy) > 0.5f)) {
                        val m = Geometry.Affine.translate(dx, dy)
                        val moved = selection.map { Geometry.transform(it, m) }
                        val old = selection
                        selection = moved
                        s.commit(moved, old, "move")
                    } else { contentGen++; requestRender() }
                    moveDx = 0f; moveDy = 0f
                } else if (s != null && lassoPage >= 0 && lasso.size >= 6) {
                    val sel = Geometry.lassoSelect(s.strokesOf(pages[lassoPage].id), lasso.toFloatArray())
                    selection = sel; selPage = if (sel.isEmpty()) -1 else lassoPage
                    listener?.onSelectionChanged(sel.size)
                }
                lasso.clear()
                resetDraw()
            }
        }
        invalidate()
    }

    private fun resetDraw() { drawPointer = -1; drawPage = -1; buf.clear(); shapeKind = ShapeKind.NONE; shapeSnapped = false }

    private fun cancelDrawing() {
        removeCallbacks(holdRunnable)
        if (drawPointer == -1) return
        if (drawTool == Tool.ERASER) session?.endBatch("erase")
        if (moving) { moving = false; excluded = emptySet(); contentGen++; requestRender() }
        lasso.clear(); resetDraw(); cursorX = -1f; invalidate()
    }

    private fun scheduleHold() {
        removeCallbacks(holdRunnable)
        if (settings().shapeHold && drawTool == Tool.PEN) postDelayed(holdRunnable, 550)
    }

    private fun trySnapShape() {
        if (drawPointer == -1 || drawTool != Tool.PEN || shapeSnapped || buf.count < 6) return
        val r = ShapeRecognizer.recognize(buf.toArray()) ?: return
        buf.set(r.points); shapeKind = r.kind; shapeSnapped = true
        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        invalidate()
    }

    private fun eraseAt(sx: Float, sy: Float) {
        val s = session ?: return
        cursorX = sx; cursorY = sy; cursorR = eraserSize * scale
        val pi = hitPage(sx, sy, tmp)
        if (pi < 0) { invalidate(); return }
        val pageId = pages[pi].id
        val list = s.strokesOf(pageId)
        val r = eraserSize
        if (eraserMode == EraserMode.STROKE) {
            val hit = list.filter { Geometry.hitStroke(it, tmp[0], tmp[1], r) }
            if (hit.isNotEmpty()) s.commit(emptyList(), hit, "erase")
        } else {
            val removed = ArrayList<Stroke>(); val added = ArrayList<Stroke>()
            for (st in list) {
                val pieces = Geometry.eraseArea(st, tmp[0], tmp[1], r) ?: continue
                removed.add(st)
                pieces.forEach { added.add(st.copy(id = Stroke.newId(), points = it)) }
            }
            if (removed.isNotEmpty()) s.commit(added, removed, "erase")
        }
        invalidate()
    }

    // ---------------- 손가락 제스처 ----------------
    private fun addFinger(ev: MotionEvent, idx: Int) {
        val pid = ev.getPointerId(idx)
        if (pid in ignored) return
        fingers[pid] = floatArrayOf(ev.getX(idx), ev.getY(idx))
        if (velocity == null) velocity = VelocityTracker.obtain()
        velocity?.addMovement(ev)
        resetGestureRef()
    }

    private fun removeFinger(ev: MotionEvent, pid: Int) {
        if (fingers.size == 2 && settings().twoFingerTapUndo && !tapMoved && tapMaxFingers == 2 && SystemClock.uptimeMillis() - tapStart < 280) {
            listener?.onRequestUndo()
            tapMaxFingers = 99 // 한 번만
        }
        fingers.remove(pid)
        resetGestureRef()
    }

    private fun resetGestureRef() {
        if (fingers.isEmpty()) return
        var cx = 0f; var cy = 0f
        for (p in fingers.values) { cx += p[0]; cy += p[1] }
        cx /= fingers.size; cy /= fingers.size
        var span = 0f
        for (p in fingers.values) span += hypot(p[0] - cx, p[1] - cy)
        span /= fingers.size
        gRefX = cx; gRefY = cy; gRefSpan = span; gStartSpan = span
        zooming = false
    }

    private fun moveFingers(ev: MotionEvent, st: Settings) {
        velocity?.addMovement(ev)
        for (i in 0 until ev.pointerCount) {
            val pid = ev.getPointerId(i)
            fingers[pid]?.let { it[0] = ev.getX(i); it[1] = ev.getY(i) }
        }
        if (fingers.isEmpty()) return
        var cx = 0f; var cy = 0f
        for (p in fingers.values) { cx += p[0]; cy += p[1] }
        cx /= fingers.size; cy /= fingers.size
        var span = 0f
        for (p in fingers.values) span += hypot(p[0] - cx, p[1] - cy)
        span /= fingers.size
        if (hypot(cx - gRefX, cy - gRefY) > touchSlop || abs(span - gStartSpan) > touchSlop) tapMoved = true
        val needFingers = if (fingerDraws()) 2 else st.scrollFingers.coerceIn(1, 2)
        // 확대: 간격 변화가 민감도 기준을 넘어야 시작
        if (fingers.size >= 2 && st.zoomEnabled && !st.zoomLocked) {
            val threshold = when (st.gestureSensitivity) { 1 -> 64f; 3 -> 18f; else -> 36f } * density
            if (!zooming && abs(span - gStartSpan) > threshold) { zooming = true; gRefSpan = span }
            if (zooming && gRefSpan > 1f) {
                val f = span / gRefSpan
                val s = (scale * f).coerceIn(minScale(), maxScale())
                ox = cx - (gRefX - ox) * (s / scale); oy = cy - (gRefY - oy) * (s / scale)
                scale = s
                gRefSpan = span
                gRefX = cx; gRefY = cy
            }
        }
        if (!st.scrollLocked && fingers.size >= needFingers) {
            if (!panning && hypot(cx - gRefX, cy - gRefY) > touchSlop) panning = true
            if (panning || zooming) { ox += cx - gRefX; oy += cy - gRefY }
        }
        if (panning || zooming) { gRefX = cx; gRefY = cy }
        clampOffsets()
        invalidate()
        notifyTransform()
    }

    private fun endFingerGesture(cancel: Boolean, ev: MotionEvent? = null) {
        val st = settings()
        if (!cancel && panning && !st.scrollLocked && fingers.size <= 1) {
            velocity?.let { v ->
                v.computeCurrentVelocity(1000)
                val vx = v.xVelocity; val vy = v.yVelocity
                if (hypot(vx, vy) > 600) {
                    val cw = maxW * scale; val ch = totalH * scale
                    scroller.fling(ox.toInt(), oy.toInt(), vx.toInt(), vy.toInt(),
                        min(0f, width - cw).toInt() - 100, max(0f, (width - cw) / 2).toInt() + 100,
                        min(0f, height - ch).toInt() - 100, 0)
                    postInvalidateOnAnimation()
                }
            }
        }
        fingers.clear(); panning = false; zooming = false
        velocity?.recycle(); velocity = null
        scheduleSettle()
    }

    // ================= 선택 영역 작업 =================
    fun hasSelection() = selection.isNotEmpty()

    fun clearSelection() {
        if (selection.isEmpty() && selPage < 0) return
        selection = emptyList(); selPage = -1; listener?.onSelectionChanged(0); invalidate()
    }

    fun deleteSelection() {
        val s = session ?: return
        if (selection.isEmpty()) return
        val old = selection; clearSelection()
        s.commit(emptyList(), old, "delete")
    }

    fun copySelection(): List<Stroke> = selection

    fun transformSelection(m: (kr.eumsoft.notepro.core.Bounds) -> Geometry.Affine) {
        val s = session ?: return
        val b = Geometry.unionBounds(selection) ?: return
        val affine = m(b)
        val moved = selection.map { Geometry.transform(it, affine) }
        val old = selection
        selection = moved
        s.commit(moved, old, "transform")
    }

    fun recolorSelection(color: Int) {
        val s = session ?: return
        if (selection.isEmpty()) return
        val moved = selection.map { it.copy(color = color) }
        val old = selection; selection = moved
        s.commit(moved, old, "recolor")
    }

    /** 다른 창(또는 같은 창)에서 복사한 획 붙여넣기: 현재 보이는 페이지 가운데에 놓는다. */
    fun paste(strokes: List<Stroke>) {
        val s = session ?: return
        if (strokes.isEmpty() || pages.isEmpty()) return
        val pi = currentPageIndex()
        val page = pages[pi]
        val b = Geometry.unionBounds(strokes) ?: return
        toPage(pi, width / 2f, height / 2f, tmp)
        val cx = tmp[0].coerceIn(b.width / 2, max(b.width / 2, page.width - b.width / 2))
        val cy = tmp[1].coerceIn(b.height / 2, max(b.height / 2, page.height - b.height / 2))
        val m = Geometry.Affine.translate(cx - (b.l + b.r) / 2, cy - (b.t + b.b) / 2)
        val pasted = strokes.map { Geometry.transform(it, m, page.id).copy(id = Stroke.newId()) }
        s.commit(pasted, emptyList(), "paste")
        tool = Tool.LASSO
        selection = pasted; selPage = pi; listener?.onSelectionChanged(pasted.size); invalidate()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        removeCallbacks(holdRunnable); removeCallbacks(settleRender)
    }

    companion object {
        private val BITMAP_PAINT = Paint(Paint.FILTER_BITMAP_FLAG)
    }
}
