package kr.eumsoft.kidscoloring.ui

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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            EumTheme {
                val vm: ColoringViewModel = viewModel()
                val ctx = LocalContext.current
                val speaker = remember { Speaker(ctx) }
                DisposableEffect(Unit) { onDispose { speaker.close() } }
                // home / coloring / gallery / parent / privacy
                var screen by rememberSaveable { mutableStateOf("home") }
                val privacy = remember { ctx.assets.open("privacy_policy.txt").bufferedReader().use { it.readText() } }
                val open: (String, Long?) -> Unit = { artId, projId -> vm.open(artId, projId) { screen = "coloring" } }

                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
                    when {
                        screen == "coloring" && vm.engine != null && vm.artwork != null -> ColoringScreen(vm, speaker) { screen = "home" }
                        screen == "gallery" -> { BackHandler { screen = "home" }; GalleryScreen(vm, onBack = { screen = "home" }, onOpen = open) }
                        screen == "parent" -> { BackHandler { screen = "home" }; ParentScreen(vm, BuildConfig.VERSION_NAME, onBack = { screen = "home" }, onPrivacy = { screen = "privacy" }) }
                        screen == "privacy" -> { BackHandler { screen = "parent" }; PrivacyScreen(privacy) { screen = "parent" } }
                        else -> HomeScreen(vm, speaker, onOpen = open, onGallery = { screen = "gallery" }, onParent = { screen = "parent" })
                    }
                    if (vm.loading) Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0x55FFFFFF)), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
                vm.error?.let { ConfirmDialog("알림", it, "확인", "닫기", onYes = { vm.error = null }, onNo = { vm.error = null }) }
            }
        }
    }
}
