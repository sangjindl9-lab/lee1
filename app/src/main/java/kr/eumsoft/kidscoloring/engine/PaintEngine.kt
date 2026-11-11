package kr.eumsoft.kidscoloring.engine

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

enum class BrushType { PEN, PENCIL, CRAYON, HIGHLIGHTER, GLITTER, ERASER }

data class Sticker(val type: Int, val x: Float, val y: Float, val size: Float, val color: Int)

/**
 * 색칠 엔진 (안드로이드 클래스에 의존하지 않는 순수 Kotlin → JVM 단위 테스트 가능).
 *
 * - paint: 색칠 레이어. ARGB(알파 미곱), 0 = 아직 칠하지 않음. 선화는 이 위에 따로 덮는다.
 * - mask : 픽셀마다 영역 번호(1..regionCount). 파이프라인에서 Flood Fill(연결 성분)로 미리 만든 것이라
 *          채우기는 "같은 번호 픽셀만" 칠하므로 경계선 밖으로 새지 않는다.
 */
class PaintEngine(
    val w: Int,
    val h: Int,
    private val mask: ShortArray,
    val regionCount: Int,
    private val undoBudgetBytes: Long = 48L * 1024 * 1024,
    private val undoMaxSteps: Int = 40,
) {
    val paint = IntArray(w * h)
    /** 영역별 마지막 채우기 색 (0 = 안 채움) */
    var regionColor = IntArray(regionCount + 1); private set
    var stickers: List<Sticker> = emptyList(); private set
    /** 저장 이후 바뀐 것이 있는지 */
    var modified = false

    // 영역별 경계 상자
    private val bl = IntArray(regionCount + 1) { w }
    private val bt = IntArray(regionCount + 1) { h }
    private val br = IntArray(regionCount + 1) { -1 }
    private val bb = IntArray(regionCount + 1) { -1 }

    // 화면에 다시 올려야 하는 범위
    var dirtyL = w; private set
    var dirtyT = h; private set
    var dirtyR = -1; private set
    var dirtyB = -1; private set

    init {
        require(mask.size == w * h)
        var i = 0
        for (y in 0 until h) for (x in 0 until w) {
            val r = mask[i++].toInt() and 0xFFFF
            if (r in 1..regionCount) {
                if (x < bl[r]) bl[r] = x
                if (x > br[r]) br[r] = x
                if (y < bt[r]) bt[r] = y
                if (y > bb[r]) bb[r] = y
            }
        }
    }

    fun regionAt(x: Int, y: Int): Int =
        if (x < 0 || y < 0 || x >= w || y >= h) 0 else mask[y * w + x].toInt() and 0xFFFF

    fun consumeDirty(): IntArray? {
        if (dirtyR < dirtyL || dirtyB < dirtyT) return null
        val r = intArrayOf(dirtyL, dirtyT, dirtyR, dirtyB)
        dirtyL = w; dirtyT = h; dirtyR = -1; dirtyB = -1
        return r
    }

    private fun markDirty(l: Int, t: Int, r: Int, b: Int) {
        if (l < dirtyL) dirtyL = l
        if (t < dirtyT) dirtyT = t
        if (r > dirtyR) dirtyR = r
        if (b > dirtyB) dirtyB = b
        modified = true
    }

    // ───────────── 실행 취소 / 다시 실행 (상태 맞바꾸기 방식) ─────────────
    private class Step(val l: Int, val t: Int, val r: Int, val b: Int, var pixels: IntArray,
                       var regionColor: IntArray, var stickers: List<Sticker>) {
        val bytes get() = pixels.size * 4L + regionColor.size * 4L + 64
    }

    private val undoStack = ArrayDeque<Step>()
    private val redoStack = ArrayDeque<Step>()
    val canUndo get() = undoStack.isNotEmpty()
    val canRedo get() = redoStack.isNotEmpty()
    val undoBytes get() = undoStack.sumOf { it.bytes } + redoStack.sumOf { it.bytes }
    val undoSteps get() = undoStack.size

    private fun copyRect(src: IntArray, l: Int, t: Int, r: Int, b: Int): IntArray {
        if (r < l || b < t) return IntArray(0)
        val rw = r - l + 1
        val out = IntArray(rw * (b - t + 1))
        for (y in t..b) System.arraycopy(src, y * w + l, out, (y - t) * rw, rw)
        return out
    }

    private fun pasteRect(dst: IntArray, px: IntArray, l: Int, t: Int, r: Int, b: Int) {
        if (r < l || b < t) return
        val rw = r - l + 1
        for (y in t..b) System.arraycopy(px, (y - t) * rw, dst, y * w + l, rw)
    }

    /** 바꾸기 "전" 상태를 기록한다. pixelsBefore 는 (l,t,r,b) 범위의 이전 픽셀. */
    private fun push(l: Int, t: Int, r: Int, b: Int, pixelsBefore: IntArray, rcBefore: IntArray, stBefore: List<Sticker>) {
        undoStack.addLast(Step(l, t, r, b, pixelsBefore, rcBefore, stBefore))
        redoStack.clear()
        while (undoStack.size > undoMaxSteps || (undoStack.size > 1 && undoBytes > undoBudgetBytes)) undoStack.removeFirst()
    }

    private fun swap(s: Step) {
        val cur = copyRect(paint, s.l, s.t, s.r, s.b)
        pasteRect(paint, s.pixels, s.l, s.t, s.r, s.b)
        s.pixels = cur
        val rc = regionColor; regionColor = s.regionColor; s.regionColor = rc
        val st = stickers; stickers = s.stickers; s.stickers = st
        if (s.r >= s.l) markDirty(s.l, s.t, s.r, s.b) else modified = true
    }

    fun undo(): Boolean {
        val s = undoStack.removeLastOrNull() ?: return false
        swap(s); redoStack.addLast(s); return true
    }

    fun redo(): Boolean {
        val s = redoStack.removeLastOrNull() ?: return false
        swap(s); undoStack.addLast(s); return true
    }

    // ───────────── 영역 채우기 ─────────────
    /** 영역을 color 로 채운다. color = 0 이면 그 영역을 지운다(영역별 지우기). */
    fun fillRegion(region: Int, color: Int): Boolean {
        if (region !in 1..regionCount || br[region] < 0) return false
        val l = bl[region]; val t = bt[region]; val r = br[region]; val b = bb[region]
        push(l, t, r, b, copyRect(paint, l, t, r, b), regionColor.copyOf(), stickers)
        val m = region.toShort()
        for (y in t..b) {
            var i = y * w + l
            for (x in l..r) { if (mask[i] == m) paint[i] = color; i++ }
        }
        regionColor[region] = color
        markDirty(l, t, r, b)
        return true
    }

    fun fillAt(x: Int, y: Int, color: Int): Int {
        val r = regionAt(x, y)
        return if (r != 0 && fillRegion(r, color)) r else 0
    }

    /** 아직 채우지 않은 영역을 팔레트 색으로 자동 채색. skipRegion(바탕)은 건너뛴다. */
    fun autoColor(palette: IntArray, skipRegion: Int, seed: Int = 0): Int {
        if (palette.isEmpty()) return 0
        val before = paint.copyOf()
        val rcBefore = regionColor.copyOf()
        val pick = IntArray(regionCount + 1)
        var n = 0
        for (r in 1..regionCount) if (r != skipRegion && regionColor[r] == 0 && br[r] >= 0) {
            pick[r] = palette[(r * 7 + seed).mod(palette.size)]; n++
        }
        if (n == 0) return 0
        for (i in paint.indices) {
            val c = pick[mask[i].toInt() and 0xFFFF]
            if (c != 0) paint[i] = c
        }
        for (r in 1..regionCount) if (pick[r] != 0) regionColor[r] = pick[r]
        push(0, 0, w - 1, h - 1, before, rcBefore, stickers)
        markDirty(0, 0, w - 1, h - 1)
        return n
    }

    fun clearAll() {
        push(0, 0, w - 1, h - 1, paint.copyOf(), regionColor.copyOf(), stickers)
        paint.fill(0)
        regionColor = IntArray(regionCount + 1)
        stickers = emptyList()
        markDirty(0, 0, w - 1, h - 1)
    }

    /** skipRegion(바탕)을 뺀 모든 영역이 채워졌는가 */
    fun isComplete(skipRegion: Int): Boolean {
        for (r in 1..regionCount) if (r != skipRegion && br[r] >= 0 && regionColor[r] == 0) return false
        return true
    }

    fun filledRatio(skipRegion: Int): Float {
        var tot = 0; var f = 0
        for (r in 1..regionCount) if (r != skipRegion && br[r] >= 0) { tot++; if (regionColor[r] != 0) f++ }
        return if (tot == 0) 1f else f.toFloat() / tot
    }

    // ───────────── 스티커 ─────────────
    fun addSticker(s: Sticker) {
        push(0, 0, -1, -1, IntArray(0), regionColor.copyOf(), stickers)
        stickers = stickers + s
        modified = true
    }

    /** (x,y)에 있는 맨 위 스티커를 지운다 */
    fun removeStickerAt(x: Float, y: Float): Boolean {
        val i = stickers.indexOfLast { kotlin.math.abs(x - it.x) <= it.size / 2 && kotlin.math.abs(y - it.y) <= it.size / 2 }
        if (i < 0) return false
        push(0, 0, -1, -1, IntArray(0), regionColor.copyOf(), stickers)
        stickers = stickers.filterIndexed { j, _ -> j != i }
        modified = true
        return true
    }

    // ───────────── 붓 ─────────────
    private var strokeBase: IntArray? = null
    private var cov: ByteArray? = null
    private var sType = BrushType.PEN
    private var sColor = 0
    private var sOpacity = 1f
    private var sRadius = 10f
    private var sClip = 0
    private var lastX = 0f
    private var lastY = 0f
    private var lastR = 0f
    private var sl = 0; private var st = 0; private var sr = -1; private var sb = -1
    var strokeOpen = false; private set

    /**
     * @param radius 붓 반지름(도안 픽셀), pressure 0..1 (필압 미지원이면 1)
     * @param clipRegion 0 이 아니면 그 영역 안에만 칠한다("선 밖으로 안 나가기")
     */
    fun beginStroke(x: Float, y: Float, pressure: Float, type: BrushType, color: Int, radius: Float, opacity: Float, clipRegion: Int) {
        val base = strokeBase ?: IntArray(w * h).also { strokeBase = it }
        System.arraycopy(paint, 0, base, 0, paint.size)
        val c = cov ?: ByteArray(w * h).also { cov = it }
        c.fill(0)
        sType = type; sColor = color or (0xFF shl 24)
        sOpacity = when (type) {
            BrushType.HIGHLIGHTER -> min(opacity, 0.45f)
            BrushType.PENCIL -> opacity * 0.9f
            else -> opacity
        }.coerceIn(0.05f, 1f)
        sRadius = when (type) {
            BrushType.PENCIL -> radius * 0.6f
            BrushType.CRAYON -> radius * 1.2f
            BrushType.HIGHLIGHTER -> radius * 1.6f
            else -> radius
        }.coerceAtLeast(1.5f)
        sClip = clipRegion
        sl = w; st = h; sr = -1; sb = -1
        strokeOpen = true
        lastX = x; lastY = y; lastR = sRadius * pr(pressure)
        stamp(x, y, lastR)
    }

    private fun pr(p: Float) = 0.35f + 0.65f * p.coerceIn(0f, 1f)

    fun strokeTo(x: Float, y: Float, pressure: Float) {
        if (!strokeOpen) return
        val r = sRadius * pr(pressure)
        val dx = x - lastX; val dy = y - lastY
        val d = sqrt(dx * dx + dy * dy)
        val step = max(1f, min(r, lastR) * 0.3f)
        if (d >= step) {
            val n = (d / step).toInt()
            for (i in 1..n) {
                val f = i * step / d
                stamp(lastX + dx * f, lastY + dy * f, lastR + (r - lastR) * f)
            }
            val f = n * step / d
            lastX += dx * f; lastY += dy * f; lastR += (r - lastR) * f
        }
    }

    /** 붓질을 끝내고 실행 취소 기록을 남긴다 */
    fun endStroke() {
        if (!strokeOpen) return
        strokeOpen = false
        if (sr >= sl && sb >= st) push(sl, st, sr, sb, copyRect(strokeBase!!, sl, st, sr, sb), regionColor.copyOf(), stickers)
    }

    /** 두 손가락 확대가 시작되는 등 붓질을 없던 일로 한다 */
    fun cancelStroke() {
        if (!strokeOpen) return
        strokeOpen = false
        if (sr >= sl && sb >= st) {
            val base = strokeBase!!
            for (y in st..sb) System.arraycopy(base, y * w + sl, paint, y * w + sl, sr - sl + 1)
            markDirty(sl, st, sr, sb)
        }
    }

    private fun hash(x: Int, y: Int): Int {
        var n = x * 374761393 + y * 668265263
        n = (n xor (n ushr 13)) * 1274126177
        return (n xor (n ushr 16)) and 0xFF
    }

    private fun stamp(cx: Float, cy: Float, r: Float) {
        val base = strokeBase!!; val c = cov!!
        val x0 = max(0, (cx - r - 1).toInt()); val x1 = min(w - 1, (cx + r + 1).toInt())
        val y0 = max(0, (cy - r - 1).toInt()); val y1 = min(h - 1, (cy + r + 1).toInt())
        if (x1 < x0 || y1 < y0) return
        val clip = sClip.toShort()
        val soft = if (sType == BrushType.HIGHLIGHTER || sType == BrushType.CRAYON) 1f else max(1f, r * 0.15f)
        var touched = false
        for (y in y0..y1) {
            val dy = y + 0.5f - cy
            var i = y * w + x0
            for (x in x0..x1) {
                val dx = x + 0.5f - cx
                val d2 = dx * dx + dy * dy
                if (d2 < (r + 0.5f) * (r + 0.5f) && (sClip == 0 || mask[i] == clip)) {
                    var a = ((r + 0.5f - sqrt(d2)) / soft).coerceIn(0f, 1f)
                    when (sType) {
                        BrushType.PENCIL -> a *= 0.45f + 0.55f * hash(x, y) / 255f
                        BrushType.CRAYON -> a *= if (hash(x shr 1, y shr 1) > 70) 1f else 0.3f
                        else -> {}
                    }
                    val v = (a * 255f).toInt()
                    if (v > (c[i].toInt() and 0xFF)) {
                        c[i] = v.toByte()
                        paint[i] = compose(base[i], x, y, v / 255f * sOpacity)
                        touched = true
                    }
                }
                i++
            }
        }
        if (touched) {
            if (x0 < sl) sl = x0
            if (y0 < st) st = y0
            if (x1 > sr) sr = x1
            if (y1 > sb) sb = y1
            markDirty(x0, y0, x1, y1)
        }
    }

    private fun compose(dst: Int, x: Int, y: Int, a: Float): Int {
        val da = (dst ushr 24) / 255f
        if (sType == BrushType.ERASER) {
            val na = da * (1f - a)
            return if (na < 0.004f) 0 else ((na * 255f + 0.5f).toInt() shl 24) or (dst and 0xFFFFFF)
        }
        var src = sColor
        if (sType == BrushType.GLITTER) {
            val hsh = hash(x / 3, y / 3)
            src = if (hsh < 22) 0xFFFFFFFF.toInt() else lighten(sColor, (hash(x / 2 + 91, y / 2 + 17) - 128) / 255f * 0.5f)
        }
        val oa = a + da * (1f - a)
        if (oa <= 0f) return 0
        val k = da * (1f - a)
        val r = (((src shr 16) and 0xFF) * a + ((dst shr 16) and 0xFF) * k) / oa
        val g = (((src shr 8) and 0xFF) * a + ((dst shr 8) and 0xFF) * k) / oa
        val b = ((src and 0xFF) * a + (dst and 0xFF) * k) / oa
        return ((oa * 255f + 0.5f).toInt().coerceAtMost(255) shl 24) or
            ((r + 0.5f).toInt().coerceIn(0, 255) shl 16) or ((g + 0.5f).toInt().coerceIn(0, 255) shl 8) or (b + 0.5f).toInt().coerceIn(0, 255)
    }

    private fun lighten(c: Int, f: Float): Int {
        fun ch(v: Int) = (if (f >= 0) v + (255 - v) * f else v * (1 + f)).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (ch((c shr 16) and 0xFF) shl 16) or (ch((c shr 8) and 0xFF) shl 8) or ch(c and 0xFF)
    }

    // ───────────── 저장/복원 ─────────────
    /** 저장된 상태를 불러온다 (실행 취소 기록은 비운다) */
    fun restore(pixels: IntArray?, rc: IntArray?, st: List<Sticker>) {
        if (pixels != null && pixels.size == paint.size) System.arraycopy(pixels, 0, paint, 0, paint.size) else paint.fill(0)
        regionColor = IntArray(regionCount + 1).also { a -> rc?.let { System.arraycopy(it, 0, a, 0, min(it.size, a.size)) } }
        stickers = st
        undoStack.clear(); redoStack.clear()
        markDirty(0, 0, w - 1, h - 1)
        modified = false
    }
}
