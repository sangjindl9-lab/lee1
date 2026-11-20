@file:OptIn(ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.ContentCut
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.NoteAdd
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sort
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.data.FItem
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.SortMode
import kr.eumsoft.filemanager2.data.sortItems
import java.io.File

private sealed interface Dlg {
    data class Rename(val item: FItem) : Dlg
    data object NewFolder : Dlg
    data object NewFile : Dlg
    data class Delete(val items: List<FItem>) : Dlg
    data class Compress(val items: List<FItem>) : Dlg
    data class Props(val items: List<FItem>) : Dlg
    data class Zip(val item: FItem) : Dlg
}

/**
 * 폴더 탐색 · 카테고리 · 검색결과 · 즐겨찾기에서 같이 쓰는 파일 목록 화면.
 * dir 이 있으면 "폴더 모드"(새로 만들기·붙여넣기 가능).
 */
@Composable
fun FileListScreen(
    vm: AppVM,
    title: String,
    dir: File?,
    key: Any,
    loader: suspend () -> List<FItem>,
    emptyText: String = "비어 있습니다",
    showLocation: Boolean = false,
    sortable: Boolean = true,
    topSlot: (@Composable () -> Unit)? = null,
) {
    val ctx = LocalContext.current
    val p = vm.prefs
    var items by remember(key) { mutableStateOf<List<FItem>?>(null) }
    var selected by remember(key) { mutableStateOf(setOf<String>()) }
    var dlg by remember { mutableStateOf<Dlg?>(null) }
    var menu by remember { mutableStateOf(false) }
    var sortMenu by remember { mutableStateOf(false) }
    var selMenu by remember { mutableStateOf(false) }

    LaunchedEffect(key, vm.version, p.showHidden) {
        val loaded = withContext(Dispatchers.IO) { runCatching { loader() }.getOrDefault(emptyList()) }
        items = loaded
        val paths = loaded.map { it.path }.toSet()
        selected = selected.filter { it in paths }.toSet()
    }

    val shown = remember(items, p.sort, p.asc, sortable) {
        items?.let { if (sortable) sortItems(it, p.sort, p.asc) else it }
    }
    val selItems = shown?.filter { it.path in selected } ?: emptyList()
    val selMode = selected.isNotEmpty()
    BackHandler(selMode) { selected = emptySet() }

    fun toggle(it: FItem) { selected = if (it.path in selected) selected - it.path else selected + it.path }
    fun click(it: FItem) {
        when {
            selMode -> toggle(it)
            it.isDir -> vm.push(Dest.Browse(it.path))
            it.ext == "zip" -> dlg = Dlg.Zip(it)
            else -> vm.open(ctx, it)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            if (selMode) {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    navigationIcon = { IconButton(onClick = { selected = emptySet() }) { Icon(Icons.Rounded.Close, "선택 해제") } },
                    title = { Text("${selected.size}개 선택", fontWeight = FontWeight.Bold) },
                    actions = {
                        IconButton(onClick = { vm.setClip(selItems, false); selected = emptySet() }) { Icon(Icons.Rounded.ContentCopy, "복사") }
                        IconButton(onClick = { vm.setClip(selItems, true); selected = emptySet() }) { Icon(Icons.Rounded.ContentCut, "잘라내기") }
                        IconButton(onClick = { dlg = Dlg.Delete(selItems) }) { Icon(Icons.Rounded.Delete, "삭제") }
                        Box {
                            IconButton(onClick = { selMenu = true }) { Icon(Icons.Rounded.MoreVert, "더 보기") }
                            DropdownMenu(selMenu, { selMenu = false }) {
                                DropdownMenuItem(text = { Text("모두 선택") }, onClick = { selMenu = false; selected = shown?.map { it.path }?.toSet() ?: emptySet() })
                                if (selItems.size == 1) DropdownMenuItem(text = { Text("이름 변경") }, onClick = { selMenu = false; dlg = Dlg.Rename(selItems[0]) })
                                DropdownMenuItem(text = { Text("압축하기 (ZIP)") }, onClick = { selMenu = false; dlg = Dlg.Compress(selItems) })
                                DropdownMenuItem(text = { Text("공유") }, onClick = { selMenu = false; vm.share(ctx, selItems) })
                                if (selItems.size == 1 && !selItems[0].isDir) {
                                    DropdownMenuItem(text = { Text("다른 앱으로 열기") }, onClick = { selMenu = false; vm.openExternal(ctx, selItems[0].file, true) })
                                }
                                if (selItems.size == 1) {
                                    val it = selItems[0]
                                    DropdownMenuItem(
                                        text = { Text(if (p.isFav(it.path)) "즐겨찾기 해제" else "즐겨찾기 추가") },
                                        onClick = { selMenu = false; p.toggleFav(it.path); selected = emptySet() },
                                    )
                                    if (showLocation) DropdownMenuItem(text = { Text("파일 위치 열기") }, onClick = {
                                        selMenu = false; selected = emptySet(); it.file.parent?.let { d -> vm.push(Dest.Browse(d)) }
                                    })
                                }
                                DropdownMenuItem(text = { Text("속성") }, onClick = { selMenu = false; dlg = Dlg.Props(selItems) })
                            }
                        }
                    },
                )
            } else {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                    navigationIcon = { IconButton(onClick = { vm.pop() }) { Icon(Icons.Rounded.ArrowBack, "뒤로") } },
                    title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold) },
                    actions = {
                        if (dir != null) IconButton(onClick = { vm.push(Dest.Search(dir.absolutePath)) }) { Icon(Icons.Rounded.Search, "검색") }
                        if (sortable) Box {
                            IconButton(onClick = { sortMenu = true }) { Icon(Icons.Rounded.Sort, "정렬") }
                            DropdownMenu(sortMenu, { sortMenu = false }) {
                                SortMode.entries.forEach { m ->
                                    DropdownMenuItem(
                                        text = { Text(m.label, fontWeight = if (p.sort == m) FontWeight.Bold else FontWeight.Normal) },
                                        leadingIcon = { if (p.sort == m) Icon(Icons.Rounded.Check, null) else Spacer(Modifier.size(24.dp)) },
                                        onClick = { p.setSort(m, p.asc); sortMenu = false },
                                    )
                                }
                                HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text(if (p.asc) "오름차순" else "내림차순") },
                                    leadingIcon = { Icon(if (p.asc) Icons.Rounded.ArrowUpward else Icons.Rounded.ArrowDownward, null) },
                                    onClick = { p.setSort(p.sort, !p.asc); sortMenu = false },
                                )
                            }
                        }
                        IconButton(onClick = { p.setGrid(!p.grid) }) {
                            Icon(if (p.grid) Icons.Rounded.ViewList else Icons.Rounded.GridView, "보기 전환")
                        }
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "더 보기") }
                            DropdownMenu(menu, { menu = false }) {
                                if (dir != null) {
                                    DropdownMenuItem(text = { Text("새 폴더") }, leadingIcon = { Icon(Icons.Rounded.CreateNewFolder, null) }, onClick = { menu = false; dlg = Dlg.NewFolder })
                                    DropdownMenuItem(text = { Text("새 텍스트 파일") }, leadingIcon = { Icon(Icons.Rounded.NoteAdd, null) }, onClick = { menu = false; dlg = Dlg.NewFile })
                                    DropdownMenuItem(
                                        text = { Text(if (p.isFav(dir.absolutePath)) "즐겨찾기 해제" else "이 폴더 즐겨찾기") },
                                        onClick = { menu = false; p.toggleFav(dir.absolutePath) },
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text("숨김 파일 보기") },
                                    trailingIcon = { Checkbox(checked = p.showHidden, onCheckedChange = null) },
                                    onClick = { p.setHidden(!p.showHidden) },
                                )
                                DropdownMenuItem(text = { Text("새로 고침") }, onClick = { menu = false; vm.refresh() })
                                DropdownMenuItem(text = { Text("홈으로") }, leadingIcon = { Icon(Icons.Rounded.Home, null) }, onClick = { menu = false; vm.goHome() })
                            }
                        }
                    },
                )
            }
        },
        floatingActionButton = {
            if (dir != null && !selMode && vm.clip == null) {
                FloatingActionButton(
                    onClick = { dlg = Dlg.NewFolder },
                    containerColor = MaterialTheme.colorScheme.secondary,
                    contentColor = MaterialTheme.colorScheme.onSecondary,
                    shape = RoundedCornerShape(18.dp),
                ) { Icon(Icons.Rounded.CreateNewFolder, "새 폴더") }
            }
        },
        bottomBar = {
            val c = vm.clip
            if (dir != null && c != null && !selMode) {
                Surface(color = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.ContentPaste, null)
                        Spacer(Modifier.width(10.dp))
                        Text("${c.paths.size}개 ${if (c.cut) "이동" else "복사"} 대기", Modifier.weight(1f), fontWeight = FontWeight.Medium)
                        TextButton(onClick = { vm.clip = null }) { Text("취소", color = MaterialTheme.colorScheme.onPrimary) }
                        TextButton(onClick = { vm.paste(dir) }) { Text("여기에 붙여넣기", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold) }
                    }
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            topSlot?.invoke()
            if (dir != null) Breadcrumb(vm, dir)
            val list = shown
            when {
                list == null -> Loading()
                list.isEmpty() -> EmptyState(Icons.Rounded.FolderOpen, emptyText)
                p.grid -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(104.dp),
                    contentPadding = PaddingValues(8.dp, 4.dp, 8.dp, 96.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(list, key = { it.path }) { item ->
                        FileCell(item, item.path in selected, onClick = { click(item) }, onLongClick = { toggle(item) })
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                    items(list, key = { it.path }) { item ->
                        FileRow(
                            item = item,
                            selected = item.path in selected,
                            selectionMode = selMode,
                            favorite = p.isFav(item.path),
                            onClick = { click(item) },
                            onLongClick = { toggle(item) },
                            subtitle = if (showLocation) "${itemSubtitle(item)}\n${item.file.parent}" else itemSubtitle(item),
                        )
                    }
                }
            }
        }
    }

    when (val d = dlg) {
        null -> {}
        is Dlg.Rename -> InputDialog("이름 변경", d.item.name, "변경", selectBaseName = !d.item.isDir, onDismiss = { dlg = null }) {
            dlg = null; selected = emptySet(); vm.rename(d.item, it)
        }
        Dlg.NewFolder -> InputDialog("새 폴더", "새 폴더", "만들기", onDismiss = { dlg = null }) {
            dlg = null; dir?.let { dd -> vm.newFolder(dd, it) }
        }
        Dlg.NewFile -> InputDialog("새 텍스트 파일", "새 문서.txt", "만들기", selectBaseName = true, onDismiss = { dlg = null }) {
            dlg = null; dir?.let { dd -> vm.newFile(dd, it) }
        }
        is Dlg.Compress -> InputDialog(
            "압축하기", (if (d.items.size == 1) d.items[0].file.nameWithoutExtension else (d.items[0].file.parentFile?.name ?: "압축")) + ".zip",
            "압축", selectBaseName = true, onDismiss = { dlg = null },
        ) { dlg = null; selected = emptySet(); vm.compress(d.items, it) }
        is Dlg.Delete -> {
            val inTrash = d.items.all { vm.trash.isInTrash(it.file) }
            var permanent by remember(d) { mutableStateOf(false) }
            ConfirmDialog(
                "삭제",
                "${if (d.items.size == 1) "'${d.items[0].name}'" else "${d.items.size}개 항목"}을(를) ${if (permanent || inTrash) "완전히 삭제할까요? 되돌릴 수 없습니다." else "휴지통으로 옮길까요?"}",
                "삭제",
                onDismiss = { dlg = null },
                onConfirm = { dlg = null; selected = emptySet(); vm.delete(d.items, permanent) },
                extra = if (inTrash) null else ({
                    Row(Modifier.padding(top = 10.dp).clip(RoundedCornerShape(10.dp)).clickable { permanent = !permanent }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = permanent, onCheckedChange = { permanent = it })
                        Text("휴지통을 거치지 않고 바로 삭제")
                    }
                }),
            )
        }
        is Dlg.Props -> PropertiesDialog(d.items) { dlg = null }
        is Dlg.Zip -> ZipDialog(
            name = d.item.name,
            onDismiss = { dlg = null },
            onExtract = { dlg = null; vm.extract(d.item) },
            onOpen = { dlg = null; vm.openExternal(ctx, d.item.file) },
        )
    }
}

