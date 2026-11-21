package kr.eumsoft.notepro.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.data.Settings

/** 큰 글씨·버튼 모드에서 터치 영역 크기. */
val LocalTouch = staticCompositionLocalOf { 44.dp }

private val Ink = Color(0xFF1F2A44)
private val Paper = Color(0xFFF7F5F0)
private val Accent = Color(0xFFE8613C)
private val Sea = Color(0xFF2C6E7F)

@Composable
fun NoteProTheme(settings: Settings, content: @Composable () -> Unit) {
    val dark = when (settings.theme) { "DARK" -> true; "LIGHT" -> false; else -> isSystemInDarkTheme() }
    val hc = settings.highContrast
    val colors = if (dark) darkColorScheme(
        primary = if (hc) Color(0xFFFFD166) else Color(0xFFF2A07B),
        onPrimary = Color(0xFF1B1B1B),
        secondary = Color(0xFF8EC5D3),
        background = if (hc) Color.Black else Color(0xFF14171D),
        surface = if (hc) Color.Black else Color(0xFF1B1F27),
        surfaceVariant = Color(0xFF262B35),
        onBackground = Color.White, onSurface = Color.White,
        onSurfaceVariant = if (hc) Color.White else Color(0xFFC5CBD6),
        outline = if (hc) Color.White else Color(0xFF5B6475),
    ) else lightColorScheme(
        primary = if (hc) Color(0xFF8A1C00) else Accent,
        onPrimary = Color.White,
        secondary = Sea,
        background = if (hc) Color.White else Paper,
        surface = if (hc) Color.White else Color(0xFFFFFFFF),
        surfaceVariant = if (hc) Color(0xFFEDEDED) else Color(0xFFEEEBE4),
        onBackground = if (hc) Color.Black else Ink, onSurface = if (hc) Color.Black else Ink,
        onSurfaceVariant = if (hc) Color.Black else Color(0xFF5A6273),
        outline = if (hc) Color.Black else Color(0xFFC9C4B8),
    )
    val base = LocalDensity.current
    val density = if (settings.largeUi) Density(base.density * 1.15f, base.fontScale * 1.2f) else base
    val touch: Dp = if (settings.largeUi) 56.dp else 44.dp
    CompositionLocalProvider(LocalDensity provides density, LocalTouch provides touch) {
        MaterialTheme(colorScheme = colors, content = content)
    }
}
