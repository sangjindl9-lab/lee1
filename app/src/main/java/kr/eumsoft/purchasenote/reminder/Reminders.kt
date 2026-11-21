package kr.eumsoft.purchasenote.reminder

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.core.Dates
import kr.eumsoft.purchasenote.data.AppDb
import kr.eumsoft.purchasenote.data.DeadlineKind
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.ui.MainActivity
import java.time.LocalDate
import java.time.ZoneId

/**
 * 기한 알림. 정확 알람 권한 없이 setAndAllowWhileIdle 사용 → 절전 상태에서는 늦게 올 수 있음(설정 화면에 안내).
 * 요청 코드는 (구매, 기한 종류, 며칠 전)으로 고정 → 다시 설정해도 같은 알람을 덮어쓰므로 중복되지 않는다.
 */
object Reminders {
    const val CHANNEL = "deadlines"
    private const val MAX_DAYS = 30
    /** 이보다 늦게 도착한(지난) 알림은 보내지 않는다 */
    const val LATE_LIMIT_MS = 6L * 60 * 60 * 1000

    fun code(purchaseId: Long, kind: DeadlineKind, days: Int): Int =
        (((purchaseId % 20_000_000L) * 3 + kind.ordinal) * (MAX_DAYS + 1) + days).toInt()

    data class Plan(val kind: DeadlineKind, val days: Int, val deadline: Long, val at: Long)

    /** 순수 계산: 앞으로 울릴 알림 목록(지난 시각은 제외) */
    fun plan(p: Purchase, now: Long, zone: ZoneId): List<Plan> =
        p.activeDeadlines().flatMap { (k, d) ->
            p.daysList().mapNotNull { days ->
                val at = Dates.reminderInstant(LocalDate.ofEpochDay(d), days, p.remindMinute, zone)
                if (at > now) Plan(k, days, d, at) else null
            }
        }

    private fun intent(c: Context, id: Long, kind: DeadlineKind, days: Int) =
        Intent(c, ReminderReceiver::class.java).setAction("kr.eumsoft.purchasenote.REMIND.$id.${kind.name}.$days")
            .putExtra("id", id).putExtra("kind", kind.name).putExtra("days", days)

    fun pending(c: Context, id: Long, kind: DeadlineKind, days: Int, flags: Int): PendingIntent? =
        PendingIntent.getBroadcast(c, code(id, kind, days), intent(c, id, kind, days), flags or PendingIntent.FLAG_IMMUTABLE)

    fun cancel(c: Context, id: Long) {
        val am = c.getSystemService(AlarmManager::class.java)
        for (k in DeadlineKind.entries) for (d in 0..MAX_DAYS) {
            pending(c, id, k, d, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
        }
    }

    /** 이 구매의 알림을 모두 지우고 현재 기한·상태대로 다시 건다 */
    fun schedule(c: Context, p: Purchase) {
        cancel(c, p.id)
        val am = c.getSystemService(AlarmManager::class.java)
        for (pl in plan(p, System.currentTimeMillis(), ZoneId.systemDefault())) {
            val pi = pending(c, p.id, pl.kind, pl.days, PendingIntent.FLAG_UPDATE_CURRENT) ?: continue
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, pl.at, pi)
        }
    }

    suspend fun rescheduleAll(c: Context) {
        AppDb.get(c).dao().allOnce().forEach { schedule(c, it) }
    }

    fun ensureChannel(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        val ch = NotificationChannel(CHANNEL, c.getString(R.string.notif_channel), NotificationManager.IMPORTANCE_DEFAULT)
        ch.lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        nm.createNotificationChannel(ch)
    }

    fun notificationsAllowed(c: Context) = NotificationManagerCompat.from(c).areNotificationsEnabled()

    fun kindLabel(c: Context, k: DeadlineKind) = c.getString(when (k) {
        DeadlineKind.RETURN -> R.string.deadline_return; DeadlineKind.EXCHANGE -> R.string.deadline_exchange; DeadlineKind.WARRANTY -> R.string.deadline_warranty })

    /** 알림 표시. 잠금화면에는 상품명·주문번호 없는 공개 버전만 보인다. 로그에 개인정보를 남기지 않는다. */
    fun post(c: Context, p: Purchase, kind: DeadlineKind, days: Int) {
        if (!notificationsAllowed(c)) return
        ensureChannel(c)
        val title = if (days == 0) c.getString(R.string.notif_today, kindLabel(c, kind))
                    else c.resources.getQuantityString(R.plurals.notif_days, days, kindLabel(c, kind), days)
        val open = PendingIntent.getActivity(c, code(p.id, kind, days),
            Intent(c, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_ID, p.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val pub = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(c.getString(R.string.notif_public_title)).setContentText(c.getString(R.string.notif_public_text)).build()
        val n = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title).setContentText(p.productName)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(pub)
            .setContentIntent(open).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_REMINDER).build()
        try { NotificationManagerCompat.from(c).notify(code(p.id, kind, days), n) } catch (e: SecurityException) { /* 권한 꺼짐 */ }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getLongExtra("id", -1); val days = i.getIntExtra("days", -1)
        val kind = runCatching { DeadlineKind.valueOf(i.getStringExtra("kind") ?: "") }.getOrNull() ?: return
        val pr = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val p = AppDb.get(c).dao().get(id) ?: return@launch
                // 지금도 유효한 알림인지 다시 확인(기한 수정·상태 변경·삭제 후 남은 알람 방지)
                val d = p.activeDeadlines().firstOrNull { it.first == kind }?.second ?: return@launch
                if (days !in p.daysList()) return@launch
                val at = Dates.reminderInstant(LocalDate.ofEpochDay(d), days, p.remindMinute, ZoneId.systemDefault())
                val now = System.currentTimeMillis()
                if (now - at > Reminders.LATE_LIMIT_MS || at - now > 60 * 60 * 1000) { Reminders.schedule(c, p); return@launch }
                Reminders.post(c, p, kind, days)
                android.util.Log.i("EUMPN", "reminder posted kind=${kind.name} days=$days")
            } finally { pr.finish() }
        }
    }
}

/** 재부팅·앱 업데이트·시간대/시각 변경 시 모든 알림을 현재 기기 현지 시간으로 다시 계산 */
class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val pr = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try { Reminders.rescheduleAll(c); android.util.Log.i("EUMPN", "rescheduled after ${i.action}") } finally { pr.finish() }
        }
    }
}
