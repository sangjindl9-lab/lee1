package kr.eumsoft.securitypro.engine.update

import kr.eumsoft.securitypro.data.ThreatHash
import kr.eumsoft.securitypro.data.ThreatRule
import kr.eumsoft.securitypro.data.ThreatSource
import kr.eumsoft.securitypro.engine.malware.Hashing
import org.json.JSONObject
import java.util.Base64

fun interface SignatureVerifier { fun verify(publicKey: ByteArray, msg: ByteArray, sig: ByteArray): Boolean }

/**
 * 서명된 위협 DB 묶음.
 * manifest.json (Ed25519 서명: manifest.json.sig) → payload 파일의 SHA-256·크기·버전을 담는다.
 * 검증 순서: 서명 → 버전(롤백 방지) → payload 크기·SHA-256 → JSON 해석.
 */
data class ThreatBundle(
    val version: Long,
    val created: String,
    val sources: List<ThreatSource>,
    val hashes: List<ThreatHash>,
    val rules: List<ThreatRule>,
    val falsePositives: List<String>,
    val phishingDomains: List<String>,
    val malwareDomains: List<String>,
) {
    data class Manifest(val format: Int, val version: Long, val created: String, val payload: String, val sha256: String, val size: Long)
    class Rejected(msg: String) : Exception(msg)

    companion object {
        /** 운영 서명 공개키 (개인키는 저장소에 없음) */
        val PUBLIC_KEY: ByteArray = Base64.getDecoder().decode("E6b1Z9gnj4hT+7w0goUYb1GBjmq+0mVcgPiEgUT89Ic=")
        const val MAX_PAYLOAD = 64L * 1024 * 1024

        fun verifyManifest(manifestBytes: ByteArray, sigText: String, currentVersion: Long, verifier: SignatureVerifier, key: ByteArray = PUBLIC_KEY): Manifest {
            val sig = runCatching { Base64.getDecoder().decode(sigText.trim()) }.getOrNull() ?: throw Rejected("서명 형식 오류")
            if (!verifier.verify(key, manifestBytes, sig)) throw Rejected("서명 검증 실패")
            val o = JSONObject(String(manifestBytes, Charsets.UTF_8))
            val m = Manifest(o.getInt("format"), o.getLong("version"), o.optString("created"), o.getString("payload"), o.getString("sha256").lowercase(), o.getLong("size"))
            if (m.format != 1) throw Rejected("지원하지 않는 형식 ${m.format}")
            if (m.version <= currentVersion) throw Rejected("새 버전 아님 (현재 $currentVersion, 받은 ${m.version}) — 롤백 거부")
            if (m.size <= 0 || m.size > MAX_PAYLOAD) throw Rejected("payload 크기 이상")
            if (!m.payload.matches(Regex("^[A-Za-z0-9._-]+$"))) throw Rejected("payload 이름 이상")
            return m
        }

        fun parsePayload(m: Manifest, payload: ByteArray): ThreatBundle {
            if (payload.size.toLong() != m.size) throw Rejected("payload 크기 불일치")
            if (Hashing.sha256(payload) != m.sha256) throw Rejected("payload SHA-256 불일치")
            val o = JSONObject(String(payload, Charsets.UTF_8))
            if (o.getLong("version") != m.version) throw Rejected("payload 버전 불일치")
            val now = System.currentTimeMillis()
            val src = o.getJSONArray("sources").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map {
                ThreatSource(code = it.getString("code"), name = it.getString("name"), url = it.optString("url"), license = it.getString("license"),
                    isTestData = it.optBoolean("test"), lastCheckedAt = it.optLong("checked", now)) } }
            val hashes = o.getJSONArray("hashes").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.mapNotNull {
                val h = it.getString("sha256").lowercase()
                if (!Hashing.isSha256(h)) null else ThreatHash(sha256 = h, threatName = it.getString("threat_name"), threatFamily = it.optString("threat_family", "-"),
                    category = it.optString("category", "MALWARE"), severity = it.optString("severity", "HIGH"), confidence = it.optInt("confidence", 90),
                    source = it.getString("source"), firstSeen = it.optString("first_seen").ifEmpty { null }, lastSeen = it.optString("last_seen").ifEmpty { null }, updatedAt = now)
            } }
            val rules = listOf("yara" to "YARA", "patterns" to "PATTERN").flatMap { (k, kind) ->
                o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map {
                    ThreatRule(kind = kind, name = it.getString("name"), body = if (kind == "PATTERN") it.getJSONObject("body").toString() else it.getString("body"),
                        severity = it.optString("severity", "MEDIUM"), confidence = it.optInt("confidence", 50), source = it.getString("source"),
                        license = it.optString("license", "-"), isTestData = it.optBoolean("test")) } }.orEmpty()
            }
            fun strings(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it).lowercase() } }.orEmpty()
            val d = o.optJSONObject("domains")
            fun dom(k: String) = d?.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it).lowercase() } }.orEmpty()
            return ThreatBundle(m.version, m.created, src, hashes, rules, strings("false_positives"), dom("phishing"), dom("malware"))
        }
    }
}
