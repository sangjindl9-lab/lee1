package kr.eumsoft.quick.service

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kr.eumsoft.quick.R
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.ui.ImageEditActivity
import kr.eumsoft.quick.ui.OcrActivity
import kr.eumsoft.quick.ui.dp
import kr.eumsoft.quick.ui.round
import kotlin.math.abs

/**
 * 하나로 통합된 작은 도우미 UI.
 * - 평소: 화면 가장자리의 작은 버튼 1개 (드래그 이동, 일정 시간 후 가장자리로 접힘)
 * - 입력창 선택 시: 위치를 확인할 수 있으면 입력창 옆으로 이동, 아니면 가장자리 고정
 * - 1번 터치 → 패널(붙여넣기 + 메뉴), 3번 터치 → 캡처, 길게 누르기 → 캡처(설정)
 * 접근성 오버레이 창(TYPE_ACCESSIBILITY_OVERLAY)만 쓰며 화면 전체를 덮는 레이어는 만들지 않는다.
 */
class HelperOverlay(private val svc: HelperService) {
    private val wm = svc.getSystemService(WindowManager::class.java)
    private val p get() = svc.prefs

    private var button: FrameLayout? = null
    private var buttonLp: WindowManager.LayoutParams? = null
    private var panel: PastePanel? = null
    private var panelLp: WindowManager.LayoutParams? = null
    private var preview: View? = null
    private var edge: View? = null
    private var collapsed = false
    private var detachedFromField: Rect? = null
    private var hiddenForCapture = false

    private val collapseRunnable = Runnable { collapse() }

