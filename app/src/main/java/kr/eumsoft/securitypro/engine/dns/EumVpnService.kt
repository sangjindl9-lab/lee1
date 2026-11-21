package kr.eumsoft.securitypro.engine.dns

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.adguard.dnslibs.proxy.DnsTunListener
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kr.eumsoft.securitypro.R
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.SettingsStore
import kr.eumsoft.securitypro.data.VpnSession
import kr.eumsoft.securitypro.ui.MainActivity
import java.net.Inet4Address
import java.net.InetAddress
import javax.inject.Inject

/**
 * 로컬 DNS 필터링 VPN.
 *
 * 구조: VPN 에는 가상 DNS 주소(198.18.53.53, fd00:e0a::53) 만 라우팅한다. 일반 인터넷 트래픽은 터널에 들어오지
 * 않고 원래 네트워크로 그대로 나가므로 정상 통신이 유지되고 패킷 손실·속도 저하가 없다.
 * 터널로 들어온 DNS 패킷은 AdGuard DnsLibs 의 DnsTunListener(자체 TCP/IP 스택)가 처리하고,
 * DnsProxy 가 필터링 후 응답한다. 이 앱 자신은 VPN 에서 제외(addDisallowedApplication)되어
 * 업스트림 DNS 연결이 터널로 다시 들어오는 루프가 생기지 않는다.
 */
