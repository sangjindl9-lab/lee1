package kr.eumsoft.quick.service

import android.accessibilityservice.AccessibilityService
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.Toast
import kr.eumsoft.quick.core.CropCalc
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.Prefs

/**
 * 접근성 서비스: 작은 도우미 버튼(접근성 오버레이), 입력창 위치 확인, 붙여넣기, 공식 캡처 API(takeScreenshot).
 * - 입력 내용 변경 이벤트(TYPE_VIEW_TEXT_CHANGED)는 구독하지 않는다 → 키 입력 기록 없음
 * - 클립보드는 읽지 않는다(우회 금지). 붙여넣을 때 클립보드에 '쓰기'만 한다.
 */
class HelperService : AccessibilityService() {
    companion object {
        @Volatile var instance: HelperService? = null
        const val SYSTEMUI = "com.android.systemui"
    }

    lateinit var prefs: Prefs
    lateinit var overlay: HelperOverlay
    lateinit var capture: CaptureController
    lateinit var paste: PasteController
    val main = Handler(Looper.getMainLooper())
    var ready = false
        private set

    /** 사용자가 보고 있는 앱(앱별 제외·자르기 프리셋용) */
    var currentPkg: String? = null
        private set
    var field: AccessibilityNodeInfo? = null
        private set
    var fieldPassword = false
        private set
    var fieldRect: Rect? = null
        private set

    private val checkRunnable = Runnable { checkField() }

    override fun onServiceConnected() {
        instance = this
        prefs = Prefs(this)
        Log.i("EUMQ", "service connected consent=${prefs.consentA11y}")
        if (!prefs.consentA11y) {
            Toast.makeText(this, "이음 퀵도우미 앱에서 접근성 사용 안내를 확인하고 동의해야 동작합니다.", Toast.LENGTH_LONG).show()
            return
        }
        start()
    }

    /** 앱에서 동의를 마친 뒤 서비스가 이미 켜져 있으면 호출 */
    fun start() {
        if (ready) return
        overlay = HelperOverlay(this)
        capture = CaptureController(this)
        paste = PasteController(this)
        ready = true
        Db.get(this).purge(prefs.retentionDays)
        Notifier.show(this)
        overlay.refresh()
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (!ready) return
        when (e.eventType) {
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED -> {
                main.removeCallbacks(checkRunnable)
                main.postDelayed(checkRunnable, 150)
            }
        }
    }

    private fun checkField() {
        if (!ready) return
        val root = try { rootInActiveWindow } catch (e: Exception) { null }
        val pkg = root?.packageName?.toString()
        if (pkg != null && pkg != SYSTEMUI && pkg != packageName) currentPkg = pkg
        if (pkg == packageName) currentPkg = packageName
        val f = try { findFocus(AccessibilityNodeInfo.FOCUS_INPUT) } catch (e: Exception) { null }
        if (f != null && f.isEditable) {
            field = f
            fieldPassword = f.isPassword
            val r = Rect(); f.getBoundsInScreen(r)
            fieldRect = if (r.width() > 0 && r.height() > 0) r else null
        } else {
            field = null; fieldPassword = false; fieldRect = null
        }
        overlay.refresh()
    }

    /** 키보드 창 영역(없으면 null) */
    fun imeRect(): Rect? = try {
        windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }?.let { w -> Rect().also { w.getBoundsInScreen(it) } }
    } catch (e: Exception) { null }

    /** 현재 보이는 시스템 창(상태표시줄·내비게이션 바 등) 영역 */
    fun systemWindowRects(): List<Rect> = try {
        windows.filter { it.type == AccessibilityWindowInfo.TYPE_SYSTEM }.map { w -> Rect().also { w.getBoundsInScreen(it) } }
    } catch (e: Exception) { emptyList() }

    /**
     * 화면에 보이는 시스템 바 영역(화면 좌표).
     * 시스템 창 목록이 기준이며, 제스처 내비게이션처럼 내비게이션 영역이 창으로 보고되지 않는 경우에만
     * (상태표시줄이 보이는 상태일 때) OS가 알려주는 내비게이션 인셋으로 보완한다.
     */
    fun systemBars(): List<CropCalc.Box> {
        val wm = getSystemService(WindowManager::class.java)
        val d = wm.currentWindowMetrics.bounds
        val w = d.width(); val h = d.height()
        val list = systemWindowRects().map { CropCalc.Box(it.left, it.top, it.right, it.bottom) }.toMutableList()
        val probe = CropCalc.compute(w, h, w, h, list, CropCalc.Opts())
        if (probe.top > 0 && probe.bottom == 0 && probe.left == 0 && probe.right == 0) {
            val nav = try { wm.currentWindowMetrics.windowInsets.getInsets(WindowInsets.Type.navigationBars()) } catch (e: Exception) { null }
            Log.i("EUMQ", "nav insets $nav")
            if (nav != null) {
                if (nav.bottom in 1..h / 5) list.add(CropCalc.Box(0, h - nav.bottom, w, h))
                if (nav.left in 1..w / 5) list.add(CropCalc.Box(0, 0, nav.left, h))
                if (nav.right in 1..w / 5) list.add(CropCalc.Box(w - nav.right, 0, w, h))
            }
        }
        return list
    }

    fun isExcludedNow(): Boolean = currentPkg != null && currentPkg in prefs.excluded

    fun setPaused(p: Boolean) {
        prefs.paused = p
        if (ready) { overlay.refresh(); Notifier.show(this) }
    }

    fun recheckSoon() { main.removeCallbacks(checkRunnable); main.postDelayed(checkRunnable, 300) }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (ready) main.postDelayed({ overlay.refresh() }, 300)
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (ready) { overlay.removeAll(); Notifier.cancel(this) }
        ready = false
        instance = null
        super.onDestroy()
    }
}
