package kr.eumsoft.securitypro.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.eumsoft.securitypro.BuildConfig
import kr.eumsoft.securitypro.R

@Composable
fun DbScreen(vm: DbVm = hiltViewModel()) {
    val versions by vm.versions.collectAsStateWithLifecycle()
    val hashes by vm.hashCount.collectAsStateWithLifecycle()
    val yara by vm.yaraCount.collectAsStateWithLifecycle()
    val patterns by vm.patternCount.collectAsStateWithLifecycle()
    val sources by vm.sources.collectAsStateWithLifecycle()
    val filters by vm.filterSources.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val msg by vm.message.collectAsStateWithLifecycle()
    val yaraStatus by vm.yaraStatus.collectAsStateWithLifecycle()
    fun v(c: String) = versions.firstOrNull { it.component == c }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        BigButton(stringResource(if (busy) R.string.updating else R.string.db_update_now), { vm.updateNow() }, enabled = !busy)
        msg?.let { Text(it, Modifier.padding(8.dp)) }
        Section(stringResource(R.string.db_threat))
        InfoCard {
            KeyValue(stringResource(R.string.db_hash_version), v("HASHES")?.version?.toString() ?: "-")
            KeyValue(stringResource(R.string.db_hash_count), "%,d".format(hashes))
            KeyValue(stringResource(R.string.db_yara_version), v("YARA")?.version?.toString() ?: "-")
            KeyValue(stringResource(R.string.db_yara_count), "$yara")
            KeyValue(stringResource(R.string.db_yara_engine), yaraStatus)
            KeyValue(stringResource(R.string.db_pattern_count), "$patterns")
            KeyValue(stringResource(R.string.db_domains), "%,d".format(v("DOMAINS")?.itemCount ?: 0))
            KeyValue(stringResource(R.string.db_updated), fmtTime(v("HASHES")?.appliedAt))
        }
        Section(stringResource(R.string.db_sources))
        sources.forEach { s -> InfoCard {
            Text(s.name + if (s.isTestData) " · " + stringResource(R.string.db_test_data) else "", style = MaterialTheme.typography.titleMedium)
            KeyValue(stringResource(R.string.f_license), s.license); if (s.url.isNotBlank()) KeyValue(stringResource(R.string.f_source), s.url)
            KeyValue(stringResource(R.string.db_checked), fmtTime(s.lastCheckedAt))
        } }
        Section(stringResource(R.string.db_ad_filters))
        InfoCard { filters.forEach { f -> KeyValue(f.name, "%,d · %s · %s".format(f.ruleCount, fmtTime(f.lastUpdatedAt), f.lastResult ?: "-")) } }
        Section(stringResource(R.string.db_history))
        InfoCard { history.take(20).forEach { h -> KeyValue(fmtTime(h.time), "${h.target} · ${if (h.success) "OK" else "FAIL"} · ${h.message}") } }
    }
}

