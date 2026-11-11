package kr.eumsoft.kidscoloring.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kr.eumsoft.kidscoloring.data.UserSettings
import android.graphics.Color as AColor

private val paletteTabs = listOf("기본", "더 많은 색", "무지개", "색각 친화", "⭐ 좋아하는 색", "최근")

@Composable
fun ColoringScreen(vm: ColoringViewModel, speaker: Speaker, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val hostView = LocalView.current
    val settings by vm.settings.collectAsState()
    val engine = vm.engine ?: return
    val art = vm.artwork ?: return
    val rev = vm.rev

    var canvas by remember { mutableStateOf<ColoringView?>(null) }
    var askExit by remember { mutableStateOf(false) }
    var askDiscard by remember { mutableStateOf(false) }
    var askClear by remember { mutableStateOf(false) }
    var showMore by remember { mutableStateOf(false) }
    var showAuto by remember { mutableStateOf(false) }
    var showSuggest by remember { mutableStateOf(false) }
    var showCustom by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<ImageBitmap?>(null) }
    var gate by remember { mutableStateOf<(() -> Unit)?>(null) }
    var suggested by remember { mutableStateOf<PaletteTheme?>(null) }

    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()
    fun feedback() {
        if (settings.vibrationEnabled) hostView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        if (settings.soundEnabled) Fx.pop()
    }
    fun say(t: String) { if (settings.voiceGuide) speaker.say(t) }
    fun pick(c: Int) { vm.pickColor(c); say(Palettes.nameOf(c)); if (vm.tool == Tool.ERASER || vm.tool == Tool.REGION_ERASER) vm.tool = Tool.FILL }
    fun refresh() { canvas?.sync(); vm.edited() }

    val createDoc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        if (uri != null) vm.thumbBitmap(engine.w)?.let { b -> toast(if (Exporter.writeTo(ctx, uri, b)) "사진으로 저장했어요" else "저장하지 못했어요"); b.recycle() }
    }
    fun export() {
        if (Build.VERSION.SDK_INT >= 29) {
            val b = vm.thumbBitmap(engine.w) ?: return
            toast(if (Exporter.saveToPictures(ctx, b, "이음컬러링_${art.title}_${System.currentTimeMillis() / 1000}")) "사진첩(Pictures/EumKidsColoring)에 저장했어요" else "저장하지 못했어요. 저장 공간을 확인해 주세요")
            b.recycle()
        } else createDoc.launch("이음컬러링_${art.title}.png")
    }
    fun share() { vm.thumbBitmap(engine.w)?.let { b -> if (!Exporter.share(ctx, b, art.title)) toast("보낼 수 없어요"); b.recycle() } }

    // 화면을 떠나거나 앱이 뒤로 갈 때 바로 저장 (강제 종료 대비)
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, ev -> if (ev == Lifecycle.Event.ON_PAUSE || ev == Lifecycle.Event.ON_STOP) vm.saveNow(silent = true) }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(vm.message) { vm.message?.let { toast(it); vm.message = null } }
    LaunchedEffect(vm.celebrate) { if (vm.celebrate && settings.soundEnabled) Fx.cheer() }
    BackHandler { askExit = true }

    val canvasBox: @Composable (Modifier) -> Unit = { mod ->
        AndroidView(
            modifier = mod.background(Color(0xFFCFD8DC)),
            factory = { c -> ColoringView(c).also { v -> canvas = v } },
            update = { v ->
                if (v.engine !== engine) { v.engine = engine; v.paintBitmap = vm.paintBitmap; v.lineBitmap = vm.lineBitmap; v.fit() }
                v.tool = vm.tool; v.color = vm.color; v.brushSize = vm.brushSize; v.opacity = vm.opacity
                v.stayInside = settings.stayInside; v.fingerPansOnly = settings.fingerPansOnly; v.stickerType = vm.stickerType
                v.onEdited = { vm.edited() }
                v.onFilled = { feedback(); vm.onFilled() }
            },
        )
    }
    val topBar: @Composable () -> Unit = {
        // 버튼 8개가 좁은 스마트폰 화면에도 한 줄에 다 보이도록 너비를 화면에 맞춘다
        BoxWithConstraints(Modifier.fillMaxWidth().background(Color.White).padding(6.dp)) {
            val bw = ((maxWidth - 4.dp * 7) / 8).coerceIn(38.dp, 64.dp)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                val m = Modifier.width(bw)
                BigButton("🏠", "홈", m, size = 48.dp) { askExit = true }
                BigButton("💾", "저장", m, size = 48.dp) { vm.saveNow() }
                BigButton("↩", "취소", m, enabled = rev >= 0 && engine.canUndo, size = 48.dp) { engine.undo(); refresh() }
                BigButton("↪", "다시", m, enabled = rev >= 0 && engine.canRedo, size = 48.dp) { engine.redo(); refresh() }
                BigButton("🔍", "맞춤", m, size = 48.dp) { canvas?.fit() }
                BigButton("👀", "보기", m, size = 48.dp) { preview = vm.thumbBitmap(1024)?.asImageBitmap() }
                BigButton("🎉", "완성", m, size = 48.dp) { vm.markComplete() }
                BigButton("➕", "더보기", m, size = 48.dp) { showMore = true }
            }
        }
    }
    val toolButtons: @Composable () -> Unit = {
        for (t in Tool.entries) BigButton(t.emoji, t.label, selected = vm.tool == t, size = 58.dp) { vm.tool = t; say(t.label) }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth > maxHeight
        if (wide) {
            // 태블릿·가로 화면: 왼쪽 도구, 가운데 도안, 오른쪽 색상, 위 저장·취소·다시·홈
            val side = if (maxWidth >= 900.dp) 210.dp else 140.dp
            Column(Modifier.fillMaxSize()) {
                topBar()
                Row(Modifier.weight(1f)) {
                    Column(Modifier.width(side).fillMaxHeight().background(Color.White).verticalScroll(rememberScrollState()).padding(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val cols = if (side >= 200.dp) 3 else 2
                        Tool.entries.chunked(cols).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                for (t in row) BigButton(t.emoji, t.label, Modifier.weight(1f), selected = vm.tool == t) { vm.tool = t; say(t.label) }
                                repeat(cols - row.size) { Box(Modifier.weight(1f)) }
                            }
                        }
                        ToolOptions(vm, settings)
                    }
                    canvasBox(Modifier.weight(1f).fillMaxHeight())
                    Column(Modifier.width(side).fillMaxHeight().background(Color.White).padding(6.dp)) {
                        PalettePanel(vm, settings, suggested, vertical = true, onPick = { pick(it) }, onCustom = { showCustom = true })
                    }
                }
            }
        } else {
            // 스마트폰 세로: 아래쪽에 도구와 색상
            Column(Modifier.fillMaxSize()) {
                topBar()
                canvasBox(Modifier.weight(1f).fillMaxWidth())
                Column(Modifier.fillMaxWidth().background(Color.White).padding(vertical = 4.dp)) {
                    ToolOptions(vm, settings)
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { toolButtons() }
                    PalettePanel(vm, settings, suggested, vertical = false, onPick = { pick(it) }, onCustom = { showCustom = true })
                }
            }
        }
        if (vm.celebrate) Celebration(settings.reduceMotion) { vm.celebrate = false }
    }

    if (askExit) AlertDialog(onDismissRequest = { askExit = false }, title = { Text("그만할까요?") }, confirmButton = {}, dismissButton = {},
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("그림을 저장할까요, 지울까요?")
                Button(onClick = { askExit = false; vm.close(onExit) }, modifier = Modifier.fillMaxWidth()) { Text("💾 저장하고 나가기", fontSize = 17.sp) }
                Button(onClick = { askExit = false; askDiscard = true }, modifier = Modifier.fillMaxWidth()) { Text("🗑 지우고 나가기", fontSize = 17.sp) }
                TextButton(onClick = { askExit = false }, modifier = Modifier.fillMaxWidth()) { Text("🎨 계속 칠하기", fontSize = 17.sp) }
            }
        })
    if (askDiscard) ConfirmDialog("정말 지울까요?", "이 그림에 칠한 것이 모두 사라져요. 되돌릴 수 없어요.", "지우기", "아니요",
        onYes = { askDiscard = false; vm.discard(onExit) }, onNo = { askDiscard = false; askExit = true })
    if (askClear) ConfirmDialog("모두 지울까요?", "칠한 색과 스티커가 모두 지워져요. ('취소' 버튼으로 되돌릴 수 있어요.)", "모두 지우기", "아니요",
        onYes = { askClear = false; engine.clearAll(); refresh() }, onNo = { askClear = false })
    if (showMore) AlertDialog(onDismissRequest = { showMore = false }, title = { Text("더보기") }, confirmButton = {},
        dismissButton = { TextButton(onClick = { showMore = false }) { Text("닫기") } },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { showMore = false; showAuto = true }, modifier = Modifier.fillMaxWidth()) { Text("✨ 자동 색칠") }
                Button(onClick = { showMore = false; showSuggest = true }, modifier = Modifier.fillMaxWidth()) { Text("🎨 색칠 추천") }
                Button(onClick = { showMore = false; askClear = true }, modifier = Modifier.fillMaxWidth()) { Text("🗑 모두 지우기") }
                Button(onClick = { showMore = false; if (settings.parentalLockEnabled) gate = { export() } else export() }, modifier = Modifier.fillMaxWidth()) { Text("🖼 사진으로 내보내기") }
                Button(onClick = { showMore = false; gate = { share() } }, modifier = Modifier.fillMaxWidth()) { Text("📤 보내기 (보호자 확인)") }
            }
        })
    if (showAuto) ThemeDialog("자동 색칠", "색 묶음을 고르면 아직 안 칠한 칸을 자동으로 칠해요.", onDismiss = { showAuto = false }) { th ->
        showAuto = false
        val n = engine.autoColor(th.colors, art.background, seed = (System.currentTimeMillis() % 97).toInt())
        refresh()
        if (n == 0) toast("이미 모두 칠했어요") else { feedback(); vm.onFilled() }
    }
    if (showSuggest) ThemeDialog("색칠 추천", "어울리는 색 묶음이에요. 고르면 색상판 맨 앞에 놓아 줄게요.", onDismiss = { showSuggest = false }) { th ->
        showSuggest = false; suggested = th; pick(th.colors[0])
    }
    if (showCustom) CustomColorDialog(vm.color, onDismiss = { showCustom = false }) { c -> showCustom = false; pick(c) }
    gate?.let { action -> ParentGate(onPass = { gate = null; action() }, onDismiss = { gate = null }) }
    preview?.let { img ->
        Dialog(onDismissRequest = { preview = null }) {
            Column(Modifier.clip(RoundedCornerShape(24.dp)).background(Color.White).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Image(img, "완성 이미지 미리보기", Modifier.fillMaxWidth())
                TextButton(onClick = { preview = null }) { Text("닫기", fontSize = 18.sp) }
            }
        }
    }
}

