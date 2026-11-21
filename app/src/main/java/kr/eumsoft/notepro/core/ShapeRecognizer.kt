package kr.eumsoft.notepro.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 손으로 그린 획을 직선·원·타원·사각형·삼각형·화살표로 보정한다.
 * 필기 끝에서 펜을 잠시 멈추면(홀드) 호출된다.
 */
object ShapeRecognizer {

    class Result(val kind: Int, val points: FloatArray)

    fun recognize(points: FloatArray): Result? {
        val n = points.size / Stroke.STRIDE
        if (n < 4) return null
        val xs = FloatArray(n) { points[it * Stroke.STRIDE] }
        val ys = FloatArray(n) { points[it * Stroke.STRIDE + 1] }
        val avgP = (0 until n).map { points[it * Stroke.STRIDE + 2] }.average().toFloat().coerceIn(0.2f, 1f)
        var length = 0f
        for (i in 1 until n) length += hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
        if (length < 20f) return null
        val minX = xs.min(); val maxX = xs.max(); val minY = ys.min(); val maxY = ys.max()
        val diag = hypot(maxX - minX, maxY - minY)
        val endGap = hypot(xs[n - 1] - xs[0], ys[n - 1] - ys[0])

        // 1) 직선
        val chord = endGap
        if (chord > 0.9f * length || run {
                var maxDev = 0f
                for (i in 0 until n) maxDev = max(maxDev, Geometry.distToSegment(xs[i], ys[i], xs[0], ys[0], xs[n - 1], ys[n - 1]))
                maxDev < 0.05f * chord && chord > 0.7f * length
            }) {
            var x2 = xs[n - 1]; var y2 = ys[n - 1]
            // 수평·수직에 가까우면 맞춘다
            val ang = atan2(y2 - ys[0], x2 - xs[0])
            val snap = (Math.round(ang / (PI / 4)) * (PI / 4)).toFloat()
            if (abs(ang - snap) < 0.08f) {
                x2 = xs[0] + cos(snap) * chord; y2 = ys[0] + sin(snap) * chord
            }
            return Result(ShapeKind.LINE, polyline(floatArrayOf(xs[0], ys[0], x2, y2), avgP))
        }

        val closed = endGap < max(0.22f * diag, 12f)
        if (closed) {
            // 2) 다각형(꼭짓점 단순화)
            val simplified = douglasPeucker(xs, ys, 0.06f * diag)
            var corners = simplified.size / 2
            // 시작=끝 중복 제거
            if (corners >= 2 && hypot(simplified[0] - simplified[simplified.size - 2], simplified[1] - simplified[simplified.size - 1]) < 0.22f * diag) corners -= 1
            // 3) 원/타원 판정: 중심에서 반지름 오차
            val cx = (minX + maxX) / 2f; val cy = (minY + maxY) / 2f
            val rx = (maxX - minX) / 2f; val ry = (maxY - minY) / 2f
            if (rx > 3f && ry > 3f) {
                var err = 0f
                for (i in 0 until n) {
                    val dx = (xs[i] - cx) / rx; val dy = (ys[i] - cy) / ry
                    err += abs(sqrt(dx * dx + dy * dy) - 1f)
                }
                err /= n
                if (err < 0.11f && corners !in 3..4 || err < 0.07f) {
                    return if (abs(rx - ry) / max(rx, ry) < 0.18f) {
                        val r = (rx + ry) / 2f
                        Result(ShapeKind.CIRCLE, ellipse(cx, cy, r, r, avgP))
                    } else Result(ShapeKind.ELLIPSE, ellipse(cx, cy, rx, ry, avgP))
                }
            }
            if (corners == 4) {
                return Result(ShapeKind.RECT, polyline(floatArrayOf(minX, minY, maxX, minY, maxX, maxY, minX, maxY, minX, minY), avgP))
            }
            if (corners == 3) {
                val pts = simplified.copyOfRange(0, 6)
                return Result(ShapeKind.TRIANGLE, polyline(pts + floatArrayOf(pts[0], pts[1]), avgP))
            }
            return null
        }

        // 4) 화살표: 긴 몸통 + 짧은 꺾임 머리
        val simplified = douglasPeucker(xs, ys, 0.08f * diag)
        val m = simplified.size / 2
        if (m in 3..4) {
            val body = hypot(simplified[2] - simplified[0], simplified[3] - simplified[1])
            if (body > 0.6f * length * 0.7f) {
                val tipX = simplified[2]; val tipY = simplified[3]
                val sx = simplified[0]; val sy = simplified[1]
                val head = min(body * 0.25f, 40f)
                val a = atan2(tipY - sy, tipX - sx)
                val l = floatArrayOf(tipX - head * cos(a - 0.5f), tipY - head * sin(a - 0.5f))
                val r = floatArrayOf(tipX - head * cos(a + 0.5f), tipY - head * sin(a + 0.5f))
                return Result(ShapeKind.ARROW, polyline(floatArrayOf(sx, sy, tipX, tipY, l[0], l[1], tipX, tipY, r[0], r[1]), avgP))
            }
        }
        return null
    }

