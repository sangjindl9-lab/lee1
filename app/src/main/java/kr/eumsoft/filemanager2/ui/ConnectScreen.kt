@file:OptIn(ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.connect.ApiException
import kr.eumsoft.filemanager2.connect.ConnectApi
import kr.eumsoft.filemanager2.connect.ConnectConfig
import kr.eumsoft.filemanager2.connect.ConnectService
import kr.eumsoft.filemanager2.connect.ConnectState
import kr.eumsoft.filemanager2.connect.DeviceInfo
import kr.eumsoft.filemanager2.connect.FolderPresets
import kr.eumsoft.filemanager2.connect.LogInfo
import kr.eumsoft.filemanager2.connect.PermInfo
import kr.eumsoft.filemanager2.connect.actionLabel

@Composable
fun ConnectScreen(vm: AppVM) {
    val ctx = LocalContext.current
    LaunchedEffect(Unit) { ConnectState.load(ctx) }
    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { SimpleTopBar("PC 연결", { vm.pop() }) }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (ConnectState.email == null) AuthPanel(vm) else ConnectedPanel(vm)
        }
    }
}

// ======================= 로그인 / 회원가입 =======================

@Composable
private fun AuthPanel(vm: AppVM) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var verifyFor by remember { mutableStateOf<String?>(null) }
    var resetStep by remember { mutableIntStateOf(0) } // 0=없음 1=코드요청됨
    var code by remember { mutableStateOf("") }

    fun run(block: suspend () -> Unit) {
        busy = true; err = null
        scope.launch {
            try { block() } catch (e: ApiException) { err = e.message } catch (e: Exception) { err = e.message ?: "오류가 발생했습니다" }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        IntroCard()
        Spacer(Modifier.height(18.dp))
        if (verifyFor != null) {
            Text("이메일 인증", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Text("${verifyFor}로 보낸 6자리 코드를 입력하세요.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            Field(code, { code = it }, "인증 코드", KeyboardType.Number)
            Spacer(Modifier.height(12.dp))
            Button(onClick = { run { ConnectApi.verify(ctx, verifyFor!!, code.trim()); ConnectApi.login(ctx, verifyFor!!, pw); verifyFor = null } },
                enabled = !busy && code.length == 6, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(14.dp)) { Text("인증하고 로그인") }
        } else {
            TabRow(selectedTabIndex = tab, containerColor = MaterialTheme.colorScheme.background) {
                Tab(tab == 0, { tab = 0; err = null; resetStep = 0 }, text = { Text("로그인") })
                Tab(tab == 1, { tab = 1; err = null; resetStep = 0 }, text = { Text("회원가입") })
            }
            Spacer(Modifier.height(14.dp))
            Field(email, { email = it.trim() }, "이메일", KeyboardType.Email)
            if (tab == 1) { Spacer(Modifier.height(10.dp)); Field(name, { name = it }, "이름 (선택)") }
            if (!(tab == 0 && resetStep == 1)) { Spacer(Modifier.height(10.dp)); Field(pw, { pw = it }, if (tab == 1) "비밀번호 (8자 이상)" else "비밀번호", KeyboardType.Password, password = true) }
            if (tab == 0 && resetStep == 1) {
                Spacer(Modifier.height(10.dp)); Field(code, { code = it }, "재설정 코드 (메일)", KeyboardType.Number)
                Spacer(Modifier.height(10.dp)); Field(pw, { pw = it }, "새 비밀번호 (8자 이상)", KeyboardType.Password, password = true)
            }
            Spacer(Modifier.height(14.dp))
            when {
                tab == 0 && resetStep == 1 -> Button(onClick = { run { ConnectApi.reset(ctx, email, code.trim(), pw); ConnectApi.login(ctx, email, pw); resetStep = 0 } },
                    enabled = !busy, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(14.dp)) { Text("비밀번호 바꾸고 로그인") }
                tab == 0 -> Button(onClick = { run { ConnectApi.login(ctx, email, pw) } }, enabled = !busy && email.isNotBlank() && pw.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(14.dp)) { Text("로그인") }
                else -> Button(onClick = {
                    run {
                        val needVerify = ConnectApi.register(ctx, email, pw, name)
                        if (needVerify) { verifyFor = email } else ConnectApi.login(ctx, email, pw)
                    }
                }, enabled = !busy && email.isNotBlank() && pw.length >= 8, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(14.dp)) { Text("가입하기") }
            }
            if (tab == 0 && resetStep == 0) TextButton(onClick = {
                if (email.isBlank()) err = "이메일을 먼저 입력하세요" else run { ConnectApi.forgot(ctx, email); resetStep = 1; vm.toast("재설정 코드를 메일로 보냈습니다") }
            }) { Text("비밀번호를 잊으셨나요?") }
        }
        if (busy) { Spacer(Modifier.height(12.dp)); CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally)) }
        err?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Text("가입하면 이용약관과 개인정보처리방침(${ConnectConfig.SERVER_URL.removePrefix("https://")}/privacy)에 동의하는 것으로 봅니다. 파일 내용은 서버에 저장되지 않습니다.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Field(v: String, on: (String) -> Unit, label: String, type: KeyboardType = KeyboardType.Text, password: Boolean = false) {
    OutlinedTextField(v, on, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        keyboardOptions = KeyboardOptions(keyboardType = type), visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None)
}

@Composable
private fun IntroCard() {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color(0xFF3730A3), Color(0xFF6366F1)))).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.PhoneAndroid, null, tint = Color.White); Spacer(Modifier.width(6.dp)); Text("⇄", color = Color.White, fontSize = 18.sp); Spacer(Modifier.width(6.dp)); Icon(Icons.Rounded.Computer, null, tint = Color.White)
        }
        Spacer(Modifier.height(10.dp))
        Text("PC에서도 휴대폰 파일을 관리할 수 있습니다.", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Spacer(Modifier.height(4.dp))
        Text("아래 주소에서 Windows 프로그램을 설치한 후 모바일과 동일한 계정으로 로그인하세요.", color = Color.White.copy(alpha = 0.9f), fontSize = 14.sp)
    }
}

