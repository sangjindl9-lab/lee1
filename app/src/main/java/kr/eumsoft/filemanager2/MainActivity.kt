package kr.eumsoft.filemanager2

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableIntStateOf
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.eumsoft.filemanager2.ui.FM2Theme
import kr.eumsoft.filemanager2.ui.Root

class MainActivity : ComponentActivity() {
    private val resumeTick = mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val vm: AppVM = viewModel()
            FM2Theme(vm.prefs.theme) {
                Root(vm, resumeTick.intValue)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumeTick.intValue++
    }
}
