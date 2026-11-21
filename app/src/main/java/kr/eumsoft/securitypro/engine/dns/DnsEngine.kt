package kr.eumsoft.securitypro.engine.dns

import android.content.Context
import android.util.Log
import com.adguard.dnslibs.proxy.DnsProxy
import com.adguard.dnslibs.proxy.DnsProxyEvents
import com.adguard.dnslibs.proxy.DnsProxySettings
import com.adguard.dnslibs.proxy.DnsRequestProcessedEvent
import com.adguard.dnslibs.proxy.FilterParams
import com.adguard.dnslibs.proxy.UpstreamSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kr.eumsoft.securitypro.data.AdFilterSource
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.AppSettings
import kr.eumsoft.securitypro.data.BlockedDnsEvent
import java.util.EnumSet
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AdGuard DnsLibs(DnsProxy) 를 설정·실행한다. VPN 서비스가 TUN 리스너를 통해 DNS 패킷을 넘긴다.
 * 실제 차단 판단은 DnsLibs 가 하고, 결과 이벤트(차단 규칙·필터 ID)를 그대로 기록한다.
 */
@Singleton
class DnsEngine @Inject constructor(
    private val db: AppDb,
    private val filters: FilterManager,
) {
    private var proxy: DnsProxy? = null
    private var sources: Map<Int, AdFilterSource> = emptyMap()
    private val pending = ConcurrentLinkedQueue<BlockedDnsEvent>()
    val queries = AtomicLong(); val blocked = AtomicLong()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        scope.launch { while (isActive) { delay(2000); flush() } }
    }

    val running get() = proxy != null

    @Synchronized
    fun start(ctx: Context, s: AppSettings, systemDns: List<String>, paused: Boolean) {
        stop()
        val settings = buildSettings(s, systemDns, paused)
        proxy = DnsProxy(ctx.applicationContext, settings, DnsProxyEvents { onEvent(it) })
        Log.i(TAG, "DnsProxy 시작: upstream=${settings.upstreams.map { it.address }} filters=${settings.filterParams.map { it.id }}")
    }

    /** 설정만 바꿀 때(네트워크 변경·필터 갱신·허용 목록 추가) VPN 을 다시 만들지 않고 적용한다. */
    @Synchronized
    fun reapply(s: AppSettings, systemDns: List<String>, paused: Boolean): Boolean {
        val p = proxy ?: return false
        return try {
            p.reapplySettings(buildSettings(s, systemDns, paused), EnumSet.of(DnsProxy.ReapplyOption.SETTINGS, DnsProxy.ReapplyOption.FILTERS))
            Log.i(TAG, "DnsProxy 설정 재적용"); true
        } catch (e: Exception) { Log.w(TAG, "설정 재적용 실패 → 다시 시작", e); false }
    }

    @Synchronized
    fun stop() {
        proxy?.close(); proxy = null
        flush()
    }

    fun handle(packet: ByteArray, reply: (ByteArray?) -> Unit) {
        val p = proxy
        if (p == null) { reply(null); return }
        queries.incrementAndGet()
        p.handleMessageAsync(packet, null) { reply(it) }
    }

    private fun buildSettings(s: AppSettings, systemDns: List<String>, paused: Boolean): DnsProxySettings {
        val set = DnsProxySettings.getDefault()
        val upstreams = if (s.upstream == "SYSTEM" && systemDns.isNotEmpty()) systemDns
            else if (s.upstream == "SYSTEM") listOf(AppSettings.DEFAULT_UPSTREAM) else listOf(s.upstream)
        val bootstrap = (systemDns + listOf("1.1.1.1", "8.8.8.8")).distinct()
        set.upstreams = upstreams.mapIndexed { i, a -> UpstreamSettings(a, bootstrap, emptyList(), i + 1) }
        set.fallbacks = listOf(UpstreamSettings("1.1.1.1", emptyList(), emptyList(), 100), UpstreamSettings("8.8.8.8", emptyList(), emptyList(), 101))
        set.isEnableFallbackOnUpstreamsFailure = true
        set.isIpv6Available = true
        set.dnsCacheSize = 2000
        set.isOptimisticCache = true
        set.blockedResponseTtlSecs = 10
        set.adblockRulesBlockingMode = DnsProxySettings.BlockingMode.ADDRESS
        set.hostsRulesBlockingMode = DnsProxySettings.BlockingMode.ADDRESS
        set.filterParams = if (paused) emptyList() else filterParams(s)
        return set
    }

    private fun filterParams(s: AppSettings): List<FilterParams> = kotlinx.coroutines.runBlocking {
        val list = db.dns().sourcesNow()
        sources = list.associateBy { it.id }
        val out = mutableListOf<FilterParams>()
        for (src in list) {
            if (!src.enabled || src.id == FilterCatalog.ID_USER_BLOCK) continue
            if (!FilterCatalog.categoryEnabled(src.category, s.adBlock, s.trackingBlock, s.phishingBlock)) continue
            val f = filters.fileOf(src.id)
            if (f.exists() && f.length() > 0) out += FilterParams(src.id, f.absolutePath, false)
        }
        val userBlock = db.dns().blockedNow().joinToString("\n") { FilterParser.blockRule(it.domain) }
        if (userBlock.isNotEmpty()) out += FilterParams(FilterCatalog.ID_USER_BLOCK, userBlock, true)
        // 허용 목록은 가장 높은 우선순위($important)로 넣어 다른 모든 차단 규칙보다 앞선다.
        val allow = db.dns().allowedNow().joinToString("\n") { FilterParser.allowRule(it.domain) }
        if (allow.isNotEmpty()) out += FilterParams(FilterCatalog.ID_USER_ALLOW, allow, true)
        out
    }

    private fun onEvent(e: DnsRequestProcessedEvent) {
        if (e.isWhitelist || e.rules.isNullOrEmpty()) {
            if (kr.eumsoft.securitypro.BuildConfig.DEBUG) Log.d(TAG, "pass domain=${e.domain} type=${e.type} ms=${e.elapsed} cache=${e.isCacheHit} upstream=${e.upstreamId} err=${e.error ?: ""}")
            return
        }
        val reason = e.blockingReason
        if (reason == null || reason == com.adguard.dnslibs.proxy.DnsBlockingReason.NONE) return
        val fid = e.filterListIds?.firstOrNull()
        val src = fid?.let { sources[it] }
        blocked.incrementAndGet()
        pending += BlockedDnsEvent(time = e.startTime.takeIf { it > 0 } ?: System.currentTimeMillis(),
            domain = e.domain.trimEnd('.'), qtype = e.type ?: "", category = src?.category ?: "CUSTOM",
            rule = e.rules.first(), filterId = fid, filterName = src?.name)
        if (kr.eumsoft.securitypro.BuildConfig.DEBUG) Log.i(TAG, "blocked domain=${e.domain} rule=${e.rules.first()} filter=$fid")
    }

    private fun flush() {
        if (pending.isEmpty()) return
        val batch = generateSequence { pending.poll() }.take(500).toList()
        if (batch.isNotEmpty()) scope.launch { runCatching { db.dns().insertEvents(batch) } }
    }

    companion object { const val TAG = "EUM_DNS" }
}
