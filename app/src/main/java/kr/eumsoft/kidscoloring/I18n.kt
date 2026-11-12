package kr.eumsoft.kidscoloring

import android.content.Context
import org.json.JSONObject
import java.util.Locale

/**
 * 다국어 지원. 코드 안의 한국어 문장을 그대로 열쇠로 쓰고, 언어별 번역은
 * assets/i18n/<언어>.json ("한국어 문장": "번역") 에서 찾는다. 번역이 없으면 한국어가 그대로 나온다.
 * 기기 언어가 지원 목록에 없으면 영어로 보여 준다.
 */
object I18n {
    /** 지원 언어 (ko 는 원문) */
    val supported = listOf("ko", "en", "ja", "es", "pt", "zh-CN", "zh-TW", "de", "fr", "id", "hi")

    @Volatile private var map: Map<String, String> = emptyMap()
    @Volatile var lang: String = "ko"; private set

    /** 음성 안내(TTS)와 같은 곳에 쓰는 현재 언어 */
    val locale: Locale get() = when (lang) {
        "zh-CN" -> Locale.SIMPLIFIED_CHINESE
        "zh-TW" -> Locale.TRADITIONAL_CHINESE
        else -> Locale(lang)
    }

    /** 기기 언어 → 지원 언어. 순수 함수 (단위 테스트 대상) */
    fun pick(language: String, script: String = "", country: String = ""): String = when (language.lowercase(Locale.ROOT)) {
        "ko" -> "ko"
        "ja" -> "ja"
        "es" -> "es"
        "pt" -> "pt"
        "de" -> "de"
        "fr" -> "fr"
        "hi" -> "hi"
        "in", "id" -> "id"
        "zh" -> if (script.equals("Hant", true) || (script.isEmpty() && country.uppercase(Locale.ROOT) in setOf("TW", "HK", "MO"))) "zh-TW" else "zh-CN"
        else -> "en"
    }

    /**
     * 현재 기기 언어에 맞춰 번역을 읽는다. forced 를 주면(테스트용: 실행 인텐트의 lang 값) 그 언어로 고정하고 기억한다.
     * forced = "auto" 는 고정을 푼다.
     */
    fun init(ctx: Context, forced: String? = null) {
        val prefs = ctx.applicationContext.getSharedPreferences("i18n", Context.MODE_PRIVATE)
        if (forced != null) {
            if (forced in supported) prefs.edit().putString("lang", forced).apply() else prefs.edit().remove("lang").apply()
        }
        val fixed = prefs.getString("lang", null)
        val loc = ctx.resources.configuration.locales[0]
        val l = if (fixed != null && fixed in supported) fixed else pick(loc.language, loc.script ?: "", loc.country ?: "")
        if (l == lang && (l == "ko" || map.isNotEmpty())) return
        map = if (l == "ko") emptyMap() else try {
            val o = JSONObject(ctx.assets.open("i18n/$l.json").bufferedReader().use { it.readText() })
            HashMap<String, String>(o.length() * 2).also { m -> for (k in o.keys()) m[k] = o.getString(k) }
        } catch (e: Exception) { emptyMap() }
        lang = l
    }

    fun t(ko: String): String = map[ko] ?: ko
}

/** 한국어 원문을 현재 언어로 바꾼다. args 가 있으면 %1$s, %2$d 자리에 넣는다. */
fun tr(ko: String, vararg args: Any?): String {
    val s = I18n.t(ko)
    return if (args.isEmpty()) s else try { String.format(Locale.ROOT, s, *args) } catch (e: java.util.IllegalFormatException) { s }
}
