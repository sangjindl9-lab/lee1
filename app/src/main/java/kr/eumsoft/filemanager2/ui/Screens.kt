@file:OptIn(ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DeleteForever
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.data.FItem
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.FileType
import kr.eumsoft.filemanager2.data.TrashItem
import kr.eumsoft.filemanager2.data.fmtDate
import kr.eumsoft.filemanager2.data.fmtSize
import kr.eumsoft.filemanager2.data.toItem
import java.io.File
import java.nio.charset.Charset

// =================== 루트 / 내비게이션 ===================

fun hasStorageAccess(ctx: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else ctx.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

@Composable
fun Root(vm: AppVM, resumeTick: Int) {
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(hasStorageAccess(ctx)) }
    LaunchedEffect(resumeTick) {
        val now = hasStorageAccess(ctx)
        if (now != granted) { granted = now; vm.refresh() } else if (resumeTick > 1) vm.refresh()
    }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) {
        val m = vm.message ?: return@LaunchedEffect
        snack.currentSnackbarData?.dismiss()
        snack.showSnackbar(m)
        if (vm.message == m) vm.message = null
    }

    androidx.compose.material3.Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) { Box(Modifier.fillMaxSize()) {
        if (!granted) {
            PermissionScreen { granted = hasStorageAccess(ctx) }
        } else {
            BackHandler(vm.stack.size > 1) { vm.pop() }
            when (val d = vm.top) {
                Dest.Home -> HomeScreen(vm)
                is Dest.Browse -> {
                    val f = File(d.path)
                    val vol = remember(d.path) { FileOps.volumes(ctx).firstOrNull { it.path == d.path } }
                    FileListScreen(
                        vm, title = vol?.name ?: f.name, dir = f, key = d,
                        loader = { FileOps.list(f, vm.prefs.showHidden) },
                        emptyText = "빈 폴더입니다",
                    )
                }
                is Dest.Cat -> FileListScreen(
                    vm, title = d.cat.label, dir = null, key = d,
                    loader = { FileOps.category(ctx, d.cat, vm.prefs.showHidden) },
                    emptyText = "${d.cat.label}이(가) 없습니다",
                    showLocation = d.cat != kr.eumsoft.filemanager2.data.Category.DOWNLOADS,
                    sortable = d.cat != kr.eumsoft.filemanager2.data.Category.RECENT,
                )
                Dest.Favorites -> FileListScreen(
                    vm, title = "즐겨찾기", dir = null, key = d to vm.prefs.favorites,
                    loader = { vm.prefs.favorites.map { File(it) }.filter { it.exists() }.map { it.toItem() } },
                    emptyText = "즐겨찾기가 없습니다\n폴더를 길게 눌러 추가하세요",
                    showLocation = true,
                )
                is Dest.Search -> SearchScreen(vm, d.root)
                Dest.TrashBin -> TrashScreen(vm)
                Dest.Analysis -> AnalysisScreen(vm)
                is Dest.TextEdit -> TextEditorScreen(vm, d.path)
                is Dest.ImageView -> ImageViewerScreen(vm, d.path)
                Dest.Settings -> SettingsScreen(vm)
                Dest.Connect -> ConnectScreen(vm)
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 64.dp))
        vm.busy?.let { BusyDialog(it) }
    } }
}

@Composable
fun SimpleTopBar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBack, "뒤로") } },
        title = { Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        actions = { actions() },
    )
}

// =================== 권한 ===================

@Composable
fun PermissionScreen(onChanged: () -> Unit) {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { onChanged() }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(110.dp).clip(RoundedCornerShape(34.dp)).background(Indigo), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Folder, null, tint = Color.White, modifier = Modifier.size(58.dp))
        }
        Spacer(Modifier.height(28.dp))
        Text("파일관리자2", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "휴대폰의 사진, 문서, 다운로드 파일을 보여주고 정리하려면\n'모든 파일에 대한 접근' 권한이 필요합니다.",
            textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        ctx.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + ctx.packageName)))
                    } catch (e: Exception) {
                        ctx.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                    }
                } else {
                    launcher.launch(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE))
                }
            },
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().height(54.dp),
        ) { Text("권한 허용하기", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
    }
}

// =================== 검색 ===================

@Composable
fun SearchScreen(vm: AppVM, root: String) {
    var q by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf("") }
    val fr = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
    val rootFile = File(root)
    FileListScreen(
        vm,
        title = "검색",
        dir = null,
        key = "search:$root:$submitted",
        loader = { if (submitted.isBlank()) emptyList() else FileOps.search(rootFile, submitted, vm.prefs.showHidden) },
        emptyText = if (submitted.isBlank()) "검색어를 입력하세요" else "'$submitted' 검색 결과가 없습니다",
        showLocation = true,
        topSlot = {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Search, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f)) {
                    if (q.isEmpty()) Text("${if (root == FileOps.root.absolutePath) "내부 저장소" else rootFile.name}에서 검색", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    BasicTextField(
                        value = q, onValueChange = { q = it }, singleLine = true,
                        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { submitted = q.trim() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(fr),
                    )
                }
                if (q.isNotEmpty()) IconButton(onClick = { q = ""; submitted = "" }, modifier = Modifier.size(28.dp)) { Icon(Icons.Rounded.Close, "지우기") }
                TextButton(onClick = { submitted = q.trim() }) { Text("검색") }
            }
        },
    )
}

