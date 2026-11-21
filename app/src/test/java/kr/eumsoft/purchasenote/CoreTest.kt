package kr.eumsoft.purchasenote

import kr.eumsoft.purchasenote.backup.BackupFormat
import kr.eumsoft.purchasenote.core.Dates
import kr.eumsoft.purchasenote.core.Money
import kr.eumsoft.purchasenote.core.ReceiptParser
import kr.eumsoft.purchasenote.data.DeadlineKind
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.PurchaseImage
import kr.eumsoft.purchasenote.data.Status
import kr.eumsoft.purchasenote.data.StoredImage
import kr.eumsoft.purchasenote.reminder.Reminders
import kr.eumsoft.purchasenote.ui.SearchLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class MoneyTest {
    @Test fun parse_minor_units() {
        assertEquals(59900L, Money.parse("59,900", "KRW"))
        assertEquals(59900L, Money.parse("₩59,900", "KRW"))
        assertEquals(5990L, Money.parse("59.90", "USD"))
        assertEquals(5990L, Money.parse("US$59.90", "USD"))
        assertEquals(5900L, Money.parse("5,900", "JPY"))
        assertEquals(5990L, Money.parse("59,90", "EUR"))
        assertEquals(123456L, Money.parse("1.234,56", "EUR"))
        assertEquals(123456L, Money.parse("1,234.56", "USD"))
        assertEquals(1234000L, Money.parse("1.234.000", "KRW"))
        assertEquals(5000L, Money.parse("50", "USD"))
        assertNull(Money.parse("abc", "USD"))
        assertNull(Money.parse("", "KRW"))
    }
    @Test fun format_keeps_currency() {
        assertTrue(Money.format(59900, "KRW", Locale.KOREA).contains("59,900"))
        assertTrue(Money.format(5990, "USD", Locale.US).contains("59.90"))
        assertTrue(Money.format(5990, "EUR", Locale("es", "ES")).contains("59,90"))
        assertTrue(Money.format(5900, "JPY", Locale.JAPAN).contains("5,900"))
        // 화면 언어를 바꿔도 통화는 그대로(원화가 달러로 바뀌지 않음)
        assertTrue(Money.format(59900, "KRW", Locale.US).contains("59,900"))
        assertEquals("59900", Money.toPlain(59900, "KRW")); assertEquals("59.90", Money.toPlain(5990, "USD"))
    }
    @Test fun ambiguous_symbols_not_confirmed() {
        assertNull(Money.guessCurrency("Total $59.90")!!.code)
        assertTrue(Money.guessCurrency("Total $59.90")!!.options.containsAll(listOf("USD", "MXN")))
        assertNull(Money.guessCurrency("合計 ¥5,900")!!.code)
        assertEquals("JPY", Money.guessCurrency("合計 5,900円")!!.code)
        assertEquals("KRW", Money.guessCurrency("결제금액 59,900원")!!.code)
        assertEquals("USD", Money.guessCurrency("US$59.90")!!.code)
        assertEquals("EUR", Money.guessCurrency("Total 59,90 €")!!.code)
        assertNull(Money.guessCurrency("no money here"))
    }
}

