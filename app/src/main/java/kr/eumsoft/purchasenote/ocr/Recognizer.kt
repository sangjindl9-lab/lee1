package kr.eumsoft.purchasenote.ocr

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** 기기 안에서만 글자를 읽는다(모델이 앱에 포함, 이미지를 외부로 보내지 않음). */
object Recognizer {
    enum class Script { AUTO, KOREAN, JAPANESE, LATIN }

    private val ko by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }
    private val ja by lazy { TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build()) }
    private val la by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    private class Read(val lines: List<String>, val confidence: Float)

    private suspend fun run(r: TextRecognizer, bmp: Bitmap): Read = suspendCancellableCoroutine { k ->
        r.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener { t ->
                val ls = t.textBlocks.flatMap { it.lines }
                val total = ls.sumOf { it.text.length }.coerceAtLeast(1)
                k.resume(Read(ls.map { it.text }, ls.sumOf { (it.confidence * it.text.length).toDouble() }.toFloat() / total))
            }
            .addOnFailureListener { k.resumeWithException(it) }
    }

    private fun kana(s: String) = s.count { it in '぀'..'ヿ' }
    private fun hangul(s: String) = s.count { it in '가'..'힣' }

    /** AUTO: 한국어(한글+라틴)·일본어(가나·한자+라틴) 모델을 모두 돌려 줄 신뢰도가 높은 쪽을 쓴다. 비슷하면 더 많이 읽은 쪽 */
    suspend fun read(bmp: Bitmap, script: Script): Pair<Script, List<String>> = when (script) {
        Script.KOREAN -> script to run(ko, bmp).lines
        Script.JAPANESE -> script to run(ja, bmp).lines
        Script.LATIN -> script to run(la, bmp).lines
        Script.AUTO -> {
            val k = run(ko, bmp); val j = run(ja, bmp)
            val kt = k.lines.joinToString(""); val jt = j.lines.joinToString("")
            val pickJa = when {
                kana(jt) > 0 && hangul(kt) == 0 -> true
                kotlin.math.abs(k.confidence - j.confidence) > 0.05f -> j.confidence > k.confidence
                else -> jt.length + kana(jt) > kt.length + hangul(kt)
            }
            if (pickJa) Script.JAPANESE to j.lines else Script.KOREAN to k.lines
        }
    }
}
