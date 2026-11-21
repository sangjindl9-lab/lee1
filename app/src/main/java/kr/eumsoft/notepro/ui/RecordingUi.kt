package kr.eumsoft.notepro.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.ui.canvas.Tool

/** 도구 모음의 녹음·재생 버튼. 처음 녹음 전 법적 고지·동의, 마이크 권한 확인. */
@Composable
fun RecordButtons(state: AppState, pane: PaneState) {
    val app = state.app
    val ctx = LocalContext.current
    val rec by app.recorder.state.collectAsState()
    val sp = remember { ctx.getSharedPreferences("notepro", Context.MODE_PRIVATE) }
    var consent by remember { mutableStateOf(false) }
    fun begin() {
        val nb = pane.session?.notebook?.id ?: return
        try { app.recorder.start(nb) } catch (e: Exception) { state.toast = ctx.getString(R.string.record_failed) }
    }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) begin() else state.toast = ctx.getString(R.string.mic_permission_needed) }
    val recordingHere = rec.recordingNb != null
    ToolButton(if (recordingHere) Icons.Default.Stop else Icons.Default.Mic, stringResource(if (recordingHere) R.string.record_stop else R.string.record_start), recordingHere, {
        if (recordingHere) app.recorder.stop { state.toast = ctx.getString(R.string.record_saved) }
        else if (sp.getBoolean("recConsent", false)) {
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin() else perm.launch(Manifest.permission.RECORD_AUDIO)
        } else consent = true
    }, tint = if (recordingHere) Color(0xFFC92A2A) else null)
    ToolButton(Icons.Default.PlayArrow, stringResource(R.string.play_mode), pane.tool == Tool.PLAY, { pane.tool = Tool.PLAY; state.toast = ctx.getString(R.string.play_mode_hint) })
    if (consent) AlertDialog({ consent = false }, title = { Text(stringResource(R.string.record_consent_title)) }, text = { Text(stringResource(R.string.record_consent_body)) },
        confirmButton = { TextButton({
            consent = false; sp.edit().putBoolean("recConsent", true).apply()
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin() else perm.launch(Manifest.permission.RECORD_AUDIO)
        }) { Text(stringResource(R.string.agree)) } },
        dismissButton = { TextButton({ consent = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun RecordingBar(state: AppState) {
    val rec by state.app.recorder.state.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(rec.recordingNb, rec.playing) { while (rec.recordingNb != null || rec.playing != null) { now = System.currentTimeMillis(); delay(500) } }
    if (rec.recordingNb == null && rec.playing == null) return
    Surface(color = MaterialTheme.colorScheme.error.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (rec.recordingNb != null) {
                val sec = ((now - rec.startedAt) / 1000).coerceAtLeast(0)
                Text("● " + stringResource(if (rec.paused) R.string.record_paused else R.string.recording) + "  %d:%02d".format(sec / 60, sec % 60), color = MaterialTheme.colorScheme.error)
                TextButton({ state.app.recorder.pauseResume() }) { Text(stringResource(if (rec.paused) R.string.record_resume else R.string.record_pause)) }
                TextButton({ state.app.recorder.stop() }) { Text(stringResource(R.string.record_stop)) }
            } else {
                Text("▶ " + stringResource(R.string.playing))
                TextButton({ state.app.recorder.stopPlayback() }) { Text(stringResource(R.string.stop)) }
            }
        }
    }
}
