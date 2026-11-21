package kr.eumsoft.securitypro.engine.dns

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
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

    suspend fun ensureDefaults() = db.dns().insertSourcesIfMissing(FilterCatalog.defaults)

    /** 목록 하나를 내려받는다. 성공하면 원자적으로 교체한다. */
    suspend fun update(src: AdFilterSource): Result<Int> = withContext(Dispatchers.IO) {
        if (src.url.isBlank()) return@withContext Result.success(src.ruleCount)
        val r = runCatching {
            val text = download(src.url, MAX_BYTES)
            require(FilterParser.looksValid(text)) { "필터 형식이 아님" }
            val count = FilterParser.countRules(text)
            val tmp = File(dir, "${src.id}.tmp")
            tmp.writeText(text)
            check(tmp.renameTo(fileOf(src.id))) { "파일 교체 실패" }
            db.dns().updateSource(src.copy(ruleCount = count, lastUpdatedAt = System.currentTimeMillis(),
                lastResult = "OK", sha256 = Hashing.sha256(text.toByteArray()), updatedAt = System.currentTimeMillis()))
            count
        }
        r.onFailure { e ->
            db.dns().updateSource(src.copy(lastResult = "FAIL:${e.message?.take(120)}", updatedAt = System.currentTimeMillis()))
        }
        db.dns().insertHistory(UpdateHistory(time = System.currentTimeMillis(), target = "AD_FILTER:${src.code}",
            success = r.isSuccess, fromVersion = src.sha256?.take(12) ?: "-",
            toVersion = if (r.isSuccess) "rules=${r.getOrNull()}" else "-", message = r.exceptionOrNull()?.message ?: "OK"))
        r
    }

    /** 사용 중인(또는 아직 받지 않은) 목록을 모두 갱신. 반환: (성공 수, 실패 수) */
    suspend fun updateAll(onlyEnabled: Boolean = true): Pair<Int, Int> {
        ensureDefaults()
        var ok = 0; var fail = 0
        for (s in db.dns().sourcesNow()) {
            if (s.url.isBlank() || (onlyEnabled && !s.enabled)) continue
            if (update(s).isSuccess) ok++ else fail++
        }
        return ok to fail
    }

    fun hasFile(id: Int) = fileOf(id).let { it.exists() && it.length() > 0 }

    companion object {
        const val MAX_BYTES = 40L * 1024 * 1024

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