// =================== 휴지통 ===================

@Composable
fun TrashScreen(vm: AppVM) {
    var items by remember { mutableStateOf<List<TrashItem>?>(null) }
    var confirmEmpty by remember { mutableStateOf(false) }
    var target by remember { mutableStateOf<TrashItem?>(null) }
    LaunchedEffect(vm.version) { items = withContext(Dispatchers.IO) { vm.trash.list() } }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            SimpleTopBar("휴지통", { vm.pop() }) {
                if (!items.isNullOrEmpty()) TextButton(onClick = { confirmEmpty = true }) { Text("비우기", color = MaterialTheme.colorScheme.error) }
            }
        },
    ) { pad ->
        val list = items
        Column(Modifier.padding(pad).fillMaxSize()) {
            Text(
                "삭제한 파일은 직접 비우기 전까지 여기에 보관됩니다.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
            when {
                list == null -> Loading()
                list.isEmpty() -> EmptyState(Icons.Rounded.Delete, "휴지통이 비어 있습니다")
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 40.dp)) {
                    items(list, key = { it.key }) { t ->
                        val shown = FItem(t.file.absolutePath, File(t.original).name, t.file.isDirectory, t.file.length(), t.deletedAt)
                        FileRow(
                            item = shown, selected = false, selectionMode = false, favorite = false,
                            onClick = { target = t }, onLongClick = { target = t },
                            subtitle = "${t.deletedAt.fmtDate()} 삭제\n${File(t.original).parent}",
                        )
                    }
                }
            }
        }
    }
    target?.let { t ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { target = null },
            title = { Text(File(t.original).name) },
            text = { Text("원래 위치: ${File(t.original).parent}") },
            confirmButton = {
                TextButton(onClick = { target = null; vm.runOp("복원하는 중…", "복원했습니다") { vm.trash.restore(t) } }) {
                    Icon(Icons.Rounded.Restore, null); Spacer(Modifier.width(6.dp)); Text("복원")
                }
            },
            dismissButton = {
                TextButton(onClick = { target = null; vm.runOp("삭제하는 중…", "완전히 삭제했습니다") { vm.trash.deleteForever(t) } }) {
                    Icon(Icons.Rounded.DeleteForever, null, tint = MaterialTheme.colorScheme.error); Spacer(Modifier.width(6.dp))
                    Text("완전히 삭제", color = MaterialTheme.colorScheme.error)
                }
            },
        )
    }
    if (confirmEmpty) ConfirmDialog("휴지통 비우기", "휴지통의 모든 항목을 완전히 삭제할까요? 되돌릴 수 없습니다.", "비우기",
        onDismiss = { confirmEmpty = false },
        onConfirm = { confirmEmpty = false; vm.runOp("비우는 중…", "휴지통을 비웠습니다") { vm.trash.empty() } })
}

// =================== 텍스트 편집기 ===================

@Composable
fun TextEditorScreen(vm: AppVM, path: String) {
    val f = remember(path) { File(path) }
    var text by remember { mutableStateOf<String?>(null) }
    var original by remember { mutableStateOf("") }
    var charset by remember { mutableStateOf(Charsets.UTF_8) }
    var error by remember { mutableStateOf<String?>(null) }
    var askSave by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(path) {
        withContext(Dispatchers.IO) {
            if (f.length() > 2_000_000) { error = "파일이 너무 커서(2MB 초과) 편집할 수 없습니다"; return@withContext }
            val bytes = runCatching { f.readBytes() }.getOrElse { error = "읽을 수 없습니다: ${it.message}"; return@withContext }
            var s = String(bytes, Charsets.UTF_8)
            var cs: Charset = Charsets.UTF_8
            if (s.contains('�')) {
                runCatching { Charset.forName("CP949") }.getOrNull()?.let { k -> s = String(bytes, k); cs = k }
            }
            charset = cs; original = s; text = s
        }
    }
    val dirty = text != null && text != original
    fun save(after: () -> Unit = {}) {
        val t = text ?: return
        scope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { f.writeText(t, charset) }.isSuccess }
            if (ok) { original = t; vm.toast("저장했습니다"); after() } else vm.toast("저장하지 못했습니다")
        }
    }
    BackHandler(dirty) { askSave = true }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            SimpleTopBar((if (dirty) "● " else "") + f.name, { if (dirty) askSave = true else vm.pop() }) {
                IconButton(onClick = { save() }, enabled = dirty) { Icon(Icons.Rounded.Save, "저장") }
            }
        },
    ) { pad ->
        val t = text
        when {
            error != null -> Box(Modifier.padding(pad).fillMaxSize()) { EmptyState(Icons.Rounded.Info, error!!) }
            t == null -> Box(Modifier.padding(pad)) { Loading() }
            else -> BasicTextField(
                value = t, onValueChange = { text = it },
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier
                    .padding(pad).fillMaxSize().imePadding()
                    .padding(horizontal = 12.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
            )
        }
    }
    if (askSave) androidx.compose.material3.AlertDialog(
        onDismissRequest = { askSave = false },
        title = { Text("변경 내용 저장") },
        text = { Text("저장하지 않은 변경 내용이 있습니다.") },
        confirmButton = { TextButton(onClick = { askSave = false; save { vm.pop() } }) { Text("저장") } },
        dismissButton = { TextButton(onClick = { askSave = false; text = original; vm.pop() }) { Text("저장 안 함") } },
    )
}

