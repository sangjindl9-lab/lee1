package kr.eumsoft.notepro.core

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** 지우개·올가미·변환 등 획 기하 연산(플랫폼 독립). */
object Geometry {

    fun distToSegment(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
        val dx = bx - ax; val dy = by - ay
        val len2 = dx * dx + dy * dy
        if (len2 < 1e-6f) return hypot(px - ax, py - ay)
        var t = ((px - ax) * dx + (py - ay) * dy) / len2
        t = t.coerceIn(0f, 1f)
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }

    /** 획 단위 지우개: 반경 안에 획의 선분이 닿는지. */
    fun hitStroke(s: Stroke, x: Float, y: Float, radius: Float): Boolean {
        if (!s.bounds.outset(radius).contains(x, y)) return false
        val p = s.points
        val r = radius + s.width / 2f
        if (s.count == 1) return hypot(p[0] - x, p[1] - y) <= r
        var i = 0
        while (i + Stroke.STRIDE < p.size) {
            if (distToSegment(x, y, p[i], p[i + 1], p[i + 4], p[i + 5]) <= r) return true
            i += Stroke.STRIDE
        }
        return false
    }

    /**
     * 영역 지우개: 원 안의 점을 제거하고 남은 조각을 돌려준다.
     * null = 닿지 않음, 빈 목록 = 전부 지워짐.
     */
    fun eraseArea(s: Stroke, x: Float, y: Float, radius: Float): List<FloatArray>? {
        if (!s.bounds.outset(radius).contains(x, y)) return null
        val p = s.points
        val r = radius + s.width / 2f
        val pieces = ArrayList<FloatArray>()
        var cur = ArrayList<Float>()
        var touched = false
        var i = 0
        while (i < p.size) {
            val inside = hypot(p[i] - x, p[i + 1] - y) <= r
            if (inside) {
                touched = true
                if (cur.size >= 2 * Stroke.STRIDE) pieces.add(cur.toFloatArray())
                cur = ArrayList()
            } else {
                for (k in 0 until Stroke.STRIDE) cur.add(p[i + k])
            }
            i += Stroke.STRIDE
        }
        if (!touched) {
            // 점 사이 선분만 원을 지나가는 경우: 해당 선분에서 자른다
            var hitAt = -1
            var j = 0
            while (j + Stroke.STRIDE < p.size) {
                if (distToSegment(x, y, p[j], p[j + 1], p[j + 4], p[j + 5]) <= r) { hitAt = j; break }
                j += Stroke.STRIDE
            }
            if (hitAt < 0) return null
            val a = p.copyOfRange(0, hitAt + Stroke.STRIDE)
            val b = p.copyOfRange(hitAt + Stroke.STRIDE, p.size)
            return listOf(a, b).filter { it.size >= 2 * Stroke.STRIDE }
        }
        if (cur.size >= 2 * Stroke.STRIDE) pieces.add(cur.toFloatArray())
        return pieces
    }

    fun pointInPolygon(x: Float, y: Float, poly: FloatArray): Boolean {
        var inside = false
        val n = poly.size / 2
        var j = n - 1
        for (i in 0 until n) {
            val xi = poly[i * 2]; val yi = poly[i * 2 + 1]
            val xj = poly[j * 2]; val yj = poly[j * 2 + 1]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-9f) + xi) inside = !inside
            j = i
        }
        return inside
    }

    /** 올가미 선택: 획의 점 절반 이상이 다각형 안에 있으면 선택. */
    fun lassoSelect(strokes: List<Stroke>, poly: FloatArray): List<Stroke> {
        if (poly.size < 6) return emptyList()
        return strokes.filter { s ->
            var inside = 0
            var i = 0
            while (i < s.points.size) {
                if (pointInPolygon(s.points[i], s.points[i + 1], poly)) inside++
                i += Stroke.STRIDE
            }
            inside * 2 >= s.count && s.count > 0
        }
    }

    /** 2x3 아핀 변환 [a b c / d e f] : x' = a x + b y + c, y' = d x + e y + f */
    class Affine(val a: Float, val b: Float, val c: Float, val d: Float, val e: Float, val f: Float) {
        fun det() = a * e - b * d
        companion object {
            fun translate(dx: Float, dy: Float) = Affine(1f, 0f, dx, 0f, 1f, dy)
            fun scaleAbout(sx: Float, cx: Float, cy: Float) = Affine(sx, 0f, cx - sx * cx, 0f, sx, cy - sx * cy)
            fun rotateAbout(rad: Float, cx: Float, cy: Float): Affine {
                val co = cos(rad); val si = sin(rad)
                return Affine(co, -si, cx - co * cx + si * cy, si, co, cy - si * cx - co * cy)
            }
        }
    }

    fun transform(s: Stroke, m: Affine, newPageId: String = s.pageId): Stroke {
        val src = s.points
        val out = src.copyOf()
        var i = 0
        while (i < out.size) {
            val x = src[i]; val y = src[i + 1]
            out[i] = m.a * x + m.b * y + m.c
            out[i + 1] = m.d * x + m.e * y + m.f
            i += Stroke.STRIDE
        }
        val k = sqrt(abs(m.det())).coerceIn(0.05f, 20f)
        return s.copy(points = out, width = max(0.2f, s.width * k), pageId = newPageId)
    }

    fun unionBounds(list: List<Stroke>): Bounds? {
        if (list.isEmpty()) return null
        val b = list[0].bounds
        val u = Bounds(b.l, b.t, b.r, b.b)
        for (s in list) {
            val o = s.bounds
            if (o.l < u.l) u.l = o.l; if (o.t < u.t) u.t = o.t
            if (o.r > u.r) u.r = o.r; if (o.b > u.b) u.b = o.b
        }
        return u
    }
}
