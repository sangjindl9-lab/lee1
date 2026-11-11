package kr.eumsoft.kidscoloring.ui

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kr.eumsoft.kidscoloring.EumApp
import kr.eumsoft.kidscoloring.data.Artwork
import kr.eumsoft.kidscoloring.data.UserSettings
import kr.eumsoft.kidscoloring.engine.PaintEngine
import java.io.IOException

const val AUTOSAVE_MS = 15_000L

class ColoringViewModel(app: Application) : AndroidViewModel(app) {
    val repo = (app as EumApp).repo
    val settings = repo.settings.flow.stateIn(viewModelScope, SharingStarted.Eagerly, UserSettings())
    val projects = repo.db.projects().observeAll().stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    // ── 열려 있는 색칠 작업 ──
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var artwork by mutableStateOf<Artwork?>(null); private set
    var projectId by mutableStateOf(0L); private set
    var engine: PaintEngine? = null; private set
    var paintBitmap: Bitmap? = null; private set
    var lineBitmap: Bitmap? = null; private set
    /** 그림이 바뀔 때마다 올라간다 (실행 취소 버튼 등 다시 그리기용) */
    var rev by mutableIntStateOf(0); private set
    var completed by mutableStateOf(false); private set
    var celebrate by mutableStateOf(false)

    // ── 도구 상태 ──
    var tool by mutableStateOf(Tool.FILL)
    var color by mutableIntStateOf(Palettes.basic[0].argb)
    var brushSize by mutableFloatStateOf(28f)
    var opacity by mutableFloatStateOf(1f)
    var stickerType by mutableIntStateOf(0)

    private val saveLock = Mutex()
    private var autosave: Job? = null

    init {
        viewModelScope.launch { repo.seedArtworks() }
    }

    fun updateSettings(f: (UserSettings) -> UserSettings) {
        viewModelScope.launch { repo.settings.update(f(settings.value)) }
    }

    fun pickColor(c: Int) {
        color = c or (0xFF shl 24)
        val s = settings.value
        val recent = (listOf(color) + s.recentColors.filter { it != color }).take(10)
        updateSettings { it.copy(recentColors = recent) }
    }

    fun toggleFavorite(c: Int) = updateSettings { s ->
        s.copy(favoriteColors = if (c in s.favoriteColors) s.favoriteColors - c else (listOf(c) + s.favoriteColors).take(24))
    }

    private fun undoBudget(): Long {
        val am = getApplication<Application>().getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        // 저사양 기기에서는 되돌리기 기록을 줄인다
        return (am.largeMemoryClass / 5).coerceIn(16, 64) * 1024L * 1024L
    }

    /** 도안을 연다. projectId 가 있으면 그 작업을, 없으면 하던 작업(없으면 새 작업)을 연다. */
    fun open(artworkId: String, existingProject: Long? = null, forceNew: Boolean = false, onReady: () -> Unit) {
        if (loading) return
        val art = repo.catalog.byId(artworkId)
        if (art == null || !art.available) { error = "이 그림은 아직 준비 중이에요"; return }
        loading = true
        viewModelScope.launch {
            try {
                release()
                val proj = if (existingProject != null) repo.db.projects().get(existingProject)!! else repo.openOrCreate(artworkId, forceNew)
                val (mask, line, saved) = withContext(Dispatchers.Default) {
                    Triple(repo.loadMask(art), repo.loadLine(art), repo.loadState(proj.projectId))
                }
                val size = repo.catalog.size
                val eng = PaintEngine(size, size, mask, art.regionCount, undoBudget())
                if (saved != null) eng.restore(saved.pixels, saved.regionColor, saved.stickers)
                val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                bmp.setPixels(eng.paint, 0, size, 0, 0, size, size)
                eng.consumeDirty()
                engine = eng; paintBitmap = bmp; lineBitmap = line
                artwork = art; projectId = proj.projectId; completed = proj.completed
                val s = settings.value
                brushSize = s.brushSize; opacity = s.opacity
                rev++
                startAutosave()
                onReady()
            } catch (e: OutOfMemoryError) {
                release(); error = "메모리가 부족해서 그림을 열 수 없어요"
            } catch (e: Exception) {
                release(); error = "그림을 열 수 없어요"
            } finally { loading = false }
        }
    }

    private fun startAutosave() {
        autosave?.cancel()
        autosave = viewModelScope.launch {
            while (true) { delay(AUTOSAVE_MS); save(silent = true) }
        }
    }

    fun edited() { rev++ }

    fun onFilled() {
        val e = engine ?: return
        val a = artwork ?: return
        if (!completed && e.isComplete(a.background)) markComplete()
    }

    fun markComplete() {
        completed = true; celebrate = true
        val id = projectId
        viewModelScope.launch { save(silent = true); repo.db.projects().setCompleted(id, true) }
    }

    fun thumbBitmap(outSize: Int = 384): Bitmap? {
        val e = engine ?: return null
        return Render.composite(e.w, outSize, paintBitmap, lineBitmap, e.stickers)
    }

    /** 현재 상태를 저장한다. 바뀐 것이 없으면 아무것도 하지 않는다. */
    suspend fun save(silent: Boolean = false): Boolean {
        val e = engine ?: return false
        if (!e.modified) { if (!silent) message = "저장했어요"; return true }
        return saveLock.withLock {
            val id = projectId
            // 저장하는 동안에도 계속 그릴 수 있도록 복사본을 만든다
            val pixels = e.paint.copyOf(); val rc = e.regionColor.copyOf(); val st = e.stickers
            val thumb = Render.composite(e.w, 384, paintBitmap, lineBitmap, st)
            e.modified = false
            try {
                withContext(NonCancellable) { repo.saveState(id, e.w, e.h, pixels, rc, st, thumb) }
                if (!silent) message = "저장했어요"
                true
            } catch (ex: IOException) {
                e.modified = true
                message = "저장하지 못했어요. 저장 공간을 확인해 주세요"
                false
            } catch (ex: OutOfMemoryError) {
                e.modified = true
                message = "메모리가 부족해서 저장하지 못했어요"
                false
            } finally { thumb.recycle() }
        }
    }

    fun saveNow(silent: Boolean = false) { viewModelScope.launch { save(silent) } }

    /** 색칠 화면을 닫는다: 저장하고 메모리를 비운다 */
    fun close(onDone: () -> Unit) {
        viewModelScope.launch {
            save(silent = true)
            val id = projectId
            release()
            if (id != 0L) repo.discardIfEmpty(id)
            onDone()
        }
    }

    private fun release() {
        autosave?.cancel(); autosave = null
        engine = null
        paintBitmap?.recycle(); paintBitmap = null
        lineBitmap?.recycle(); lineBitmap = null
        artwork = null; projectId = 0; completed = false; celebrate = false
    }

    fun rename(id: Long, name: String) = viewModelScope.launch { repo.db.projects().rename(id, name.trim().take(30)) }
    fun delete(id: Long) = viewModelScope.launch { repo.deleteProject(id) }
}
