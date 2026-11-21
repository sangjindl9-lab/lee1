package kr.eumsoft.purchasenote

import kr.eumsoft.purchasenote.core.AutoFill
import kr.eumsoft.purchasenote.core.ImportParser
import kr.eumsoft.purchasenote.core.ReceiptParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

class AutoFillTest {
    @Test fun korean_receipt_fills_clear_values() {
        val r = ReceiptParser.parse(listOf("이음마켓 주문상세", "주문일자 2027.03.04", "주문번호 2027030412345678", "무선 이어폰 화이트", "상품금액 59,900원",
            "배송비 3,000원", "최종 결제금액 62,900원", "상품 수령 후 7일 이내 반품 가능"), 2027)
        val f = AutoFill.from(r)
        assertEquals("무선 이어폰 화이트", f.product); assertEquals("이음마켓", f.store)
        assertEquals(LocalDate.of(2027, 3, 4).toEpochDay(), f.orderDate)
        assertEquals("62,900", f.amount); assertEquals("KRW", f.currency)
        assertEquals("2027030412345678", f.orderNumber)
        assertNull(f.returnBy) // '수령 후 7일'은 날짜가 아니므로 비움
    }
    @Test fun ambiguous_values_are_not_filled() {
        val r = ReceiptParser.parse(listOf("Sample Shop - Order details", "Order date 03/04/2027", "Desk lamp", "Total ¥3,200", "Return by: 04/03/2027"), 2027)
        val f = AutoFill.from(r)
        assertEquals("Sample Shop", f.store); assertEquals("Desk lamp", f.product)
        assertNull(f.orderDate); assertNull(f.returnBy)           // 월/일 순서 불명
        assertEquals("3,200", f.amount); assertNull(f.currency)   // ¥ → 사용자 선택
        assertTrue(f.currencyHint!!.options.contains("JPY"))
    }
    @Test fun explicit_deadline_is_filled() {
        val r = ReceiptParser.parse(listOf("ご注文日 2027年3月4日", "ワイヤレスマウス", "合計 5,900円", "返品期限 2027年3月18日"), 2027)
        val f = AutoFill.from(r)
        assertEquals(LocalDate.of(2027, 3, 18).toEpochDay(), f.returnBy); assertEquals("JPY", f.currency)
    }
}

class ImportParserTest {
    private val json = File("src/main/assets/import_rules.json").readText()
    private val rules = ImportParser.parseRules(json)
    private fun rule(id: String) = rules.malls.first { it.id == id }

    @Test fun bundled_and_server_rules_are_same_and_valid() {
        assertEquals(json, File("../site/public/rules/v1.json").readText())
        assertEquals(3, rules.malls.size)
    }
    @Test fun rules_cannot_point_outside_allowed_shops() {
        val bad = json.replace("https://www.amazon.com/gp/css/order-history", "https://evil.example.com/login")
        assertFalse(ImportParser.parseRules(bad).malls.any { it.id == "amazon_us" })
        assertFalse(ImportParser.hostAllowed("http://www.amazon.com/"))
        assertFalse(ImportParser.hostAllowed("https://amazon.com.evil.io/"))
        assertTrue(ImportParser.hostAllowed("https://m.coupang.com/x"))
    }
    @Test fun amazon_order_history() {
        val text = """
            Your Orders
            Orders
            Buy Again
            ORDER PLACED
            November 3, 2026
            TOTAL
            $21.59
            SHIP TO
            Jane Doe
            ORDER # 112-3344556-7788990
            View order details
            View invoice
            Delivered Nov 5
            Your package was left near the front door or porch.
            Anker USB-C Charger 30W, Fast Charging Block
            Return or replace items: Eligible through December 5, 2026
            Buy it again
            View your item
            Track package
            Write a product review
            ORDER PLACED
            October 20, 2026
            TOTAL
            $45.98
            SHIP TO
            Jane Doe
            ORDER # 113-1111111-2222222
            Delivered Oct 22
            Wireless Mouse, Silent Click
            $19.99
            Mechanical Keyboard Wrist Rest
            $25.99
            Return window closed on Nov 21, 2026
        """.trimIndent()
        val items = ImportParser.parse(text, rule("amazon_us"), 2026)
        assertEquals(listOf("Anker USB-C Charger 30W, Fast Charging Block", "Wireless Mouse, Silent Click", "Mechanical Keyboard Wrist Rest"), items.map { it.product })
        assertTrue(items.none { it.product.contains("Jane") })    // 받는 사람 이름 제외
        assertEquals(LocalDate.of(2026, 11, 3), items[0].orderDate)
        assertEquals("21.59", items[0].amount); assertEquals("112-3344556-7788990", items[0].orderNo)
        assertEquals(LocalDate.of(2026, 12, 5), items[0].returnBy)
        assertEquals("19.99", items[1].amount); assertEquals("25.99", items[2].amount)
        assertNull(items[1].returnBy)
    }
    @Test fun coupang_order_list() {
        val text = """
            주문목록
            2026. 11. 3 주문
            주문상세보기
            배송완료
            11/5(수) 도착
            곰곰 무농약 현미 4kg, 1개
            31,900 원 1 개
            장바구니 담기
            교환, 반품 신청
            배송조회
            리뷰 작성하기
            2026. 10. 28 주문
            배송완료
            삼다수 2L, 12개
            15,800 원 1 개
            탐사 물티슈 100매, 10개
            12,900 원 1 개
            배송조회
        """.trimIndent()
        val items = ImportParser.parse(text, rule("coupang"), 2026)
        assertEquals(listOf("곰곰 무농약 현미 4kg, 1개", "삼다수 2L, 12개", "탐사 물티슈 100매, 10개"), items.map { it.product })
        assertEquals(LocalDate.of(2026, 11, 3), items[0].orderDate); assertEquals("31,900", items[0].amount)
        assertEquals(LocalDate.of(2026, 10, 28), items[1].orderDate); assertEquals("12,900", items[2].amount)
    }
    @Test fun naver_without_year_leaves_date_empty() {
        val text = """
            주문내역
            11. 3. 결제
            이음스토어
            스테인리스 텀블러 500ml 블랙
            18,500원
            구매확정
            리뷰쓰기
        """.trimIndent()
        val items = ImportParser.parse(text, rule("naver"), 2026)
        assertEquals(1, items.size)
        assertEquals("스테인리스 텀블러 500ml 블랙", items[0].product)
        assertNull(items[0].orderDate)
        assertEquals("18,500", items[0].amount)
    }
    @Test fun other_pages_give_nothing() {
        assertTrue(ImportParser.parse("Sign in\nEmail or mobile phone number\nContinue", rule("amazon_us")).isEmpty())
    }
}

