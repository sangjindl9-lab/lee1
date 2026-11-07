package kr.eumsoft.quick.core

import android.content.Context
import android.content.SharedPreferences

/** 앱 설정. 모든 값은 기기에만 저장된다. */
class Prefs(ctx: Context) {
    val sp: SharedPreferences = ctx.applicationContext.getSharedPreferences("eum", Context.MODE_PRIVATE)

    private fun b(k: String, d: Boolean) = sp.getBoolean(k, d)
    private fun i(k: String, d: Int) = sp.getInt(k, d)
    private fun s(k: String, d: String) = sp.getString(k, d) ?: d
    private fun put(k: String, v: Boolean) = sp.edit().putBoolean(k, v).apply()
    private fun put(k: String, v: Int) = sp.edit().putInt(k, v).apply()
    private fun put(k: String, v: String) = sp.edit().putString(k, v).apply()

    // 동의·상태
    var consentA11y: Boolean get() = b("consentA11y", false); set(v) = put("consentA11y", v)
    var paused: Boolean get() = b("paused", false); set(v) = put("paused", v)
    var collectPaused: Boolean get() = b("collectPaused", false); set(v) = put("collectPaused", v)

    // 기능 켜기/끄기
    var pasteEnabled: Boolean get() = b("pasteEnabled", true); set(v) = put("pasteEnabled", v)
    var captureEnabled: Boolean get() = b("captureEnabled", true); set(v) = put("captureEnabled", v)
    /** 도우미 패널을 열 때 현재 클립보드를 자동으로 가져오기 */
    var autoImport: Boolean get() = b("autoImport", true); set(v) = put("autoImport", v)
    var nearField: Boolean get() = b("nearField", true); set(v) = put("nearField", v)

    // 도우미 버튼
    var helperSizeDp: Int get() = i("helperSizeDp", 44); set(v) = put("helperSizeDp", v)
    var helperAlpha: Int get() = i("helperAlpha", 85); set(v) = put("helperAlpha", v)
    var helperColor: Int get() = i("helperColor", 0); set(v) = put("helperColor", v)
    var helperRight: Boolean get() = b("helperRight", true); set(v) = put("helperRight", v)
    var helperYPermil: Int get() = i("helperYPermil", 400); set(v) = put("helperYPermil", v)
    var collapseSec: Int get() = i("collapseSec", 5); set(v) = put("collapseSec", v)
    var excluded: Set<String>
        get() = sp.getStringSet("excluded", emptySet())!!.toSet()
        set(v) = sp.edit().putStringSet("excluded", v).apply()

    // 캡처 제스처
    var tripleMs: Int get() = i("tripleMs", 450); set(v) = put("tripleMs", v)
    var longPressCapture: Boolean get() = b("longPressCapture", true); set(v) = put("longPressCapture", v)
    var edgeZone: Boolean get() = b("edgeZone", false); set(v) = put("edgeZone", v)

    // 자동 크롭
    var cropTop: Boolean get() = b("cropTop", true); set(v) = put("cropTop", v)
    var cropBottom: Boolean get() = b("cropBottom", true); set(v) = put("cropBottom", v)
    var cropSides: Boolean get() = b("cropSides", true); set(v) = put("cropSides", v)
    var extraTop: Int get() = i("extraTop", 0); set(v) = put("extraTop", v)
    var extraBottom: Int get() = i("extraBottom", 0); set(v) = put("extraBottom", v)

    /** 앱별 자르기 프리셋: "위,아래,왼쪽,오른쪽" 추가 여백(px) */
    fun preset(pkg: String?): IntArray? {
        if (pkg == null) return null
        val v = sp.getString("preset_$pkg", null) ?: return null
        val p = v.split(',').mapNotNull { it.toIntOrNull() }
        return if (p.size == 4) p.toIntArray() else null
    }
    fun setPreset(pkg: String, v: IntArray?) {
        if (v == null) sp.edit().remove("preset_$pkg").apply() else put("preset_$pkg", v.joinToString(","))
    }
    fun presetPackages(): List<String> = sp.all.keys.filter { it.startsWith("preset_") }.map { it.removePrefix("preset_") }

    // 저장 방식
    var keepOriginal: Boolean get() = b("keepOriginal", false); set(v) = put("keepOriginal", v)
    var autoSave: Boolean get() = b("autoSave", true); set(v) = put("autoSave", v)
    var jpeg: Boolean get() = b("jpeg", false); set(v) = put("jpeg", v)
    var jpegQuality: Int get() = i("jpegQuality", 90); set(v) = put("jpegQuality", v)
    var folderName: String get() = s("folderName", "EUM_QUICK"); set(v) = put("folderName", v)
    var treeUri: String get() = s("treeUri", ""); set(v) = put("treeUri", v)
    var namePattern: String get() = s("namePattern", "EUM_{date}_{time}"); set(v) = put("namePattern", v)

    // 개인정보
    var excludeSensitive: Boolean get() = b("excludeSensitive", true); set(v) = put("excludeSensitive", v)
    var retentionDays: Int get() = i("retentionDays", 30); set(v) = put("retentionDays", v)

    // 전용 키보드 모드: 이 시각 이후 복사된 내용만 기록
    var imeSince: Long get() = sp.getLong("imeSince", 0L); set(v) = sp.edit().putLong("imeSince", v).apply()

    // 앱이 직접 클립보드에 넣은 문구(다시 기록하지 않기 위함)
    fun markSelfClip(text: String) = sp.edit().putString("selfClip", text).putLong("selfClipAt", System.currentTimeMillis()).apply()
    fun isSelfClip(text: String) = sp.getString("selfClip", null) == text &&
        System.currentTimeMillis() - sp.getLong("selfClipAt", 0L) < 60_000

    // 순서대로 붙여넣기
    var sequenceIndex: Int get() = i("seqIndex", 0); set(v) = put("seqIndex", v)

    companion object {
        val COLORS = intArrayOf(0xFF1E6FD9.toInt(), 0xFF2E7D32.toInt(), 0xFFE65100.toInt(), 0xFF455A64.toInt(), 0xFF6A1B9A.toInt())
        val COLOR_NAMES = arrayOf("파랑", "초록", "주황", "회색", "보라")
    }
}
