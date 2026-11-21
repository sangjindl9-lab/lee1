package kr.eumsoft.securitypro.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.eumsoft.securitypro.R
import kr.eumsoft.securitypro.data.ScanFinding
import kr.eumsoft.securitypro.data.ScanResult

@Composable
fun verdictLabel(v: String) = stringResource(when (v) {
    "DANGER" -> R.string.v_danger; "CAUTION" -> R.string.v_caution; "CLEAN" -> R.string.v_clean; else -> R.string.v_unscannable })
fun verdictColor(v: String): Color = when (v) { "DANGER" -> Danger; "CAUTION" -> Caution; "CLEAN" -> Safe; else -> Neutral }

@Composable
fun ScanScreen(vm: ScanVm = hiltViewModel(), openSession: (Long) -> Unit) {
    val p by vm.progress.collectAsStateWithLifecycle()
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    var lastRunning by remember { mutableStateOf(false) }
    LaunchedEffect(p.running) { if (lastRunning && !p.running && p.sessionId > 0) openSession(p.sessionId); lastRunning = p.running }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { u: Uri? -> if (u != null) vm.file(u) }
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item {
            Spacer(Modifier.height(12.dp))
            if (p.running) InfoCard {
                Text(stringResource(R.string.scan_running, p.done, p.total), style = MaterialTheme.typography.titleMedium)
                LinearProgressIndicator({ if (p.total == 0) 0f else p.done / p.total.toFloat() }, Modifier.fillMaxWidth().padding(vertical = 10.dp))
                Text(stringResource(R.string.scan_current, p.current), style = MaterialTheme.typography.bodyLarge)
                Text(stringResource(R.string.scan_found, p.danger, p.caution), style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(8.dp))
                OutlinedButton({ vm.cancel() }, Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(stringResource(R.string.scan_stop)) }
            } else {
                BigButton(stringResource(R.string.scan_quick), { vm.quick() })
                Text(stringResource(R.string.scan_quick_sub), Modifier.padding(4.dp, 2.dp, 4.dp, 12.dp), style = MaterialTheme.typography.bodyMedium)
                BigButton(stringResource(R.string.scan_installed), { vm.installed() })
                Text(stringResource(R.string.scan_installed_sub), Modifier.padding(4.dp, 2.dp, 4.dp, 12.dp), style = MaterialTheme.typography.bodyMedium)
                BigButton(stringResource(R.string.scan_file), { pick.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream", "application/zip")) })
                Text(stringResource(R.string.scan_file_sub), Modifier.padding(4.dp, 2.dp, 4.dp, 12.dp), style = MaterialTheme.typography.bodyMedium)
            }
            Section(stringResource(R.string.scan_history))
        }
        items(sessions, key = { it.id }) { s ->
            InfoCard(Modifier.clickable { openSession(s.id) }) {
                Text("${kindLabel(s.kind)} · ${fmtTime(s.startedAt)}", style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.scan_summary, s.targetCount, s.dangerCount, s.cautionCount, s.unscannableCount) + " · " + s.status,
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun kindLabel(k: String) = stringResource(when (k) {
    "QUICK" -> R.string.scan_quick; "INSTALLED" -> R.string.scan_installed; "APK_FILE" -> R.string.scan_file; else -> R.string.scan_scheduled })

@Composable
fun SessionScreen(id: Long, vm: ScanVm = hiltViewModel(), openResult: (Long) -> Unit) {
    val results by remember(id) { vm.results(id) }.collectAsStateWithLifecycle(emptyList())
    var session by remember { mutableStateOf<kr.eumsoft.securitypro.data.ScanSession?>(null) }
    LaunchedEffect(id) { session = vm.session(id) }
    var showClean by remember { mutableStateOf(false) }
    LazyColumn(Modifier.padding(horizontal = 16.dp)) {
        item {
            session?.let { s ->
                InfoCard {
                    Text(stringResource(R.string.res_summary), style = MaterialTheme.typography.titleLarge)
                    KeyValue(stringResource(R.string.res_time), fmtTime(s.startedAt))
                    KeyValue(stringResource(R.string.res_targets), "${s.targetCount}")
                    KeyValue(stringResource(R.string.v_danger), "${s.dangerCount}")
                    KeyValue(stringResource(R.string.v_caution), "${s.cautionCount}")
                    KeyValue(stringResource(R.string.v_unscannable), "${s.unscannableCount}")
                    KeyValue(stringResource(R.string.res_engines), s.engines.ifEmpty { "-" })
                    KeyValue(stringResource(R.string.res_rules), s.dbVersion)
                    KeyValue(stringResource(R.string.res_status), s.status)
                }
            }
            Text(stringResource(R.string.res_disclaimer), Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            SwitchRow(stringResource(R.string.res_show_clean), null, showClean, { showClean = it })
        }
        items(results.filter { showClean || it.verdict != "CLEAN" }, key = { it.id }) { r -> ResultRow(r) { openResult(r.id) } }
        if (results.isNotEmpty() && results.none { it.verdict != "CLEAN" }) item { Text(stringResource(R.string.res_all_clean), Modifier.padding(16.dp), style = MaterialTheme.typography.bodyLarge) }
    }
}

@Composable
private fun ResultRow(r: ScanResult, onClick: () -> Unit) = InfoCard(Modifier.clickable(onClick = onClick)) {
    Text(r.targetName, style = MaterialTheme.typography.titleMedium)
    Text(verdictLabel(r.verdict), color = verdictColor(r.verdict), style = MaterialTheme.typography.bodyLarge)
    r.packageName?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
}

@Composable
fun ResultScreen(id: Long, vm: ScanVm = hiltViewModel()) {
    var r by remember { mutableStateOf<ScanResult?>(null) }
    var f by remember { mutableStateOf<List<ScanFinding>>(emptyList()) }
    LaunchedEffect(id) { r = vm.result(id); f = vm.findings(id) }
    val ctx = LocalContext.current
    val res = r ?: return
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(res.targetName, style = MaterialTheme.typography.headlineMedium)
        Text(verdictLabel(res.verdict), color = verdictColor(res.verdict), style = MaterialTheme.typography.titleLarge)
        InfoCard {
            KeyValue(stringResource(R.string.res_target), res.packageName ?: res.targetName)
            KeyValue(stringResource(R.string.res_version), res.versionName ?: "-")
            KeyValue("SHA-256", res.sha256 ?: "-")
            KeyValue(stringResource(R.string.res_size), res.fileSize?.let { "%,d bytes".format(it) } ?: "-")
            KeyValue(stringResource(R.string.res_time), fmtTime(res.scannedAt))
            KeyValue(stringResource(R.string.res_engines), res.enginesRun.ifEmpty { "-" })
            KeyValue(stringResource(R.string.res_rules), res.ruleVersion)
        }
        Section(stringResource(R.string.res_findings) + " (${f.count { it.severity != "INFO" }})")
        if (f.isEmpty()) Text(stringResource(R.string.res_no_findings))
        f.sortedBy { listOf("HIGH", "MEDIUM", "LOW", "INFO").indexOf(it.severity) }.forEach { x ->
            InfoCard {
                Text(findingTitle(x.title), style = MaterialTheme.typography.titleMedium)
                KeyValue(stringResource(R.string.res_engine), x.engine)
                KeyValue(stringResource(R.string.res_severity), x.severity)
                KeyValue(stringResource(R.string.res_confirmed), stringResource(if (x.confirmed) R.string.res_confirmed_yes else R.string.res_confirmed_no))
                KeyValue(stringResource(R.string.res_evidence), x.evidence)
                KeyValue(stringResource(R.string.f_source), x.source)
            }
        }
        if (res.notScanned.isNotBlank()) { Section(stringResource(R.string.res_not_scanned)); Text(res.notScanned, style = MaterialTheme.typography.bodyMedium) }
        Section(stringResource(R.string.res_recommendation))
        Text(res.recommendation, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(12.dp))
        res.packageName?.takeIf { res.targetType == "INSTALLED_APP" }?.let { pkg ->
            BigButton(stringResource(R.string.res_app_info), { ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))) })
            Spacer(Modifier.height(8.dp))
            var started by remember { mutableStateOf(false) }
            OutlinedButton({ started = vm.rescan(pkg) }, Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(stringResource(if (started) R.string.res_rescan_started else R.string.res_rescan)) }
            Spacer(Modifier.height(8.dp))
            if (res.verdict == "DANGER" || res.verdict == "CAUTION")
                BigButton(stringResource(R.string.res_uninstall), { ctx.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))) }, color = Danger)
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton({
            val body = "Target: ${res.packageName ?: res.targetName}\nVersion: ${res.versionName}\nSHA-256: ${res.sha256}\nVerdict: ${res.verdict}\nRules: ${res.ruleVersion}\nFindings:\n" +
                f.joinToString("\n") { "- [${it.engine}] ${it.title}: ${it.evidence}" }
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:pm999@naver.com"))
                .putExtra(Intent.EXTRA_SUBJECT, "[EUM SECURITY PRO] 오탐 신고 / False positive").putExtra(Intent.EXTRA_TEXT, body), null))
        }, Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(stringResource(R.string.res_report_fp)) }
        Text(stringResource(R.string.res_report_fp_note), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun findingTitle(t: String): String = if (!t.startsWith("perm:")) t else stringResource(when (t.removePrefix("perm:")) {
    "combo_a11y_overlay" -> R.string.perm_a11y_overlay; "combo_a11y_install" -> R.string.perm_a11y_install
    "combo_sms_intercept" -> R.string.perm_sms_intercept; "combo_admin" -> R.string.perm_admin
    "combo_surveillance" -> R.string.perm_surveillance; "combo_sms_contacts" -> R.string.perm_sms_contacts
    else -> R.string.perm_list })