@Composable
private fun ToolOptions(vm: ColoringViewModel, settings: UserSettings) {
    val t = vm.tool
    if (t.brush == null && t != Tool.STICKER) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        if (t == Tool.STICKER) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Render.stickerNames.forEachIndexed { i, n -> BigButton(Render.stickerEmoji[i], n, selected = vm.stickerType == i, size = 48.dp) { vm.stickerType = i } }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (t == Tool.STICKER) "크기" else "굵기", fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.width(46.dp))
            Slider(vm.brushSize, { vm.brushSize = it }, valueRange = 6f..90f, modifier = Modifier.weight(1f).semantics { contentDescription = "붓 굵기" },
                onValueChangeFinished = { vm.updateSettings { it.copy(brushSize = vm.brushSize) } })
        }
        if (t.brush != null && t != Tool.ERASER) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("진하기", fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.width(46.dp))
                Slider(vm.opacity, { vm.opacity = it }, valueRange = 0.15f..1f, modifier = Modifier.weight(1f).semantics { contentDescription = "색 투명도" },
                    onValueChangeFinished = { vm.updateSettings { it.copy(opacity = vm.opacity) } })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("선 밖으로 안 나가기", fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Switch(settings.stayInside, { v -> vm.updateSettings { it.copy(stayInside = v) } })
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Swatch(c: NamedColor, selected: Boolean, favorite: Boolean, showName: Boolean, size: Dp, onPick: () -> Unit, onLong: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(2.dp)) {
        Box(
            Modifier.size(size).clip(CircleShape).background(Color(c.argb))
                .border(if (selected) 4.dp else 1.5.dp, if (selected) Ink else Color(0xFF90A4AE), CircleShape)
                .combinedClickable(role = Role.Button, onClickLabel = c.name, onLongClickLabel = "좋아하는 색에 넣기", onLongClick = onLong, onClick = onPick)
                .semantics { contentDescription = c.name + if (selected) " 선택됨" else "" },
            contentAlignment = Alignment.Center,
        ) {
            // 색만으로 구분하지 않도록 선택 표시는 ✓ 모양으로도 보여 준다
            val dark = AColor.luminance(c.argb) < 0.5f
            if (selected) Text("✓", color = if (dark) Color.White else Color.Black, fontWeight = FontWeight.Black, fontSize = 20.sp)
            else if (favorite) Text("★", color = if (dark) Color.White else Color.Black, fontSize = 11.sp)
        }
        if (showName) Text(c.name, fontSize = 10.sp, maxLines = 1)
    }
}

