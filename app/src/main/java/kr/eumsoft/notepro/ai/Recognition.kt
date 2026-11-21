package kr.eumsoft.notepro.ai

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import kr.eumsoft.notepro.core.Stroke
import java.util.concurrent.TimeUnit

/**
 * 기기 안에서 실행되는 인식 모듈(교체 가능). 백그라운드 스레드에서만 호출.
 * - 손글씨: ML Kit Digital Ink (언어별 모델 약 20MB를 처음 한 번 내려받음) — 한국어·영어, 다른 언어는 태그만 추가
 * - 문서 글자(OCR): ML Kit 글자 인식(한국어+라틴, 앱에 포함) — 스캔 PDF·이미지 페이지
 * 원본 손글씨·이미지는 그대로 두고 결과 글자만 따로 저장한다.
 */
object Recognition {

    class ModelMissing(val lang: String) : Exception("model $lang not downloaded")

    private fun model(lang: String): DigitalInkRecognitionModel {
        val id = DigitalInkRecognitionModelIdentifier.fromLanguageTag(lang) ?: throw IllegalArgumentException("unsupported $lang")
        return DigitalInkRecognitionModel.builder(id).build()
    }

    fun isModelReady(lang: String): Boolean =
        Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(model(lang)), 20, TimeUnit.SECONDS)

    fun downloadModel(lang: String) {
        Tasks.await(RemoteModelManager.getInstance().download(model(lang), DownloadConditions.Builder().build()), 5, TimeUnit.MINUTES)
    }

    /** 획을 줄 단위로 묶어(세로 위치) 줄마다 인식. 반환: 줄별 글자 */
    fun recognizeHandwriting(strokes: List<Stroke>, lang: String): List<String> {
        if (strokes.isEmpty()) return emptyList()
        if (!isModelReady(lang)) throw ModelMissing(lang)
        val recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model(lang)).build())
        try {
            val lines = groupLines(strokes)
            return lines.mapNotNull { line ->
                val ink = Ink.builder()
                var t = 0L
                for (s in line.sortedBy { it.bounds.l }) {
                    val sb = Ink.Stroke.builder()
                    var i = 0
                    while (i < s.points.size) { sb.addPoint(Ink.Point.create(s.points[i], s.points[i + 1], t)); t += 10; i += Stroke.STRIDE }
                    ink.addStroke(sb.build())
                }
                val r = Tasks.await(recognizer.recognize(ink.build()), 30, TimeUnit.SECONDS)
                r.candidates.firstOrNull()?.text?.takeIf { it.isNotBlank() }
            }
        } finally { recognizer.close() }
    }

    /** 획을 세로로 겹치는 묶음(줄)으로 나눈다. */
    fun groupLines(strokes: List<Stroke>): List<List<Stroke>> {
        val sorted = strokes.filter { it.count > 0 }.sortedBy { (it.bounds.t + it.bounds.b) / 2 }
        val lines = ArrayList<MutableList<Stroke>>()
        var curTop = 0f; var curBottom = 0f
        for (s in sorted) {
            val mid = (s.bounds.t + s.bounds.b) / 2
            if (lines.isEmpty() || mid > curBottom) { lines.add(mutableListOf(s)); curTop = s.bounds.t; curBottom = s.bounds.b }
            else { lines.last().add(s); curBottom = maxOf(curBottom, s.bounds.b); curTop = minOf(curTop, s.bounds.t) }
        }
        return lines
    }

    fun ocr(bitmap: Bitmap): String {
        val client = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        try {
            return Tasks.await(client.process(InputImage.fromBitmap(bitmap, 0)), 60, TimeUnit.SECONDS).text
        } finally { client.close() }
    }
}
