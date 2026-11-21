package kr.eumsoft.notepro.data

import android.database.sqlite.SQLiteDatabaseLockedException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.NotebookSnapshot
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageElement
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.Stroke
import java.util.UUID

data class SaveState(val pending: Int = 0, val lastSavedAt: Long = 0, val error: String? = null)

/** 페이지 변경 알림. strokesAdded가 있으면 화면은 전체 다시 그리기 대신 덧그리기만 한다. */
class Change(val pageIds: Set<String>, val full: Boolean, val strokesAdded: List<Stroke> = emptyList(), val pagesChanged: Boolean = false)

/**
 * 열린 노트 한 권의 메모리 상태. 같은 노트를 여러 창에서 열어도 세션은 하나 → 창 사이 충돌·유실이 없다.
 * 모든 메서드는 메인 스레드에서 호출. 메모리에 즉시 반영하고 DB 저장은 Io 스레드에서 순서대로 수행한다.
 */
class NotebookSession(
    private val repo: NoteRepository,
    var notebook: NotebookData,
    pages: List<PageData>,
    strokes: List<Stroke>,
    elements: List<PageElement> = emptyList(),
) {
    var pages: List<PageData> = pages
        private set
    private val byPage = HashMap<String, ArrayList<Stroke>>()
    private val elementsByPage = HashMap<String, ArrayList<PageElement>>()
    private val listeners = LinkedHashSet<(Change) -> Unit>()

    private class Command(val add: List<Stroke>, val remove: List<Stroke>, val label: String)
    private val undoStack = ArrayDeque<Command>()
    private val redoStack = ArrayDeque<Command>()

    private val _save = MutableStateFlow(SaveState(lastSavedAt = System.currentTimeMillis()))
    val saveState: StateFlow<SaveState> = _save
    private val _canUndo = MutableStateFlow(false to false)
    val undoRedo: StateFlow<Pair<Boolean, Boolean>> = _canUndo

    var dirtySinceVersion = false
    var lastVersionAt = System.currentTimeMillis()

    init { load(pages, strokes, elements) }

    private fun load(pages: List<PageData>, strokes: List<Stroke>, elements: List<PageElement> = emptyList()) {
        this.pages = pages
        byPage.clear(); elementsByPage.clear()
        for (p in pages) { byPage[p.id] = ArrayList(); elementsByPage[p.id] = ArrayList() }
        for (s in strokes) byPage[s.pageId]?.add(s)
        for (e in elements) elementsByPage[e.pageId]?.add(e)
    }

    fun elementsOf(pageId: String): List<PageElement> = elementsByPage[pageId] ?: emptyList()
    fun allElements(): List<PageElement> = pages.flatMap { elementsOf(it.id) }

    /** 텍스트 주석 추가·수정·삭제(사용자·AI 공통). */
    fun commitElements(add: List<PageElement>, remove: List<String>) {
        for (id in remove) elementsByPage.values.forEach { l -> l.removeAll { it.id == id } }
        for (e in add) {
            val l = elementsByPage.getOrPut(e.pageId) { ArrayList() }
            val i = l.indexOfFirst { it.id == e.id }; if (i >= 0) l[i] = e else l.add(e)
        }
        dirtySinceVersion = true
        val nbId = notebook.id
        persist("element") { repo.applyElements(nbId, add, remove) }
        emit(Change((add.map { it.pageId }).toSet(), full = true))
    }

    fun toggleBookmark(pageId: String) {
        val i = pages.indexOfFirst { it.id == pageId }; if (i < 0) return
        val p = pages[i].copy(bookmarked = !pages[i].bookmarked, updatedAt = System.currentTimeMillis())
        pages = pages.toMutableList().also { it[i] = p }
        persist("page.bookmark") { repo.upsertPages(notebook.id, listOf(p), "page.bookmark") }
        emit(Change(setOf(pageId), full = false, pagesChanged = true))
    }

    /** 페이지 90도 회전(배경·필기 함께). */
    fun rotatePage(pageId: String) {
        val i = pages.indexOfFirst { it.id == pageId }; if (i < 0) return
        val old = pages[i]
        val p = old.copy(width = old.height, height = old.width, rotation = (old.rotation + 90) % 360, updatedAt = System.currentTimeMillis())
        pages = pages.toMutableList().also { it[i] = p }
        // 획도 함께 회전: (x, y) → (H - y, x)
        val m = kr.eumsoft.notepro.core.Geometry.Affine(0f, -1f, old.height, 1f, 0f, 0f)
        val oldStrokes = strokesOf(pageId).toList()
        val rotated = oldStrokes.map { kr.eumsoft.notepro.core.Geometry.transform(it, m) }
        applyMemory(rotated, oldStrokes)
        val nbId = notebook.id
        persist("page.rotate") { repo.upsertPages(nbId, listOf(p), "page.rotate"); repo.applyStrokes(nbId, rotated, emptyList(), "rotate") }
        undoStack.clear(); redoStack.clear(); updateUndo()
        emit(Change(setOf(pageId), full = true, pagesChanged = true))
    }

    /** 다른 PDF·이미지 페이지를 뒤에 덧붙임(PDF 병합 등) — DB에 이미 들어간 페이지를 다시 읽는다. */
    fun reloadPagesFromDb(onDone: () -> Unit = {}) {
        val nbId = notebook.id
        Io.async({ Triple(repo.pages(nbId), repo.strokes(nbId), repo.elements(nbId)) }) { r ->
            r.getOrNull()?.let { (p, s, e) -> load(p, s, e) }
            emit(Change(emptySet(), full = true, pagesChanged = true)); onDone()
        }
    }

    fun strokesOf(pageId: String): List<Stroke> = byPage[pageId] ?: emptyList()
    fun strokeCount(): Int = byPage.values.sumOf { it.size }

    fun addListener(l: (Change) -> Unit) { listeners.add(l) }
    fun removeListener(l: (Change) -> Unit) { listeners.remove(l) }
    private fun emit(c: Change) { listeners.toList().forEach { it(c) } }

    // ---------------- 획 변경 ----------------
    private var batch: MutableList<Command>? = null

    /** 지우개처럼 연속 동작을 하나의 되돌리기 단위로 묶는다. */
    fun beginBatch() { if (batch == null) batch = ArrayList() }

    fun endBatch(label: String) {
        val b = batch ?: return
        batch = null
        if (b.isEmpty()) return
        val adds = LinkedHashMap<String, Stroke>()
        val removedOrig = LinkedHashMap<String, Stroke>()
        for (c in b) {
            for (r in c.remove) if (adds.remove(r.id) == null) removedOrig[r.id] = r
            for (a in c.add) adds[a.id] = a
        }
        undoStack.addLast(Command(adds.values.toList(), removedOrig.values.toList(), label))
        if (undoStack.size > 300) undoStack.removeFirst()
        redoStack.clear(); updateUndo()
    }

    fun commit(add: List<Stroke>, remove: List<Stroke>, label: String, undoable: Boolean = true) {
        if (add.isEmpty() && remove.isEmpty()) return
        applyMemory(add, remove)
        val bt = batch
        if (undoable && bt != null) bt.add(Command(add, remove, label))
        else if (undoable) {
            undoStack.addLast(Command(add, remove, label))
            if (undoStack.size > 300) undoStack.removeFirst()
            redoStack.clear()
        }
        updateUndo()
        persistStrokes(add, remove, label)
        val pagesTouched = (add.map { it.pageId } + remove.map { it.pageId }).toSet()
        emit(Change(pagesTouched, full = remove.isNotEmpty(), strokesAdded = if (remove.isEmpty()) add else emptyList()))
    }

    fun undo() {
        val c = undoStack.removeLastOrNull() ?: return
        applyMemory(c.remove, c.add)
        redoStack.addLast(c); updateUndo()
        persistStrokes(c.remove, c.add.map { it }, "undo." + c.label)
        emit(Change((c.add + c.remove).map { it.pageId }.toSet(), full = true))
    }

    fun redo() {
        val c = redoStack.removeLastOrNull() ?: return
        applyMemory(c.add, c.remove)
        undoStack.addLast(c); updateUndo()
        persistStrokes(c.add, c.remove, "redo." + c.label)
        emit(Change((c.add + c.remove).map { it.pageId }.toSet(), full = true))
    }

    private fun updateUndo() { _canUndo.value = undoStack.isNotEmpty() to redoStack.isNotEmpty() }

    private fun applyMemory(add: List<Stroke>, remove: List<Stroke>) {
        val removeIds = remove.map { it.id }.toHashSet()
        if (removeIds.isNotEmpty()) for (list in byPage.values) list.removeAll { it.id in removeIds }
        for (s in add) {
            val list = byPage[s.pageId] ?: continue
            val i = list.indexOfFirst { it.id == s.id }
            if (i >= 0) list[i] = s else list.add(s)
        }
        dirtySinceVersion = true
    }

    private fun persistStrokes(add: List<Stroke>, remove: List<Stroke>, label: String) {
        val removeIds = remove.map { it.id }.filter { id -> add.none { it.id == id } }
        val nbId = notebook.id
        persist(label) { repo.applyStrokes(nbId, add, removeIds, "stroke.$label") }
    }

    // ---------------- 페이지 ----------------
    fun addPage(afterIndex: Int, template: PageTemplate? = null, paper: PaperStyle? = null): PageData {
        val ref = pages.getOrNull(afterIndex) ?: pages.lastOrNull()
        val now = System.currentTimeMillis()
        val bgPaper = ref?.takeIf { it.bgType == BackgroundType.PAPER }
        val p = PageData(
            id = UUID.randomUUID().toString(), notebookId = notebook.id, index = afterIndex + 1,
            width = ref?.width ?: 595f, height = ref?.height ?: 842f,
            paper = paper ?: bgPaper?.paper ?: PaperStyle.LINED, template = template ?: PageTemplate.NONE,
            createdAt = now, updatedAt = now,
        )
        val list = pages.toMutableList()
        list.add((afterIndex + 1).coerceIn(0, list.size), p)
        pages = list.mapIndexed { i, x -> if (x.index != i) x.copy(index = i) else x }
        byPage[p.id] = ArrayList()
        val snapshot = pages
        persist("page.add") { repo.upsertPages(notebook.id, snapshot, "page.add") }
        dirtySinceVersion = true
        emit(Change(setOf(p.id), full = true, pagesChanged = true))
        return p
    }

    fun duplicatePage(index: Int) {
        val src = pages.getOrNull(index) ?: return
        val now = System.currentTimeMillis()
        val p = src.copy(id = UUID.randomUUID().toString(), index = index + 1, createdAt = now, updatedAt = now)
        val list = pages.toMutableList(); list.add(index + 1, p)
        pages = list.mapIndexed { i, x -> if (x.index != i) x.copy(index = i) else x }
        val copies = strokesOf(src.id).map { it.copy(id = Stroke.newId(), pageId = p.id) }
        byPage[p.id] = ArrayList(copies)
        val snapshot = pages
        persist("page.duplicate") {
            repo.upsertPages(notebook.id, snapshot, "page.duplicate")
            repo.applyStrokes(notebook.id, copies, emptyList(), "page.duplicate")
        }
        dirtySinceVersion = true
        emit(Change(setOf(p.id), full = true, pagesChanged = true))
    }

    fun movePage(from: Int, to: Int) {
        if (from !in pages.indices || to !in pages.indices || from == to) return
        val list = pages.toMutableList(); val p = list.removeAt(from); list.add(to, p)
        pages = list.mapIndexed { i, x -> x.copy(index = i) }
        val snapshot = pages
        persist("page.move") { repo.upsertPages(notebook.id, snapshot, "page.move") }
        dirtySinceVersion = true
        emit(Change(emptySet(), full = true, pagesChanged = true))
    }

    /** 페이지 삭제 — 휴지통처럼 복구할 수 있다(획 데이터는 그대로 남음). */
    fun deletePage(pageId: String) {
        if (pages.size <= 1) return
        val list = pages.filter { it.id != pageId }.mapIndexed { i, x -> x.copy(index = i) }
        pages = list
        val snapshot = list
        persist("page.delete") { repo.deletePage(notebook.id, pageId, snapshot) }
        dirtySinceVersion = true
        emit(Change(setOf(pageId), full = true, pagesChanged = true))
    }

    /** 삭제된 페이지 복구(DB에서 다시 읽어 메모리에 반영). */
    fun restorePage(page: PageData, onDone: () -> Unit) {
        val at = pages.size
        val nbId = notebook.id
        persist("page.restore") { repo.restorePage(nbId, page.id, at) }
        undoStack.clear(); redoStack.clear(); updateUndo()
        reloadPagesFromDb(onDone)
    }

    /** 무한 스크롤 페이지: 아래쪽에 쓰면 페이지를 늘린다. */
    fun extendPage(pageId: String, newHeight: Float) {
        val i = pages.indexOfFirst { it.id == pageId }; if (i < 0) return
        val p = pages[i].copy(height = newHeight, updatedAt = System.currentTimeMillis())
        pages = pages.toMutableList().also { it[i] = p }
        persist("page.extend") { repo.upsertPages(notebook.id, listOf(p), "page.extend") }
        emit(Change(setOf(pageId), full = true, pagesChanged = true))
    }

    fun setPaper(pageId: String, paper: PaperStyle, template: PageTemplate) {
        val i = pages.indexOfFirst { it.id == pageId }; if (i < 0) return
        val p = pages[i].copy(paper = paper, template = template, updatedAt = System.currentTimeMillis())
        pages = pages.toMutableList().also { it[i] = p }
        persist("page.paper") { repo.upsertPages(notebook.id, listOf(p), "page.paper") }
        dirtySinceVersion = true
        emit(Change(setOf(pageId), full = true, pagesChanged = true))
    }

    /** 버전 복원 등으로 DB 내용이 바뀐 뒤 다시 읽기. */
    fun reload(snapshot: NotebookSnapshot) {
        notebook = snapshot.notebook
        load(snapshot.pages, snapshot.strokes, snapshot.elements)
        undoStack.clear(); redoStack.clear(); updateUndo()
        emit(Change(emptySet(), full = true, pagesChanged = true))
    }

    fun memorySnapshot(): NotebookSnapshot = NotebookSnapshot(notebook, pages, pages.flatMap { strokesOf(it.id) }, allElements())

    // ---------------- 저장(재시도·복구) ----------------
    private fun persist(label: String, work: () -> Unit) {
        _save.value = _save.value.copy(pending = _save.value.pending + 1)
        Io.run {
            var attempt = 0
            var errorMsg: String? = null
            while (true) {
                try {
                    work(); errorMsg = null; break
                } catch (e: Exception) {
                    attempt++
                    val retryable = e is SQLiteFullException || e is SQLiteDiskIOException || e is SQLiteDatabaseLockedException
                    errorMsg = e.javaClass.simpleName + ": " + (e.message ?: "")
                    repo.logError("save.$label", errorMsg, e.stackTraceToString())
                    if (retryable) {
                        val msg = errorMsg
                        Io.main.post { _save.value = _save.value.copy(error = msg) }
                        Thread.sleep(minOf(5000L, 200L shl minOf(attempt, 5)))
                        continue
                    }
                    // 재시도해도 안 되는 오류: 메모리의 현재 내용 전체를 한 번에 다시 저장(안전망)
                    try {
                        val snap = java.util.concurrent.FutureTask<NotebookSnapshot> { memorySnapshot() }.also { Io.main.post(it) }.get()
                        repo.replaceWithSnapshot(snap)
                        errorMsg = null
                    } catch (e2: Exception) {
                        repo.logError("save.fullFallback", e2.toString(), e2.stackTraceToString())
                    }
                    break
                }
            }
            val err = errorMsg
            Io.main.post {
                _save.value = SaveState(pending = (_save.value.pending - 1).coerceAtLeast(0), lastSavedAt = if (err == null) System.currentTimeMillis() else _save.value.lastSavedAt, error = err)
            }
        }
    }
}