class DatesTest {
    private fun one(s: String) = Dates.findAll(s, 2027)
    @Test fun clear_formats() {
        assertEquals(LocalDate.of(2027, 3, 4), one("주문일 2027-03-04")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("2027.3.4")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("2027년 3월 4일")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("2027年3月4日")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("Ordered on March 4, 2027")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("4 de marzo de 2027")[0].sure)
        assertEquals(LocalDate.of(2027, 3, 4), one("4 Mar 2027")[0].sure)
    }
    @Test fun ambiguous_order_not_confirmed() {
        val f = one("03/04/2027")[0]
        assertNull(f.sure); assertEquals(setOf(LocalDate.of(2027, 3, 4), LocalDate.of(2027, 4, 3)), f.options.toSet())
        // 13 이상이면 순서가 하나로 정해짐
        assertEquals(LocalDate.of(2027, 3, 25), one("25/03/2027")[0].sure)
    }
    @Test fun missing_year_not_confirmed() {
        val f = one("3월 4일 도착")[0]
        assertTrue(f.needsYear); assertNull(f.sure)
    }
    @Test fun buckets() {
        val t = LocalDate.of(2027, 3, 10)
        assertNull(Dates.bucket(null, t))
        assertEquals(Dates.Bucket.OVERDUE, Dates.bucket(t.minusDays(1), t))
        assertEquals(Dates.Bucket.TODAY, Dates.bucket(t, t))
        assertEquals(Dates.Bucket.SOON, Dates.bucket(t.plusDays(3), t))
        assertEquals(Dates.Bucket.LATER, Dates.bucket(t.plusDays(4), t))
    }
    @Test fun reminder_local_time_and_dst() {
        val ny = ZoneId.of("America/New_York")
        // 서머타임 시작일(2027-03-14) 오전 9시: 날짜가 밀리지 않음
        val at = Dates.reminderInstant(LocalDate.of(2027, 3, 14), 0, 9 * 60, ny)
        val z = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(at), ny)
        assertEquals(LocalDate.of(2027, 3, 14), z.toLocalDate()); assertEquals(9, z.hour)
        // 시간대가 바뀌면 같은 날짜 같은 현지 시각으로 재계산
        val seoul = Dates.reminderInstant(LocalDate.of(2027, 3, 20), 3, 9 * 60, ZoneId.of("Asia/Seoul"))
        val zs = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(seoul), ZoneId.of("Asia/Seoul"))
        assertEquals(LocalDate.of(2027, 3, 17), zs.toLocalDate()); assertEquals(9, zs.hour)
        // 존재하지 않는 시각(02:30, 서머타임 시작)도 같은 날짜 유지
        val gap = Dates.reminderInstant(LocalDate.of(2027, 3, 14), 0, 2 * 60 + 30, ny)
        assertEquals(LocalDate.of(2027, 3, 14), ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(gap), ny).toLocalDate())
    }
}

class ParserTest {
    @Test fun korean_receipt() {
        val r = ReceiptParser.parse(listOf("이음마켓 주문상세", "주문일자 2027.03.04", "주문번호 2027030412345678", "무선 이어폰 화이트", "상품금액 59,900원",
            "배송비 3,000원", "최종 결제금액 62,900원", "운송장번호 123456789012", "상품 수령 후 7일 이내 반품 가능"), 2027)
        assertEquals(ReceiptParser.DateKind.ORDER, r.dates[0].kind)
        assertEquals(LocalDate.of(2027, 3, 4), r.dates[0].found.sure)
        assertEquals(listOf("2027030412345678"), r.orderNumbers)
        assertEquals(listOf("123456789012"), r.trackingNumbers)
        assertTrue(r.amounts.any { it.kind == ReceiptParser.AmountKind.TOTAL && it.raw == "62,900" && it.currency?.code == "KRW" })
        assertTrue(r.amounts.any { it.kind == ReceiptParser.AmountKind.ITEM && it.raw == "59,900" })
        assertTrue(r.amounts.any { it.kind == ReceiptParser.AmountKind.SHIPPING })
        assertTrue(r.productCandidates.contains("무선 이어폰 화이트"))
        assertTrue(r.relativeDeadlineTexts.isNotEmpty())
        // 상대 기한은 날짜로 만들지 않음
        assertTrue(r.dates.none { it.kind == ReceiptParser.DateKind.RETURN })
    }
    @Test fun english_receipt_explicit_return_date() {
        val r = ReceiptParser.parse(listOf("Order placed March 4, 2027", "Order # 112-3344556-7788990", "USB-C Charger", "Item price $19.99",
            "Order total: $21.59", "Return by: 04/03/2027"), 2027)
        assertEquals(listOf("112-3344556-7788990"), r.orderNumbers)
        val ret = r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }
        assertNull(ret.found.sure) // 04/03 은 순서 불명확 → 사용자 선택
        assertTrue(r.amounts.first().kind == ReceiptParser.AmountKind.TOTAL)
        assertNull(r.amounts.first().currency!!.code) // $ → 확인 필요
    }
    @Test fun japanese_receipt() {
        val r = ReceiptParser.parse(listOf("ご注文日 2027年3月4日", "注文番号 250304-0001234", "ワイヤレスマウス", "合計 5,900円", "返品期限 2027年3月18日"), 2027)
        assertEquals(LocalDate.of(2027, 3, 18), r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }.found.sure)
        assertEquals(listOf("250304-0001234"), r.orderNumbers)
        assertEquals("JPY", r.amounts.first { it.kind == ReceiptParser.AmountKind.TOTAL }.currency?.code)
    }
    @Test fun spanish_receipt() {
        val r = ReceiptParser.parse(listOf("Fecha del pedido: 4 de marzo de 2027", "Nº de pedido: ES-778899", "Auriculares inalámbricos",
            "Total pagado 59,90 €", "Devolución hasta el 18/03/2027"), 2027)
        assertEquals(LocalDate.of(2027, 3, 4), r.dates.first { it.kind == ReceiptParser.DateKind.ORDER }.found.sure)
        assertEquals(LocalDate.of(2027, 3, 18), r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }.found.sure)
        assertEquals(listOf("ES-778899"), r.orderNumbers)
        assertEquals("EUR", r.amounts.first { it.kind == ReceiptParser.AmountKind.TOTAL }.currency?.code)
    }
    @Test fun mixed_korean_foreign() {
        val r = ReceiptParser.parse(listOf("해외직구 주문", "Order No. AB12345678", "Apple AirTag 4 Pack", "결제금액 US$99.00", "주문일 2027-03-04"), 2027)
        assertEquals("USD", r.amounts.first().currency?.code)
        assertTrue(r.orderNumbers.contains("AB12345678"))
    }
}

