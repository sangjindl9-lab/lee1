package kr.eumsoft.kidscoloring

import kr.eumsoft.kidscoloring.ui.BalloonLogic
import kr.eumsoft.kidscoloring.ui.FxSynth
import kr.eumsoft.kidscoloring.ui.MemoryLogic
import kr.eumsoft.kidscoloring.ui.PuzzleLogic
import kr.eumsoft.kidscoloring.ui.Tunes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.random.Random

/** 놀이터 미니 게임과 배경 음악 */
class GamesTest {
    @Test fun `퍼즐은 섞인 상태로 시작하고 모든 조각이 한 번씩 있다`() {
        for (n in listOf(4, 9, 16)) repeat(50) { seed ->
            val l = PuzzleLogic.shuffled(n, Random(seed))
            assertFalse(PuzzleLogic.solved(l))
            assertEquals((0 until n).toList(), l.sorted())
        }
        assertTrue(PuzzleLogic.solved(listOf(0, 1, 2, 3)))
    }

    @Test fun `짝 맞추기 카드는 그림마다 정확히 두 장이다`() {
        val ids = (1..42).map { "a$it" }
        for (p in listOf(3, 6, 8)) {
            val d = MemoryLogic.deal(ids, p, Random(p))
            assertEquals(p * 2, d.size)
            assertTrue(d.groupingBy { it }.eachCount().values.all { it == 2 })
        }
    }

    @Test fun `풍선 색은 서로 다르고 이름이 있다`() {
        val c = BalloonLogic.colors
        assertTrue(c.size >= 6)
        assertEquals(c.size, c.map { it.name }.toSet().size)
        assertEquals(c.size, c.map { it.argb }.toSet().size)
    }

    @Test fun `동요 악보를 읽을 수 있다`() {
        assertEquals(6, Tunes.songs.size)
        for ((notes, beat) in Tunes.songs) {
            assertTrue(notes.size > 10)
            assertTrue(beat in 0.2f..1f)
            assertTrue(notes.all { it.midi == -1 || it.midi in 55..90 })
        }
        // C4 = 60, A4 = 69
        assertEquals(listOf(60, 69, -1, 61), Tunes.parse("C4 A4 R:2 C#4").map { it.midi })
    }

    @Test fun `색칠 배경 음악 파일이 들어 있다`() {
        for (i in 1..2) assertTrue(File("src/main/res/raw/coloring_bgm_$i.m4a").length() > 100_000)
    }

    @Test fun `효과음은 짧고 부드럽게 시작해서 끝나며 깨지지 않는다`() {
        val sounds = (0 until 5).map { FxSynth.pop(it) } + listOf(FxSynth.cheer())
        for (pcm in sounds) {
            val peak = pcm.maxOf { kotlin.math.abs(it.toInt()) }
            assertTrue("소리가 난다", peak > 3000)
            assertTrue("깨지지 않는다(최대 $peak)", peak < 30000)
            assertTrue("딱 소리 없이 시작·끝", kotlin.math.abs(pcm.first().toInt()) < 300 && kotlin.math.abs(pcm.last().toInt()) < 300)
        }
        assertTrue(FxSynth.pop(0).size < FxSynth.RATE / 5)
        assertTrue(FxSynth.cheer().size < FxSynth.RATE * 3 / 2)
    }
}
