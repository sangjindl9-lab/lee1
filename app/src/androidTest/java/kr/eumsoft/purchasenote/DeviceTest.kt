package kr.eumsoft.purchasenote

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kr.eumsoft.purchasenote.backup.BackupFormat
import kr.eumsoft.purchasenote.backup.BackupManager
import kr.eumsoft.purchasenote.core.ReceiptParser
import kr.eumsoft.purchasenote.data.DeadlineKind
import kr.eumsoft.purchasenote.data.ImageStore
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.data.Status
import kr.eumsoft.purchasenote.ocr.Recognizer
import kr.eumsoft.purchasenote.reminder.Reminders
import android.app.PendingIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.LocalDate

private const val TAG = "PNTEST"

private fun app(): Context = InstrumentationRegistry.getInstrumentation().targetContext
private fun assetFile(name: String): Uri {
    val ins = InstrumentationRegistry.getInstrumentation().context.assets.open("receipts/$name")
    val f = File(app().cacheDir, "t-$name"); f.outputStream().use { ins.copyTo(it) }
    return Uri.fromFile(f)
}

/** 기기 내 글자 인식(실제 ML Kit) — 합성 영수증 */
@RunWith(AndroidJUnit4::class)
class OcrDeviceTest {
    private fun read(name: String, s: Recognizer.Script = Recognizer.Script.AUTO): ReceiptParser.Result {
        val bmp = BitmapFactory.decodeStream(InstrumentationRegistry.getInstrumentation().context.assets.open("receipts/$name"))
        val (used, lines) = runBlocking { Recognizer.read(bmp, s) }
        Log.i(TAG, "OCR $name script=$used lines=${lines.size}: ${lines.joinToString(" | ")}")
        return ReceiptParser.parse(lines, 2027)
    }
    @Test fun korean() { val r = read("receipt_ko.png")
        assertEquals(LocalDate.of(2027, 3, 4), r.dates.first { it.kind == ReceiptParser.DateKind.ORDER }.found.sure)
        assertTrue(r.amounts.any { it.kind == ReceiptParser.AmountKind.TOTAL && it.currency?.code == "KRW" })
        assertTrue(r.relativeDeadlineTexts.isNotEmpty()) }
    @Test fun english() { val r = read("receipt_en.png")
        assertTrue(r.orderNumbers.any { it.contains("3344556") })
        assertNull(r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }.found.sure) }
    @Test fun japanese() { val r = read("receipt_ja.png")
        assertEquals(LocalDate.of(2027, 3, 18), r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }.found.sure)
        assertEquals("JPY", r.amounts.first { it.kind == ReceiptParser.AmountKind.TOTAL }.currency?.code) }
    @Test fun spanish() { val r = read("receipt_es.png", Recognizer.Script.LATIN)
        assertEquals(LocalDate.of(2027, 3, 18), r.dates.first { it.kind == ReceiptParser.DateKind.RETURN }.found.sure)
        assertEquals("EUR", r.amounts.first { it.kind == ReceiptParser.AmountKind.TOTAL }.currency?.code) }
    @Test fun mixed() { val r = read("receipt_mixed.png")
        assertTrue(r.amounts.any { it.currency?.code == "USD" }) }
    @Test fun multi_items() { val r = read("receipt_multi.png")
        assertTrue(r.productCandidates.size >= 3) }
    @Test fun ambiguous() { val r = read("receipt_ambiguous.png")
        assertTrue(r.dates.any { it.found.sure == null })
        assertTrue(r.amounts.any { it.currency?.code == null && it.currency?.options?.contains("JPY") == true }) }
    /** 흐린 사진: 결과를 기록만 하고 실패로 보지 않음(수동 입력 가능해야 함) */
    @Test fun blurred_is_recorded() { val r = read("receipt_ko_blur.png"); Log.i(TAG, "BLUR dates=${r.dates.size} amounts=${r.amounts.size}") }
}

/** 저장·사진 정리·중복 사진·알림·백업 (실제 Room·파일·AlarmManager) */
@RunWith(AndroidJUnit4::class)
class DataDeviceTest {
    private lateinit var repo: Repo
    @Before fun clean() { repo = Repo(app()); runBlocking { repo.deleteAll() } }

