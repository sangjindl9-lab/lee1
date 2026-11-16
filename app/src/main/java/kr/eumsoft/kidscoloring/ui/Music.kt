package kr.eumsoft.kidscoloring.ui

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin

/**
 * 놀이터 배경 음악: 저작권이 끝난 옛 동요 멜로디를 오르골 소리로 앱 안에서 직접 합성해 연주한다.
 * (음원 파일·인터넷이 필요 없다)
 */
object Tunes {
    /** 음표: 음 이름(C4, D4 … , R = 쉼표)과 박자 수 */
    class Note(val midi: Int, val beats: Float)

    private val names = mapOf('C' to 0, 'D' to 2, 'E' to 4, 'F' to 5, 'G' to 7, 'A' to 9, 'B' to 11)

    /** "C4 C4 G4 G4 A4 A4 G4:2" 같은 글을 음표 목록으로 바꾼다. 콜론 뒤는 박자 수(기본 1). */
    fun parse(text: String): List<Note> = text.trim().split(Regex("\\s+")).map { tok ->
        val parts = tok.split(':')
        val beats = parts.getOrNull(1)?.toFloat() ?: 1f
        val p = parts[0]
        if (p == "R") Note(-1, beats) else {
            var i = 1
            var semi = names.getValue(p[0])
            while (p[i] == '#' || p[i] == 'b') { semi += if (p[i] == '#') 1 else -1; i++ }
            Note(12 * (p.substring(i).toInt() + 1) + semi, beats)
        }
    }

    // 반짝반짝 작은 별 (프랑스 민요, 18세기)
    private const val TWINKLE = "C5 C5 G5 G5 A5 A5 G5:2 F5 F5 E5 E5 D5 D5 C5:2 G5 G5 F5 F5 E5 E5 D5:2 G5 G5 F5 F5 E5 E5 D5:2 C5 C5 G5 G5 A5 A5 G5:2 F5 F5 E5 E5 D5 D5 C5:2"
    // 메리의 작은 양 (미국 동요, 19세기)
    private const val MARY = "E5 D5 C5 D5 E5 E5 E5:2 D5 D5 D5:2 E5 G5 G5:2 E5 D5 C5 D5 E5 E5 E5 E5 D5 D5 E5 D5 C5:4"
    // 자크 형제 (프랑스 민요)
    private const val JACQUES = "C5 D5 E5 C5 C5 D5 E5 C5 E5 F5 G5:2 E5 F5 G5:2 G5:0.5 A5:0.5 G5:0.5 F5:0.5 E5 C5 G5:0.5 A5:0.5 G5:0.5 F5:0.5 E5 C5 C5 G4 C5:2 C5 G4 C5:2"
    // 런던 다리 (영국 동요)
    private const val LONDON = "G5:1.5 A5:0.5 G5 F5 E5 F5 G5:2 D5 E5 F5:2 E5 F5 G5:2 G5:1.5 A5:0.5 G5 F5 E5 F5 G5:2 D5:2 G5 E5 C5:4"
    // 기쁨의 노래 (베토벤, 1824)
    private const val JOY = "E5 E5 F5 G5 G5 F5 E5 D5 C5 C5 D5 E5 E5:1.5 D5:0.5 D5:2 E5 E5 F5 G5 G5 F5 E5 D5 C5 C5 D5 E5 D5:1.5 C5:0.5 C5:2"
    // 자장가 (브람스, 1868)
    private const val LULLABY = "E5:0.5 E5:0.5 G5:2 E5:0.5 E5:0.5 G5:2 E5:0.5 G5:0.5 C6 B5:1.5 A5:0.5 A5 G5 D5:0.5 E5:0.5 F5 D5 D5:0.5 E5:0.5 F5:2 D5:0.5 F5:0.5 B5:0.5 A5:0.5 G5 B5 C6:3"

