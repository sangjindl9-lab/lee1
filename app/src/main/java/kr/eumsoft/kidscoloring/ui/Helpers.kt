package kr.eumsoft.kidscoloring.ui

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.util.Locale

/** 한글 음성 안내 (기기에 한국어 음성 데이터가 있어야 소리가 난다) */
class Speaker(ctx: Context) {
    private var ready = false
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val r = tts?.setLanguage(Locale.KOREAN)
                ready = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
            }
        }
    }

    fun say(text: String) { if (ready) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "eum") }
    fun close() { tts?.shutdown(); tts = null }
}

object Fx {
    private var tone: ToneGenerator? = null
    private fun gen(): ToneGenerator? {
        if (tone == null) tone = try { ToneGenerator(AudioManager.STREAM_MUSIC, 45) } catch (e: RuntimeException) { null }
        return tone
    }
    fun pop() { try { gen()?.startTone(ToneGenerator.TONE_PROP_BEEP, 50) } catch (e: RuntimeException) {} }
    fun cheer() { try { gen()?.startTone(ToneGenerator.TONE_PROP_ACK, 400) } catch (e: RuntimeException) {} }
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
        ctx.startActivity(Intent.createChooser(send, "그림 보내기").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: Exception) { false }
}