class ReminderPlanTest {
    private val zone = ZoneId.of("Asia/Seoul")
    private fun p(status: Status = Status.KEEPING, review: Boolean = false) = Purchase(id = 7, orderKey = "k", productName = "x",
        returnBy = LocalDate.of(2027, 3, 20).toEpochDay(), exchangeBy = LocalDate.of(2027, 3, 25).toEpochDay(), warrantyBy = null,
        remindDays = "3,0", remindMinute = 540, status = status, needsReview = review)
    private val now = LocalDate.of(2027, 3, 1).atStartOfDay(zone).toInstant().toEpochMilli()

    @Test fun default_two_per_deadline() { assertEquals(4, Reminders.plan(p(), now, zone).size) }
    @Test fun returned_turns_all_off() { assertTrue(Reminders.plan(p(Status.RETURNED), now, zone).isEmpty()) }
    @Test fun exchanged_turns_exchange_off_and_pauses_others() {
        val pl = Reminders.plan(p(Status.EXCHANGED, review = true), now, zone)
        assertTrue(pl.isEmpty())
        val reviewed = Reminders.plan(p(Status.EXCHANGED, review = false), now, zone)
        assertTrue(reviewed.all { it.kind == DeadlineKind.RETURN })
    }
    @Test fun past_reminders_are_not_sent() {
        val late = LocalDate.of(2027, 3, 19).atStartOfDay(zone).toInstant().toEpochMilli()
        val pl = Reminders.plan(p(), late, zone)
        assertTrue(pl.none { it.kind == DeadlineKind.RETURN && it.days == 3 })
    }
    @Test fun codes_are_unique_and_stable() {
        val codes = (1L..50L).flatMap { id -> DeadlineKind.entries.flatMap { k -> (0..30).map { Reminders.code(id, k, it) } } }
        assertEquals(codes.size, codes.toSet().size)
        assertEquals(Reminders.code(5, DeadlineKind.RETURN, 3), Reminders.code(5, DeadlineKind.RETURN, 3))
    }
}

class BackupTest {
    private val payload = BackupFormat.Payload(
        purchases = listOf(Purchase(id = 1, orderKey = "o1", productName = "무선 이어폰", store = "이음마켓", amountMinor = 59900, currency = "KRW",
            returnBy = 20000, createdAt = 1, updatedAt = 2), Purchase(id = 2, orderKey = "o1", productName = "케이스", createdAt = 3, updatedAt = 4)),
        images = listOf(StoredImage(id = 10, fileName = "a.jpg", sha256 = "aa", mime = "image/jpeg", createdAt = 5)),
        links = listOf(PurchaseImage(1, 10), PurchaseImage(2, 10)),
        files = mapOf("a.jpg" to byteArrayOf(1, 2, 3, 4)))

