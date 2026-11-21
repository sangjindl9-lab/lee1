package kr.eumsoft.purchasenote.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.eumsoft.purchasenote.data.Prefs

sealed class Screen {
    data object Home : Screen()
    data class Search(val byDeadline: Boolean = false) : Screen()
    data object Settings : Screen()
    data object Onboarding : Screen()
    data class Detail(val id: Long) : Screen()
    data object ImportPick : Screen()
    data class ShopBrowser(val mallId: String) : Screen()
    class ImportReview(val mallId: String, val rows: List<ImportRow>, val pageUrl: String?) : Screen()
    /** editId: 수정할 구매, sameOrderOf: 같은 주문에 상품 추가할 원본 */
    class Add(val editId: Long? = null, val shared: List<Uri> = emptyList(), val sharedText: String? = null, val sameOrderOf: Long? = null) : Screen() {
        val draft = Draft()
    }
}

class Nav : ViewModel() {
    val stack = mutableStateListOf<Screen>(Screen.Home)
    val top get() = stack.last()
    fun go(s: Screen) { stack.add(s) }
    fun back(): Boolean { if (stack.size <= 1) return false; stack.removeAt(stack.lastIndex); return true }
    fun replace(s: Screen) { stack.removeAt(stack.lastIndex); stack.add(s) }
    fun home() { while (stack.size > 1) stack.removeAt(stack.lastIndex) }
}

class MainActivity : AppCompatActivity() {
    companion object { const val EXTRA_OPEN_ID = "open_purchase" }
    private var nav: Nav? = null
    private var pendingIntent: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val prefs = Prefs.get(this)
        if (savedInstanceState == null) pendingIntent = intent
        setContent {
            val n: Nav = viewModel(); nav = n
            LaunchedEffect(Unit) {
                val pi = pendingIntent; pendingIntent = null
                val fromShare = pi != null && (pi.action == Intent.ACTION_SEND || pi.action == Intent.ACTION_SEND_MULTIPLE || pi.getLongExtra(EXTRA_OPEN_ID, -1) > 0)
                if (!prefs.onboardingDone && !fromShare && n.stack.size == 1) { prefs.onboardingDone = true; n.go(Screen.Onboarding) }
                if (pi != null) handle(pi, n)
            }
            val large by prefs.large.collectAsState()
            PurchaseTheme(large) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    BackHandler(enabled = n.stack.size > 1) { n.back() }
                    when (val s = n.top) {
                        Screen.Home -> HomeScreen(n)
                        is Screen.Search -> SearchScreen(n, s)
                        Screen.Settings -> SettingsScreen(n)
                        Screen.Onboarding -> OnboardingScreen(onDone = { n.back() })
                        is Screen.Detail -> DetailScreen(n, s.id)
                        is Screen.Add -> AddScreen(n, s)
                        Screen.ImportPick -> ImportPickScreen(n)
                        is Screen.ShopBrowser -> ShopBrowserScreen(n, s)
                        is Screen.ImportReview -> ImportReviewScreen(n, s)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val n = nav
        if (n != null) handle(intent, n) else pendingIntent = intent
    }

    @Suppress("DEPRECATION")
    private fun handle(i: Intent, n: Nav) {
        val open = i.getLongExtra(EXTRA_OPEN_ID, -1)
        if (open > 0) { n.home(); n.go(Screen.Detail(open)); return }
        when (i.action) {
            Intent.ACTION_SEND -> {
                val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else i.getParcelableExtra(Intent.EXTRA_STREAM)
                val text = i.getStringExtra(Intent.EXTRA_TEXT)
                if (uri != null || !text.isNullOrBlank()) { n.home(); n.go(Screen.Add(shared = listOfNotNull(uri), sharedText = text)) }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris: List<Uri> = (if (Build.VERSION.SDK_INT >= 33) i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else i.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: arrayListOf()
                if (uris.isNotEmpty()) { n.home(); n.go(Screen.Add(shared = uris.take(10))) }
            }
        }
    }
}
