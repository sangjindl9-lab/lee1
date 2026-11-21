package kr.eumsoft.purchasenote.shop

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.core.ImportParser
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 가져오기 규칙: 앱 내장본 → (있으면) 내려받아 둔 더 새 버전.
 * 서버에는 아무 것도 보내지 않고 규칙 파일만 받는다. 주소는 ImportParser.ALLOWED_HOSTS 밖이면 무시된다.
 */
object RuleStore {
    const val REMOTE = "https://eum-purchase-note-production.up.railway.app/rules/v1.json"
    private fun cache(c: Context) = File(c.filesDir, "import_rules.json")

    fun load(c: Context): ImportParser.Rules {
        val bundled = ImportParser.parseRules(c.assets.open("import_rules.json").bufferedReader().readText())
        val cached = runCatching { ImportParser.parseRules(cache(c).readText()) }.getOrNull()
        return if (cached != null && cached.version > bundled.version && cached.malls.isNotEmpty()) cached else bundled
    }

    /** 새 규칙 받기(실패해도 조용히 내장본 사용). 받은 내용이 올바른 규칙일 때만 저장 */
    suspend fun refresh(c: Context): Boolean = withContext(Dispatchers.IO) {
        try {
            val con = URL(REMOTE).openConnection() as HttpURLConnection
            con.connectTimeout = 5000; con.readTimeout = 5000; con.useCaches = false
            con.setRequestProperty("Accept", "application/json")
            if (con.responseCode != 200) return@withContext false
            val text = con.inputStream.use { it.readBytes() }.takeIf { it.size < 512 * 1024 }?.toString(Charsets.UTF_8) ?: return@withContext false
            val r = ImportParser.parseRules(text)
            if (r.malls.isEmpty() || r.version <= load(c).version) return@withContext false
            val tmp = File(c.filesDir, "import_rules.tmp"); tmp.writeText(text); tmp.renameTo(cache(c))
        } catch (e: Exception) { false }
    }
}
