package kr.eumsoft.notepro.ui

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.core.FolderData
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperSize
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.data.VersionManager
import java.util.UUID

@Composable
fun paperLabel(p: PaperStyle) = stringResource(when (p) { PaperStyle.BLANK -> R.string.paper_blank; PaperStyle.LINED -> R.string.paper_lined; PaperStyle.GRID -> R.string.paper_grid; PaperStyle.DOT -> R.string.paper_dot })

@Composable
fun templateLabel(t: PageTemplate) = stringResource(when (t) { PageTemplate.NONE -> R.string.template_none; PageTemplate.MEETING -> R.string.template_meeting; PageTemplate.PLANNER -> R.string.template_planner; PageTemplate.STUDY -> R.string.template_study })

@Composable
fun ChipRow(content: @Composable () -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { content() }
}

@Composable
fun NewNotebookDialog(folderId: String?, onDismiss: () -> Unit, onCreate: (NotebookData, List<PageData>) -> Unit) {
    var title by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var size by remember { mutableStateOf(PaperSize.A4) }
    var landscape by remember { mutableStateOf(false) }
    var paper by remember { mutableStateOf(PaperStyle.LINED) }
    var template by remember { mutableStateOf(PageTemplate.NONE) }
    var infinite by remember { mutableStateOf(false) }
    var color by remember { mutableStateOf(COVER_COLORS.random()) }
    val untitled = stringResource(R.string.untitled)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.new_note)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.title)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(desc, { desc = it }, label = { Text(stringResource(R.string.description)) }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(tags, { tags = it }, label = { Text(stringResource(R.string.tags_hint)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.cover_color), style = MaterialTheme.typography.labelLarge)
                ColorRow(COVER_COLORS, color) { color = it }
                Text(stringResource(R.string.paper_size), style = MaterialTheme.typography.labelLarge)
                ChipRow { PaperSize.entries.forEach { s -> FilterChip(size == s, { size = s }, { Text(s.key) }) } }
                ChipRow {
                    FilterChip(!landscape, { landscape = false }, { Text(stringResource(R.string.portrait)) })
                    FilterChip(landscape, { landscape = true }, { Text(stringResource(R.string.landscape)) })
                    FilterChip(infinite, { infinite = !infinite }, { Text(stringResource(R.string.infinite_page)) })
                }
                Text(stringResource(R.string.paper_style), style = MaterialTheme.typography.labelLarge)
                ChipRow { PaperStyle.entries.forEach { p -> FilterChip(paper == p, { paper = p }, { Text(paperLabel(p)) }) } }
                Text(stringResource(R.string.template), style = MaterialTheme.typography.labelLarge)
                ChipRow { PageTemplate.entries.forEach { t -> FilterChip(template == t, { template = t }, { Text(templateLabel(t)) }) } }
            }
        },
        confirmButton = {
            TextButton({
                val now = System.currentTimeMillis()
                val id = UUID.randomUUID().toString()
                val w = if (landscape) size.h else size.w
                val h = if (landscape) size.w else size.h
                val nb = NotebookData(id, folderId, title.ifBlank { untitled }, desc, color, false, false, infinite, now, now, 0, false, tags.split(',', '#', ' ').map { it.trim() }.filter { it.isNotEmpty() })
                val page = PageData(UUID.randomUUID().toString(), id, 0, w, h, paper, template, createdAt = now, updatedAt = now)
                onCreate(nb, listOf(page))
            }) { Text(stringResource(R.string.create)) }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun ColorRow(colors: List<Int>, selected: Int, onPick: (Int) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        colors.forEach { c ->
            val sel = c == selected
            Spacer(
                Modifier.size(LocalTouch.current - 10.dp).clip(CircleShape).background(Color(c))
                    .border(if (sel) 3.dp else 1.dp, if (sel) MaterialTheme.colorScheme.primary else Color(0x33000000), CircleShape)
                    .clickable { onPick(c) },
            )
        }
    }
}

