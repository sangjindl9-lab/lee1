package kr.eumsoft.notepro.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kr.eumsoft.notepro.core.PenType
import java.util.UUID

/** 사용자 필기·화면 설정. (계정 단계에서는 이 값을 계정 설정으로 동기화하고 기기별 예외만 로컬에 둔다.) */
data class Settings(
    val palmRejection: Boolean = true,
    /** AUTO: 스타일러스가 감지되면 손가락은 필기하지 않음, PEN_ONLY, FINGER_DRAW */
    val fingerMode: String = "AUTO",
    val scrollFingers: Int = 1,
    val zoomEnabled: Boolean = true,
    val zoomLocked: Boolean = false,
    val scrollLocked: Boolean = false,
    val gestureSensitivity: Int = 2, // 1 둔감 ~ 3 민감
    val zoomUiPinned: Boolean = false,
    val zoomUiHideSec: Int = 3,
    val twoFingerTapUndo: Boolean = true,
    val shapeHold: Boolean = true,
    val stabilization: Float = 0.3f,
    val pressureEnabled: Boolean = true,
    val leftHanded: Boolean = false,
    val largeUi: Boolean = false,
    val theme: String = "SYSTEM", // SYSTEM, LIGHT, DARK
    val highContrast: Boolean = false,
    val expertMode: Boolean = false,
    val confirmDelete: Boolean = true,
    val autoVersionMinutes: Int = 10,
    val versionKeep: Int = 30,
    val showTips: Boolean = true,
)

data class PenPreset(val pen: PenType, val color: Int, val width: Float, val opacity: Float) {
    fun encode() = "${pen.code},$color,$width,$opacity"
    companion object {
        fun decode(s: String): PenPreset? = try {
            val p = s.split(','); PenPreset(PenType.fromCode(p[0].toInt()), p[1].toInt(), p[2].toFloat(), p[3].toFloat())
        } catch (e: Exception) { null }
    }
}

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("notepro", Context.MODE_PRIVATE)

    val deviceId: String
        get() = sp.getString("device_id", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("device_id", it).apply() }

    fun load(): Settings = Settings(
        palmRejection = sp.getBoolean("palm", true),
        fingerMode = sp.getString("fingerMode", "AUTO") ?: "AUTO",
        scrollFingers = sp.getInt("scrollFingers", 1),
        zoomEnabled = sp.getBoolean("zoomEnabled", true),
        zoomLocked = sp.getBoolean("zoomLocked", false),
        scrollLocked = sp.getBoolean("scrollLocked", false),
        gestureSensitivity = sp.getInt("gestureSensitivity", 2),
        zoomUiPinned = sp.getBoolean("zoomUiPinned", false),
        zoomUiHideSec = sp.getInt("zoomUiHideSec", 3),
        twoFingerTapUndo = sp.getBoolean("twoFingerTapUndo", true),
        shapeHold = sp.getBoolean("shapeHold", true),
        stabilization = sp.getFloat("stabilization", 0.3f),
        pressureEnabled = sp.getBoolean("pressure", true),
        leftHanded = sp.getBoolean("leftHanded", false),
        largeUi = sp.getBoolean("largeUi", false),
        theme = sp.getString("theme", "SYSTEM") ?: "SYSTEM",
        highContrast = sp.getBoolean("highContrast", false),
        expertMode = sp.getBoolean("expertMode", false),
        confirmDelete = sp.getBoolean("confirmDelete", true),
        autoVersionMinutes = sp.getInt("autoVersionMinutes", 10),
        versionKeep = sp.getInt("versionKeep", 30),
        showTips = sp.getBoolean("showTips", true),
    )

    fun save(s: Settings) {
        sp.edit()
            .putBoolean("palm", s.palmRejection).putString("fingerMode", s.fingerMode).putInt("scrollFingers", s.scrollFingers)
            .putBoolean("zoomEnabled", s.zoomEnabled).putBoolean("zoomLocked", s.zoomLocked).putBoolean("scrollLocked", s.scrollLocked)
            .putInt("gestureSensitivity", s.gestureSensitivity).putBoolean("zoomUiPinned", s.zoomUiPinned).putInt("zoomUiHideSec", s.zoomUiHideSec)
            .putBoolean("twoFingerTapUndo", s.twoFingerTapUndo).putBoolean("shapeHold", s.shapeHold).putFloat("stabilization", s.stabilization)
            .putBoolean("pressure", s.pressureEnabled).putBoolean("leftHanded", s.leftHanded).putBoolean("largeUi", s.largeUi)
            .putString("theme", s.theme).putBoolean("highContrast", s.highContrast).putBoolean("expertMode", s.expertMode)
            .putBoolean("confirmDelete", s.confirmDelete).putInt("autoVersionMinutes", s.autoVersionMinutes).putInt("versionKeep", s.versionKeep)
            .putBoolean("showTips", s.showTips)
            .apply()
    }

    var presets: List<PenPreset>
        get() = (sp.getString("presets", null) ?: DEFAULT_PRESETS).split(';').mapNotNull { PenPreset.decode(it) }
        set(v) { sp.edit().putString("presets", v.joinToString(";") { it.encode() }).apply() }

    var lastPen: PenPreset
        get() = PenPreset.decode(sp.getString("lastPen", "") ?: "") ?: PenPreset(PenType.BALLPOINT, 0xFF1F2A44.toInt(), 2.2f, 1f)
        set(v) { sp.edit().putString("lastPen", v.encode()).apply() }

    /** 마지막 작업 화면(멀티윈도우 상태) — "nbId|scale|ox|oy" 를 '\n'로 연결 */
    var workspace: String
        get() = sp.getString("workspace", "") ?: ""
        set(v) { sp.edit().putString("workspace", v).commit() }

    var splitVertical: Boolean
        get() = sp.getBoolean("splitVertical", false)
        set(v) { sp.edit().putBoolean("splitVertical", v).apply() }

    var splitRatio: Float
        get() = sp.getFloat("splitRatio", 0.5f)
        set(v) { sp.edit().putFloat("splitRatio", v).apply() }

    var lastBackupAt: Long
        get() = sp.getLong("lastBackupAt", 0)
        set(v) { sp.edit().putLong("lastBackupAt", v).apply() }

    var onboarded: Boolean
        get() = sp.getBoolean("onboarded", false)
        set(v) { sp.edit().putBoolean("onboarded", v).apply() }

    companion object {
        private val DEFAULT_PRESETS = listOf(
            PenPreset(PenType.BALLPOINT, 0xFF1F2A44.toInt(), 2.2f, 1f),
            PenPreset(PenType.FOUNTAIN, 0xFF1546B0.toInt(), 3f, 1f),
            PenPreset(PenType.PENCIL, 0xFF444444.toInt(), 2f, 0.85f),
            PenPreset(PenType.HIGHLIGHTER, 0xFFFFD43B.toInt(), 14f, 0.35f),
            PenPreset(PenType.BRUSH, 0xFFC92A2A.toInt(), 5f, 1f),
        ).joinToString(";") { it.encode() }
    }
}

class SettingsStore(private val prefs: Prefs) {
    private val _flow = MutableStateFlow(prefs.load())
    val flow: StateFlow<Settings> = _flow
    val value get() = _flow.value
    fun update(f: (Settings) -> Settings) { val n = f(_flow.value); _flow.value = n; prefs.save(n) }
}
