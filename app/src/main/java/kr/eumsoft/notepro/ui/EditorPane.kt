package kr.eumsoft.notepro.ui

import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoFixNormal
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Gesture
import androidx.compose.material.icons.filled.HighlightAlt
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.Geometry
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PenModel
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.PenPreset
import kr.eumsoft.notepro.data.VersionManager
import kr.eumsoft.notepro.ui.canvas.EraserMode
import kr.eumsoft.notepro.ui.canvas.NoteCanvasView
import kr.eumsoft.notepro.ui.canvas.Tool

val INK_COLORS = listOf(0xFF1F2A44, 0xFF000000, 0xFF1546B0, 0xFFC92A2A, 0xFF2B8A3E, 0xFFE67700, 0xFF7048E8, 0xFF868E96, 0xFFFFD43B, 0xFF63E6BE, 0xFFFFA8A8, 0xFFFFFFFF).map { it.toInt() }

@Composable
fun EditorPane(state: AppState, pane: PaneState, activity: MainActivity, modifier: Modifier) {
    val app = state.app
    val ctx = LocalContext.current
    val settings by app.settings.flow.collectAsState()
    val session = pane.session
    val focused = state.panes.getOrNull(state.focusedPane) === pane
    var menu by remember { mutableStateOf(false) }
    var penPanel by remember { mutableStateOf(false) }
    var eraserPanel by remember { mutableStateOf(false) }
    var pagePaper by remember { mutableStateOf(false) }
    var addPageTemplate by remember { mutableStateOf(false) }
    var versions by remember { mutableStateOf(false) }
    var deleted by remember { mutableStateOf<List<PageData>?>(null) }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var exportProgress by remember { mutableStateOf<String?>(null) }
    var exportRange by remember { mutableStateOf<IntRange?>(null) }
    var search by remember { mutableStateOf(false) }
    var bookmarks by remember { mutableStateOf(false) }
    var rangeDialog by remember { mutableStateOf(false) }
    var textEdit by remember { mutableStateOf<Triple<String, Pair<Float, Float>, kr.eumsoft.notepro.core.PageElement?>?>(null) }
    var aiMenu by remember { mutableStateOf(false) }
    val mergePdf = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val s = pane.session ?: return@rememberLauncherForActivityResult
        if (uri == null) return@rememberLauncherForActivityResult
        state.busy = ctx.getString(R.string.importing_pdf)
        Io.async({ app.pdf.appendPdf(uri, s.notebook.id) }) { r ->
            state.busy = null
            r.onSuccess { n -> s.reloadPagesFromDb { state.toast = ctx.getString(R.string.pages_added_n, n) } }
            r.onFailure { state.toast = ctx.getString(R.string.pdf_import_failed) }
        }
    }
    val addImages = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val s = pane.session ?: return@rememberLauncherForActivityResult
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        state.busy = ctx.getString(R.string.please_wait)
        Io.async({ app.pdf.importImages(uris, s.notebook.id, "", 0) }) { r ->
            state.busy = null
            if (r.isSuccess) s.reloadPagesFromDb { state.toast = ctx.getString(R.string.pages_added_n, uris.size) } else state.toast = ctx.getString(R.string.image_import_failed)
        }
    }

    val exportPdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val s = pane.session ?: return@rememberLauncherForActivityResult
        if (uri == null) return@rememberLauncherForActivityResult
        val range = exportRange
        exportRange = null
        val pages = if (range != null) s.pages.slice(range) else s.pages
        val strokes = pages.associate { it.id to s.strokesOf(it.id).toList() }
        val elements = pages.associate { it.id to s.elementsOf(it.id).toList() }
        exportProgress = "0 / ${pages.size}"
        // 내보내기는 별도 스레드(필기 저장을 막지 않도록)
        background({
            ctx.contentResolver.openOutputStream(uri, "w")!!.use { out ->
                app.pdf.export(pages, { strokes[it].orEmpty() }, out, { elements[it].orEmpty() }) { n -> Io.main.post { exportProgress = "$n / ${pages.size}" } }
            }
        }) { r ->
            exportProgress = null
            state.toast = if (r.isSuccess) ctx.getString(R.string.export_done) else ctx.getString(R.string.export_failed) + " " + r.exceptionOrNull()?.message
        }
    }
    val exportOriginal = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val s = pane.session ?: return@rememberLauncherForActivityResult
        val att = s.pages.firstOrNull { it.bgType == BackgroundType.PDF }?.attachmentId
        if (uri == null || att == null) return@rememberLauncherForActivityResult
        Io.async({ ctx.contentResolver.openOutputStream(uri, "w")!!.use { o -> app.pdf.originalFile(att).inputStream().use { it.copyTo(o) } } }) { r ->
            state.toast = ctx.getString(if (r.isSuccess) R.string.export_done else R.string.export_failed)
        }
    }

    Column(
        modifier.background(MaterialTheme.colorScheme.background)
            .border(if (focused && state.panes.size > 1) 2.dp else 0.dp, if (focused && state.panes.size > 1) MaterialTheme.colorScheme.primary else Color.Transparent)
            .pointerInput(pane.key) {
                awaitPointerEventScope { while (true) { awaitPointerEvent(PointerEventPass.Initial); state.focusedPane = state.panes.indexOf(pane).coerceAtLeast(0) } }
            },
    ) {
        // ---------- 상단 바 ----------
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ state.closePane(pane) }) {
                Icon(if (state.panes.size > 1) Icons.Default.Close else Icons.AutoMirrored.Filled.ArrowBack, stringResource(if (state.panes.size > 1) R.string.close_pane else R.string.back))
            }
            Text(session?.notebook?.title ?: "…", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
            session?.let { SaveChip(it) }
            val undo = session?.undoRedo?.collectAsState()?.value ?: (false to false)
            IconButton({ session?.undo() }, enabled = undo.first) { Icon(Icons.AutoMirrored.Filled.Undo, stringResource(R.string.undo)) }
            IconButton({ session?.redo() }, enabled = undo.second) { Icon(Icons.AutoMirrored.Filled.Redo, stringResource(R.string.redo)) }
            Box {
                IconButton({ menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    val s = session
                    val cur = pane.pageIndex
                    DropdownMenuItem({ Text(stringResource(R.string.add_page)) }, { menu = false; s?.addPage(cur); Io.main.postDelayed({ pane.view?.scrollToPage(cur + 1) }, 50) })
                    DropdownMenuItem({ Text(stringResource(R.string.add_page_template)) }, { menu = false; addPageTemplate = true })
                    DropdownMenuItem({ Text(stringResource(R.string.duplicate_page)) }, { menu = false; s?.duplicatePage(cur) })
                    DropdownMenuItem({ Text(stringResource(R.string.move_page_up)) }, { menu = false; s?.movePage(cur, cur - 1); pane.view?.scrollToPage(cur - 1) })
                    DropdownMenuItem({ Text(stringResource(R.string.move_page_down)) }, { menu = false; s?.movePage(cur, cur + 1); pane.view?.scrollToPage(cur + 1) })
                    DropdownMenuItem({ Text(stringResource(R.string.page_style)) }, { menu = false; pagePaper = true })
                    DropdownMenuItem({ Text(stringResource(R.string.delete_page)) }, {
                        menu = false
                        val p = s?.pages?.getOrNull(cur)
                        if (s != null && p != null) {
                            if (s.pages.size <= 1) state.toast = ctx.getString(R.string.cannot_delete_last_page)
                            else confirm = ctx.getString(R.string.delete_page_confirm) to { s.deletePage(p.id) }
                        }
                    })
                    DropdownMenuItem({ Text(stringResource(R.string.deleted_pages)) }, {
                        menu = false
                        val id = s?.notebook?.id ?: return@DropdownMenuItem
                        Io.async({ app.repo.pages(id, deleted = true) }) { deleted = it.getOrNull().orEmpty() }
                    })
                    HorizontalDivider()
                    DropdownMenuItem({ Text(stringResource(R.string.export_pdf)) }, { menu = false; exportPdf.launch((s?.notebook?.title ?: "note") + ".pdf") })
                    if (s != null && s.pages.any { it.bgType == BackgroundType.PDF })
                        DropdownMenuItem({ Text(stringResource(R.string.export_original_pdf)) }, { menu = false; exportOriginal.launch(s.notebook.title + "-original.pdf") })
                    DropdownMenuItem({ Text(stringResource(R.string.create_restore_point)) }, {
                        menu = false
                        val id = s?.notebook?.id ?: return@DropdownMenuItem
                        Io.flush(); app.versions.createAsync(id, VersionManager.REASON_MANUAL, settings.versionKeep) { state.toast = ctx.getString(R.string.restore_point_created) }
                    })
                    DropdownMenuItem({ Text(stringResource(R.string.versions)) }, { menu = false; versions = true })
                    HorizontalDivider()
                    DropdownMenuItem({ Text(stringResource(R.string.search_in_note)) }, { menu = false; search = true })
                    DropdownMenuItem({ Text(stringResource(if (s?.pages?.getOrNull(cur)?.bookmarked == true) R.string.remove_bookmark else R.string.add_bookmark)) }, {
                        menu = false; s?.let { ss -> ss.pages.getOrNull(cur)?.let { ss.toggleBookmark(it.id) } } })
                    DropdownMenuItem({ Text(stringResource(R.string.bookmarks)) }, { menu = false; bookmarks = true })
                    DropdownMenuItem({ Text(stringResource(R.string.rotate_page)) }, { menu = false; s?.let { ss -> ss.pages.getOrNull(cur)?.let { ss.rotatePage(it.id) } } })
                    DropdownMenuItem({ Text(stringResource(R.string.merge_pdf)) }, { menu = false; mergePdf.launch(arrayOf("application/pdf")) })
                    DropdownMenuItem({ Text(stringResource(R.string.add_image_pages)) }, { menu = false; addImages.launch(arrayOf("image/*")) })
                    DropdownMenuItem({ Text(stringResource(R.string.export_range)) }, { menu = false; rangeDialog = true })
                    DropdownMenuItem({ Text(stringResource(R.string.insert_signature)) }, {
                        menu = false
                        val sig = state.loadSignature()
                        if (sig.isEmpty()) state.toast = ctx.getString(R.string.no_signature) else pane.view?.paste(sig)
                    })
                    HorizontalDivider()
                    DropdownMenuItem({ Text(stringResource(R.string.ai_tools)) }, { menu = false; aiMenu = true })
                    HorizontalDivider()
                    DropdownMenuItem({ Text(stringResource(R.string.open_side)) }, { menu = false; state.closeAllToLibraryForPick(pane) })
                    if (state.panes.size > 1) DropdownMenuItem({ Text(stringResource(if (state.splitVertical) R.string.split_side_by_side else R.string.split_top_bottom)) }, {
                        menu = false; state.splitVertical = !state.splitVertical; state.saveWorkspace()
                    })
                    if (state.panes.size == 1 && s != null) DropdownMenuItem({ Text(stringResource(R.string.open_same_note_side)) }, { menu = false; state.open(s.notebook.id, newPane = true) })
                    DropdownMenuItem({ Text(stringResource(R.string.settings)) }, { menu = false; state.saveWorkspace(); state.screen = Screen.SETTINGS })
                }
            }
        }
        // ---------- 도구 모음 ----------
        if (session != null) ToolBar(state, pane, onPen = { penPanel = !penPanel; eraserPanel = false }, onEraser = { eraserPanel = !eraserPanel; penPanel = false })
        if (penPanel) PenPanel(state, pane) { penPanel = false }
        if (eraserPanel) EraserPanel(pane)
        if (pane.selection > 0) SelectionBar(state, pane)
        RecordingBar(state)

        // ---------- 캔버스 ----------
        Box(Modifier.fillMaxWidth().weight(1f)) {
            when {
                pane.failed -> Text(stringResource(R.string.open_failed), Modifier.align(Alignment.Center).padding(24.dp))
                session == null -> Text(stringResource(R.string.please_wait), Modifier.align(Alignment.Center))
                else -> {
                    val desk = MaterialTheme.colorScheme.surfaceVariant.toArgb()
                    AndroidView(
                        factory = { c ->
                            NoteCanvasView(c, app.pdf) { app.settings.value }.also { v ->
                                pane.view = v
                                v.listener = object : NoteCanvasView.Listener {
                                    override fun onTransformChanged(zoomPercent: Int, pageIndex: Int, pageCount: Int) {
                                        pane.zoom = zoomPercent; pane.pageIndex = pageIndex; pane.pageCount = pageCount
                                    }
                                    override fun onSelectionChanged(count: Int) { pane.selection = count; if (count > 0) pane.tool = Tool.LASSO }
                                    override fun onRequestUndo() { pane.session?.undo() }
                                    override fun onUserInteraction() { pane.lastTouch = System.currentTimeMillis() }
                                    override fun onStrokeTap(stroke: kr.eumsoft.notepro.core.Stroke) {
                                        val nb = session.notebook.id
                                        Io.async({ app.recorder.recordings(nb) }) { r ->
                                            if (r.getOrNull()?.let { app.recorder.playAt(it, stroke.createdAt) } != true) state.toast = ctx.getString(R.string.no_recording_for_stroke)
                                        }
                                    }
                                    override fun onTextTap(pageId: String, x: Float, y: Float, element: kr.eumsoft.notepro.core.PageElement?) {
                                        textEdit = Triple(pageId, x to y, element)
                                    }
                                }
                                v.bind(session, pane.lastView)
                                state.pendingJump?.let { pid -> state.pendingJump = null; val idx = session.pages.indexOfFirst { it.id == pid }; if (idx >= 0) v.post { v.scrollToPage(idx) } }
                            }
                        },
                        update = { v ->
                            if (v.tool != pane.tool) v.tool = pane.tool
                            v.pen = pane.pen
                            v.eraserMode = pane.eraserMode
                            v.eraserSize = pane.eraserSize
                            if (v.deskColor != desk) { v.deskColor = desk; v.requestRender() }
                        },
                        onRelease = { v -> pane.lastView = v.viewState(); v.release(); if (pane.view === v) pane.view = null },
                        modifier = Modifier.fillMaxSize(),
                    )
                    ZoomOverlay(pane, settings.zoomUiPinned, settings.zoomUiHideSec, settings.zoomLocked, settings.leftHanded,
                        onLock = { app.settings.update { it.copy(zoomLocked = !it.zoomLocked) } })
                }
            }
            exportProgress?.let {
                Surface(Modifier.align(Alignment.Center), shape = RoundedCornerShape(12.dp), tonalElevation = 6.dp) {
                    Text(stringResource(R.string.exporting) + " " + it, Modifier.padding(20.dp))
                }
            }
        }
    }

    if (addPageTemplate) PagePaperDialog(session?.pages?.getOrNull(pane.pageIndex), { addPageTemplate = false }) { paper, t ->
        addPageTemplate = false; val cur = pane.pageIndex; session?.addPage(cur, t, paper); Io.main.postDelayed({ pane.view?.scrollToPage(cur + 1) }, 50)
    }
    if (pagePaper) PagePaperDialog(session?.pages?.getOrNull(pane.pageIndex), { pagePaper = false }) { paper, t ->
        pagePaper = false; session?.let { s -> s.pages.getOrNull(pane.pageIndex)?.let { s.setPaper(it.id, paper, t) } }
    }
    if (versions && session != null) VersionsDialog(state, session.notebook.id) { versions = false }
    if (search && session != null) SearchDialog(state, session.notebook.id, { search = false }) { h -> search = false; pane.view?.scrollToPage(session.pages.indexOfFirst { it.id == h.pageId }.coerceAtLeast(0)) }
    if (bookmarks && session != null) BookmarksDialog(session.pages, { bookmarks = false }) { i -> bookmarks = false; pane.view?.scrollToPage(i) }
    if (rangeDialog && session != null) RangeDialog(session.pages.size, { rangeDialog = false }) { a, b ->
        rangeDialog = false; exportRange = a..b; exportPdf.launch(session.notebook.title + "-p${a + 1}-${b + 1}.pdf")
    }
    if (aiMenu && session != null) AiToolsDialog(state, pane, session) { aiMenu = false }
    textEdit?.let { (pageId, pos, el) ->
        TextElementDialog(el, onDismiss = { textEdit = null }, onDelete = { textEdit = null; el?.let { session?.commitElements(emptyList(), listOf(it.id)) } }) { text, size, color ->
            textEdit = null
            val s = session ?: return@TextElementDialog
            val page = s.pages.firstOrNull { it.id == pageId } ?: return@TextElementDialog
            val e = el?.copy(text = text, size = size, color = color, author = "user")
                ?: kr.eumsoft.notepro.core.PageElement(java.util.UUID.randomUUID().toString(), pageId, s.notebook.id, "text", pos.first, pos.second,
                    (page.width - pos.first - 24f).coerceIn(80f, 360f), text, color, size, "user", System.currentTimeMillis())
            s.commitElements(listOf(e), emptyList())
        }
    }
    deleted?.let { list ->
        DeletedPagesDialog(list, { deleted = null }) { p -> deleted = null; session?.let { s -> s.restorePage(p) { pane.view?.scrollToPage((s.pages.size - 1).coerceAtLeast(0)) } } }
    }
    confirm?.let { (m, a) -> ConfirmDialog(m, { confirm = null }) { confirm = null; a() } }
}

