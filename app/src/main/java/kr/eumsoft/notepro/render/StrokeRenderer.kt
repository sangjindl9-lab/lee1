package kr.eumsoft.notepro.render

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenModel
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.ShapeKind
import kr.eumsoft.notepro.core.Stroke

/** 획 그리기(화면·내보내기 공통). 캔버스는 이미 페이지 좌표로 변환되어 있어야 한다. 스레드별 Paint 사용. */
object StrokeRenderer {
    private val tlPaint = ThreadLocal.withInitial {
        Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    }
    private val tlPath = ThreadLocal.withInitial { Path() }
    private val tlRect = ThreadLocal.withInitial { RectF() }

    fun drawAll(c: Canvas, list: List<Stroke>) { for (s in list) draw(c, s) }

    fun draw(c: Canvas, s: Stroke) = drawPoints(c, s.points, s.points.size, s.pen, s.color, s.width, s.opacity, s.shape)

    fun drawPoints(c: Canvas, p: FloatArray, size: Int, pen: PenType, color: Int, width: Float, opacity: Float, shape: Int) {
        val n = size / Stroke.STRIDE
        if (n == 0) return
        val paint = tlPaint.get()!!
        paint.color = color
        paint.style = Paint.Style.STROKE
        if (pen == PenType.HIGHLIGHTER || shape != ShapeKind.NONE) {
            // 일정한 굵기: 경로 하나로 그림(형광펜은 겹쳐도 진해지지 않음)
            val path = tlPath.get()!!
            path.rewind()
            path.moveTo(p[0], p[1])
            if (n == 1) path.lineTo(p[0] + 0.1f, p[1])
            var i = 1
            while (i < n) {
                val x0 = p[(i - 1) * 4]; val y0 = p[(i - 1) * 4 + 1]; val x1 = p[i * 4]; val y1 = p[i * 4 + 1]
                path.quadTo(x0, y0, (x0 + x1) / 2f, (y0 + y1) / 2f)
                i++
            }
            path.lineTo(p[(n - 1) * 4], p[(n - 1) * 4 + 1])
            paint.strokeWidth = if (shape != ShapeKind.NONE) PenModel.widthAt(pen, width, p[2], 0f, true) else width
            paint.strokeCap = if (pen == PenType.HIGHLIGHTER) Paint.Cap.SQUARE else Paint.Cap.ROUND
            paint.alpha = (opacity.coerceIn(0.05f, 1f) * 255).toInt()
            c.drawPath(path, paint)
            paint.strokeCap = Paint.Cap.ROUND
            return
        }
        val layered = opacity < 0.99f
        if (layered) {
            val r = tlRect.get()!!
            var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var rr = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
            var i = 0
            while (i < size) { val x = p[i]; val y = p[i + 1]; if (x < l) l = x; if (x > rr) rr = x; if (y < t) t = y; if (y > b) b = y; i += 4 }
            val pad = width * 3 + 2
            r.set(l - pad, t - pad, rr + pad, b + pad)
            c.saveLayerAlpha(r, (opacity * 255).toInt())
        }
        paint.alpha = 255
        if (n == 1) {
            paint.style = Paint.Style.FILL
            c.drawCircle(p[0], p[1], PenModel.widthAt(pen, width, p[2], p[3], true) / 2f, paint)
            paint.style = Paint.Style.STROKE
        } else {
            var prevW = PenModel.widthAt(pen, width, p[2], p[3], true)
            for (i in 1 until n) {
                val w = PenModel.widthAt(pen, width, p[i * 4 + 2], p[i * 4 + 3], true)
                paint.strokeWidth = (prevW + w) / 2f
                c.drawLine(p[(i - 1) * 4], p[(i - 1) * 4 + 1], p[i * 4], p[i * 4 + 1], paint)
                prevW = w
            }
        }
        if (layered) c.restore()
    }
}

