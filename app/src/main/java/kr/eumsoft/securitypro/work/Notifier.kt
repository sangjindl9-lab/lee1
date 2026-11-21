package kr.eumsoft.securitypro.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.runBlocking
import kr.eumsoft.securitypro.R
import kr.eumsoft.securitypro.data.ScanSession
import kr.eumsoft.securitypro.data.SettingsStore
import kr.eumsoft.securitypro.ui.MainActivity
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class Notifier @Inject constructor(@ApplicationContext private val ctx: Context, private val settings: SettingsStore) {
    private fun allowed() = runBlocking { settings.now().notifications } &&
        (android.os.Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun scanFinished(s: ScanSession) {
        if (!allowed()) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("scan", ctx.getString(R.string.noti_channel_scan), NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel("danger", ctx.getString(R.string.noti_channel_danger), NotificationManager.IMPORTANCE_HIGH))
        val danger = s.dangerCount > 0
        val text = if (danger) ctx.getString(R.string.noti_danger_found, s.dangerCount) else ctx.getString(R.string.noti_scan_done, s.targetCount, s.cautionCount)
        val pi = PendingIntent.getActivity(ctx, 3, Intent(ctx, MainActivity::class.java).putExtra("session", s.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, if (danger) "danger" else "scan").setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(ctx.getString(if (danger) R.string.noti_title_danger else R.string.noti_title_done)).setContentText(text)
            .setContentIntent(pi).setAutoCancel(true).build()
        @Suppress("MissingPermission") NotificationManagerCompat.from(ctx).notify(if (danger) 21 else 20, n)
    }
}
