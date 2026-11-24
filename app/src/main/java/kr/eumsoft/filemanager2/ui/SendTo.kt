package kr.eumsoft.filemanager2.ui

import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.AppVM
import kr.eumsoft.filemanager2.Dest
import kr.eumsoft.filemanager2.connect.CloudApi
import kr.eumsoft.filemanager2.connect.CloudConn
import kr.eumsoft.filemanager2.connect.CloudTransfers
import kr.eumsoft.filemanager2.connect.Nas
import kr.eumsoft.filemanager2.connect.NasProfile
import java.io.File

enum class SendKind { Cloud, Nas }

/** 보낼 곳 하나: 클라우드 계정 또는 NAS */
private data class Target(val label: String, val sub: String, val cloud: CloudConn? = null, val nas: NasProfile? = null)
private data class Folder(val name: String, val ref: String)

/**
 * 파일 목록에서 고른 파일을 클라우드(Google Drive·Dropbox) 또는 NAS로 보냅니다.
 * 보낼 곳 → 폴더를 고르면 전송 목록(클라우드·NAS 화면)에 올라가 화면을 나가도 계속 진행됩니다.
 */
@Composable
fun SendToDialog(vm: AppVM, kind: SendKind, items: List<File>, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val files = items.filter { it.isFile }
    val skippedDirs = items.count { it.isDirectory }
    var targets by remember { mutableStateOf<List<Target>?>(null) }
    var target by remember { mutableStateOf<Target?>(null) }
    var stack by remember { mutableStateOf(listOf<Folder>()) }
    var folders by remember { mutableStateOf<List<Folder>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(kind) {
        err = null
        targets = try {
            when (kind) {
                SendKind.Cloud -> CloudApi.connections(ctx).filter { it.ready }.map { Target(it.label, it.account, cloud = it) }
                SendKind.Nas -> Nas.profiles(ctx).map { Target(it.name, it.url.removePrefix("https://").removePrefix("http://"), nas = it) }
            }
        } catch (e: Exception) {
            err = if (kind == SendKind.Cloud) "클라우드 목록을 불러오지 못했습니다: ${e.message}\n(PC 연결 화면에서 로그인했는지 확인해 주세요)" else e.message
            emptyList()
        }
    }
    val cur = stack.lastOrNull()
    LaunchedEffect(target, cur) {
        val t = target ?: return@LaunchedEffect
        val c = cur ?: return@LaunchedEffect
        folders = null; err = null
        folders = try {
            withContext(Dispatchers.IO) {
                if (t.cloud != null) CloudApi.list(ctx, t.cloud.id, c.ref).filter { it.dir && !it.native }.map { Folder(it.name, it.id) }
                else Nas.list(ctx, t.nas!!, c.ref).filter { it.dir }.map { Folder(it.name, it.url) }
            }
        } catch (e: Exception) { err = e.message; emptyList() }
    }

    fun send() {
        val t = target ?: return; val dir = cur ?: return
        files.forEach { f ->
            val uri = Uri.fromFile(f)
            if (t.cloud != null) CloudTransfers.upload(ctx, t.cloud.id, dir.ref, uri)
            else CloudTransfers.startUpload(ctx, uri) { name, size, prog, cancel -> Nas.upload(ctx, t.nas!!, dir.ref, uri, name, size, prog, cancel) }
        }
        vm.toast("${files.size}개 파일을 ${t.label}(으)로 보내는 중입니다. 진행 상황은 ${if (kind == SendKind.Cloud) "클라우드" else "NAS"} 화면의 전송 목록에서 볼 수 있어요")
        onDismiss()
    }

    val title = if (kind == SendKind.Cloud) "클라우드로 보내기" else "NAS로 보내기"
    AlertDialog(onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (target != null) IconButton(onClick = { if (stack.size > 1) stack = stack.dropLast(1) else { target = null; stack = emptyList(); folders = null } }) { Icon(Icons.Rounded.ArrowBack, "뒤로") }
                Text(if (target == null) title else stack.joinToString(" / ") { it.name }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(buildString {
                    append(if (files.size == 1) files[0].name else "파일 ${files.size}개")
                    if (skippedDirs > 0) append(" · 폴더 ${skippedDirs}개는 제외됩니다(ZIP으로 압축한 뒤 보내 주세요)")
                }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                err?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                when {
                    target == null && targets == null -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(28.dp)) }
                    target == null && targets!!.isEmpty() && err == null -> {
                        Text(if (kind == SendKind.Cloud) "연결된 클라우드가 없습니다. 클라우드 화면에서 Google Drive나 Dropbox를 먼저 연결해 주세요." else "등록한 NAS가 없습니다. NAS 화면에서 먼저 추가해 주세요.")
                        TextButton(onClick = { onDismiss(); vm.push(if (kind == SendKind.Cloud) Dest.Cloud else Dest.Nas) }) { Text(if (kind == SendKind.Cloud) "클라우드 연결하러 가기" else "NAS 추가하러 가기") }
                    }
                    target == null -> LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        items(targets!!) { t ->
                            Row(Modifier.fillMaxWidth().clickable {
                                target = t
                                stack = listOf(Folder(t.label, t.cloud?.let { if (it.provider == "dropbox") "" else "root" } ?: t.nas!!.root))
                            }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (kind == SendKind.Cloud) Icons.Rounded.Cloud else Icons.Rounded.Storage, null, tint = MaterialTheme.colorScheme.primary)
                                Spacer(Modifier.width(12.dp))
                                Column { Text(t.label, fontWeight = FontWeight.SemiBold); Text(t.sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                    folders == null -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(28.dp)) }
                    else -> {
                        Text("보낼 폴더를 고른 뒤 '여기에 보내기'를 누르세요.", style = MaterialTheme.typography.bodySmall)
                        LazyColumn(Modifier.heightIn(max = 320.dp)) {
                            if (folders!!.isEmpty()) item { Text("하위 폴더 없음", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp)) }
                            items(folders!!) { f ->
                                Row(Modifier.fillMaxWidth().clickable { stack = stack + f }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Rounded.Folder, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp)); Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { if (target != null) TextButton(enabled = files.isNotEmpty() && folders != null && err == null, onClick = { send() }) { Text("여기에 보내기") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } })
}
