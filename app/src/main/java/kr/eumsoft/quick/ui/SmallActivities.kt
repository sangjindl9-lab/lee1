package kr.eumsoft.quick.ui

import android.app.Activity
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.widget.EditText
import android.widget.ScrollView
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.core.TextTools

private fun Activity.reportAdd(r: Db.AddResult) = toast(when (r) {
    Db.AddResult.SAVED -> "이음 퀵도우미 최근 클립에 저장했습니다."
    Db.AddResult.MOVED -> "이미 있는 내용이라 최근 항목으로 올렸습니다."
    Db.AddResult.EMPTY -> "저장할 텍스트가 없습니다."
    Db.AddResult.SENSITIVE -> "인증번호 등 민감 정보로 보여 저장하지 않았습니다."
    Db.AddResult.PAUSED -> "기록 수집이 일시정지되어 있습니다."
})

/**
 * 사용자가 도우미 메뉴에서 '클립보드 가져오기'를 눌렀을 때만 잠깐 뜨는 투명 화면.
 * 안드로이드는 화면 포커스를 가진 앱만 클립보드를 읽게 하므로, 포커스를 얻은 순간 한 번 읽고 바로 닫는다.
 */
class ImportClipActivity : Activity() {
    private var done = false
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || done) return
        done = true
        val clip = getSystemService(ClipboardManager::class.java).primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this)?.toString() ?: "" else ""
        val panel = intent.getBooleanExtra("panel", false)
        val r = Db.get(this).addRecent(text, "클립보드", Prefs(this))
        // 패널 자동 가져오기에서는 저장·이동은 조용히, 저장하지 않은 이유만 알림
        if (!panel || r == Db.AddResult.SENSITIVE) reportAdd(r)
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
        if (panel) kr.eumsoft.quick.service.HelperService.instance?.let { if (it.ready) it.overlay.panelAfterImport() }
    }
}

/** 다른 앱의 공유 메뉴 → 이음 퀵도우미로 저장 (텍스트) / 글자 추출 (이미지) */
class ShareReceiveActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val type = intent.type ?: ""
        if (intent.action == Intent.ACTION_SEND && type.startsWith("image/")) {
            @Suppress("DEPRECATION")
            val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (uri != null) startActivity(Intent(this, OcrActivity::class.java).putExtra("uri", uri.toString())
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            finish(); return
        }
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: ""
        reportAdd(Db.get(this).addRecent(text, "공유", Prefs(this)))
        finish()
    }
}

/** 클립 수정 */
class ClipEditActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val db = Db.get(this)
        val c = db.get(intent.getLongExtra("id", -1))
        if (c == null) { toast("항목을 찾을 수 없습니다."); finish(); return }
        val root = vbox(16); root.setBackgroundColor(Color.WHITE)
        root.label("클립 수정", 18f, true)
        val e = EditText(this); e.setText(c.text); e.minLines = 6; e.gravity = android.view.Gravity.TOP
        root.add(e, topDp = 8)
        val original = c.text
        root.buttons(
            "앞뒤공백 정리" to { e.setText(TextTools.clean(e.text.toString(), TextTools.Clean(trim = true))) },
            "연속공백 정리" to { e.setText(TextTools.clean(e.text.toString(), TextTools.Clean(collapseSpaces = true))) },
            "한 줄로" to { e.setText(TextTools.clean(e.text.toString(), TextTools.Clean(oneLine = true))) }
        )
        root.buttons("원문으로 되돌리기" to { e.setText(original) }, "취소" to { finish() })
        root.btn("저장", primary = true) { db.updateText(c.id, e.text.toString()); toast("저장했습니다."); finish() }
        val sc = ScrollView(this); sc.addView(root)
        applyInsets(sc)
        setContentView(sc)
    }
}

/** 템플릿 빈칸 입력 → 완성 문구를 최근 클립 맨 위에 저장 (자동 입력·전송하지 않음) */
class TemplateFillActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val db = Db.get(this)
        val c = db.get(intent.getLongExtra("id", -1))
        if (c == null) { finish(); return }
        val root = vbox(16); root.setBackgroundColor(Color.WHITE)
        root.label(c.title.ifEmpty { "템플릿" }, 18f, true)
        val prefs = Prefs(this)
        val fields = TextTools.templateFields(c.text)
        val edits = LinkedHashMap<String, EditText>()
        for (f in fields) {
            root.label(f, 13f, true, topDp = 8)
            val e = EditText(this); e.setSingleLine(); e.setText(prefs.sp.getString("tplv_$f", ""))
            root.add(e); edits[f] = e
        }
        val preview = root.label("", 14f, topDp = 12)
        preview.setPadding(dp(10), dp(10), dp(10), dp(10))
        preview.background = round(0xFFFFF7E6.toInt(), dp(8).toFloat())
        fun result() = TextTools.fillTemplate(c.text, edits.mapValues { it.value.text.toString() })
        val upd = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, d: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, d: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { preview.text = result() }
        }
        edits.values.forEach { it.addTextChangedListener(upd) }
        preview.text = result()
        root.btn("완성 문구 저장 후 돌아가기", primary = true) {
            edits.forEach { (k, v) -> prefs.sp.edit().putString("tplv_$k", v.text.toString()).apply() }
            db.addRecent(result(), "템플릿", prefs, force = true)
            toastLong("완성 문구를 최근 클립 맨 위에 저장했습니다. 입력창을 선택하고 도우미에서 붙여넣으세요.")
            finish()
        }
        val sc = ScrollView(this); sc.addView(root)
        applyInsets(sc)
        setContentView(sc)
    }
}
