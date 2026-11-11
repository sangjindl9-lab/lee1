package kr.eumsoft.kidscoloring.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kr.eumsoft.kidscoloring.engine.BrushType
import kr.eumsoft.kidscoloring.engine.PaintEngine
import kr.eumsoft.kidscoloring.engine.Sticker
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

enum class Tool(val label: String, val emoji: String, val brush: BrushType?) {
    FILL("채우기", "🎨", null),
    PEN("붓", "🖌", BrushType.PEN),
    PENCIL("색연필", "✏", BrushType.PENCIL),
    CRAYON("크레용", "🖍", BrushType.CRAYON),
    HIGHLIGHTER("형광펜", "🖊", BrushType.HIGHLIGHTER),
    GLITTER("반짝이", "✨", BrushType.GLITTER),
    ERASER("지우개", "🧼", BrushType.ERASER),
    REGION_ERASER("칸 지우기", "❌", null),
    STICKER("스티커", "⭐", null),
}

/** 화면과 내보내기 이미지가 똑같이 그려지도록 한 곳에서 그린다 (도안 좌표계 기준). */
object Render {
    private val white = Paint().apply { color = Color.WHITE }
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val linePaint = Paint(Paint.FILTER_BITMAP_FLAG).apply { color = Color.BLACK }
    private val stFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xFF333333.toInt(); strokeJoin = Paint.Join.ROUND }
    val stickerNames = listOf("별", "하트", "꽃", "구름")
    val stickerEmoji = listOf("⭐", "❤", "🌸", "☁")

    fun draw(c: Canvas, size: Int, paint: Bitmap?, line: Bitmap?, stickers: List<Sticker>) {
        c.drawRect(0f, 0f, size.toFloat(), size.toFloat(), white)
        paint?.let { c.drawBitmap(it, 0f, 0f, bmpPaint) }
        line?.let { c.drawBitmap(it, 0f, 0f, linePaint) }
        for (s in stickers) sticker(c, s)
    }

    /** 자체 제작 스티커 (도형을 직접 그린다) */
    fun stickerPath(type: Int, r: Float): Path {
        val p = Path()
        when (type) {
            0 -> {                                  // 별
                for (i in 0 until 10) {
                    val rr = if (i % 2 == 0) r else r * 0.45f
                    val a = Math.toRadians(-90.0 + i * 36.0)
                    val x = (cos(a) * rr).toFloat(); val y = (sin(a) * rr).toFloat()
                    if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
                }
                p.close()
            }
            1 -> {                                  // 하트
                p.moveTo(0f, r * 0.9f)
                p.cubicTo(-r * 1.5f, -r * 0.1f, -r * 0.7f, -r * 1.2f, 0f, -r * 0.4f)
                p.cubicTo(r * 0.7f, -r * 1.2f, r * 1.5f, -r * 0.1f, 0f, r * 0.9f)
                p.close()
            }
            2 -> {                                  // 꽃
                for (i in 0 until 5) {
                    val a = Math.toRadians(-90.0 + i * 72.0)
                    p.addCircle((cos(a) * r * 0.55f).toFloat(), (sin(a) * r * 0.55f).toFloat(), r * 0.42f, Path.Direction.CW)
                }
                p.addCircle(0f, 0f, r * 0.3f, Path.Direction.CW)
            }
            else -> {                               // 구름
                p.addCircle(-r * 0.5f, r * 0.15f, r * 0.42f, Path.Direction.CW)
                p.addCircle(0f, -r * 0.15f, r * 0.55f, Path.Direction.CW)
                p.addCircle(r * 0.55f, r * 0.15f, r * 0.4f, Path.Direction.CW)
                p.addRect(-r * 0.5f, r * 0.1f, r * 0.55f, r * 0.57f, Path.Direction.CW)
            }
        }
        return p
    }

    fun sticker(c: Canvas, s: Sticker) {
        val r = s.size / 2
        c.save()
        c.translate(s.x, s.y)
        val p = stickerPath(s.type, r)
        stFill.color = s.color
        stLine.strokeWidth = max(3f, r * 0.09f)
        if (s.type >= 2) {      // 여러 원을 합친 모양: 바깥 테두리를 먼저 굵게 그리고 안을 채운다
            stLine.strokeWidth *= 2
            c.drawPath(p, stLine)
            c.drawPath(p, stFill)
            if (s.type == 2) { stFill.color = 0xFFFFF59D.toInt(); c.drawCircle(0f, 0f, r * 0.26f, stFill) }
        } else {
            c.drawPath(p, stFill)
            c.drawPath(p, stLine)
        }
        c.restore()
    }

    fun composite(size: Int, outSize: Int, paint: Bitmap?, line: Bitmap?, stickers: List<Sticker>): Bitmap {
        val out = Bitmap.createBitmap(outSize, outSize, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.scale(outSize / size.toFloat(), outSize / size.toFloat())
        draw(c, size, paint, line, stickers)
        return out
    }
}

