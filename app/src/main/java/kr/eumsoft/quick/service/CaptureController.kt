package kr.eumsoft.quick.service

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Build
import android.os.Vibrator
import android.util.Log
import android.view.Display
import android.view.WindowManager
import android.widget.Toast
import kr.eumsoft.quick.core.CropCalc
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.ImageStore
import kr.eumsoft.quick.core.SaveException
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * 캡처: 접근성 서비스의 공식 캡처 API(AccessibilityService.takeScreenshot, Android 11+).
 * 캡처 직전 도우미 UI를 숨기고, 성공·실패와 관계없이 반드시 복구한다.
 * 보안 화면(FLAG_SECURE)은 우회하지 않는다 → 검게 나오면 저장하지 않고 안내.
 */
class CaptureController(private val svc: HelperService) {
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var busy = false
    private var lastAt = 0L

    fun request(fromShade: Boolean = false) {
        val p = svc.prefs
        if (p.paused) { toast("일시정지 중입니다. 알림에서 재개하세요."); return }
        if (!p.captureEnabled) { toast("캡처 기능이 꺼져 있습니다."); return }
        Log.i("EUMQ", "capture request busy=$busy")
        if (busy) return // 중복 실행 방지
        val now = SystemClock.elapsedRealtime()
        if (now - lastAt < 1100) { toast("잠시 후 다시 캡처하세요."); return }
        busy = true
        lastAt = now
        if (fromShade) svc.performGlobalAction(
            if (Build.VERSION.SDK_INT >= 31) AccessibilityService.GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE else AccessibilityService.GLOBAL_ACTION_BACK
        )
        svc.overlay.hideForCapture()
        svc.main.postDelayed({ shoot() }, if (fromShade) 700L else 180L)
    }

    private var shotSeq = 0
    private fun finish() { busy = false; svc.main.removeCallbacks(watchdog); svc.overlay.restoreAfterCapture() }

    /** 캡처 콜백이 오지 않아도 도우미를 반드시 복구 */
    private val watchdog = Runnable {
        Log.i("EUMQ", "capture timeout")
        shotSeq++
        finish()
        toast("캡처 응답이 없어 취소했습니다. 다시 시도해 주세요.")
    }

    private fun shoot() {
        Log.i("EUMQ", "capture shoot")
        val seq = ++shotSeq
        svc.main.postDelayed(watchdog, 3000)
        val wm = svc.getSystemService(WindowManager::class.java)
        val disp = wm.currentWindowMetrics.bounds
        val bars = svc.systemWindowRects().map { CropCalc.Box(it.left, it.top, it.right, it.bottom) }
        val pkg = svc.currentPkg ?: ""
        try {
            svc.takeScreenshot(Display.DEFAULT_DISPLAY, svc.mainExecutor, object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(r: AccessibilityService.ScreenshotResult) {
                    Log.i("EUMQ", "capture success")
                    if (seq != shotSeq) { r.hardwareBuffer.close(); return }
                    val hb = r.hardwareBuffer
                    val bmp = try { Bitmap.wrapHardwareBuffer(hb, r.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false) } catch (e: Exception) { null }
                    hb.close()
                    finish()
                    if (bmp == null) { toast("캡처 이미지를 읽지 못했습니다."); return }
                    io.execute { process(bmp, disp.width(), disp.height(), bars, pkg) }
                }

                override fun onFailure(code: Int) {
                    Log.i("EUMQ", "capture failure $code")
                    if (seq != shotSeq) return
                    finish()
                    toast(
                        when (code) {
                            AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS ->
                                "캡처 권한이 없습니다. 설정 > 접근성에서 이음 퀵도우미를 다시 켜 주세요."
                            AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "너무 빠르게 캡처했습니다. 잠시 후 다시 시도하세요."
                            AccessibilityService.ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "이 화면은 캡처할 수 없습니다."
                            else -> "캡처에 실패했습니다 (오류 $code)."
                        }
                    )
                }
            })
        } catch (e: Exception) {
            finish()
            toast("캡처를 시작하지 못했습니다: ${e.message}")
        }
    }

    private fun process(full: Bitmap, dispW: Int, dispH: Int, bars: List<CropCalc.Box>, pkg: String) {
        val p = svc.prefs
        val pre = p.preset(pkg)
        val opts = CropCalc.Opts(
            top = p.cropTop, bottom = p.cropBottom, sides = p.cropSides,
            extraTop = p.extraTop + (pre?.get(0) ?: 0), extraBottom = p.extraBottom + (pre?.get(1) ?: 0),
            extraLeft = pre?.get(2) ?: 0, extraRight = pre?.get(3) ?: 0
        )
        val res = CropCalc.compute(full.width, full.height, dispW, dispH, bars, opts)
        val b = res.box
        Log.i("EUMQ", "crop img=${full.width}x${full.height} disp=${dispW}x$dispH bars=$bars box=$b")
        val cropped = if (res.changed) Bitmap.createBitmap(full, b.l, b.t, b.w, b.h) else full
        if (looksBlank(cropped)) {
            toast("화면 내용이 비어 있습니다. 보안 설정으로 캡처가 차단된 화면일 수 있어 저장하지 않았습니다.")
            return
        }
        if (!p.autoSave) {
            // 편집 후 저장: 임시 파일로 두고 편집 화면에서 저장
            val f = File(svc.cacheDir, "pending_${System.currentTimeMillis()}.png")
            try { FileOutputStream(f).use { cropped.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            catch (e: Exception) { toast("임시 저장 실패: ${e.message}"); return }
            val orig = if (p.keepOriginal && res.changed) File(svc.cacheDir, f.name.replace(".png", "_orig.png")).also { o ->
                try { FileOutputStream(o).use { full.compress(Bitmap.CompressFormat.PNG, 100, it) } } catch (_: Exception) {}
            } else null
            vibrate()
            svc.main.post { svc.overlay.showPreview(cropped, -1L, f.absolutePath, orig?.absolutePath ?: "", pkg) }
            return
        }
        val store = ImageStore(svc)
        try {
            val base = store.newBaseName()
            val saved = store.save(cropped, base)
            val orig = if (p.keepOriginal && res.changed) store.save(full, base + "_orig").uri.toString() else ""
            val id = Db.get(svc).addCapture(saved.uri.toString(), orig, saved.name, pkg)
            vibrate() // 저장 완료 후에만 성공 표시
            val note = if (!res.detected) " (시스템 영역 확인 불가 → 자르지 않음)" else ""
            svc.main.post {
                svc.overlay.showPreview(cropped, id, "", "", pkg)
                toast("저장됨: ${saved.name}$note")
            }
        } catch (e: SaveException) {
            toast(e.message ?: "저장 실패")
        }
    }

    /** 거의 전부 순수 검정이면 보안 화면 등으로 막힌 것으로 본다 */
    private fun looksBlank(b: Bitmap): Boolean {
        val n = 40
        var black = 0
        for (yi in 0 until n) for (xi in 0 until n) {
            val c = b.getPixel(xi * (b.width - 1) / (n - 1), yi * (b.height - 1) / (n - 1))
            if (c and 0xFFFFFF == 0) black++
        }
        return black >= n * n * 995 / 1000
    }

    private fun vibrate() {
        try {
            svc.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}
    }

    private fun toast(s: String) = svc.main.post {
        Log.i("EUMQ", "toast $s")
        Toast.makeText(svc, s, Toast.LENGTH_LONG).show() }
}
