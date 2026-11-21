package kr.eumsoft.filemanager2.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kr.eumsoft.filemanager2.data.Category
import kr.eumsoft.filemanager2.data.FileType

val Indigo = Color(0xFF3730A3)
val IndigoLight = Color(0xFF6366F1)
val Coral = Color(0xFFFF7A59)

private val Light = lightColorScheme(
    primary = Indigo, onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E7FF), onPrimaryContainer = Color(0xFF1E1B4B),
    secondary = Coral, onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFE4DC), onSecondaryContainer = Color(0xFF5A1A08),
    background = Color(0xFFF4F5FB), onBackground = Color(0xFF14152B),
    surface = Color(0xFFF4F5FB), onSurface = Color(0xFF14152B),
    surfaceVariant = Color(0xFFE6E8F3), onSurfaceVariant = Color(0xFF5B5F7A),
    surfaceContainer = Color.White, surfaceContainerHigh = Color.White, surfaceContainerLow = Color.White,
    outline = Color(0xFFC9CCE0), outlineVariant = Color(0xFFE3E5F0),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFA5B4FC), onPrimary = Color(0xFF1E1B4B),
    primaryContainer = Color(0xFF312E81), onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Color(0xFFFF9A80), onSecondary = Color(0xFF3B1205),
    background = Color(0xFF0E1020), onBackground = Color(0xFFE6E7F2),
    surface = Color(0xFF0E1020), onSurface = Color(0xFFE6E7F2),
    surfaceVariant = Color(0xFF242842), onSurfaceVariant = Color(0xFFAEB2CC),
    surfaceContainer = Color(0xFF181B30), surfaceContainerHigh = Color(0xFF1E2238), surfaceContainerLow = Color(0xFF151829),
    outline = Color(0xFF3A3F5E), outlineVariant = Color(0xFF2A2E48),
)

@Composable
fun FM2Theme(mode: String, content: @Composable () -> Unit) {
    val dark = when (mode) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val view = androidx.compose.ui.platform.LocalView.current
    if (!view.isInEditMode) {
        androidx.compose.runtime.SideEffect {
            val act = view.context as? android.app.Activity
            if (act != null) {
                val c = androidx.core.view.WindowCompat.getInsetsController(act.window, view)
                c.isAppearanceLightStatusBars = !dark
                c.isAppearanceLightNavigationBars = !dark
            }
        }
    }
    MaterialTheme(
        colorScheme = if (dark) Dark else Light,
        shapes = Shapes(
            small = RoundedCornerShape(10.dp),
            medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(24.dp),
        ),
        content = content,
    )
}

fun typeColor(t: FileType): Color = when (t) {
    FileType.FOLDER -> Color(0xFF6366F1)
    FileType.IMAGE -> Color(0xFF8B5CF6)
    FileType.VIDEO -> Color(0xFFEF4444)
    FileType.AUDIO -> Color(0xFFF59E0B)
    FileType.PDF -> Color(0xFFDC2626)
    FileType.DOC -> Color(0xFF2563EB)
    FileType.SHEET -> Color(0xFF16A34A)
    FileType.SLIDE -> Color(0xFFEA580C)
    FileType.TEXT -> Color(0xFF64748B)
    FileType.CODE -> Color(0xFF0EA5E9)
    FileType.ARCHIVE -> Color(0xFFF97316)
    FileType.APK -> Color(0xFF10B981)
    FileType.OTHER -> Color(0xFF94A3B8)
}

fun catColor(c: Category): Color = when (c) {
    Category.IMAGES -> Color(0xFF8B5CF6)
    Category.VIDEOS -> Color(0xFFEF4444)
    Category.AUDIO -> Color(0xFFF59E0B)
    Category.DOCS -> Color(0xFF2563EB)
    Category.DOWNLOADS -> Color(0xFF10B981)
    Category.APKS -> Color(0xFF14B8A6)
    Category.ARCHIVES -> Color(0xFFF97316)
    Category.RECENT -> Color(0xFF6366F1)
}
