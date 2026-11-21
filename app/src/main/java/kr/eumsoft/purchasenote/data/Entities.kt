package kr.eumsoft.purchasenote.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

enum class Status { KEEPING, RETURNING, EXCHANGING, RETURNED, EXCHANGED }

/** 기한 종류 */
enum class DeadlineKind { RETURN, EXCHANGE, WARRANTY }

/**
 * 구매 한 건 = 상품 하나. 한 주문의 여러 상품은 orderKey로 묶는다(주문번호가 같다고 자동 병합하지 않음).
 * 날짜는 epochDay(시각 없는 달력 날짜). 금액은 통화 최소 단위 정수.
 */
@Entity(tableName = "purchase", indices = [Index("orderKey"), Index("store")])
data class Purchase(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderKey: String,
    val productName: String,
    val store: String? = null,
    val orderDate: Long? = null,
    val amountMinor: Long? = null,
    val currency: String? = null,
    val orderNumber: String? = null,
    val link: String? = null,
    val memo: String? = null,
    val status: Status = Status.KEEPING,
    val returnBy: Long? = null,
    val exchangeBy: Long? = null,
    val warrantyBy: Long? = null,
    /** 알림 며칠 전 목록(쉼표). 빈 문자열이면 알림 없음 */
    val remindDays: String = "3,0",
    /** 알림 시각(하루 중 분) */
    val remindMinute: Int = 9 * 60,
    /** 교환 완료 후 사용자가 기한을 다시 확인해야 함 (확인 전까지 반품·AS 알림 보류) */
    val needsReview: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
) {
    fun deadline(k: DeadlineKind) = when (k) { DeadlineKind.RETURN -> returnBy; DeadlineKind.EXCHANGE -> exchangeBy; DeadlineKind.WARRANTY -> warrantyBy }
    fun daysList(): List<Int> = remindDays.split(',').mapNotNull { it.trim().toIntOrNull() }.filter { it in 0..30 }.distinct()
    /** 진행 중인(알림·임박 표시 대상) 기한들 */
    fun activeDeadlines(): List<Pair<DeadlineKind, Long>> {
        if (status == Status.RETURNED) return emptyList()
        return DeadlineKind.entries.mapNotNull { k ->
            val d = deadline(k) ?: return@mapNotNull null
            if (k == DeadlineKind.EXCHANGE && status == Status.EXCHANGED) return@mapNotNull null
            if (needsReview && k != DeadlineKind.EXCHANGE) return@mapNotNull null
            k to d
        }
    }
    fun nearestDeadline(): Long? = activeDeadlines().minOfOrNull { it.second }
}

/** 앱 전용 저장소에 보관한 이미지 사본. 같은 사진(sha256)은 한 번만 저장 */
@Entity(tableName = "image", indices = [Index(value = ["sha256"], unique = true)])
data class StoredImage(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val fileName: String,
    val sha256: String,
    val mime: String,
    val ocrText: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "purchase_image",
    primaryKeys = ["purchaseId", "imageId"],
    indices = [Index("imageId")],
    foreignKeys = [
        ForeignKey(entity = Purchase::class, parentColumns = ["id"], childColumns = ["purchaseId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = StoredImage::class, parentColumns = ["id"], childColumns = ["imageId"], onDelete = ForeignKey.CASCADE),
    ],
)
data class PurchaseImage(val purchaseId: Long, val imageId: Long)
