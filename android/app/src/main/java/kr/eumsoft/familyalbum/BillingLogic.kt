package kr.eumsoft.familyalbum

/**
 * 결제 브리지에서 안드로이드 API 와 무관한 판단만 모아 둔 곳 (JVM 단위 테스트 대상).
 */
object BillingLogic {
    /** 결제창에 쓸 혜택 하나를 고른다: 기본 요금제가 같은 것 중 혜택(무료 체험 등)이 있으면 그것, 없으면 기본 요금제. */
    data class Offer(val basePlanId: String, val offerId: String?, val token: String)

    fun pickOffer(offers: List<Offer>, basePlanId: String): Offer? {
        val same = offers.filter { it.basePlanId == basePlanId }
        return same.firstOrNull { it.offerId != null } ?: same.firstOrNull()
    }

    /** 요금제 변경이면 기존 구독 토큰이 있어야 한다. 빈 값은 '새 결제'로 본다. */
    fun isChange(oldPurchaseToken: String?): Boolean = !oldPurchaseToken.isNullOrBlank()

    /** 서버가 발급한 구매 식별자 확인: Play 제한(64자) 안의 영숫자·-·_ 만 허용 */
    fun isValidAccountId(id: String?): Boolean =
        !id.isNullOrBlank() && id.length <= 64 && id.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    /** 결제 완료(1)인 구매의 토큰만, 중복 없이 */
    fun completedTokens(purchases: List<Pair<String, Int>>): List<String> =
        purchases.filter { it.second == 1 }.map { it.first }.distinct()
}
