@file:OptIn(ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PieChart
import androidx.compose.material.icons.rounded.SdCard
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.data.Category
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.Volume
import kr.eumsoft.filemanager2.data.fmtSize
import java.io.File

fun catIcon(c: Category): ImageVector = when (c) {
    Category.IMAGES -> Icons.Rounded.Image
    Category.VIDEOS -> Icons.Rounded.Movie
    Category.AUDIO -> Icons.Rounded.MusicNote
    Category.DOCS -> Icons.Rounded.Description
    Category.DOWNLOADS -> Icons.Rounded.Download
    Category.APKS -> Icons.Rounded.Android
    Category.ARCHIVES -> Icons.Rounded.Archive
    Category.RECENT -> Icons.Rounded.History
}

@Composable
fun HomeScreen(vm: AppVM) {
    val ctx = LocalContext.current
    var vols by remember { mutableStateOf<List<Volume>>(emptyList()) }
    LaunchedEffect(vm.version) { vols = withContext(Dispatchers.IO) { FileOps.volumes(ctx) } }
    val favs = vm.prefs.favorites

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(bottom = 40.dp),
    ) {
        item {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 22.dp, end = 8.dp, top = 14.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("파일관리자2", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onBackground)
                    Text("내 파일을 한눈에", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { vm.push(Dest.Search(FileOps.root.absolutePath)) }) { Icon(Icons.Rounded.Search, "검색") }
                IconButton(onClick = { vm.push(Dest.Settings) }) { Icon(Icons.Rounded.Settings, "설정") }
            }
        }

        // 검색 바
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .clickable { vm.push(Dest.Search(FileOps.root.absolutePath)) }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(10.dp))
                Text("파일 이름으로 검색", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        // 저장공간 카드
        val main = vols.firstOrNull()
        if (main != null) item { StorageHero(main, onOpen = { vm.push(Dest.Browse(main.path)) }, onAnalyze = { vm.push(Dest.Analysis) }) }
        items(vols.drop(1)) { v -> VolumeRow(v) { vm.push(Dest.Browse(v.path)) } }

        // 카테고리
        item { SectionTitle("카테고리") }
        item {
            Column(Modifier.padding(horizontal = 12.dp)) {
                Category.entries.chunked(4).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { c ->
                            Column(
                                Modifier
                                    .weight(1f)
                                    .padding(4.dp)
                                    .clip(RoundedCornerShape(18.dp))
                                    .clickable { vm.push(Dest.Cat(c)) }
                                    .padding(vertical = 10.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                IconBadge(catIcon(c), catColor(c), 54.dp, round = true)
                                Spacer(Modifier.height(8.dp))
                                Text(c.label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }

        // 도구
        item { SectionTitle("도구") }
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ToolCard("휴지통", Icons.Rounded.Delete, Color(0xFFEF4444), Modifier.weight(1f)) { vm.push(Dest.TrashBin) }
                ToolCard("저장소 분석", Icons.Rounded.PieChart, Color(0xFF0EA5E9), Modifier.weight(1f)) { vm.push(Dest.Analysis) }
                ToolCard("즐겨찾기", Icons.Rounded.Star, Coral, Modifier.weight(1f)) { vm.push(Dest.Favorites) }
            }
        }

        // 즐겨찾기 빠른 이동
        if (favs.isNotEmpty()) {
            item { SectionTitle("즐겨찾기") }
            items(favs.take(8)) { path ->
                val f = File(path)
                QuickRow(
                    icon = if (f.isDirectory) Icons.Rounded.Folder else Icons.Rounded.Description,
                    color = IndigoLight,
                    title = f.name.ifEmpty { path },
                    sub = f.parent ?: "",
                ) {
                    if (f.isDirectory) vm.push(Dest.Browse(path)) else if (f.exists()) vm.open(ctx, kr.eumsoft.filemanager2.data.FItem(path, f.name, false, f.length(), f.lastModified()))
                    else vm.toast("파일이 없습니다")
                }
            }
        }

        // 최근 연 파일
        val recent = vm.prefs.recent.take(5)
        if (recent.isNotEmpty()) {
            item { SectionTitle("최근 연 파일") }
            items(recent) { path ->
                val f = File(path)
                QuickRow(Icons.Rounded.History, Color(0xFF64748B), f.name, f.parent ?: "") {
                    if (f.exists()) vm.open(ctx, kr.eumsoft.filemanager2.data.FItem(path, f.name, f.isDirectory, f.length(), f.lastModified()))
                    else vm.toast("파일이 없습니다")
                }
            }
        }
    }
}

@Composable
private fun StorageHero(v: Volume, onOpen: () -> Unit, onAnalyze: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 10.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF3730A3), Color(0xFF6366F1), Color(0xFF8B5CF6))))
            .clickable(onClick = onOpen)
            .padding(22.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Storage, null, tint = Color.White)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(v.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("${v.free.fmtSize()} 남음", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
                }
                Icon(Icons.Rounded.ChevronRight, null, tint = Color.White)
            }
            Spacer(Modifier.height(20.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${(v.ratio * 100).toInt()}%", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.width(8.dp))
                Text("사용 중 · ${v.used.fmtSize()} / ${v.total.fmtSize()}", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, modifier = Modifier.padding(bottom = 7.dp))
            }
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth().height(10.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f))) {
                Box(Modifier.fillMaxWidth(v.ratio.coerceIn(0.02f, 1f)).height(10.dp).clip(CircleShape).background(Coral))
            }
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.18f)).clickable(onClick = onAnalyze).padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.PieChart, null, tint = Color.White, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("공간 정리하기", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun VolumeRow(v: Volume, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(Icons.Rounded.SdCard, Color(0xFF10B981), 44.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(v.name, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                Box(Modifier.fillMaxWidth(v.ratio.coerceIn(0.02f, 1f)).height(6.dp).clip(CircleShape).background(Color(0xFF10B981)))
            }
            Spacer(Modifier.height(4.dp))
            Text("${v.used.fmtSize()} / ${v.total.fmtSize()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ToolCard(label: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(vertical = 16.dp, horizontal = 12.dp),
    ) {
        IconBadge(icon, color, 40.dp)
        Spacer(Modifier.height(10.dp))
        Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
    }
}

@Composable
private fun QuickRow(icon: ImageVector, color: Color, title: String, sub: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, color, 40.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
