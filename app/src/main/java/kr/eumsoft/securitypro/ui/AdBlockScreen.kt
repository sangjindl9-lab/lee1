package kr.eumsoft.securitypro.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.eumsoft.securitypro.BuildConfig
import kr.eumsoft.securitypro.R
import kr.eumsoft.securitypro.data.AppSettings
import kr.eumsoft.securitypro.engine.dns.EumVpnService
import kr.eumsoft.securitypro.engine.dns.VpnState

@Composable
fun AdBlockScreen(main: MainVm, requestVpn: () -> Unit, openLicenses: () -> Unit, vm: AdBlockVm = hiltViewModel()) {
    var tab by remember { mutableIntStateOf(0) }
    val titles = listOf(R.string.ab_tab_status, R.string.ab_tab_filters, R.string.ab_tab_lists, R.string.ab_tab_apps, R.string.ab_tab_log, R.string.ab_tab_stats)
    Column(Modifier.fillMaxSize()) {
        ScrollableTabRow(tab, edgePadding = 8.dp) { titles.forEachIndexed { i, t -> Tab(tab == i, { tab = i }, text = { Text(stringResource(t)) }) } }
        when (tab) {
            0 -> StatusTab(main, vm, requestVpn)
            1 -> FiltersTab(vm, openLicenses)
            2 -> ListsTab(vm)
            3 -> AppsTab(vm)
            4 -> LogTab(vm)
            else -> StatsTab(vm)
        }
    }
}

@Composable
private fun StatusTab(main: MainVm, vm: AdBlockVm, requestVpn: () -> Unit) {
    val vpn by main.vpn.collectAsStateWithLifecycle()
    val err by main.vpnError.collectAsStateWithLifecycle()
    val net by EumVpnService.netState.collectAsStateWithLifecycle()
    val ms by EumVpnService.connectMs.collectAsStateWithLifecycle()
    val s by vm.s.collectAsStateWithLifecycle()
    val on = vpn == VpnState.ON || vpn == VpnState.PAUSED
    val privateDns = remember(vpn) { main.privateDnsStrict() }
    var upstream by remember(s.upstream) { mutableStateOf(s.upstream) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        if (privateDns != null) InfoCard { Text(stringResource(R.string.ab_private_dns_warn, privateDns), color = Caution, style = MaterialTheme.typography.bodyLarge) }
        InfoCard {
            SwitchRow(stringResource(R.string.adblock_switch), stringResource(when (vpn) {
                VpnState.ON -> R.string.vpn_on; VpnState.PAUSED -> R.string.vpn_paused; VpnState.CONNECTING -> R.string.vpn_connecting
                VpnState.ERROR -> R.string.vpn_error; else -> R.string.vpn_off }), on, { if (it) requestVpn() else main.setVpn(false) })
            if (vpn == VpnState.ERROR || err == "REVOKED") Text(if (err == "REVOKED") stringResource(R.string.vpn_revoked) else "${stringResource(R.string.vpn_error)}: $err", color = Danger)
            if (on) { KeyValue(stringResource(R.string.ab_network), net); KeyValue(stringResource(R.string.ab_connect_time), "$ms ms") }
        }
        Section(stringResource(R.string.ab_protection))
        InfoCard {
            if (BuildConfig.AD_BLOCK) {
                SwitchRow(stringResource(R.string.ab_ads), null, s.adBlock, { vm.setCategory("AD", it) })
                SwitchRow(stringResource(R.string.ab_tracking), null, s.trackingBlock, { vm.setCategory("TRACKING", it) })
            }
            SwitchRow(stringResource(R.string.ab_phishing), stringResource(R.string.ab_phishing_sub), s.phishingBlock, { vm.setCategory("PHISHING", it) })
        }
        Section(stringResource(R.string.ab_pause))
        InfoCard {
            if (s.pausedUntil > System.currentTimeMillis()) {
                Text(stringResource(R.string.ab_paused_until, fmtTime(s.pausedUntil)))
                OutlinedButton({ vm.pause(0) }, Modifier.fillMaxWidth()) { Text(stringResource(R.string.ab_resume)) }
            } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(5, 30, 60).forEach { m -> OutlinedButton({ vm.pause(m) }, Modifier.weight(1f).heightIn(min = 52.dp)) { Text(stringResource(R.string.ab_minutes, m)) } }
            }
        }
        Section(stringResource(R.string.ab_dns_server))
        InfoCard {
            AppSettings.UPSTREAM_PRESETS.forEach { u ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    RadioButton(s.upstream == u, { vm.setUpstream(u) })
                    Text(if (u == "SYSTEM") stringResource(R.string.ab_dns_system) else u, style = MaterialTheme.typography.bodyMedium)
                }
            }
            OutlinedTextField(upstream, { upstream = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.ab_dns_custom)) }, singleLine = true)
            TextButton({ vm.setUpstream(upstream) }) { Text(stringResource(R.string.save)) }
        }
        Section(stringResource(R.string.ab_limits))
        Text(stringResource(R.string.ab_limits_text), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun FiltersTab(vm: AdBlockVm, openLicenses: () -> Unit) {
    val sources by vm.sources.collectAsStateWithLifecycle()
    val updating by vm.updating.collectAsStateWithLifecycle()
    val msg by vm.message.collectAsStateWithLifecycle()
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            BigButton(stringResource(if (updating) R.string.updating else R.string.ab_update_filters), { vm.updateFilters() }, enabled = !updating)
            msg?.let { Text(it, Modifier.padding(8.dp)) }
        }
        items(sources, key = { it.id }) { f ->
            InfoCard {
                SwitchRow(f.name, null, f.enabled, { vm.setSource(f, it) }, enabled = f.url.isNotBlank())
                KeyValue(stringResource(R.string.f_category), f.category)
                if (f.url.isNotBlank()) KeyValue(stringResource(R.string.f_source), f.url)
                KeyValue(stringResource(R.string.f_license), f.license)
                KeyValue(stringResource(R.string.f_rules), "%,d".format(f.ruleCount))
                KeyValue(stringResource(R.string.f_updated), fmtTime(f.lastUpdatedAt))
                KeyValue(stringResource(R.string.f_result), f.lastResult ?: "-")
            }
        }
        item { TextButton(openLicenses) { Text(stringResource(R.string.licenses)) } }
    }
}

