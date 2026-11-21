package kr.eumsoft.notepro.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kr.eumsoft.notepro.NoteProApp
import kr.eumsoft.notepro.core.FolderData
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.data.NotebookSession
import kr.eumsoft.notepro.data.PenPreset
import kr.eumsoft.notepro.ui.canvas.EraserMode
import kr.eumsoft.notepro.ui.canvas.NoteCanvasView
import kr.eumsoft.notepro.ui.canvas.Tool
import java.util.UUID

enum class Screen { LIBRARY, WORKSPACE, SETTINGS, ACCOUNT }

/** 창(패널) 하나의 상태. 각 창은 배율·스크롤·도구를 따로 가진다. */
class PaneState(val nbId: String, initialView: String?, pen: PenPreset) {
    val key = UUID.randomUUID().toString()
    /** 화면을 벗어났다 돌아와도 보던 위치·배율 유지 */
    var lastView: String? = initialView
    var session by mutableStateOf<NotebookSession?>(null)
    var failed by mutableStateOf(false)
    var view: NoteCanvasView? = null
    var tool by mutableStateOf(Tool.PEN)
    var pen by mutableStateOf(pen)
    var eraserMode by mutableStateOf(EraserMode.STROKE)
    var eraserSize by mutableFloatStateOf(12f)
    var zoom by mutableIntStateOf(100)
    var pageIndex by mutableIntStateOf(0)
    var pageCount by mutableIntStateOf(1)
    var selection by mutableIntStateOf(0)
    var lastTouch by mutableStateOf(0L)
    fun viewState(): String? = view?.viewState() ?: lastView
}

class AppState(val app: NoteProApp) {
    var screen by mutableStateOf(Screen.LIBRARY)
    val panes = mutableStateListOf<PaneState>()
    var focusedPane by mutableIntStateOf(0)
    var splitVertical by mutableStateOf(app.prefs.splitVertical)
    var splitRatio by mutableFloatStateOf(app.prefs.splitRatio)

    // 라이브러리
    var filter by mutableStateOf(NoteRepository.Filter.ALL)
    var folderId by mutableStateOf<String?>(null)
    var query by mutableStateOf("")
    var notebooks by mutableStateOf<List<NotebookData>>(emptyList())
    var folders by mutableStateOf<List<FolderData>>(emptyList())
    var toast by mutableStateOf<String?>(null)
    /** 라이브러리에서 고른 노트를 옆 창에 열기 */
    var pickForSide by mutableStateOf(false)
    var busy by mutableStateOf<String?>(null)
    /** 펜 프리셋 목록이 바뀌면 증가 → 도구 모음 갱신 */
    var presetsRev by mutableIntStateOf(0)

    fun refreshLibrary() {
        val f = filter; val fo = folderId; val q = query
        Io.async({ app.repo.notebooks(f, fo, q) to app.repo.folders() }) { r ->
            r.getOrNull()?.let { notebooks = it.first; folders = it.second }
        }
    }

    /** 노트 열기. newPane=true면 옆 창(최대 2개)에 연다. */
    fun open(nbId: String, newPane: Boolean, viewState: String? = null) {
        val side = newPane || pickForSide
        pickForSide = false
        val pane = PaneState(nbId, viewState, app.prefs.lastPen)
        if (side && panes.isNotEmpty()) {
            if (panes.size >= MAX_PANES) closePane(panes.last())
            panes.add(pane)
        } else {
            val idx = focusedPane.coerceIn(0, (panes.size - 1).coerceAtLeast(0))
            if (panes.isEmpty()) panes.add(pane) else { val old = panes[idx]; panes[idx] = pane; release(old) }
        }
        focusedPane = panes.indexOf(pane)
        screen = Screen.WORKSPACE
        app.sessions.open(nbId) { s -> if (s == null) pane.failed = true else pane.session = s }
        saveWorkspace()
    }

    fun closeAllToLibraryForPick(@Suppress("UNUSED_PARAMETER") from: PaneState) {
        saveWorkspace()
        pickForSide = true
        screen = Screen.LIBRARY
        refreshLibrary()
    }

    fun closePane(p: PaneState) {
        panes.remove(p); release(p)
        focusedPane = focusedPane.coerceIn(0, (panes.size - 1).coerceAtLeast(0))
        if (panes.isEmpty()) { screen = Screen.LIBRARY; refreshLibrary() }
        saveWorkspace()
    }

    fun closeAll() {
        saveWorkspace(clear = true)
        panes.toList().forEach { release(it) }
        panes.clear(); screen = Screen.LIBRARY; refreshLibrary()
    }

    private fun release(p: PaneState) {
        if (p.session != null) app.sessions.close(p.nbId)
        p.view?.unbind()
        p.session = null
    }

    fun saveWorkspace(clear: Boolean = false) {
        app.prefs.workspace = if (clear) "" else panes.joinToString("\n") { it.nbId + "\t" + (it.viewState() ?: "") }
        app.prefs.splitVertical = splitVertical; app.prefs.splitRatio = splitRatio
    }

    /** 앱 시작 시 마지막 작업 화면 복원. */
    fun restoreWorkspace(): Boolean {
        val lines = app.prefs.workspace.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return false
        lines.take(MAX_PANES).forEachIndexed { i, l ->
            val nb = l.substringBefore('\t'); val st = l.substringAfter('\t', "").ifBlank { null }
            open(nb, newPane = i > 0, viewState = st)
        }
        return true
    }

    companion object { const val MAX_PANES = 2 }
}
