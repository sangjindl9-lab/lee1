package kr.eumsoft.purchasenote.core

/**
 * 인식 결과에서 '확실한 값'만 골라 빈 칸에 채울 제안을 만든다.
 * 확실하지 않은 것(날짜 순서·연도 불명, 여러 통화에 쓰는 기호)은 채우지 않고 선택으로 남긴다.
 */
object AutoFill {
    data class Fill(
        val product: String? = null,
        val store: String? = null,
        val orderDate: Long? = null,
        val amount: String? = null,
        val currency: String? = null,
        /** 금액은 채웠지만 통화를 사용자가 골라야 할 때 */
        val currencyHint: Money.CurrencyGuess? = null,
        val orderNumber: String? = null,
        val returnBy: Long? = null,
        val exchangeBy: Long? = null,
        val warrantyBy: Long? = null,
    )

    private val HEADER = Regex("(?i)\\s*[-–|·:]?\\s*(주문\\s*상세|주문\\s*내역|주문\\s*정보|영수증|구매\\s*내역|order\\s*details|order\\s*summary|receipt|invoice|ご注文内容|注文内容|注文詳細|領収書|レシート|detalles?\\s*del\\s*pedido|pedido|recibo|factura)\\s*$")

    fun from(r: ReceiptParser.Result): Fill {
        val lines = r.productCandidates
        // 첫 줄이 '가게 이름 + 주문상세' 꼴이면 가게 이름으로 쓰고, 상품명 후보에서는 뺀다
        val header = lines.firstOrNull()?.takeIf { HEADER.containsMatchIn(it) }
        val store = header?.replace(HEADER, "")?.trim()?.trimEnd('-', '·', '|', ':')?.trim()?.takeIf { it.length >= 2 }
        val product = lines.filter { it != header && !HEADER.containsMatchIn(it) }.firstOrNull { it.length >= 2 }

        fun sureDate(vararg kinds: ReceiptParser.DateKind) =
            kinds.firstNotNullOfOrNull { k -> r.dates.firstOrNull { it.kind == k && it.found.sure != null }?.found?.sure }?.toEpochDay()

        val total = r.amounts.firstOrNull { it.kind == ReceiptParser.AmountKind.TOTAL }
            ?: r.amounts.singleOrNull { it.kind == ReceiptParser.AmountKind.ITEM }
        val g = total?.currency
        return Fill(
            product = product,
            store = store,
            orderDate = sureDate(ReceiptParser.DateKind.ORDER, ReceiptParser.DateKind.PAYMENT),
            amount = total?.raw,
            currency = g?.code,
            currencyHint = if (total != null && g != null && g.code == null) g else null,
            orderNumber = r.orderNumbers.singleOrNull(),
            returnBy = sureDate(ReceiptParser.DateKind.RETURN),
            exchangeBy = sureDate(ReceiptParser.DateKind.EXCHANGE),
            warrantyBy = sureDate(ReceiptParser.DateKind.WARRANTY),
        )
    }
}
