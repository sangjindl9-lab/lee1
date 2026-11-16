package kr.eumsoft.kidscoloring.ui

import kr.eumsoft.kidscoloring.tr
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kr.eumsoft.kidscoloring.data.Artwork
import kotlin.random.Random

/** 놀이터: 그림 퍼즐 · 풍선 터뜨리기 · 짝 맞추기. 점수 경쟁·시간제한·실패 화면 없이 언제든 계속할 수 있다. */
@Composable
fun GamesScreen(vm: ColoringViewModel, speaker: Speaker, onHome: () -> Unit) {
    var game by remember { mutableStateOf("hub") }
    BackHandler { if (game == "hub") onHome() else game = "hub" }
    val back = { if (game == "hub") onHome() else game = "hub" }
    Column(Modifier.fillMaxSize()) {
        GameBar(vm, if (game == "hub") tr("🎮 놀이터") else gameTitle(game), back)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (game) {
                "puzzle" -> PuzzleGame(vm)
                "balloon" -> BalloonGame(vm, speaker)
                "memory" -> MemoryGame(vm)
                else -> GameHub { game = it }
            }
        }
    }
}

@Composable
private fun gameTitle(id: String) = when (id) {
    "puzzle" -> tr("🧩 그림 퍼즐")
    "balloon" -> tr("🎈 풍선 터뜨리기")
    else -> tr("🃏 짝 맞추기")
}

@Composable
private fun GameBar(vm: ColoringViewModel, title: String, onBack: () -> Unit) {
    val s by vm.settings.collectAsState()
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BigButton("⬅", tr("뒤로"), onClick = onBack)
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.weight(1f).padding(start = 4.dp))
        BigButton(if (s.musicEnabled) "🎵" else "🔇", tr("음악"), selected = s.musicEnabled) { vm.updateSettings { it.copy(musicEnabled = !it.musicEnabled) } }
    }
}

@Composable
private fun GameHub(onPick: (String) -> Unit) {
    val games = listOf(
        Triple("puzzle", tr("🧩 그림 퍼즐"), tr("조각을 눌러 자리를 바꿔요")),
        Triple("balloon", tr("🎈 풍선 터뜨리기"), tr("말하는 색의 풍선을 눌러요")),
        Triple("memory", tr("🃏 짝 맞추기"), tr("같은 그림 두 장을 찾아요")),
    )
    val tints = listOf(Color(0xFFFFF3E0), Color(0xFFE8F5E9), Color(0xFFF3E5F5))
    LazyVerticalGrid(GridCells.Adaptive(260.dp), contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) { Text(tr("어떤 놀이를 할까요?"), fontSize = 18.sp, color = Ink) }
        items(games.size) { i ->
            val (id, title, desc) = games[i]
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(tints[i]).border(3.dp, Sun, RoundedCornerShape(24.dp))
                    .clickable(role = Role.Button, onClickLabel = title) { onPick(id) }.testTag("game_$id").padding(20.dp),
            ) {
                Text(title, fontSize = 24.sp, fontWeight = FontWeight.Black, color = Ink)
                Gap()
                Text(desc, fontSize = 16.sp, color = Color(0xFF6D4C41))
            }
        }
    }
}

/** 축하 띠: 다 맞히면 나온다 */
@Composable
private fun Cheer(onAgain: () -> Unit, onOther: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(24.dp)).background(Color(0xFFFFF8E1)).border(3.dp, Sun, RoundedCornerShape(24.dp)).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(tr("잘했어요! 🎉"), fontSize = 28.sp, fontWeight = FontWeight.Black, color = Berry)
        Gap()
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onAgain) { Text(tr("한 번 더"), fontSize = 18.sp) }
            if (onOther != null) Button(onClick = onOther) { Text(tr("그림 바꾸기"), fontSize = 18.sp) }
        }
    }
}

// ───────────────────────── 그림 퍼즐 ─────────────────────────

/** 퍼즐 그림: 완성한 내 그림(파일) 또는 도안 */
private class PuzzleSrc(val key: String, val path: String?, val art: Artwork?)

