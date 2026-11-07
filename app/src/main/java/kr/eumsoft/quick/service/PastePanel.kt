package kr.eumsoft.quick.service

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kr.eumsoft.quick.core.Clip
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.TextTools
import kr.eumsoft.quick.ui.ClipEditActivity
import kr.eumsoft.quick.ui.ImportClipActivity
import kr.eumsoft.quick.ui.MainActivity
import kr.eumsoft.quick.ui.TemplateFillActivity
import kr.eumsoft.quick.ui.brand
import kr.eumsoft.quick.ui.dp
import kr.eumsoft.quick.ui.round
import kr.eumsoft.quick.ui.timeText

/** 도우미 패널: 붙여넣기(최근·자주 쓰는·템플릿·순서) + 메뉴(캡처·가져오기·일시정지)를 한 화면에 */
class PastePanel(private val svc: HelperService, private val overlay: HelperOverlay) {
    companion object {
        private var tab = 0
        private var folder: String? = null
        private var clean = TextTools.Clean()
    }

    var maxHeightPx = 0
    private val db = Db.get(svc)
    private val ctx: Context = svc
    private var merge = false
    private val picked = ArrayList<Clip>()
    private var sep = "\n"

    val view: LinearLayout = object : LinearLayout(svc) {
        override fun onMeasure(w: Int, h: Int) {
            super.onMeasure(w, if (maxHeightPx > 0) View.MeasureSpec.makeMeasureSpec(maxHeightPx, View.MeasureSpec.AT_MOST) else h)
        }
    }
    private val list = LinearLayout(svc).apply { orientation = LinearLayout.VERTICAL }
    private val footer = LinearLayout(svc).apply { orientation = LinearLayout.VERTICAL }
    private val scroll = object : ScrollView(svc) {
        override fun onMeasure(w: Int, h: Int) {
            val max = (maxHeightPx - svc.dp(150)).coerceAtLeast(svc.dp(120))
            super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(max, View.MeasureSpec.AT_MOST))
        }
    }
    private val tabsRow = LinearLayout(svc)
    private val optsRow = LinearLayout(svc)

    init {
        view.orientation = LinearLayout.VERTICAL
        view.background = round(Color.WHITE, ctx.dp(14).toFloat(), 0xFFD1D5DB.toInt(), ctx.dp(1))
        val pad = ctx.dp(8); view.setPadding(pad, pad, pad, pad)
        view.elevation = ctx.dp(6).toFloat()

        // 메뉴 줄
        val menu = LinearLayout(svc); menu.gravity = Gravity.CENTER_VERTICAL
        if (svc.prefs.captureEnabled) menu.addView(chip("캡처", false) { overlay.closePanel(); svc.capture.request() }, wrap())
        menu.addView(chip("클립보드 가져오기", false) {
            overlay.closePanel()
            svc.startActivity(Intent(svc, ImportClipActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }, wrap())
        menu.addView(chip("앱", false) {
            overlay.closePanel()
            svc.startActivity(Intent(svc, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }, wrap())
        menu.addView(chip("일시정지", false) { overlay.closePanel(); svc.setPaused(true) }, wrap())
        menu.addView(View(svc), LinearLayout.LayoutParams(0, 1, 1f))
        menu.addView(chip("✕", false) { overlay.closePanel() }, wrap())
        view.addView(HorizontalScrollView(svc).apply { isHorizontalScrollBarEnabled = false; addView(menu) })

        val status = TextView(svc); status.textSize = 11f; status.setTextColor(0xFF6B7280.toInt())
        status.text = when {
            !svc.prefs.pasteEnabled -> "붙여넣기 기능이 꺼져 있습니다 (설정에서 켤 수 있음)"
            svc.fieldPassword -> "비밀번호 입력창: 붙여넣기 도우미를 사용할 수 없습니다"
            svc.field != null -> "항목을 누르면 현재 커서 위치에 붙여넣습니다"
            else -> "선택된 입력창이 없습니다 · 항목을 누르면 클립보드에 복사됩니다"
        }
        status.setPadding(ctx.dp(4), ctx.dp(4), 0, ctx.dp(4))
        view.addView(status)

        if (svc.prefs.pasteEnabled && !svc.fieldPassword) {
            view.addView(tabsRow)
            view.addView(HorizontalScrollView(svc).apply { isHorizontalScrollBarEnabled = false; addView(optsRow) })
            scroll.addView(list)
            view.addView(scroll)
            view.addView(footer)
            render()
        }
    }

    private fun wrap() = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        .apply { rightMargin = ctx.dp(4) }

    private fun chip(t: String, on: Boolean, click: () -> Unit): TextView {
        val v = TextView(svc)
        v.text = t; v.textSize = 13f; v.gravity = Gravity.CENTER
        v.setTextColor(if (on) Color.WHITE else 0xFF111827.toInt())
        v.background = round(if (on) ctx.brand else 0xFFF3F4F6.toInt(), ctx.dp(16).toFloat())
        v.setPadding(ctx.dp(10), ctx.dp(6), ctx.dp(10), ctx.dp(6))
        v.setOnClickListener { click() }
        return v
    }

    private fun render() {
        tabsRow.removeAllViews()
        listOf("최근", "자주 쓰는", "템플릿", "순서").forEachIndexed { i, t ->
            tabsRow.addView(chip(t, tab == i) { tab = i; merge = false; picked.clear(); render() }, wrap())
        }
        optsRow.removeAllViews()
        optsRow.setPadding(0, ctx.dp(4), 0, ctx.dp(4))
        if (tab <= 1) {
            if (tab == 1) {
                optsRow.addView(chip("전체", folder == null) { folder = null; render() }, wrap())
                Db.FOLDERS.forEach { f -> optsRow.addView(chip(f, folder == f) { folder = f; render() }, wrap()) }
            }
            optsRow.addView(chip("합치기", merge) { merge = !merge; picked.clear(); render() }, wrap())
            optsRow.addView(chip("앞뒤공백", clean.trim) { clean = clean.copy(trim = !clean.trim); render() }, wrap())
            optsRow.addView(chip("연속공백", clean.collapseSpaces) { clean = clean.copy(collapseSpaces = !clean.collapseSpaces); render() }, wrap())
            optsRow.addView(chip("한 줄로", clean.oneLine) { clean = clean.copy(oneLine = !clean.oneLine); render() }, wrap())
        }
        list.removeAllViews(); footer.removeAllViews()
        when (tab) {
            0 -> clipList(db.recent(5), "아직 확보한 클립이 없습니다.\n공유 메뉴 → 이음 퀵도우미, 위의 '클립보드 가져오기', 캡처 글자 추출로 추가할 수 있습니다.")
            1 -> clipList(db.favorites(folder), "자주 쓰는 문구가 없습니다. 앱 > 클립 > 자주 쓰는 문구에서 등록하세요.")
            2 -> templateList()
            3 -> sequenceView()
        }
        if (merge && tab <= 1) mergeFooter()
    }

    private fun empty(msg: String) {
        val t = TextView(svc); t.text = msg; t.textSize = 13f; t.setTextColor(0xFF6B7280.toInt())
        t.setPadding(ctx.dp(8), ctx.dp(16), ctx.dp(8), ctx.dp(16))
        list.addView(t)
    }

    private fun clipList(items: List<Clip>, emptyMsg: String) {
        if (items.isEmpty()) { empty(emptyMsg); return }
        for (c in items) {
            val row = LinearLayout(svc); row.orientation = LinearLayout.VERTICAL
            row.setPadding(ctx.dp(8), ctx.dp(8), ctx.dp(8), ctx.dp(6))
            val order = picked.indexOfFirst { it.id == c.id }
            row.background = round(if (order >= 0) 0xFFE8F0FE.toInt() else 0xFFF9FAFB.toInt(), ctx.dp(10).toFloat())
            val t = TextView(svc)
            t.text = (if (order >= 0) "${order + 1}. " else "") + (if (c.title.isNotEmpty()) "[${c.title}] " else "") + c.text
            t.textSize = 14f; t.maxLines = 2; t.ellipsize = TextUtils.TruncateAt.END; t.setTextColor(0xFF111827.toInt())
            row.addView(t)
            val meta = LinearLayout(svc); meta.gravity = Gravity.CENTER_VERTICAL
            val m = TextView(svc); m.textSize = 11f; m.setTextColor(0xFF6B7280.toInt())
            m.text = timeText(c.created) + " · " + (if (c.kind == "fav") c.folder else c.source) + if (c.pinned) " · 고정됨" else ""
            meta.addView(m, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            if (c.kind == "recent") meta.addView(small(if (c.pinned) "고정해제" else "고정") { db.setPinned(c.id, !c.pinned); render() })
            meta.addView(small("수정") {
                overlay.closePanel()
                svc.startActivity(Intent(svc, ClipEditActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("id", c.id))
            })
            meta.addView(small("삭제") { db.delete(c.id); picked.removeAll { it.id == c.id }; render() })
            row.addView(meta)
            row.setOnClickListener {
                if (merge) {
                    if (order >= 0) picked.removeAt(order) else picked.add(c)
                    render()
                } else confirmOrPaste(c.text)
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = ctx.dp(4)
            list.addView(row, lp)
        }
    }

    private fun small(t: String, click: () -> Unit): TextView {
        val v = TextView(svc); v.text = t; v.textSize = 12f; v.setTextColor(ctx.brand)
        v.setPadding(ctx.dp(8), ctx.dp(4), ctx.dp(4), ctx.dp(4))
        v.setOnClickListener { click() }
        return v
    }

    private fun cleaned(s: String) = TextTools.clean(s, clean)
    private val cleanOn get() = clean.trim || clean.collapseSpaces || clean.oneLine

    /** 정리 옵션이 켜져 있으면 미리보기 후 붙여넣기(원문은 보관함에 그대로 유지) */
    private fun confirmOrPaste(original: String) {
        val out = cleaned(original)
        if (!cleanOn || out == original) { doPaste(out); return }
        footer.removeAllViews()
        footer.addView(previewBox("정리된 문구 미리보기", out))
        val r = LinearLayout(svc)
        r.addView(chip("정리된 문구 붙여넣기", true) { doPaste(out) }, wrap())
        r.addView(chip("원문 그대로", false) { doPaste(original) }, wrap())
        footer.addView(r)
    }

    private fun previewBox(head: String, body: String): TextView {
        val t = TextView(svc)
        t.text = "$head\n$body"; t.textSize = 12f; t.maxLines = 6; t.ellipsize = TextUtils.TruncateAt.END
        t.setTextColor(0xFF374151.toInt())
        t.background = round(0xFFFFF7E6.toInt(), ctx.dp(8).toFloat())
        t.setPadding(ctx.dp(8), ctx.dp(6), ctx.dp(8), ctx.dp(6))
        return t
    }

    private fun mergeFooter() {
        val r = LinearLayout(svc); r.setPadding(0, ctx.dp(6), 0, ctx.dp(4))
        listOf("줄바꿈" to "\n", "공백" to " ", "쉼표" to ", ").forEach { (n, s) ->
            r.addView(chip(n, sep == s) { sep = s; render() }, wrap())
        }
        footer.addView(r)
        if (picked.isEmpty()) {
            val t = TextView(svc); t.text = "합칠 항목을 순서대로 누르세요 (다시 누르면 빠짐)"; t.textSize = 12f
            t.setTextColor(0xFF6B7280.toInt()); footer.addView(t); return
        }
        val joined = cleaned(TextTools.join(picked.map { it.text }, sep))
        footer.addView(previewBox("미리보기 (${picked.size}개)", joined))
        val b = LinearLayout(svc)
        b.addView(chip("합쳐서 붙여넣기", true) { doPaste(joined) }, wrap())
        b.addView(chip("선택 해제", false) { picked.clear(); render() }, wrap())
        footer.addView(b)
    }

    private fun templateList() {
        val items = db.templates()
        if (items.isEmpty()) { empty("템플릿이 없습니다. 앱 > 클립 > 템플릿에서 만드세요.\n예: 안녕하세요. {회사명} {이름}입니다."); return }
        for (c in items) {
            val t = TextView(svc)
            t.text = (if (c.title.isNotEmpty()) "${c.title}\n" else "") + TextTools.preview(c.text, 80)
            t.textSize = 13f; t.setTextColor(0xFF111827.toInt())
            t.background = round(0xFFF9FAFB.toInt(), ctx.dp(10).toFloat())
            t.setPadding(ctx.dp(8), ctx.dp(8), ctx.dp(8), ctx.dp(8))
            t.setOnClickListener {
                if (TextTools.templateFields(c.text).isEmpty()) doPaste(c.text)
                else {
                    overlay.closePanel()
                    svc.startActivity(Intent(svc, TemplateFillActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("id", c.id))
                }
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = ctx.dp(4)
            list.addView(t, lp)
        }
    }

    private fun sequenceView() {
        val seq = db.sequence()
        if (seq.isEmpty()) { empty("등록된 순서가 없습니다. 앱 > 클립 > 순서대로 붙여넣기에서 등록하세요.\n예: 이름 → 연락처 → 주소"); return }
        var idx = svc.prefs.sequenceIndex
        if (idx !in seq.indices) idx = if (idx >= seq.size) seq.size else 0
        seq.forEachIndexed { i, (_, text) ->
            val t = TextView(svc)
            t.text = "${i + 1}. ${TextTools.preview(text, 50)}" + if (i == idx) "  ← 다음" else ""
            t.textSize = 13f
            t.setTextColor(if (i < idx) 0xFF9CA3AF.toInt() else 0xFF111827.toInt())
            if (i == idx) t.background = round(0xFFE8F0FE.toInt(), ctx.dp(8).toFloat())
            t.setPadding(ctx.dp(8), ctx.dp(6), ctx.dp(8), ctx.dp(6))
            list.addView(t)
        }
        val info = TextView(svc); info.textSize = 12f; info.setTextColor(0xFF6B7280.toInt())
        info.text = if (idx >= seq.size) "모든 항목을 붙여넣었습니다." else "다음 입력칸을 직접 선택한 뒤 버튼을 누르세요. 앱이 입력칸을 이동하거나 제출하지 않습니다."
        footer.addView(info)
        val r = LinearLayout(svc); r.setPadding(0, ctx.dp(4), 0, 0)
        if (idx < seq.size) r.addView(chip("다음 붙여넣기 (${idx + 1}/${seq.size})", true) {
            val text = seq[idx].second
            doPaste(text) { ok -> if (ok) svc.prefs.sequenceIndex = idx + 1 }
        }, wrap())
        r.addView(chip("이전", false) { svc.prefs.sequenceIndex = (idx - 1).coerceAtLeast(0); render() }, wrap())
        r.addView(chip("처음으로", false) { svc.prefs.sequenceIndex = 0; render() }, wrap())
        footer.addView(HorizontalScrollView(svc).apply { addView(r) })
    }

    private fun doPaste(text: String, after: ((Boolean) -> Unit)? = null) {
        svc.paste.paste(text) { r ->
            after?.invoke(r != PasteController.Result.BLOCKED)
            if (r != PasteController.Result.BLOCKED) overlay.closePanel()
        }
    }
}
