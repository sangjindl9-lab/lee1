package kr.eumsoft.quick.core

/** 두벌식 한글 조합. 안드로이드 의존성이 없어 단위 테스트로 검증한다. */
object Hangul {
    const val CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
    const val JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
    val JONG = listOf(
        "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ",
        "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"
    )
    private val VOWEL_PAIR = mapOf(
        "ㅗㅏ" to 'ㅘ', "ㅗㅐ" to 'ㅙ', "ㅗㅣ" to 'ㅚ', "ㅜㅓ" to 'ㅝ', "ㅜㅔ" to 'ㅞ', "ㅜㅣ" to 'ㅟ', "ㅡㅣ" to 'ㅢ'
    )
    private val JONG_PAIR = mapOf(
        "ㄱㅅ" to 'ㄳ', "ㄴㅈ" to 'ㄵ', "ㄴㅎ" to 'ㄶ', "ㄹㄱ" to 'ㄺ', "ㄹㅁ" to 'ㄻ', "ㄹㅂ" to 'ㄼ',
        "ㄹㅅ" to 'ㄽ', "ㄹㅌ" to 'ㄾ', "ㄹㅍ" to 'ㄿ', "ㄹㅎ" to 'ㅀ', "ㅂㅅ" to 'ㅄ'
    )

    fun isConsonant(c: Char) = CHO.indexOf(c) >= 0
    fun isVowel(c: Char) = JUNG.indexOf(c) >= 0
    fun isJamo(c: Char) = isConsonant(c) || isVowel(c)

    /** 입력 자모 목록이 한 글자로 조합 가능하면 그 글자, 아니면 null */
    fun render(keys: List<Char>): String? {
        if (keys.isEmpty()) return ""
        var i = 0
        var cho: Char? = null
        if (isConsonant(keys[0])) { cho = keys[0]; i = 1 }
        var jung: Char? = null
        if (i < keys.size && isVowel(keys[i])) {
            jung = keys[i]; i++
            if (i < keys.size && isVowel(keys[i])) {
                jung = VOWEL_PAIR["$jung${keys[i]}"] ?: return null
                i++
            }
        }
        if (jung == null) return if (keys.size == 1) keys[0].toString() else null
        var jong = ""
        if (i < keys.size) {
            if (cho == null) return null
            val c1 = keys[i]
            if (!isConsonant(c1)) return null
            jong = c1.toString(); i++
            if (i < keys.size) {
                val c2 = keys[i]
                if (!isConsonant(c2)) return null
                jong = (JONG_PAIR["$c1$c2"] ?: return null).toString()
                i++
            }
            if (JONG.indexOf(jong) < 0) return null
        }
        if (i != keys.size) return null
        if (cho == null) return jung.toString()
        val code = 0xAC00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong)
        return code.toChar().toString()
    }
}

/** 키보드에서 쓰는 조합기. 현재 글자의 입력 자모를 그대로 들고 있어 삭제 시 한 자모씩 되돌린다. */
class HangulComposer {
    private val keys = ArrayList<Char>()

    val isComposing get() = keys.isNotEmpty()
    fun composing(): String = Hangul.render(keys) ?: ""

    /** 자모 하나 입력. 완성되어 확정할 글자를 반환(없으면 빈 문자열). */
    fun input(j: Char): String {
        if (Hangul.render(keys + j) != null) { keys.add(j); return "" }
        val hasJong = keys.size >= 3 && Hangul.isConsonant(keys[0]) && Hangul.isConsonant(keys[keys.size - 1]) &&
            keys.any { Hangul.isVowel(it) }
        if (Hangul.isVowel(j) && hasJong) {
            val last = keys.removeAt(keys.size - 1)
            val out = Hangul.render(keys) ?: ""
            keys.clear(); keys.add(last); keys.add(j)
            return out
        }
        val out = Hangul.render(keys) ?: ""
        keys.clear(); keys.add(j)
        return out
    }

    /** 조합 중이면 마지막 자모를 지우고 true. 조합 중이 아니면 false(일반 삭제 필요). */
    fun backspace(): Boolean {
        if (keys.isEmpty()) return false
        keys.removeAt(keys.size - 1)
        return true
    }

    fun reset() = keys.clear()

    /** 테스트·확인용: 자모 문자열을 입력하고 전체 결과를 돌려준다. */
    fun typeAll(s: String): String {
        val sb = StringBuilder()
        for (c in s) {
            if (Hangul.isJamo(c)) sb.append(input(c))
            else if (c == '\b') { if (!backspace() && sb.isNotEmpty()) sb.setLength(sb.length - 1) }
            else { sb.append(composing()); reset(); sb.append(c) }
        }
        return sb.append(composing()).toString()
    }
}
