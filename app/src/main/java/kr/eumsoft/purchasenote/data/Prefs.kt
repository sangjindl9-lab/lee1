package kr.eumsoft.purchasenote.data

import android.content.Context
import android.content.res.Resources
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.Currency

/** 화면 설정. 간편 보기·큰 글씨는 표시 방식만 바꾸고 기록·기능은 그대로 둔다. */
class Prefs private constructor(c: Context) {
    private val sp = c.getSharedPreferences("prefs", Context.MODE_PRIVATE)
    private val _simple = MutableStateFlow(sp.getBoolean("simple", false))
    private val _large = MutableStateFlow(sp.getBoolean("large", false))
    val simple: StateFlow<Boolean> = _simple
    val large: StateFlow<Boolean> = _large

    fun setSimple(v: Boolean) { sp.edit().putBoolean("simple", v).apply(); _simple.value = v }
    fun setLarge(v: Boolean) { sp.edit().putBoolean("large", v).apply(); _large.value = v }

    var onboardingDone: Boolean
        get() = sp.getBoolean("onboarding", false)
        set(v) { sp.edit().putBoolean("onboarding", v).apply() }
    var defaultDays: String
        get() = sp.getString("days", "3,0") ?: "3,0"
        set(v) { sp.edit().putString("days", v).apply() }
    var defaultMinute: Int
        get() = sp.getInt("minute", 9 * 60)
        set(v) { sp.edit().putInt("minute", v).apply() }
    var askedNotification: Boolean
        get() = sp.getBoolean("askedNotif", false)
        set(v) { sp.edit().putBoolean("askedNotif", v).apply() }

    /** 새 구매의 기본 통화: 마지막으로 쓴 통화, 없으면 기기 지역 통화(화면 언어와 무관). 언제든 바꿀 수 있다. */
    var lastCurrency: String
        get() = sp.getString("currency", null) ?: runCatching {
            Currency.getInstance(Resources.getSystem().configuration.locales[0]).currencyCode
        }.getOrDefault("USD")
        set(v) { sp.edit().putString("currency", v).apply() }

    companion object {
        @Volatile private var inst: Prefs? = null
        fun get(c: Context) = inst ?: synchronized(this) { inst ?: Prefs(c.applicationContext).also { inst = it } }
    }
}