/** 용지(줄·모눈·점선) 및 템플릿 그리기. */
object PaperPainter {
    /** 템플릿 글자(다국어 리소스에서 앱 시작 시 채움): 회의록, 날짜, 참석자, 안건, 할 일, 요일×7, 메모, 키워드, 요약 */
    @Volatile var labels: Array<String> = arrayOf("Meeting", "Date", "Attendees", "Agenda", "To-do", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Notes", "Keywords", "Summary")

    private val tl = ThreadLocal.withInitial {
        arrayOf(
            Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.WHITE },
            Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xFFB9C6D8.toInt(); strokeWidth = 0.6f },
            Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = 0xFF9AA8BC.toInt() },
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF5B6B82.toInt(); textSize = 11f },
        )
    }

    fun draw(c: Canvas, page: PageData, @Suppress("UNUSED_PARAMETER") scale: Float, forExport: Boolean = false) {
        val (bg, line, dot, text) = tl.get()!!
        if (page.bgType == BackgroundType.PDF) return
        c.drawRect(0f, 0f, page.width, page.height, bg)
        val w = page.width; val h = page.height
        val top = if (page.template == PageTemplate.NONE) 60f else 0f
        when (page.paper) {
            PaperStyle.BLANK -> {}
            PaperStyle.LINED -> { var y = top + 24f; while (y < h - 24f) { c.drawLine(36f, y, w - 36f, y, line); y += 24f } }
            PaperStyle.GRID -> {
                var x = 18f; while (x < w) { c.drawLine(x, 18f, x, h - 18f, line); x += 18f }
                var y = 18f; while (y < h) { c.drawLine(18f, y, w - 18f, y, line); y += 18f }
            }
            PaperStyle.DOT -> {
                var y = 18f
                while (y < h) { var x = 18f; while (x < w) { c.drawCircle(x, y, 0.9f, dot); x += 18f }; y += 18f }
            }
        }
        val strong = Paint(line).apply { strokeWidth = 1.1f; color = 0xFF7D8DA6.toInt() }
        when (page.template) {
            PageTemplate.NONE -> {}
            PageTemplate.MEETING -> {
                text.textSize = 18f; c.drawText(labels[0], 36f, 44f, text); text.textSize = 11f
                c.drawLine(36f, 54f, w - 36f, 54f, strong)
                c.drawText(labels[1], 36f, 76f, text); c.drawText(labels[2], w / 2f, 76f, text)
                c.drawLine(36f, 84f, w - 36f, 84f, line)
                c.drawText(labels[3], 36f, 108f, text)
                val todoY = h * 0.72f
                c.drawLine(36f, todoY, w - 36f, todoY, strong)
                c.drawText(labels[4], 36f, todoY + 20f, text)
                var y = todoY + 44f
                while (y < h - 30f) { c.drawRect(40f, y - 9f, 50f, y + 1f, line); y += 24f }
            }
            PageTemplate.PLANNER -> {
                val cols = 2; val rows = 4
                val cw = (w - 72f) / cols; val rh = (h - 90f) / rows
                for (i in 0 until 8) {
                    val cx = 36f + (i % cols) * cw; val cy = 50f + (i / cols) * rh
                    c.drawRect(cx, cy, cx + cw, cy + rh, strong)
                    c.drawText(if (i < 7) labels[5 + i] else labels[12], cx + 6f, cy + 16f, text)
                }
            }
            PageTemplate.STUDY -> {
                val cue = w * 0.3f; val sumY = h * 0.78f
                c.drawLine(cue, 40f, cue, sumY, strong)
                c.drawLine(24f, sumY, w - 24f, sumY, strong)
                c.drawText(labels[13], 30f, 56f, text); c.drawText(labels[12], cue + 8f, 56f, text)
                c.drawText(labels[14], 30f, sumY + 18f, text)
            }
        }
        if (!forExport) Unit
    }
}

/** 텍스트 주석 그리기. AI가 만든 내용은 연보라 배경 + "AI" 표시로 사용자 기록과 항상 구분한다. */
object ElementRenderer {
    @Volatile var aiLabel = "AI"
    private val tlText = ThreadLocal.withInitial { android.text.TextPaint(Paint.ANTI_ALIAS_FLAG) }
    private val tlBg = ThreadLocal.withInitial { Paint(Paint.ANTI_ALIAS_FLAG) }
    private val tlLabel = ThreadLocal.withInitial { android.text.TextPaint(Paint.ANTI_ALIAS_FLAG).apply { isFakeBoldText = true; color = 0xFF7048E8.toInt() } }

    private fun layout(e: kr.eumsoft.notepro.core.PageElement): android.text.StaticLayout {
        val tp = tlText.get()!!
        tp.textSize = e.size; tp.color = e.color
        val w = e.w.toInt().coerceAtLeast(40)
        return android.text.StaticLayout.Builder.obtain(e.text, 0, e.text.length, tp, w).setLineSpacing(0f, 1.15f).build()
    }

    /** 페이지 좌표에서의 높이(터치 판정용) */
    fun height(e: kr.eumsoft.notepro.core.PageElement): Float = layout(e).height.toFloat() + if (e.author == "ai") e.size * 1.4f else 0f

    fun draw(c: Canvas, e: kr.eumsoft.notepro.core.PageElement) {
        val l = layout(e)
        val ai = e.author == "ai"
        val top = e.y + if (ai) e.size * 1.4f else 0f
        if (ai) {
            val bg = tlBg.get()!!
            bg.style = Paint.Style.FILL; bg.color = 0x1F7048E8
            c.drawRoundRect(e.x - 6f, e.y - 4f, e.x + e.w + 6f, top + l.height + 6f, 6f, 6f, bg)
            bg.style = Paint.Style.STROKE; bg.color = 0x887048E8.toInt(); bg.strokeWidth = 0.8f
            c.drawRoundRect(e.x - 6f, e.y - 4f, e.x + e.w + 6f, top + l.height + 6f, 6f, 6f, bg)
            val tp = tlLabel.get()!!
            tp.textSize = e.size * 0.75f
            c.drawText(aiLabel, e.x, e.y + e.size * 0.9f, tp)
        }
        c.save(); c.translate(e.x, top); l.draw(c); c.restore()
    }
}
