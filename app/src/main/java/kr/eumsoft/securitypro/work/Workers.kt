package kr.eumsoft.securitypro.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.SettingsStore
import kr.eumsoft.securitypro.engine.dns.EumVpnService
import kr.eumsoft.securitypro.engine.dns.FilterManager
import kr.eumsoft.securitypro.engine.malware.ScanCoordinator
import kr.eumsoft.securitypro.engine.update.UpdateManager
import java.util.concurrent.TimeUnit

/** 하루 1회: 광고 필터·위협 DB 를 각각 독립적으로 업데이트하고 오래된 기록을 지운다. */
@HiltWorker
class UpdateWorker @AssistedInject constructor(
    @Assisted ctx: Context, @Assisted p: WorkerParameters,
    private val filters: FilterManager, private val updates: UpdateManager, private val settings: SettingsStore, private val db: AppDb,
) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        val s = settings.now()
        val threat = updates.updateRemote()
        val (ok, fail) = if (s.autoFilterUpdate) filters.updateAll() else 0 to 0
        if (ok > 0 || threat.getOrNull()?.contains("적용") == true) EumVpnService.reload(applicationContext)
        val cutoff = System.currentTimeMillis() - s.logRetentionDays * 86_400_000L
        db.dns().deleteEventsOlderThan(cutoff); db.scan().deleteOlderThan(cutoff)
        return if (threat.isFailure && fail > 0 && runAttemptCount < 3) Result.retry() else Result.success()
    }
}

@HiltWorker
class ScanWorker @AssistedInject constructor(
    @Assisted ctx: Context, @Assisted p: WorkerParameters, private val scans: ScanCoordinator,
) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result { scans.runInstalledBlocking("SCHEDULED"); return Result.success() }
}

object Schedules {
    fun apply(ctx: Context, autoScan: Boolean) {
        val wm = WorkManager.getInstance(ctx)
        wm.enqueueUniquePeriodicWork("daily-update", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<UpdateWorker>(1, TimeUnit.DAYS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build()).build())
        if (autoScan) wm.enqueueUniquePeriodicWork("weekly-scan", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ScanWorker>(7, TimeUnit.DAYS)
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).setRequiresDeviceIdle(true).build()).build())
        else wm.cancelUniqueWork("weekly-scan")
    }
}
