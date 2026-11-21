@file:OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)

package kr.eumsoft.filemanager2.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Slideshow
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.TableChart
import androidx.compose.material.icons.rounded.TextSnippet
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.data.FItem
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.FileType
import kr.eumsoft.filemanager2.data.FileTypes
import kr.eumsoft.filemanager2.data.fmtDate
import kr.eumsoft.filemanager2.data.fmtSize
import java.io.File

fun typeIcon(t: FileType): ImageVector = when (t) {
    FileType.FOLDER -> Icons.Rounded.Folder
    FileType.IMAGE -> Icons.Rounded.Image
    FileType.VIDEO -> Icons.Rounded.Movie
    FileType.AUDIO -> Icons.Rounded.MusicNote
    FileType.PDF -> Icons.Rounded.PictureAsPdf
    FileType.DOC -> Icons.Rounded.Description
    FileType.SHEET -> Icons.Rounded.TableChart
    FileType.SLIDE -> Icons.Rounded.Slideshow
    FileType.TEXT -> Icons.Rounded.TextSnippet
    FileType.CODE -> Icons.Rounded.Code
    FileType.ARCHIVE -> Icons.Rounded.Archive
    FileType.APK -> Icons.Rounded.Android
    FileType.OTHER -> Icons.Rounded.InsertDriveFile
}

@Composable
fun IconBadge(icon: ImageVector, color: Color, size: Dp = 44.dp, round: Boolean = false) {
    Box(
        Modifier
            .size(size)
            .clip(if (round) CircleShape else RoundedCornerShape(size * 0.3f))
            .background(color.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(size * 0.55f))
    }
}

@Composable
fun FileThumb(item: FItem, size: Dp) {
    val t = FileTypes.of(item)
    if (t == FileType.IMAGE || t == FileType.VIDEO) {
        Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(typeColor(t).copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(typeIcon(t), null, tint = typeColor(t), modifier = Modifier.size(size * 0.5f))
            AsyncImage(
                model = File(item.path),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (t == FileType.VIDEO) {
                Box(Modifier.align(Alignment.BottomEnd).padding(3.dp).size(size * 0.32f).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Movie, null, tint = Color.White, modifier = Modifier.size(size * 0.2f))
                }
            }
        }
    } else {
        IconBadge(typeIcon(t), typeColor(t), size)
    }
}

fun itemSubtitle(item: FItem): String =
    if (item.isDir) "${if (item.childCount >= 0) "${item.childCount}개 항목 · " else ""}${item.modified.fmtDate()}"
    else "${item.size.fmtSize()} · ${item.modified.fmtDate()}"

@Composable
fun FileRow(
    item: FItem,
    selected: Boolean,
    selectionMode: Boolean,
    favorite: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    subtitle: String = itemSubtitle(item),
) {
    val bg = if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            FileThumb(item, 46.dp)
            if (selected) {
                Icon(
                    Icons.Rounded.CheckCircle, null, tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.align(Alignment.BottomEnd).size(18.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
                    color = if (item.hidden) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (favorite) {
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Rounded.Star, null, tint = Coral, modifier = Modifier.size(15.dp))
                }
            }
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun FileCell(item: FItem, selected: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val border = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent
    Column(
        Modifier
            .padding(5.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer)
            .border(2.dp, border, RoundedCornerShape(18.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) {
            val t = FileTypes.of(item)
            if (t == FileType.IMAGE || t == FileType.VIDEO) {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp))) {
                    FileThumbFill(item)
                }
            } else IconBadge(typeIcon(t), typeColor(t), 56.dp)
        }
        Spacer(Modifier.height(6.dp))
        Text(item.name, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, lineHeight = 15.sp, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun FileThumbFill(item: FItem) {
    val t = FileTypes.of(item)
    Box(Modifier.fillMaxSize().background(typeColor(t).copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
        Icon(typeIcon(t), null, tint = typeColor(t), modifier = Modifier.size(32.dp))
        AsyncImage(model = File(item.path), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
fun EmptyState(icon: ImageVector, text: String) {
    Column(Modifier.fillMaxSize().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        IconBadge(icon, MaterialTheme.colorScheme.primary, 84.dp, round = true)
        Spacer(Modifier.height(16.dp))
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun BusyDialog(label: String) {
    Dialog(onDismissRequest = {}, properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Row(
            Modifier.clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
            Spacer(Modifier.width(18.dp))
            Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
fun InputDialog(
    title: String,
    initial: String,
    confirm: String = "확인",
    selectBaseName: Boolean = false,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val end = if (selectBaseName && initial.lastIndexOf('.') > 0) initial.lastIndexOf('.') else initial.length
    var value by remember { mutableStateOf(TextFieldValue(initial, TextRange(0, end))) }
    val fr = remember { FocusRequester() }
    val valid = value.text.isNotBlank() && !value.text.contains('/')
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value, onValueChange = { value = it }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth().focusRequester(fr),
                shape = RoundedCornerShape(14.dp),
            )
            LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onConfirm(value.text.trim()) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onDismiss: () -> Unit, onConfirm: () -> Unit, extra: (@Composable () -> Unit)? = null) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                Text(text)
                extra?.invoke()
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}

@Composable
fun PropertiesDialog(items: List<FItem>, onDismiss: () -> Unit) {
    var size by remember { mutableStateOf<Long?>(null) }
    var count by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(items) {
        withContext(Dispatchers.IO) {
            size = items.sumOf { FileOps.dirSize(it.file) }
            count = items.sumOf { if (it.isDir) FileOps.countFiles(it.file) else 1 }
        }
    }
    val single = items.singleOrNull()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (single != null) "속성" else "${items.size}개 항목 속성") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (single != null) {
                    Prop("이름", single.name)
                    Prop("위치", single.file.parent ?: "")
                    Prop("종류", if (single.isDir) "폴더" else (single.ext.uppercase().ifEmpty { "파일" }))
                    Prop("수정한 날짜", single.modified.fmtDate())
                }
                Prop("크기", size?.let { "${it.fmtSize()} (${"%,d".format(it)} 바이트)" } ?: "계산 중…")
                Prop("파일 수", count?.let { "%,d개".format(it) } ?: "계산 중…")
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } },
    )
}

@Composable
private fun Prop(k: String, v: String) {
    Column {
        Text(k, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(v, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 8.dp),
    )
}
