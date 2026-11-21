package kr.eumsoft.purchasenote.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TextIncrease
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.core.Dates
import kr.eumsoft.purchasenote.data.AppDb
import kr.eumsoft.purchasenote.data.Prefs
import kr.eumsoft.purchasenote.reminder.Reminders
import java.time.LocalDate

@Composable
fun rememberNotificationsAllowed(): Boolean {
    val c = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var allowed by remember { mutableStateOf(Reminders.notificationsAllowed(c)) }
    LaunchedEffect(owner) { owner.repeatOnLifecycle(Lifecycle.State.RESUMED) { allowed = Reminders.notificationsAllowed(c) } }
    return allowed
}

/** 알림 켜기: Android 13+ 첫 요청은 권한 창, 이미 거부했으면 앱 알림 설정 화면 */
@Composable
fun rememberEnableNotifications(): () -> Unit {
    val c = LocalContext.current
    val prefs = remember { Prefs.get(c) }
    val l = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    return {
        if (Build.VERSION.SDK_INT >= 33 && !prefs.askedNotification) { prefs.askedNotification = true; l.launch(Manifest.permission.POST_NOTIFICATIONS) }
        else c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@Composable
fun HomeScreen(nav: Nav) {
    val c = LocalContext.current
    val prefs = remember { Prefs.get(c) }
    val simple by prefs.simple.collectAsState()
    val large by prefs.large.collectAsState()
    val all by remember { AppDb.get(c).dao().all() }.collectAsState(initial = null)
    val today = LocalDate.now()
    val notifOk = rememberNotificationsAllowed()
    val enableNotif = rememberEnableNotifications()

    Scaffold(
        topBar = {
            Column {
                BackBar(stringResource(R.string.app_name), onBack = null) {
                    if (!simple) IconButton(onClick = { nav.go(Screen.Search()) }) { Icon(Icons.Filled.Search, stringResource(R.string.search)) }
                    IconButton(onClick = { nav.go(Screen.Settings) }) { Icon(Icons.Filled.Settings, stringResource(R.string.settings)) }
                }
                // 누구나 바로 켤 수 있는 큰 글씨·간편 보기 (나이를 묻지 않음)
                TextButton(onClick = { val v = !(simple && large); prefs.setSimple(v); prefs.setLarge(v) }, modifier = Modifier.padding(start = 8.dp).heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.TextIncrease, null); Spacer(Modifier.width(6.dp))
                    Text(stringResource(if (simple && large) R.string.easy_off else R.string.easy_on))
                }
            }
        },
        floatingActionButton = {
            if (!simple && all?.isNotEmpty() == true) ExtendedFloatingActionButton(onClick = { nav.go(Screen.Add()) },
                icon = { Icon(Icons.Filled.Add, null) }, text = { Text(stringResource(R.string.add_purchase)) })
        },
    ) { pad ->
        val list = all
        if (list == null) return@Scaffold
        val upcoming = list.mapNotNull { p -> p.nearestDeadline()?.let { p to it } }
            .mapNotNull { (p, d) -> Dates.bucket(LocalDate.ofEpochDay(d), today)?.takeIf { it != Dates.Bucket.LATER }?.let { Triple(p, d, it) } }
            .sortedBy { it.second }
        val hasDeadlines = list.any { it.activeDeadlines().isNotEmpty() && it.daysList().isNotEmpty() }
        LazyColumn(Modifier.padding(pad).fillMaxSize().padding(horizontal = 16.dp)) {
            if (hasDeadlines && !notifOk) item {
                InfoBanner(stringResource(R.string.notif_off_info), Icons.Filled.NotificationsOff) {
                    TextButton(onClick = enableNotif, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.notif_turn_on)) }
                }
            }
            if (simple) item {
                Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    BigButton(Icons.Filled.Add, stringResource(R.string.add_purchase), primary = true) { nav.go(Screen.Add()) }
                    BigButton(Icons.Filled.EventNote, stringResource(R.string.check_deadlines)) { nav.go(Screen.Search(byDeadline = true)) }
                    BigButton(Icons.Filled.Search, stringResource(R.string.find_purchase)) { nav.go(Screen.Search()) }
                }
            }
            if (list.isEmpty()) item { EmptyState(simple, onAdd = { nav.go(Screen.Add()) }, onGuide = { nav.go(Screen.Onboarding) }) }
            if (upcoming.isNotEmpty()) {
                listOf(Dates.Bucket.OVERDUE to R.string.group_overdue, Dates.Bucket.TODAY to R.string.group_today, Dates.Bucket.SOON to R.string.group_soon).forEach { (b, title) ->
                    val g = upcoming.filter { it.third == b }
                    if (g.isNotEmpty()) {
                        item { SectionTitle(stringResource(title) + " (" + g.size + ")") }
                        items(g, key = { "u" + b.name + it.first.id }) { (p, _, _) -> PurchaseRow(p) { nav.go(Screen.Detail(p.id)) } }
                    }
                }
            } else if (list.isNotEmpty()) item {
                SectionTitle(stringResource(R.string.group_upcoming))
                Text(stringResource(R.string.no_upcoming), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (list.isNotEmpty()) {
                item { SectionTitle(stringResource(R.string.recent)) }
                items(list.take(if (simple) 5 else 30), key = { "r" + it.id }) { p -> PurchaseRow(p) { nav.go(Screen.Detail(p.id)) } }
                if (list.size > 30 || simple && list.size > 5) item {
                    TextButton(onClick = { nav.go(Screen.Search()) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.see_all)) }
                }
            }
            item { Spacer(Modifier.height(96.dp)) }
        }
    }
}

@Composable
private fun BigButton(icon: ImageVector, text: String, primary: Boolean = false, onClick: () -> Unit) {
    val m = Modifier.fillMaxWidth().heightIn(min = 72.dp)
    if (primary) Button(onClick = onClick, modifier = m) { Icon(icon, null); Spacer(Modifier.width(12.dp)); Text(text, style = MaterialTheme.typography.titleLarge) }
    else FilledTonalButton(onClick = onClick, modifier = m) { Icon(icon, null); Spacer(Modifier.width(12.dp)); Text(text, style = MaterialTheme.typography.titleLarge) }
}

@Composable
private fun EmptyState(simple: Boolean, onAdd: () -> Unit, onGuide: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.empty_title), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Start)
        ShareSteps()
        if (!simple) Button(onClick = onAdd, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), colors = ButtonDefaults.buttonColors()) {
            Icon(Icons.Filled.Add, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.add_purchase))
        }
        TextButton(onClick = onGuide, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Filled.ViewAgenda, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.show_guide)) }
    }
}

