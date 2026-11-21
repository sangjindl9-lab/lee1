package kr.eumsoft.securitypro.ui

import android.Manifest
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.AndroidEntryPoint
import kr.eumsoft.securitypro.R

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val openSession = intent.getLongExtra("session", 0)
        setContent {
            val vm: MainVm = hiltViewModel()
            val s by vm.s.collectAsStateWithLifecycle()
            EumTheme(s.theme) { Root(vm, openSession) }
        }
    }
}

private data class Tab(val route: String, val label: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val tabs = listOf(
    Tab("home", R.string.tab_home, Icons.Filled.Shield), Tab("adblock", R.string.tab_adblock, Icons.Filled.Block),
    Tab("scan", R.string.tab_scan, Icons.Filled.Search), Tab("db", R.string.tab_db, Icons.Filled.Storage),
    Tab("settings", R.string.tab_settings, Icons.Filled.Settings),
)

@Composable
private fun Root(vm: MainVm, openSession: Long) {
    val s by vm.s.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    var showOnboarding by remember(s.onboardingDone) { mutableStateOf(!s.onboardingDone) }
    val notiPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val vpnConsent = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == android.app.Activity.RESULT_OK) vm.setVpn(true)
    }
    val requestVpn: () -> Unit = {
        if (Build.VERSION.SDK_INT >= 33) notiPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        val i = VpnService.prepare(ctx)
        if (i == null) vm.setVpn(true) else vpnConsent.launch(i)
    }
    if (showOnboarding) { Onboarding { vm.onboardingDone(); showOnboarding = false }; return }

    val nav = rememberNavController()
    LaunchedEffect(openSession) { if (openSession > 0) nav.navigate("session/$openSession") }
    val back by nav.currentBackStackEntryAsState()
    Scaffold(bottomBar = {
        NavigationBar {
            tabs.forEach { t ->
                val sel = back?.destination?.route == t.route
                NavigationBarItem(sel, { nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } },
                    { Icon(t.icon, null) }, label = { Text(stringResource(t.label)) })
            }
        }
    }) { pad ->
        NavHost(nav, "home", Modifier.padding(pad)) {
            composable("home") { HomeScreen(vm, requestVpn, { nav.navigate("scan") }, { nav.navigate("db") }, { nav.navigate("session/$it") }) }
            composable("adblock") { AdBlockScreen(vm, requestVpn, { nav.navigate("licenses") }) }
            composable("scan") { ScanScreen { nav.navigate("session/$it") } }
            composable("session/{id}", listOf(navArgument("id") { type = NavType.LongType })) {
                SessionScreen(it.arguments!!.getLong("id")) { rid -> nav.navigate("result/$rid") }
            }
            composable("result/{id}", listOf(navArgument("id") { type = NavType.LongType })) { ResultScreen(it.arguments!!.getLong("id")) }
            composable("db") { DbScreen() }
            composable("settings") { SettingsScreen({ nav.navigate("licenses") }, { nav.navigate("privacy") }) }
            composable("licenses") { LicensesScreen() }
            composable("privacy") { PrivacyScreen() }
        }
    }
}
