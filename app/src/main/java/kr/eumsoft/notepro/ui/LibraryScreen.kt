package kr.eumsoft.notepro.ui

import android.net.Uri
import android.text.format.DateFormat
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.pdf.PdfStore

val COVER_COLORS = listOf(0xFFE8613C, 0xFF2C6E7F, 0xFF1F2A44, 0xFF6A994E, 0xFFB5838D, 0xFFF2C14E, 0xFF5E548E, 0xFF8D6E63).map { it.toInt() }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun LibraryScreen(state: AppState, activity: MainActivity) {
    val app = state.app
    val ctx = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var newNote by remember { mutableStateOf(false) }
    var newFolder by remember { mutableStateOf(false) }
    var cardMenu by remember { mutableStateOf<NotebookData?>(null) }
    var edit by remember { mutableStateOf<NotebookData?>(null) }
    var move by remember { mutableStateOf<NotebookData?>(null) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var versionsOf by remember { mutableStateOf<NotebookData?>(null) }
    var passwordFor by remember { mutableStateOf<Pair<Uri, Boolean>?>(null) } // (uri, isExport)
    var info by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.filter, state.folderId, state.query) { state.refreshLibrary() }
    androidx.activity.compose.BackHandler(enabled = state.pickForSide || state.panes.isNotEmpty()) { state.pickForSide = false; state.screen = Screen.WORKSPACE }

    val str = { id: Int -> ctx.getString(id) }

    val pdfPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        state.busy = str(R.string.importing_pdf)
        Io.async({ app.pdf.importPdf(uri, null, COVER_COLORS.random()) }) { r ->
            state.busy = null
            r.onSuccess { id -> state.open(id, newPane = false) }
            r.onFailure { e ->
                state.toast = when ((e as? PdfStore.UnsupportedPdf)?.message) {
                    "password" -> str(R.string.pdf_password_protected)
                    else -> str(R.string.pdf_import_failed) + " (" + (e.message ?: e.javaClass.simpleName) + ")"
                }
            }
        }
    }
    val backupCreate = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) passwordFor = uri to true
    }
    val backupOpen = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) passwordFor = uri to false
    }

    fun openNb(nb: NotebookData, split: Boolean) {
        if (nb.deleted) return
        if (nb.locked) activity.authenticate { state.open(nb.id, split) } else state.open(nb.id, split)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (state.pickForSide) R.string.pick_note_for_side else R.string.app_name), fontWeight = FontWeight.Bold) },
                actions = {
                    SyncBadge(state)
                    IconButton({ pdfPicker.launch(arrayOf("application/pdf")) }) { Icon(Icons.Default.Add, stringResource(R.string.import_pdf)) }
                    IconButton({ menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.more)) }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem({ Text(stringResource(R.string.import_pdf)) }, { menu = false; pdfPicker.launch(arrayOf("application/pdf")) })
                        DropdownMenuItem({ Text(stringResource(R.string.backup_create)) }, { menu = false; backupCreate.launch("NotePro-" + DateFormat.format("yyyyMMdd-HHmm", System.currentTimeMillis()) + ".npbak") })
                        DropdownMenuItem({ Text(stringResource(R.string.backup_import)) }, { menu = false; backupOpen.launch(arrayOf("*/*")) })
                        DropdownMenuItem({ Text(stringResource(R.string.integrity_check)) }, {
                            menu = false; state.busy = str(R.string.checking)
                            Io.async({ app.repo.integrityCheck() to app.repo.pendingSyncOps() }) { r ->
                                state.busy = null
                                val (problems, pending) = r.getOrNull() ?: (listOf(r.exceptionOrNull().toString()) to 0)
                                info = if (problems.isEmpty()) str(R.string.integrity_ok) + "\n" + ctx.getString(R.string.local_changes_count, pending)
                                else str(R.string.integrity_problems) + "\n" + problems.take(20).joinToString("\n")
                            }
                        })
                        DropdownMenuItem({ Text(stringResource(R.string.account_sync)) }, { menu = false; state.screen = Screen.ACCOUNT })
                        DropdownMenuItem({ Text(stringResource(R.string.settings)) }, { menu = false; state.screen = Screen.SETTINGS })
                    }
                },
            )
        },
        floatingActionButton = {
            if (state.filter != NoteRepository.Filter.TRASH) ExtendedFloatingActionButton(
                onClick = { newNote = true }, icon = { Icon(Icons.Default.Add, null) }, text = { Text(stringResource(R.string.new_note)) },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            OutlinedTextField(
                value = state.query, onValueChange = { state.query = it }, singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                placeholder = { Text(stringResource(R.string.search_hint)) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    NoteRepository.Filter.ALL to R.string.filter_all, NoteRepository.Filter.FAVORITES to R.string.filter_favorites,
                    NoteRepository.Filter.RECENT to R.string.filter_recent, NoteRepository.Filter.TRASH to R.string.filter_trash,
                ).forEach { (f, label) ->
                    FilterChip(selected = state.filter == f, onClick = { state.filter = f; if (f != NoteRepository.Filter.ALL) state.folderId = null }, label = { Text(stringResource(label)) })
                }
            }
            if (state.filter == NoteRepository.Filter.ALL && state.query.isBlank()) {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (state.folderId != null) {
                        val cur = state.folders.firstOrNull { it.id == state.folderId }
                        AssistChip(onClick = { state.folderId = cur?.parentId }, label = { Text("‹ " + (state.folders.firstOrNull { it.id == cur?.parentId }?.name ?: stringResource(R.string.top_level))) })
                        Text(cur?.name ?: "", fontWeight = FontWeight.Bold)
                    }
                    state.folders.filter { it.parentId == state.folderId }.forEach { f ->
                        var fm by remember(f.id) { mutableStateOf(false) }
                        Box {
                            Row(
                                Modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
                                    .combinedClickable(onClick = { state.folderId = f.id }, onLongClick = { fm = true })
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) { Icon(Icons.Default.Folder, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(f.name) }
                            DropdownMenu(fm, { fm = false }) {
                                DropdownMenuItem({ Text(stringResource(R.string.delete_folder)) }, {
                                    fm = false
                                    confirm = str(R.string.delete_folder_confirm) to { Io.async({ app.repo.deleteFolder(f.id) }) { state.refreshLibrary() } }
                                })
                            }
                        }
                    }
                    IconButton({ newFolder = true }) { Icon(Icons.Default.CreateNewFolder, stringResource(R.string.new_folder)) }
                }
            }
            if (state.notebooks.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(stringResource(if (state.filter == NoteRepository.Filter.TRASH) R.string.trash_empty else R.string.no_notes), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(32.dp))
                }
            } else LazyVerticalGrid(GridCells.Adaptive(150.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                items(state.notebooks, key = { it.id }) { nb ->
                    Box {
                        NotebookCard(nb, onClick = { if (nb.deleted) cardMenu = nb else openNb(nb, false) }, onLong = { cardMenu = nb })
                        DropdownMenu(cardMenu?.id == nb.id, { cardMenu = null }) {
                            if (nb.deleted) {
                                DropdownMenuItem({ Text(stringResource(R.string.restore)) }, { cardMenu = null; Io.async({ app.repo.restoreFromTrash(nb.id) }) { state.refreshLibrary() } })
                                DropdownMenuItem({ Text(stringResource(R.string.delete_forever)) }, {
                                    cardMenu = null
                                    confirm = str(R.string.delete_forever_confirm) to { Io.async({ app.repo.purge(nb.id, app.files) }) { state.refreshLibrary() } }
                                })
                            } else {
                                DropdownMenuItem({ Text(stringResource(R.string.open)) }, { cardMenu = null; openNb(nb, false) })
                                DropdownMenuItem({ Text(stringResource(R.string.open_side)) }, { cardMenu = null; openNb(nb, true) })
                                DropdownMenuItem({ Text(stringResource(R.string.edit_info)) }, { cardMenu = null; edit = nb })
                                DropdownMenuItem({ Text(stringResource(if (nb.favorite) R.string.unfavorite else R.string.favorite)) }, {
                                    cardMenu = null; Io.async({ app.repo.updateNotebookMeta(nb.copy(favorite = !nb.favorite)) }) { state.refreshLibrary() }
                                })
                                DropdownMenuItem({ Text(stringResource(R.string.duplicate)) }, {
                                    cardMenu = null; state.busy = str(R.string.please_wait)
                                    Io.async({ app.repo.duplicate(nb.id, nb.title + " " + str(R.string.copy_suffix), app.files) }) { state.busy = null; state.refreshLibrary() }
                                })
                                DropdownMenuItem({ Text(stringResource(R.string.move_to_folder)) }, { cardMenu = null; move = nb })
                                DropdownMenuItem({ Text(stringResource(if (nb.locked) R.string.unlock else R.string.lock)) }, {
                                    cardMenu = null
                                    if (!nb.locked && !activity.canLock()) state.toast = str(R.string.lock_needs_screen_lock)
                                    else activity.authenticate { Io.async({ app.repo.updateNotebookMeta(nb.copy(locked = !nb.locked)) }) { state.refreshLibrary() } }
                                })
                                DropdownMenuItem({ Text(stringResource(R.string.versions)) }, { cardMenu = null; versionsOf = nb })
                                DropdownMenuItem({ Text(stringResource(R.string.storage_info)) }, {
                                    cardMenu = null
                                    Io.async({ app.repo.storageBytes(nb.id, app.files) }) { r -> info = ctx.getString(R.string.storage_used, Formatter.formatFileSize(ctx, r.getOrDefault(0L))) }
                                })
                                DropdownMenuItem({ Text(stringResource(R.string.move_to_trash)) }, {
                                    cardMenu = null
                                    val run = { Io.async({ app.repo.moveToTrash(nb.id) }) { state.refreshLibrary() } }
                                    if (app.settings.value.confirmDelete) confirm = str(R.string.move_to_trash_confirm) to { run() } else run()
                                })
                            }
                        }
                    }
                }
            }
        }
    }

    if (newNote) NewNotebookDialog(state.folderId, onDismiss = { newNote = false }) { nb, pages ->
        newNote = false
        Io.async({ app.repo.createNotebook(nb, pages) }) { r ->
            if (r.isSuccess) state.open(nb.id, newPane = false) else state.toast = r.exceptionOrNull()?.message
        }
    }
    if (newFolder) TextInputDialog(stringResource(R.string.new_folder), "", onDismiss = { newFolder = false }) { name ->
        newFolder = false
        if (name.isNotBlank()) Io.async({ app.repo.createFolder(name.trim(), state.folderId) }) { state.refreshLibrary() }
    }
    edit?.let { nb ->
        EditNotebookDialog(nb, onDismiss = { edit = null }) { updated ->
            edit = null; Io.async({ app.repo.updateNotebookMeta(updated) }) { state.refreshLibrary() }
        }
    }
    move?.let { nb ->
        FolderPickerDialog(state.folders, onDismiss = { move = null }) { folderId ->
            move = null; Io.async({ app.repo.updateNotebookMeta(nb.copy(folderId = folderId)) }) { state.refreshLibrary() }
        }
    }
    confirm?.let { (msg, action) -> ConfirmDialog(msg, onDismiss = { confirm = null }) { confirm = null; action() } }
    versionsOf?.let { nb -> VersionsDialog(state, nb.id, onDismiss = { versionsOf = null }) }
    info?.let { InfoDialog(it) { info = null } }
    passwordFor?.let { (uri, isExport) ->
        BackupPasswordDialog(isExport, onDismiss = { passwordFor = null }) { pw, includeTrash ->
            passwordFor = null
            state.busy = str(if (isExport) R.string.backup_creating else R.string.backup_importing)
            Io.async({
                if (isExport) app.backup.export(uri, pw, includeTrash) else app.backup.import(uri, pw, " " + str(R.string.restored_suffix))
            }) { r ->
                state.busy = null
                java.util.Arrays.fill(pw, ' ')
                r.onSuccess { res ->
                    if (isExport) app.prefs.lastBackupAt = System.currentTimeMillis()
                    info = ctx.getString(if (isExport) R.string.backup_done else R.string.import_done, res.notebooks, res.attachments, Formatter.formatFileSize(ctx, res.bytes))
                    state.refreshLibrary()
                }
                r.onFailure { e ->
                    info = when (e) {
                        is kr.eumsoft.notepro.core.BackupCrypto.WrongPasswordOrDamaged -> str(R.string.backup_wrong_password)
                        is kr.eumsoft.notepro.core.CorruptDataException -> str(R.string.backup_damaged) + " (" + e.message + ")"
                        else -> str(R.string.backup_failed) + " (" + (e.message ?: e.javaClass.simpleName) + ")"
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NotebookCard(nb: NotebookData, onClick: () -> Unit, onLong: () -> Unit) {
    val ctx = LocalContext.current
    Column(Modifier.combinedClickable(onClick = onClick, onLongClick = onLong).semantics { contentDescription = nb.title }) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(0.74f).clip(RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 14.dp, bottomEnd = 14.dp))
                .background(Color(nb.coverColor)),
        ) {
            Box(Modifier.width(10.dp).fillMaxSize().background(Color.Black.copy(alpha = 0.12f)))
            Column(Modifier.align(Alignment.TopStart).padding(start = 20.dp, top = 18.dp, end = 10.dp)) {
                Text(nb.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            }
            Row(Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
                if (nb.favorite) Icon(Icons.Default.Star, stringResource(R.string.favorite), tint = Color(0xFFFFE08A))
                if (nb.locked) Icon(Icons.Default.Lock, stringResource(R.string.lock), tint = Color.White)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(nb.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Text(DateFormat.getMediumDateFormat(ctx).format(nb.updatedAt) + " " + DateFormat.getTimeFormat(ctx).format(nb.updatedAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (nb.tags.isNotEmpty()) Text(nb.tags.joinToString(" ") { "#$it" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary, maxLines = 1)
    }
}