@Composable
private fun PuzzleGame(vm: ColoringViewModel) {
    val projects by vm.projects.collectAsState()
    val s by vm.settings.collectAsState()
    var pieces by remember { mutableIntStateOf(4) }
    var src by remember { mutableStateOf<PuzzleSrc?>(null) }
    val cur = src
    if (cur == null) {
        val mine = projects.filter { it.completed && it.thumbnailPath.isNotEmpty() }
        val arts = vm.repo.catalog.artworks.filter { it.available }
        LazyVerticalGrid(GridCells.Adaptive(130.dp), contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(tr("그림을 골라요"), fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    for (n in listOf(4, 9, 16)) BigButton("🧩", tr("%1\$d조각", n), selected = pieces == n) { pieces = n }
                }
            }
            if (mine.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) { Text(tr("🏆 완성한 그림"), fontSize = 16.sp, fontWeight = FontWeight.Bold) }
                items(mine, key = { "p" + it.projectId }) { p ->
                    FileThumb(p.thumbnailPath, p.updatedAt, tr(p.name), Modifier.fillMaxWidth().border(2.dp, Berry, RoundedCornerShape(18.dp))
                        .clickable(role = Role.Button, onClickLabel = tr(p.name)) { src = PuzzleSrc("p" + p.projectId, p.thumbnailPath, null) })
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) { Text(tr("🖍 도안"), fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            items(arts, key = { "a" + it.id }) { a ->
                ArtThumb(vm.repo, a, Modifier.fillMaxWidth().border(2.dp, Color(0xFFBBDEFB), RoundedCornerShape(18.dp))
                    .clickable(role = Role.Button, onClickLabel = tr(a.title)) { src = PuzzleSrc("a" + a.id, null, a) })
            }
        }
        return
    }
    val img by produceState<ImageBitmap?>(null, cur.key) {
        value = withContext(Dispatchers.IO) {
            (if (cur.path != null) BitmapFactory.decodeFile(cur.path) else cur.art?.let { vm.repo.thumb(it) })?.asImageBitmap()
        }
    }
    val n = when (pieces) { 4 -> 2; 9 -> 3; else -> 4 }
    var round by remember { mutableIntStateOf(0) }
    val order = remember(cur.key, n, round) { mutableStateListOf<Int>().apply { addAll(PuzzleLogic.shuffled(n * n, Random)) } }
    var picked by remember(cur.key, n, round) { mutableIntStateOf(-1) }
    val solved = PuzzleLogic.solved(order)
    LaunchedEffect(solved) { if (solved && s.soundEnabled) Fx.cheer() }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val side = minOf(maxWidth, maxHeight - 150.dp).coerceAtLeast(200.dp)
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            if (solved) Cheer(onAgain = { round++ }, onOther = { src = null })
            else Text(tr("조각을 눌러 자리를 바꿔요"), fontSize = 16.sp, modifier = Modifier.padding(8.dp))
            val b = img
            Box(Modifier.size(side).padding(8.dp).clip(RoundedCornerShape(12.dp)).background(Color.White)) {
                if (b != null) Column {
                    for (r in 0 until n) Row(Modifier.weight(1f)) {
                        for (c in 0 until n) {
                            val pos = r * n + c
                            val tile = order[pos]
                            val sel = picked == pos
                            val label = tr("조각 %1\$d", pos + 1)
                            Canvas(
                                Modifier.weight(1f).fillMaxSize().padding(if (solved) 0.dp else 1.5.dp)
                                    .border(if (sel) 4.dp else 0.dp, if (sel) Sun else Color.Transparent)
                                    .clickable(enabled = !solved, role = Role.Button, onClickLabel = label) {
                                        if (picked < 0) picked = pos
                                        else {
                                            if (picked != pos) {
                                                val t = order[picked]; order[picked] = order[pos]; order[pos] = t
                                                if (s.soundEnabled) Fx.pop()
                                            }
                                            picked = -1
                                        }
                                    }.semantics { contentDescription = label },
                            ) {
                                val side0 = minOf(b.width, b.height)
                                val ox = (b.width - side0) / 2; val oy = (b.height - side0) / 2
                                val tw = side0 / n
                                drawImage(b, srcOffset = IntOffset(ox + (tile % n) * tw, oy + (tile / n) * tw), srcSize = IntSize(tw, tw),
                                    dstSize = IntSize(size.width.toInt(), size.height.toInt()))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 퍼즐 규칙 (단위 테스트용으로 분리) */
object PuzzleLogic {
    fun solved(order: List<Int>) = order.withIndex().all { (i, v) -> i == v }
    fun shuffled(count: Int, rnd: Random): List<Int> {
        if (count < 2) return List(count) { it }
        var l: List<Int>
        do { l = (0 until count).shuffled(rnd) } while (solved(l))
        return l
    }
}

// ───────────────────────── 풍선 터뜨리기 ─────────────────────────

private class Balloon(val id: Int, val color: NamedColor, val x: Float, var y: Float, val speed: Float, val sway: Float)

@Composable
private fun BalloonGame(vm: ColoringViewModel, speaker: Speaker) {
    val s by vm.settings.collectAsState()
    val colors = remember { BalloonLogic.colors }
    var target by remember { mutableStateOf(colors.random()) }
    var stars by remember { mutableIntStateOf(0) }
    var hint by remember { mutableStateOf("") }
    var tick by remember { mutableIntStateOf(0) }
    val balloons = remember { ArrayList<Balloon>() }
    var nextId by remember { mutableIntStateOf(0) }

    fun spawn(y: Float) {
        val wantTarget = balloons.none { it.color == target }
        val c = if (wantTarget || Random.nextFloat() < 0.3f) target else colors.random()
        // 겹치지 않게 다섯 줄 중 비어 있는 줄을 고른다
        val lanes = (0 until 5).filter { l -> balloons.none { (it.x * 5).toInt() == l && it.y > y - 0.3f } }.ifEmpty { (0 until 5).toList() }
        val lane = lanes.random()
        balloons.add(Balloon(nextId++, c, (lane + 0.5f) / 5f, y, 0.06f + Random.nextFloat() * 0.05f, Random.nextFloat() * 6.28f))
    }
    LaunchedEffect(Unit) {
        speaker.say(tr("%1\$s 풍선을 눌러요", tr(target.name)))
        repeat(6) { spawn(0.25f + it * 0.15f) }
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                val dt = if (last == 0L) 0f else ((now - last) / 1e9f).coerceAtMost(0.05f)
                last = now
                if (!s.reduceMotion) for (b in balloons) b.y -= b.speed * dt
                balloons.removeAll { it.y < -0.15f }
                while (balloons.size < 6) spawn(1.15f)
                tick++
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(18.dp)).background(Color(target.argb)).border(2.dp, Ink, RoundedCornerShape(18.dp)))
            Text(tr("%1\$s 풍선을 눌러요", tr(target.name)), fontSize = 22.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f).padding(start = 10.dp))
            Text("⭐ $stars", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        Text(hint, fontSize = 16.sp, color = Color(0xFF6D4C41), modifier = Modifier.padding(horizontal = 16.dp))
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color(0xFFE1F5FE))) {
            val w = constraints.maxWidth.toFloat(); val h = constraints.maxHeight.toFloat()
            val r = minOf(w / 5f * 0.38f, h * 0.09f)
            Canvas(Modifier.fillMaxSize().semantics { contentDescription = tr("%1\$s 풍선을 눌러요", tr(target.name)) }.pointerInput(w, h) {
                detectTapGestures { p ->
                    val hit = balloons.lastOrNull { b ->
                        val cx = b.x * w + kotlin.math.sin(b.sway + b.y * 8f) * r * 0.3f
                        val cy = b.y * h
                        (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) < r * r * 1.6f
                    } ?: return@detectTapGestures
                    if (hit.color == target) {
                        balloons.remove(hit)
                        stars++
                        hint = ""
                        if (s.soundEnabled) { if (stars % 10 == 0) Fx.cheer() else Fx.pop() }
                        target = colors.filter { it != target }.random()
                        speaker.say(tr("%1\$s 풍선을 눌러요", tr(target.name)))
                    } else {
                        hint = tr("이건 %1\$s 풍선이에요", tr(hit.color.name))
                        speaker.say(tr(hit.color.name))
                    }
                }
            }) {
                tick.let { }
                for (b in balloons) {
                    val cx = b.x * w + kotlin.math.sin(b.sway + b.y * 8f) * r * 0.3f
                    val cy = b.y * h
                    val col = Color(b.color.argb)
                    val str = Path().apply { moveTo(cx, cy + r * 1.15f); quadraticTo(cx + r * 0.3f, cy + r * 1.8f, cx - r * 0.1f, cy + r * 2.4f) }
                    drawPath(str, Color(0xFF78909C), style = Stroke(width = 3f))
                    drawOval(col, topLeft = Offset(cx - r, cy - r * 1.15f), size = Size(r * 2, r * 2.3f))
                    drawOval(Color(0x33000000), topLeft = Offset(cx - r, cy - r * 1.15f), size = Size(r * 2, r * 2.3f), style = Stroke(width = 2f))
                    drawOval(Color(0x66FFFFFF), topLeft = Offset(cx - r * 0.55f, cy - r * 0.8f), size = Size(r * 0.45f, r * 0.7f))
                    drawRoundRect(col, topLeft = Offset(cx - r * 0.15f, cy + r * 1.1f), size = Size(r * 0.3f, r * 0.15f), cornerRadius = CornerRadius(4f))
                }
            }
            if (stars > 0 && stars % 10 == 0 && hint.isEmpty()) Text(tr("잘했어요! 🎉"), fontSize = 30.sp, fontWeight = FontWeight.Black, color = Berry,
                textAlign = TextAlign.Center, modifier = Modifier.align(Alignment.Center))
        }
    }
}

object BalloonLogic {
    /** 아이들이 이름을 배우기 좋은 또렷한 색 */
    val colors: List<NamedColor> get() = Palettes.rainbow.filter { it.name != "남색" } + Palettes.basic.filter { it.name == "분홍" || it.name == "갈색" }
}

// ───────────────────────── 짝 맞추기 ─────────────────────────

@Composable
private fun MemoryGame(vm: ColoringViewModel) {
    val s by vm.settings.collectAsState()
    var pairs by remember { mutableIntStateOf(3) }
    var round by remember { mutableIntStateOf(0) }
    val arts = remember { vm.repo.catalog.artworks.filter { it.available } }
    val deck = remember(pairs, round) { MemoryLogic.deal(arts.map { it.id }, pairs, Random) }
    val open = remember(pairs, round) { mutableStateListOf<Int>() }
    val matched = remember(pairs, round) { mutableStateListOf<Int>() }
    var busy by remember(pairs, round) { mutableStateOf(false) }
    val done = deck.isNotEmpty() && matched.size == deck.size
    LaunchedEffect(done) { if (done && s.soundEnabled) Fx.cheer() }
    LaunchedEffect(open.size) {
        if (open.size == 2) {
            val (a, b) = open[0] to open[1]
            if (deck[a] == deck[b]) { matched.add(a); matched.add(b); open.clear(); if (s.soundEnabled) Fx.pop() }
            else { busy = true; delay(900); open.clear(); busy = false }
        }
    }
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            for (p in listOf(3, 6, 8)) BigButton("🃏", tr("카드 %1\$d장", p * 2), selected = pairs == p) { pairs = p }
        }
        if (done) Cheer(onAgain = { round++ }, onOther = null)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
            val cols = if (deck.size <= 6) 3 else 4
            val rows = (deck.size + cols - 1) / cols
            val cell = minOf(maxWidth / cols, maxHeight / rows)
            Column {
                for (r in 0 until rows) Row {
                    for (c in 0 until cols) {
                        val i = r * cols + c
                        if (i >= deck.size) continue
                        val up = i in open || i in matched
                        val art = vm.repo.catalog.byId(deck[i])
                        val label = tr("카드 %1\$d", i + 1)
                        Box(Modifier.size(cell).padding(5.dp).clip(RoundedCornerShape(16.dp))
                            .background(if (up) Color.White else Color(0xFF64B5F6))
                            .border(3.dp, if (i in matched) Color(0xFF66BB6A) else Color(0xFF1E88E5), RoundedCornerShape(16.dp))
                            .clickable(enabled = !up && !busy && open.size < 2, role = Role.Button, onClickLabel = label) { open.add(i) }.semantics { contentDescription = label },
                            contentAlignment = Alignment.Center) {
                            if (up && art != null) ArtThumb(vm.repo, art, Modifier.fillMaxSize())
                            else Text("🎨", fontSize = 34.sp)
                        }
                    }
                }
            }
        }
    }
}

object MemoryLogic {
    /** 도안 id 중 pairs 개를 골라 두 장씩 섞는다 */
    fun deal(ids: List<String>, pairs: Int, rnd: Random): List<String> {
        val pick = ids.shuffled(rnd).take(pairs)
        return (pick + pick).shuffled(rnd)
    }
}