    private fun baseLp(w: Int, h: Int, focusableOutside: Boolean = false) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            (if (focusableOutside) WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH else 0),
        PixelFormat.TRANSLUCENT
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    }

    private fun screen(): Rect = wm.currentWindowMetrics.bounds

    /** 상태 변화(입력창·키보드·설정·일시정지·앱 전환·회전) 때마다 호출 */
    fun refresh() {
        if (hiddenForCapture) { Log.i("EUMQ", "refresh skipped (capturing)"); return }
        val hide = p.paused || svc.isExcludedNow() || (!p.pasteEnabled && !p.captureEnabled)
        if (hide) Log.i("EUMQ", "refresh hide pkg=${svc.currentPkg}")
        if (hide) { removeButton(); closePanel(); removeEdge(); return }
        ensureButton()
        updateEdgeZone()
        positionButton()
    }

    // ---------- 도우미 버튼 ----------
    @SuppressLint("ClickableViewAccessibility")
    private fun ensureButton() {
        val size = svc.dp(p.helperSizeDp)
        val color = Prefs.COLORS[p.helperColor.coerceIn(0, Prefs.COLORS.size - 1)]
        val existing = button
        if (existing != null && buttonLp?.width == size && existing.tag == color) return
        removeButton()
        val f = FrameLayout(svc)
        f.tag = color
        f.background = round(color, size / 2f, Color.WHITE, svc.dp(2))
        val icon = ImageView(svc)
        icon.setImageResource(R.drawable.ic_logo_mark)
        val pad = size / 4
        f.addView(icon, FrameLayout.LayoutParams(size - pad * 2, size - pad * 2, Gravity.CENTER))
        f.contentDescription = "이음 퀵도우미 버튼. 한 번 누르면 메뉴, 세 번 누르면 캡처"
        f.setOnTouchListener(TapHandler())
        val lp = baseLp(size, size)
        wm.addView(f, lp)
        button = f; buttonLp = lp
    }

    private fun removeButton() {
        button?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        button = null; buttonLp = null
        svc.main.removeCallbacks(collapseRunnable)
    }

    private fun positionButton() {
        val b = button ?: return
        val lp = buttonLp ?: return
        val s = screen()
        val size = lp.width
        val gap = svc.dp(6)
        val ime = svc.imeRect()
        val fr = svc.fieldRect
        val fieldOk = fr != null && p.pasteEnabled && p.nearField && !svc.fieldPassword &&
            fr.height() < s.height() * 6 / 10 && Rect.intersects(fr, s) && detachedFromField != fr
        b.alpha = p.helperAlpha / 100f
        if (fieldOk && fr != null) {
            // 입력창 옆: 오른쪽 바깥 → 공간 없으면 입력창 위 오른쪽 끝 → 위 공간 없으면 아래
            var x: Int; var y: Int
            if (fr.right + gap + size <= s.right) { x = fr.right + gap; y = fr.centerY() - size / 2 }
            else {
                x = fr.right - size
                y = fr.top - size - gap
                if (y < s.top + svc.dp(24)) y = fr.bottom + gap
            }
            if (ime != null && ime.height() > 0 && y + size > ime.top && y < ime.bottom) y = ime.top - size - gap
            lp.x = x.coerceIn(s.left, s.right - size); lp.y = y.coerceIn(s.top, s.bottom - size)
            collapsed = false
            svc.main.removeCallbacks(collapseRunnable)
        } else {
            placeAtEdge(lp, s, ime, collapsed)
            scheduleCollapse()
        }
        try { wm.updateViewLayout(b, lp) } catch (_: Exception) {}
        Log.i("EUMQ", "helper ${lp.x} ${lp.y} ${lp.width} field=${fieldOk}")
    }

    private fun placeAtEdge(lp: WindowManager.LayoutParams, s: Rect, ime: Rect?, half: Boolean) {
        val size = lp.width
        val margin = svc.dp(48) // 상태표시줄·내비게이션 영역을 피함
        var y = s.top + s.height() * p.helperYPermil / 1000
        y = y.coerceIn(s.top + margin, s.bottom - size - margin)
        if (ime != null && ime.height() > 0 && y + size > ime.top) y = (ime.top - size - svc.dp(8)).coerceAtLeast(s.top + margin)
        val hidePart = if (half) size / 2 else 0
        lp.x = if (p.helperRight) s.right - size + hidePart else s.left - hidePart
        lp.y = y
    }

    private fun scheduleCollapse() {
        svc.main.removeCallbacks(collapseRunnable)
        if (p.collapseSec > 0 && !collapsed) svc.main.postDelayed(collapseRunnable, p.collapseSec * 1000L)
    }

    private fun collapse() {
        if (panel != null || button == null) return
        collapsed = true
        button?.alpha = p.helperAlpha / 100f * 0.5f
        val lp = buttonLp ?: return
        placeAtEdge(lp, screen(), svc.imeRect(), true)
        try { wm.updateViewLayout(button, lp) } catch (_: Exception) {}
    }

    private fun expand() {
        if (!collapsed) return
        collapsed = false
        positionButton()
    }

    /** 한 번 / 세 번 / 길게 / 드래그를 서로 방해하지 않게 구분 */
    private inner class TapHandler : View.OnTouchListener {
        private var downX = 0f; private var downY = 0f
        private var startX = 0; private var startY = 0
        private var dragging = false
        private var longFired = false
        private var taps = 0
        private var lastUp = 0L
        private val slop = ViewConfiguration.get(svc).scaledTouchSlop
        private val single = Runnable { val n = taps; taps = 0; if (n in 1..2) onSingleTap() }
        private val long = Runnable { longFired = true; taps = 0; svc.main.removeCallbacks(single); if (p.longPressCapture) svc.capture.request() }

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val lp = buttonLp ?: return false
            if (e.actionMasked != MotionEvent.ACTION_MOVE) Log.i("EUMQ", "touch ${e.actionMasked}")
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y
                    dragging = false; longFired = false
                    svc.main.removeCallbacks(collapseRunnable)
                    if (collapsed) expand()
                    svc.main.postDelayed(long, 650)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
                        dragging = true; svc.main.removeCallbacks(long); taps = 0; svc.main.removeCallbacks(single)
                    }
                    if (dragging) {
                        lp.x = (startX + dx).toInt(); lp.y = (startY + dy).toInt()
                        try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
                    }
                }
                MotionEvent.ACTION_UP -> {
                    svc.main.removeCallbacks(long)
                    if (dragging) {
                        val s = screen()
                        p.helperRight = lp.x + lp.width / 2 > s.centerX()
                        p.helperYPermil = ((lp.y - s.top) * 1000 / s.height().coerceAtLeast(1)).coerceIn(0, 1000)
                        detachedFromField = svc.fieldRect
                        positionButton()
                    } else if (!longFired) {
                        val now = System.currentTimeMillis()
                        taps = if (now - lastUp <= p.tripleMs) taps + 1 else 1
                        lastUp = now
                        svc.main.removeCallbacks(single)
                        if (taps >= 3) { taps = 0; closePanel(); svc.capture.request() }
                        else svc.main.postDelayed(single, p.tripleMs.toLong())
                    }
                    scheduleCollapse()
                }
                MotionEvent.ACTION_CANCEL -> { svc.main.removeCallbacks(long); dragging = false }
            }
            return true
        }
    }

    private var panelClosedAt = 0L

    private fun onSingleTap() {
        if (panel != null) { closePanel(); return }
        if (System.currentTimeMillis() - panelClosedAt < 800) return // 바깥 터치로 방금 닫힌 경우 다시 열지 않음
        openPanel()
    }

    // ---------- 패널(붙여넣기 + 메뉴 통합) ----------
    @SuppressLint("ClickableViewAccessibility")
    fun openPanel() {
        closePanel()
        val s = screen()
        val pv = PastePanel(svc, this)
        val w = minOf(s.width() - svc.dp(16), svc.dp(380))
        val lp = baseLp(w, WindowManager.LayoutParams.WRAP_CONTENT, focusableOutside = true)
        val ime = svc.imeRect()
        val bottomLimit = if (ime != null && ime.height() > 0) ime.top else s.bottom - svc.dp(48)
        pv.maxHeightPx = (bottomLimit - s.top - svc.dp(64)).coerceAtLeast(svc.dp(200))
        lp.x = s.left + (s.width() - w) / 2
        // 버튼 근처, 키보드 위
        val by = buttonLp?.y ?: (s.top + s.height() / 3)
        lp.y = (by - svc.dp(120)).coerceIn(s.top + svc.dp(40), (bottomLimit - pv.maxHeightPx).coerceAtLeast(s.top + svc.dp(40)))
        pv.view.setOnTouchListener { _, e -> if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) { closePanel(); true } else false }
        wm.addView(pv.view, lp)
        panel = pv; panelLp = lp
        svc.main.removeCallbacks(collapseRunnable)
    }

    fun closePanel() {
        panel?.let { try { wm.removeView(it.view) } catch (_: Exception) {}; panelClosedAt = System.currentTimeMillis() }
        panel = null; panelLp = null
        if (button != null) scheduleCollapse()
    }

    // ---------- 가장자리 터치 영역(세 번 터치 → 캡처) ----------
    @SuppressLint("ClickableViewAccessibility")
    private fun updateEdgeZone() {
        if (!p.edgeZone || !p.captureEnabled) { removeEdge(); return }
        if (edge != null) return
        val v = View(svc)
        v.setBackgroundColor(0x22000000)
        v.contentDescription = "캡처 터치 영역. 세 번 누르면 캡처"
        var taps = 0; var last = 0L
        v.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_UP) {
                val now = System.currentTimeMillis()
                taps = if (now - last <= p.tripleMs) taps + 1 else 1
                last = now
                if (taps >= 3) { taps = 0; svc.capture.request() }
            }
            true
        }
        val s = screen()
        val lp = baseLp(svc.dp(14), svc.dp(96))
        lp.x = if (p.helperRight) s.left else s.right - svc.dp(14) // 도우미 버튼 반대쪽
        lp.y = s.top + s.height() / 4
        wm.addView(v, lp)
        edge = v
    }

    private fun removeEdge() {
        edge?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        edge = null
    }

    // ---------- 캡처 중 숨기기 / 복구 ----------
    fun hideForCapture() {
        hiddenForCapture = true
        removePreview()
        closePanel()
        button?.visibility = View.INVISIBLE
        edge?.visibility = View.INVISIBLE
    }

    fun restoreAfterCapture() {
        hiddenForCapture = false
        button?.visibility = View.VISIBLE
        edge?.visibility = View.VISIBLE
        refresh()
    }

    // ---------- 캡처 미리보기 ----------
    fun showPreview(bmp: Bitmap, captureId: Long, pendingPath: String, pendingOrig: String, pkg: String) {
        removePreview()
        val s = screen()
        val box = LinearLayout(svc)
        box.orientation = LinearLayout.VERTICAL
        box.background = round(0xF2FFFFFF.toInt(), svc.dp(12).toFloat(), 0xFFD1D5DB.toInt(), svc.dp(1))
        val pad = svc.dp(6); box.setPadding(pad, pad, pad, pad)
        val thumbW = svc.dp(96)
        val img = ImageView(svc)
        img.setImageBitmap(bmp)
        img.adjustViewBounds = true
        img.maxHeight = svc.dp(150)
        box.addView(img, LinearLayout.LayoutParams(thumbW, LinearLayout.LayoutParams.WRAP_CONTENT))
        fun item(t: String, action: () -> Unit) {
            val tv = TextView(svc)
            tv.text = t; tv.textSize = 12f; tv.setTextColor(0xFF111827.toInt()); tv.gravity = Gravity.CENTER
            tv.setPadding(0, svc.dp(5), 0, svc.dp(5))
            tv.setOnClickListener { removePreview(); action() }
            box.addView(tv, LinearLayout.LayoutParams(thumbW, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        fun open(mode: String) = svc.startActivity(Intent(svc, ImageEditActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("id", captureId).putExtra("pending", pendingPath).putExtra("pendingOrig", pendingOrig)
            .putExtra("pkg", pkg).putExtra("mode", mode))
        if (captureId >= 0) {
            item("공유") { open("share") }
            item("글자 추출") {
                svc.startActivity(Intent(svc, OcrActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("captureId", captureId))
            }
            item("자르기 수정") { open("crop") }
            item("가리기") { open("mask") }
            item("삭제") {
                val c = kr.eumsoft.quick.core.Db.get(svc).capture(captureId)
                if (c != null) {
                    val st = kr.eumsoft.quick.core.ImageStore(svc)
                    st.delete(c.uri); st.delete(c.origUri)
                    kr.eumsoft.quick.core.Db.get(svc).deleteCapture(captureId)
                    Toast.makeText(svc, "삭제했습니다.", Toast.LENGTH_SHORT).show()
                }
            }
        } else {
            item("편집 후 저장") { open("crop") }
            item("버리기") { java.io.File(pendingPath).delete(); if (pendingOrig.isNotEmpty()) java.io.File(pendingOrig).delete() }
        }
        val lp = baseLp(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT)
        lp.x = s.left + svc.dp(12)
        lp.y = s.bottom - svc.dp(96) - svc.dp(330)
        wm.addView(box, lp)
        preview = box
        svc.main.postDelayed({ if (preview === box) removePreview() }, 6000)
    }

    fun removePreview() {
        preview?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        preview = null
    }

    fun removeAll() { removeButton(); closePanel(); removePreview(); removeEdge() }
}