// =================== 이미지 뷰어 ===================

@Composable
fun ImageViewerScreen(vm: AppVM, path: String) {
    val ctx = LocalContext.current
    var images by remember { mutableStateOf<List<File>?>(null) }
    var showUi by remember { mutableStateOf(true) }
    LaunchedEffect(path) {
        images = withContext(Dispatchers.IO) {
            val start = File(path)
            (start.parentFile?.listFiles() ?: emptyArray())
                .filter { it.isFile && kr.eumsoft.filemanager2.data.FileTypes.isImage(it.name) && (vm.prefs.showHidden || !it.name.startsWith(".")) }
                .sortedBy { it.name.lowercase() }
                .ifEmpty { listOf(start) }
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val list = images
        if (list != null) key(list) {
            val startIdx = list.indexOfFirst { it.absolutePath == path }.coerceAtLeast(0)
            val pager = rememberPagerState(initialPage = startIdx) { list.size }
            HorizontalPager(pager, Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                ZoomImage(list[page]) { showUi = !showUi }
            }
            if (showUi) {
                val cur = list.getOrNull(pager.currentPage) ?: list[0]
                Row(
                    Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).statusBarsPadding().padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { vm.pop() }) { Icon(Icons.Rounded.ArrowBack, "뒤로", tint = Color.White) }
                    Column(Modifier.weight(1f)) {
                        Text(cur.name, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                        Text("${pager.currentPage + 1} / ${list.size} · ${cur.length().fmtSize()}", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                    }
                }
                Row(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).navigationBarsPadding().padding(8.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    ViewerAction(Icons.Rounded.Share, "공유") { vm.share(ctx, listOf(cur.toItem())) }
                    ViewerAction(Icons.Rounded.Star, if (vm.prefs.isFav(cur.absolutePath)) "즐겨찾기 해제" else "즐겨찾기") { vm.prefs.toggleFav(cur.absolutePath) }
                    ViewerAction(Icons.Rounded.OpenInNew, "다른 앱") { vm.openExternal(ctx, cur, false) }
                    ViewerAction(Icons.Rounded.Delete, "삭제") {
                        vm.delete(listOf(cur.toItem()), false)
                        if (list.size <= 1) vm.pop() else images = list - cur
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewerAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = Color.White)
        Text(label, color = Color.White, fontSize = 11.sp)
    }
}

@Composable
private fun ZoomImage(file: File, onTap: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f },
                )
            }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.size > 1 || scale > 1f) {
                            scale = (scale * event.calculateZoom()).coerceIn(1f, 6f)
                            offset = if (scale > 1f) offset + event.calculatePan() else Offset.Zero
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        AsyncImage(
            model = file, contentDescription = file.name, contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
        )
    }
}

// =================== 설정 ===================

@Composable
fun SettingsScreen(vm: AppVM) {
    val p = vm.prefs
    val ctx = LocalContext.current
    val version = remember { runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "" }
    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { SimpleTopBar("설정", { vm.pop() }) }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            item { SectionTitle("보기") }
            item {
                SettingRow("숨김 파일 보기", "이름이 . 으로 시작하는 파일과 폴더 표시", { p.setHidden(!p.showHidden) }) {
                    Switch(checked = p.showHidden, onCheckedChange = { p.setHidden(it) })
                }
            }
            item {
                SettingRow("격자 보기", "파일을 큰 아이콘으로 표시", { p.changeGrid(!p.grid) }) {
                    Switch(checked = p.grid, onCheckedChange = { p.changeGrid(it) })
                }
            }
            item { SectionTitle("화면 테마") }
            listOf("system" to "시스템 설정 따르기", "light" to "밝게", "dark" to "어둡게").forEach { (k, label) ->
                item {
                    SettingRow(label, null, { p.changeTheme(k) }) { RadioButton(selected = p.theme == k, onClick = { p.changeTheme(k) }) }
                }
            }
            item { SectionTitle("기록") }
            item { SettingRow("최근 연 파일 기록 지우기", "${p.recent.size}개", { p.clearRecent(); vm.toast("기록을 지웠습니다") }) {} }
            item { SectionTitle("정보") }
            item { SettingRow("파일관리자2", "버전 $version · 이음소프트웨어", {}) {} }
        }
    }
}

@Composable
private fun SettingRow(title: String, sub: String?, onClick: () -> Unit, trailing: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing()
    }
}