/** 색칠 캔버스. 손가락/스타일러스 입력, 두 손가락 확대·이동을 처리한다. */
@SuppressLint("ViewConstructor")
class ColoringView(ctx: Context) : View(ctx) {
    var engine: PaintEngine? = null
    var paintBitmap: Bitmap? = null
    var lineBitmap: Bitmap? = null

    var tool = Tool.FILL
    var color = Color.RED
    var brushSize = 28f
    var opacity = 1f
    var stayInside = true
    var fingerPansOnly = false
    var stickerType = 0

    /** 그림이 바뀔 때마다 (실행 취소 버튼 상태 갱신 등) */
    var onEdited: (() -> Unit)? = null
    /** 영역을 채웠을 때 */
    var onFilled: (() -> Unit)? = null

    private val m = Matrix()
    private val inv = Matrix()
    private var scale = 1f
    private var tx = 0f
    private var ty = 0f
    private var fitScale = 1f
    private var fitted = true
    private val pt = FloatArray(2)
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop.toFloat()

    private enum class Mode { NONE, TAP, DRAW, PAN, ZOOM, IGNORE }
    private var mode = Mode.NONE
    private var downX = 0f
    private var downY = 0f
    private var downTime = 0L
    private var lastX = 0f
    private var lastY = 0f
    private var stylusTime = -10_000L
    private var pinchDist = 1f
    private var pinchCx = 0f
    private var pinchCy = 0f

    init { contentDescription = "색칠 도안" }

