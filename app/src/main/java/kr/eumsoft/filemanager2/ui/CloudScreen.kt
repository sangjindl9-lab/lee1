@file:OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)

package kr.eumsoft.filemanager2.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.connect.CloudApi
import kr.eumsoft.filemanager2.connect.CloudConn
import kr.eumsoft.filemanager2.connect.CloudItem
import kr.eumsoft.filemanager2.connect.CloudProvider
import kr.eumsoft.filemanager2.connect.CloudTransfers
import kr.eumsoft.filemanager2.connect.ConnectState
import kr.eumsoft.filemanager2.connect.ShareInfo
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val PCOLOR = mapOf("gdrive" to Color(0xFF1FA463), "dropbox" to Color(0xFF0061FE), "onedrive" to Color(0xFF0078D4))

private fun human(n: Long): String {
    if (n < 0) return "-"
    if (n < 1024) return "$n B"
    val u = arrayOf("KB", "MB", "GB", "TB"); var v = n.toDouble(); var i = -1
    do { v /= 1024; i++ } while (v >= 1024 && i < u.size - 1)
    return String.format(Locale.US, if (v < 10) "%.1f %s" else "%.0f %s", v, u[i])
}

@Composable
fun CloudScreen(vm: AppVM) {
    val ctx = LocalContext.current
    LaunchedEffect(Unit) {
        ConnectState.load(ctx)
        CloudTransfers.onFinished = { t ->
            vm.toast(when (t.status) { "완료" -> (if (t.up) "올리기 완료: " else "받기 완료: ") + t.name; "실패" -> "실패: ${t.error}"; else -> "취소했습니다" })
        }
    }
    var open by remember { mutableStateOf<CloudConn?>(null) }
    val c = open
    if (ConnectState.email == null) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { SimpleTopBar("클라우드", { vm.pop() }) }) { pad ->
            Column(Modifier.padding(pad).fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                IconBadge(Icons.Rounded.Cloud, MaterialTheme.colorScheme.primary, 84.dp, round = true)
                Spacer(Modifier.height(16.dp))
                Text("클라우드를 쓰려면 먼저 로그인하세요", fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Spacer(Modifier.height(6.dp))
                Text("PC 연결과 같은 계정을 사용합니다. Google Drive·Dropbox의 비밀번호는 저장되지 않습니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(18.dp))
                Button(onClick = { vm.push(Dest.Connect) }, shape = RoundedCornerShape(14.dp)) { Text("로그인·회원가입") }
            }
        }
    } else if (c == null) CloudHome(vm) { open = it } else CloudBrowser(vm, c) { open = null }
}

