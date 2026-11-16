package kr.eumsoft.kidscoloring.ui

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * 효과음 소리 합성 (음원 파일 없이 앱 안에서 만든다).
 * 종류마다 칠할 때 나는 짧은 소리 몇 가지와 완성했을 때의 축하 소리가 있다.
 */
object SfxSynth {
    const val RATE = 22050

    /** 효과음 종류: 번호(설정값) → 이모지, 이름. 0 번은 쓰지 않는다 (끄기는 설정의 soundEnabled) */
    val kinds = listOf(1 to "🫧", 2 to "🎹", 3 to "💧", 4 to "✨", 5 to "🥁")

    private fun hz(midi: Int) = 440.0 * 2.0.pow((midi - 69) / 12.0)
    private fun buf(sec: Double) = DoubleArray((RATE * sec).toInt())

    /** 뽁: 짧게 올라가는 거품 소리 */
    private fun bubble(base: Double): DoubleArray {
        val o = buf(0.11); var ph = 0.0
        for (i in o.indices) { val t = i.toDouble() / RATE
            val f = base * (1 + 2.2 * (t / 0.11)); ph += 2 * PI * f / RATE
            o[i] = sin(ph) * exp(-30 * t) * minOf(1.0, i / 40.0) }
        return o
    }

    /** 실로폰: 나무 막대를 두드린 소리 */
    private fun xylo(midi: Int, len: Double = 0.45): DoubleArray {
        val f = hz(midi); val o = buf(len)
        for (i in o.indices) { val t = i.toDouble() / RATE
            o[i] = (sin(2 * PI * f * t) + 0.25 * sin(2 * PI * f * 3.93 * t) * exp(-25 * t)) * exp(-8 * t) * minOf(1.0, i / 30.0) }
        return o
    }

    /** 물방울: 빠르게 내려가는 맑은 소리 */
    private fun drop(base: Double): DoubleArray {
        val o = buf(0.16); var ph = 0.0
        for (i in o.indices) { val t = i.toDouble() / RATE
            val f = base * exp(-6 * t) + base * 0.35; ph += 2 * PI * f / RATE
            o[i] = sin(ph) * exp(-22 * t) * minOf(1.0, i / 25.0) }
        return o
    }

    /** 반짝: 높은 종소리 */
    private fun bell(midi: Int, len: Double = 0.9): DoubleArray {
        val f = hz(midi); val o = buf(len)
        for (i in o.indices) { val t = i.toDouble() / RATE
            o[i] = (sin(2 * PI * f * t) * exp(-4 * t) + 0.5 * sin(2 * PI * f * 2.76 * t) * exp(-7 * t) + 0.25 * sin(2 * PI * f * 5.4 * t) * exp(-12 * t)) * minOf(1.0, i / 20.0) * 0.7 }
        return o
    }

    /** 톡톡: 나무 블록 */
    private fun wood(base: Double, rnd: Random): DoubleArray {
        val o = buf(0.08)
        for (i in o.indices) { val t = i.toDouble() / RATE
            o[i] = (sin(2 * PI * base * t) + 0.4 * sin(2 * PI * base * 2.5 * t)) * exp(-60 * t) + (rnd.nextDouble() - 0.5) * 0.3 * exp(-300 * t) }
        return o
    }

    /** 칠할 때 나는 소리들 (번갈아 고른다) */
    fun taps(kind: Int): List<DoubleArray> {
        val rnd = Random(kind)
        return when (kind) {
            1 -> listOf(380.0, 440.0, 520.0, 600.0).map { bubble(it) }
            2 -> listOf(72, 74, 76, 79, 81, 84).map { xylo(it) }           // 도레미솔라도 (어느 음을 이어도 듣기 좋은 5음계)
            3 -> listOf(1300.0, 1550.0, 1800.0).map { drop(it) }
            4 -> listOf(88, 91, 93, 96).map { bell(it, 0.6) }
            else -> listOf(700.0, 820.0, 950.0).map { wood(it, rnd) }
        }
    }

