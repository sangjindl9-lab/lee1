package kr.eumsoft.purchasenote.core

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * 금액은 ISO 통화 코드 + 해당 통화 최소 단위 정수(예: KRW 59900, USD 5990 = $59.90)로 저장한다.
 * 환율 변환·서로 다른 통화의 합산은 하지 않는다.
 */
object Money {
    /** 앱에서 고를 수 있는 통화(필요 시 추가). 순서는 선택 목록 순서. */
    val COMMON = listOf("KRW", "USD", "JPY", "EUR", "CNY", "GBP", "CAD", "AUD", "MXN", "TWD", "HKD", "SGD", "ARS", "CLP", "COP")

    fun digits(code: String): Int = try { Currency.getInstance(code).defaultFractionDigits.coerceAtLeast(0) } catch (e: Exception) { 2 }

    /** 사용자가 입력한 "59,900" "59.90" "59,90" 같은 문자열 → 최소 단위 정수. 해석할 수 없으면 null. */
    fun parse(input: String, code: String): Long? {
        val d = digits(code)
        var s = input.trim().replace(Regex("[\\s\\u00A0\\u202F'’]"), "")
            .replace(Regex("[^0-9.,\\-]"), "")
        if (s.isEmpty() || s == "-" ) return null
        val neg = s.startsWith("-"); s = s.trimStart('-')
        if (s.isEmpty() || !s.any(Char::isDigit)) return null
        val lastDot = s.lastIndexOf('.'); val lastComma = s.lastIndexOf(',')
        val sepIdx = maxOf(lastDot, lastComma)
        val intPart: String; val fracPart: String
        if (sepIdx >= 0) {
            val after = s.length - sepIdx - 1
            val sepChar = s[sepIdx]
            val sepCount = s.count { it == sepChar }
            // 소수 구분자로 볼 조건: 마지막 구분자 뒤 1~2자리(또는 통화 자릿수), 그리고 같은 구분자가 하나뿐이거나 다른 구분자가 앞에 있을 때
            val isDecimal = d > 0 && after in 1..d && (sepCount == 1 || (lastDot >= 0 && lastComma >= 0))
            if (isDecimal) { intPart = s.substring(0, sepIdx).replace(".", "").replace(",", ""); fracPart = s.substring(sepIdx + 1) }
            else { intPart = s.replace(".", "").replace(",", ""); fracPart = "" }
        } else { intPart = s; fracPart = "" }
        if (intPart.isEmpty() && fracPart.isEmpty()) return null
        return try {
            val bd = BigDecimal((intPart.ifEmpty { "0" }) + if (fracPart.isNotEmpty()) ".$fracPart" else "")
            val v = bd.setScale(d, RoundingMode.HALF_UP).movePointRight(d).longValueExact()
            if (neg) -v else v
        } catch (e: Exception) { null }
    }

    /** 표시용: 통화 기호는 해당 통화 기준, 숫자 모양은 화면 언어 기준. */
    fun format(minor: Long, code: String, locale: Locale = Locale.getDefault()): String {
        val d = digits(code)
        return try {
            val nf = NumberFormat.getCurrencyInstance(locale)
            nf.currency = Currency.getInstance(code)
            nf.minimumFractionDigits = d; nf.maximumFractionDigits = d
            val s = nf.format(BigDecimal.valueOf(minor, d))
            // 여러 나라가 같은 기호를 쓰는 경우 혼동을 줄이기 위해 코드도 붙인다.
            if (code in AMBIGUOUS_SYMBOL_CODES && !s.contains(code)) "$s $code" else s
        } catch (e: Exception) { BigDecimal.valueOf(minor, d).toPlainString() + " " + code }
    }

    /** 편집 화면 입력값(숫자만, 소수점은 '.')으로 되돌리기 */
    fun toPlain(minor: Long, code: String): String = BigDecimal.valueOf(minor, digits(code)).toPlainString()

    private val AMBIGUOUS_SYMBOL_CODES = setOf("USD", "CAD", "AUD", "MXN", "CNY", "JPY", "HKD", "SGD", "TWD", "ARS", "CLP", "COP")

    /**
     * 텍스트 속 통화 표시 → 확정 코드 또는 후보 목록.
     * '$'·'¥'처럼 여러 통화에 쓰이는 기호는 확정하지 않고 후보만 준다.
     */
    data class CurrencyGuess(val code: String?, val options: List<String>, val marker: String)

    fun guessCurrency(text: String): CurrencyGuess? {
        val t = text
        fun has(r: String) = Regex(r).containsMatchIn(t)
        return when {
            has("(?i)\\bKRW\\b|₩|￦|\\d\\s*원") -> CurrencyGuess("KRW", listOf("KRW"), "₩/원")
            has("(?i)\\bUSD\\b|US\\\$|U\\\$S") -> CurrencyGuess("USD", listOf("USD"), "US$")
            has("(?i)\\bJPY\\b|円|\\d\\s*えん") -> CurrencyGuess("JPY", listOf("JPY"), "円")
            has("(?i)\\bEUR\\b|€") -> CurrencyGuess("EUR", listOf("EUR"), "€")
            has("(?i)\\bCNY\\b|\\bRMB\\b|元|人民币") -> CurrencyGuess("CNY", listOf("CNY"), "元")
            has("(?i)\\bGBP\\b|£") -> CurrencyGuess("GBP", listOf("GBP"), "£")
            has("(?i)\\bMXN\\b|MX\\\$") -> CurrencyGuess("MXN", listOf("MXN"), "MX$")
            has("(?i)\\bCAD\\b|C\\\$|CA\\\$") -> CurrencyGuess("CAD", listOf("CAD"), "CA$")
            has("(?i)\\bAUD\\b|A\\\$|AU\\\$") -> CurrencyGuess("AUD", listOf("AUD"), "A$")
            has("[¥￥]") -> CurrencyGuess(null, listOf("JPY", "CNY"), "¥")
            has("\\\$") -> CurrencyGuess(null, listOf("USD", "CAD", "AUD", "MXN", "ARS", "CLP", "COP"), "$")
            else -> null
        }
    }
}
