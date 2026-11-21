package kr.eumsoft.purchasenote

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.data.Status
import org.junit.Test
import org.junit.runner.RunWith
import java.time.LocalDate
import java.time.LocalTime
import java.io.File
import android.net.Uri

/** 화면 검수용 합성 데이터 넣기 (에뮬레이터 스크립트가 -e class 로 따로 실행). 알림 시각은 지금+2분 */
@RunWith(AndroidJUnit4::class)
class SeedTest {
    @Test fun seed() = runBlocking<Unit> {
        val c = InstrumentationRegistry.getInstrumentation().targetContext
        val repo = Repo(c); repo.deleteAll()
        val t = LocalDate.now()
        val ins = InstrumentationRegistry.getInstrumentation().context.assets.open("receipts/receipt_ko.png")
        val f = File(c.cacheDir, "seed.png"); f.outputStream().use { ins.copyTo(it) }
        val img = repo.importImage(Uri.fromFile(f)).image
        val now = LocalTime.now().plusMinutes(2)
        repo.save(Purchase(orderKey = "s1", productName = "무선 이어폰 화이트", store = "이음마켓", orderDate = t.minusDays(5).toEpochDay(),
            amountMinor = 59900, currency = "KRW", orderNumber = "2027030412345678", returnBy = t.toEpochDay(),
            remindDays = "0", remindMinute = now.hour * 60 + now.minute), listOf(img.id))
        repo.save(Purchase(orderKey = "s2", productName = "USB-C Charger 30W", store = "Sample Shop", orderDate = t.minusDays(2).toEpochDay(),
            amountMinor = 2159, currency = "USD", exchangeBy = t.plusDays(2).toEpochDay()), emptyList())
        repo.save(Purchase(orderKey = "s3", productName = "ワイヤレスマウス", store = "サンプルストア", amountMinor = 5900, currency = "JPY",
            returnBy = t.minusDays(1).toEpochDay()), emptyList())
        repo.save(Purchase(orderKey = "s4", productName = "Auriculares inalámbricos con un nombre de producto bastante largo para probar", store = "Tienda de Ejemplo",
            amountMinor = 5990, currency = "EUR", warrantyBy = t.plusDays(300).toEpochDay(), status = Status.EXCHANGING), emptyList())
        repo.save(Purchase(orderKey = "s5", productName = "텀블러 500ml", store = "이음마켓", amountMinor = 15000, currency = "KRW"), emptyList())
        Repo.release(listOf(img.id))
    }
}
