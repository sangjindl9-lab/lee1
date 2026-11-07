package kr.eumsoft.quick.service

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import kr.eumsoft.quick.ime.EumKeyboard

/**
 * 안전한 붙여넣기.
 * 1) 전용 키보드가 현재 입력 중이면 IME commitText → 커서 위치 삽입·선택 영역 교체 (클립보드 안 건드림)
 * 2) 아니면 클립보드에 쓰고 입력창에 ACTION_PASTE → 앱 자체 붙여넣기 동작이므로 커서·선택 영역이 보존됨
 * 3) 둘 다 불가하면 내용을 덮어쓰지 않고 클립보드에 복사만 한 뒤 기본 붙여넣기를 안내
 * 입력창 전체 내용을 다시 써 넣는 ACTION_SET_TEXT는 사용하지 않는다.
 */
class PasteController(private val svc: HelperService) {
    enum class Result { INSERTED, COPIED_ONLY, BLOCKED }

    fun paste(text: String, done: (Result) -> Unit) {
        if (svc.prefs.paused) { done(Result.BLOCKED); return }
        if (svc.fieldPassword) {
            toast("비밀번호 입력창에서는 붙여넣기 도우미를 사용할 수 없습니다.")
            done(Result.BLOCKED); return
        }
        val ime = EumKeyboard.instance
        if (ime != null && ime.isActiveInput()) {
            if (ime.insertText(text)) { done(Result.INSERTED); return }
        }
        setClip(text)
        val node = svc.field
        if (node == null) {
            toast("입력창을 확인하지 못해 클립보드에 복사했습니다. 입력창을 길게 눌러 붙여넣기 하세요.")
            done(Result.COPIED_ONLY); return
        }
        val before = try { node.refresh(); node.text?.toString() } catch (e: Exception) { null }
        val supportsPaste = node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_PASTE }
        val ok = supportsPaste && try { node.performAction(AccessibilityNodeInfo.ACTION_PASTE) } catch (e: Exception) { false }
        if (!ok) {
            toast("이 입력창은 바로 붙여넣기를 지원하지 않아 클립보드에 복사했습니다. 입력창을 길게 눌러 붙여넣기 하세요.")
            done(Result.COPIED_ONLY); return
        }
        // 결과 확인: 앱이 실제로 내용을 바꿨는지 확인
        svc.main.postDelayed({
            val after = try { node.refresh(); node.text?.toString() } catch (e: Exception) { null }
            if (after != null && after != before) done(Result.INSERTED)
            else {
                toast("붙여넣기 결과를 확인하지 못했습니다. 입력되지 않았다면 입력창을 길게 눌러 붙여넣기 하세요. (클립보드에 복사됨)")
                done(Result.COPIED_ONLY)
            }
        }, 300)
    }

    private fun setClip(text: String) {
        svc.prefs.markSelfClip(text)
        val cm = svc.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("EUM QUICK", text)) // 서식 없는 일반 텍스트
    }

    private fun toast(s: String) = Toast.makeText(svc, s, Toast.LENGTH_LONG).show()
}
