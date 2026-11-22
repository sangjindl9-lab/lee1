package kr.eumsoft.filemanager2

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import kr.eumsoft.filemanager2.ui.FM2Theme
import kr.eumsoft.filemanager2.ui.Root

class MainActivity : ComponentActivity() {
    private val resumeTick = mutableIntStateOf(0)
    private val openConnect = mutableStateOf(false)

    // ---- 인앱 업데이트 (Google Play) ----
    private var updateManager: AppUpdateManager? = null
    private val pendingUpdate = mutableStateOf<AppUpdateInfo?>(null)
    private var askedThisSession = false
    private val updateLauncher =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        updateManager = runCatching { AppUpdateManagerFactory.create(this) }.getOrNull()
        openConnect.value = intent?.getBooleanExtra("openConnect", false) == true
        kr.eumsoft.filemanager2.connect.ConnectState.load(this)
        if (kr.eumsoft.filemanager2.connect.ConnectState.enabled) runCatching { kr.eumsoft.filemanager2.connect.ConnectService.start(this) }
        checkForUpdate()
        setContent {
            val vm: AppVM = viewModel()
            FM2Theme(vm.prefs.theme) {
                Root(vm, resumeTick.intValue)
                androidx.compose.runtime.LaunchedEffect(openConnect.value) {
                    if (openConnect.value) { openConnect.value = false; if (vm.top != Dest.Connect) vm.push(Dest.Connect) }
                }
                pendingUpdate.value?.let { info ->
                    AlertDialog(
                        onDismissRequest = { pendingUpdate.value = null },
                        title = { Text("새 버전이 있습니다", fontWeight = FontWeight.Bold) },
                        text = { Text("파일관리자2의 새 버전이 나왔습니다.\n지금 업데이트하시겠어요?") },
                        confirmButton = {
                            TextButton(onClick = { pendingUpdate.value = null; startUpdate(info) }) { Text("업데이트") }
                        },
                        dismissButton = {
                            TextButton(onClick = { pendingUpdate.value = null }) { Text("나중에") }
                        },
                    )
                }
            }
        }
    }

    private fun checkForUpdate() {
        if (askedThisSession) return
        val m = updateManager ?: return
        m.appUpdateInfo.addOnSuccessListener { info ->
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
                info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
            ) {
                askedThisSession = true
                pendingUpdate.value = info
            }
        }
    }

    private fun startUpdate(info: AppUpdateInfo) {
        runCatching {
            updateManager?.startUpdateFlowForResult(
                info, updateLauncher, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()
            )
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("openConnect", false)) openConnect.value = true
    }

    override fun onResume() {
        super.onResume()
        resumeTick.intValue++
        // 업데이트 도중 앱을 벗어났다가 돌아온 경우 이어서 진행
        updateManager?.appUpdateInfo?.addOnSuccessListener { info ->
            if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) startUpdate(info)
        }
        checkForUpdate()
    }
}