/** 저장 상태 표시: 기기에 저장됨 / 저장 중 / 저장 실패(재시도 중). 서버 동기화 상태는 2단계에서 별도 표시. */
@Composable
fun SaveChip(session: kr.eumsoft.notepro.data.NotebookSession) {
    val ctx = LocalContext.current
    val s by session.saveState.collectAsState()
    val (text, color) = when {
        s.error != null && s.pending > 0 -> stringResource(R.string.save_retrying) to MaterialTheme.colorScheme.error
        s.error != null -> stringResource(R.string.save_failed) to MaterialTheme.colorScheme.error
        s.pending > 0 -> stringResource(R.string.saving) to MaterialTheme.colorScheme.onSurfaceVariant
        else -> ctx.getString(R.string.saved_on_device, DateFormat.getTimeFormat(ctx).format(s.lastSavedAt)) to MaterialTheme.colorScheme.secondary
    }
    Text(text, color = color, style = MaterialTheme.typography.labelSmall, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp).widthIn(max = 150.dp))
}

@Composable
fun ToolButton(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit, tint: Color? = null) {
    val t = LocalTouch.current
    Box(
        Modifier.size(t).clip(RoundedCornerShape(10.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = tint ?: if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface) }
}

fun penIcon(p: PenType) = when (p) {
    PenType.BALLPOINT -> Icons.Default.Create
    PenType.FOUNTAIN -> Icons.Default.Edit
    PenType.PENCIL -> Icons.Default.Gesture
    PenType.HIGHLIGHTER -> Icons.Default.HighlightAlt
    PenType.BRUSH -> Icons.Default.Brush
}

@Composable
fun penLabel(p: PenType) = stringResource(when (p) {
    PenType.BALLPOINT -> R.string.pen_ballpoint; PenType.FOUNTAIN -> R.string.pen_fountain; PenType.PENCIL -> R.string.pen_pencil
    PenType.HIGHLIGHTER -> R.string.pen_highlighter; PenType.BRUSH -> R.string.pen_brush
})

@Composable
fun ToolBar(state: AppState, pane: PaneState, onPen: () -> Unit, onEraser: () -> Unit) {
    val app = state.app
    val presets = remember(state.presetsRev) { mutableStateOf(app.prefs.presets) }
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        ToolButton(penIcon(pane.pen.pen), penLabel(pane.pen.pen), pane.tool == Tool.PEN, { if (pane.tool == Tool.PEN) onPen() else pane.tool = Tool.PEN }, tint = Color(pane.pen.color).takeIf { pane.pen.color != 0xFFFFFFFF.toInt() })
        ToolButton(Icons.Default.AutoFixNormal, stringResource(R.string.eraser), pane.tool == Tool.ERASER, { if (pane.tool == Tool.ERASER) onEraser() else pane.tool = Tool.ERASER })
        ToolButton(Icons.Default.HighlightAlt, stringResource(R.string.lasso), pane.tool == Tool.LASSO, { pane.tool = Tool.LASSO })
        ToolButton(Icons.Default.TextFields, stringResource(R.string.text_tool), pane.tool == Tool.TEXT, { pane.tool = Tool.TEXT })
        RecordButtons(state, pane)
        Spacer(Modifier.width(6.dp))
        // 펜 프리셋(자주 쓰는 펜 고정)
        presets.value.forEach { pr ->
            val sel = pane.tool == Tool.PEN && pane.pen == pr
            Box(
                Modifier.size(LocalTouch.current).clip(CircleShape).clickable { pane.pen = pr; pane.tool = Tool.PEN; app.prefs.lastPen = pr }
                    .background(if (sel) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size((8 + pr.width.coerceAtMost(14f)).dp).clip(CircleShape).background(Color(pr.color).copy(alpha = pr.opacity)).border(1.dp, Color(0x33000000), CircleShape))
            }
        }
        Spacer(Modifier.width(6.dp))
        ToolButton(Icons.Default.ContentPaste, stringResource(R.string.paste), false, {
            if (app.strokeClipboard.isEmpty()) state.toast = app.getString(R.string.clipboard_empty) else pane.view?.paste(app.strokeClipboard)
        })
        if (state.panes.size < AppState.MAX_PANES) ToolButton(Icons.Default.ViewColumn, stringResource(R.string.open_side), false, { state.closeAllToLibraryForPick(pane) })
    }
}

