package kr.eumsoft.notepro.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.delay
import kr.eumsoft.notepro.NoteProApp
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.data.Io

class MainActivity : FragmentActivity() {
    private val app get() = application as NoteProApp
    lateinit var state: AppState; private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        state = AppState(app)
        setContent {
            val settings by app.settings.flow.collectAsState()
            NoteProTheme(settings) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) { Root(state, this@MainActivity) }
                }
            }
        }
        // 마지막 작업 화면 복원(잠금 노트·휴지통 노트는 제외)
        val lines = app.prefs.workspace.lines().filter { it.isNotBlank() }
        Io.async({ lines.filter { l -> app.repo.notebook(l.substringBefore('\t'))?.let { !it.locked && !it.deleted } == true } }) { r ->
            val ok = r.getOrNull().orEmpty()
            ok.take(AppState.MAX_PANES).forEachIndexed { i, l ->
                state.open(l.substringBefore('\t'), newPane = i > 0, viewState = l.substringAfter('\t', "").ifBlank { null })
            }
            if (ok.isEmpty()) state.refreshLibrary()
        }
        if (app.previousCrash != null) state.toast = getString(R.string.recovered_after_crash)
    }

    override fun onStart() { super.onStart(); app.markRunning() }

    override fun onPause() {
        super.onPause()
        state.saveWorkspace()
        Io.flush(2500)
    }

    override fun onStop() {
        super.onStop()
        app.sessions.tickAutoVersions()
        if (Io.flush(3000)) app.markCleanExit()
    }

    /** 잠금 노트 열기 전 생체인증/화면 잠금 확인. */
    fun authenticate(onOk: () -> Unit) {
        val auth = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, R.string.lock_needs_screen_lock, Toast.LENGTH_LONG).show(); return
        }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { onOk() }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(getString(R.string.unlock_note)).setAllowedAuthenticators(auth).build())
    }

    fun canLock(): Boolean = BiometricManager.from(this).canAuthenticate(
        BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
    ) == BiometricManager.BIOMETRIC_SUCCESS
}

@Composable
fun Root(state: AppState, activity: MainActivity) {
    val ctx = activity
    LaunchedEffect(state.toast) {
        state.toast?.let { Toast.makeText(ctx, it, Toast.LENGTH_LONG).show(); state.toast = null }
    }
    // 자동 복구 지점 주기 확인
    LaunchedEffect(Unit) { while (true) { delay(60_000); state.app.sessions.tickAutoVersions() } }
    // 동기화: 시작 시 + 2분마다(로그인한 경우만, 네트워크 재연결 시에도 자동)
    LaunchedEffect(Unit) {
        state.app.onLibraryChanged = { if (state.screen == Screen.LIBRARY) state.refreshLibrary() }
        while (true) { state.app.sync.requestSync(); delay(120_000) }
    }
    when (state.screen) {
        Screen.LIBRARY -> LibraryScreen(state, activity)
        Screen.SETTINGS -> {
            BackHandler { state.screen = if (state.panes.isEmpty()) Screen.LIBRARY else Screen.WORKSPACE }
            SettingsScreen(state, activity) { state.screen = if (state.panes.isEmpty()) Screen.LIBRARY else Screen.WORKSPACE }
        }
        Screen.ACCOUNT -> {
            BackHandler { state.screen = if (state.panes.isEmpty()) Screen.LIBRARY else Screen.WORKSPACE }
            AccountScreen(state, activity) { state.screen = if (state.panes.isEmpty()) Screen.LIBRARY else Screen.WORKSPACE }
        }
        Screen.WORKSPACE -> {
            BackHandler { state.closeAll() }
            Workspace(state, activity)
        }
    }
    state.busy?.let { msg ->
        AlertDialog(onDismissRequest = {}, confirmButton = {}, title = { Text(stringResource(R.string.please_wait)) }, text = { Text(msg) })
    }
    if (state.app.settings.value.showTips && !state.app.prefs.onboarded) {
        var show by remember { mutableStateOf(true) }
        if (show) AlertDialog(
            onDismissRequest = { show = false; state.app.prefs.onboarded = true },
            confirmButton = { TextButton({ show = false; state.app.prefs.onboarded = true }) { Text(stringResource(R.string.ok)) } },
            title = { Text(stringResource(R.string.welcome_title)) },
            text = { Text(stringResource(R.string.welcome_body)) },
        )
    }
}

/** 멀티윈도우 작업 화면: 창 1~2개, 좌우/상하 분할, 경계 드래그로 크기 조절. */
@Composable
fun Workspace(state: AppState, activity: MainActivity) {
    val panes = state.panes
    if (panes.isEmpty()) return
    if (panes.size == 1) {
        key(panes[0].key) { EditorPane(state, panes[0], activity, Modifier.fillMaxSize()) }
        return
    }
    var total by remember { mutableStateOf(1f) }
    val divider = MaterialTheme.colorScheme.outline
    if (state.splitVertical) {
        Column(Modifier.fillMaxSize().onSizeChanged { total = it.height.toFloat() }) {
            key(panes[0].key) { EditorPane(state, panes[0], activity, Modifier.fillMaxWidth().weight(state.splitRatio)) }
            Box(Modifier.fillMaxWidth().height(10.dp).background(divider).pointerInput(Unit) {
                detectDragGestures(onDragEnd = { state.saveWorkspace() }) { ch, d -> ch.consume(); state.splitRatio = (state.splitRatio + d.y / total).coerceIn(0.2f, 0.8f) }
            })
            key(panes[1].key) { EditorPane(state, panes[1], activity, Modifier.fillMaxWidth().weight(1f - state.splitRatio)) }
        }
    } else {
        Row(Modifier.fillMaxSize().onSizeChanged { total = it.width.toFloat() }) {
            key(panes[0].key) { EditorPane(state, panes[0], activity, Modifier.fillMaxHeight().weight(state.splitRatio)) }
            Box(Modifier.fillMaxHeight().width(10.dp).background(divider).pointerInput(Unit) {
                detectDragGestures(onDragEnd = { state.saveWorkspace() }) { ch, d -> ch.consume(); state.splitRatio = (state.splitRatio + d.x / total).coerceIn(0.2f, 0.8f) }
            })
            key(panes[1].key) { EditorPane(state, panes[1], activity, Modifier.fillMaxHeight().weight(1f - state.splitRatio)) }
        }
    }
}