    @Test fun roundtrip() {
        val enc = BackupFormat.encrypt(BackupFormat.toZip(payload), "secret1".toCharArray(), iter = 10_000)
        val back = BackupFormat.fromZip(BackupFormat.decrypt(enc, "secret1".toCharArray()))
        assertEquals(payload.purchases, back.purchases); assertEquals(payload.images, back.images); assertEquals(payload.links, back.links)
        assertTrue(back.files["a.jpg"]!!.contentEquals(byteArrayOf(1, 2, 3, 4)))
    }
    @Test fun wrong_password() {
        val enc = BackupFormat.encrypt(BackupFormat.toZip(payload), "secret1".toCharArray(), iter = 10_000)
        try { BackupFormat.decrypt(enc, "nope".toCharArray()); fail() } catch (e: BackupFormat.WrongPassword) { }
    }
    @Test fun damaged_files() {
        val enc = BackupFormat.encrypt(BackupFormat.toZip(payload), "secret1".toCharArray(), iter = 10_000)
        val flipped = enc.copyOf().also { it[it.size - 5] = (it[it.size - 5] + 1).toByte() }
        try { BackupFormat.decrypt(flipped, "secret1".toCharArray()); fail() } catch (e: BackupFormat.WrongPassword) { }
        try { BackupFormat.decrypt(enc.copyOf(30), "secret1".toCharArray()); fail() } catch (e: BackupFormat.Corrupt) { }
        try { BackupFormat.decrypt("hello world, not a backup at all......................".toByteArray(), "x".toCharArray()); fail() } catch (e: BackupFormat.Corrupt) { }
        try { BackupFormat.fromZip(byteArrayOf(1, 2, 3)); fail() } catch (e: BackupFormat.Corrupt) { }
        val missing = payload.copy(files = emptyMap())
        try { BackupFormat.fromZip(BackupFormat.toZip(missing)); fail() } catch (e: BackupFormat.Corrupt) { }
    }
}

class SearchTest {
    private val today = LocalDate.of(2027, 3, 10)
    private val list = listOf(
        Purchase(id = 1, orderKey = "a", productName = "무선 이어폰", store = "이음마켓", orderNumber = "A-1", orderDate = today.minusDays(3).toEpochDay(), returnBy = today.plusDays(5).toEpochDay()),
        Purchase(id = 2, orderKey = "b", productName = "USB charger", store = "Shop", orderNumber = "ZX-99", orderDate = today.minusDays(100).toEpochDay(), returnBy = today.plusDays(1).toEpochDay()),
        Purchase(id = 3, orderKey = "c", productName = "Mouse", store = "Shop", orderDate = today.minusDays(1).toEpochDay(), status = Status.RETURNED))
    @Test fun query_and_filters() {
        assertEquals(listOf(2L), SearchLogic.filter(list, "zx-9", null, null, SearchLogic.Period.ALL, false, today).map { it.id })
        assertEquals(listOf(1L), SearchLogic.filter(list, "이어폰", null, null, SearchLogic.Period.ALL, false, today).map { it.id })
        assertEquals(setOf(2L, 3L), SearchLogic.filter(list, "", "Shop", null, SearchLogic.Period.ALL, false, today).map { it.id }.toSet())
        assertEquals(listOf(3L), SearchLogic.filter(list, "", null, Status.RETURNED, SearchLogic.Period.ALL, false, today).map { it.id })
        assertEquals(setOf(1L, 3L), SearchLogic.filter(list, "", null, null, SearchLogic.Period.D30, false, today).map { it.id }.toSet())
    }
    @Test fun sorting() {
        assertEquals(listOf(3L, 1L, 2L), SearchLogic.filter(list, "", null, null, SearchLogic.Period.ALL, false, today).map { it.id })
        // 기한순: 반품 완료(기한 비활성)는 뒤로
        assertEquals(listOf(2L, 1L, 3L), SearchLogic.filter(list, "", null, null, SearchLogic.Period.ALL, true, today).map { it.id })
    }
}