// ======================= 로그인 후 =======================

@Composable
private fun ConnectedPanel(vm: AppVM) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var perms by remember { mutableStateOf<List<PermInfo>>(emptyList()) }
    var devices by remember { mutableStateOf<List<DeviceInfo>>(emptyList()) }
    var logs by remember { mutableStateOf<List<LogInfo>>(emptyList()) }
    var showLogs by remember { mutableStateOf(false) }
    var approveTarget by remember { mutableStateOf<PermInfo?>(null) }
    var codeDialog by remember { mutableStateOf(false) }
    var shownCode by remember { mutableStateOf<String?>(null) }
    var deleteDialog by remember { mutableStateOf(false) }
    var loadErr by remember { mutableStateOf<String?>(null) }

    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ConnectService.start(ctx) }
    fun turnOn() {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        else ConnectService.start(ctx)
    }
    suspend fun reload() {
        try {
            perms = ConnectApi.permissions(ctx)
            devices = ConnectApi.devices(ctx)
            ConnectState.pendingRequests.clear(); ConnectState.pendingRequests.addAll(perms.filter { it.status == "pending" })
            loadErr = null
        } catch (e: Exception) { loadErr = e.message }
    }
    fun act(block: suspend () -> Unit) = scope.launch {
        try { block(); reload() } catch (e: Exception) { vm.toast(e.message ?: "실패했습니다") }
    }
    LaunchedEffect(ConnectState.refreshTick, ConnectState.online) { reload() }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // ---- 상단: 계정·연결 상태 ----
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(if (ConnectState.online) Color(0xFF10B981) else if (ConnectState.enabled) Color(0xFFF59E0B) else Color(0xFF94A3B8)))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (ConnectState.enabled) "연결 켜짐" else "연결 꺼짐", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(if (ConnectState.enabled) ConnectState.statusText else "켜면 PC에서 이 휴대폰에 접속할 수 있습니다", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = ConnectState.enabled, onCheckedChange = { if (it) turnOn() else ConnectService.stop(ctx) })
                }
                Spacer(Modifier.height(8.dp))
                Text("로그인 계정: ${ConnectState.email}", style = MaterialTheme.typography.bodyMedium)
                ConnectState.lastActivity?.let { Text("최근 작업: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                loadErr?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        }
        // ---- 승인 대기 ----
        if (ConnectState.pendingRequests.isNotEmpty()) {
            item { SectionTitleSmall("승인 대기 중인 연결 요청") }
            ConnectState.pendingRequests.toList().forEach { p ->
                item(key = "pend" + p.id) {
                    Card(highlight = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.Computer, Coral, 42.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(p.pcName, fontWeight = FontWeight.Bold)
                                Text("이 PC가 휴대폰 파일에 접근하려고 합니다", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { approveTarget = p }, shape = RoundedCornerShape(12.dp)) { Text("승인하고 폴더 선택") }
                            OutlinedButton(onClick = { act { ConnectApi.reject(ctx, p.id) } }, shape = RoundedCornerShape(12.dp)) { Text("거절") }
                        }
                    }
                }
            }
        }
        // ---- 중앙: Windows 다운로드 안내 ----
        item { DownloadCard(vm) }
        // ---- 연결 코드 ----
        item {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.Key, IndigoLight, 40.dp); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("연결 코드로 연결", fontWeight = FontWeight.Bold)
                        Text("PC 프로그램에 6자리 코드를 입력하면 바로 연결됩니다 (5분 유효)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { codeDialog = true }, shape = RoundedCornerShape(12.dp)) { Text("연결 코드 만들기") }
            }
        }
        // ---- 하단: 연결된 PC ----
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitleSmall("연결된 PC", Modifier.weight(1f))
                IconButton(onClick = { act { } }) { Icon(Icons.Rounded.Refresh, "새로 고침") }
            }
        }
        val approved = perms.filter { it.status == "approved" }
        if (approved.isEmpty()) item { Text("아직 연결된 PC가 없습니다.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp)) }
        approved.forEach { p ->
            item(key = "pc" + p.id) {
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconBadge(Icons.Rounded.Computer, if (p.pcOnline) Color(0xFF10B981) else Color(0xFF94A3B8), 42.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.pcName, fontWeight = FontWeight.Bold)
                            Text((if (p.pcOnline) "접속 중" else "오프라인") + (if (p.readOnly) " · 읽기 전용" else " · 읽기·쓰기"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { act { ConnectApi.revoke(ctx, p.id) } }) { Text("연결 해제", color = MaterialTheme.colorScheme.error) }
                    }
                    Text("허용 폴더: " + p.folders.joinToString(", ") { FolderPresets.label(it) }, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { approveTarget = p }) { Text("접근 권한 바꾸기") }
                }
            }
        }
        // ---- 로그인 기기 ----
        item { SectionTitleSmall("로그인한 기기") }
        devices.forEach { d ->
            item(key = "dev" + d.id) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (d.kind == "pc") Icons.Rounded.Computer else Icons.Rounded.PhoneAndroid, null, tint = if (d.online) Color(0xFF10B981) else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(d.name + if (d.self) " (이 기기)" else "", fontWeight = FontWeight.Medium)
                        Text(if (d.online) "접속 중" else "마지막 접속 " + (d.lastSeen?.take(16)?.replace('T', ' ') ?: "-"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!d.self) TextButton(onClick = { act { ConnectApi.revokeDevice(ctx, d.id) } }) { Text("로그아웃") }
                }
            }
        }
        // ---- 연결 기록 ----
        item {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                showLogs = !showLogs
                if (showLogs) scope.launch { logs = runCatching { ConnectApi.logs(ctx) }.getOrDefault(emptyList()) }
            }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.History, null); Spacer(Modifier.width(8.dp))
                Text("연결 기록 " + if (showLogs) "접기" else "보기", fontWeight = FontWeight.Bold)
            }
        }
        if (showLogs) logs.take(50).forEachIndexed { i, l ->
            item(key = "log$i") {
                Column(Modifier.padding(horizontal = 6.dp)) {
                    Text("${actionLabel(l.action)}${l.deviceName?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium)
                    Text(l.at.take(19).replace('T', ' ') + if (l.detail.isNotBlank() && l.action.startsWith("remote")) " · ${l.detail}" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        // ---- 계정 ----
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { ConnectService.stop(ctx); scope.launch { ConnectApi.logout(ctx) } }, shape = RoundedCornerShape(12.dp)) {
                    Icon(Icons.Rounded.Logout, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("로그아웃")
                }
                TextButton(onClick = { deleteDialog = true }) { Text("계정 삭제", color = MaterialTheme.colorScheme.error) }
            }
        }
    }

    approveTarget?.let { p ->
        FolderDialog(title = "'${p.pcName}' 연결 승인", initial = p.folders, initialReadOnly = p.readOnly, confirm = "승인",
            onDismiss = { approveTarget = null }) { folders, ro ->
            approveTarget = null
            act { ConnectApi.approve(ctx, p.id, folders, ro); if (!ConnectState.enabled) turnOn() }
        }
    }
    if (codeDialog) FolderDialog(title = "연결 코드 만들기", initial = emptyList(), initialReadOnly = false, confirm = "코드 만들기", onDismiss = { codeDialog = false }) { folders, ro ->
        codeDialog = false
        scope.launch {
            try { shownCode = ConnectApi.pairCode(ctx, folders, ro); if (!ConnectState.enabled) turnOn() } catch (e: Exception) { vm.toast(e.message ?: "실패") }
        }
    }
    shownCode?.let { c -> CodeDialog(c) { shownCode = null; scope.launch { reload() } } }
    if (deleteDialog) DeleteAccountDialog(onDismiss = { deleteDialog = false }) { pw ->
        scope.launch {
            try { ConnectService.stop(ctx); ConnectApi.deleteAccount(ctx, pw); deleteDialog = false; vm.toast("계정을 삭제했습니다") } catch (e: Exception) { vm.toast(e.message ?: "실패") }
        }
    }
}

@Composable
private fun Card(highlight: Boolean = false, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
        .background(if (highlight) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer).padding(16.dp), content = content)
}