@Composable
fun PenPanel(state: AppState, pane: PaneState, onClose: () -> Unit) {
    val app = state.app
    Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ChipRow {
                PenType.entries.forEach { p ->
                    ToolButton(penIcon(p), penLabel(p), pane.pen.pen == p, {
                        val w = if (p == PenType.HIGHLIGHTER) 14f else if (pane.pen.pen == PenType.HIGHLIGHTER) 2.4f else pane.pen.width
                        pane.pen = pane.pen.copy(pen = p, opacity = PenModel.defaultOpacity(p), width = w)
                        app.prefs.lastPen = pane.pen
                    })
                }
            }
            ColorRow(INK_COLORS, pane.pen.color) { pane.pen = pane.pen.copy(color = it); app.prefs.lastPen = pane.pen }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.thickness), Modifier.width(72.dp), style = MaterialTheme.typography.labelMedium)
                Slider(pane.pen.width, { pane.pen = pane.pen.copy(width = it) }, valueRange = 0.5f..30f, modifier = Modifier.weight(1f), onValueChangeFinished = { app.prefs.lastPen = pane.pen })
                Text("%.1f".format(pane.pen.width), Modifier.width(40.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.opacity), Modifier.width(72.dp), style = MaterialTheme.typography.labelMedium)
                Slider(pane.pen.opacity, { pane.pen = pane.pen.copy(opacity = it) }, valueRange = 0.1f..1f, modifier = Modifier.weight(1f), onValueChangeFinished = { app.prefs.lastPen = pane.pen })
                Text("${(pane.pen.opacity * 100).toInt()}%", Modifier.width(40.dp))
            }
            Row {
                TextButton({
                    val list = app.prefs.presets.toMutableList()
                    if (pane.pen !in list) { list.add(0, pane.pen); app.prefs.presets = list.take(8) }
                    state.presetsRev++
                    onClose()
                }) { Text(stringResource(R.string.save_preset)) }
                TextButton({
                    app.prefs.presets = app.prefs.presets.filter { it != pane.pen }
                    state.presetsRev++
                    onClose()
                }) { Text(stringResource(R.string.remove_preset)) }
                Spacer(Modifier.weight(1f))
                TextButton(onClose) { Text(stringResource(R.string.close)) }
            }
        }
    }
}

