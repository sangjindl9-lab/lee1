package kr.eumsoft.kidscoloring.ui

import kr.eumsoft.kidscoloring.tr
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.eumsoft.kidscoloring.BuildConfig
import kr.eumsoft.kidscoloring.I18n

class MainActivity : ComponentActivity() {
    private val music = MusicBox()
    private val bgm by lazy { BgmPlayer(this) }
    /** 지금 화면에 맞는 음악: "" 없음, "games" 오르골 동요, "coloring" 색칠 배경 음악 */
    private var musicMode = ""

    private fun applyMusic() {
        if (musicMode == "games") music.start() else music.stop()
        if (musicMode == "coloring") bgm.start() else bgm.pause()
    }
    override fun onStart() { super.onStart(); applyMusic() }
    override fun onStop() { music.stop(); bgm.pause(); super.onStop() }
    override fun onDestroy() { music.stop(); bgm.release(); super.onDestroy() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 기기 언어에 맞는 번역을 읽는다. (자동 테스트: am start --es lang ko 로 언어를 고정할 수 있다)
        I18n.init(this, intent?.getStringExtra("lang"))
        setContent {
            EumTheme {
                val vm: ColoringViewModel = viewModel()
                val ctx = LocalContext.current
                val speaker = remember { Speaker(ctx) }
                DisposableEffect(Unit) { onDispose { speaker.close() } }
                // home / coloring / gallery / games / parent / privacy
                var screen by rememberSaveable { mutableStateOf("home") }
                val privacy = remember { ctx.assets.open(if (I18n.lang == "ko") "privacy_policy.txt" else "privacy_policy_en.txt").bufferedReader().use { it.readText() } }
                val settings by vm.settings.collectAsState()
                // 놀이터에서는 오르골 동요, 색칠할 때는 배경 음악을 튼다
                val mode = when {
                    screen == "games" && settings.musicEnabled -> "games"
                    screen == "coloring" && vm.engine != null && settings.coloringMusic -> "coloring"
                    else -> ""
                }
                LaunchedEffect(mode) { musicMode = mode; applyMusic() }
                val open: (String, Long?) -> Unit = { artId, projId -> vm.open(artId, projId) { screen = "coloring" } }

                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
                    when {
                        screen == "coloring" && vm.engine != null && vm.artwork != null -> ColoringScreen(vm, speaker) { screen = "home" }
                        screen == "games" -> GamesScreen(vm, speaker) { screen = "home" }
                        screen == "gallery" -> { BackHandler { screen = "home" }; GalleryScreen(vm, onBack = { screen = "home" }, onOpen = open) }
                        screen == "parent" -> { BackHandler { screen = "home" }; ParentScreen(vm, BuildConfig.VERSION_NAME, onBack = { screen = "home" }, onPrivacy = { screen = "privacy" }) }
                        screen == "privacy" -> { BackHandler { screen = "parent" }; PrivacyScreen(privacy) { screen = "parent" } }
                        else -> HomeScreen(vm, speaker, onOpen = open, onGallery = { screen = "gallery" }, onGames = { screen = "games" }, onParent = { screen = "parent" })
                    }
                    if (vm.loading) Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0x55FFFFFF)), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
                vm.error?.let { ConfirmDialog(tr("알림"), it, tr("확인"), tr("닫기"), onYes = { vm.error = null }, onNo = { vm.error = null }) }
            }
        }
    }
}
