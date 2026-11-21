package kr.eumsoft.securitypro.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.store by preferencesDataStore("settings")

data class AppSettings(
    val adBlock: Boolean = true,
    val trackingBlock: Boolean = true,
    val phishingBlock: Boolean = true,
    /** 사용자가 마지막으로 VPN 을 켜 둔 상태인지 (사용자가 끈 VPN 은 다시 켜지 않는다) */
    val vpnWanted: Boolean = false,
    val pausedUntil: Long = 0,
    /** SYSTEM 또는 사용자 지정 업스트림 주소 (예: https://dns.adguard-dns.com/dns-query, tls://1.1.1.1) */
    val upstream: String = DEFAULT_UPSTREAM,
    val excludedApps: Set<String> = emptySet(),
    val autoFilterUpdate: Boolean = true,
    val autoScan: Boolean = false,
    val notifications: Boolean = true,
    val theme: String = "SYSTEM",   // SYSTEM / LIGHT / DARK
    val logRetentionDays: Int = 30,
    val onboardingDone: Boolean = false,
    val serverAnalysisConsent: Boolean = false,
    val lastScanAt: Long = 0,
) {
    companion object {
        // 필터링하지 않는 업스트림을 기본으로 한다 (허용 목록이 업스트림 쪽 차단에 막히지 않도록)
        const val DEFAULT_UPSTREAM = "https://unfiltered.adguard-dns.com/dns-query"
        val UPSTREAM_PRESETS = listOf(
            DEFAULT_UPSTREAM,
            "tls://unfiltered.adguard-dns.com",
            "https://cloudflare-dns.com/dns-query",
            "tls://1.1.1.1",
            "https://dns.google/dns-query",
            "8.8.8.8",
            "SYSTEM",
        )
    }
}

@Singleton
class SettingsStore @Inject constructor(@ApplicationContext private val ctx: Context) {
    private object K {
        val ad = booleanPreferencesKey("ad"); val tr = booleanPreferencesKey("tracking"); val ph = booleanPreferencesKey("phishing")
        val vpn = booleanPreferencesKey("vpnWanted"); val pause = longPreferencesKey("pausedUntil")
        val up = stringPreferencesKey("upstream"); val ex = stringSetPreferencesKey("excludedApps")
        val afu = booleanPreferencesKey("autoFilterUpdate"); val as_ = booleanPreferencesKey("autoScan")
        val noti = booleanPreferencesKey("notifications"); val theme = stringPreferencesKey("theme")
        val ret = intPreferencesKey("logRetentionDays"); val onb = booleanPreferencesKey("onboardingDone")
        val srv = booleanPreferencesKey("serverConsent"); val last = longPreferencesKey("lastScanAt")
    }

    val flow: Flow<AppSettings> = ctx.store.data.map { p -> p.toSettings() }
    suspend fun now(): AppSettings = flow.first()

    private fun Preferences.toSettings() = AppSettings(
        adBlock = this[K.ad] ?: true, trackingBlock = this[K.tr] ?: true, phishingBlock = this[K.ph] ?: true,
        vpnWanted = this[K.vpn] ?: false, pausedUntil = this[K.pause] ?: 0,
        upstream = this[K.up] ?: AppSettings.DEFAULT_UPSTREAM, excludedApps = this[K.ex] ?: emptySet(),
        autoFilterUpdate = this[K.afu] ?: true, autoScan = this[K.as_] ?: false,
        notifications = this[K.noti] ?: true, theme = this[K.theme] ?: "SYSTEM",
        logRetentionDays = this[K.ret] ?: 30, onboardingDone = this[K.onb] ?: false,
        serverAnalysisConsent = this[K.srv] ?: false, lastScanAt = this[K.last] ?: 0,
    )

    suspend fun update(f: (AppSettings) -> AppSettings) {
        ctx.store.edit { p ->
            val s = f(p.toSettings())
            p[K.ad] = s.adBlock; p[K.tr] = s.trackingBlock; p[K.ph] = s.phishingBlock
            p[K.vpn] = s.vpnWanted; p[K.pause] = s.pausedUntil; p[K.up] = s.upstream; p[K.ex] = s.excludedApps
            p[K.afu] = s.autoFilterUpdate; p[K.as_] = s.autoScan; p[K.noti] = s.notifications; p[K.theme] = s.theme
            p[K.ret] = s.logRetentionDays; p[K.onb] = s.onboardingDone; p[K.srv] = s.serverAnalysisConsent
            p[K.last] = s.lastScanAt
        }
    }
}