@Composable
fun EditNotebookDialog(nb: NotebookData, onDismiss: () -> Unit, onSave: (NotebookData) -> Unit) {
    var title by remember { mutableStateOf(nb.title) }
    var desc by remember { mutableStateOf(nb.description) }
    var tags by remember { mutableStateOf(nb.tags.joinToString(", ")) }
    var color by remember { mutableStateOf(nb.coverColor) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.edit_info)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.title)) }, singleLine = true)
                OutlinedTextField(desc, { desc = it }, label = { Text(stringResource(R.string.description)) })
                OutlinedTextField(tags, { tags = it }, label = { Text(stringResource(R.string.tags_hint)) }, singleLine = true)
                ColorRow(COVER_COLORS, color) { color = it }
            }
        },
        confirmButton = {
            TextButton({ onSave(nb.copy(title = title.ifBlank { nb.title }, description = desc, coverColor = color, tags = tags.split(',', '#').map { it.trim() }.filter { it.isNotEmpty() })) }) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun TextInputDialog(title: String, initial: String, onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var v by remember { mutableStateOf(initial) }
    AlertDialog(onDismiss, title = { Text(title) }, text = { OutlinedTextField(v, { v = it }, singleLine = true) },
        confirmButton = { TextButton({ onOk(v) }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun FolderPickerDialog(folders: List<FolderData>, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    fun path(f: FolderData): String {
        val names = ArrayList<String>(); var cur: FolderData? = f; var guard = 0
        while (cur != null && guard++ < 20) { names.add(0, cur.name); cur = folders.firstOrNull { it.id == cur?.parentId } }
        return names.joinToString(" / ")
    }
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.move_to_folder)) }, text = {
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
            item { Text(stringResource(R.string.top_level), Modifier.fillMaxWidth().clickable { onPick(null) }.padding(14.dp)) }
            items(folders.sortedBy { path(it) }) { f -> Text(path(f), Modifier.fillMaxWidth().clickable { onPick(f.id) }.padding(14.dp)) }
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun ConfirmDialog(message: String, onDismiss: () -> Unit, onOk: () -> Unit) {
    AlertDialog(onDismiss, text = { Text(message) },
        confirmButton = { TextButton(onOk) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun InfoDialog(message: String, onDismiss: () -> Unit) {
    AlertDialog(onDismiss, text = { Text(message, Modifier.verticalScroll(rememberScrollState())) }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.ok)) } })
}

@Composable
fun BackupPasswordDialog(isExport: Boolean, onDismiss: () -> Unit, onOk: (CharArray, Boolean) -> Unit) {
    var pw by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    var trash by remember { mutableStateOf(false) }
    val valid = if (isExport) pw.length >= 6 && pw == pw2 else pw.isNotEmpty()
    AlertDialog(onDismiss, title = { Text(stringResource(if (isExport) R.string.backup_create else R.string.backup_import)) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(if (isExport) R.string.backup_password_explain else R.string.backup_password_enter), style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(pw, { pw = it }, label = { Text(stringResource(R.string.password)) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            if (isExport) {
                OutlinedTextField(pw2, { pw2 = it }, label = { Text(stringResource(R.string.password_again)) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(trash, { trash = it }); Text(stringResource(R.string.include_trash)) }
            }
        }
    }, confirmButton = { TextButton({ onOk(pw.toCharArray(), trash) }, enabled = valid) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun versionReasonLabel(r: String) = stringResource(when (r) {
    VersionManager.REASON_AUTO -> R.string.version_auto
    VersionManager.REASON_CLOSE -> R.string.version_close
    VersionManager.REASON_MANUAL -> R.string.version_manual
    VersionManager.REASON_BEFORE_RESTORE -> R.string.version_before_restore
    else -> R.string.version_auto
})

/** 버전 기록: 미리보기(페이지·획 수, 시각) 확인 후 복원. 복원 전 현재 상태도 자동 보관. */
@Composable
fun VersionsDialog(state: AppState, nbId: String, onDismiss: () -> Unit) {
    val app = state.app
    val ctx = LocalContext.current
    var rows by remember { mutableStateOf<List<NoteRepository.VersionRow>?>(null) }
    var confirm by remember { mutableStateOf<NoteRepository.VersionRow?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(reload) { Io.async({ app.repo.versions(nbId) }) { rows = it.getOrNull().orEmpty() } }
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.versions)) }, text = {
        Column {
            TextButton({
                app.versions.createAsync(nbId, VersionManager.REASON_MANUAL, app.settings.value.versionKeep) { reload++ }
            }) { Text(stringResource(R.string.create_restore_point)) }
            HorizontalDivider()
            val list = rows
            if (list == null) Text(stringResource(R.string.please_wait))
            else if (list.isEmpty()) Text(stringResource(R.string.no_versions), Modifier.padding(12.dp))
            else LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(list, key = { it.id }) { v ->
                    Column(Modifier.fillMaxWidth().clickable { confirm = v }.padding(vertical = 10.dp, horizontal = 6.dp)) {
                        Text(DateFormat.getMediumDateFormat(ctx).format(v.createdAt) + " " + DateFormat.getTimeFormat(ctx).format(v.createdAt), style = MaterialTheme.typography.bodyLarge)
                        Text(versionReasonLabel(v.reason) + " · " + ctx.getString(R.string.version_counts, v.pages, v.strokes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.close)) } })
    confirm?.let { v ->
        ConfirmDialog(ctx.getString(R.string.restore_version_confirm), onDismiss = { confirm = null }) {
            confirm = null
            state.busy = ctx.getString(R.string.please_wait)
            Io.async({ app.versions.restore(nbId, v, app.settings.value.versionKeep) }) { r ->
                state.busy = null
                if (r.isSuccess) { app.sessions.reloadFromDb(nbId); state.toast = ctx.getString(R.string.restored); onDismiss() }
                else state.toast = ctx.getString(R.string.restore_failed) + " " + r.exceptionOrNull()?.message
            }
        }
    }
}

@Composable
fun PagePaperDialog(current: PageData?, onDismiss: () -> Unit, onPick: (PaperStyle, PageTemplate) -> Unit) {
    var paper by remember { mutableStateOf(current?.paper ?: PaperStyle.LINED) }
    var template by remember { mutableStateOf(current?.template ?: PageTemplate.NONE) }
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.page_style)) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.paper_style), style = MaterialTheme.typography.labelLarge)
            ChipRow { PaperStyle.entries.forEach { p -> FilterChip(paper == p, { paper = p }, { Text(paperLabel(p)) }) } }
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.template), style = MaterialTheme.typography.labelLarge)
            ChipRow { PageTemplate.entries.forEach { t -> FilterChip(template == t, { template = t }, { Text(templateLabel(t)) }) } }
        }
    }, confirmButton = { TextButton({ onPick(paper, template) }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun DeletedPagesDialog(pages: List<PageData>, onDismiss: () -> Unit, onRestore: (PageData) -> Unit) {
    val ctx = LocalContext.current
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.deleted_pages)) }, text = {
        if (pages.isEmpty()) Text(stringResource(R.string.no_deleted_pages))
        else LazyColumn(Modifier.heightIn(max = 360.dp)) {
            items(pages, key = { it.id }) { p ->
                Text(ctx.getString(R.string.page_n, p.index + 1) + " · " + DateFormat.getTimeFormat(ctx).format(p.updatedAt),
                    Modifier.fillMaxWidth().clickable { onRestore(p) }.padding(14.dp))
            }
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.close)) } })
}
