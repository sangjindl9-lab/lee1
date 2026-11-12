package kr.eumsoft.kidscoloring.ui

import android.graphics.Color as AColor
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kr.eumsoft.kidscoloring.tr

/**
 * 색 정밀 조정판 ('나만의 색 만들기').
 * 위의 네모(가로 = 선명하게, 세로 = 밝게)와 무지개 띠(색깔)를 눌러 크게 고르고,
 * 아래의 − / ＋ 버튼과 막대로 조금씩 조절한다. 이전 색과 새 색을 나란히 보여 준다.
 */
@Composable
fun ColorPickerDialog(initial: Int, onDismiss: () -> Unit, onFavorite: (Int) -> Unit, onPick: (Int) -> Unit) {
    val hsv = remember { FloatArray(3).also { AColor.colorToHSV(initial, it) } }
    var h by remember { mutableFloatStateOf(hsv[0]) }
    var s by remember { mutableFloatStateOf(hsv[1]) }
    var v by remember { mutableFloatStateOf(hsv[2]) }
    val c = AColor.HSVToColor(floatArrayOf(h, s, v))
    val pure = Color(AColor.HSVToColor(floatArrayOf(h, 1f, 1f)))
    AlertDialog(onDismissRequest = onDismiss, title = { Text(tr("나만의 색 만들기")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                // 이전 색 → 새 색
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(44.dp).clip(CircleShape).background(Color(initial or (0xFF shl 24))).border(1.5.dp, Ink, CircleShape))
                        Text(tr("이전 색"), fontSize = 11.sp)
                    }
                    Text("➜", fontSize = 18.sp)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(64.dp).clip(CircleShape).background(Color(c)).border(2.dp, Ink, CircleShape))
                        Text(tr("새 색"), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(tr("%1\$s 느낌", tr(Palettes.nameOf(c))), fontSize = 13.sp, modifier = Modifier.widthIn(max = 96.dp))
                }
                Text(tr("네모와 무지개 띠를 눌러 색을 고르고, 아래에서 조금씩 조절해요."), fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(vertical = 6.dp))
                // 선명하게(가로) × 밝게(세로) 네모
                Canvas(
                    Modifier.fillMaxWidth().aspectRatio(1.6f).clip(RoundedCornerShape(12.dp)).border(1.5.dp, Ink, RoundedCornerShape(12.dp))
                        .semantics { contentDescription = tr("색 고르기 판") }
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                val down = awaitFirstDown()
                                fun put(p: Offset) { s = (p.x / size.width).coerceIn(0f, 1f); v = (1f - p.y / size.height).coerceIn(0f, 1f) }
                                down.consume(); put(down.position)
                                drag(down.id) { ch -> ch.consume(); put(ch.position) }
                            }
                        }
                ) {
                    drawRect(Brush.horizontalGradient(listOf(Color.White, pure)))
                    drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                    val p = Offset(s * size.width, (1f - v) * size.height)
                    drawCircle(Color.Black, 11.dp.toPx(), p, style = Stroke(3.dp.toPx()))
                    drawCircle(Color.White, 8.dp.toPx(), p, style = Stroke(3.dp.toPx()))
                }
                // 색깔(무지개) 띠
                Canvas(
                    Modifier.padding(top = 8.dp).fillMaxWidth().height(30.dp).clip(RoundedCornerShape(10.dp)).border(1.5.dp, Ink, RoundedCornerShape(10.dp))
                        .semantics { contentDescription = tr("무지개 색깔 띠") }
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                val down = awaitFirstDown()
                                fun put(p: Offset) { h = (p.x / size.width).coerceIn(0f, 1f) * 359f }
                                down.consume(); put(down.position)
                                drag(down.id) { ch -> ch.consume(); put(ch.position) }
                            }
                        }
                ) {
                    drawRect(Brush.horizontalGradient(List(13) { i -> Color(AColor.HSVToColor(floatArrayOf(i * 30f % 360f, 1f, 1f))) }))
                    val x = h / 359f * size.width
                    drawLine(Color.Black, Offset(x, 0f), Offset(x, size.height), 6.dp.toPx())
                    drawLine(Color.White, Offset(x, 0f), Offset(x, size.height), 2.dp.toPx())
                }
                // 조금씩 조절
                FineRow(tr("색깔"), h, 0f..359f, 1f) { h = it }
                FineRow(tr("선명하게"), s, 0f..1f, 0.01f) { s = it }
                FineRow(tr("밝게"), v, 0f..1f, 0.01f) { v = it }
                TextButton(onClick = { onFavorite(c) }) { Text(tr("⭐ 좋아하는 색에 넣기")) }
            }
        },
        confirmButton = { Button(onClick = { onPick(c) }) { Text(tr("이 색으로 칠하기")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("닫기")) } })
}

/** 이름 + [−] 막대 [＋] : 버튼은 한 번에 한 칸씩만 움직여 색을 정밀하게 맞춘다. */
@Composable
private fun FineRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, step: Float, onChange: (Float) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            StepButton("−", tr("%1\$s 줄이기", label)) { onChange((value - step).coerceIn(range.start, range.endInclusive)) }
            Slider(value, onChange, valueRange = range, modifier = Modifier.weight(1f).semantics { contentDescription = label })
            StepButton("＋", tr("%1\$s 늘리기", label)) { onChange((value + step).coerceIn(range.start, range.endInclusive)) }
        }
    }
}

@Composable
private fun StepButton(sign: String, desc: String, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(Color(0xFFE3F2FD)).border(1.dp, Color(0xFF90A4AE), CircleShape)
            .clickable(role = Role.Button, onClickLabel = desc, onClick = onClick)
            .semantics { contentDescription = desc },
        contentAlignment = Alignment.Center,
    ) { Text(sign, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink) }
}
