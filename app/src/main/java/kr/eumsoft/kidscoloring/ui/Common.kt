package kr.eumsoft.kidscoloring.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.kidscoloring.data.Artwork
import kr.eumsoft.kidscoloring.data.Repository
import kotlin.random.Random

val Sky = Color(0xFFE3F2FD)
val Sun = Color(0xFFFFC107)
val Ink = Color(0xFF263238)
val Berry = Color(0xFFEC407A)

@Composable
fun EumTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF1E88E5), onPrimary = Color.White, secondary = Berry,
            background = Sky, surface = Color.White, onSurface = Ink, onBackground = Ink,
            surfaceVariant = Color(0xFFF1F5F9),
        ),
        content = content,
    )
}

/** 큰 터치 영역의 그림 버튼 (이모지 + 짧은 한글) */
@Composable
fun BigButton(
    emoji: String, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, selected: Boolean = false,
    size: Dp = 60.dp, onClick: () -> Unit,
) {
    Column(
        modifier
            .defaultMinSize(minWidth = size, minHeight = size)
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) Color(0xFFFFF3C4) else Color.White)
            .border(if (selected) 3.dp else 1.dp, if (selected) Sun else Color(0xFFCFD8DC), RoundedCornerShape(16.dp))
            .alpha(if (enabled) 1f else 0.35f)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label }
            .padding(horizontal = 2.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Text(emoji, fontSize = 22.sp)
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = 3.dp))
    }
}

@Composable
fun ArtThumb(repo: Repository, art: Artwork, modifier: Modifier = Modifier) {
    val bmp by produceState<ImageBitmap?>(null, art.id) {
        value = withContext(Dispatchers.IO) { if (art.available) repo.thumb(art)?.asImageBitmap() else null }
    }
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(18.dp)).background(Color.White), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b, art.title, Modifier.padding(6.dp))
        else if (!art.available) Text("준비 중", color = Color.Gray, fontSize = 14.sp)
    }
}

@Composable
fun FileThumb(path: String, stamp: Long, desc: String, modifier: Modifier = Modifier) {
    val bmp by produceState<ImageBitmap?>(null, path, stamp) {
        value = withContext(Dispatchers.IO) { if (path.isEmpty()) null else BitmapFactory.decodeFile(path)?.asImageBitmap() }
    }
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(18.dp)).background(Color.White), contentAlignment = Alignment.Center) {
        bmp?.let { Image(it, desc) }
    }
}

@Composable
fun ArtCard(repo: Repository, art: Artwork, width: Dp, onClick: () -> Unit) {
    Column(
        Modifier.width(width).clip(RoundedCornerShape(20.dp))
            .clickable(enabled = art.available, role = Role.Button, onClickLabel = art.title, onClick = onClick)
            .padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ArtThumb(repo, art, Modifier.fillMaxWidth().border(2.dp, Color(0xFFBBDEFB), RoundedCornerShape(18.dp)))
        Text(art.title, fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp).height(38.dp))
        Text("★".repeat(art.difficulty) + "☆".repeat(3 - art.difficulty.coerceIn(1, 3)), fontSize = 12.sp, color = Sun)
    }
}

/** 성인 확인: 어린이가 풀기 어려운 곱셈 문제 */
@Composable
fun ParentGate(onPass: () -> Unit, onDismiss: () -> Unit) {
    val a = remember { Random.nextInt(6, 10) }
    val b = remember { Random.nextInt(6, 10) }
    var input by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("부모님 확인") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text("어른만 들어갈 수 있어요.\n답을 눌러 주세요.", textAlign = TextAlign.Center)
                Text("$a × $b = ${input.ifEmpty { "?" }}", fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(12.dp))
                if (wrong) Text("다시 해 보세요", color = Color.Red)
                for (row in listOf("123", "456", "789", "←0✓")) Row {
                    for (ch in row) {
                        val label = when (ch) { '←' -> "지우기"; '✓' -> "확인"; else -> ch.toString() }
                        Box(
                            Modifier.padding(4.dp).size(56.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFE3F2FD))
                                .clickable(role = Role.Button, onClickLabel = label) {
                                    when (ch) {
                                        '←' -> { input = input.dropLast(1); wrong = false }
                                        '✓' -> if (input.toIntOrNull() == a * b) onPass() else { wrong = true; input = "" }
                                        else -> if (input.length < 3) { input += ch; wrong = false }
                                    }
                                }.semantics { contentDescription = label },
                            contentAlignment = Alignment.Center,
                        ) { Text(ch.toString(), fontSize = 22.sp, fontWeight = FontWeight.Bold) }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, yes: String, no: String, onYes: () -> Unit, onNo: () -> Unit) {
    AlertDialog(
        onDismissRequest = onNo, title = { Text(title) }, text = { Text(text) },
        confirmButton = { Button(onClick = onYes) { Text(yes) } },
        dismissButton = { TextButton(onClick = onNo) { Text(no) } },
    )
}

@Composable
fun Gap(h: Dp = 8.dp) = Spacer(Modifier.height(h))
