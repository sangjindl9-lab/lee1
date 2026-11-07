package kr.eumsoft.quick.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.TileService
import android.widget.Toast
import kr.eumsoft.quick.R
import kr.eumsoft.quick.ui.MainActivity

/** 상시 알림: 도우미 상태 표시 + 캡처 / 일시정지·재개 버튼 */
object Notifier {
    private const val CH = "helper"
    private const val ID = 7
    const val ACT_CAPTURE = "kr.eumsoft.quick.CAPTURE"
    const val ACT_TOGGLE = "kr.eumsoft.quick.TOGGLE_PAUSE"

    fun show(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH, "도우미 상태", NotificationManager.IMPORTANCE_LOW).apply {
            description = "이음 퀵도우미 실행 상태와 캡처·일시정지 버튼"
            setShowBadge(false)
        })
        val paused = kr.eumsoft.quick.core.Prefs(ctx).paused
        fun pi(action: String, code: Int) = PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, ActionReceiver::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val icon = Icon.createWithResource(ctx, R.drawable.ic_tile)
        val b = Notification.Builder(ctx, CH)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(if (paused) "이음 퀵도우미 일시정지됨" else "이음 퀵도우미 실행 중")
            .setContentText(if (paused) "재개를 누르면 도우미가 다시 표시됩니다" else "도우미 버튼: 한 번 메뉴 · 세 번 캡처")
            .setOngoing(true)
            .setContentIntent(open)
        if (!paused) b.addAction(Notification.Action.Builder(icon, "캡처", pi(ACT_CAPTURE, 1)).build())
        b.addAction(Notification.Action.Builder(icon, if (paused) "재개" else "일시정지", pi(ACT_TOGGLE, 2)).build())
        try { nm.notify(ID, b.build()) } catch (_: SecurityException) {}
    }

    fun cancel(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).cancel(ID)
}

class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val svc = HelperService.instance
        if (svc == null || !svc.ready) {
            Toast.makeText(ctx, "접근성 서비스가 꺼져 있습니다. 앱에서 도우미를 켜 주세요.", Toast.LENGTH_LONG).show()
            return
        }
        when (intent.action) {
            Notifier.ACT_CAPTURE -> svc.capture.request(fromShade = true)
            Notifier.ACT_TOGGLE -> svc.setPaused(!svc.prefs.paused)
        }
    }
}

/** 빠른 설정 타일: 누르면 알림창을 닫고 캡처 */
class QuickTile : TileService() {
    override fun onClick() {
        val svc = HelperService.instance
        if (svc == null || !svc.ready) {
            val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE))
            } else {
                @Suppress("DEPRECATION") startActivityAndCollapse(i)
            }
            return
        }
        svc.capture.request(fromShade = true)
    }
}
