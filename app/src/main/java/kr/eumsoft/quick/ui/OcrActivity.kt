package kr.eumsoft.quick.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.ImageStore
import kr.eumsoft.quick.core.Ocr
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.core.TextTools
import java.util.concurrent.Executors

/**
 * 캡처/갤러리 이미지 글자 추출(기기 내부 처리) → 필요한 문장 선택 → 수정 → 클립 저장.
 * 결과를 다른 앱에 자동 입력하거나 전송하지 않는다.
 */
class OcrActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView
    private lateinit var lines: LinearLayout
    private lateinit var edit: EditText
    private val checks = ArrayList<Pair<CheckBox, String>>()
    private var allText = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = vbox(14); root.setBackgroundColor(Color.WHITE)
        root.label("글자 추출", 18f, true)
        val img = ImageView(this); img.adjustViewBounds = true; img.scaleType = ImageView.ScaleType.FIT_CENTER
        img.maxHeight = resources.displayMetrics.heightPixels * 35 / 100
        root.add(img, topDp = 8)
        status = root.label("이미지를 불러오는 중…", 13f, color = GRAY, topDp = 6)
        root.buttons("전체 선택" to { setAll(true) }, "선택 해제" to { setAll(false) }, "줄바꿈 정리" to {
            edit.setText(TextTools.mergeOcrLines(edit.text.toString()))
        })
        lines = root.add(vbox())
        root.label("저장할 내용 (인식 오류를 직접 고칠 수 있습니다)", 13f, true, topDp = 10)
        edit = EditText(this); edit.minLines = 4; edit.gravity = Gravity.TOP; edit.textSize = 14f
        root.add(edit)
        root.buttons("전체 텍스트 복사" to { copy(allText) }, "아래 내용 복사" to { copy(edit.text.toString()) })
        root.btn("선택한 내용을 클립에 저장", primary = true) {
            val t = edit.text.toString()
            val r = Db.get(this).addRecent(t, "OCR", Prefs(this), force = true)
            toast(if (r == Db.AddResult.EMPTY) "저장할 내용이 없습니다." else "최근 클립에 저장했습니다. 다른 앱 입력창에서 도우미로 붙여넣으세요.")
        }
        val sc = ScrollView(this); sc.addView(root)
        applyInsets(sc)
        setContentView(sc)

        val uri = intent.getStringExtra("uri") ?: Db.get(this).capture(intent.getLongExtra("captureId", -1))?.uri
        if (uri == null) { status.text = "이미지를 찾을 수 없습니다."; return }
        io.execute {
            val bmp: Bitmap? = try { ImageStore.load(this, Uri.parse(uri), 3000) } catch (e: Exception) { null }
            runOnUiThread {
                if (bmp == null) { status.text = "이미지를 열 수 없습니다."; return@runOnUiThread }
                img.setImageBitmap(bmp)
                status.text = "글자를 인식하는 중… (기기 내부 처리)"
                Ocr.run(bmp) { text, err ->
                    if (text == null) {
                        status.text = "글자 인식 실패: ${err?.message ?: "알 수 없는 오류"}\n(인식 모델은 앱에 포함되어 있어 별도 다운로드가 필요 없습니다. 다시 시도해 주세요.)"
                        return@run
                    }
                    val ls = text.textBlocks.flatMap { b -> b.lines.map { it.text } }
                    allText = ls.joinToString("\n")
                    status.text = if (ls.isEmpty()) "인식된 글자가 없습니다." else "인식 완료: ${ls.size}줄 · 필요한 줄을 고르세요"
                    for (l in ls) {
                        val cb = CheckBox(this); cb.text = l; cb.textSize = 14f; cb.isChecked = true
                        cb.setOnCheckedChangeListener { _, _ -> syncEdit() }
                        lines.add(cb); checks.add(cb to l)
                    }
                    syncEdit()
                }
            }
        }
    }

    private fun setAll(on: Boolean) { checks.forEach { it.first.isChecked = on }; syncEdit() }
    private fun syncEdit() = edit.setText(checks.filter { it.first.isChecked }.joinToString("\n") { it.second })

    private fun copy(t: String) {
        if (t.isBlank()) { toast("복사할 내용이 없습니다."); return }
        Prefs(this).markSelfClip(t)
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("OCR", t))
        toast("복사했습니다.")
    }
}
