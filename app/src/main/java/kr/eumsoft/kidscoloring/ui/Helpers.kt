package kr.eumsoft.kidscoloring.ui

import kr.eumsoft.kidscoloring.tr
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.util.Locale
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin

/** 음성 안내 (기기에 현재 언어의 음성 데이터가 있어야 소리가 난다) */
class Speaker(ctx: Context) {
    private var ready = false
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val r = tts?.setLanguage(kr.eumsoft.kidscoloring.I18n.locale)
                ready = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
            }
        }
    }

    fun say(text: String) { if (ready) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "eum") }
    fun close() { tts?.shutdown(); tts = null }
}

/** 효과음 소리 만들기(전화기 "삑" 소리 대신 앱 안에서 직접 합성한다). 16비트 모노, [RATE] Hz. */
object FxSynth {
    const val RATE = 22050

    /** 색칠·터뜨리기: 물방울처럼 "뽁" 하고 올라가는 짧고 부드러운 소리. [step] 마다 음 높이가 조금씩 다르다. */
    fun pop(step: Int): ShortArray {
        val len = RATE * 13 / 100
        val out = ShortArray(len)
        val base = 392.0 * 2.0.pow(intArrayOf(0, 2, 4, 7, 9)[step % 5] / 12.0) // 솔 라 시 레 미 (어느 음이 나와도 어울림)
        var phase = 0.0
        for (i in 0 until len) {
            val t = i.toDouble() / RATE
            val f = base * (1.0 + 0.9 * (t / 0.07).coerceAtMost(1.0))
            phase += 2 * PI * f / RATE
            val env = (t / 0.004).coerceAtMost(1.0) * exp(-22.0 * t) * ((len - i) / 200.0).coerceAtMost(1.0)
            out[i] = (sin(phase) * env * 16000).toInt().toShort()
        }
        return out
    }

    /** 완성·성공: 도 미 솔 도 가 차례로 울리는 실로폰 소리 */
    fun cheer(): ShortArray {
        val notes = doubleArrayOf(523.25, 659.25, 783.99, 1046.5)
        val gap = RATE * 11 / 100
        val out = DoubleArray(gap * 3 + RATE * 7 / 10)
        for ((k, f) in notes.withIndex()) for (i in 0 until out.size - k * gap) {
            val t = i.toDouble() / RATE
            val env = (t / 0.005).coerceAtMost(1.0) * exp(-5.0 * t)
            out[k * gap + i] += (sin(2 * PI * f * t) + 0.3 * sin(4 * PI * f * t) * exp(-8 * t)) * env
        }
        return ShortArray(out.size) { i -> (out[i] * ((out.size - i) / 400.0).coerceAtMost(1.0) * 6500).toInt().coerceIn(-32767, 32767).toShort() }
    }
}

object Fx {
    private var pops: List<AudioTrack?>? = null
    private var cheerTrack: AudioTrack? = null
    private var step = 0

    private fun track(pcm: ShortArray): AudioTrack? = try {
        AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(FxSynth.RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC).build()
            .apply { write(pcm, 0, pcm.size); setVolume(0.6f) }
    } catch (e: Exception) { null }

    private fun play(t: AudioTrack?) {
        try { t?.apply { if (playState == AudioTrack.PLAYSTATE_PLAYING) stop(); reloadStaticData(); play() } } catch (e: Exception) {}
    }

    fun pop() {
        val p = pops ?: List(5) { track(FxSynth.pop(it)) }.also { pops = it }
        play(p[step++ % p.size])
    }
    fun cheer() {
        if (cheerTrack == null) cheerTrack = track(FxSynth.cheer())
        play(cheerTrack)
    }
}

object Exporter {
    /** Android 10 이상: 사진첩(Pictures/EumKidsColoring)에 PNG 저장. 권한이 필요 없다. */
    fun saveToPictures(ctx: Context, bmp: Bitmap, name: String): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val v = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "$name.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/EumKidsColoring")
        }
        val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v) ?: return false
        return writeTo(ctx, uri, bmp).also { if (!it) ctx.contentResolver.delete(uri, null, null) }
    }

    fun writeTo(ctx: Context, uri: Uri, bmp: Bitmap): Boolean = try {
        ctx.contentResolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: false
    } catch (e: IOException) { false }

    /** 보호자 확인을 거친 뒤에만 부른다 */
    fun share(ctx: Context, bmp: Bitmap, name: String): Boolean = try {
        val dir = File(ctx.cacheDir, "shared").apply { mkdirs() }
        val f = File(dir, "eum_coloring.png")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
        val send = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_TITLE, name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, tr("그림 보내기")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: Exception) { false }
}
