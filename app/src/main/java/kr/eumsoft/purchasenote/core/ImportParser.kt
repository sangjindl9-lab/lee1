package kr.eumsoft.purchasenote.core

import org.json.JSONObject
import java.net.URI
import java.time.LocalDate

/**
 * 쇼핑몰 '주문 내역 화면'의 글자(사용자가 직접 로그인해서 보고 있는 화면)를 주문 목록으로 바꾼다.
 * 쇼핑몰별 규칙은 JSON(앱 내장 + 안내 서버에서 갱신). 규칙이 열 수 있는 주소는 앱에 고정된 쇼핑몰 도메인으로 제한.
 */
object ImportParser {
    /** 규칙이 열 수 있는 쇼핑몰 도메인(앱에 고정). 서버 규칙은 이 밖의 주소를 쓸 수 없다 */
    val ALLOWED_HOSTS = listOf(
        "coupang.com", "naver.com", "amazon.com", "amazon.co.jp", "amazon.es", "amazon.com.mx", "amazon.co.uk", "amazon.de",
        "rakuten.co.jp", "11st.co.kr", "gmarket.co.kr", "auction.co.kr", "ssg.com", "aliexpress.com", "ebay.com", "mercadolibre.com.mx",
    )

    fun hostAllowed(url: String): Boolean = try {
        val u = URI(url); val h = (u.host ?: "").lowercase()
        u.scheme == "https" && ALLOWED_HOSTS.any { h == it || h.endsWith(".$it") }
    } catch (e: Exception) { false }

    data class Rule(
        val id: String,
        val names: Map<String, String>,
        val currency: String,
        val ordersUrl: String,
        val anchor: Regex,
        val orderNo: Regex?,
        val total: Regex?,
        val price: Regex,
        val returnBy: Regex?,
        val noise: Regex,
        /** 이 라벨 다음 줄은 건너뜀(받는 사람 이름 등 개인정보) */
        val skipAfter: Regex?,
        /** 상품 줄 바로 아래에 가격이 있어야 상품으로 본다(가게 이름 줄 등을 거르기 위함) */
        val needPrice: Boolean,
        /** 사진 설명(대체 텍스트)을 상품명으로 쓴다 — 목록에 사진만 있는 쇼핑몰(쿠팡 등) */
        val useImageAlt: Boolean = false,
        /** 읽기 전에 눌러서 펼칠 버튼 글자(예: '4개 상품 모두 보기') */
        val expand: String? = null,
    ) {
        fun name(lang: String) = names[lang] ?: names["en"] ?: id
    }

    data class Rules(val version: Int, val malls: List<Rule>)

    fun parseRules(json: String): Rules {
        val o = JSONObject(json)
        val list = o.getJSONArray("malls")
        val malls = (0 until list.length()).mapNotNull { i ->
            try {
                val m = list.getJSONObject(i)
                fun rx(k: String) = if (m.has(k) && !m.isNull(k)) Regex(m.getString(k), setOf(RegexOption.MULTILINE)) else null
                val names = m.getJSONObject("name").let { n -> n.keys().asSequence().associateWith { n.getString(it) } }
                val url = m.getString("ordersUrl")
                if (!hostAllowed(url)) null
                else Rule(m.getString("id"), names, m.getString("currency"), url, rx("anchor")!!, rx("orderNo"), rx("total"),
                    rx("price")!!, rx("returnBy"), rx("noise")!!, rx("skipAfter"), m.optBoolean("needPrice", false),
                    m.optBoolean("useImageAlt", false), if (m.has("expand") && !m.isNull("expand")) m.getString("expand") else null)
            } catch (e: Exception) { null } // 잘못된 항목은 건너뜀
        }
        return Rules(o.getInt("version"), malls)
    }

    data class Item(
        val product: String,
        val orderDate: LocalDate?,
        /** 날짜는 보였지만 연도가 없어서 비워 둠 */
        val dateNoYear: String?,
        val amount: String?,
        val orderNo: String?,
        /** 화면에 날짜로 적힌 반품 기한(사용자가 확인 후 저장) */
        val returnBy: LocalDate?,
    )

    private val LETTER = Regex("[\\p{L}]")
    /** 화면 읽기 스크립트가 사진 설명 앞에 붙이는 표시 */
    const val IMG = "[IMG] "
    private fun norm(s: String) = s.lowercase().replace(Regex("[\\s,·]+"), "")

    fun parse(text: String, rule: Rule, refYear: Int = LocalDate.now().year): List<Item> {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val starts = lines.indices.filter { rule.anchor.containsMatchIn(lines[it]) }
        if (starts.isEmpty()) return emptyList()
        val out = ArrayList<Item>()
        starts.forEachIndexed { si, start ->
            val seg = lines.subList(start, if (si + 1 < starts.size) starts[si + 1] else lines.size)
            val joined = seg.joinToString("\n")
            val found = seg.flatMap { Dates.findAll(it, refYear) }
            val date = found.firstOrNull { it.sure != null }?.sure
            val noYear = if (date == null) found.firstOrNull { it.needsYear }?.raw else null
            val orderNo = rule.orderNo?.find(joined)?.groupValues?.getOrNull(1)
            val total = rule.total?.find(joined)?.groupValues?.getOrNull(1)
            val ret = rule.returnBy?.find(joined)?.groupValues?.getOrNull(1)?.let { Dates.findAll(it, refYear).firstOrNull()?.sure }

            // 상품 줄 후보: 잡음(버튼·상태·라벨)이 아닌, 글자가 충분한 줄. 사진 설명은 규칙이 허락할 때만
            val text = seg.map { it.removePrefix(IMG).trim() }
            val isImg = seg.map { it.startsWith(IMG) }
            val cand = BooleanArray(seg.size)
            var skipNext = false
            text.forEachIndexed { i, l ->
                if (isImg[i] && !rule.useImageAlt) return@forEachIndexed
                if (skipNext) { skipNext = false; return@forEachIndexed }
                if (rule.skipAfter?.containsMatchIn(l) == true) { skipNext = true; return@forEachIndexed }
                if (i == 0 || rule.noise.containsMatchIn(l) || rule.price.matches(l.replace(" ", "")) || Dates.findAll(l, refYear).isNotEmpty()) return@forEachIndexed
                if (orderNo != null && l.contains(orderNo)) return@forEachIndexed
                if (l.length < 4 || LETTER.findAll(l).count() < 3) return@forEachIndexed
                if (rule.price.containsMatchIn(l) && l.length < 25) return@forEachIndexed
                cand[i] = true
            }
            // 각 후보 아래 몇 줄 안(다음 후보 전까지)의 가격을 그 상품 가격으로. 같은 상품이 사진·글자로 두 번 나오면 하나로
            val products = LinkedHashMap<String, Pair<String, String?>>()
            seg.indices.filter { cand[it] }.forEach { i ->
                var price: String? = null
                for (j in i + 1 until minOf(seg.size, i + 4)) {
                    if (cand[j] || isImg[j]) break
                    rule.price.find(text[j])?.let { price = it.groupValues.getOrNull(1) }
                    if (price != null) break
                }
                if (price == null && rule.needPrice && !isImg[i]) return@forEach
                val key = norm(text[i]); val prev = products[key]
                if (prev == null || (prev.second == null && price != null)) products[key] = text[i] to (price ?: prev?.second)
            }
            if (products.isEmpty()) return@forEachIndexed
            products.values.forEach { (name, price) ->
                out += Item(name, date, noYear, price ?: if (products.size == 1) total else null, orderNo, ret)
            }
        }
        return out
    }
}