@Composable
private fun SectionTitleSmall(t: String, modifier: Modifier = Modifier) {
    Text(t, modifier = modifier.padding(top = 8.dp, start = 4.dp), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun DownloadCard(vm: AppVM) {
    val ctx = LocalContext.current
    val url = ConnectConfig.DOWNLOAD_URL
    val qr = remember(url) { qrBitmap(url, 480) }
    Card {
        Text("Windows 프로그램 설치", fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Spacer(Modifier.height(4.dp))
        Text("PC에서도 휴대폰 파일을 관리할 수 있습니다. 아래 주소에서 Windows 프로그램을 설치한 후 모바일과 동일한 계정으로 로그인하세요.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(qr.asImageBitmap(), "다운로드 주소 QR 코드", Modifier.size(120.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).padding(6.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(url.removePrefix("https://"), fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = {
                        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("다운로드 주소", url))
                        vm.toast("주소를 복사했습니다")
                    }, contentPadding = PaddingValues(horizontal = 10.dp)) { Icon(Icons.Rounded.ContentCopy, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("복사", fontSize = 13.sp) }
                    OutlinedButton(onClick = {
                        val i = Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_SUBJECT, "파일 관리자 2 PC 프로그램")
                            .putExtra(Intent.EXTRA_TEXT, "PC에서 이 주소를 열어 파일 관리자 2 Windows 프로그램을 설치하세요: $url")
                        ctx.startActivity(Intent.createChooser(i, "주소 보내기"))
                    }, contentPadding = PaddingValues(horizontal = 10.dp)) { Icon(Icons.Rounded.Share, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("공유", fontSize = 13.sp) }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("문자·이메일·메신저로 이 주소를 PC로 보내거나, PC 브라우저에 직접 입력하세요.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

fun qrBitmap(text: String, size: Int): Bitmap {
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
    for (x in 0 until size) for (y in 0 until size) bmp.setPixel(x, y, if (m.get(x, y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
    return bmp
}

@Composable
private fun FolderDialog(title: String, initial: List<String>, initialReadOnly: Boolean, confirm: String, onDismiss: () -> Unit, onConfirm: (List<String>, Boolean) -> Unit) {
    val presets = remember { FolderPresets.list() }
    var sel by remember { mutableStateOf(initial.toSet().ifEmpty { setOf(presets[0].second) }) }
    var ro by remember { mutableStateOf(initialReadOnly) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("PC에서 볼 수 있게 허용할 폴더를 고르세요. 선택하지 않은 폴더는 PC에서 보이지 않습니다.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                (presets + initial.filter { i -> presets.none { it.second == i } }.map { FolderPresets.label(it) to it }).forEach { (label, path) ->
                    Row(Modifier.fillMaxWidth().clickable { sel = if (path in sel) sel - path else sel + path }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(path in sel, { sel = if (it) sel + path else sel - path })
                        Column { Text(label); Text(path.removePrefix("/storage/emulated/0"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth().clickable { ro = !ro }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(ro, { ro = it })
                    Column { Text("읽기 전용"); Text("PC에서 받기만 가능 (올리기·삭제·이름 변경 금지)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(sel.toList(), ro) }, enabled = sel.isNotEmpty()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}

@Composable
private fun CodeDialog(code: String, onDismiss: () -> Unit) {
    var left by remember { mutableIntStateOf(300) }
    LaunchedEffect(code) { while (left > 0) { delay(1000); left-- } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("연결 코드") },
        text = {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(code.chunked(3).joinToString(" "), fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 4.sp, fontFamily = FontFamily.Monospace)
                Spacer(Modifier.height(8.dp))
                Text(if (left > 0) "PC 프로그램의 '코드로 연결'에 입력하세요\n${left / 60}:${"%02d".format(left % 60)} 남음" else "코드가 만료되었습니다", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )
}

@Composable
private fun DeleteAccountDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var pw by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("계정 삭제") },
        text = {
            Column {
                Text("계정과 등록된 기기, 연결·기록 정보가 모두 즉시 삭제됩니다. 휴대폰과 PC의 파일은 지워지지 않습니다.")
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(pw, { pw = it }, label = { Text("비밀번호 확인") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(pw) }, enabled = pw.isNotBlank()) { Text("삭제", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}
