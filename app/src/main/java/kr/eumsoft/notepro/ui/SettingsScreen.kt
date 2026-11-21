package kr.eumsoft.notepro.ui

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.BuildConfig
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.Settings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(state: AppState, @Suppress("UNUSED_PARAMETER") activity: MainActivity, onBack: () -> Unit) {
    val app = state.app
    val ctx = LocalContext.current
    val s by app.settings.flow.collectAsState()
    val set: ((Settings) -> Settings) -> Unit = { app.settings.update(it) }
    var errors by remember { mutableStateOf<String?>(null) }
    Scaffold(topBar = {
        TopAppBar(title = { Text(stringResource(R.string.settings)) }, navigationIcon = { IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } })
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Section(R.string.sec_writing)
            Toggle(R.string.set_pressure, s.pressureEnabled) { v -> set { it.copy(pressureEnabled = v) } }
            Toggle(R.string.set_shape_hold, s.shapeHold, R.string.set_shape_hold_desc) { v -> set { it.copy(shapeHold = v) } }
            SliderRow(R.string.set_stabilization, s.stabilization, 0f..1f, "${(s.stabilization * 100).toInt()}%") { v -> set { it.copy(stabilization = v) } }

            Section(R.string.sec_touch)
            Toggle(R.string.set_palm, s.palmRejection, R.string.set_palm_desc) { v -> set { it.copy(palmRejection = v) } }
            Text(stringResource(R.string.set_finger_mode), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            ChipRow {
                listOf("AUTO" to R.string.finger_auto, "PEN_ONLY" to R.string.finger_pen_only, "FINGER_DRAW" to R.string.finger_draw).forEach { (k, l) ->
                    FilterChip(s.fingerMode == k, { set { it.copy(fingerMode = k) } }, { Text(stringResource(l)) })
                }
            }
            Text(stringResource(R.string.set_scroll_fingers), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            ChipRow {
                FilterChip(s.scrollFingers == 1, { set { it.copy(scrollFingers = 1) } }, { Text(stringResource(R.string.one_finger)) })
                FilterChip(s.scrollFingers == 2, { set { it.copy(scrollFingers = 2) } }, { Text(stringResource(R.string.two_fingers)) })
            }
            Toggle(R.string.set_zoom_enabled, s.zoomEnabled) { v -> set { it.copy(zoomEnabled = v) } }
            Toggle(R.string.set_zoom_locked, s.zoomLocked) { v -> set { it.copy(zoomLocked = v) } }
            Toggle(R.string.set_scroll_locked, s.scrollLocked, R.string.set_scroll_locked_desc) { v -> set { it.copy(scrollLocked = v) } }
            Text(stringResource(R.string.set_sensitivity), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            ChipRow {
                listOf(1 to R.string.sens_low, 2 to R.string.sens_mid, 3 to R.string.sens_high).forEach { (k, l) ->
                    FilterChip(s.gestureSensitivity == k, { set { it.copy(gestureSensitivity = k) } }, { Text(stringResource(l)) })
                }
            }
            Toggle(R.string.set_two_finger_undo, s.twoFingerTapUndo) { v -> set { it.copy(twoFingerTapUndo = v) } }
            Toggle(R.string.set_zoom_ui_pinned, s.zoomUiPinned) { v -> set { it.copy(zoomUiPinned = v) } }
            if (!s.zoomUiPinned) SliderRow(R.string.set_zoom_ui_hide, s.zoomUiHideSec.toFloat(), 1f..10f, ctx.getString(R.string.seconds_n, s.zoomUiHideSec)) { v -> set { it.copy(zoomUiHideSec = v.toInt()) } }

            Section(R.string.sec_display)
            Toggle(R.string.set_large_ui, s.largeUi) { v -> set { it.copy(largeUi = v) } }
            Toggle(R.string.set_left_handed, s.leftHanded) { v -> set { it.copy(leftHanded = v) } }
            Toggle(R.string.set_high_contrast, s.highContrast) { v -> set { it.copy(highContrast = v) } }
            Text(stringResource(R.string.set_theme), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            ChipRow {
                listOf("SYSTEM" to R.string.theme_system, "LIGHT" to R.string.theme_light, "DARK" to R.string.theme_dark).forEach { (k, l) ->
                    FilterChip(s.theme == k, { set { it.copy(theme = k) } }, { Text(stringResource(l)) })
                }
            }
            Toggle(R.string.set_confirm_delete, s.confirmDelete) { v -> set { it.copy(confirmDelete = v) } }
            Toggle(R.string.set_tips, s.showTips) { v -> set { it.copy(showTips = v) }; if (v) app.prefs.onboarded = false }

            Section(R.string.sec_data)
            SliderRow(R.string.set_auto_version, s.autoVersionMinutes.toFloat(), 0f..60f, if (s.autoVersionMinutes == 0) stringResource(R.string.off) else ctx.getString(R.string.minutes_n, s.autoVersionMinutes)) { v -> set { it.copy(autoVersionMinutes = v.toInt()) } }
            SliderRow(R.string.set_version_keep, s.versionKeep.toFloat(), 5f..100f, s.versionKeep.toString()) { v -> set { it.copy(versionKeep = v.toInt()) } }
            val last = app.prefs.lastBackupAt
            Text(if (last == 0L) stringResource(R.string.backup_never) else ctx.getString(R.string.backup_last, DateFormat.getMediumDateFormat(ctx).format(last) + " " + DateFormat.getTimeFormat(ctx).format(last)),
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 6.dp))
            Text(stringResource(R.string.local_mode_notice), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton({ Io.async({ app.repo.recentErrors() }) { r -> errors = r.getOrNull().orEmpty().joinToString("\n").ifBlank { ctx.getString(R.string.no_errors) } } }) {
                Text(stringResource(R.string.view_error_log))
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text("NotePro ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 24.dp))
        }
    }
    errors?.let { InfoDialog(it) { errors = null } }
}

@Composable
private fun Section(title: Int) {
    Text(stringResource(title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
}

@Composable
private fun Toggle(label: Int, value: Boolean, desc: Int? = null, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(label), style = MaterialTheme.typography.bodyLarge)
            if (desc != null) Text(stringResource(desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(value, onChange)
    }
}

@Composable
private fun SliderRow(label: Int, value: Float, range: ClosedFloatingPointRange<Float>, valueText: String, onChange: (Float) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row { Text(stringResource(label), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge); Text(valueText) }
        Slider(value, onChange, valueRange = range)
    }
}
