package kr.eumsoft.purchasenote.core

import java.time.LocalDate

/**
 * 인식된 글자 줄 → 필드 후보. 어떤 값도 자동 확정하지 않고 사용자가 고르게 한다.
 * 쇼핑몰 로고·화면 좌표는 쓰지 않는다(글자와 라벨만 사용).
 */
object ReceiptParser {
    enum class DateKind { ORDER, PAYMENT, DELIVERY, RETURN, EXCHANGE, WARRANTY, OTHER }
    enum class AmountKind { TOTAL, ITEM, SUBTOTAL, SHIPPING, DISCOUNT, OTHER }

    data class LabeledDate(val kind: DateKind, val found: Dates.Found, val line: String)
    data class LabeledAmount(val kind: AmountKind, val raw: String, val currency: Money.CurrencyGuess?, val line: String)
    data class Result(
        val dates: List<LabeledDate>,
        val amounts: List<LabeledAmount>,
        val orderNumbers: List<String>,
        val trackingNumbers: List<String>,
        val productCandidates: List<String>,
        val currency: Money.CurrencyGuess?,
        /** '수령 후 7일'처럼 기준일이 불명확한 기한 문구 (기한은 비워 두고 확인 안내) */
        val relativeDeadlineTexts: List<String>,
    )

    private fun rx(s: String) = Regex(s, RegexOption.IGNORE_CASE)

    private val DATE_LABELS = listOf(
        DateKind.RETURN to rx("반품|환불|返品|返金|\\breturns?\\b|return by|devoluci[oó]n|reembolso"),
        DateKind.EXCHANGE to rx("교환|交換|\\bexchanges?\\b|\\bcambios?\\b"),
        DateKind.WARRANTY to rx("(?-i:\\bA/?S\\b)|보증|무상\\s*수리|保証|warrant|guarantee|garant[ií]a"),
        DateKind.PAYMENT to rx("결제\\s*일|결제\\s*일시|입금|支払日|お支払い日|決済日|payment date|paid on|fecha de pago"),
        DateKind.ORDER to rx("주문\\s*일|주문\\s*일자|주문\\s*일시|구매\\s*일|注文日|ご注文日|購入日|order date|ordered on|order placed|date ordered|fecha de(l)? pedido|fecha de compra|pedido realizado"),
        DateKind.DELIVERY to rx("배송|도착|수령|출고|配達|お届け|発送|到着|deliver|arriv|shipped|ship date|entrega|env[ií]o|llega"),
    )
    private val AMOUNT_LABELS = listOf(
        AmountKind.DISCOUNT to rx("할인|쿠폰|적립|割引|クーポン|discount|coupon|descuento|cup[oó]n"),
        AmountKind.SHIPPING to rx("배송비|送料|shipping|delivery fee|gastos de env[ií]o|env[ií]o"),
        AmountKind.TOTAL to rx("총\\s*결제|최종\\s*결제|결제\\s*금액|합계|총\\s*금액|총액|grand total|order total|amount paid|\\btotal\\b|合計|お支払い金額|ご請求額|総額|お支払金額|importe total|total a pagar|total pagado"),
        AmountKind.SUBTOTAL to rx("소계|subtotal|小計"),
        AmountKind.ITEM to rx("상품\\s*금액|판매가|단가|상품가|\\bprice\\b|\\bitem\\b|商品|単価|価格|precio|art[ií]culo"),
    )
    private val ORDER_NO = rx("(?:주문\\s*번호|주문No\\.?|order\\s*(?:#|no\\.?|number|id)|注文番号|ご注文番号|受注番号|n[º°o]\\.?\\s*de\\s*pedido|n[uú]mero\\s*de\\s*pedido|pedido\\s*(?:n[º°o]\\.?|#))\\s*[:：#]?\\s*([A-Za-z0-9][A-Za-z0-9\\-]{4,})")
    private val TRACKING_NO = rx("(?:(?:운송장|송장)(?:\\s*번호)?|tracking(?:\\s*(?:#|no\\.?|number))?|追跡番号|お問い合わせ番号|伝票番号|n[uú]mero\\s*de\\s*seguimiento|gu[ií]a)\\s*[:：#]?\\s*([A-Za-z0-9][A-Za-z0-9\\-]{5,})")
    private val RELATIVE = rx("((?:수령|배송|도착|구매|받은\\s*날|상품\\s*수령)\\s*(?:후|일로부터|로부터)\\s*\\d+\\s*일)|(within\\s+\\d+\\s+days)|(\\d+\\s*日以内)|(\\d+\\s*d[ií]as(?:\\s+naturales|\\s+h[aá]biles)?)|(\\d+\\s*days\\s+(?:of|after|from))")
    private val AMOUNT = Regex("(?:(US\\$|MX\\$|CA\\$|A\\$|[₩￦\\$€£¥￥]|KRW|USD|EUR|JPY|MXN)\\s?)?(-?\\d{1,3}(?:[,.\\s\\u00A0]\\d{3})+(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?)\\s?(원|円|€|KRW|USD|EUR|JPY|MXN)?")

