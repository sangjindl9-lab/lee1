package kr.eumsoft.securitypro

import android.content.pm.PackageManager
import android.util.Log
import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.engine.NativeCore
import kr.eumsoft.securitypro.engine.NativeCrypto
import kr.eumsoft.securitypro.engine.malware.*
import kr.eumsoft.securitypro.engine.update.ThreatBundle
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** 실제 기기/에뮬레이터에서 네이티브 엔진·APK 분석·DB 를 검증한다. 결과는 logcat 태그 EUMTEST 로 남긴다. */
@RunWith(AndroidJUnit4::class)
class DeviceEngineTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val ctx = inst.targetContext
    private fun log(m: String) = Log.i("EUMTEST", m)

    private fun fixture(): File {
        val f = File(ctx.cacheDir, "eum-test-fixture.apk")
        inst.context.assets.open("eum-test-fixture.apk").use { i -> f.outputStream().use { i.copyTo(it) } }
        return f
    }

    @Test fun nativeModulesLoad() {
        log("ABI=${android.os.Build.SUPPORTED_ABIS.joinToString()} yara=${NativeCore.available} crypto=${NativeCrypto.available}")
        assertTrue("서명 검증 모듈", NativeCrypto.available)
        assertTrue("YARA-X 모듈: ${NativeCore.loadError}", NativeCore.available)
        log("YARA version=${NativeCore.nativeVersion()}")
    }

    @Test fun yaraScansFixtureWithShippedRules() {
        val m = ctx.assets.open("threatdb/manifest.json").readBytes()
        val sig = ctx.assets.open("threatdb/manifest.json.sig").reader().readText()
        val verifier = kr.eumsoft.securitypro.engine.update.SignatureVerifier { k, msg, s -> NativeCrypto.nativeVerifyEd25519(k, msg, s) }
        val man = ThreatBundle.verifyManifest(m, sig, 0, verifier)
        val b = ThreatBundle.parsePayload(man, ctx.assets.open("threatdb/${man.payload}").readBytes())
        log("내장 위협 DB 서명 검증 OK: version=${b.version} hashes=${b.hashes.size} rules=${b.rules.size}")
        // 위조된 manifest 는 네이티브 Ed25519 검증에서 거부되어야 한다
        val forged = String(m).replace(man.sha256, "0".repeat(64)).toByteArray()
        try { ThreatBundle.verifyManifest(forged, sig, 0, verifier); fail("위조 통과") } catch (e: ThreatBundle.Rejected) { log("위조 manifest 거부 OK: ${e.message}") }

        val (eng, err) = YaraEngine.create(b.rules.filter { it.kind == "YARA" }.map { it.body })
        assertNotNull("YARA 컴파일: $err", eng)
        val dex = ApkArchive(fixture()).use { it.read("classes.dex") }
        val t0 = System.nanoTime()
        val hits = eng!!.scan(dex)
        log("YARA 픽스처 일치=${hits.map { it.rule }} (${(System.nanoTime() - t0) / 1000} us)")
        assertTrue(hits.any { it.rule == "EUM_TEST_Marker" })
        assertTrue(eng.scan("normal content".toByteArray()).isEmpty())
        // 성능: 8MB 무작위 데이터 검사 시간
        val big = ByteArray(8 * 1024 * 1024) { (it * 7919).toByte() }
        val t1 = System.nanoTime(); eng.scan(big); log("YARA 8MB 검사 ${(System.nanoTime() - t1) / 1_000_000} ms")
        eng.close()
    }

    @Test fun analyzerFlagsFixtureAndPassesOwnApk() = runBlocking {
        val db = androidx.room.Room.inMemoryDatabaseBuilder(ctx, AppDb::class.java).build()
        val um = kr.eumsoft.securitypro.engine.update.UpdateManager(ctx, db, ThreatIntel(db), kr.eumsoft.securitypro.engine.dns.FilterManager(ctx, db))
        um.installBundledIfNeeded()
        assertTrue(um.currentVersion() > 0)
        val intel = ThreatIntel(db); val an = ApkAnalyzer(intel)
        val t0 = System.currentTimeMillis()
        val r = an.analyze(fixture(), ctx.packageManager)
        val v = VerdictEngine.decide(r.findings, r.coreScanDone)
        log("픽스처: verdict=$v ${System.currentTimeMillis() - t0}ms engines=${r.engines} findings=${r.findings.map { "${it.engine}:${it.title}:${it.confirmed}" }} notScanned=${r.notScanned}")
        assertEquals(Verdict.DANGER, v)
        assertTrue(r.findings.any { it.engine == "SHA256" && it.confirmed && it.isTestData })
        assertTrue(r.findings.any { it.engine == "YARA" })

        val own = File(ctx.packageCodePath)
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS or PackageManager.GET_SERVICES or PackageManager.GET_SIGNING_CERTIFICATES)
        val t1 = System.currentTimeMillis()
        val r2 = an.analyze(own, ctx.packageManager, pi)
        log("앱 자신: verdict=${VerdictEngine.decide(r2.findings, r2.coreScanDone)} ${System.currentTimeMillis() - t1}ms size=${r2.size} dex=${r2.dex.size} so=${r2.nativeLibs.size} findings=${r2.findings.map { it.title }}")
        assertNotEquals(Verdict.DANGER, VerdictEngine.decide(r2.findings, r2.coreScanDone))
        // 정적 매니페스트 파서가 PackageManager 와 같은 값을 읽는지
        assertEquals(ctx.packageName, r2.manifest?.packageName)
        assertEquals(pi.versionName, r2.manifest?.versionName)
        assertTrue(r2.manifest!!.permissions.containsAll(pi.requestedPermissions!!.toList()))
        assertTrue(r2.manifest!!.services.any { it.permission == "android.permission.BIND_VPN_SERVICE" })
        assertTrue(r2.certSha256.isNotEmpty())
        db.close()
    }

    @get:Rule val helper = MigrationTestHelper(inst, AppDb::class.java)

    @Test fun databaseSchemaV1() {
        helper.createDatabase("mig-test", 1).use { db ->
            val c = db.query("SELECT name FROM sqlite_master WHERE type='table'")
            val tables = generateSequence { if (c.moveToNext()) c.getString(0) else null }.toSet()
            log("테이블: ${tables.sorted()}")
            assertTrue(tables.containsAll(listOf("scan_sessions", "scan_results", "scan_findings", "installed_apps", "threat_hashes", "threat_rules",
                "threat_sources", "threat_db_versions", "ad_filter_rules", "ad_filter_sources", "blocked_dns_events", "allowed_domains",
                "blocked_domains", "vpn_sessions", "update_history", "security_settings")))
        }
        helper.runMigrationsAndValidate("mig-test", 1, true, *AppDb.MIGRATIONS)
    }
}
