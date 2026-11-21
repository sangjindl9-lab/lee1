package kr.eumsoft.purchasenote.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.BuildConfig
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.backup.BackupFormat
import kr.eumsoft.purchasenote.backup.BackupManager
import kr.eumsoft.purchasenote.data.Prefs
import kr.eumsoft.purchasenote.data.Repo
import java.time.LocalDate

const val SITE = "https://eum-purchase-note.up.railway.app"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(nav: Nav) {
    val c = LocalContext.current
    val prefs = remember { Prefs.get(c) }
    val simple by prefs.simple.collectAsState()
    val large by prefs.large.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val notifOk = rememberNotificationsAllowed()
    val enableNotif = rememberEnableNotifications()
    var days by remember { mutableStateOf(prefs.defaultDays.split(',').mapNotNull { it.toIntOrNull() }.toSet()) }
    var minute by remember { mutableStateOf(prefs.defaultMinute) }
    var timeOpen by remember { mutableStateOf(false) }
    var askDeleteAll by remember { mutableStateOf(false) }
    var pwFor by remember { mutableStateOf<String?>(null) } // "export" | "restore"
    var exportPw by remember { mutableStateOf<CharArray?>(null) }
    var restoreUri by remember { mutableStateOf<Uri?>(null) }
    var preview by remember { mutableStateOf<BackupManager.Preview?>(null) }
    var busy by remember { mutableStateOf(false) }
    val bm = remember { BackupManager(c) }
    val curLang = AppCompatDelegate.getApplicationLocales().toLanguageTags().substringBefore('-').ifEmpty { "" }

    val createDoc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val pw = exportPw; exportPw = null
        if (uri == null || pw == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            val ok = runCatching { withContext(Dispatchers.IO) { bm.export(uri, pw) } }.isSuccess
            pw.fill(' '); busy = false
            snack.showSnackbar(c.getString(if (ok) R.string.backup_done else R.string.backup_failed))
        }
    }
    val openDoc = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { restoreUri = uri; pwFor = "restore" }
    }

    Scaffold(topBar = { BackBar(stringResource(R.string.settings), onBack = { nav.back() }) }, snackbarHost = { SnackbarHost(snack) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            SectionTitle(stringResource(R.string.set_language))
            Text(stringResource(R.string.set_language_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            listOf("" to stringResource(R.string.lang_system), "ko" to "한국어", "en" to "English", "ja" to "日本語", "es" to "Español").forEach { (tag, name) ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = curLang == tag, role = Role.RadioButton, onClick = {
                    AppCompatDelegate.setApplicationLocales(if (tag.isEmpty()) LocaleListCompat.getEmptyLocaleList() else LocaleListCompat.forLanguageTags(tag))
                }), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = curLang == tag, onClick = null); Spacer(Modifier.width(12.dp)); Text(name, style = MaterialTheme.typography.bodyLarge)
                }
            }

            SectionTitle(stringResource(R.string.set_display))
            SwitchRow(stringResource(R.string.set_simple), stringResource(R.string.set_simple_note), simple) { prefs.setSimple(it) }
            SwitchRow(stringResource(R.string.set_large), stringResource(R.string.set_large_note), large) { prefs.setLarge(it) }

            SectionTitle(stringResource(R.string.set_reminders))
            Text(stringResource(R.string.set_reminders_note), style = MaterialTheme.typography.bodyMedium)
            ReminderChips(days) { days = it; prefs.defaultDays = it.sortedDescending().joinToString(",") }
            OutlinedButton(onClick = { timeOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Filled.Schedule, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.remind_time, fmtTime(minute)))
            }
            Spacer(Modifier.height(8.dp))
            Text(stringResource(if (notifOk) R.string.notif_state_on else R.string.notif_off_info), style = MaterialTheme.typography.bodyMedium)
            if (!notifOk) OutlinedButton(onClick = enableNotif, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Filled.Notifications, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.notif_turn_on))
            }
            Text(stringResource(R.string.battery_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))

            SectionTitle(stringResource(R.string.set_privacy))
            Text(stringResource(R.string.privacy_summary), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = {
                val lang = c.resources.configuration.locales[0].language.let { if (it in setOf("ko", "ja", "es")) it else "en" }
                runCatching { c.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$SITE/$lang/privacy.html")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.privacy_full)) }

            SectionTitle(stringResource(R.string.set_backup))
            Text(stringResource(R.string.backup_note), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { pwFor = "export" }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Backup, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.backup_make))
                }
                OutlinedButton(onClick = { openDoc.launch(arrayOf("*/*")) }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Restore, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.backup_restore))
                }
            }

            SectionTitle(stringResource(R.string.set_data))
            Text(stringResource(R.string.uninstall_note), style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = { askDeleteAll = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 8.dp)) {
                Icon(Icons.Filled.DeleteForever, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.delete_all))
            }

            SectionTitle(stringResource(R.string.set_help))
            TextButton(onClick = { nav.go(Screen.Onboarding) }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Filled.ViewAgenda, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.show_guide)) }
            Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 16.dp))
        }
    }

    if (timeOpen) {
        val st = rememberTimePickerState(minute / 60, minute % 60)
        AlertDialog(onDismissRequest = { timeOpen = false }, title = { Text(stringResource(R.string.pick_time)) }, text = { TimePicker(st) },
            confirmButton = { TextButton(onClick = { minute = st.hour * 60 + st.minute; prefs.defaultMinute = minute; timeOpen = false }) { Text(stringResource(R.string.ok)) } },
            dismissButton = { TextButton(onClick = { timeOpen = false }) { Text(stringResource(R.string.cancel)) } })
    }
    if (askDeleteAll) ConfirmDialog(stringResource(R.string.delete_all), stringResource(R.string.delete_all_text), stringResource(R.string.delete_all),
        onConfirm = { scope.launch { withContext(Dispatchers.IO) { Repo(c).deleteAll() }; snack.showSnackbar(c.getString(R.string.deleted_all)) } }, onDismiss = { askDeleteAll = false })

    pwFor?.let { mode ->
        PasswordDialog(confirm = mode == "export", onDismiss = { pwFor = null; restoreUri = null }) { pw ->
            pwFor = null
            if (mode == "export") { exportPw = pw; createDoc.launch("eum-purchase-note-${LocalDate.now()}.eumbak") }
            else restoreUri?.let { u ->
                busy = true
                scope.launch {
                    val r = runCatching { withContext(Dispatchers.IO) { bm.preview(u, pw) } }
                    pw.fill(' '); busy = false
                    r.onSuccess { preview = it }.onFailure { e ->
                        snack.showSnackbar(c.getString(if (e is BackupFormat.WrongPassword) R.string.restore_wrong_pw else R.string.restore_corrupt))
                    }
                }
            }
        }
    }
    preview?.let { pv ->
        ConfirmDialog(stringResource(R.string.restore_confirm_title),
            stringResource(R.string.restore_confirm_text, pv.purchases, pv.images, pv.currentPurchases),
            stringResource(R.string.restore_do),
            onConfirm = {
                busy = true
                scope.launch {
                    val ok = runCatching { withContext(Dispatchers.IO) { bm.apply(pv.payload) } }.isSuccess
                    busy = false
                    snack.showSnackbar(c.getString(if (ok) R.string.restore_done else R.string.restore_failed))
                }
            }, onDismiss = { preview = null })
    }
}

@Composable
private fun SwitchRow(title: String, note: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(value, role = Role.Switch, onValueChange = onChange).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = value, onCheckedChange = null)
    }
}

@Composable
private fun PasswordDialog(confirm: Boolean, onDismiss: () -> Unit, onOk: (CharArray) -> Unit) {
    var a by remember { mutableStateOf("") }; var b by remember { mutableStateOf("") }
    val tooShort = a.length < 6
    val mismatch = confirm && a != b
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(stringResource(if (confirm) R.string.pw_set_title else R.string.pw_enter_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (confirm) Text(stringResource(R.string.pw_warning), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(a, { a = it }, label = { Text(stringResource(R.string.pw)) }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    supportingText = { if (confirm && tooShort) Text(stringResource(R.string.pw_min)) })
                if (confirm) OutlinedTextField(b, { b = it }, label = { Text(stringResource(R.string.pw_again)) }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    isError = b.isNotEmpty() && mismatch, supportingText = { if (b.isNotEmpty() && mismatch) Text(stringResource(R.string.pw_mismatch)) })
            }
        },
        confirmButton = { TextButton(enabled = if (confirm) !tooShort && !mismatch else a.isNotEmpty(), onClick = { onOk(a.toCharArray()); a = ""; b = "" }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}