@Composable
private fun PalettePanel(vm: ColoringViewModel, settings: UserSettings, suggested: PaletteTheme?, vertical: Boolean, onPick: (Int) -> Unit, onCustom: () -> Unit) {
    val tab = settings.selectedPalette.coerceIn(0, paletteTabs.lastIndex)
    val base = when (tab) {
        0 -> Palettes.basic
        1 -> Palettes.extended
        2 -> Palettes.rainbow
        3 -> Palettes.colorSafe
        4 -> settings.favoriteColors.map { NamedColor(it, Palettes.nameOf(it)) }
        else -> settings.recentColors.map { NamedColor(it, Palettes.nameOf(it)) }
    }
    val colors = if (suggested != null && tab == 0) suggested.colors.map { NamedColor(it, Palettes.nameOf(it)) } + base else base
    val size = if (vertical) 46.dp else 44.dp
    val tabs: @Composable () -> Unit = {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            paletteTabs.forEachIndexed { i, n ->
                Text(n, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (i == tab) Color.White else Ink,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (i == tab) Color(0xFF1E88E5) else Color(0xFFECEFF1))
                        .combinedClickableSimple(n) { vm.updateSettings { it.copy(selectedPalette = i) } }.padding(horizontal = 10.dp, vertical = 8.dp))
            }
            Text("＋ 나만의 색", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Berry).combinedClickableSimple("나만의 색 만들기", onCustom).padding(horizontal = 10.dp, vertical = 8.dp))
        }
    }
    val empty = colors.isEmpty()
    val hint = if (tab == 4) "색을 길게 누르면 여기에 모여요" else "쓴 색이 여기에 모여요"
    if (vertical) {
        tabs()
        if (empty) Text(hint, fontSize = 13.sp, color = Color.Gray, modifier = Modifier.padding(8.dp))
        LazyVerticalGrid(GridCells.Adaptive(size + 6.dp), contentPadding = PaddingValues(4.dp)) {
            items(colors) { c -> Swatch(c, c.argb == vm.color, c.argb in settings.favoriteColors, settings.showColorNames, size, { onPick(c.argb) }, { vm.toggleFavorite(c.argb) }) }
        }
    } else {
        tabs()
        if (empty) Text(hint, fontSize = 13.sp, color = Color.Gray, modifier = Modifier.padding(8.dp).height(size))
        else LazyRow(contentPadding = PaddingValues(horizontal = 6.dp)) {
            items(colors) { c -> Swatch(c, c.argb == vm.color, c.argb in settings.favoriteColors, settings.showColorNames, size, { onPick(c.argb) }, { vm.toggleFavorite(c.argb) }) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableSimple(label: String, onClick: () -> Unit): Modifier =
    this.combinedClickable(role = Role.Tab, onClickLabel = label, onClick = onClick)

@Composable
private fun ThemeDialog(title: String, desc: String, onDismiss: () -> Unit, onPick: (PaletteTheme) -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(desc)
                for (th in Palettes.themes) Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFF1F5F9))
                        .combinedClickableSimple(th.name) { onPick(th) }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(th.name, fontWeight = FontWeight.Bold, modifier = Modifier.width(56.dp))
                    for (c in th.colors) Box(Modifier.padding(1.dp).size(24.dp).clip(CircleShape).background(Color(c)).border(1.dp, Color.Gray, CircleShape))
                }
            }
        })
}

