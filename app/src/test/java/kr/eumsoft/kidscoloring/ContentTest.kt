package kr.eumsoft.kidscoloring

import kr.eumsoft.kidscoloring.engine.PaintEngine
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

private class Img(val width: Int, val height: Int, val argb: IntArray, val hasAlpha: Boolean)

/** 단위 테스트는 android.jar 로 컴파일되어 javax.imageio 를 직접 쓸 수 없으므로 리플렉션으로 부른다 (실행은 PC 의 JDK). */
private fun readPng(f: File): Img {
    val img = Class.forName("javax.imageio.ImageIO").getMethod("read", File::class.java).invoke(null, f)
    val bi = Class.forName("java.awt.image.BufferedImage")
    val int = Int::class.javaPrimitiveType
    val w = bi.getMethod("getWidth").invoke(img) as Int
    val h = bi.getMethod("getHeight").invoke(img) as Int
    val argb = bi.getMethod("getRGB", int, int, int, int, IntArray::class.java, int, int).invoke(img, 0, 0, w, h, null, 0, w) as IntArray
    val cm = bi.getMethod("getColorModel").invoke(img)
    val alpha = Class.forName("java.awt.image.ColorModel").getMethod("hasAlpha").invoke(cm) as Boolean
    return Img(w, h, argb, alpha)
}

/** 실제 앱에 들어가는 도안 42장을 검사한다 (JVM 에서 PNG 를 직접 읽는다). */
class ContentTest {
    private val assets = File("src/main/assets")
    private val catalog = JSONObject(File(assets, "art/catalog.json").readText())
    private val arts = catalog.getJSONArray("artworks").let { a -> List(a.length()) { a.getJSONObject(it) } }
    private val size = catalog.getInt("size")

    @Test fun `도안 42장이 모두 등록되어 있고 파일이 빠지지 않았다`() {
        assertEquals(42, arts.size)
        assertEquals(42, arts.map { it.getString("id") }.toSet().size)
        val perCat = arts.groupingBy { it.getString("category") }.eachCount()
        assertEquals(mapOf("animals" to 8, "dinos" to 6, "space" to 6, "fantasy" to 6, "vehicles" to 4, "people" to 8, "earth" to 4), perCat)
        for (a in arts) {
            assertTrue(a.getString("id") + " 미등록", a.getBoolean("available"))
            for (k in listOf("line", "mask", "thumb")) assertTrue(a.getString(k), File(assets, a.getString(k)).length() > 500)
            assertTrue(a.getInt("difficulty") in 1..3)
        }
    }

    @Test fun `모든 마스크는 빈틈없이 영역 번호가 매겨져 있고 채우기가 새지 않는다`() {
        for (a in arts) {
            val id = a.getString("id")
            val n = a.getJSONArray("regions").length()
            val img = readPng(File(assets, a.getString("mask")))
            assertEquals(id, size, img.width); assertEquals(id, size, img.height)
            val rgb = img.argb
            val mask = ShortArray(size * size) { (((rgb[it] shr 16) and 0xFF) or (rgb[it] and 0xFF00)).toShort() }
            val seen = BooleanArray(n + 1)
            for (v in mask) { val r = v.toInt() and 0xFFFF; assertTrue("$id 영역 번호 $r", r in 1..n); seen[r] = true }
            assertTrue("$id 비어 있는 영역 번호", (1..n).all { seen[it] })
            assertTrue("$id 바탕 영역", a.getInt("background") in 1..n)
            // 대표점을 눌러 채우면 그 영역 픽셀 수만큼만, 그 영역만 칠해진다
            val e = PaintEngine(size, size, mask, n, 1L shl 20, 2)
            val regs = a.getJSONArray("regions")
            for (r in listOf(1, n, (n + 1) / 2)) {
                val j = regs.getJSONObject(r - 1)
                assertEquals("$id 대표점", r, e.regionAt(j.getInt("x"), j.getInt("y")))
                val before = e.paint.count { it != 0 }
                e.fillAt(j.getInt("x"), j.getInt("y"), 0xFF00FF00.toInt())
                val painted = e.paint.count { it != 0 } - before
                assertEquals("$id 영역 $r 넓이", mask.count { (it.toInt() and 0xFFFF) == r }, painted)
                assertTrue("$id 영역 $r 이 너무 작음", j.getInt("a") >= 200)
            }
        }
    }

    @Test fun `선화는 투명 배경의 검은 선이고 마스크와 크기가 같다`() {
        for (a in arts) {
            val img = readPng(File(assets, a.getString("line")))
            assertEquals(size, img.width); assertEquals(size, img.height)
            assertTrue(a.getString("id"), img.hasAlpha)
            val corner = img.argb[2 * size + 2] ushr 24
            assertEquals(a.getString("id") + " 모서리는 비어 있어야 함", 0, corner)
        }
    }
}