@Composable
fun EraserPanel(pane: PaneState) {
    Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            ChipRow {
                androidx.compose.material3.FilterChip(pane.eraserMode == EraserMode.STROKE, { pane.eraserMode = EraserMode.STROKE }, { Text(stringResource(R.string.eraser_stroke)) })
                androidx.compose.material3.FilterChip(pane.eraserMode == EraserMode.AREA, { pane.eraserMode = EraserMode.AREA }, { Text(stringResource(R.string.eraser_area)) })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.size), Modifier.width(72.dp), style = MaterialTheme.typography.labelMedium)
                Slider(pane.eraserSize, { pane.eraserSize = it }, valueRange = 3f..60f, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun SelectionBar(state: AppState, pane: PaneState) {
    val app = state.app
    var recolor by remember { mutableStateOf(false) }
    Surface(tonalElevation = 4.dp, color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.12f), modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(LocalContext.current.getString(R.string.selected_n, pane.selection), Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelLarge)
                ToolButton(Icons.Default.ContentCopy, stringResource(R.string.copy), false, {
                    app.strokeClipboard = pane.view?.copySelection().orEmpty(); state.toast = app.getString(R.string.copied)
                })
                ToolButton(Icons.Default.ContentCut, stringResource(R.string.cut), false, {
                    app.strokeClipboard = pane.view?.copySelection().orEmpty(); pane.view?.deleteSelection()
                })
                ToolButton(Icons.Default.Delete, stringResource(R.string.delete), false, { pane.view?.deleteSelection() })
                ToolButton(Icons.Default.ZoomIn, stringResource(R.string.enlarge), false, { pane.view?.transformSelection { b -> Geometry.Affine.scaleAbout(1.15f, (b.l + b.r) / 2, (b.t + b.b) / 2) } })
                ToolButton(Icons.Default.ZoomOut, stringResource(R.string.shrink), false, { pane.view?.transformSelection { b -> Geometry.Affine.scaleAbout(1 / 1.15f, (b.l + b.r) / 2, (b.t + b.b) / 2) } })
                ToolButton(Icons.Default.RotateRight, stringResource(R.string.rotate), false, { pane.view?.transformSelection { b -> Geometry.Affine.rotateAbout((Math.PI / 12).toFloat(), (b.l + b.r) / 2, (b.t + b.b) / 2) } })
                ToolButton(Icons.Default.Brush, stringResource(R.string.change_color), recolor, { recolor = !recolor })
                ToolButton(Icons.Default.Draw, stringResource(R.string.save_signature), false, {
                    state.saveSignature(pane.view?.copySelection().orEmpty()); state.toast = app.getString(R.string.signature_saved)
                })
                ToolButton(Icons.Default.Close, stringResource(R.string.deselect), false, { pane.view?.clearSelection() })
            }
            if (recolor) Box(Modifier.padding(8.dp)) { ColorRow(INK_COLORS, -1) { pane.view?.recolorSelection(it); recolor = false } }
        }
    }
}

