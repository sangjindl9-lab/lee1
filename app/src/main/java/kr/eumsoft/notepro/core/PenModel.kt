package kr.eumsoft.notepro.core

import kotlin.math.pow
import kotlin.math.sin

/** 펜 종류별 필압·기울기 → 선 굵기 계산, 입력 손떨림 보정. */
object PenModel {

    fun widthAt(pen: PenType, base: Float, pressure: Float, tilt: Float, pressureEnabled: Boolean): Float {
        val p = if (pressureEnabled) pressure.coerceIn(0.05f, 1f) else 0.6f
        return when (pen) {
            PenType.BALLPOINT -> base * (0.8f + 0.35f * p)
            PenType.FOUNTAIN -> base * (0.35f + 1.25f * p)
            PenType.PENCIL -> base * (0.55f + 0.7f * p) * (1f + 0.9f * sin(tilt.coerceIn(0f, 1.4f)))
            PenType.HIGHLIGHTER -> base
            PenType.BRUSH -> base * (0.15f + 1.9f * p.pow(1.3f))
        }
    }

    fun defaultOpacity(pen: PenType) = when (pen) {
        PenType.HIGHLIGHTER -> 0.35f
        PenType.PENCIL -> 0.85f
        else -> 1f
    }

    /**
     * 손떨림 보정(지수 이동 평균). strength 0 = 보정 없음, 1 = 최대.
     * 실시간 입력에 적용하며 지연이 커지지 않도록 최대 0.75로 제한한다.
     */
    class Stabilizer(strength: Float) {
        private val a = (strength.coerceIn(0f, 1f) * 0.75f)
        private var has = false
        private var sx = 0f; private var sy = 0f
        fun reset() { has = false }
        fun push(x: Float, y: Float, out: FloatArray) {
            if (!has) { sx = x; sy = y; has = true } else {
                sx = sx * a + x * (1 - a); sy = sy * a + y * (1 - a)
            }
            out[0] = sx; out[1] = sy
        }
    }
}

/** 실시간 획 수집 버퍼(할당 최소화). */
class PointBuffer(cap: Int = 512) {
    var data = FloatArray(cap * Stroke.STRIDE); private set
    var size = 0; private set
    val count get() = size / Stroke.STRIDE
    fun clear() { size = 0 }
    fun add(x: Float, y: Float, p: Float, t: Float) {
        if (size + Stroke.STRIDE > data.size) data = data.copyOf(data.size * 2)
        data[size] = x; data[size + 1] = y; data[size + 2] = p; data[size + 3] = t
        size += Stroke.STRIDE
    }
    fun set(arr: FloatArray) { if (arr.size > data.size) data = FloatArray(arr.size * 2); arr.copyInto(data); size = arr.size }
    fun toArray(): FloatArray = data.copyOf(size)
}