    /** 곡과 빠르기(한 박의 길이, 초) */
    val songs: List<Pair<List<Note>, Float>> by lazy {
        listOf(TWINKLE to 0.42f, MARY to 0.36f, JACQUES to 0.40f, LONDON to 0.36f, JOY to 0.40f, LULLABY to 0.50f)
            .map { (t, b) -> parse(t) to b }
    }
}

/** 오르골 소리 합성기. start() 하면 곡을 차례로 되풀이해 연주하고 stop() 하면 멈춘다. */
class MusicBox {
    private val rate = 22050
    @Volatile private var running = false
    private var thread: Thread? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread({ loop() }, "eum-music").apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        thread?.interrupt()
        thread = null
    }

    private fun loop() {
        val minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(minBuf, rate))
                .setTransferMode(AudioTrack.MODE_STREAM).build()
        } catch (e: Exception) { running = false; return }
        try {
            track.setVolume(0.35f)
            track.play()
            var song = (System.currentTimeMillis() / 1000 % Tunes.songs.size).toInt()
            while (running) {
                val (notes, beat) = Tunes.songs[song]
                for (n in notes) {
                    if (!running) break
                    val pcm = render(n, beat)
                    var off = 0
                    while (running && off < pcm.size) {
                        val w = track.write(pcm, off, pcm.size - off)
                        if (w <= 0) break
                        off += w
                    }
                }
                // 곡 사이에 잠깐 쉰다
                if (running) track.write(ShortArray(rate), 0, rate)
                song = (song + 1) % Tunes.songs.size
            }
        } catch (e: Exception) {
        } finally {
            try { track.pause(); track.flush(); track.release() } catch (e: Exception) {}
        }
    }

    /** 음 하나: 기본음 + 배음을 섞고 빠르게 줄어드는 소리(오르골·실로폰 느낌) */
    private fun render(n: Tunes.Note, beat: Float): ShortArray {
        val len = (rate * beat * n.beats).toInt().coerceAtLeast(1)
        val out = ShortArray(len)
        if (n.midi < 0) return out
        val f = 440.0 * 2.0.pow((n.midi - 69) / 12.0)
        val attack = (rate * 0.006).toInt()
        for (i in 0 until len) {
            val t = i.toDouble() / rate
            val env = exp(-3.2 * t) * (if (i < attack) i.toDouble() / attack else 1.0) *
                (if (i > len - 200) (len - i) / 200.0 else 1.0)
            val s = sin(2 * PI * f * t) + 0.35 * sin(4 * PI * f * t) * exp(-6 * t) + 0.12 * sin(6 * PI * f * t) * exp(-9 * t)
            out[i] = (s * env * 7000).toInt().coerceIn(-32767, 32767).toShort()
        }
        return out
    }
}

/** 색칠할 때 깔리는 배경 음악: res/raw 의 곡을 번갈아 되풀이한다. */
class BgmPlayer(private val ctx: android.content.Context) {
    private val tracks = intArrayOf(kr.eumsoft.kidscoloring.R.raw.coloring_bgm_1, kr.eumsoft.kidscoloring.R.raw.coloring_bgm_2)
    private var index = 0
    private var player: android.media.MediaPlayer? = null
    private var playing = false

    fun start() {
        if (playing) return
        playing = true
        val p = player
        if (p != null) { try { p.start() } catch (e: IllegalStateException) { player = null; open() } } else open()
    }

    private fun open() {
        val p = try { android.media.MediaPlayer.create(ctx.applicationContext, tracks[index]) } catch (e: Exception) { null } ?: return
        p.setVolume(0.45f, 0.45f)
        p.setOnCompletionListener {
            it.release(); player = null
            index = (index + 1) % tracks.size
            if (playing) open()
        }
        player = p
        p.start()
    }

    /** 잠시 멈춤: 다시 start() 하면 이어서 나온다 */
    fun pause() {
        playing = false
        try { player?.pause() } catch (e: IllegalStateException) {}
    }

    fun release() {
        playing = false
        player?.release(); player = null
    }
}
