package kr.eumsoft.securitypro.ui

import android.app.Application
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.securitypro.data.*
import kr.eumsoft.securitypro.engine.dns.EumVpnService
import kr.eumsoft.securitypro.engine.dns.FilterManager
import kr.eumsoft.securitypro.engine.dns.FilterParser
import kr.eumsoft.securitypro.engine.malware.ScanCoordinator
import kr.eumsoft.securitypro.engine.malware.ThreatIntel
import kr.eumsoft.securitypro.engine.malware.YaraEngine
import kr.eumsoft.securitypro.engine.update.UpdateManager
import kr.eumsoft.securitypro.work.Schedules
import javax.inject.Inject

private fun <T> Flow<T>.state(vm: ViewModel, init: T) = stateIn(vm.viewModelScope, SharingStarted.WhileSubscribed(5000), init)
private fun startOfToday(): Long { val c = java.util.Calendar.getInstance(); c.set(java.util.Calendar.HOUR_OF_DAY, 0); c.set(java.util.Calendar.MINUTE, 0); c.set(java.util.Calendar.SECOND, 0); c.set(java.util.Calendar.MILLISECOND, 0); return c.timeInMillis }

@HiltViewModel
class MainVm @Inject constructor(app: Application, private val settings: SettingsStore, private val db: AppDb,
                                 private val scans: ScanCoordinator, private val filters: FilterManager) : AndroidViewModel(app) {
    val s = settings.flow.state(this, AppSettings())
    val vpn = EumVpnService.state
    val vpnError = EumVpnService.lastError
    val blockedToday = db.dns().blockedSince(startOfToday()).state(this, 0)
    val dangerApps = db.scan().dangerAppsInLastScan().state(this, 0)
    val lastSession = db.scan().lastSession().state(this, null)
    val dbVersions = db.threat().versions().state(this, emptyList())
    val progress = scans.progress

    fun setVpn(on: Boolean) = viewModelScope.launch {
        settings.update { it.copy(vpnWanted = on) }
        if (on) EumVpnService.start(getApplication()) else EumVpnService.stop(getApplication())
        // 처음 켤 때 필터 목록이 아직 없으면 바로 내려받아 적용한다
        if (on && db.dns().sourcesNow().none { it.url.isNotBlank() && filters.hasFile(it.id) }) {
            filters.updateAll(); EumVpnService.reload(getApplication())
        }
    }
    fun onboardingDone() = viewModelScope.launch { settings.update { it.copy(onboardingDone = true) } }

    /** Android '개인 DNS(Private DNS)' 가 특정 서버로 지정되어 있으면 DNS 차단이 동작하지 않는다. */
    fun privateDnsStrict(): String? {
        val cm = getApplication<Application>().getSystemService(ConnectivityManager::class.java)
        return cm.allNetworks.mapNotNull { cm.getLinkProperties(it) }.firstOrNull { it.isPrivateDnsActive && it.privateDnsServerName != null }?.privateDnsServerName
    }
}

data class AppEntry(val pkg: String, val label: String, val system: Boolean)

