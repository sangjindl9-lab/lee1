package kr.eumsoft.securitypro.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.selection.toggleable

val Danger = Color(0xFFD32F2F); val Caution = Color(0xFFF57C00); val Safe = Color(0xFF2E7D32); val Neutral = Color(0xFF607D8B)

private val light = lightColorScheme(primary = Color(0xFF0D47A1), onPrimary = Color.White, primaryContainer = Color(0xFFD6E4FF),
    secondary = Color(0xFF00897B), surface = Color(0xFFFBFCFF), background = Color(0xFFF4F7FC))
private val dark = darkColorScheme(primary = Color(0xFF9EC2FF), onPrimary = Color(0xFF002E69), primaryContainer = Color(0xFF1B3A66),
    secondary = Color(0xFF4DB6AC), surface = Color(0xFF12161C), background = Color(0xFF0D1117))

/** 10대~70대가 읽기 쉽도록 기본 글자를 크게 잡는다 (시스템 글꼴 크기 설정도 그대로 반영됨). */
private val type = Typography(
    headlineMedium = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp),
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp),
    titleMedium = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.SemiBold, lineHeight = 26.sp),
    bodyLarge = TextStyle(fontSize = 18.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    labelLarge = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun EumTheme(theme: String, content: @Composable () -> Unit) {
    val darkMode = when (theme) { "DARK" -> true; "LIGHT" -> false; else -> isSystemInDarkTheme() }
    MaterialTheme(colorScheme = if (darkMode) dark else light, typography = type, content = content)
}

@Composable
fun BigButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color? = null) {
    Button(onClick, modifier.fillMaxWidth().heightIn(min = 60.dp), enabled = enabled, shape = RoundedCornerShape(16.dp),
        colors = if (color != null) ButtonDefaults.buttonColors(containerColor = color) else ButtonDefaults.buttonColors()) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun Section(title: String) =
    Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp).semantics { heading() })

@Composable
fun InfoCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) =
    Card(modifier.fillMaxWidth().padding(vertical = 5.dp), shape = RoundedCornerShape(18.dp)) { Column(Modifier.padding(16.dp), content = content) }

@Composable
fun SwitchRow(title: String, sub: String?, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).toggleable(checked, enabled, Role.Switch, onChange).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, null, enabled = enabled)
    }
}

@Composable
fun KeyValue(k: String, v: String) = Row(Modifier.fillMaxWidth().padding(vertical = 3.dp).semantics(mergeDescendants = true) { contentDescription = "$k: $v" }) {
    // 짧은 값(숫자 등)은 이름 칸을 넓게 써서 이름이 어색하게 줄바꿈되지 않게 한다
    val short = v.length <= 12
    Text(k, Modifier.weight(if (short) 1f else 0.42f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (short) Text(v, Modifier.padding(start = 12.dp), style = MaterialTheme.typography.bodyMedium)
    else Text(v, Modifier.weight(0.58f), style = MaterialTheme.typography.bodyMedium)
}