/** 사용자 지정 색상 */
@Composable
private fun CustomColorDialog(initial: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val hsv = remember { FloatArray(3).also { AColor.colorToHSV(initial, it) } }
    var h by remember { mutableFloatStateOf(hsv[0]) }
    var s by remember { mutableFloatStateOf(hsv[1]) }
    var v by remember { mutableFloatStateOf(hsv[2]) }
    val c = AColor.HSVToColor(floatArrayOf(h, s, v))
    AlertDialog(onDismissRequest = onDismiss, title = { Text("나만의 색 만들기") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(72.dp).clip(CircleShape).background(Color(c)).border(2.dp, Ink, CircleShape))
                Text(Palettes.nameOf(c) + " 느낌", fontSize = 13.sp)
                Text("색깔", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                Slider(h, { h = it }, valueRange = 0f..359f, modifier = Modifier.semantics { contentDescription = "색깔" })
                Text("선명하게", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                Slider(s, { s = it }, valueRange = 0f..1f, modifier = Modifier.semantics { contentDescription = "선명하게" })
                Text("밝게", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                Slider(v, { v = it }, valueRange = 0f..1f, modifier = Modifier.semantics { contentDescription = "밝게" })
            }
        },
        confirmButton = { Button(onClick = { onPick(c) }) { Text("이 색으로 칠하기") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } })
}

/** 완성 축하: 작은 별들이 떨어진다. '애니메이션 줄이기'를 켜면 움직이지 않는다. */
@Composable
private fun Celebration(reduceMotion: Boolean, onDone: () -> Unit) {
    LaunchedEffect(Unit) { delay(3500); onDone() }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color(0x66000000)).combinedClickableSimple("축하 닫기", onDone), contentAlignment = Alignment.Center) {
        if (!reduceMotion) {
            val tr = rememberInfiniteTransition(label = "stars")
            val p by tr.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = LinearEasing), RepeatMode.Restart), label = "fall")
            val stars = listOf("⭐", "🌟", "✨", "🎉", "⭐", "🌟", "✨", "🎈", "⭐", "🌟")
            stars.forEachIndexed { i, st ->
                val x = maxWidth * ((i * 37 % 100) / 100f)
                val y = maxHeight * (((p + i * 0.13f) % 1f) * 1.1f - 0.05f)
                Text(st, fontSize = (26 + i % 3 * 8).sp, modifier = Modifier.align(Alignment.TopStart).offset(x, y))
            }
        }
        Column(Modifier.clip(RoundedCornerShape(28.dp)).background(Color.White).padding(horizontal = 36.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🎉", fontSize = 48.sp)
            Text("참 잘했어요!", fontSize = 28.sp, fontWeight = FontWeight.Black, color = Berry, textAlign = TextAlign.Center)
            Text("그림을 완성했어요", fontSize = 16.sp)
        }
    }
}
