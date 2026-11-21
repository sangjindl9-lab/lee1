package kr.eumsoft.securitypro

import kr.eumsoft.securitypro.engine.dns.FilterParser
import kr.eumsoft.securitypro.engine.malware.*
import kr.eumsoft.securitypro.engine.update.SignatureVerifier
import kr.eumsoft.securitypro.engine.update.ThreatBundle
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.SecureRandom
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** JVM 단위 테스트: 필터 해석, 서명된 업데이트 검증, APK 안전 처리, 권한 분석, 종합 판정, 패턴 엔진 */
class EngineUnitTest {
    private val repo = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "db_src").exists() }

    // ---------- 광고 필터 ----------
    @Test fun filterRulesCounted() {
        val text = "! comment\n# hosts comment\n0.0.0.0 ads.example.com\n127.0.0.1 localhost\n||tracker.example.net^\n@@||good.example.org^\nplain-domain.example\n[Adblock Plus 2.0]\n"
        assertEquals(4, FilterParser.countRules(text))
        assertTrue(FilterParser.looksValid(text))
        assertFalse(FilterParser.looksValid("<!DOCTYPE html><html>error</html>"))
    }
    @Test fun domainNormalize() {
        assertEquals("example.com", FilterParser.normalizeDomain(" https://Example.com/path?q=1 "))
        assertEquals("ads.example.com", FilterParser.normalizeDomain("*.ads.example.com"))
        assertNull(FilterParser.normalizeDomain("not a domain"))
        assertNull(FilterParser.normalizeDomain("localhost"))
        assertEquals("@@||a.com^\$important", FilterParser.allowRule("a.com"))
    }

    // ---------- 서명된 위협 DB ----------
    private fun keyPair(): Pair<Ed25519PrivateKeyParameters, ByteArray> {
        val g = Ed25519KeyPairGenerator(); g.init(Ed25519KeyGenerationParameters(SecureRandom()))
        val kp = g.generateKeyPair()
        return kp.private as Ed25519PrivateKeyParameters to (kp.public as Ed25519PublicKeyParameters).encoded
    }
    private fun sign(k: Ed25519PrivateKeyParameters, m: ByteArray): String { val s = Ed25519Signer(); s.init(true, k); s.update(m, 0, m.size); return Base64.getEncoder().encodeToString(s.generateSignature()) }
    private val bc = SignatureVerifier { pub, m, sig -> val v = Ed25519Signer(); v.init(false, Ed25519PublicKeyParameters(pub, 0)); v.update(m, 0, m.size); v.verifySignature(sig) }

    private fun payload(v: Long) = """{"version":$v,"sources":[{"code":"t","name":"T","license":"CC0","test":true}],
        "hashes":[{"sha256":"${"a".repeat(64)}","threat_name":"X","source":"T"},{"sha256":"bad","threat_name":"Y","source":"T"}],
        "yara":[{"name":"R","body":"rule R { condition: true }","source":"T"}],"patterns":[{"name":"P","body":{"strings":["x"]},"source":"T"}],
        "false_positives":[],"domains":{"phishing":["Evil.Example"],"malware":[]}}""".toByteArray()
    private fun manifest(v: Long, p: ByteArray) = """{"format":1,"version":$v,"payload":"threat-db-$v.json","sha256":"${Hashing.sha256(p)}","size":${p.size}}""".toByteArray()

    @Test fun signedBundleAccepted() {
        val (k, pub) = keyPair(); val p = payload(5); val m = manifest(5, p)
        val man = ThreatBundle.verifyManifest(m, sign(k, m), 4, bc, pub)
        val b = ThreatBundle.parsePayload(man, p)
        assertEquals(1, b.hashes.size)                // 잘못된 해시 형식은 버림
        assertEquals(listOf("evil.example"), b.phishingDomains)
        assertEquals(2, b.rules.size)
    }
    @Test fun tamperedSignatureRejected() {
        val (k, pub) = keyPair(); val p = payload(5); val m = manifest(5, p)
        val other = keyPair().first
        assertRejected("서명") { ThreatBundle.verifyManifest(m, sign(other, m), 0, bc, pub) }
        val tampered = String(m).replace("\"version\":5", "\"version\":6").toByteArray()
        assertRejected("서명") { ThreatBundle.verifyManifest(tampered, sign(k, m), 0, bc, pub) }
    }
    @Test fun rollbackRejected() {
        val (k, pub) = keyPair(); val p = payload(5); val m = manifest(5, p)
        assertRejected("롤백") { ThreatBundle.verifyManifest(m, sign(k, m), 5, bc, pub) }
        assertRejected("롤백") { ThreatBundle.verifyManifest(m, sign(k, m), 9, bc, pub) }
    }
    @Test fun payloadHashMismatchRejected() {
        val (k, pub) = keyPair(); val p = payload(5); val m = manifest(5, p)
        val man = ThreatBundle.verifyManifest(m, sign(k, m), 0, bc, pub)
        val evil = payload(5).also { it[10] = 'X'.code.toByte() }
        assertRejected("SHA-256") { ThreatBundle.parsePayload(man, evil) }
    }
    /** 저장소에 들어 있는 실제 운영 DB 가 운영 공개키로 올바르게 서명되어 있는지 */
    @Test fun shippedBundleVerifiesWithProductionKey() {
        val dir = File(repo, "app/src/main/assets/threatdb")
        val m = File(dir, "manifest.json").readBytes()
        val man = ThreatBundle.verifyManifest(m, File(dir, "manifest.json.sig").readText(), 0, bc)
        val b = ThreatBundle.parsePayload(man, File(dir, man.payload).readBytes())
        assertTrue(b.hashes.any { it.sha256 == Hashing.sha256(File(repo, "fixtures/eum-test-fixture.apk")) })
        assertTrue(b.rules.any { it.kind == "YARA" } && b.rules.any { it.kind == "PATTERN" })
        // 원격 업데이트 사본과 내장 사본이 같은 서명 데이터인지
        assertArrayEquals(m, File(repo, "db/manifest.json").readBytes())
    }
    private fun assertRejected(word: String, f: () -> Unit) {
        try { f(); fail("거부되어야 함") } catch (e: ThreatBundle.Rejected) { assertTrue(e.message, e.message!!.contains(word)) }
    }

    // ---------- APK 안전 처리 ----------
    private fun zip(f: File, vararg entries: Pair<String, ByteArray>) = ZipOutputStream(f.outputStream()).use { z ->
        entries.forEach { (n, d) -> z.putNextEntry(ZipEntry(n)); z.write(d); z.closeEntry() } }

    @Test fun zipBombDetected() {
        val f = File.createTempFile("bomb", ".apk"); zip(f, "classes.dex" to ByteArray(60 * 1024 * 1024))
        ApkArchive(f).use { z -> try { z.read("classes.dex"); fail() } catch (e: ApkArchive.BadArchive) { assertTrue(e.message!!.contains("압축 폭탄")) } }
    }
    @Test fun oversizeEntryLimited() {
        val f = File.createTempFile("big", ".apk"); zip(f, "a.bin" to ByteArray(2 * 1024 * 1024) { (it * 31).toByte() })
        ApkArchive(f, ApkArchive.Limits(maxEntryBytes = 1024 * 1024)).use { z -> try { z.read("a.bin"); fail() } catch (_: ApkArchive.BadArchive) {} }
    }
    @Test fun tooManyEntries() {
        val f = File.createTempFile("many", ".apk"); zip(f, *Array(50) { "f$it" to byteArrayOf(1) })
        ApkArchive(f, ApkArchive.Limits(maxEntries = 10)).use { z -> try { z.entries; fail() } catch (_: ApkArchive.BadArchive) {} }
    }
    @Test fun corruptedApkReported() {
        val f = File.createTempFile("bad", ".apk"); f.writeBytes("PK\u0003\u0004 not really a zip".toByteArray())
        try { ApkArchive(f); fail() } catch (e: ApkArchive.BadArchive) { assertTrue(e.message!!.contains("손상")) }
    }
    @Test fun pathTraversalWarned() {
        val f = File.createTempFile("trav", ".apk"); zip(f, "../evil.so" to byteArrayOf(1))
        ApkArchive(f).use { assertEquals(1, it.entries.size); assertTrue(it.warnings.isNotEmpty()) }
    }
    @Test fun dexHeader() {
        val fixture = File(repo, "fixtures/eum-test-fixture.apk")
        ApkArchive(fixture).use { z -> val d = DexParser.parse("classes.dex", z.read("classes.dex")); assertTrue(d.valid); assertEquals("035", d.version) }
        assertFalse(DexParser.parse("x.dex", "hello".toByteArray()).valid)
    }

    // ---------- 권한·판정 ----------
    private val P = "android.permission."
    @Test fun bankerComboIsCautionNotDanger() {
        val f = PermissionRisk.analyze(PermissionRisk.Input(listOf("${P}SYSTEM_ALERT_WINDOW", "${P}RECEIVE_SMS"), listOf("${P}BIND_ACCESSIBILITY_SERVICE"), false, false))
        assertTrue(f.any { it.key == "combo_a11y_overlay" && it.severity == "MEDIUM" })
        val findings = f.map { Finding("PERMISSION", it.severity, it.key, "", "", false, 50) }
        assertEquals(Verdict.CAUTION, VerdictEngine.decide(findings, true))
    }
    @Test fun storeAndSystemAppsDowngraded() {
        val f = PermissionRisk.analyze(PermissionRisk.Input(listOf("${P}SYSTEM_ALERT_WINDOW"), listOf("${P}BIND_ACCESSIBILITY_SERVICE"), isSystem = false, fromStore = true))
        assertTrue(f.none { it.severity == "MEDIUM" || it.severity == "HIGH" })
    }
    @Test fun normalMessengerIsNotFlaggedAsCombo() {
        val f = PermissionRisk.analyze(PermissionRisk.Input(listOf("${P}CAMERA", "${P}RECORD_AUDIO", "${P}READ_CONTACTS", "${P}INTERNET"), emptyList(), false, false))
        assertTrue(f.all { it.severity == "INFO" })
        assertEquals(Verdict.CLEAN, VerdictEngine.decide(f.map { Finding("PERMISSION", it.severity, it.key, "", "", false, 30) }, true))
    }
    @Test fun verdictRules() {
        assertEquals(Verdict.DANGER, VerdictEngine.decide(listOf(Finding("SHA256", "HIGH", "x", "", "", true, 95)), true))
        assertEquals(Verdict.CAUTION, VerdictEngine.decide(listOf(Finding("YARA", "HIGH", "x", "", "", false, 45)), true))
        assertEquals(Verdict.UNSCANNABLE, VerdictEngine.decide(emptyList(), false))
        assertEquals(Verdict.CLEAN, VerdictEngine.decide(emptyList(), true))
    }
    @Test fun patternEngineMatchesFixtureOnly() {
        val rules = org.json.JSONArray(File(repo, "db_src/patterns.json").readText())
        val eng = PatternEngine((0 until rules.length()).map { rules.getJSONObject(it) }.map {
            PatternEngine.parseRule(it.getString("name"), it.getJSONObject("body").toString(), it.getString("severity"), it.getInt("confidence"), it.getString("source"), it.getBoolean("test")) })
        val dex = ApkArchive(File(repo, "fixtures/eum-test-fixture.apk")).use { it.read("classes.dex") }
        assertEquals(listOf("EUM_TEST_Marker_P"), eng.scan("dex", dex).map { it.rule.name })
        assertTrue(eng.scan("dex", "dispatchGesture TYPE_APPLICATION_OVERLAY".toByteArray()).isEmpty())
        assertEquals(-1, PatternEngine.indexOf("abc".toByteArray(), "abcd".toByteArray()))
    }
}