    /** 꼭짓점 목록을 일정 간격 점으로 채운다(지우개·렌더링 호환). */
    fun polyline(v: FloatArray, p: Float, step: Float = 4f): FloatArray {
        val out = ArrayList<Float>()
        val m = v.size / 2
        for (i in 0 until m - 1) {
            val ax = v[i * 2]; val ay = v[i * 2 + 1]; val bx = v[i * 2 + 2]; val by = v[i * 2 + 3]
            val len = hypot(bx - ax, by - ay)
            val k = max(1, (len / step).toInt())
            for (j in 0 until k) {
                val t = j / k.toFloat()
                out.add(ax + (bx - ax) * t); out.add(ay + (by - ay) * t); out.add(p); out.add(0f)
            }
        }
        out.add(v[v.size - 2]); out.add(v[v.size - 1]); out.add(p); out.add(0f)
        return out.toFloatArray()
    }

    fun ellipse(cx: Float, cy: Float, rx: Float, ry: Float, p: Float): FloatArray {
        val per = (2 * PI * sqrt((rx * rx + ry * ry) / 2.0)).toFloat()
        val k = max(24, (per / 4f).toInt())
        val out = FloatArray((k + 1) * Stroke.STRIDE)
        for (i in 0..k) {
            val a = 2 * PI * i / k
            out[i * 4] = cx + (rx * cos(a)).toFloat()
            out[i * 4 + 1] = cy + (ry * sin(a)).toFloat()
            out[i * 4 + 2] = p
        }
        return out
    }

    fun douglasPeucker(xs: FloatArray, ys: FloatArray, eps: Float): FloatArray {
        val n = xs.size
        val keep = BooleanArray(n)
        keep[0] = true; keep[n - 1] = true
        fun rec(a: Int, b: Int) {
            var best = -1; var bestD = 0f
            for (i in a + 1 until b) {
                val d = Geometry.distToSegment(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b])
                if (d > bestD) { bestD = d; best = i }
            }
            if (best >= 0 && bestD > eps) { keep[best] = true; rec(a, best); rec(best, b) }
        }
        // 닫힌 도형은 시작점에서 가장 먼 점으로 둘로 나눠 처리
        var far = 0; var farD = 0f
        for (i in 0 until n) { val d = hypot(xs[i] - xs[0], ys[i] - ys[0]); if (d > farD) { farD = d; far = i } }
        if (far in 1 until n - 1) { keep[far] = true; rec(0, far); rec(far, n - 1) } else rec(0, n - 1)
        val out = ArrayList<Float>()
        for (i in 0 until n) if (keep[i]) { out.add(xs[i]); out.add(ys[i]) }
        return out.toFloatArray()
    }
}
