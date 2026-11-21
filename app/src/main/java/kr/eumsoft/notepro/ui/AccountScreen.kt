package kr.eumsoft.notepro.ui

import android.net.Uri
import android.text.format.DateFormat
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.sync.ApiException
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.Executors

private val net = Executors.newSingleThreadExecutor { Thread(it, "notepro-account") }

/** 네트워크 작업은 별도 스레드에서, 결과는 메인 스레드로. */
fun <T> background(work: () -> T, done: (Result<T>) -> Unit) { net.execute { val r = runCatching(work); Io.main.post { done(r) } } }

/** 라이브러리 상단의 동기화 상태 아이콘 */
@Composable
fun SyncBadge(state: AppState) {
    val st by state.app.sync.status.collectAsState()
    val icon = when { !st.loggedIn -> Icons.Default.CloudOff; st.running || st.pending > 0 -> Icons.Default.CloudSync; else -> Icons.Default.Cloud }
    val desc = when {
        !st.loggedIn -> stringResource(R.string.sync_local_only)
        st.lastError != null -> stringResource(R.string.sync_error_short)
        st.pending > 0 -> LocalContext.current.getString(R.string.sync_pending_n, st.pending)
        else -> stringResource(R.string.sync_done_short)
    }
    IconButton({ state.screen = Screen.ACCOUNT }) {
        Icon(icon, desc, tint = if (st.lastError != null && st.loggedIn) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
}

fun errorText(ctx: android.content.Context, e: Throwable?): String = when ((e as? ApiException)?.code) {
    null -> if (e is java.io.IOException) ctx.getString(R.string.err_network) else (e?.message ?: "")
    "invalid_credentials" -> ctx.getString(R.string.err_credentials)
    "email_taken" -> ctx.getString(R.string.err_email_taken)
    "weak_password" -> ctx.getString(R.string.err_weak_password)
    "bad_email" -> ctx.getString(R.string.err_bad_email)
    "too_many_attempts" -> ctx.getString(R.string.err_too_many)
    "server_not_configured" -> ctx.getString(R.string.err_no_server)
    "quota_exceeded" -> ctx.getString(R.string.err_quota)
    "session_expired", "refresh_reused", "device_revoked", "not_logged_in" -> ctx.getString(R.string.err_relogin)
    else -> (e as ApiException).code
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(state: AppState, @Suppress("UNUSED_PARAMETER") activity: MainActivity, onBack: () -> Unit) {
    val app = state.app
    val ctx = LocalContext.current
    val sync = app.sync
    val st by sync.status.collectAsState()
    var email by remember { mutableStateOf(sync.tokens.email ?: "") }
    var password by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(sync.tokens.serverUrl) }
    var info by remember { mutableStateOf<String?>(null) }
    var devices by remember { mutableStateOf<JSONArray?>(null) }
    var currentDevice by remember { mutableStateOf("") }
    var backups by remember { mutableStateOf<JSONArray?>(null) }
    var askLink by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var backupPw by remember { mutableStateOf<((CharArray) -> Unit)?>(null) }
    var backupPwExport by remember { mutableStateOf(true) }
    var resetStage by remember { mutableStateOf(0) } // 0 없음, 1 코드 입력
    var resetCode by remember { mutableStateOf("") }

    fun loadDevices() = background({ sync.devices() }) { r -> r.onSuccess { devices = it.getJSONArray("devices"); currentDevice = it.optString("current") } }
    LaunchedEffect(st.loggedIn) { sync.refreshPending(); if (st.loggedIn) loadDevices() }

    fun afterLogin(r: Result<JSONObject>) {
        state.busy = null
        r.onFailure { info = errorText(ctx, it) }
        r.onSuccess { j ->
            password = ""
            val uid = j.optString("userId")
            val last = sync.tokens.lastLinkedUser
            if (last != null && last != uid) askLink = true
            else { sync.tokens.lastLinkedUser = uid; sync.requestSync { state.refreshLibrary() } }
            loadDevices()
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        background({ val b = sync.exportAccount(); ctx.contentResolver.openOutputStream(uri, "w")!!.use { it.write(b) } }) { r ->
            info = if (r.isSuccess) ctx.getString(R.string.export_done) else errorText(ctx, r.exceptionOrNull())
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(stringResource(R.string.account_sync)) }, navigationIcon = { IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } })
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!st.loggedIn) {
                Text(stringResource(R.string.account_intro), style = MaterialTheme.typography.bodyMedium)
                if (!sync.api.configured || server != sync.tokens.serverUrl) {
                    OutlinedTextField(server, { server = it }, label = { Text(stringResource(R.string.server_url)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    TextButton({ sync.tokens.serverUrl = server; info = ctx.getString(R.string.saved) }) { Text(stringResource(R.string.save)) }
                }
                OutlinedTextField(email, { email = it }, label = { Text(stringResource(R.string.email)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text(stringResource(R.string.password)) }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button({ state.busy = ctx.getString(R.string.please_wait); background({ sync.login(email.trim(), password, app.prefs.deviceId) }) { afterLogin(it) } },
                        enabled = email.isNotBlank() && password.isNotEmpty()) { Text(stringResource(R.string.login)) }
                    OutlinedButton({ state.busy = ctx.getString(R.string.please_wait); background({ sync.signup(email.trim(), password, app.prefs.deviceId, Locale.getDefault().language) }) { r ->
                        afterLogin(r); r.onSuccess { if (!it.optBoolean("verificationMailSent")) info = ctx.getString(R.string.verify_mail_not_sent) else info = ctx.getString(R.string.verify_mail_sent) }
                    } }, enabled = email.isNotBlank() && password.length >= 8) { Text(stringResource(R.string.signup)) }
                }
                Text(stringResource(R.string.password_rule), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton({ background({ sync.requestPasswordReset(email.trim()) }) { r -> if (r.isSuccess) { resetStage = 1; info = ctx.getString(R.string.reset_sent) } else info = errorText(ctx, r.exceptionOrNull()) } },
                    enabled = email.isNotBlank()) { Text(stringResource(R.string.forgot_password)) }
                if (resetStage == 1) {
                    OutlinedTextField(resetCode, { resetCode = it }, label = { Text(stringResource(R.string.reset_code)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button({ background({ sync.confirmPasswordReset(resetCode.trim(), password) }) { r -> if (r.isSuccess) { resetStage = 0; info = ctx.getString(R.string.reset_done) } else info = errorText(ctx, r.exceptionOrNull()) } },
                        enabled = resetCode.isNotBlank() && password.length >= 8) { Text(stringResource(R.string.reset_with_new_password)) }
                }
                HorizontalDivider()
                Text(stringResource(R.string.local_mode_notice), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(sync.tokens.email ?: "", style = MaterialTheme.typography.titleMedium)
                val last = if (st.lastSyncAt == 0L) "—" else DateFormat.getTimeFormat(ctx).format(st.lastSyncAt)
                Text(
                    when {
                        st.running -> stringResource(R.string.sync_running)
                        st.lastError != null -> stringResource(R.string.sync_error_detail, errorText(ctx, ApiException(0, st.lastError!!)))
                        st.pending > 0 -> ctx.getString(R.string.sync_pending_n, st.pending)
                        else -> ctx.getString(R.string.sync_ok_at, last)
                    },
                    color = if (st.lastError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,
                )
                Text(ctx.getString(R.string.sync_detail, st.pending, last), style = MaterialTheme.typography.bodySmall)
                if (st.conflicts > 0) Text(ctx.getString(R.string.sync_conflicts_n, st.conflicts), style = MaterialTheme.typography.bodySmall)
                Button({ sync.requestSync { state.refreshLibrary() } }, enabled = !st.running) { Text(stringResource(R.string.sync_now)) }

                HorizontalDivider()
                Text(stringResource(R.string.cloud_backup), style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton({
                        backupPwExport = true
                        backupPw = { pw ->
                            state.busy = ctx.getString(R.string.backup_creating)
                            background({
                                val f = File(ctx.cacheDir, "cloud.npbak")
                                Io.call { app.backup.export(Uri.fromFile(f), pw, false) }
                                sync.uploadBackup(f, "manual").also { f.delete() }
                            }) { r -> state.busy = null; info = if (r.isSuccess) ctx.getString(R.string.cloud_backup_done) else errorText(ctx, r.exceptionOrNull()); if (r.isSuccess) app.prefs.lastBackupAt = System.currentTimeMillis() }
                        }
                    }) { Text(stringResource(R.string.cloud_backup_upload)) }
                    OutlinedButton({ background({ sync.listBackups() }) { r -> r.onSuccess { backups = it }.onFailure { info = errorText(ctx, it) } } }) { Text(stringResource(R.string.cloud_backup_list)) }
                }
                backups?.let { list ->
                    if (list.length() == 0) Text(stringResource(R.string.no_cloud_backups))
                    for (i in 0 until list.length()) {
                        val b = list.getJSONObject(i)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(b.optString("created_at").take(16).replace('T', ' ') + " · " + Formatter.formatFileSize(ctx, b.optLong("size")) + " · " + b.optString("model"),
                                Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                            TextButton({
                                backupPwExport = false
                                backupPw = { pw ->
                                    state.busy = ctx.getString(R.string.backup_importing)
                                    background({
                                        val f = File(ctx.cacheDir, "restore.npbak")
                                        sync.downloadFile(b.getString("sha256"), f)
                                        Io.call { app.backup.import(Uri.fromFile(f), pw, " " + ctx.getString(R.string.restored_suffix)) }.also { f.delete() }
                                    }) { r ->
                                        state.busy = null
                                        info = r.fold({ ctx.getString(R.string.import_done, it.notebooks, it.attachments, Formatter.formatFileSize(ctx, it.bytes)) }, { e ->
                                            if (e is kr.eumsoft.notepro.core.BackupCrypto.WrongPasswordOrDamaged) ctx.getString(R.string.backup_wrong_password) else errorText(ctx, e)
                                        })
                                        state.refreshLibrary()
                                    }
                                }
                            }) { Text(stringResource(R.string.restore)) }
                        }
                    }
                }

                HorizontalDivider()
                Text(stringResource(R.string.devices), style = MaterialTheme.typography.titleSmall)
                devices?.let { list ->
                    for (i in 0 until list.length()) {
                        val d = list.getJSONObject(i)
                        val id = d.getString("id")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text((d.optString("model").ifBlank { d.optString("platform") }) + if (id == currentDevice) " · " + stringResource(R.string.this_device) else "")
                                Text(stringResource(R.string.last_seen) + " " + d.optString("last_seen_at").take(16).replace('T', ' '), style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (id != currentDevice) TextButton({ confirm = ctx.getString(R.string.revoke_device_confirm) to { background({ sync.revokeDevice(id) }) { loadDevices() } } }) {
                                Text(stringResource(R.string.revoke))
                            }
                        }
                    }
                }

                HorizontalDivider()
                OutlinedButton({ exportLauncher.launch("notepro-account-export.json") }) { Text(stringResource(R.string.export_my_data)) }
                OutlinedButton({
                    val doLogout = { background({ sync.logout() }) { devices = null } }
                    if (st.pending > 0) confirm = ctx.getString(R.string.logout_pending_warning, st.pending) to { doLogout() } else doLogout()
                }) { Text(stringResource(R.string.logout)) }
                TextButton({ confirm = ctx.getString(R.string.delete_account_confirm) to { background({ sync.deleteAccount() }) { r -> info = if (r.isSuccess) ctx.getString(R.string.account_deleted) else errorText(ctx, r.exceptionOrNull()) } } }) {
                    Text(stringResource(R.string.delete_account), color = MaterialTheme.colorScheme.error)
                }
                Text(stringResource(R.string.logout_keeps_notes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (askLink) AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.link_title)) },
        text = { Text(stringResource(R.string.link_body)) },
        confirmButton = { TextButton({
            askLink = false; sync.tokens.lastLinkedUser = sync.tokens.userId
            background({ sync.linkAllLocalNotes() }) { sync.requestSync { state.refreshLibrary() } }
        }) { Text(stringResource(R.string.link_upload)) } },
        dismissButton = { TextButton({
            askLink = false; sync.tokens.lastLinkedUser = sync.tokens.userId
            background({ sync.keepLocalOnly() }) { sync.requestSync { state.refreshLibrary() } }
        }) { Text(stringResource(R.string.link_keep_local)) } },
    )
    backupPw?.let { action ->
        BackupPasswordDialog(isExport = backupPwExport, onDismiss = { backupPw = null }) { pw, _ -> backupPw = null; action(pw) }
    }
    confirm?.let { (m, a) -> ConfirmDialog(m, { confirm = null }) { confirm = null; a() } }
    info?.let { InfoDialog(it) { info = null } }
}
