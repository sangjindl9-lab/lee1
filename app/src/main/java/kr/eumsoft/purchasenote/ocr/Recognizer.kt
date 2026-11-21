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

    private suspend fun run(r: TextRecognizer, bmp: Bitmap): List<String> = suspendCancellableCoroutine { k ->
        r.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener { t -> k.resume(t.textBlocks.flatMap { b -> b.lines.map { it.text } }) }
            .addOnFailureListener { k.resumeWithException(it) }
    }

    private fun kana(s: String) = s.count { it in '぀'..'ヿ' }
    private fun hangul(s: String) = s.count { it in '가'..'힣' }
    private fun han(s: String) = s.count { it in '一'..'鿿' }

    /** AUTO: 한국어 모델(한글+라틴)로 읽고, 가나·한자가 보이거나 결과가 적으면 일본어 모델도 돌려 더 많이 읽은 쪽을 쓴다 */
    suspend fun read(bmp: Bitmap, script: Script): Pair<Script, List<String>> = when (script) {
        Script.KOREAN -> script to run(ko, bmp)
        Script.JAPANESE -> script to run(ja, bmp)
        Script.LATIN -> script to run(la, bmp)
        Script.AUTO -> {
            val k = run(ko, bmp); val kt = k.joinToString("")
            if (hangul(kt) > 5 && kana(kt) == 0) Script.KOREAN to k
            else {
                val j = run(ja, bmp); val jt = j.joinToString("")
                val jScore = kana(jt) * 3 + han(jt) + jt.length / 4
                val kScore = hangul(kt) * 3 + kt.length / 4
                if (jScore > kScore) Script.JAPANESE to j else Script.KOREAN to k
            }
        }
    }
}