    private val size get() = engine?.w ?: 1

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (fitted || oldw == 0) fit() else {
            // 회전해도 보고 있던 곳이 가운데에 오도록
            pt[0] = oldw / 2f; pt[1] = oldh / 2f; inv.mapPoints(pt)
            fitScale = min(w, h) / size.toFloat() * 0.96f
            scale = scale.coerceIn(fitScale, fitScale * 8)
            tx = w / 2f - pt[0] * scale; ty = h / 2f - pt[1] * scale
            apply()
        }
    }

    /** 화면 맞춤 */
    fun fit() {
        if (width == 0 || height == 0) return
        fitScale = min(width, height) / size.toFloat() * 0.96f
        scale = fitScale
        tx = (width - size * scale) / 2f
        ty = (height - size * scale) / 2f
        fitted = true
        apply()
    }

    private fun apply() {
        val s = size * scale
        tx = tx.coerceIn(width * 0.2f - s, width * 0.8f)
        ty = ty.coerceIn(height * 0.2f - s, height * 0.8f)
        m.setScale(scale, scale); m.postTranslate(tx, ty); m.invert(inv)
        invalidate()
    }

    /** 엔진에서 바뀐 부분만 화면용 비트맵에 올린다 */
    fun sync() {
        val e = engine ?: return
        val b = paintBitmap ?: return
        e.consumeDirty()?.let { r -> b.setPixels(e.paint, r[1] * e.w + r[0], e.w, r[0], r[1], r[2] - r[0] + 1, r[3] - r[1] + 1) }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val e = engine ?: return
        canvas.save()
        canvas.concat(m)
        Render.draw(canvas, e.w, paintBitmap, lineBitmap, e.stickers)
        canvas.restore()
    }

    private fun toArt(x: Float, y: Float) { pt[0] = x; pt[1] = y; inv.mapPoints(pt) }

    private fun isStylus(e: MotionEvent, i: Int = 0) = e.getToolType(i).let { it == MotionEvent.TOOL_TYPE_STYLUS || it == MotionEvent.TOOL_TYPE_ERASER }

    /** 필압: 스타일러스만 반영한다. 손가락은 기기마다 값이 제각각이라 1 로 본다. */
    private fun pressure(p: Float, stylus: Boolean) = if (stylus) p.coerceIn(0.05f, 1f) else 1f

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val eng = engine ?: return false
        val stylus = isStylus(e)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                downX = e.x; downY = e.y; lastX = e.x; lastY = e.y; downTime = e.eventTime
                if (stylus) stylusTime = e.eventTime
                val brush = if (e.getToolType(0) == MotionEvent.TOOL_TYPE_ERASER) BrushType.ERASER else tool.brush
                mode = when {
                    // 손바닥 오작동 방지: 펜을 쓰는 중이거나 방금 썼으면 손가락(손바닥) 터치는 무시
                    !stylus && e.eventTime - stylusTime < 600 -> Mode.IGNORE
                    brush == null -> Mode.TAP
                    !stylus && fingerPansOnly -> Mode.PAN
                    else -> {
                        toArt(e.x, e.y)
                        if (brush == BrushType.ERASER && eng.removeStickerAt(pt[0], pt[1])) { edited(); Mode.IGNORE }
                        else {
                            val clip = if (stayInside && brush != BrushType.ERASER) eng.regionAt(pt[0].toInt(), pt[1].toInt()) else 0
                            if (stayInside && brush != BrushType.ERASER && clip == 0) Mode.IGNORE
                            else {
                                eng.beginStroke(pt[0], pt[1], pressure(e.pressure, stylus), brush, color, brushSize, opacity, clip)
                                sync(); Mode.DRAW
                            }
                        }
                    }
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (mode == Mode.IGNORE && e.eventTime - stylusTime < 600) return true
                if (mode == Mode.DRAW) {
                    if (stylus) return true                       // 펜으로 그리는 중에 닿은 손은 무시
                    if (e.eventTime - downTime < 300) eng.cancelStroke() else eng.endStroke()
                    edited()
                }
                mode = Mode.ZOOM
                pinchDist = max(1f, hypot(e.getX(0) - e.getX(1), e.getY(0) - e.getY(1)))
                pinchCx = (e.getX(0) + e.getX(1)) / 2; pinchCy = (e.getY(0) + e.getY(1)) / 2
            }
            MotionEvent.ACTION_MOVE -> when (mode) {
                Mode.TAP -> if (hypot(e.x - downX, e.y - downY) > slop * 1.5f) { mode = Mode.PAN; lastX = e.x; lastY = e.y }
                Mode.PAN -> { tx += e.x - lastX; ty += e.y - lastY; lastX = e.x; lastY = e.y; fitted = false; apply() }
                Mode.DRAW -> {
                    for (i in 0 until e.historySize) {
                        toArt(e.getHistoricalX(i), e.getHistoricalY(i))
                        eng.strokeTo(pt[0], pt[1], pressure(e.getHistoricalPressure(i), stylus))
                    }
                    toArt(e.x, e.y)
                    eng.strokeTo(pt[0], pt[1], pressure(e.pressure, stylus))
                    if (stylus) stylusTime = e.eventTime
                    sync()
                }
                Mode.ZOOM -> if (e.pointerCount >= 2) {
                    val d = max(1f, hypot(e.getX(0) - e.getX(1), e.getY(0) - e.getY(1)))
                    val cx = (e.getX(0) + e.getX(1)) / 2; val cy = (e.getY(0) + e.getY(1)) / 2
                    val ns = (scale * d / pinchDist).coerceIn(fitScale * 0.8f, fitScale * 8f)
                    tx = cx - (pinchCx - tx) * ns / scale
                    ty = cy - (pinchCy - ty) * ns / scale
                    scale = ns; pinchDist = d; pinchCx = cx; pinchCy = cy; fitted = false
                    apply()
                }
                else -> {}
            }
            MotionEvent.ACTION_POINTER_UP -> if (mode == Mode.ZOOM && e.pointerCount == 2) {
                val keep = if (e.actionIndex == 0) 1 else 0
                lastX = e.getX(keep); lastY = e.getY(keep)
                mode = Mode.PAN
            }
            MotionEvent.ACTION_UP -> {
                when (mode) {
                    Mode.TAP -> tap(e.x, e.y)
                    Mode.DRAW -> { if (stylus) stylusTime = e.eventTime; eng.endStroke(); edited() }
                    else -> {}
                }
                mode = Mode.NONE
            }
            MotionEvent.ACTION_CANCEL -> {
                if (mode == Mode.DRAW) { eng.cancelStroke(); edited() }
                mode = Mode.NONE
            }
        }
        return true
    }

    private fun tap(x: Float, y: Float) {
        val eng = engine ?: return
        toArt(x, y)
        val ax = pt[0]; val ay = pt[1]
        when (tool) {
            Tool.FILL -> if (eng.fillAt(ax.toInt(), ay.toInt(), color or (0xFF shl 24)) != 0) { edited(); onFilled?.invoke() }
            Tool.REGION_ERASER -> if (!eng.removeStickerAt(ax, ay)) { if (eng.fillAt(ax.toInt(), ay.toInt(), 0) != 0) edited() } else edited()
            Tool.STICKER -> if (ax >= 0 && ay >= 0 && ax < eng.w && ay < eng.h) {
                eng.addSticker(Sticker(stickerType, ax, ay, 90f + brushSize * 3f, color or (0xFF shl 24)))
                edited()
            }
            else -> {}
        }
    }

    private fun edited() { sync(); onEdited?.invoke() }
}