    /** 완성 축하: 올라가는 짧은 가락 */
    fun cheer(kind: Int): DoubleArray {
        val rnd = Random(kind)
        val parts: List<DoubleArray> = when (kind) {
            1 -> listOf(350.0, 450.0, 560.0, 700.0, 900.0).map { bubble(it) }
            2 -> listOf(72, 76, 79, 84).map { xylo(it, 0.18) } + listOf(xylo(88, 0.8))
            3 -> listOf(1200.0, 1450.0, 1700.0, 2100.0).map { drop(it) }
            4 -> listOf(84, 88, 91, 96).map { bell(it, 0.16) } + listOf(bell(100, 1.0))
            else -> listOf(600.0, 700.0, 820.0, 950.0, 1100.0).map { wood(it, rnd) }
        }
        val gap = (RATE * 0.12).toInt()
        val out = DoubleArray(gap * (parts.size - 1) + parts.last().size + 200)
        parts.forEachIndexed { k, p -> for (i in p.indices) if (k * gap + i < out.size) out[k * gap + i] += p[i] }
        return out
    }

    /** 소리를 16비트 WAV 파일로 저장한다 (최대 크기를 맞춘다) */
    fun writeWav(f: File, data: DoubleArray, gain: Double = 0.55) {
        val peak = data.maxOfOrNull { kotlin.math.abs(it) }?.takeIf { it > 0 } ?: 1.0
        val pcm = ByteArray(data.size * 2)
        for (i in data.indices) {
            val v = (data[i] / peak * gain * 32767).toInt().coerceIn(-32767, 32767)
            pcm[2 * i] = (v and 0xFF).toByte(); pcm[2 * i + 1] = (v shr 8 and 0xFF).toByte()
        }
        RandomAccessFile(f, "rw").use { r ->
            r.setLength(0)
            fun le32(x: Int) = r.write(byteArrayOf((x and 0xFF).toByte(), (x shr 8 and 0xFF).toByte(), (x shr 16 and 0xFF).toByte(), (x shr 24 and 0xFF).toByte()))
            fun le16(x: Int) = r.write(byteArrayOf((x and 0xFF).toByte(), (x shr 8 and 0xFF).toByte()))
            r.writeBytes("RIFF"); le32(36 + pcm.size); r.writeBytes("WAVE")
            r.writeBytes("fmt "); le32(16); le16(1); le16(1); le32(RATE); le32(RATE * 2); le16(2); le16(16)
            r.writeBytes("data"); le32(pcm.size); r.write(pcm)
        }
    }
}

/** 효과음 재생: 처음에 소리를 만들어 SoundPool 에 올려 두고, 지금 고른 종류로 낸다. */
object Fx {
    @Volatile var kind = 2
    private var pool: SoundPool? = null
    private val taps = HashMap<Int, IntArray>()
    private val cheers = HashMap<Int, Int>()
    private var next = 0

    fun init(ctx: Context) {
        if (pool != null) return
        val p = SoundPool.Builder().setMaxStreams(4)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .build()
        pool = p
        val dir = File(ctx.cacheDir, "sfx").apply { mkdirs() }
        Thread({
            try {
                for ((k, _) in SfxSynth.kinds) {
                    taps[k] = SfxSynth.taps(k).mapIndexed { i, d ->
                        val f = File(dir, "v1_${k}_$i.wav"); if (!f.exists()) SfxSynth.writeWav(f, d); p.load(f.path, 1)
                    }.toIntArray()
                    val c = File(dir, "v1_${k}_cheer.wav"); if (!c.exists()) SfxSynth.writeWav(c, SfxSynth.cheer(k))
                    cheers[k] = p.load(c.path, 1)
                }
            } catch (e: Exception) {}
        }, "eum-sfx").start()
    }

    /** 칠할 때·조각을 맞출 때 나는 짧은 소리 */
    fun pop(k: Int = kind) {
        val ids = taps[k] ?: return
        if (ids.isEmpty()) return
        val id = if (k == 2 || k == 4) ids[Random.nextInt(ids.size)] else ids[next++ % ids.size]
        pool?.play(id, 0.8f, 0.8f, 1, 0, 1f)
    }

    /** 다 했을 때 축하 소리 */
    fun cheer(k: Int = kind) { cheers[k]?.let { pool?.play(it, 0.9f, 0.9f, 2, 0, 1f) } }
}
