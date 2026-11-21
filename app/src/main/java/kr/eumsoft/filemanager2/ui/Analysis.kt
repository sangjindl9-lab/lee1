@file:OptIn(ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.data.Duplicates
import kr.eumsoft.filemanager2.data.FItem
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.FileType
import kr.eumsoft.filemanager2.data.Volume
import kr.eumsoft.filemanager2.data.fmtDate
import kr.eumsoft.filemanager2.data.fmtSize
import kr.eumsoft.filemanager2.data.toItem

/**
 * 저장소 분석 · 정리
 *  - 큰 파일: 골라서 삭제
 *  - 중복 파일: 내용이 똑같은 파일을 찾아 원본 1개만 남기고 삭제
 *  - 폴더별 용량
 */
@Composable
fun AnalysisScreen(vm: AppVM) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    var vol by remember { mutableStateOf<Volume?>(null) }

    var large by remember { mutableStateOf<List<FItem>?>(null) }
    var folders by remember { mutableStateOf<List<Pair<FItem, Long>>?>(null) }

    // 중복 파일
    var dupGroups by remember { mutableStateOf<List<List<FItem>>?>(null) }
    var dupScanning by remember { mutableStateOf(false) }
    var dupProgress by remember { mutableStateOf(0 to 0) }

    var selected by remember { mutableStateOf(setOf<String>()) }
    var confirm by remember { mutableStateOf<List<FItem>?>(null) }

    LaunchedEffect(Unit) {
        vol = withContext(Dispatchers.IO) { FileOps.volumes(ctx).firstOrNull() }
        large = withContext(Dispatchers.IO) { runCatching { FileOps.largestFiles(ctx, 150) }.getOrDefault(emptyList()) }
    }
    LaunchedEffect(tab) {
        selected = emptySet()
        if (tab == 2 && folders == null) folders = withContext(Dispatchers.IO) {
            (FileOps.root.listFiles() ?: emptyArray()).filter { it.isDirectory }
                .map { it.toItem() to runCatching { FileOps.dirSize(it) }.getOrDefault(0L) }
                .sortedByDescending { it.second }
        }
    }

    fun scanDuplicates() {
        if (dupScanning) return
        dupScanning = true
        dupProgress = 0 to 0
        selected = emptySet()
        scope.launch {
            val r = withContext(Dispatchers.IO) {
                runCatching {
                    Duplicates.find(vm.prefs.showHidden, vm.trash.dir) { d, t -> dupProgress = d to t }
                }.getOrDefault(emptyList())
            }
            dupGroups = r
            dupScanning = false
        }
    }

    /** 각 묶음에서 가장 오래된 파일(원본)만 남기고 나머지를 선택 */
    fun autoSelectDuplicates() {
        selected = dupGroups.orEmpty().flatMap { g -> g.drop(1).map { it.path } }.toSet()
    }

    val currentItems: List<FItem> = when (tab) {
        0 -> large.orEmpty()
        1 -> dupGroups.orEmpty().flatten()
        else -> emptyList()
    }
    val selItems = currentItems.filter { it.path in selected }
    val selSize = selItems.sumOf { it.size }
    BackHandler(selected.isNotEmpty()) { selected = emptySet() }

    fun toggle(p: String) { selected = if (p in selected) selected - p else selected + p }

    fun removeLocally(paths: Set<String>) {
        large = large?.filter { it.path !in paths }
        dupGroups = dupGroups?.map { g -> g.filter { it.path !in paths } }?.filter { it.size > 1 }
        selected = selected - paths
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { SimpleTopBar("저장소 분석 · 정리", { vm.pop() }) },
        bottomBar = {
            if (selItems.isNotEmpty()) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shadowElevation = 8.dp) {
                    Row(
                        Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("${selItems.size}개 선택", fontWeight = FontWeight.Bold)
                            Text("${selSize.fmtSize()} 확보 가능", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { selected = emptySet() }) { Text("선택 해제") }
                        Button(
                            onClick = { confirm = selItems },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Icon(Icons.Rounded.Delete, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("삭제")
                        }
                    }
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            vol?.let { UsageCard(it) }
            ScrollableTabRow(selectedTabIndex = tab, containerColor = MaterialTheme.colorScheme.background, edgePadding = 12.dp) {
                Tab(tab == 0, { tab = 0 }, text = { Text("큰 파일") })
                Tab(tab == 1, { tab = 1 }, text = { Text("중복 파일") })
                Tab(tab == 2, { tab = 2 }, text = { Text("폴더별 용량") })
            }
            when (tab) {
                0 -> {
                    val l = large
                    when {
                        l == null -> Loading()
                        l.isEmpty() -> EmptyState(Icons.Rounded.Info, "큰 파일을 찾지 못했습니다")
                        else -> LazyColumn(contentPadding = PaddingValues(top = 4.dp, bottom = 40.dp)) {
                            item { Hint("지울 파일을 눌러 선택하세요. 오른쪽 버튼으로 파일을 열어볼 수 있습니다.") }
                            items(l, key = { it.path }) { item ->
                                CleanRow(
                                    item = item,
                                    checked = item.path in selected,
                                    sub = "${item.size.fmtSize()} · ${item.file.parent}",
                                    onToggle = { toggle(item.path) },
                                    onOpen = { vm.open(ctx, item) },
                                )
                            }
                        }
                    }
                }
                1 -> {
                    val g = dupGroups
                    when {
                        dupScanning -> ScanProgress(dupProgress)
                        g == null -> DupIntro(onScan = { scanDuplicates() })
                        g.isEmpty() -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                            EmptyStateBox(Icons.Rounded.CheckCircle, "중복 파일이 없습니다")
                            OutlinedButton(onClick = { scanDuplicates() }) { Text("다시 검사") }
                        }
                        else -> {
                            val waste = g.sumOf { it.first().size * (it.size - 1) }
                            LazyColumn(contentPadding = PaddingValues(top = 4.dp, bottom = 40.dp)) {
                                item {
                                    Column(
                                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
                                            .clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.secondaryContainer).padding(16.dp),
                                    ) {
                                        Text("${g.size}묶음 · ${g.sumOf { it.size - 1 }}개 중복", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSecondaryContainer)
                                        Text("정리하면 최대 ${waste.fmtSize()} 확보", color = MaterialTheme.colorScheme.onSecondaryContainer)
                                        Spacer(Modifier.height(10.dp))
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Button(onClick = { autoSelectDuplicates() }, shape = RoundedCornerShape(12.dp)) { Text("원본만 남기고 모두 선택") }
                                            OutlinedButton(onClick = { scanDuplicates() }, shape = RoundedCornerShape(12.dp)) { Text("다시 검사") }
                                        }
                                        Spacer(Modifier.height(4.dp))
                                        Text("각 묶음에서 가장 먼저 만들어진 파일이 원본으로 남습니다.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                                    }
                                }
                                g.forEachIndexed { gi, group ->
                                    item(key = "h$gi:${group.first().path}") {
                                        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Rounded.ContentCopy, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(6.dp))
                                            Text("같은 파일 ${group.size}개 · 각 ${group.first().size.fmtSize()}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                                        }
                                    }
                                    items(group, key = { "d$gi:" + it.path }) { item ->
                                        val isOriginal = item.path == group.first().path
                                        CleanRow(
                                            item = item,
                                            checked = item.path in selected,
                                            sub = (if (isOriginal) "원본 · " else "") + "${item.modified.fmtDate()} · ${item.file.parent}",
                                            onToggle = { toggle(item.path) },
                                            onOpen = { vm.open(ctx, item) },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                else -> {
                    val l = folders
                    if (l == null) ScanProgress(null) else {
                        val max = (l.firstOrNull()?.second ?: 1L).coerceAtLeast(1L)
                        LazyColumn(contentPadding = PaddingValues(bottom = 40.dp)) {
                            item { Hint("폴더를 누르면 안으로 들어가서 정리할 수 있습니다.") }
                            items(l, key = { it.first.path }) { (item, size) ->
                                Column(Modifier.fillMaxWidth().clickable { vm.push(Dest.Browse(item.path)) }.padding(horizontal = 20.dp, vertical = 10.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        IconBadge(Icons.Rounded.Folder, typeColor(FileType.FOLDER), 36.dp)
                                        Spacer(Modifier.width(12.dp))
                                        Text(item.name, Modifier.weight(1f), fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(size.fmtSize(), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                    }
                                    Spacer(Modifier.height(6.dp))
                                    Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                                        Box(Modifier.fillMaxWidth((size.toFloat() / max).coerceIn(0.01f, 1f)).height(6.dp).clip(CircleShape).background(IndigoLight))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    confirm?.let { items ->
        var permanent by remember(items) { mutableStateOf(true) }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("${items.size}개 파일 삭제") },
            text = {
                Column {
                    Text("선택한 파일 ${items.sumOf { it.size }.fmtSize()}을(를) 삭제할까요?")
                    Row(
                        Modifier.padding(top = 10.dp).clip(RoundedCornerShape(10.dp)).clickable { permanent = !permanent },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = permanent, onCheckedChange = { permanent = it })
                        Column {
                            Text("완전히 삭제 (바로 공간 확보)")
                            Text(
                                if (permanent) "되돌릴 수 없습니다" else "휴지통으로 옮깁니다 — 휴지통을 비워야 공간이 확보됩니다",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    vm.delete(items, permanent)
                    removeLocally(items.map { it.path }.toSet())
                    scope.launch { vol = withContext(Dispatchers.IO) { FileOps.volumes(ctx).firstOrNull() } }
                }) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
    }
}

@Composable
private fun UsageCard(v: Volume) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp).clip(RoundedCornerShape(22.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer).padding(18.dp),
    ) {
        Text("${v.name} · ${(v.ratio * 100).toInt()}% 사용", fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.fillMaxWidth(v.ratio.coerceIn(0.02f, 1f)).height(12.dp).clip(CircleShape).background(Coral))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "사용 ${v.used.fmtSize()}  ·  남음 ${v.free.fmtSize()}  ·  전체 ${v.total.fmtSize()}",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CleanRow(item: FItem, checked: Boolean, sub: String, onToggle: () -> Unit, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (checked) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.6f) else Color.Transparent)
            .clickable(onClick = onToggle)
            .padding(start = 2.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = { onToggle() })
        FileThumb(item, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            Text(sub, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(onClick = onOpen) { Icon(Icons.Rounded.OpenInNew, "열기", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
}

@Composable
private fun ScanProgress(p: Pair<Int, Int>?) {
    Column(Modifier.fillMaxSize().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (p == null || p.second == 0) {
            CircularProgressIndicator()
            Spacer(Modifier.height(14.dp))
            Text(if (p == null) "폴더 용량 계산 중…" else "파일 목록을 모으는 중…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text("중복 파일 검사 중… ${p.first} / ${p.second}", fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(progress = { p.first.toFloat() / p.second }, modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape))
            Spacer(Modifier.height(8.dp))
            Text("크기가 같은 파일끼리 내용을 비교하고 있습니다", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DupIntro(onScan: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        IconBadge(Icons.Rounded.ContentCopy, MaterialTheme.colorScheme.primary, 84.dp, round = true)
        Spacer(Modifier.height(16.dp))
        Text("중복 파일 찾기", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "내용이 완전히 같은 사진·동영상·문서를 찾아 원본 하나만 남기고 정리합니다.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onScan, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().height(50.dp)) {
            Icon(Icons.Rounded.Search, null); Spacer(Modifier.width(8.dp)); Text("검사 시작")
        }
    }
}

@Composable
private fun EmptyStateBox(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Box(Modifier.fillMaxWidth().height(320.dp)) { EmptyState(icon, text) }
}
