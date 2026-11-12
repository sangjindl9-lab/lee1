package kr.eumsoft.kidscoloring.ui

import kr.eumsoft.kidscoloring.tr
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kr.eumsoft.kidscoloring.data.ProjectEntity
import java.util.Calendar

private val ageLabels = listOf("모두", "3~5세", "6~7세", "8~10세")

@Composable
fun SectionTitle(text: String) = Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 6.dp))

@Composable
fun HomeScreen(vm: ColoringViewModel, speaker: Speaker, onOpen: (artworkId: String, projectId: Long?) -> Unit, onGallery: () -> Unit, onParent: () -> Unit) {
    val settings by vm.settings.collectAsState()
    val projects by vm.projects.collectAsState()
    val catalog = vm.repo.catalog
    val arts = catalog.artworks.filter { settings.ageFilter == 0 || it.difficulty == settings.ageFilter }
    val available = catalog.artworks.filter { it.available }
    val today = remember(available.size) { if (available.isEmpty()) null else available[Calendar.getInstance().get(Calendar.DAY_OF_YEAR) % available.size] }
    val ongoing = projects.filter { !it.completed && it.thumbnailPath.isNotEmpty() }
    var askGate by remember { mutableStateOf(false) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val card = if (maxWidth >= 600.dp) 168.dp else 124.dp
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(tr("이음 키즈 컬러링"), fontSize = 26.sp, fontWeight = FontWeight.Black, color = Color(0xFF1565C0))
                        Text(tr("오늘은 무엇을 색칠할까요?"), fontSize = 15.sp, color = Ink)
                    }
                    BigButton("🖼", tr("내 그림"), size = 68.dp, onClick = onGallery)
                    Spacer(Modifier.width(8.dp))
                    BigButton("🔒", tr("부모님"), size = 68.dp) { askGate = true }
                }
            }
            if (today != null) item {
                SectionTitle(tr("🌟 오늘의 추천 그림"))
                Row(
                    Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color(0xFFFFF8E1))
                        .border(3.dp, Sun, RoundedCornerShape(24.dp))
                        .clickable(role = Role.Button, onClickLabel = tr("오늘의 추천 그림 색칠하기")) { onOpen(today.id, null) }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ArtThumb(vm.repo, today, Modifier.size(card + 20.dp))
                    Column(Modifier.padding(start = 16.dp)) {
                        Text(tr(today.title), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Gap()
                        Text(tr("눌러서 색칠해요 🎨"), fontSize = 16.sp, color = Color(0xFF6D4C41))
                    }
                }
            }
            if (ongoing.isNotEmpty()) item {
                SectionTitle(tr("✏ 이어서 색칠하기"))
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ongoing, key = { it.projectId }) { p ->
                        Column(Modifier.width(card).clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClickLabel = tr("%1\$s 이어서 색칠하기", tr(p.name))) { onOpen(p.artworkId, p.projectId) }.padding(4.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            FileThumb(p.thumbnailPath, p.updatedAt, tr(p.name), Modifier.fillMaxWidth().border(2.dp, Berry, RoundedCornerShape(18.dp)))
                            Text(tr(p.name), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            for (cat in catalog.categories) {
                val list = arts.filter { it.category == cat.id }
                if (list.isNotEmpty()) item(key = cat.id) {
                    SectionTitle(tr(cat.title))
                    LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(list, key = { it.id }) { a ->
                            ArtCard(vm.repo, a, card) { if (settings.voiceGuide) speaker.say(tr(a.title)); onOpen(a.id, null) }
                        }
                    }
                }
            }
            if (arts.isEmpty()) item { Text(tr("이 나이에 맞는 그림이 없어요. 부모님 메뉴에서 '모두'를 골라 주세요."), Modifier.padding(24.dp)) }
        }
    }
    if (askGate) ParentGate(onPass = { askGate = false; onParent() }, onDismiss = { askGate = false })
}