/** 확대·축소 조절 UI: 고정 또는 자동 숨김, 확대 잠금 버튼, 페이지 번호. 왼손잡이 모드면 왼쪽에 둔다. */
@Composable
fun androidx.compose.foundation.layout.BoxScope.ZoomOverlay(pane: PaneState, pinned: Boolean, hideSec: Int, locked: Boolean, leftHanded: Boolean, onLock: () -> Unit) {
    var visible by remember { mutableStateOf(true) }
    LaunchedEffect(pane.lastTouch, pane.zoom, pinned) {
        visible = true
        if (!pinned) { delay(hideSec.coerceAtLeast(1) * 1000L); visible = false }
    }
    val align = if (leftHanded) Alignment.BottomStart else Alignment.BottomEnd
    if (visible) Surface(
        Modifier.align(align).padding(12.dp), shape = RoundedCornerShape(14.dp), tonalElevation = 6.dp, shadowElevation = 4.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
            IconButton({ pane.view?.zoomBy(1 / 1.25f) }, enabled = !locked) { Icon(Icons.Default.ZoomOut, stringResource(R.string.zoom_out)) }
            Text("${pane.zoom}%", Modifier.clickable { pane.view?.fitWidth() }.padding(4.dp), style = MaterialTheme.typography.labelLarge)
            IconButton({ pane.view?.zoomBy(1.25f) }, enabled = !locked) { Icon(Icons.Default.ZoomIn, stringResource(R.string.zoom_in)) }
            IconButton(onLock) { Icon(if (locked) Icons.Default.Lock else Icons.Default.LockOpen, stringResource(if (locked) R.string.zoom_unlock else R.string.zoom_lock)) }
            Text("${pane.pageIndex + 1} / ${pane.pageCount}", Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelLarge)
            IconButton({ pane.view?.let { v -> v.scrollToPage(v.currentPageIndex() + 1); if (v.currentPageIndex() + 1 >= pane.pageCount) pane.session?.addPage(v.currentPageIndex()) } }) {
                Icon(Icons.Default.Add, stringResource(R.string.next_page_or_add))
            }
        }
    }
}
