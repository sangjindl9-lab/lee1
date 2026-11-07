package kr.eumsoft.quick.ime

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.ClipDescription
import android.content.Intent
import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.TextView
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.HangulComposer
import kr.eumsoft.quick.core.Hangul
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.core.TextTools
import kr.eumsoft.quick.ui.MainActivity
import kr.eumsoft.quick.ui.dp
import kr.eumsoft.quick.ui.round

/**
 * 전용 키보드(선택 사항). 기본 키보드로 지정된 경우에만 OS가 클립보드 변경을 알려 준다.
 * - 키보드가 실행 중일 때 복사된 내용만 기록(ClipDescription 시각이 활성화 시각 이후인 것만)
 * - 프로세스가 종료돼 있던 동안의 복사는 놓칠 수 있다 → 앱 화면에 명시
 * - 민감 표시(IS_SENSITIVE)가 있는 클립, 비밀번호 입력 중 복사는 저장하지 않음
 */
class EumKeyboard : InputMethodService() {
    companion object { @Volatile var instance: EumKeyboard? = null }

    private lateinit var prefs: Prefs
    private val composer = HangulComposer()
    private val main = Handler(Looper.getMainLooper())
    private var mode = 0 // 0 한글, 1 영문, 2 기호
    private var shift = false
    private var inputActive = false
    private var password = false
    private var showClips = false
    private var root: LinearLayout? = null
    private lateinit var cm: ClipboardManager

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener { collect() }

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        if (prefs.imeSince == 0L) prefs.imeSince = System.currentTimeMillis()
        cm = getSystemService(ClipboardManager::class.java)
        cm.addPrimaryClipChangedListener(clipListener)
    }

    override fun onDestroy() {
        cm.removePrimaryClipChangedListener(clipListener)
        instance = null
        super.onDestroy()
    }

    /** OS가 허용하는 범위에서 클립보드 변경 수집 */
    private fun collect() {
        if (prefs.paused || prefs.collectPaused || password) return
        val clip = try { cm.primaryClip } catch (e: Exception) { null } ?: return // 접근 불가 시 null
        val desc = clip.description
        if (desc.timestamp < prefs.imeSince) return // 키보드 사용 시작 이전 기록은 보여주지 않음
        val extras = desc.extras
        if (extras != null && (extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE) || extras.getBoolean("android.content.extra.IS_SENSITIVE"))) return
        if (clip.itemCount == 0) return
        val text = clip.getItemAt(0).coerceToText(this)?.toString() ?: return
        if (prefs.isSelfClip(text)) return
        Db.get(this).addRecent(text, "키보드", prefs)
        if (showClips) main.post { rebuild() }
    }

    fun isActiveInput() = inputActive && currentInputConnection != null

    /** 커서 위치에 삽입(선택 영역이 있으면 그 부분만 교체) */
    fun insertText(text: String): Boolean {
        if (password) return false
        val ic = currentInputConnection ?: return false
        ic.finishComposingText(); composer.reset()
        return ic.commitText(text, 1)
    }

    override fun onStartInput(attribute: EditorInfo, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        composer.reset()
        val cls = attribute.inputType and InputType.TYPE_MASK_CLASS
        val v = attribute.inputType and InputType.TYPE_MASK_VARIATION
        password = (cls == InputType.TYPE_CLASS_TEXT && (v == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            v == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD || v == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) ||
            (cls == InputType.TYPE_CLASS_NUMBER && v == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        mode = if (cls == InputType.TYPE_CLASS_NUMBER || cls == InputType.TYPE_CLASS_PHONE) 2
        else if (password || (cls == InputType.TYPE_CLASS_TEXT && (v == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || v == InputType.TYPE_TEXT_VARIATION_URI))) 1
        else if (mode == 2) 0 else mode
        showClips = false
    }

    override fun onStartInputView(info: EditorInfo, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        inputActive = true
        collect() // 키보드가 떠 있지 않을 때 바뀐 클립도 (활성화 이후의 것만) 확인
        rebuild()
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        super.onFinishInputView(finishingInput)
        inputActive = false
    }

    override fun onFinishInput() {
        super.onFinishInput()
        composer.reset()
    }

    override fun onUpdateSelection(oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int, candidatesStart: Int, candidatesEnd: Int) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        // 사용자가 커서를 옮기면 조합을 끝낸다
        if (composer.isComposing && (newSelStart != candidatesEnd || newSelEnd != candidatesEnd)) {
            composer.reset()
            currentInputConnection?.finishComposingText()
        }
    }

    override fun onCreateInputView(): View {
        val r = LinearLayout(this)
        r.orientation = LinearLayout.VERTICAL
        r.setBackgroundColor(0xFFE5E7EB.toInt())
        r.setPadding(dp(3), dp(3), dp(3), dp(6))
        root = r
        rebuild()
        return r
    }

    private fun rebuild() {
        val r = root ?: return
        r.removeAllViews()
        r.addView(toolbar())
        if (showClips && !password) r.addView(clipPanel()) else keys().forEach { r.addView(it) }
    }

    private fun toolbar(): View {
        val bar = LinearLayout(this); bar.gravity = Gravity.CENTER_VERTICAL
        bar.setPadding(0, 0, 0, dp(3))
        if (!password) bar.addView(tool(if (showClips) "⌨ 키보드" else "📋 최근 클립") { showClips = !showClips; rebuild() })
        else bar.addView(TextView(this).apply { text = "비밀번호 입력 중: 클립 기능 제한"; textSize = 12f; setTextColor(0xFF6B7280.toInt()) })
        bar.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        bar.addView(tool("⚙") {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        })
        val sw = tool("🌐 키보드 전환") { switchKeyboard() }
        sw.setOnLongClickListener { getSystemService(InputMethodManager::class.java).showInputMethodPicker(); true }
        bar.addView(sw)
        return bar
    }

    /** 기존 키보드(삼성/Gboard 등)로 돌아가기 */
    private fun switchKeyboard() {
        val ok = if (Build.VERSION.SDK_INT >= 28) switchToPreviousInputMethod() else false
        if (!ok) getSystemService(InputMethodManager::class.java).showInputMethodPicker()
    }

    private fun tool(t: String, click: () -> Unit): TextView {
        val v = TextView(this)
        v.text = t; v.textSize = 13f; v.setTextColor(0xFF111827.toInt())
        v.setPadding(dp(10), dp(6), dp(10), dp(6))
        v.background = round(Color.WHITE, dp(14).toFloat())
        v.setOnClickListener { click() }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.rightMargin = dp(4)
        v.layoutParams = lp
        return v
    }

    private fun clipPanel(): View {
        val box = LinearLayout(this); box.orientation = LinearLayout.VERTICAL
        val items = Db.get(this).recent(5)
        if (items.isEmpty()) {
            box.addView(TextView(this).apply {
                text = "이 키보드를 사용한 뒤 복사한 내용이 여기에 표시됩니다.\n(설정 이전 기록은 표시하지 않습니다)"
                textSize = 13f; setTextColor(0xFF6B7280.toInt()); setPadding(dp(8), dp(24), dp(8), dp(24))
            })
        }
        for (c in items) {
            val t = TextView(this)
            t.text = (if (c.pinned) "📌 " else "") + TextTools.preview(c.text, 70)
            t.textSize = 14f; t.maxLines = 2; t.ellipsize = TextUtils.TruncateAt.END
            t.setTextColor(0xFF111827.toInt())
            t.background = round(Color.WHITE, dp(8).toFloat())
            t.setPadding(dp(10), dp(9), dp(10), dp(9))
            t.setOnClickListener { insertText(c.text); showClips = false; rebuild() }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = dp(4)
            box.addView(t, lp)
        }
        box.minimumHeight = dp(220)
        return box
    }

    // ---------- 자판 ----------
    private val KO = listOf("ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ", "ㅁㄴㅇㄹㅎㅗㅓㅏㅣ", "ㅋㅌㅊㅍㅠㅜㅡ")
    private val KO_SHIFT = listOf("ㅃㅉㄸㄲㅆㅛㅕㅑㅒㅖ", "ㅁㄴㅇㄹㅎㅗㅓㅏㅣ", "ㅋㅌㅊㅍㅠㅜㅡ")
    private val EN = listOf("qwertyuiop", "asdfghjkl", "zxcvbnm")
    private val SYM = listOf("1234567890", "@#₩%&*-+()", "!\"':;/?~")

    private fun keys(): List<View> {
        val rows = when (mode) { 0 -> if (shift) KO_SHIFT else KO; 1 -> EN; else -> SYM }
        val out = ArrayList<View>()
        rows.forEachIndexed { i, s ->
            val row = LinearLayout(this)
            if (i == 1 && mode != 2) row.setPadding(dp(16), 0, dp(16), 0)
            if (i == 2) row.addView(key(if (mode == 2) "=" else if (shift) "⇧" else "⇩", 1.5f, special = true) {
                if (mode == 2) typeChar("=") else { shift = !shift; rebuild() }
            })
            for (c in s) {
                val label = if (mode == 1 && shift) c.uppercaseChar().toString() else c.toString()
                row.addView(key(label, 1f) { typeChar(label) })
            }
            if (i == 2) row.addView(deleteKey())
            out.add(row)
        }
        val last = LinearLayout(this)
        last.addView(key(if (mode == 2) "가" else "123", 1.5f, special = true) { mode = if (mode == 2) 0 else 2; shift = false; rebuild() })
        last.addView(key(",", 1f) { typeChar(",") })
        last.addView(key(if (mode == 1) "한" else "A", 1.2f, special = true) { mode = if (mode == 1) 0 else 1; shift = false; finishCompose(); rebuild() })
        last.addView(key("간격", 4f) { typeChar(" ") })
        last.addView(key(".", 1f) { typeChar(".") })
        last.addView(key("⏎", 1.5f, special = true) { enter() })
        out.add(last)
        return out
    }

    private fun key(label: String, weight: Float, special: Boolean = false, click: () -> Unit): TextView {
        val v = TextView(this)
        v.text = label; v.gravity = Gravity.CENTER; v.textSize = if (label.length > 2) 13f else 18f
        v.setTextColor(0xFF111827.toInt())
        v.background = round(if (special) 0xFFD1D5DB.toInt() else Color.WHITE, dp(6).toFloat())
        v.setOnClickListener { click() }
        val lp = LinearLayout.LayoutParams(0, dp(46), weight)
        lp.setMargins(dp(2), dp(3), dp(2), dp(3))
        v.layoutParams = lp
        return v
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun deleteKey(): TextView {
        val v = key("⌫", 1.5f, special = true) {}
        val repeat = object : Runnable { override fun run() { backspace(); main.postDelayed(this, 60) } }
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { backspace(); main.postDelayed(repeat, 450) }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> main.removeCallbacks(repeat)
            }
            true
        }
        return v
    }

    private fun typeChar(s: String) {
        val ic = currentInputConnection ?: return
        val c = s[0]
        if (s.length == 1 && mode == 0 && Hangul.isJamo(c)) {
            val done = composer.input(c)
            if (done.isNotEmpty()) ic.commitText(done, 1)
            ic.setComposingText(composer.composing(), 1)
            if (shift) { shift = false; rebuild() }
            return
        }
        finishCompose()
        ic.commitText(s, 1)
        if (shift && mode == 1) { shift = false; rebuild() }
    }

    private fun finishCompose() {
        if (composer.isComposing) { composer.reset(); currentInputConnection?.finishComposingText() }
    }

    private fun backspace() {
        val ic = currentInputConnection ?: return
        if (composer.backspace()) {
            val s = composer.composing()
            if (s.isEmpty()) ic.commitText("", 1) else ic.setComposingText(s, 1)
        } else {
            // 선택 영역이 있으면 그 부분만, 없으면 커서 앞 한 글자 삭제
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL))
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL))
        }
    }

    private fun enter() {
        finishCompose()
        val info = currentInputEditorInfo
        val action = (info?.imeOptions ?: 0) and EditorInfo.IME_MASK_ACTION
        val multi = info != null && (info.inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0
        if (!multi && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED &&
            (info!!.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION) == 0) {
            currentInputConnection?.performEditorAction(action)
        } else {
            currentInputConnection?.commitText("\n", 1)
        }
    }
}