@Composable
private fun ListsTab(vm: AdBlockVm) {
    val allowed by vm.allowed.collectAsStateWithLifecycle()
    val blocked by vm.blocked.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(false) }
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item {
            OutlinedTextField(input, { input = it; error = false }, Modifier.fillMaxWidth().padding(top = 12.dp), label = { Text(stringResource(R.string.ab_domain_input)) },
                singleLine = true, isError = error, supportingText = { if (error) Text(stringResource(R.string.ab_domain_invalid)) })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({ if (vm.allow(input)) input = "" else error = true }, Modifier.weight(1f).heightIn(min = 52.dp)) { Text(stringResource(R.string.ab_allow)) }
                if (BuildConfig.AD_BLOCK) OutlinedButton({ if (vm.block(input)) input = "" else error = true }, Modifier.weight(1f).heightIn(min = 52.dp)) { Text(stringResource(R.string.ab_block)) }
            }
            Section(stringResource(R.string.ab_allowlist) + " (${allowed.size})")
            Text(stringResource(R.string.ab_allow_priority), style = MaterialTheme.typography.bodyMedium)
        }
        items(allowed, key = { "a" + it.domain }) { DomainRow(it.domain) { vm.unallow(it.domain) } }
        if (BuildConfig.AD_BLOCK) {
            item { Section(stringResource(R.string.ab_blocklist) + " (${blocked.size})") }
            items(blocked, key = { "b" + it.domain }) { DomainRow(it.domain) { vm.unblock(it.domain) } }
        }
    }
}

@Composable
private fun DomainRow(d: String, onDelete: () -> Unit) = Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
    Text(d, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
    val desc = stringResource(R.string.delete) + " $d"
    IconButton(onDelete, Modifier.semantics { contentDescription = desc }) { Icon(Icons.Filled.Delete, null) }
}