@Composable
fun GalleryScreen(vm: ColoringViewModel, onBack: () -> Unit, onOpen: (artworkId: String, projectId: Long?) -> Unit) {
    val settings by vm.settings.collectAsState()
    val projects by vm.projects.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    var menuFor by remember { mutableStateOf<ProjectEntity?>(null) }
    var renameFor by remember { mutableStateOf<ProjectEntity?>(null) }
    var deleteFor by remember { mutableStateOf<ProjectEntity?>(null) }
    var gateFor by remember { mutableStateOf<ProjectEntity?>(null) }
    val list = projects.filter { it.thumbnailPath.isNotEmpty() && it.completed == (tab == 0) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("🏠", tr("홈"), onClick = onBack)
            Text(tr("나만의 작품"), fontSize = 22.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f).padding(start = 8.dp))
            BigButton("🏆", tr("완성한 그림"), selected = tab == 0) { tab = 0 }
            BigButton("✏", tr("색칠하는 중"), selected = tab == 1) { tab = 1 }
        }
        if (list.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(if (tab == 0) tr("아직 완성한 그림이 없어요") else tr("색칠하는 중인 그림이 없어요"), fontSize = 18.sp)
        } else LazyVerticalGrid(GridCells.Adaptive(150.dp), contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(list, key = { it.projectId }) { p ->
                Column(Modifier.clip(RoundedCornerShape(20.dp)).background(Color.White).padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    FileThumb(p.thumbnailPath, p.updatedAt, tr(p.name), Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = tr("%1\$s 열기", tr(p.name))) { onOpen(p.artworkId, p.projectId) })
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(tr(p.name), fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 6.dp))
                        TextButton(onClick = { menuFor = p }) { Text("⋯", fontSize = 22.sp) }
                    }
                }
            }
        }
    }
    menuFor?.let { p ->
        AlertDialog(onDismissRequest = { menuFor = null }, title = { Text(tr(p.name)) },
            text = {
                Column {
                    Button(onClick = { menuFor = null; onOpen(p.artworkId, p.projectId) }, modifier = Modifier.fillMaxWidth()) { Text(tr("🎨 이어서 색칠하기")) }
                    Gap()
                    Button(onClick = { menuFor = null; renameFor = p }, modifier = Modifier.fillMaxWidth()) { Text(tr("✏ 이름 바꾸기")) }
                    Gap()
                    Button(onClick = { menuFor = null; if (settings.parentalLockEnabled) gateFor = p else deleteFor = p }, modifier = Modifier.fillMaxWidth()) { Text(tr("🗑 지우기")) }
                    Gap()
                    Text(tr("사진으로 내보내기와 보내기는 그림을 연 뒤 '더보기'에서 할 수 있어요."), fontSize = 12.sp, color = Color.Gray)
                }
            }, confirmButton = {}, dismissButton = { TextButton(onClick = { menuFor = null }) { Text(tr("닫기")) } })
    }
    gateFor?.let { p -> ParentGate(onPass = { gateFor = null; deleteFor = p }, onDismiss = { gateFor = null }) }
    deleteFor?.let { p ->
        ConfirmDialog(tr("그림 지우기"), tr("'%1\$s' 그림을 지울까요? 되돌릴 수 없어요.", tr(p.name)), tr("지우기"), tr("아니요"), onYes = { vm.delete(p.projectId); deleteFor = null }, onNo = { deleteFor = null })
    }
    renameFor?.let { p ->
        var name by remember(p.projectId) { mutableStateOf(tr(p.name)) }
        AlertDialog(onDismissRequest = { renameFor = null }, title = { Text(tr("이름 바꾸기")) },
            text = { OutlinedTextField(name, { name = it.take(30) }, singleLine = true) },
            confirmButton = { Button(onClick = { if (name.isNotBlank()) vm.rename(p.projectId, name); renameFor = null }) { Text(tr("확인")) } },
            dismissButton = { TextButton(onClick = { renameFor = null }) { Text(tr("취소")) } })
    }
}