@HiltViewModel
class AdBlockVm @Inject constructor(app: Application, private val settings: SettingsStore, private val db: AppDb,
                                    private val filters: FilterManager) : AndroidViewModel(app) {
    val s = settings.flow.state(this, AppSettings())
    val sources = db.dns().sources().state(this, emptyList())
    val recent = db.dns().recentBlocked().state(this, emptyList())
    val allowed = db.dns().allowed().state(this, emptyList())
    val blocked = db.dns().blocked().state(this, emptyList())
    val byCategory = db.dns().byCategory().state(this, emptyList())
    val total = db.dns().byCategory().map { l -> l.sumOf { it.n } }.state(this, 0)
    val today = db.dns().blockedSince(startOfToday()).state(this, 0)
    val hourly = db.dns().hourly(System.currentTimeMillis() - 24 * 3600_000L).state(this, emptyList())
    val updating = MutableStateFlow(false)
    val message = MutableStateFlow<String?>(null)
    val apps = MutableStateFlow<List<AppEntry>>(emptyList())

    private fun reload() = EumVpnService.reload(getApplication())

    fun setCategory(kind: String, on: Boolean) = viewModelScope.launch {
        settings.update { when (kind) { "AD" -> it.copy(adBlock = on); "TRACKING" -> it.copy(trackingBlock = on); else -> it.copy(phishingBlock = on) } }
        reload()
    }
    fun setSource(src: AdFilterSource, on: Boolean) = viewModelScope.launch {
        db.dns().updateSource(src.copy(enabled = on, updatedAt = System.currentTimeMillis()))
        if (on && !filters.hasFile(src.id) && src.url.isNotBlank()) filters.update(src.copy(enabled = true))
        reload()
    }
    fun updateFilters() = viewModelScope.launch {
        updating.value = true
        val (ok, fail) = filters.updateAll()
        updating.value = false
        message.value = "OK $ok / FAIL $fail"
        reload()
    }
    /** true: 추가됨, false: 잘못된 도메인 */
    fun allow(domain: String): Boolean {
        val d = FilterParser.normalizeDomain(domain) ?: return false
        viewModelScope.launch { db.dns().allow(AllowedDomain(domain = d)); db.dns().unblock(d); reload() }
        return true
    }
    fun unallow(d: String) = viewModelScope.launch { db.dns().unallow(d); reload() }
    fun block(domain: String): Boolean {
        val d = FilterParser.normalizeDomain(domain) ?: return false
        viewModelScope.launch { db.dns().block(BlockedDomain(domain = d)); db.dns().unallow(d); reload() }
        return true
    }
    fun unblock(d: String) = viewModelScope.launch { db.dns().unblock(d); reload() }
    fun pause(minutes: Int) = viewModelScope.launch {
        settings.update { it.copy(pausedUntil = if (minutes <= 0) 0 else System.currentTimeMillis() + minutes * 60_000L) }; reload()
    }
    fun setUpstream(u: String) = viewModelScope.launch { settings.update { it.copy(upstream = u.trim()) }; reload() }
    fun loadApps() = viewModelScope.launch {
        val pm = getApplication<Application>().packageManager
        apps.value = withContext(Dispatchers.IO) {
            pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .filter { it.packageName != getApplication<Application>().packageName && pm.getLaunchIntentForPackage(it.packageName) != null }
                .map { AppEntry(it.packageName, pm.getApplicationLabel(it).toString(), it.flags and ApplicationInfo.FLAG_SYSTEM != 0) }
                .sortedBy { it.label.lowercase() }
        }
    }
    fun setExcluded(pkg: String, excluded: Boolean) = viewModelScope.launch {
        settings.update { it.copy(excludedApps = if (excluded) it.excludedApps + pkg else it.excludedApps - pkg) }; reload()
    }
    fun clearLog() = viewModelScope.launch { db.dns().clearEvents() }
}

@HiltViewModel
class ScanVm @Inject constructor(app: Application, private val scans: ScanCoordinator, private val db: AppDb) : AndroidViewModel(app) {
    val progress = scans.progress
    val sessions = db.scan().sessions().state(this, emptyList())
    fun quick() = scans.startInstalled("QUICK")
    fun installed() = scans.startInstalled("INSTALLED")
    fun file(uri: Uri) = scans.startApkFile(uri)
    fun cancel() = scans.cancel()
    fun rescan(pkg: String) = scans.startInstalled("INSTALLED", pkg)
    fun results(sid: Long) = db.scan().results(sid)
    suspend fun session(id: Long) = db.scan().session(id)
    suspend fun result(id: Long) = db.scan().result(id)
    suspend fun findings(id: Long) = db.scan().findings(id)
}

@HiltViewModel
class DbVm @Inject constructor(app: Application, private val db: AppDb, private val updates: UpdateManager,
                               private val filters: FilterManager, private val intel: ThreatIntel) : AndroidViewModel(app) {
    val versions = db.threat().versions().state(this, emptyList())
    val hashCount = db.threat().hashCount().state(this, 0)
    val yaraCount = db.threat().ruleCount("YARA").state(this, 0)
    val patternCount = db.threat().ruleCount("PATTERN").state(this, 0)
    val sources = db.threat().sources().state(this, emptyList())
    val filterSources = db.dns().sources().state(this, emptyList())
    val history = db.dns().history().state(this, emptyList())
    val busy = MutableStateFlow(false)
    val message = MutableStateFlow<String?>(null)
    val yaraStatus = MutableStateFlow("")

    init { viewModelScope.launch { intel.yara(); yaraStatus.value = intel.yaraError?.let { "${YaraEngine.version} · $it" } ?: "${YaraEngine.version} · 규칙 ${intel.yaraRules}개 컴파일됨" } }

    fun updateNow() = viewModelScope.launch {
        busy.value = true
        val t = updates.updateRemote()
        val (ok, fail) = filters.updateAll()
        busy.value = false
        message.value = (t.getOrNull() ?: ("실패: " + t.exceptionOrNull()?.message)) + " · 필터 OK $ok / FAIL $fail"
        EumVpnService.reload(getApplication())
        intel.yara(); yaraStatus.value = intel.yaraError?.let { "${YaraEngine.version} · $it" } ?: "${YaraEngine.version} · 규칙 ${intel.yaraRules}개 컴파일됨"
    }
}

@HiltViewModel
class SettingsVm @Inject constructor(app: Application, private val settings: SettingsStore, private val db: AppDb) : AndroidViewModel(app) {
    val s = settings.flow.state(this, AppSettings())
    fun update(f: (AppSettings) -> AppSettings) = viewModelScope.launch {
        settings.update(f); Schedules.apply(getApplication(), settings.now().autoScan)
    }
    fun clearHistory() = viewModelScope.launch { db.scan().clearAll(); db.dns().clearEvents() }
}
