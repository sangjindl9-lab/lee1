package kr.eumsoft.kidscoloring.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** 사용자 설정 (지시서의 UserSettings). DataStore 에 저장한다. */
data class UserSettings(
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val brushSize: Float = 28f,
    val selectedPalette: Int = 0,
    val parentalLockEnabled: Boolean = true,
    val voiceGuide: Boolean = false,
    val reduceMotion: Boolean = false,
    val showColorNames: Boolean = false,
    val fingerPansOnly: Boolean = false,   // 펜으로만 그리고 손가락은 화면 이동
    val stayInside: Boolean = true,        // 선 밖으로 안 나가기
    val opacity: Float = 1f,
    val ageFilter: Int = 0,                // 0 모두, 1: 3~5세, 2: 6~7세, 3: 8~10세
    val recentColors: List<Int> = emptyList(),
    val favoriteColors: List<Int> = emptyList(),
    val musicEnabled: Boolean = true,      // 놀이터 배경 음악
    val coloringMusic: Boolean = true,     // 색칠할 때 배경 음악
    val effectSound: Int = 2,              // 효과음 종류 (ui/Sfx.kt 의 Sfx.kinds 순서, 끄기는 soundEnabled=false)
)

private val Context.store by preferencesDataStore("user_settings")

class SettingsStore(private val ctx: Context) {
    private object K {
        val sound = booleanPreferencesKey("soundEnabled")
        val vib = booleanPreferencesKey("vibrationEnabled")
        val brush = floatPreferencesKey("brushSize")
        val palette = intPreferencesKey("selectedPalette")
        val lock = booleanPreferencesKey("parentalLockEnabled")
        val voice = booleanPreferencesKey("voiceGuide")
        val motion = booleanPreferencesKey("reduceMotion")
        val names = booleanPreferencesKey("showColorNames")
        val finger = booleanPreferencesKey("fingerPansOnly")
        val inside = booleanPreferencesKey("stayInside")
        val opacity = floatPreferencesKey("opacity")
        val age = intPreferencesKey("ageFilter")
        val recent = stringPreferencesKey("recentColors")
        val fav = stringPreferencesKey("favoriteColors")
        val music = booleanPreferencesKey("musicEnabled")
        val bgm = booleanPreferencesKey("coloringMusic")
        val fx = intPreferencesKey("effectSound")
    }

    private fun colors(s: String?) = s?.split(',')?.mapNotNull { it.toIntOrNull() } ?: emptyList()

    val flow: Flow<UserSettings> = ctx.store.data.map { p ->
        val d = UserSettings()
        UserSettings(
            p[K.sound] ?: d.soundEnabled, p[K.vib] ?: d.vibrationEnabled, p[K.brush] ?: d.brushSize,
            p[K.palette] ?: d.selectedPalette, p[K.lock] ?: d.parentalLockEnabled, p[K.voice] ?: d.voiceGuide,
            p[K.motion] ?: d.reduceMotion, p[K.names] ?: d.showColorNames, p[K.finger] ?: d.fingerPansOnly,
            p[K.inside] ?: d.stayInside, p[K.opacity] ?: d.opacity, p[K.age] ?: d.ageFilter,
            colors(p[K.recent]), colors(p[K.fav]), p[K.music] ?: d.musicEnabled, p[K.bgm] ?: d.coloringMusic, p[K.fx] ?: d.effectSound,
        )
    }

    suspend fun update(s: UserSettings) {
        ctx.store.edit { p ->
            p[K.sound] = s.soundEnabled; p[K.vib] = s.vibrationEnabled; p[K.brush] = s.brushSize
            p[K.palette] = s.selectedPalette; p[K.lock] = s.parentalLockEnabled; p[K.voice] = s.voiceGuide
            p[K.motion] = s.reduceMotion; p[K.names] = s.showColorNames; p[K.finger] = s.fingerPansOnly
            p[K.inside] = s.stayInside; p[K.opacity] = s.opacity; p[K.age] = s.ageFilter
            p[K.recent] = s.recentColors.joinToString(","); p[K.fav] = s.favoriteColors.joinToString(",")
            p[K.music] = s.musicEnabled; p[K.bgm] = s.coloringMusic; p[K.fx] = s.effectSound
        }
    }
}