@Composable
private fun AppsTab(vm: AdBlockVm) {
    val apps by vm.apps.collectAsStateWithLifecycle()
    val s by vm.s.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadApps() }
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item { Text(stringResource(R.string.ab_apps_help), Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.bodyMedium) }
        if (apps.isEmpty()) item { CircularProgressIndicator(Modifier.padding(24.dp)) }
        items(apps, key = { it.pkg }) { a ->
            SwitchRow(a.label, a.pkg, a.pkg !in s.excludedApps, { vm.setExcluded(a.pkg, !it) })
        }
    }
}

@Composable
private fun LogTab(vm: AdBlockVm) {
    val recent by vm.recent.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item {
            Row { Text(stringResource(R.string.ab_log_help), Modifier.weight(1f).padding(vertical = 12.dp), style = MaterialTheme.typography.bodyMedium)
                TextButton({ vm.clearLog() }) { Text(stringResource(R.string.clear)) } }
            if (recent.isEmpty()) Text(stringResource(R.string.ab_log_empty), Modifier.padding(16.dp))
        }
        items(recent, key = { it.id }) { e ->
            InfoCard {
                Text(e.domain, style = MaterialTheme.typography.titleMedium)
                KeyValue(stringResource(R.string.f_time), fmtTime(e.time))
                KeyValue(stringResource(R.string.f_category), e.category)
                KeyValue(stringResource(R.string.f_rule), e.rule)
                KeyValue(stringResource(R.string.f_source), e.filterName ?: "-")
                OutlinedButton({ confirm = e.domain }, Modifier.fillMaxWidth()) { Text(stringResource(R.string.ab_allow_this)) }
            }
        }
    }
    confirm?.let { d ->
        AlertDialog({ confirm = null }, confirmButton = { TextButton({ vm.allow(d); confirm = null }) { Text(stringResource(R.string.ab_allow)) } },
            dismissButton = { TextButton({ confirm = null }) { Text(stringResource(R.string.cancel)) } },
            title = { Text(d) }, text = { Text(stringResource(R.string.ab_allow_confirm)) })
    }
}

@Composable
private fun StatsTab(vm: AdBlockVm) {
    val today by vm.today.collectAsStateWithLifecycle()
    val total by vm.total.collectAsStateWithLifecycle()
    val cats by vm.byCategory.collectAsStateWithLifecycle()
    val hourly by vm.hourly.collectAsStateWithLifecycle()
    val sources by vm.sources.collectAsStateWithLifecycle()
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        InfoCard {
            KeyValue(stringResource(R.string.st_today), "%,d".format(today))
            KeyValue(stringResource(R.string.st_total), "%,d".format(total))
            listOf("AD" to R.string.st_ad, "TRACKING" to R.string.st_tracking, "PHISHING" to R.string.st_phishing, "MALWARE" to R.string.st_malware, "CUSTOM" to R.string.st_custom)
                .filter { BuildConfig.AD_BLOCK || it.first == "PHISHING" || it.first == "MALWARE" }
                .forEach { (c, label) -> KeyValue(stringResource(label), "%,d".format(cats.firstOrNull { it.category == c }?.n ?: 0)) }
            KeyValue(stringResource(R.string.st_rules), "%,d".format(sources.filter { it.enabled }.sumOf { it.ruleCount }))
            Text(stringResource(R.string.home_blocked_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Section(stringResource(R.string.st_hourly))
        val max = (hourly.maxOfOrNull { it.n } ?: 0).coerceAtLeast(1)
        val desc = hourly.joinToString { "${java.text.SimpleDateFormat("HH").format(java.util.Date(it.hour))}시 ${it.n}" }
        val barColor = MaterialTheme.colorScheme.primary
        Canvas(Modifier.fillMaxWidth().height(160.dp).semantics { contentDescription = desc }) {
            val now = System.currentTimeMillis() / 3600_000L * 3600_000L
            val w = size.width / 24f
            for (i in 0 until 24) {
                val h = now - (23 - i) * 3600_000L
                val n = hourly.firstOrNull { it.hour == h }?.n ?: 0
                val bh = size.height * n / max
                drawRect(barColor, Offset(i * w + 2, size.height - bh), Size(w - 4, bh))
            }
        }
        Text(stringResource(R.string.st_hourly_axis), style = MaterialTheme.typography.bodyMedium)
    }
}