    @Test fun same_photo_reused_and_file_deleted_with_last_link() = runBlocking<Unit> {
        val a = repo.importImage(assetFile("receipt_ko.png"))
        val b = repo.importImage(assetFile("receipt_ko.png"))
        assertEquals(a.image.id, b.image.id)
        val id1 = repo.save(Purchase(orderKey = "o", productName = "A"), listOf(a.image.id))
        val c = repo.importImage(assetFile("receipt_ko.png"))
        assertEquals(listOf(id1), c.existing.map { it.id })        // 다시 공유 → 기존 기록 먼저
        val id2 = repo.save(Purchase(orderKey = "o", productName = "B"), listOf(a.image.id)) // 같은 사진에서 다른 상품 허용
        Repo.release(listOf(a.image.id))
        val f = ImageStore.file(app(), a.image.fileName)
        repo.delete(id1); assertTrue("다른 구매가 쓰는 사진은 남아야 함", f.exists())
        repo.delete(id2); assertFalse("마지막 연결이 사라지면 사본 삭제", f.exists())
        Log.i(TAG, "DATA photo-links PASS")
    }

    @Test fun bad_file_does_not_crash() = runBlocking<Unit> {
        try { repo.importImage(assetFile("not_an_image.png")); fail() } catch (e: ImageStore.ImportError) { assertEquals(ImageStore.Reason.NOT_IMAGE, e.reason) }
        try { repo.importImage(Uri.parse("content://nope/missing")); fail() } catch (e: ImageStore.ImportError) { assertEquals(ImageStore.Reason.COPY_FAILED, e.reason) }
    }

    @Test fun reminders_follow_status_and_deadline_changes() = runBlocking<Unit> {
        val far = LocalDate.now().plusDays(20).toEpochDay()
        val id = repo.save(Purchase(orderKey = "o", productName = "R", returnBy = far, exchangeBy = far), emptyList())
        fun has(k: DeadlineKind, d: Int) = Reminders.pending(app(), id, k, d, PendingIntent.FLAG_NO_CREATE) != null
        assertTrue(has(DeadlineKind.RETURN, 3) && has(DeadlineKind.RETURN, 0) && has(DeadlineKind.EXCHANGE, 3))
        repo.save(repo.dao.get(id)!!.copy(remindDays = "1"), emptyList())
        assertFalse(has(DeadlineKind.RETURN, 3)); assertTrue(has(DeadlineKind.RETURN, 1))
        repo.setStatus(id, Status.EXCHANGED)
        assertFalse(has(DeadlineKind.EXCHANGE, 1)); assertFalse(has(DeadlineKind.RETURN, 1)) // 다시 확인 전까지 보류
        repo.markReviewed(id); assertTrue(has(DeadlineKind.RETURN, 1)); assertFalse(has(DeadlineKind.EXCHANGE, 1))
        repo.setStatus(id, Status.RETURNED); assertFalse(has(DeadlineKind.RETURN, 1))
        repo.delete(id); assertFalse(has(DeadlineKind.RETURN, 1))
        Log.i(TAG, "DATA reminders PASS")
    }

    @Test fun backup_restore_and_failures_keep_data() = runBlocking<Unit> {
        val img = repo.importImage(assetFile("receipt_ja.png"))
        repo.save(Purchase(orderKey = "o", productName = "ワイヤレスマウス", amountMinor = 5900, currency = "JPY"), listOf(img.image.id))
        Repo.release(listOf(img.image.id))
        val bm = BackupManager(app())
        val bytes = bm.exportBytes("pass123".toCharArray())
        // 틀린 암호
        try { bm.readPreview(bytes, "wrong!!".toCharArray(), 1); fail() } catch (e: BackupFormat.WrongPassword) { }
        // 손상된 파일
        try { bm.readPreview(bytes.copyOf(bytes.size / 2), "pass123".toCharArray(), 1); fail() } catch (e: Exception) { }
        assertEquals(1, repo.dao.count())
        // 다른 데이터로 바꾼 뒤 복원
        repo.save(Purchase(orderKey = "x", productName = "temp"), emptyList())
        val pv = bm.readPreview(bytes, "pass123".toCharArray(), repo.dao.count())
        assertEquals(1, pv.purchases); assertEquals(1, pv.images); assertEquals(2, pv.currentPurchases)
        bm.apply(pv.payload)
        val all = repo.dao.allOnce()
        assertEquals(listOf("ワイヤレスマウス"), all.map { it.productName })
        assertEquals("JPY", all[0].currency); assertEquals(5900L, all[0].amountMinor)
        val imgs = repo.dao.imagesOfOnce(all[0].id)
        assertEquals(1, imgs.size); assertTrue(ImageStore.file(app(), imgs[0].fileName).exists())
        assertNotNull(ImageStore.loadBitmap(ImageStore.file(app(), imgs[0].fileName), 500))
        Log.i(TAG, "DATA backup PASS")
    }
}
