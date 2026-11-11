package kr.eumsoft.kidscoloring

import kr.eumsoft.kidscoloring.engine.BrushType
import kr.eumsoft.kidscoloring.engine.PaintEngine
import kr.eumsoft.kidscoloring.engine.Sticker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineTest {
    private val w = 60; private val h = 40
    private val red = 0xFFFF0000.toInt(); private val blue = 0xFF0000FF.toInt()

    /** 왼쪽 절반 = 영역 1, 오른쪽 절반 = 영역 2, 가운데 작은 네모 = 영역 3 */
    private fun mask() = ShortArray(w * h) { i ->
        val x = i % w; val y = i / w
        when { x in 25..34 && y in 15..24 -> 3; x < 30 -> 1; else -> 2 }.toShort()
    }
    private fun engine(budget: Long = 1L shl 30, steps: Int = 40) = PaintEngine(w, h, mask(), 3, budget, steps)
    private fun PaintEngine.count(region: Int, pred: (Int) -> Boolean): Int {
        var n = 0
        for (y in 0 until h) for (x in 0 until w) if (regionAt(x, y) == region && pred(paint[y * w + x])) n++
        return n
    }

    @Test fun `채우기는 터치한 영역만 칠하고 밖으로 새지 않는다`() {
        val e = engine()
        assertEquals(1, e.fillAt(5, 5, red))
        assertEquals(0, e.count(1) { it != red })
        assertEquals(0, e.count(2) { it != 0 })
        assertEquals(0, e.count(3) { it != 0 })
    }

    @Test fun `같은 영역 색상 변경과 영역별 지우기`() {
        val e = engine()
        e.fillAt(5, 5, red); e.fillAt(6, 6, blue)
        assertEquals(0, e.count(1) { it != blue })
        e.fillRegion(1, 0)
        assertEquals(0, e.count(1) { it != 0 })
        assertEquals(0, e.regionColor[1])
    }

    @Test fun `화면 밖 좌표는 무시한다`() {
        val e = engine()
        assertEquals(0, e.fillAt(-1, 3, red)); assertEquals(0, e.fillAt(w, 3, red))
        assertFalse(e.canUndo)
    }

    @Test fun `실행 취소와 다시 실행`() {
        val e = engine()
        e.fillAt(5, 5, red); e.fillAt(50, 5, blue)
        assertTrue(e.undo())
        assertEquals(0, e.count(2) { it != 0 }); assertEquals(0, e.count(1) { it != red })
        assertTrue(e.undo())
        assertEquals(0, e.count(1) { it != 0 })
        assertFalse(e.undo())
        assertTrue(e.redo()); assertTrue(e.redo()); assertFalse(e.redo())
        assertEquals(0, e.count(1) { it != red }); assertEquals(0, e.count(2) { it != blue })
        assertEquals(red, e.regionColor[1])
        e.undo(); e.fillAt(50, 5, red)          // 새로 칠하면 다시 실행 기록은 사라진다
        assertFalse(e.canRedo)
    }

    @Test fun `되돌리기 기록은 단계 수와 메모리 한도를 넘지 않는다`() {
        val e = engine(steps = 5)
        repeat(12) { e.fillAt(5, 5, if (it % 2 == 0) red else blue) }
        assertEquals(5, e.undoSteps)
        val small = engine(budget = 6000)      // 영역 1 한 번 = 30*40*4 = 4800바이트
        repeat(6) { small.fillAt(5, 5, if (it % 2 == 0) red else blue) }
        assertTrue(small.undoSteps <= 2)
        assertTrue(small.canUndo)
    }

    @Test fun `붓은 선 밖으로 안 나가기 모드에서 시작한 영역 안에만 칠한다`() {
        val e = engine()
        e.beginStroke(10f, 20f, 1f, BrushType.PEN, red, 6f, 1f, e.regionAt(10, 20))
        e.strokeTo(55f, 20f, 1f); e.endStroke()
        assertTrue(e.count(1) { it != 0 } > 50)
        assertEquals(0, e.count(2) { it != 0 }); assertEquals(0, e.count(3) { it != 0 })
        e.undo()
        assertEquals(0, e.count(1) { it != 0 })
    }

    @Test fun `자유 붓과 지우개`() {
        val e = engine()
        e.beginStroke(10f, 20f, 1f, BrushType.PEN, red, 5f, 1f, 0)
        e.strokeTo(55f, 20f, 1f); e.endStroke()
        assertTrue(e.count(2) { it == red } > 20)
        assertEquals(red, e.paint[20 * w + 40])
        e.beginStroke(40f, 20f, 1f, BrushType.ERASER, 0, 4f, 1f, 0); e.endStroke()
        assertEquals(0, e.paint[20 * w + 40])
        assertEquals(red, e.paint[20 * w + 12])
        e.undo()
        assertEquals(red, e.paint[20 * w + 40])
    }

    @Test fun `모든 붓 종류가 칠해지고 형광펜은 반투명이다`() {
        for (t in BrushType.entries.filter { it != BrushType.ERASER }) {
            val e = engine()
            e.beginStroke(10f, 10f, 1f, t, blue, 6f, 1f, 0); e.strokeTo(20f, 10f, 1f); e.endStroke()
            assertTrue("$t", e.paint.any { it != 0 })
            if (t == BrushType.HIGHLIGHTER) assertTrue(e.paint.maxOf { it ushr 24 } < 140)
        }
    }

    @Test fun `필압이 약하면 선이 가늘다`() {
        fun painted(p: Float): Int { val e = engine(); e.beginStroke(10f, 10f, p, BrushType.PEN, red, 8f, 1f, 0); e.strokeTo(20f, 10f, p); e.endStroke(); return e.paint.count { it != 0 } }
        assertTrue(painted(0.1f) < painted(1f))
    }

    @Test fun `붓질 취소는 흔적을 남기지 않는다`() {
        val e = engine()
        e.fillAt(5, 5, blue)
        e.beginStroke(10f, 10f, 1f, BrushType.PEN, red, 6f, 1f, 0); e.strokeTo(20f, 10f, 1f); e.cancelStroke()
        assertEquals(0, e.count(1) { it != blue })
        assertEquals(1, e.undoSteps)
    }

    @Test fun `자동 색칠은 빈 영역만 칠하고 바탕은 건너뛴다`() {
        val e = engine()
        e.fillAt(5, 5, red)
        assertEquals(1, e.autoColor(intArrayOf(blue), skipRegion = 2))
        assertEquals(red, e.regionColor[1]); assertEquals(0, e.regionColor[2]); assertEquals(blue, e.regionColor[3])
        assertTrue(e.isComplete(2)); assertFalse(e.isComplete(0))
        e.undo()
        assertEquals(0, e.count(3) { it != 0 })
    }

    @Test fun `스티커 붙이기와 떼기, 전체 초기화, 복원`() {
        val e = engine()
        e.addSticker(Sticker(0, 10f, 10f, 8f, red))
        assertEquals(1, e.stickers.size)
        assertFalse(e.removeStickerAt(30f, 30f)); assertTrue(e.removeStickerAt(11f, 9f))
        e.undo(); assertEquals(1, e.stickers.size)
        e.fillAt(5, 5, red); e.clearAll()
        assertTrue(e.paint.all { it == 0 }); assertTrue(e.stickers.isEmpty())
        e.undo(); assertEquals(1, e.stickers.size); assertEquals(red, e.paint[5 * w + 5])
        // 저장 → 복원
        val px = e.paint.copyOf(); val rc = e.regionColor.copyOf(); val st = e.stickers
        val f = engine(); f.restore(px, rc, st)
        assertTrue(f.paint.contentEquals(px)); assertEquals(red, f.regionColor[1]); assertEquals(1, f.stickers.size)
        assertFalse(f.modified); assertFalse(f.canUndo)
    }
}
