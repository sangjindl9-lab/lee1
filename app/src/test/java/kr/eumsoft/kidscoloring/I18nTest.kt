package kr.eumsoft.kidscoloring

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 다국어: 화면에 나오는 모든 한국어 문장이 지원 언어 전부에 번역되어 있는지 검사한다. */
class I18nTest {
    private val assets = File("src/main/assets")
    private val langs = I18n.supported.filter { it != "ko" }
    private val maps = langs.associateWith { l -> JSONObject(File(assets, "i18n/$l.json").readText()) }
    private val hangul = Regex("[가-힣]")
    private val literal = Regex("\"((?:[^\"\\\\]|\\\\.)*)\"")

    private fun unescape(s: String) = s.replace("\\$", "$").replace("\\n", "\n").replace("\\\"", "\"").replace("\\'", "'")

    /** 소스에서 화면에 나오는 한국어 문자열을 모은다 (주석과 내부 오류 메시지는 뺀다). */
    private fun sourceKeys(): Set<String> {
        val keys = LinkedHashSet<String>()
        File("src/main/java").walkTopDown().filter { it.extension == "kt" && it.name != "I18n.kt" }.forEach { f ->
            for (raw in f.readLines()) {
                val line = raw.trim()
                if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || "IOException(" in line) continue
                val code = line.substringBefore(" // ")
                for (m in literal.findAll(code)) {
                    val s = m.groupValues[1]
                    if (hangul.containsMatchIn(s)) keys.add(unescape(s))
                }
            }
        }
        return keys
    }

    private fun catalogKeys(): List<String> {
        val c = JSONObject(File(assets, "art/catalog.json").readText())
        val cats = c.getJSONArray("categories"); val arts = c.getJSONArray("artworks")
        return List(cats.length()) { cats.getJSONObject(it).getString("title") } + List(arts.length()) { arts.getJSONObject(it).getString("title") }
    }

    @Test fun `지원 언어는 11개이고 번역 파일이 모두 있다`() {
        assertEquals(11, I18n.supported.size)
        for (l in langs) assertTrue(l, maps.getValue(l).length() > 150)
    }

    @Test fun `화면의 모든 문장과 도안 제목이 모든 언어로 번역되어 있다`() {
        val keys = sourceKeys() + catalogKeys()
        assertTrue(keys.size > 150)
        val missing = ArrayList<String>()
        for (k in keys) {
            assertTrue("문장 안에 \$변수를 직접 쓰지 말고 tr(\"%1\\\$s\", 값) 형태로 쓴다: $k", !Regex("(?<!%\\d)\\$[a-zA-Z{]").containsMatchIn(k))
            for (l in langs) {
                val m = maps.getValue(l)
                if (!m.has(k) || m.getString(k).isBlank()) missing.add("$l: $k")
            }
        }
        assertTrue("번역 없음:\n" + missing.joinToString("\n"), missing.isEmpty())
    }

    @Test fun `번역문은 원문과 같은 자리표시자와 줄 수를 가진다`() {
        val ph = Regex("%\\d\\$[sd]")
        for (l in langs) {
            val m = maps.getValue(l)
            for (k in m.keys()) {
                val v = m.getString(k)
                assertEquals("$l: $k", ph.findAll(k).map { it.value }.sorted().toList(), ph.findAll(v).map { it.value }.sorted().toList())
                assertEquals("$l: $k", k.count { it == '\n' }, v.count { it == '\n' })
            }
        }
    }

    @Test fun `기기 언어에 맞는 번역을 고르고 모르는 언어는 영어로 보여 준다`() {
        assertEquals("ko", I18n.pick("ko")); assertEquals("ja", I18n.pick("ja")); assertEquals("id", I18n.pick("in")); assertEquals("id", I18n.pick("id"))
        assertEquals("zh-CN", I18n.pick("zh", "", "CN")); assertEquals("zh-TW", I18n.pick("zh", "", "TW")); assertEquals("zh-TW", I18n.pick("zh", "Hant", "CN"))
        assertEquals("zh-CN", I18n.pick("zh", "Hans", "HK")); assertEquals("zh-TW", I18n.pick("zh", "", "HK"))
        assertEquals("pt", I18n.pick("pt", "", "BR")); assertEquals("en", I18n.pick("ar")); assertEquals("en", I18n.pick("ru")); assertEquals("en", I18n.pick(""))
    }

    @Test fun `번역이 없으면 한국어 원문이 그대로 나온다`() {
        assertEquals("홈", tr("홈"))
        assertEquals("토끼 열기", tr("%1\$s 열기", "토끼"))
    }
}