/** 노트 세션 공유 관리(참조 카운트). */
class SessionManager(private val repo: NoteRepository, private val versions: VersionManager, private val settings: SettingsStore) {
    private val sessions = HashMap<String, NotebookSession>()
    private val refs = HashMap<String, Int>()
    private val waiting = HashMap<String, MutableList<(NotebookSession?) -> Unit>>()

    fun open(nbId: String, cb: (NotebookSession?) -> Unit) {
        sessions[nbId]?.let { refs[nbId] = (refs[nbId] ?: 0) + 1; cb(it); return }
        val queue = waiting[nbId]
        if (queue != null) { queue.add(cb); return }
        waiting[nbId] = mutableListOf(cb)
        Io.async({
            repo.touchOpened(nbId)
            val nb = repo.notebook(nbId) ?: return@async null
            listOf(nb, repo.pages(nbId), repo.strokes(nbId), repo.elements(nbId))
        }) { r ->
            val data = r.getOrNull()
            @Suppress("UNCHECKED_CAST")
            val s = data?.let { NotebookSession(repo, it[0] as NotebookData, it[1] as List<PageData>, it[2] as List<Stroke>, it[3] as List<PageElement>) }
            val cbs = waiting.remove(nbId) ?: mutableListOf()
            if (s != null) { sessions[nbId] = s; refs[nbId] = cbs.size }
            cbs.forEach { it(s) }
        }
    }

    fun get(nbId: String): NotebookSession? = sessions[nbId]

    fun close(nbId: String) {
        val n = (refs[nbId] ?: 1) - 1
        if (n > 0) { refs[nbId] = n; return }
        refs.remove(nbId)
        val s = sessions.remove(nbId) ?: return
        if (s.dirtySinceVersion) versions.createAsync(nbId, VersionManager.REASON_CLOSE, settings.value.versionKeep)
    }

    /** 주기적 자동 복구 지점. */
    fun tickAutoVersions() {
        val now = System.currentTimeMillis()
        val every = settings.value.autoVersionMinutes * 60_000L
        if (every <= 0) return
        for ((id, s) in sessions) {
            if (s.dirtySinceVersion && now - s.lastVersionAt > every) {
                s.dirtySinceVersion = false; s.lastVersionAt = now
                versions.createAsync(id, VersionManager.REASON_AUTO, settings.value.versionKeep)
            }
        }
    }

    fun reloadFromDb(nbId: String) {
        val s = sessions[nbId] ?: return
        Io.async({ repo.snapshot(nbId) }) { r -> r.getOrNull()?.let { s.reload(it) } }
    }

    fun openIds(): Set<String> = sessions.keys
}
