package kr.eumsoft.quick.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 문구 정리·합치기·템플릿·민감정보 감지. 안드로이드 의존성 없음. */
object TextTools {
    data class Clean(val trim: Boolean = false, val collapseSpaces: Boolean = false, val oneLine: Boolean = false)

    fun clean(s: String, o: Clean): String {
        var t = s.replace("\r\n", "\n")
        if (o.oneLine) t = t.replace(Regex("[ \\t]*\\n+[ \\t]*"), " ")
        if (o.collapseSpaces) t = t.replace(Regex("[ \\t\\u00A0\\u3000]{2,}"), " ")
        if (o.trim) t = t.lines().joinToString("\n") { it.trim() }.trim()
        return t
    }

    fun join(items: List<String>, sep: String): String = items.joinToString(sep)

    /** OCR 줄바꿈 정리: 문장이 끝나지 않은 줄은 다음 줄과 이어 붙인다. 빈 줄은 문단으로 유지. */
    fun mergeOcrLines(s: String): String {
        val out = StringBuilder()
        for (raw in s.lines()) {
            val line = raw.trim()
            if (line.isEmpty()) { if (out.isNotEmpty() && !out.endsWith("\n\n")) out.append("\n\n"); continue }
            if (out.isEmpty() || out.endsWith("\n")) out.append(line)
            else {
                val last = out.last()
                if (last in ".!?。:;)") out.append('\n').append(line)
                else out.append(' ').append(line)
            }
        }
        return out.toString().trim()
    }

    private val FIELD = Regex("\\{([^{}\\n]{1,20})\\}")
    fun templateFields(body: String): List<String> = FIELD.findAll(body).map { it.groupValues[1] }.distinct().toList()
    fun fillTemplate(body: String, values: Map<String, String>): String =
        FIELD.replace(body) { m -> values[m.groupValues[1]] ?: m.value }

    /**
     * 민감 정보로 보이는지 검사. 감지는 완벽하지 않다(누락·오탐 가능).
     * @return 이유(예: "인증번호로 보임") 또는 null
     */
    fun sensitiveReason(text: String): String? {
        val t = text.trim()
        if (t.isEmpty()) return null
        val compact = t.replace(Regex("[\\s-]"), "")
        if (Regex("^\\d{4,8}$").matches(compact)) return "인증번호로 보이는 숫자"
        if (t.length <= 200 && Regex("(인증|확인|승인|보안|OTP|otp|code|Code|CODE|코드)").containsMatchIn(t) &&
            Regex("(?<!\\d)\\d{4,8}(?!\\d)").containsMatchIn(t)) return "인증번호 문자로 보임"
        if (Regex("(?<!\\d)\\d{6}-?[1-4]\\d{6}(?!\\d)").containsMatchIn(t)) return "주민등록번호 형식"
        Regex("(?<![\\d])(?:\\d[ -]?){13,19}(?![\\d])").findAll(t).forEach {
            val d = it.value.filter(Char::isDigit)
            if (d.length in 13..19 && luhn(d)) return "카드번호 형식"
        }
        return null
    }

    fun luhn(d: String): Boolean {
        var sum = 0
        var dbl = false
        for (i in d.length - 1 downTo 0) {
            var n = d[i] - '0'
            if (dbl) { n *= 2; if (n > 9) n -= 9 }
            sum += n; dbl = !dbl
        }
        return sum % 10 == 0
    }

    /** 가리기 후보(전화번호·이메일 등) */
    private val PRIVATE = listOf(
        Regex("01[016789][-. ]?\\d{3,4}[-. ]?\\d{4}"),
        Regex("0\\d{1,2}[-. )]\\d{3,4}[-. ]\\d{4}"),
        Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"),
        Regex("\\d{6}-?[1-4]\\d{6}"),
        Regex("(?:\\d{4}[- ]){3}\\d{4}"),
        Regex("\\d{2,6}-\\d{2,6}-\\d{2,8}")
    )
    fun looksPrivate(line: String): Boolean = PRIVATE.any { it.containsMatchIn(line) }

    fun preview(s: String, max: Int = 60): String {
        val one = s.replace(Regex("\\s+"), " ").trim()
        return if (one.length > max) one.take(max) + "…" else one
    }
}

object FileNames {
    /** 패턴 예: EUM_{date}_{time} → EUM_20261107_091530 */
    fun build(pattern: String, date: Date): String {
        val d = SimpleDateFormat("yyyyMMdd", Locale.US).format(date)
        val t = SimpleDateFormat("HHmmss", Locale.US).format(date)
        val raw = pattern.ifBlank { "EUM_{date}_{time}" }.replace("{date}", d).replace("{time}", t)
        return raw.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    }

    /** 이름이 겹치면 _1, _2 … 를 붙인다. */
    fun unique(base: String, exists: (String) -> Boolean): String {
        if (!exists(base)) return base
        var i = 1
        while (exists("${base}_$i")) i++
        return "${base}_$i"
    }
}
