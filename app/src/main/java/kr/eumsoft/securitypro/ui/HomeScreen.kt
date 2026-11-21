package kr.eumsoft.securitypro.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.eumsoft.securitypro.R
import kr.eumsoft.securitypro.engine.dns.VpnState
import java.text.DateFormat
import java.util.Date

fun fmtTime(t: Long?): String = if (t == null || t <= 0) "-" else DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))

@Composable
fun HomeScreen(vm: MainVm, requestVpn: () -> Unit, goScan: () -> Unit, goDb: () -> Unit, openSession: (Long) -> Unit) {
    val vpn by vm.vpn.collectAsStateWithLifecycle()
    val today by vm.blockedToday.collectAsStateWithLifecycle()
    val danger by vm.dangerApps.collectAsStateWithLifecycle()
    val last by vm.lastSession.collectAsStateWithLifecycle()
    val versions by vm.dbVersions.collectAsStateWithLifecycle()
    val p by vm.progress.collectAsStateWithLifecycle()
    val on = vpn == VpnState.ON || vpn == VpnState.PAUSED
    val (statusText, color) = when {
        danger > 0 -> stringResource(R.string.home_status_danger, danger) to Danger
        !on -> stringResource(R.string.home_status_vpn_off) to Caution
        last == null -> stringResource(R.string.home_status_never_scanned) to Caution
        else -> stringResource(R.string.home_status_ok) to Safe
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Shield, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(40.dp))
            Spacer(Modifier.width(10.dp))
            Text("EUM SECURITY PRO", style = MaterialTheme.typography.headlineMedium)
        }
        Spacer(Modifier.height(12.dp))
        Card(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = statusText },
            colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.14f))) {
            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (color == Safe) Icons.Filled.VerifiedUser else Icons.Filled.Warning, null, tint = color, modifier = Modifier.size(44.dp))
                Spacer(Modifier.width(14.dp))
                Text(statusText, style = MaterialTheme.typography.titleLarge)
            }
        }
        Section(stringResource(R.string.home_adblock))
        InfoCard {
            SwitchRow(stringResource(R.string.adblock_switch), stringResource(when (vpn) {
                VpnState.ON -> R.string.vpn_on; VpnState.PAUSED -> R.string.vpn_paused; VpnState.CONNECTING -> R.string.vpn_connecting
                VpnState.ERROR -> R.string.vpn_error; else -> R.string.vpn_off }), on, { if (it) requestVpn() else vm.setVpn(false) })
            KeyValue(stringResource(R.string.home_blocked_today), "$today")
            Text(stringResource(R.string.home_blocked_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Section(stringResource(R.string.home_malware))
        InfoCard {
            if (p.running) {
                Text(stringResource(R.string.scan_running, p.done, p.total), style = MaterialTheme.typography.bodyLarge)
                LinearProgressIndicator({ if (p.total == 0) 0f else p.done / p.total.toFloat() }, Modifier.fillMaxWidth().padding(vertical = 8.dp))
            } else BigButton(stringResource(R.string.home_scan_now), goScan)
            Spacer(Modifier.height(8.dp))
            KeyValue(stringResource(R.string.home_last_scan), fmtTime(last?.finishedAt))
            KeyValue(stringResource(R.string.home_danger_apps), "$danger")
            last?.let { TextButton({ openSession(it.id) }) { Text(stringResource(R.string.home_view_last)) } }
        }
        Section(stringResource(R.string.home_db))
        InfoCard {
            val hv = versions.firstOrNull { it.component == "HASHES" }
            KeyValue(stringResource(R.string.db_threat_version), hv?.version?.toString() ?: stringResource(R.string.db_none))
            KeyValue(stringResource(R.string.db_updated), fmtTime(hv?.appliedAt))
            TextButton(goDb) { Text(stringResource(R.string.home_open_db)) }
        }
    }
}