// ---------------- 연결 목록 ----------------
@Composable
private fun CloudHome(vm: AppVM, onOpen: (CloudConn) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var conns by remember { mutableStateOf<List<CloudConn>>(emptyList()) }
    var provs by remember { mutableStateOf<List<CloudProvider>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var waiting by remember { mutableStateOf<String?>(null) }
    var showShares by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf<CloudConn?>(null) }
    var googleGuide by remember { mutableStateOf<CloudProvider?>(null) }
    fun startConnect(p: CloudProvider) {
        scope.launch {
            try {
                val url = CloudApi.startUrl(ctx, p.id)
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                waiting = p.id
            } catch (e: Exception) { vm.toast(e.message ?: "실패했습니다") }
        }
    }
    suspend fun reload() {
        try { conns = CloudApi.connections(ctx); provs = CloudApi.providers(ctx) } catch (e: Exception) { vm.toast(e.message ?: "불러오지 못했습니다") }
        loading = false
    }
    LaunchedEffect(Unit) { reload() }
    // 브라우저에서 승인하고 돌아오면 새 연결이 생길 때까지 확인
    LaunchedEffect(waiting) {
        val p = waiting ?: return@LaunchedEffect
        val before = conns.map { it.id }.toSet()
        repeat(100) {
            delay(3000)
            val now = runCatching { CloudApi.connections(ctx) }.getOrNull() ?: return@repeat
            if (now.any { it.provider == p && it.id !in before }) { conns = now; waiting = null; vm.toast("클라우드가 연결되었습니다"); return@LaunchedEffect }
        }
        waiting = null
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = {
        SimpleTopBar("클라우드", { vm.pop() }) { IconButton(onClick = { scope.launch { reload() } }) { Icon(Icons.Rounded.Refresh, "새로 고침") } }
    }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("연결된 클라우드", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(4.dp)) }
            if (loading) item { Loading() }
            if (!loading && conns.isEmpty()) item {
                Text("아직 연결된 클라우드가 없습니다. 아래에서 Google Drive 또는 Dropbox를 연결하세요.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(4.dp))
            }
            items(conns, key = { it.id }) { cn ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                    .combinedClickable(onClick = { onOpen(cn) }, onLongClick = { confirmOff = cn }).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.Cloud, PCOLOR[cn.provider] ?: MaterialTheme.colorScheme.primary, 46.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(cn.label, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        Text(cn.account, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    TextButton(onClick = { confirmOff = cn }) { Text("해제", color = MaterialTheme.colorScheme.error) }
                }
            }
            item { Text("연결 추가", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 12.dp)) }
            items(provs.filter { it.ready }, key = { "p" + it.id }) { p ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.Cloud, PCOLOR[p.id] ?: MaterialTheme.colorScheme.primary, 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(p.label, Modifier.weight(1f), fontWeight = FontWeight.Medium)
                    Button(enabled = waiting == null, shape = RoundedCornerShape(12.dp), onClick = {
                        if (p.id == "gdrive") googleGuide = p else startConnect(p)
                    }) { Text(if (waiting == p.id) "승인 대기…" else "연결") }
                }
            }
            item { GoogleWarningGuide() }
            item {
                Text("브라우저에서 로그인하고 권한을 허용한 뒤 이 화면으로 돌아오면 자동으로 연결됩니다.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(4.dp))
            }
            item {
                OutlinedButton(onClick = { showShares = true }, shape = RoundedCornerShape(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                    Icon(Icons.Rounded.Link, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("내 공유 링크")
                }
            }
            item { TransferList(vm) }
        }
    }
    confirmOff?.let { cn ->
        ConfirmDialog("${cn.label} 연결 해제", "${cn.account} 연결을 해제할까요? 이 클라우드 파일로 만든 공유 링크도 함께 해제됩니다. 클라우드의 파일은 지워지지 않습니다.", "해제",
            onDismiss = { confirmOff = null }, onConfirm = {
            confirmOff = null
            scope.launch { try { CloudApi.disconnect(ctx, cn.id); reload() } catch (e: Exception) { vm.toast(e.message ?: "실패") } }
        })
    }
    if (showShares) SharesSheet(vm) { showShares = false }
    googleGuide?.let { p ->
        AlertDialog(onDismissRequest = { googleGuide = null }, title = { Text("Google Drive 연결 안내") },
            text = { GoogleWarningSteps() },
            confirmButton = { TextButton(onClick = { googleGuide = null; startConnect(p) }) { Text("확인하고 계속") } },
            dismissButton = { TextButton(onClick = { googleGuide = null }) { Text("취소") } })
    }
}

@Composable
private fun GoogleWarningSteps() {
    Column {
        Text("현재 Google 앱 인증 심사 전이라 'Google에서 확인하지 않은 앱' 경고 화면이 나옵니다. 아래처럼 진행하면 됩니다.",
            style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(10.dp))
        listOf(
            "Google 계정을 선택합니다",
            "'Google에서 확인하지 않은 앱' 화면에서 왼쪽 아래 [고급]을 누릅니다",
            "아래에 나온 [파일관리자2(으)로 이동(안전하지 않음)]을 누릅니다",
            "권한 화면에서 [계속]을 누릅니다",
            "'연결되었습니다'가 나오면 파일관리자2로 돌아옵니다 (자동 연결)",
        ).forEachIndexed { i, t ->
            Row(Modifier.padding(vertical = 3.dp)) {
                Text("${i + 1}.", fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
                Text(t, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("비밀번호는 파일관리자2에 저장되지 않으며, 언제든 이 화면에서 연결을 해제할 수 있습니다.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun GoogleWarningGuide() {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0x33F59E0B)).clickable { open = !open }.padding(14.dp)) {
        Text("⚠ Google Drive 연결 시 '확인하지 않은 앱' 경고가 나오면", fontWeight = FontWeight.Bold)
        Text("[고급] → [파일관리자2(으)로 이동(안전하지 않음)] → [계속]" + if (open) "" else "  ·  자세히 보기",
            style = MaterialTheme.typography.bodySmall)
        if (open) { Spacer(Modifier.height(8.dp)); GoogleWarningSteps() }
    }
}

// ---------------- 탐색 ----------------
@Composable
private fun CloudBrowser(vm: AppVM, conn: CloudConn, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val root = if (conn.provider == "dropbox") "" else "root"
    var stack by remember { mutableStateOf(listOf(conn.label to root)) }
    var items by remember { mutableStateOf<List<CloudItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var err by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf<CloudItem?>(null) }
    var newFolder by remember { mutableStateOf(false) }
    var renameT by remember { mutableStateOf<CloudItem?>(null) }
    var deleteT by remember { mutableStateOf<CloudItem?>(null) }
    var shareT by remember { mutableStateOf<CloudItem?>(null) }
    val cur = stack.last().second
    suspend fun load() {
        loading = true; err = null
        try { items = CloudApi.list(ctx, conn.id, cur).sortedWith(compareBy<CloudItem>({ !it.dir }, { it.name.lowercase() })) } catch (e: Exception) { err = e.message; items = emptyList() }
        loading = false
    }
    LaunchedEffect(cur) { load() }
    LaunchedEffect(Unit) {
        CloudTransfers.onFinished = { t ->
            vm.toast(when (t.status) { "완료" -> (if (t.up) "올리기 완료: " else "받기 완료: ") + t.name; "실패" -> "실패: ${t.error}"; else -> "취소했습니다" })
            if (t.up && t.status == "완료") scope.launch { load() }
        }
    }
    BackHandler { if (stack.size > 1) stack = stack.dropLast(1) else onExit() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        uris.forEach { CloudTransfers.upload(ctx, conn.id, cur, it) }
        if (uris.isNotEmpty()) vm.toast("${uris.size}개 파일 올리기를 시작했습니다")
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = {
        SimpleTopBar(stack.last().first, { if (stack.size > 1) stack = stack.dropLast(1) else onExit() }) {
            IconButton(onClick = { newFolder = true }) { Icon(Icons.Rounded.CreateNewFolder, "새 폴더") }
            IconButton(onClick = { picker.launch("*/*") }) { Icon(Icons.Rounded.CloudUpload, "올리기") }
        }
    }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
            item {
                Text(stack.joinToString(" › ") { it.first }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (loading) item { Box(Modifier.fillMaxWidth().heightIn(min = 160.dp)) { Loading() } }
            err?.let { e -> item { Text(e, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(18.dp)) } }
            if (!loading && err == null && items.isEmpty()) item { Text("빈 폴더입니다. 오른쪽 위 올리기 버튼으로 휴대폰 파일을 보낼 수 있습니다.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(18.dp)) }
            items(items, key = { it.id }) { it2 ->
                Row(Modifier.fillMaxWidth().combinedClickable(
                    onClick = { if (it2.dir) stack = stack + (it2.name to it2.id) else menu = it2 },
                    onLongClick = { menu = it2 }).padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(if (it2.dir) Icons.Rounded.Folder else Icons.Rounded.Description, if (it2.dir) Color(0xFFF59E0B) else MaterialTheme.colorScheme.primary, 42.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(it2.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                        Text((if (it2.mtime > 0) SimpleDateFormat("yyyy.MM.dd HH:mm", Locale.KOREA).format(Date(it2.mtime)) + " · " else "") +
                            (if (it2.dir) "폴더" else if (it2.native) "Google 문서(받기 불가)" else human(it2.size)),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { Box(Modifier.padding(horizontal = 16.dp)) { TransferList(vm) } }
        }
    }

    menu?.let { m ->
        ModalBottomSheet(onDismissRequest = { menu = null }) {
            Column(Modifier.padding(bottom = 24.dp)) {
                Text(m.name, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp), maxLines = 2)
                HorizontalDivider()
                if (m.dir) SheetItem("열기") { menu = null; stack = stack + (m.name to m.id) }
                if (!m.dir && !m.native) SheetItem("휴대폰으로 받기 (Download/FileManager2)") { menu = null; CloudTransfers.download(ctx, conn.id, m); vm.toast("받기를 시작했습니다") }
                if (!m.dir && !m.native) SheetItem("공유 링크 만들기") { menu = null; shareT = m }
                SheetItem("이름 바꾸기") { menu = null; renameT = m }
                SheetItem("삭제", danger = true) { menu = null; deleteT = m }
            }
        }
    }
    if (newFolder) InputDialog("새 폴더", "", "만들기", onDismiss = { newFolder = false }) { n ->
        newFolder = false
        scope.launch { try { CloudApi.mkdir(ctx, conn.id, cur, n); load() } catch (e: Exception) { vm.toast(e.message ?: "실패") } }
    }
    renameT?.let { r ->
        InputDialog("이름 바꾸기", r.name, "바꾸기", selectBaseName = !r.dir, onDismiss = { renameT = null }) { n ->
            renameT = null
            scope.launch { try { CloudApi.rename(ctx, conn.id, r.id, n); load() } catch (e: Exception) { vm.toast(e.message ?: "실패") } }
        }
    }
    deleteT?.let { d ->
        ConfirmDialog("삭제", "'${d.name}'을(를) ${conn.label}에서 삭제할까요?" + if (conn.provider == "gdrive") " (Google Drive 휴지통으로 이동)" else "", "삭제", onDismiss = { deleteT = null }, onConfirm = {
            deleteT = null
            scope.launch { try { CloudApi.delete(ctx, conn.id, d.id); load(); vm.toast("삭제했습니다") } catch (e: Exception) { vm.toast(e.message ?: "실패") } }
        })
    }
    shareT?.let { s -> ShareDialog(vm, conn, s) { shareT = null } }
}

@Composable
private fun SheetItem(label: String, danger: Boolean = false, onClick: () -> Unit) {
    Text(label, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 22.dp, vertical = 15.dp), fontSize = 16.sp)
}

// ---------------- 전송 목록 ----------------
@Composable
private fun TransferList(vm: AppVM) {
    val ctx = LocalContext.current
    val list = CloudTransfers.items
    if (list.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("전송", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { CloudTransfers.clearFinished() }) { Text("끝난 항목 지우기") }
        }
        list.take(30).forEach { t ->
            Column(Modifier.fillMaxWidth().clickable(enabled = t.status == "완료" && t.savedPath != null) {
                t.savedPath?.let { vm.openExternal(ctx, File(it)) }
            }.padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text((if (t.up) "⬆ " else "⬇ ") + t.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (t.status == "진행" || t.status == "대기") TextButton(onClick = { t.cancel = true }) { Text("취소") }
                }
                val p = if (t.size > 0) (t.done.toFloat() / t.size).coerceIn(0f, 1f) else if (t.status == "완료") 1f else 0f
                LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth())
                Text(when (t.status) {
                    "진행" -> "${human(t.done)} / ${human(t.size)}"
                    "완료" -> if (t.up) "완료" else "완료 · 눌러서 열기 (Download/FileManager2)"
                    "실패" -> "실패: ${t.error}"
                    else -> t.status
                }, style = MaterialTheme.typography.bodySmall, color = if (t.status == "실패") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ---------------- 공유 링크 ----------------
@Composable
private fun ShareDialog(vm: AppVM, conn: CloudConn, item: CloudItem, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var hours by remember { mutableStateOf(72) }
    var pw by remember { mutableStateOf("") }
    var max by remember { mutableStateOf("") }
    var made by remember { mutableStateOf<ShareInfo?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("공유 링크") }, text = {
        Column {
            Text(item.name, fontWeight = FontWeight.Medium, maxLines = 2)
            Spacer(Modifier.height(8.dp))
            val m = made
            if (m == null) {
                Text("받는 사람은 로그인 없이 이 파일 하나만 받을 수 있습니다. 파일은 서버에 저장되지 않고 받을 때 ${conn.label}에서 바로 전달됩니다.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Text("유효 기간", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(1 to "1시간", 24 to "1일", 72 to "3일", 168 to "7일", 720 to "30일").forEach { (h, l) ->
                        FilterChip(selected = hours == h, onClick = { hours = h }, label = { Text(l, fontSize = 12.sp) })
                    }
                }
                OutlinedTextField(pw, { pw = it }, label = { Text("비밀번호 (선택, 4자 이상)") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(max, { max = it.filter(Char::isDigit) }, label = { Text("받기 횟수 제한 (선택)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            } else {
                Text(m.url, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(4.dp))
                Text(m.expiresAt.take(16).replace('T', ' ') + "까지" + (if (m.hasPassword) " · 비밀번호 필요(따로 알려 주세요)" else ""), style = MaterialTheme.typography.bodySmall)
            }
        }
    }, confirmButton = {
        val m = made
        if (m == null) TextButton(enabled = !busy && (pw.isEmpty() || pw.length >= 4), onClick = {
            busy = true
            scope.launch {
                try { made = CloudApi.share(ctx, conn.id, item.id, hours, pw.ifBlank { null }, max.toIntOrNull()) } catch (e: Exception) { vm.toast(e.message ?: "실패") }
                busy = false
            }
        }) { Text("링크 만들기") }
        else TextButton(onClick = {
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "${item.name}\n${m.url}"), "링크 보내기"))
        }) { Text("보내기") }
    }, dismissButton = {
        val m = made
        if (m != null) TextButton(onClick = {
            (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("공유 링크", m.url)); vm.toast("링크를 복사했습니다")
        }) { Text("복사") }
        TextButton(onClick = onDismiss) { Text("닫기") }
    })
}

@Composable
private fun SharesSheet(vm: AppVM, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<ShareInfo>?>(null) }
    suspend fun load() { list = runCatching { CloudApi.shares(ctx) }.getOrElse { vm.toast(it.message ?: "실패"); emptyList() } }
    LaunchedEffect(Unit) { load() }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 28.dp)) {
            Text("내 공유 링크", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(8.dp))
            val l = list
            if (l == null) Loading() else if (l.isEmpty()) Text("만든 공유 링크가 없습니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            l?.take(50)?.forEach { s ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                        Text((if (s.active) s.expiresAt.take(16).replace('T', ' ') + "까지" else "종료됨") + " · 받은 횟수 ${s.downloads}" + (s.maxDownloads?.let { "/$it" } ?: ""),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (s.active) {
                        TextButton(onClick = { (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("공유 링크", s.url)); vm.toast("복사했습니다") }) { Text("복사") }
                        TextButton(onClick = { scope.launch { runCatching { CloudApi.revokeShare(ctx, s.id) }; load() } }) { Text("해제", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}
