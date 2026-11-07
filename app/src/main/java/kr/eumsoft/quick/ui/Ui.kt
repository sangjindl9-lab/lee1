package kr.eumsoft.quick.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import kr.eumsoft.quick.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 화면을 코드로 간단히 만들기 위한 작은 도우미 함수 모음 */
fun Context.dp(v: Number): Int = (v.toFloat() * resources.displayMetrics.density + 0.5f).toInt()
val Context.brand: Int get() = getColor(R.color.brand)
const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
const val GRAY = 0xFF6B7280.toInt()
const val LINE = 0xFFE5E7EB.toInt()

fun Context.vbox(padDp: Int = 0): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL; val p = dp(padDp); setPadding(p, p, p, p)
}

fun Context.hbox(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
}

fun round(color: Int, radius: Float, stroke: Int = Color.TRANSPARENT, strokeW: Int = 0) = GradientDrawable().apply {
    setColor(color); cornerRadius = radius; if (strokeW > 0) setStroke(strokeW, stroke)
}

fun <T : View> ViewGroup.add(v: T, w: Int = MATCH, h: Int = WRAP, weight: Float = 0f, topDp: Int = 0): T {
    val lp = LinearLayout.LayoutParams(w, h, weight)
    lp.topMargin = context.dp(topDp)
    addView(v, lp)
    return v
}

fun ViewGroup.label(text: CharSequence, size: Float = 14f, bold: Boolean = false, color: Int = 0xFF111827.toInt(), topDp: Int = 0): TextView {
    val t = TextView(context)
    t.text = text; t.textSize = size; t.setTextColor(color)
    if (bold) t.setTypeface(t.typeface, Typeface.BOLD)
    return add(t, topDp = topDp)
}

fun ViewGroup.title(text: String) = label(text, 13f, true, context.brand, topDp = 14)

fun Context.makeBtn(text: String, primary: Boolean = false, onClick: () -> Unit): Button {
    val b = Button(this)
    b.text = text; b.isAllCaps = false; b.textSize = 13f
    b.minHeight = 0; b.minimumHeight = dp(38); b.minWidth = 0; b.minimumWidth = 0
    b.setPadding(dp(12), 0, dp(12), 0)
    if (primary) { b.backgroundTintList = ColorStateList.valueOf(brand); b.setTextColor(Color.WHITE) }
    b.setOnClickListener { onClick() }
    return b
}

fun ViewGroup.btn(text: String, primary: Boolean = false, weight: Float = 0f, onClick: () -> Unit): Button =
    add(context.makeBtn(text, primary, onClick), if (weight > 0) 0 else WRAP, WRAP, weight)

/** 가로로 버튼 여러 개 */
fun ViewGroup.buttons(vararg items: Pair<String, () -> Unit>): LinearLayout {
    val row = add(context.hbox())
    items.forEach { (t, f) -> row.btn(t, weight = 1f, onClick = f) }
    return row
}

fun ViewGroup.sw(text: String, checked: Boolean, desc: String? = null, onChange: (Boolean) -> Unit): Switch {
    val s = Switch(context)
    s.text = text; s.textSize = 14f; s.isChecked = checked
    s.setPadding(0, context.dp(6), 0, context.dp(6))
    s.setOnCheckedChangeListener { _, v -> onChange(v) }
    add(s)
    if (desc != null) label(desc, 12f, color = GRAY)
    return s
}

fun ViewGroup.seek(text: String, min: Int, max: Int, value: Int, unit: String, onChange: (Int) -> Unit) {
    val t = label("$text: $value$unit", 13f, topDp = 6)
    val s = SeekBar(context)
    s.max = max - min; s.progress = (value - min).coerceIn(0, max - min)
    s.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(sb: SeekBar, p: Int, user: Boolean) { t.text = "$text: ${p + min}$unit"; if (user) onChange(p + min) }
        override fun onStartTrackingTouch(sb: SeekBar) {}
        override fun onStopTrackingTouch(sb: SeekBar) {}
    })
    add(s)
}

fun ViewGroup.divider() {
    val v = View(context); v.setBackgroundColor(LINE)
    add(v, MATCH, context.dp(1), topDp = 8)
}

fun Context.toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
fun Context.toastLong(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

fun Context.confirm(title: String, msg: String, ok: String = "확인", onOk: () -> Unit) {
    AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton(ok) { _, _ -> onOk() }
        .setNegativeButton("취소", null).show()
}

fun Context.inputDialog(title: String, initial: String, multiline: Boolean = false, hint: String = "", onOk: (String) -> Unit) {
    val e = EditText(this)
    e.setText(initial); e.hint = hint
    e.inputType = if (multiline) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE else InputType.TYPE_CLASS_TEXT
    if (multiline) { e.minLines = 3; e.maxLines = 8 }
    val box = vbox(16); box.add(e)
    AlertDialog.Builder(this).setTitle(title).setView(box).setPositiveButton("저장") { _, _ -> onOk(e.text.toString()) }
        .setNegativeButton("취소", null).show()
}

fun timeText(t: Long): String {
    val now = System.currentTimeMillis()
    val d = now - t
    return when {
        d < 60_000 -> "방금"
        d < 3_600_000 -> "${d / 60_000}분 전"
        d < 86_400_000 -> SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(t))
        else -> SimpleDateFormat("M/d HH:mm", Locale.KOREA).format(Date(t))
    }
}

/** Android 15 화면 끝까지 그리기 대응: 시스템 바·키보드 영역만큼 여백 */
fun Activity.applyInsets(root: View) {
    root.setOnApplyWindowInsetsListener { v, insets ->
        val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
        v.setPadding(b.left, b.top, b.right, b.bottom)
        insets
    }
}