    private fun dateKind(line: String) = DATE_LABELS.firstOrNull { it.second.containsMatchIn(line) }?.first
    private fun amountKind(line: String) = AMOUNT_LABELS.firstOrNull { it.second.containsMatchIn(line) }?.first
    private fun isLabelOnly(line: String) = line.none(Char::isDigit) && line.length <= 30

    fun parse(lines: List<String>, refYear: Int = LocalDate.now().year): Result {
        val clean = lines.map { it.trim() }.filter { it.isNotEmpty() }
        val all = clean.joinToString("\n")
        val dates = ArrayList<LabeledDate>()
        val amounts = ArrayList<LabeledAmount>()
        val orders = LinkedHashSet<String>(); val tracks = LinkedHashSet<String>()
        val products = ArrayList<String>()
        val relative = ArrayList<String>()
        val overall = Money.guessCurrency(all)

        clean.forEachIndexed { i, line ->
            val prev = if (i > 0 && isLabelOnly(clean[i - 1])) clean[i - 1] else null
            val labelForNo = if (prev != null) "$prev $line" else line
            TRACKING_NO.findAll(labelForNo).forEach { tracks += it.groupValues[1] }
            ORDER_NO.findAll(labelForNo).forEach { val v = it.groupValues[1]; if (v !in tracks) orders += v }
            RELATIVE.findAll(line).forEach { relative += line }

            val found = Dates.findAll(line, refYear)
            val dk = dateKind(line) ?: prev?.let(::dateKind) ?: DateKind.OTHER
            found.forEach { dates += LabeledDate(dk, it, line) }

            // 금액: 통화 표시가 붙었거나, 금액 라벨이 있는 줄만
            val ak = amountKind(line) ?: prev?.let(::amountKind)
            val dateRanges = found.map { it.start until it.start + it.raw.length }
            AMOUNT.findAll(line).forEach { m ->
                if (dateRanges.any { r -> m.range.first in r || m.range.last in r }) return@forEach
                val marker = m.groupValues[1].ifEmpty { m.groupValues[3] }
                if (marker.isEmpty() && ak == null) return@forEach
                val num = m.groupValues[2].trim()
                if (num.count(Char::isDigit) < 1 || (marker.isEmpty() && num.count(Char::isDigit) > 9)) return@forEach
                if (orders.any { num.replace(Regex("\\D"), "") == it.replace(Regex("\\D"), "") }) return@forEach
                val cur = if (marker.isNotEmpty()) Money.guessCurrency(m.value) ?: overall else overall
                amounts += LabeledAmount(ak ?: AmountKind.OTHER, num, cur, line)
            }

            val digits = line.count(Char::isDigit)
            if (found.isEmpty() && dateKind(line) == null && amountKind(line) == null && !ORDER_NO.containsMatchIn(line) &&
                !TRACKING_NO.containsMatchIn(line) && line.length in 2..80 && digits * 2 < line.length && line.any(Char::isLetter)
            ) products += line
        }
        return Result(
            dates = dates,
            amounts = amounts.sortedBy { if (it.kind == AmountKind.TOTAL) 0 else if (it.kind == AmountKind.ITEM) 1 else 2 },
            orderNumbers = orders.toList(),
            trackingNumbers = tracks.toList(),
            productCandidates = products.distinct().take(10),
            currency = overall,
            relativeDeadlineTexts = relative.distinct(),
        )
    }
}
