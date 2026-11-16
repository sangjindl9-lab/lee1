package kr.eumsoft.kidscoloring

import kr.eumsoft.kidscoloring.ui.BalloonLogic
import kr.eumsoft.kidscoloring.ui.MemoryLogic
import kr.eumsoft.kidscoloring.ui.PuzzleLogic
import kr.eumsoft.kidscoloring.ui.SfxSynth
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

    @Test fun `배경 음악 파일이 들어 있다`() {
        for (i in 1..2) assertTrue(File("src/main/res/raw/coloring_bgm_$i.m4a").length() > 100_000)
    }

    @Test fun `효과음은 다섯 가지이고 소리가 만들어진다`() {
        assertEquals(5, SfxSynth.kinds.size)
        for ((k, _) in SfxSynth.kinds) {
            val taps = SfxSynth.taps(k)
            assertTrue(taps.isNotEmpty())
            for (t in taps) { assertTrue(t.size in 500..30000); assertTrue(t.any { kotlin.math.abs(it) > 0.1 }); assertTrue(t.all { it.isFinite() }) }
            val c = SfxSynth.cheer(k)
            assertTrue(c.size > taps[0].size && c.all { it.isFinite() })
        }
        val f = File.createTempFile("sfx", ".wav")
        SfxSynth.writeWav(f, SfxSynth.taps(2)[0])
        val b = f.readBytes()
        assertEquals("RIFF", String(b, 0, 4)); assertEquals("WAVE", String(b, 8, 4))
        assertEquals(44 + SfxSynth.taps(2)[0].size * 2, b.size)
        f.delete()
    }
}
