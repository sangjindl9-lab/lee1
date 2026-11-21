package kr.eumsoft.purchasenote.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density

// 대비: 본문 글자(onSurface/onBackground)는 배경 대비 4.5:1 이상이 되도록 고른 색
private val Light = lightColorScheme(
    primary = Color(0xFF1F5E57), onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEBE5), onPrimaryContainer = Color(0xFF0B2E2A),
    secondary = Color(0xFF4A5F5B), onSecondary = Color.White,
    secondaryContainer = Color(0xFFDCE6E3), onSecondaryContainer = Color(0xFF152320),
    tertiary = Color(0xFF8A4B00), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFE2C4), onTertiaryContainer = Color(0xFF2E1600),
    error = Color(0xFFB3261E), onError = Color.White, errorContainer = Color(0xFFF9DEDC), onErrorContainer = Color(0xFF410E0B),
    background = Color(0xFFF8FAF9), onBackground = Color(0xFF191C1B),
    surface = Color(0xFFF8FAF9), onSurface = Color(0xFF191C1B),
    surfaceVariant = Color(0xFFE0E6E4), onSurfaceVariant = Color(0xFF3F4947),
    surfaceContainer = Color(0xFFEEF2F1), surfaceContainerHigh = Color(0xFFE6ECEA), surfaceContainerLow = Color(0xFFF2F5F4),
    outline = Color(0xFF6F7977),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF8DD3C8), onPrimary = Color(0xFF003731),
    primaryContainer = Color(0xFF1F5E57), onPrimaryContainer = Color(0xFFCDEBE5),
    secondary = Color(0xFFB1CBC6), onSecondary = Color(0xFF1C3531),
    secondaryContainer = Color(0xFF334B47), onSecondaryContainer = Color(0xFFCDE8E2),
    tertiary = Color(0xFFFFB878), onTertiary = Color(0xFF4B2800),
    tertiaryContainer = Color(0xFF6A3B00), onTertiaryContainer = Color(0xFFFFDCBE),
    error = Color(0xFFF2B8B5), onError = Color(0xFF601410), errorContainer = Color(0xFF8C1D18), onErrorContainer = Color(0xFFF9DEDC),
    background = Color(0xFF111413), onBackground = Color(0xFFE1E3E1),
    surface = Color(0xFF111413), onSurface = Color(0xFFE1E3E1),
    surfaceVariant = Color(0xFF3F4947), onSurfaceVariant = Color(0xFFC0C9C6),
    surfaceContainer = Color(0xFF1D2120), surfaceContainerHigh = Color(0xFF272B2A), surfaceContainerLow = Color(0xFF191C1B),
    outline = Color(0xFF8A9390),
)

@Composable
fun PurchaseTheme(large: Boolean, content: @Composable () -> Unit) {
    val d = LocalDensity.current
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light) {
        // 큰 글씨: 기기 글자 크기 설정 위에 1.3배를 더한다(기기 설정을 무시하지 않음)
        CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale * if (large) 1.3f else 1f)) { content() }
    }
}
