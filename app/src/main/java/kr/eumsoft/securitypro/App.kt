package kr.eumsoft.securitypro

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.SettingsStore
import kr.eumsoft.securitypro.engine.dns.FilterManager
import kr.eumsoft.securitypro.engine.update.UpdateManager
import kr.eumsoft.securitypro.work.Schedules
import javax.inject.Inject

@HiltAndroidApp
class App : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var db: AppDb
    @Inject lateinit var updates: UpdateManager
    @Inject lateinit var filters: FilterManager
    @Inject lateinit var settings: SettingsStore

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            db.scan().failStale(System.currentTimeMillis())   // 앱이 강제 종료되어 끝나지 못한 검사 정리
            filters.ensureDefaults()
            updates.installBundledIfNeeded()
            Schedules.apply(this@App, settings.now().autoScan)
        }
    }
}