@AndroidEntryPoint
class EumVpnService : VpnService() {
    @Inject lateinit var dns: DnsEngine
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var db: AppDb

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tun: ParcelFileDescriptor? = null
    private var listener: DnsTunListener? = null
    private var sessionId = 0L
    private var systemDns: List<String> = emptyList()
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var pauseJob: Job? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopVpn("USER"); return START_NOT_STICKY }
            ACTION_RELOAD -> { scope.launch { reload() }; return START_STICKY }
        }
        startForegroundCompat(getString(R.string.vpn_noti_connecting))
        scope.launch { startVpn() }
        return START_STICKY
    }

    private fun startVpn(): Unit = synchronized(this) {
        if (tun != null) return@synchronized
        val t0 = System.currentTimeMillis()
        state.value = VpnState.CONNECTING
        try {
            val s = runBlocking { settings.now() }
            systemDns = underlyingDns()
            dns.start(this, s, systemDns, paused = s.pausedUntil > System.currentTimeMillis())
            val b = Builder().setSession(getString(R.string.app_name)).setMtu(MTU)
                .addAddress(V4_ADDR, 32).addRoute(V4_DNS, 32).addDnsServer(V4_DNS)
                .addAddress(V6_ADDR, 128).addRoute(V6_DNS, 128).addDnsServer(V6_DNS)
                .setBlocking(false)
            if (Build.VERSION.SDK_INT >= 29) b.setMetered(false)
            b.addDisallowedApplication(packageName)
            for (p in s.excludedApps) runCatching { b.addDisallowedApplication(p) }
            b.setConfigureIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            val fd = b.establish() ?: error("VPN 권한이 없습니다")
            // DnsTunListener 가 fd 를 소유하고 종료 시 직접 닫으므로 소유권을 넘긴다 (이중 close 방지)
            val raw = fd.detachFd()
            listener = try {
                DnsTunListener(raw, MTU) { req, rh -> dns.handle(req) { rh.onReply(it) } }
            } catch (e: Throwable) { ParcelFileDescriptor.adoptFd(raw).close(); throw e }
            tun = fd
            val ms = System.currentTimeMillis() - t0
            sessionId = runBlocking { db.dns().insertVpnSession(VpnSession(startedAt = t0, connectMs = ms)) }
            watchNetwork()
            schedulePauseEnd(s.pausedUntil)
            state.value = if (s.pausedUntil > System.currentTimeMillis()) VpnState.PAUSED else VpnState.ON
            connectMs.value = ms
            Log.i(TAG, "VPN 연결됨 (${ms}ms), 시스템 DNS=$systemDns")
            startForegroundCompat(getString(R.string.vpn_noti_on))
        } catch (e: Throwable) {
            Log.e(TAG, "VPN 시작 실패", e)
            lastError.value = e.message ?: e.javaClass.simpleName
            cleanup("ERROR:${e.message}")
            state.value = VpnState.ERROR
            stopSelf()
        }
    }

    /** 설정 변경·네트워크 변경 시: 제외 앱 목록이 바뀌었으면 터널을 다시 만들고, 아니면 DNS 설정만 재적용한다. */
    private suspend fun reload(rebuild: Boolean = false) {
        val s = settings.now()
        if (tun == null) return
        if (rebuild || s.excludedApps != lastExcluded) {
            lastExcluded = s.excludedApps
            cleanup("RELOAD"); startVpn(); return
        }
        val paused = s.pausedUntil > System.currentTimeMillis()
        // 일시 정지가 끝나면 터널을 다시 만들어 Android 시스템 DNS 캐시(정지 중 받은 실제 주소)를 비운다
        if (state.value == VpnState.PAUSED && !paused) { cleanup("RESUME"); startVpn(); return }
        if (!dns.reapply(s, systemDns, paused)) { cleanup("RELOAD"); startVpn(); return }
        schedulePauseEnd(s.pausedUntil)
        state.value = if (paused) VpnState.PAUSED else VpnState.ON
    }
    private var lastExcluded: Set<String>? = null

    private fun schedulePauseEnd(until: Long) {
        pauseJob?.cancel()
        val wait = until - System.currentTimeMillis()
        if (wait > 0) pauseJob = scope.launch { delay(wait + 500); reload() }
    }

    /** VPN 이 아닌 실제 네트워크(Wi-Fi/모바일)의 변화를 감시해 업스트림을 다시 잡는다. */
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java)
        val req = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = changed("link")
            override fun onLost(network: Network) = changed("lost")
            override fun onAvailable(network: Network) = changed("available")
            private fun changed(why: String) {
                scope.launch {
                    delay(800)
                    val now = underlyingDns()
                    if (now != systemDns) {
                        Log.i(TAG, "네트워크 변경($why): DNS $systemDns → $now")
                        systemDns = now; reload()
                    }
                    netState.value = describeNetwork()
                }
            }
        }
        runCatching { cm.registerNetworkCallback(req, cb) }.onSuccess { netCallback = cb }
        netState.value = describeNetwork()
    }

    private fun underlyingDns(): List<String> {
        val cm = getSystemService(ConnectivityManager::class.java)
        val nets = cm.allNetworks.filter { n ->
            cm.getNetworkCapabilities(n)?.let { it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) } == true
        }
        return nets.flatMap { cm.getLinkProperties(it)?.dnsServers.orEmpty() }
            .sortedBy { if (it is Inet4Address) 0 else 1 }.mapNotNull { it.hostAddress?.substringBefore('%') }.distinct()
    }

    private fun describeNetwork(): String {
        val cm = getSystemService(ConnectivityManager::class.java)
        val n = cm.allNetworks.mapNotNull { cm.getNetworkCapabilities(it) }.firstOrNull { !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) && it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) }
        return when {
            n == null -> "NONE"
            n.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            n.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            else -> "OTHER"
        }
    }

    private fun stopVpn(reason: String) {
        cleanup(reason)
        state.value = VpnState.OFF
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    @Synchronized
    private fun cleanup(reason: String) {
        netCallback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        netCallback = null
        pauseJob?.cancel()
        listener?.close(); listener = null
        runCatching { tun?.close() }; tun = null
        dns.stop()
        if (sessionId != 0L) {
            val id = sessionId; sessionId = 0
            val q = dns.queries.get(); val b = dns.blocked.get()
            runBlocking { runCatching { db.dns().endVpnSession(id, System.currentTimeMillis(), reason, q, b) } }
        }
    }

    override fun onRevoke() {
        // 다른 VPN 이 켜지거나 사용자가 시스템 설정에서 끈 경우: 다시 켜지 않는다.
        scope.launch { settings.update { it.copy(vpnWanted = false) } }
        lastError.value = "REVOKED"
        stopVpn("REVOKED")
    }

    override fun onDestroy() {
        cleanup("DESTROY"); if (state.value != VpnState.ERROR) state.value = VpnState.OFF
        scope.cancel(); super.onDestroy()
    }

    private fun startForegroundCompat(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH, getString(R.string.vpn_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, EumVpnService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CH).setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(getString(R.string.app_name)).setContentText(text).setOngoing(true)
            .setContentIntent(open).addAction(0, getString(R.string.vpn_stop), stop).build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTI_ID, n, type)
    }

    companion object {
        const val TAG = "EUM_VPN"
        const val ACTION_START = "kr.eumsoft.securitypro.VPN_START"
        const val ACTION_STOP = "kr.eumsoft.securitypro.VPN_STOP"
        const val ACTION_RELOAD = "kr.eumsoft.securitypro.VPN_RELOAD"
        private const val CH = "vpn"; private const val NOTI_ID = 10; private const val MTU = 1500
        private val V4_ADDR: InetAddress = InetAddress.getByName("198.18.53.1")
        private val V4_DNS: InetAddress = InetAddress.getByName("198.18.53.53")
        private val V6_ADDR: InetAddress = InetAddress.getByName("fd00:e0a::1")
        private val V6_DNS: InetAddress = InetAddress.getByName("fd00:e0a::53")

        val state = kotlinx.coroutines.flow.MutableStateFlow(VpnState.OFF)
        val lastError = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
        val netState = kotlinx.coroutines.flow.MutableStateFlow("NONE")
        val connectMs = kotlinx.coroutines.flow.MutableStateFlow(0L)

        fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, EumVpnService::class.java).setAction(ACTION_START))
        fun stop(ctx: Context) { if (state.value != VpnState.OFF) ctx.startService(Intent(ctx, EumVpnService::class.java).setAction(ACTION_STOP)) }
        fun reload(ctx: Context) { if (state.value == VpnState.ON || state.value == VpnState.PAUSED) ctx.startService(Intent(ctx, EumVpnService::class.java).setAction(ACTION_RELOAD)) }
    }
}

enum class VpnState { OFF, CONNECTING, ON, PAUSED, ERROR }
