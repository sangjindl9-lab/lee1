package kr.eumsoft.securitypro.engine.update

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kr.eumsoft.securitypro.BuildConfig
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.SecuritySetting
import kr.eumsoft.securitypro.data.ThreatDbVersion
import kr.eumsoft.securitypro.data.UpdateHistory
import kr.eumsoft.securitypro.engine.NativeCrypto
import kr.eumsoft.securitypro.engine.dns.FilterCatalog
import kr.eumsoft.securitypro.engine.dns.FilterManager
import kr.eumsoft.securitypro.engine.malware.Hashing
import kr.eumsoft.securitypro.engine.malware.ThreatIntel
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** 위협 DB(악성 해시·YARA·패턴·오탐 수정·위협 도메인) 업데이트. 광고 필터 업데이트와 독립적으로 동작한다. */
@Singleton
class UpdateManager @Inject constructor(
    @ApplicationContext private val ctx: Context,
    private val db: AppDb,
    private val intel: ThreatIntel,
    private val filters: FilterManager,
) {
    private val lock = Mutex()
    val verifier = SignatureVerifier { k, m, s -> NativeCrypto.available && NativeCrypto.nativeVerifyEd25519(k, m, s) }

    suspend fun currentVersion(): Long = db.threat().setting(KEY)?.toLongOrNull() ?: 0

    /** 앱에 포함된 기본 DB(서명됨)를 처음 한 번 적용한다. */
    suspend fun installBundledIfNeeded() = lock.withLock {
        withContext(Dispatchers.IO) {
            val a = ctx.assets
            runCatching {
                val m = a.open("threatdb/manifest.json").readBytes()
                val sig = a.open("threatdb/manifest.json.sig").reader().readText()
                val man = ThreatBundle.verifyManifest(m, sig, currentVersion(), verifier)
                apply(ThreatBundle.parsePayload(man, a.open("threatdb/${man.payload}").readBytes()), "APK 내장")
            }
        }
    }

    /** 원격 업데이트. 반환: 결과 메시지. 실패해도 기존 DB 는 그대로 유지된다. */
    suspend fun updateRemote(): Result<String> = lock.withLock {
        withContext(Dispatchers.IO) {
            val from = currentVersion()
            val r = runCatching {
                val base = BuildConfig.DB_UPDATE_URL.substringBeforeLast('/')
                val m = FilterManager.download(BuildConfig.DB_UPDATE_URL, 64 * 1024).toByteArray()
                val sig = FilterManager.download("${BuildConfig.DB_UPDATE_URL}.sig", 4096)
                val man = try { ThreatBundle.verifyManifest(m, sig, from, verifier) }
                    catch (e: ThreatBundle.Rejected) { if (e.message?.startsWith("새 버전 아님") == true) return@runCatching "최신 버전 ($from)" else throw e }
                val payload = downloadBytes("$base/${man.payload}", man.size)
                apply(ThreatBundle.parsePayload(man, payload), "원격")
                "버전 ${man.version} 적용"
            }
            db.dns().insertHistory(UpdateHistory(time = System.currentTimeMillis(), target = "THREAT_DB", success = r.isSuccess,
                fromVersion = from.toString(), toVersion = currentVersion().toString(), message = r.getOrElse { it.message ?: "실패" }))
            r
        }
    }

    private suspend fun apply(b: ThreatBundle, via: String) {
        val now = System.currentTimeMillis()
        val versions = listOf(
            ThreatDbVersion(component = "HASHES", version = b.version, itemCount = b.hashes.size, sha256 = "", appliedAt = now),
            ThreatDbVersion(component = "YARA", version = b.version, itemCount = b.rules.count { it.kind == "YARA" }, sha256 = "", appliedAt = now),
            ThreatDbVersion(component = "PATTERNS", version = b.version, itemCount = b.rules.count { it.kind == "PATTERN" }, sha256 = "", appliedAt = now),
            ThreatDbVersion(component = "FALSE_POSITIVES", version = b.version, itemCount = b.falsePositives.size, sha256 = "", appliedAt = now),
            ThreatDbVersion(component = "DOMAINS", version = b.version, itemCount = b.phishingDomains.size + b.malwareDomains.size, sha256 = "", appliedAt = now),
        ).map { v -> db.threat().version(v.component)?.let { v.copy(id = it.id, createdAt = it.createdAt) } ?: v }
        db.threat().replaceAll(b.hashes, b.rules, b.sources, b.falsePositives, versions)
        // 위협 도메인 → DNS 필터 파일 (원자적 교체)
        val text = (b.phishingDomains + b.malwareDomains).distinct().joinToString("\n") { "||$it^" }
        val f = filters.fileOf(FilterCatalog.ID_THREAT); val tmp = File(f.parentFile, "${FilterCatalog.ID_THREAT}.tmp")
        tmp.writeText(text); tmp.renameTo(f)
        filters.ensureDefaults()
        db.dns().sourcesNow().firstOrNull { it.id == FilterCatalog.ID_THREAT }?.let {
            db.dns().updateSource(it.copy(ruleCount = b.phishingDomains.size + b.malwareDomains.size, lastUpdatedAt = now, lastResult = "OK", sha256 = Hashing.sha256(text.toByteArray())))
        }
        db.threat().putSetting(SecuritySetting(KEY, b.version.toString(), updatedAt = now))
        intel.invalidate()
        android.util.Log.i("EUM_UPDATE", "위협 DB ${b.version} 적용 ($via): 해시 ${b.hashes.size}, 규칙 ${b.rules.size}")
    }

    private fun downloadBytes(url: String, expected: Long): ByteArray {
        val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 60_000
        try {
            if (c.responseCode !in 200..299) error("HTTP ${c.responseCode}")
            return c.inputStream.use { ins ->
                val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(64 * 1024); var total = 0L
                while (true) { val n = ins.read(buf); if (n < 0) break; total += n; if (total > expected) error("크기 초과"); out.write(buf, 0, n) }
                out.toByteArray()
            }
        } finally { c.disconnect() }
    }

    companion object { const val KEY = "threat_db_version" }
}