@Composable
private fun SettingRow(title: String, desc: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            if (desc.isNotEmpty()) Text(desc, fontSize = 13.sp, color = Color.Gray)
        }
        Switch(checked, onChange)
    }
}

@Composable
fun ParentScreen(vm: ColoringViewModel, version: String, onBack: () -> Unit, onPrivacy: () -> Unit) {
    val s by vm.settings.collectAsState()
    val catalog = vm.repo.catalog
    Column(Modifier.fillMaxSize().background(Color.White).verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            BigButton("🏠", tr("홈"), onClick = onBack)
            Text(tr("부모님 메뉴"), fontSize = 22.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(start = 12.dp))
        }
        SectionTitle(tr("나이에 맞는 그림"))
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ageLabels.forEachIndexed { i, l -> BigButton(if (i == 0) "🌈" else "★".repeat(i), tr(l), selected = s.ageFilter == i) { vm.updateSettings { it.copy(ageFilter = i) } } }
        }
        Text(tr("도안 30장을 영역 수에 따라 세 단계로 나눈 것이며, 나이별로 도안이 따로 있는 것은 아닙니다."), fontSize = 12.sp, color = Color.Gray, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        SectionTitle(tr("소리와 화면"))
        SettingRow(tr("효과음"), "", s.soundEnabled) { v -> vm.updateSettings { it.copy(soundEnabled = v) } }
        SettingRow(tr("진동"), "", s.vibrationEnabled) { v -> vm.updateSettings { it.copy(vibrationEnabled = v) } }
        SettingRow(tr("음성 안내"), tr("색 이름과 도구 이름을 읽어 줍니다. 기기에 이 언어의 음성(TTS)이 설치되어 있어야 합니다."), s.voiceGuide) { v -> vm.updateSettings { it.copy(voiceGuide = v) } }
        SettingRow(tr("애니메이션 줄이기"), tr("완성 축하 효과를 움직임 없이 보여 줍니다."), s.reduceMotion) { v -> vm.updateSettings { it.copy(reduceMotion = v) } }
        SettingRow(tr("색 이름 표시"), tr("색 아래에 이름을 글자로 보여 줍니다. (색각 다양성 지원)"), s.showColorNames) { v -> vm.updateSettings { it.copy(showColorNames = v) } }
        SectionTitle(tr("펜(스타일러스)"))
        SettingRow(tr("펜으로만 그리기"), tr("붓 도구에서 손가락은 화면 이동에만 쓰고, 펜으로만 그립니다."), s.fingerPansOnly) { v -> vm.updateSettings { it.copy(fingerPansOnly = v) } }
        SectionTitle(tr("보호"))
        SettingRow(tr("보호자 확인 잠금"), tr("사진 내보내기와 그림 지우기 전에 보호자 확인을 합니다. (앱 밖으로 보내기는 항상 확인합니다.)"), s.parentalLockEnabled) { v -> vm.updateSettings { it.copy(parentalLockEnabled = v) } }
        Text(tr("· 광고 없음 · 회원가입 없음 · 인터넷 사용 안 함\n· 카메라, 위치, 연락처 권한을 요청하지 않습니다."), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        TextButton(onClick = onPrivacy, modifier = Modifier.padding(horizontal = 8.dp)) { Text(tr("개인정보처리방침 보기")) }
        SectionTitle(tr("도안 정보"))
        val ok = catalog.artworks.count { it.available }
        Text(tr("등록된 도안: %1\$d / %2\$d장\n제작: Higgsfield (%3\$s)\n앱 버전: %4\$s", ok, catalog.artworks.size, catalog.artworks.firstOrNull()?.model ?: "", version),
            fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        Gap(24.dp)
    }
}

@Composable
fun PrivacyScreen(text: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.White)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            BigButton("⬅", tr("뒤로"), onClick = onBack)
            Text(tr("개인정보처리방침"), fontSize = 22.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(start = 12.dp))
        }
        Text(text, fontSize = 14.sp, modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp))
    }
}