@Composable
fun SettingsScreen(openLicenses: () -> Unit, openPrivacy: () -> Unit, vm: SettingsVm = hiltViewModel()) {
    val s by vm.s.collectAsStateWithLifecycle()
    var confirmClear by remember { mutableStateOf(false) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        Section(stringResource(R.string.set_auto))
        InfoCard {
            SwitchRow(stringResource(R.string.set_auto_scan), stringResource(R.string.set_auto_scan_sub), s.autoScan, { v -> vm.update { it.copy(autoScan = v) } })
            SwitchRow(stringResource(R.string.set_auto_filter), stringResource(R.string.set_auto_filter_sub), s.autoFilterUpdate, { v -> vm.update { it.copy(autoFilterUpdate = v) } })
            SwitchRow(stringResource(R.string.set_noti), null, s.notifications, { v -> vm.update { it.copy(notifications = v) } })
        }
        Section(stringResource(R.string.set_theme))
        InfoCard { listOf("SYSTEM" to R.string.set_theme_system, "LIGHT" to R.string.set_theme_light, "DARK" to R.string.set_theme_dark).forEach { (k, l) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                RadioButton(s.theme == k, { vm.update { it.copy(theme = k) } }); Text(stringResource(l)) } } }
        Section(stringResource(R.string.set_language))
        InfoCard { listOf("" to R.string.set_lang_system, "ko" to R.string.lang_ko, "en" to R.string.lang_en, "ja" to R.string.lang_ja, "zh-CN" to R.string.lang_zh, "es" to R.string.lang_es).forEach { (tag, l) ->
            TextButton({ AppCompatDelegate.setApplicationLocales(if (tag.isEmpty()) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag)) }) { Text(stringResource(l)) } } }
        Section(stringResource(R.string.set_privacy))
        InfoCard {
            Text(stringResource(R.string.set_retention, s.logRetentionDays))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(7, 30, 90).forEach { d ->
                FilterChip(s.logRetentionDays == d, { vm.update { it.copy(logRetentionDays = d) } }, { Text(stringResource(R.string.set_days, d)) }) } }
            OutlinedButton({ confirmClear = true }, Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(stringResource(R.string.set_clear_history)) }
            TextButton(openPrivacy) { Text(stringResource(R.string.privacy_title)) }
        }
        Section(stringResource(R.string.set_about))
        InfoCard {
            KeyValue(stringResource(R.string.set_version), BuildConfig.VERSION_NAME)
            KeyValue(stringResource(R.string.set_contact), "pm999@naver.com")
            TextButton(openLicenses) { Text(stringResource(R.string.licenses)) }
        }
    }
    if (confirmClear) AlertDialog({ confirmClear = false },
        confirmButton = { TextButton({ vm.clearHistory(); confirmClear = false }) { Text(stringResource(R.string.delete)) } },
        dismissButton = { TextButton({ confirmClear = false }) { Text(stringResource(R.string.cancel)) } },
        text = { Text(stringResource(R.string.set_clear_confirm)) })
}

@Composable
fun LicensesScreen() = Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
    Text(stringResource(R.string.licenses), style = MaterialTheme.typography.headlineMedium)
    listOf(
        "AdGuard DnsLibs" to "Apache License 2.0 · https://github.com/AdguardTeam/DnsLibs (포함 의존성: libuv MIT, ldns BSD-3, BoringSSL OpenSSL/ISC, ngtcp2 MIT, libsodium ISC, libevent BSD-3, PCRE2 BSD-3, magic_enum MIT, ada Apache-2.0/MIT, klib MIT)",
        "YARA-X (VirusTotal)" to "BSD-3-Clause · https://github.com/VirusTotal/yara-x (wasmtime Apache-2.0 등 Rust 의존성)",
        "ed25519-dalek" to "BSD-3-Clause",
        "AndroidX · Jetpack Compose · Room · WorkManager · DataStore · Hilt(Dagger)" to "Apache License 2.0",
        "Kotlin · kotlinx.coroutines" to "Apache License 2.0",
        "AdGuard DNS filter / Disconnect Tracking" to "GPL-3.0 — 앱에 포함하지 않으며 사용자 기기가 원 출처에서 직접 내려받음",
        "StevenBlack hosts · Phishing.Database" to "MIT — 기기가 원 출처에서 직접 내려받음",
        "URLhaus · MalwareBazaar (abuse.ch)" to "CC0-1.0",
    ).forEach { (n, l) -> InfoCard { Text(n, style = MaterialTheme.typography.titleMedium); Text(l, style = MaterialTheme.typography.bodyMedium) } }
}

@Composable
fun PrivacyScreen() = Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
    Text(stringResource(R.string.privacy_title), style = MaterialTheme.typography.headlineMedium)
    Text(stringResource(R.string.privacy_body), style = MaterialTheme.typography.bodyLarge)
}

@Composable
fun Onboarding(done: () -> Unit) {
    var page by remember { mutableIntStateOf(0) }
    val pages = listOf(R.string.onb1_title to R.string.onb1_body, R.string.onb2_title to R.string.onb2_body, R.string.onb3_title to R.string.onb3_body)
    Scaffold { pad ->
        Column(Modifier.padding(pad).padding(24.dp).fillMaxSize().verticalScroll(rememberScrollState())) {
            Text("EUM SECURITY PRO", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(24.dp))
            Text(stringResource(pages[page].first), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(pages[page].second), style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(32.dp))
            if (page < pages.lastIndex) BigButton(stringResource(R.string.next), { page++ }) else BigButton(stringResource(R.string.onb_start), done)
        }
    }
}
