package kr.eumsoft.quick.core

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 캡처 이미지에서 시스템 영역(상태표시줄·내비게이션)을 잘라낼 범위 계산. 안드로이드 의존성 없음. */
object CropCalc {
    data class Box(val l: Int, val t: Int, val r: Int, val b: Int) {
        val w get() = r - l
        val h get() = b - t
    }

    data class Opts(
        val top: Boolean = true, val bottom: Boolean = true, val sides: Boolean = true,
        /** 사용자가 추가로 더 자를 여백(이미지 픽셀). 음수면 덜 자름. */
        val extraTop: Int = 0, val extraBottom: Int = 0, val extraLeft: Int = 0, val extraRight: Int = 0
    )

    data class Result(val box: Box, val top: Int, val bottom: Int, val left: Int, val right: Int, val detected: Boolean) {
        val changed get() = top + bottom + left + right > 0
    }

    /**
     * @param imgW,imgH 캡처 이미지 크기(px)
     * @param dispW,dispH 시스템 창 좌표계의 화면 크기 (회전 반영된 현재 화면 기준)
     * @param systemWindows 실행 시점에 OS가 알려준 시스템 창(상태표시줄·내비게이션 바) 영역. 숨겨진 바는 포함되지 않음.
     */
    fun compute(imgW: Int, imgH: Int, dispW: Int, dispH: Int, systemWindows: List<Box>, o: Opts): Result {
        val sx = if (dispW > 0) imgW.toFloat() / dispW else 1f
        val sy = if (dispH > 0) imgH.toFloat() / dispH else 1f
        var top = 0; var bottom = 0; var left = 0; var right = 0
        var detected = false
        val edge = 3
        for (w in systemWindows) {
            if (w.w <= 0 || w.h <= 0) continue
            if (w.w.toLong() * w.h > dispW.toLong() * dispH * 25 / 100) continue // 알림창 펼침 등 큰 시스템 창 제외
            val wide = w.w >= dispW / 2
            val tall = w.h >= dispH / 2
            when {
                wide && w.t <= edge && w.h <= dispH / 5 -> { top = max(top, (w.b * sy).roundToInt()); detected = true }
                wide && w.b >= dispH - edge && w.h <= dispH / 5 -> { bottom = max(bottom, ((dispH - w.t) * sy).roundToInt()); detected = true }
                tall && w.l <= edge && w.w <= dispW / 5 -> { left = max(left, (w.r * sx).roundToInt()); detected = true }
                tall && w.r >= dispW - edge && w.w <= dispW / 5 -> { right = max(right, ((dispW - w.l) * sx).roundToInt()); detected = true }
            }
        }
        if (!o.top) top = 0
        if (!o.bottom) bottom = 0
        if (!o.sides) { left = 0; right = 0 }
        top = max(0, top + o.extraTop)
        bottom = max(0, bottom + o.extraBottom)
        left = max(0, left + o.extraLeft)
        right = max(0, right + o.extraRight)
        // 너무 많이 잘리면 원본 유지
        if (imgH - top - bottom < imgH / 5 || imgW - left - right < imgW / 5) {
            return Result(Box(0, 0, imgW, imgH), 0, 0, 0, 0, detected)
        }
        top = min(top, imgH); bottom = min(bottom, imgH); left = min(left, imgW); right = min(right, imgW)
        return Result(Box(left, top, imgW - right, imgH - bottom), top, bottom, left, right, detected)
    }
}
