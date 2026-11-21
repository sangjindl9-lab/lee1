package kr.eumsoft.securitypro.engine.dns

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kr.eumsoft.securitypro.data.AdFilterSource
import kr.eumsoft.securitypro.data.AppDb
import kr.eumsoft.securitypro.data.UpdateHistory
import kr.eumsoft.securitypro.engine.malware.Hashing
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

/** 광고·추적·피싱 필터 목록 내려받기·저장·검증. 실패하면 기존 파일을 그대로 쓴다. */
@Singleton
class FilterManager @Inject constructor(
    @ApplicationContext private val ctx: Context,
    private val db: AppDb,
) {
    private val dir = File(ctx.filesDir, "filters").apply { mkdirs() }
    fun fileOf(id: Int) = File(dir, "$id.txt")

    private val lock = kotlinx.coroutines.sync.Mutex()

    /** 기본 목록을 넣고, 앱 업데이트로 바뀐 출처 정보(주소·이름·라이선스)는 사용자 설정(켜짐 여부)을 유지한 채 갱신한다. */
    suspend fun ensureDefaults() {
        db.dns().insertSourcesIfMissing(FilterCatalog.defaults)
        val now = db.dns().sourcesNow().associateBy { it.id }
        for (d in FilterCatalog.defaults) {
            val cur = now[d.id] ?: continue
            if (cur.url != d.url || cur.code != d.code || cur.name != d.name || cur.license != d.license || cur.category != d.category)
                db.dns().updateSource(cur.copy(code = d.code, name = d.name, url = d.url, license = d.license, category = d.category,
                    ruleCount = if (cur.url != d.url) 0 else cur.ruleCount, lastResult = if (cur.url != d.url) null else cur.lastResult,
                    updatedAt = System.currentTimeMillis()))
        }
    }

    /** 목록 하나를 내려받는다. 성공하면 원자적으로 교체한다. */
    suspend fun update(src: AdFilterSource): Result<Int> = withContext(Dispatchers.IO + kotlinx.coroutines.NonCancellable) { lock.withLock { updateLocked(src) } }

    private suspend fun updateLocked(src: AdFilterSource): Result<Int> {
        if (src.url.isBlank()) return Result.success(src.ruleCount)
        val r = runCatching {
            // 수십 MB 목록을 메모리에 올리지 않고 파일로 바로 받으면서 규칙 수·SHA-256 을 계산한다
            val tmp = File(dir, "${src.id}.${System.nanoTime()}.tmp")
            try {
                val (count, sha) = downloadToFile(src.url, tmp, MAX_BYTES)
                require(count > 0) { "필터 형식이 아님" }
                check(tmp.renameTo(fileOf(src.id))) { "파일 교체 실패" }
                db.dns().updateSource(src.copy(ruleCount = count, lastUpdatedAt = System.currentTimeMillis(),
                    lastResult = "OK", sha256 = sha, updatedAt = System.currentTimeMillis()))
                count
            } finally { tmp.delete() }
        }
        r.onFailure { e ->
            android.util.Log.w("EUM_FILTER", "필터 업데이트 실패 ${src.code}: ${e.message}")
            db.dns().updateSource(src.copy(lastResult = "FAIL:${e.message?.take(120)}", updatedAt = System.currentTimeMillis()))
        }
        db.dns().insertHistory(UpdateHistory(time = System.currentTimeMillis(), target = "AD_FILTER:${src.code}",
            success = r.isSuccess, fromVersion = src.sha256?.take(12) ?: "-",
            toVersion = if (r.isSuccess) "rules=${r.getOrNull()}" else "-", message = r.exceptionOrNull()?.message ?: "OK"))
        return r
    }

    /** 사용 중인(또는 아직 받지 않은) 목록을 모두 갱신. 반환: (성공 수, 실패 수) */
    suspend fun updateAll(onlyEnabled: Boolean = true): Pair<Int, Int> = withContext(Dispatchers.IO + kotlinx.coroutines.NonCancellable) {
        ensureDefaults()
        var ok = 0; var fail = 0
        for (s in db.dns().sourcesNow()) {
            if (s.url.isBlank() || (onlyEnabled && !s.enabled)) continue
            if (update(s).isSuccess) ok++ else fail++
        }
        ok to fail
    }

    fun hasFile(id: Int) = fileOf(id).let { it.exists() && it.length() > 0 }

    companion object {
        const val MAX_BYTES = 40L * 1024 * 1024

        /** 받은 내용을 파일로 저장하고 (규칙 수, SHA-256) 을 돌려준다. HTML 오류 페이지는 거부한다. */
        fun downloadToFile(url: String, out: File, maxBytes: Long): Pair<Int, String> {
            require(url.startsWith("https://")) { "HTTPS 주소만 허용" }
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000; c.readTimeout = 30_000
            c.setRequestProperty("User-Agent", "EUM-Security-Pro/1.0")
            try {
                if (c.responseCode !in 200..299) error("HTTP ${c.responseCode}")
                val md = java.security.MessageDigest.getInstance("SHA-256")
                var count = 0; var total = 0L; var head = true
                c.inputStream.use { ins ->
                    val dis = java.security.DigestInputStream(ins, md)
                    out.bufferedWriter().use { w ->
                        dis.bufferedReader(Charsets.UTF_8).forEachLine { line ->
                            total += line.length + 1
                            if (total > maxBytes) error("파일이 너무 큼")
                            if (head) { val l = line.lowercase(); require(!l.contains("<html") && !l.contains("<!doctype")) { "필터 형식이 아님" } }
                            if (total > 2000) head = false
                            if (FilterParser.isRule(line)) count++
                            w.write(line); w.write("\n")
                        }
                    }
                }
                return count to Hashing.hex(md.digest())
            } finally { c.disconnect() }
        }

        fun download(url: String, maxBytes: Long): String {
            require(url.startsWith("https://")) { "HTTPS 주소만 허용" }
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000; c.readTimeout = 30_000
            c.setRequestProperty("User-Agent", "EUM-Security-Pro/1.0")
            try {
                if (c.responseCode !in 200..299) error("HTTP ${c.responseCode}")
                val out = java.io.ByteArrayOutputStream()
                c.inputStream.use { ins ->
                    val buf = ByteArray(64 * 1024); var total = 0L
                    while (true) {
                        val n = ins.read(buf); if (n < 0) break
                        total += n; if (total > maxBytes) error("파일이 너무 큼")
                        out.write(buf, 0, n)
                    }
                }
                return out.toString(Charsets.UTF_8.name())
            } finally { c.disconnect() }
        }
    }
}