/** 실제 쿠팡 주문내역 목록 모양(2026-11 사용자 화면): 날짜만 있는 줄 + 상품은 사진만(설명=상품명) */
class CoupangListTest {
    private val rule = ImportParser.parseRules(File("src/main/assets/import_rules.json").readText()).malls.first { it.id == "coupang" }
    @Test fun list_with_images_only() {
        val text = """
            주문내역
            주문한 상품을 검색할 수 있어요!
            자주 산 상품
            더보기
            [IMG] 하늘보리 500ml, 20개
            [IMG] 펩시 콜라 1.5L, 6개
            2026. 11. 20
            배송완료
            오늘(토) 도착 (문앞 전달)
            [IMG] 로켓프레시
            [IMG] 남자라면 115g, 4개
            [IMG] 오뚜기 오동통면 120g, 5개
            [IMG] 오뚜기 옛날 당면 300g
            [IMG] 농심 안성탕면 125g, 5개
            4개 상품 모두 보기
            배송완료
            오늘(토) 도착 (문앞 전달)
            [IMG] 곰곰 한돈 앞다리살 불고기용 500g
            [IMG] 곰곰 한돈 삼겹살 구이용 500g
            +5
            9개 상품 모두 보기
        """.trimIndent()
        val items = ImportParser.parse(text, rule, 2026)
        assertEquals(listOf("남자라면 115g, 4개", "오뚜기 오동통면 120g, 5개", "오뚜기 옛날 당면 300g", "농심 안성탕면 125g, 5개",
            "곰곰 한돈 앞다리살 불고기용 500g", "곰곰 한돈 삼겹살 구이용 500g"), items.map { it.product })
        assertTrue(items.all { it.orderDate == LocalDate.of(2026, 11, 20) })
        assertTrue(items.none { it.product.contains("하늘보리") })   // '자주 산 상품'은 주문이 아님
        assertNull(items[0].amount)
    }
    @Test fun expanded_list_merges_image_and_text_with_price() {
        val text = """
            2026. 11. 20
            배송완료
            [IMG] 농심 안성탕면 125g, 5개
            농심 안성탕면 125g, 5개
            4,580원 1개
        """.trimIndent()
        val items = ImportParser.parse(text, rule, 2026)
        assertEquals(1, items.size); assertEquals("4,580", items[0].amount)
    }
    @Test fun order_detail_page() {
        val text = """
            주문상세
            주문일 2026. 11. 20
            주문번호 31000123456789
            배송완료
            [IMG] 농심 안성탕면 125g, 5개
            농심 안성탕면 125g, 5개
            4,580원 1개
            [IMG] 오뚜기 옛날 당면 300g
            오뚜기 옛날 당면 300g
            3,290원 1개
            총 결제금액 7,870원
            받는 사람
            홍길동
        """.trimIndent()
        val items = ImportParser.parse(text, rule, 2026)
        assertEquals(listOf("농심 안성탕면 125g, 5개", "오뚜기 옛날 당면 300g"), items.map { it.product })
        assertEquals(listOf("4,580", "3,290"), items.map { it.amount })
        assertTrue(items.all { it.orderNo == "31000123456789" && it.orderDate == LocalDate.of(2026, 11, 20) })
        assertTrue(items.none { it.product.contains("홍길동") })
    }
}