@Composable
private fun ZipDialog(name: String, onDismiss: () -> Unit, onExtract: () -> Unit, onOpen: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = { Text("압축 파일을 어떻게 할까요?") },
        confirmButton = { TextButton(onClick = onExtract) { Text("여기에 압축 풀기") } },
        dismissButton = { TextButton(onClick = onOpen) { Text("다른 앱으로 열기") } },
    )
}

@Composable
fun Breadcrumb(vm: AppVM, dir: File) {
    val ctx = LocalContext.current
    val vols = remember { FileOps.volumes(ctx) }
    val vol = vols.firstOrNull { dir.absolutePath == it.path || dir.absolutePath.startsWith(it.path + "/") }
    val segs = remember(dir) {
        val out = mutableListOf<Pair<String, String>>()
        if (vol != null) {
            out += vol.name to vol.path
            val rel = dir.absolutePath.removePrefix(vol.path).trim('/')
            var acc = vol.path
            if (rel.isNotEmpty()) rel.split('/').forEach { s -> acc = "$acc/$s"; out += s to acc }
        } else {
            var acc = ""
            dir.absolutePath.trim('/').split('/').forEach { s -> acc = "$acc/$s"; out += s to acc }
        }
        out
    }
    val scroll = rememberScrollState()
    LaunchedEffect(segs) { scroll.scrollTo(scroll.maxValue) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 14.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        segs.forEachIndexed { i, (name, path) ->
            val last = i == segs.lastIndex
            Text(
                name,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (last) FontWeight.Bold else FontWeight.Normal,
                color = if (last) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (last) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                    .clickable(enabled = !last) { vm.push(Dest.Browse(path)) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
            if (!last) Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
        }
    }
}
