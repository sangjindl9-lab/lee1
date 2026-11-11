package kr.eumsoft.kidscoloring.ui

import android.graphics.Color as AColor

data class NamedColor(val argb: Int, val name: String)
class PaletteTheme(val name: String, val colors: IntArray)

object Palettes {
    private fun c(hex: Long, name: String) = NamedColor((0xFF000000 or hex).toInt(), name)

    /** 기본 색상 24개 */
    val basic = listOf(
        c(0xE53935, "빨강"), c(0xFF7043, "다홍"), c(0xFB8C00, "주황"), c(0xFFB300, "귤색"),
        c(0xFDD835, "노랑"), c(0xC0CA33, "연두"), c(0x7CB342, "풀색"), c(0x2E7D32, "초록"),
        c(0x26A69A, "청록"), c(0x4FC3F7, "하늘"), c(0x1E88E5, "파랑"), c(0x283593, "남색"),
        c(0x7E57C2, "보라"), c(0xBA68C8, "연보라"), c(0xEC407A, "분홍"), c(0xF8BBD0, "연분홍"),
        c(0xFFCCAA, "살구"), c(0xD7A86E, "황토"), c(0x8D6E63, "갈색"), c(0x5D4037, "고동"),
        c(0xFFFFFF, "하양"), c(0xBDBDBD, "회색"), c(0x616161, "진회색"), c(0x212121, "검정"),
    )

    /** 무지개 팔레트 */
    val rainbow = listOf(
        c(0xF44336, "빨강"), c(0xFF9800, "주황"), c(0xFFEB3B, "노랑"), c(0x4CAF50, "초록"),
        c(0x2196F3, "파랑"), c(0x3F51B5, "남색"), c(0x9C27B0, "보라"),
    )

    /** 색각 다양성을 고려한 팔레트 (Okabe–Ito: 색각 유형이 달라도 서로 구분하기 쉬운 색) */
    val colorSafe = listOf(
        c(0xE69F00, "주황"), c(0x56B4E9, "하늘"), c(0x009E73, "청록"), c(0xF0E442, "노랑"),
        c(0x0072B2, "파랑"), c(0xD55E00, "다홍"), c(0xCC79A7, "분홍"), c(0x000000, "검정"), c(0xFFFFFF, "하양"),
    )

    /** 확장 팔레트: 색상환 12색 × 밝기 5단계 + 무채색 */
    val extended: List<NamedColor> by lazy {
        val out = ArrayList<NamedColor>()
        val sv = arrayOf(0.30f to 1f, 0.55f to 1f, 0.85f to 0.95f, 0.9f to 0.72f, 0.85f to 0.45f)
        for ((s, v) in sv) for (h in 0 until 12) {
            val argb = AColor.HSVToColor(floatArrayOf(h * 30f, s, v))
            out.add(NamedColor(argb, nameOf(argb)))
        }
        for (g in intArrayOf(255, 224, 192, 160, 128, 96, 64, 0)) out.add(NamedColor(AColor.rgb(g, g, g), nameOf(AColor.rgb(g, g, g))))
        out
    }

    /** 자동 색칠 / 색칠 추천에 쓰는 색 조합 */
    val themes = listOf(
        PaletteTheme("무지개", rainbow.map { it.argb }.toIntArray()),
        PaletteTheme("파스텔", intArrayOf(0xFFFFCDD2.toInt(), 0xFFFFE0B2.toInt(), 0xFFFFF9C4.toInt(), 0xFFC8E6C9.toInt(), 0xFFB3E5FC.toInt(), 0xFFD1C4E9.toInt(), 0xFFF8BBD0.toInt())),
        PaletteTheme("숲속", intArrayOf(0xFF2E7D32.toInt(), 0xFF7CB342.toInt(), 0xFFC0CA33.toInt(), 0xFF8D6E63.toInt(), 0xFFFFB300.toInt(), 0xFFA5D6A7.toInt())),
        PaletteTheme("바다", intArrayOf(0xFF0277BD.toInt(), 0xFF4FC3F7.toInt(), 0xFF26A69A.toInt(), 0xFF80DEEA.toInt(), 0xFFFFF59D.toInt(), 0xFF283593.toInt())),
        PaletteTheme("사탕", intArrayOf(0xFFEC407A.toInt(), 0xFFBA68C8.toInt(), 0xFFFFD54F.toInt(), 0xFF4DD0E1.toInt(), 0xFFFF8A65.toInt(), 0xFFAED581.toInt())),
    )

    /** 가장 가까운 기본 색 이름 (색 이름 읽어주기용) */
    fun nameOf(argb: Int): String {
        var best = basic[0]; var bd = Int.MAX_VALUE
        for (n in basic) {
            val dr = AColor.red(n.argb) - AColor.red(argb); val dg = AColor.green(n.argb) - AColor.green(argb); val db = AColor.blue(n.argb) - AColor.blue(argb)
            val d = dr * dr * 3 + dg * dg * 4 + db * db * 2
            if (d < bd) { bd = d; best = n }
        }
        return best.name
    }
}
