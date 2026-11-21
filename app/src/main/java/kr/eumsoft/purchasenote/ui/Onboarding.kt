package kr.eumsoft.purchasenote.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kr.eumsoft.purchasenote.R

/** 처음 쓰는 사람용 공유 안내 3단계. 건너뛰기 가능, 설정·빈 화면에서 다시 보기 */
@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    var page by rememberSaveable { mutableIntStateOf(0) }
    val titles = listOf(R.string.ob1_title, R.string.ob2_title, R.string.ob3_title)
    val texts = listOf(R.string.ob1_text, R.string.ob2_text, R.string.ob3_text)
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.ob_step, page + 1, 3), style = MaterialTheme.typography.labelLarge)
            TextButton(onClick = onDone, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.skip)) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(12.dp))
            Illustration(page, Modifier.size(220.dp))
            Spacer(Modifier.height(20.dp))
            Text(stringResource(titles[page]), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite })
            Spacer(Modifier.height(10.dp))
            Text(stringResource(texts[page]), style = MaterialTheme.typography.bodyLarge)
            if (page == 2) { Spacer(Modifier.height(10.dp)); Text(stringResource(R.string.ob_manual), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (page > 0) OutlinedButton(onClick = { page-- }, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text(stringResource(R.string.prev)) }
            Button(onClick = { if (page < 2) page++ else onDone() }, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                Text(stringResource(if (page < 2) R.string.next else R.string.start))
            }
        }
    }
}

/** 빈 홈 화면에 보이는 짧은 3단계 안내 */
@Composable
fun ShareSteps() {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(R.string.ob1_title, R.string.ob2_title, R.string.ob3_title).forEachIndexed { i, t ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Illustration(i, Modifier.size(48.dp)); Spacer(Modifier.width(12.dp))
                    Text("${i + 1}. " + stringResource(t), style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

/** 간단한 그림(휴대폰 화면 + 단계별 표시). 장식용이라 읽기 대상에서 제외 */
@Composable
private fun Illustration(step: Int, modifier: Modifier) {
    val frame = MaterialTheme.colorScheme.onSurface
    val accent = MaterialTheme.colorScheme.primary
    val soft = MaterialTheme.colorScheme.surfaceVariant
    Canvas(modifier) {
        val w = size.width; val h = size.height
        val pw = w * 0.55f; val ph = h * 0.9f; val l = (w - pw) / 2; val t = h * 0.05f
        drawRoundRect(soft, Offset(l, t), Size(pw, ph), CornerRadius(pw * 0.12f))
        drawRoundRect(frame, Offset(l, t), Size(pw, ph), CornerRadius(pw * 0.12f), style = Stroke(w * 0.02f))
        when (step) {
            0 -> { // 주문 화면: 줄 몇 개 + 상품 상자
                drawRoundRect(accent, Offset(l + pw * 0.15f, t + ph * 0.12f), Size(pw * 0.7f, ph * 0.22f), CornerRadius(8f))
                for (i in 0 until 4) bar(frame, l + pw * 0.15f, t + ph * (0.42f + i * 0.1f), pw * (0.7f - i * 0.1f), ph * 0.035f)
            }
            1 -> { // 공유 아이콘(점 3개 연결)
                val cx = l + pw / 2; val cy = t + ph * 0.5f; val r = pw * 0.07f
                val a = Offset(cx + pw * 0.18f, cy - ph * 0.15f); val b = Offset(cx - pw * 0.18f, cy); val c = Offset(cx + pw * 0.18f, cy + ph * 0.15f)
                drawLine(accent, a, b, w * 0.025f); drawLine(accent, b, c, w * 0.025f)
                listOf(a, b, c).forEach { drawCircle(accent, r, it) }
                bar(frame, l + pw * 0.15f, t + ph * 0.12f, pw * 0.7f, ph * 0.035f)
            }
            else -> { // 앱 목록에서 선택: 칸 6개 중 하나 강조 + 체크
                for (i in 0 until 6) {
                    val col = i % 3; val row = i / 3
                    val x = l + pw * (0.12f + col * 0.27f); val y = t + ph * (0.35f + row * 0.2f)
                    drawRoundRect(if (i == 4) accent else frame.copy(alpha = 0.35f), Offset(x, y), Size(pw * 0.22f, pw * 0.22f), CornerRadius(10f))
                }
                val x = l + pw * 0.39f; val y = t + ph * 0.55f; val s = pw * 0.22f
                drawLine(Color.White, Offset(x + s * 0.2f, y + s * 0.5f), Offset(x + s * 0.42f, y + s * 0.72f), w * 0.02f)
                drawLine(Color.White, Offset(x + s * 0.42f, y + s * 0.72f), Offset(x + s * 0.8f, y + s * 0.3f), w * 0.02f)
            }
        }
    }
}

private fun DrawScope.bar(c: Color, x: Float, y: Float, w: Float, h: Float) = drawRoundRect(c.copy(alpha = 0.5f), Offset(x, y), Size(w, h), CornerRadius(h / 2))
