package kr.eumsoft.quick

import kr.eumsoft.quick.core.CropCalc
import kr.eumsoft.quick.core.CropCalc.Box
import kr.eumsoft.quick.core.FileNames
import kr.eumsoft.quick.core.HangulComposer
import kr.eumsoft.quick.core.TextTools
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.util.Calendar

class HangulTest {
    private fun t(s: String) = HangulComposer().typeAll(s)
    @Test fun basic() { assertEquals("안녕하세요", t("ㅇㅏㄴㄴㅕㅇㅎㅏㅅㅔㅇㅛ")) }
    @Test fun jongMoves() { assertEquals("달가", t("ㄷㅏㄹㄱㅏ")); assertEquals("가가", t("ㄱㅏㄱㅏ")) }
    @Test fun compoundVowelAndJong() { assertEquals("왔닭", t("ㅇㅗㅏㅆㄷㅏㄹㄱ")); assertEquals("의사", t("ㅇㅡㅣㅅㅏ")) }
    @Test fun doubleConsonantNotJong() { assertEquals("가따", t("ㄱㅏㄸㅏ")) }
    @Test fun loneJamo() { assertEquals("ㄱㄴ", t("ㄱㄴ")); assertEquals("ㅏㄱ", t("ㅏㄱ")) }
    @Test fun backspaceByJamo() {
        assertEquals("닭", t("ㄷㅏㄹㄱ"))
        assertEquals("달", t("ㄷㅏㄹㄱ\b"))
        assertEquals("다", t("ㄷㅏㄹㄱ\b\b"))
        assertEquals("과", t("ㄱㅗㅏㄴ\b"))
        assertEquals("고", t("ㄱㅗㅏ\b"))
    }
    @Test fun mixed() { assertEquals("한 글!", t("ㅎㅏㄴ ㄱㅡㄹ!")) }
}

class CropTest {
    private val o = CropCalc.Opts()
    @Test fun portraitThreeButton() {
        val r = CropCalc.compute(1080, 2340, 1080, 2340, listOf(Box(0, 0, 1080, 84), Box(0, 2208, 1080, 2340)), o)
        assertEquals(Box(0, 84, 1080, 2208), r.box)
    }
    @Test fun gestureNavThinBar() {
        val r = CropCalc.compute(1080, 2340, 1080, 2340, listOf(Box(0, 0, 1080, 84), Box(0, 2292, 1080, 2340)), o)
        assertEquals(2292, r.box.b)
    }
    @Test fun noBarsNoCrop() {
        val r = CropCalc.compute(1080, 2340, 1080, 2340, emptyList(), o)
        assertEquals(Box(0, 0, 1080, 2340), r.box); assertFalse(r.detected)
    }
    @Test fun landscapeSideNav() {
        val r = CropCalc.compute(2340, 1080, 2340, 1080, listOf(Box(0, 0, 2340, 63), Box(2208, 0, 2340, 1080)), o)
        assertEquals(Box(0, 63, 2208, 1080), r.box)
        val off = CropCalc.compute(2340, 1080, 2340, 1080, listOf(Box(0, 0, 2340, 63), Box(2208, 0, 2340, 1080)), o.copy(sides = false))
        assertEquals(2340, off.box.r)
    }
    @Test fun scaledImage() {
        val r = CropCalc.compute(540, 1170, 1080, 2340, listOf(Box(0, 0, 1080, 84)), o)
        assertEquals(42, r.box.t)
    }
    @Test fun shadeIgnored() {
        val r = CropCalc.compute(1080, 2340, 1080, 2340, listOf(Box(0, 0, 1080, 1500)), o)
        assertEquals(0, r.box.t)
    }
    @Test fun togglesAndExtra() {
        val bars = listOf(Box(0, 0, 1080, 84), Box(0, 2208, 1080, 2340))
        val r = CropCalc.compute(1080, 2340, 1080, 2340, bars, o.copy(top = false, extraBottom = 10))
        assertEquals(0, r.box.t); assertEquals(2198, r.box.b)
    }
}

class TextToolsTest {
    @Test fun clean() {
        val s = "  안녕   하세요 \n\n  반갑습니다  "
        assertEquals("안녕 하세요\n\n반갑습니다", TextTools.clean(s, TextTools.Clean(trim = true, collapseSpaces = true)))
        assertEquals("안녕 하세요 반갑습니다", TextTools.clean(s, TextTools.Clean(trim = true, collapseSpaces = true, oneLine = true)))
        assertEquals(s, TextTools.clean(s, TextTools.Clean()))
    }
    @Test fun template() {
        val b = "안녕하세요. {회사명} {이름}입니다.\n{현장명} 관련 자료를 송부드립니다."
        assertEquals(listOf("회사명", "이름", "현장명"), TextTools.templateFields(b))
        assertEquals("안녕하세요. 이음 홍길동입니다.\n{현장명} 관련 자료를 송부드립니다.",
            TextTools.fillTemplate(b, mapOf("회사명" to "이음", "이름" to "홍길동")))
    }
    @Test fun sensitive() {
        assertNotNull(TextTools.sensitiveReason("482913"))
        assertNotNull(TextTools.sensitiveReason("[Web발신] 인증번호 [482913]를 입력하세요"))
        assertNotNull(TextTools.sensitiveReason("4111 1111 1111 1111"))
        assertNotNull(TextTools.sensitiveReason("900101-1234567"))
        assertNull(TextTools.sensitiveReason("서울시 강남구 테헤란로 123"))
        assertNull(TextTools.sensitiveReason("회의는 2026년 11월 7일입니다"))
    }
    @Test fun privateCandidates() {
        assertTrue(TextTools.looksPrivate("연락처 010-1234-5678"))
        assertTrue(TextTools.looksPrivate("메일 abc@test.co.kr"))
        assertFalse(TextTools.looksPrivate("오늘 날씨 맑음"))
    }
    @Test fun ocrMerge() {
        assertEquals("가나다 라마바.\n사아자", TextTools.mergeOcrLines("가나다\n라마바.\n사아자"))
    }
    @Test fun fileNames() {
        val c = Calendar.getInstance(); c.set(2026, 10, 7, 9, 15, 30)
        assertEquals("EUM_20261107_091530", FileNames.build("EUM_{date}_{time}", c.time))
        val taken = setOf("A", "A_1")
        assertEquals("A_2", FileNames.unique("A") { it in taken })
        assertEquals("B", FileNames.unique("B") { it in taken })
    }
}
