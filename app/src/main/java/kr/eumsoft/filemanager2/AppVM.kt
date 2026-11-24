package kr.eumsoft.filemanager2

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.data.Category
import kr.eumsoft.filemanager2.data.FItem
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.FileType
import kr.eumsoft.filemanager2.data.FileTypes
import kr.eumsoft.filemanager2.data.Prefs
import kr.eumsoft.filemanager2.data.Trash
import java.io.File
import java.io.IOException

sealed interface Dest {
    data object Home : Dest
    data class Browse(val path: String) : Dest
    data class Cat(val cat: Category) : Dest
    data object TrashBin : Dest
    data object Analysis : Dest
    data class Search(val root: String) : Dest
    data object Favorites : Dest
    data class TextEdit(val path: String) : Dest
    data class ImageView(val path: String) : Dest
    data object Settings : Dest
    data object Connect : Dest
    data object Cloud : Dest
    data object Nas : Dest
}

data class Clip(val paths: List<String>, val cut: Boolean)

class AppVM(app: Application) : AndroidViewModel(app) {
    val prefs = Prefs(app)
    val trash = Trash(app)

    val stack = mutableStateListOf<Dest>(Dest.Home)
    var clip by mutableStateOf<Clip?>(null)
    var busy by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var version by mutableIntStateOf(0)

    val top: Dest get() = stack.last()

    fun push(d: Dest) { stack.add(d) }
    fun pop(): Boolean = if (stack.size > 1) { stack.removeAt(stack.lastIndex); true } else false
    fun goHome() { while (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun refresh() { version++ }
    fun toast(m: String) { message = m }

    fun runOp(label: String, done: String? = null, block: suspend () -> Unit) {
        viewModelScope.launch {
            busy = label
            try {
                withContext(Dispatchers.IO) { block() }
                if (done != null) message = done
            } catch (e: Exception) {
                message = "오류: ${e.message ?: e.javaClass.simpleName}"
            } finally {
                busy = null
                version++
            }
        }
    }

    // ---------- 열기 ----------
    fun open(ctx: Context, item: FItem) {
        if (item.isDir) { push(Dest.Browse(item.path)); return }
        prefs.addRecent(item.path)
        when (FileTypes.of(item)) {
            FileType.IMAGE -> push(Dest.ImageView(item.path))
            FileType.TEXT, FileType.CODE -> push(Dest.TextEdit(item.path))
            else -> openExternal(ctx, item.file)
        }
    }

    fun uriOf(ctx: Context, f: File): Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".provider", f)

    fun openExternal(ctx: Context, f: File, anyType: Boolean = false) {
        try {
            val i = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uriOf(ctx, f), if (anyType) "*/*" else FileTypes.mime(f))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            if (anyType) ctx.startActivity(Intent.createChooser(i, "연결 프로그램 선택")) else ctx.startActivity(i)
        } catch (e: ActivityNotFoundException) {
            if (!anyType) openExternal(ctx, f, true) else message = "이 파일을 열 수 있는 앱이 없습니다"
        } catch (e: Exception) {
            message = "열 수 없습니다: ${e.message}"
        }
    }

    fun share(ctx: Context, items: List<FItem>) {
        val files = items.filter { !it.isDir }.map { it.file }
        if (files.isEmpty()) { message = "폴더는 공유할 수 없습니다"; return }
        try {
            val uris = ArrayList(files.map { uriOf(ctx, it) })
            val i = if (uris.size == 1) {
                Intent(Intent.ACTION_SEND).setType(FileTypes.mime(files[0])).putExtra(Intent.EXTRA_STREAM, uris[0])
            } else {
                Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            ctx.startActivity(Intent.createChooser(i, "공유"))
        } catch (e: Exception) {
            message = "공유할 수 없습니다: ${e.message}"
        }
    }

    // ---------- 파일 작업 ----------
    fun setClip(items: List<FItem>, cut: Boolean) {
        clip = Clip(items.map { it.path }, cut)
        message = "${items.size}개 항목을 ${if (cut) "잘라냈습니다" else "복사했습니다"} — 붙여넣을 폴더로 이동하세요"
    }

    fun paste(dest: File) {
        val c = clip ?: return
        runOp(if (c.cut) "이동하는 중…" else "복사하는 중…", if (c.cut) "이동했습니다" else "복사했습니다") {
            for (p in c.paths) {
                val src = File(p)
                if (!src.exists()) continue
                val d = dest.absolutePath
                if (src.isDirectory && (d == src.absolutePath || d.startsWith(src.absolutePath + "/")))
                    throw IOException("폴더를 자기 자신 안으로 넣을 수 없습니다")
                if (c.cut) FileOps.move(src, dest) else FileOps.copy(src, dest)
            }
            clip = null
        }
    }

    fun delete(items: List<FItem>, permanent: Boolean) {
        runOp("삭제하는 중…", if (permanent) "완전히 삭제했습니다" else "휴지통으로 옮겼습니다") {
            for (it in items) {
                val f = it.file
                if (permanent || trash.isInTrash(f)) {
                    if (!f.deleteRecursively()) throw IOException("${f.name} 을(를) 지우지 못했습니다")
                } else trash.add(f)
                if (prefs.isFav(it.path)) withContext(Dispatchers.Main) { prefs.toggleFav(it.path) }
            }
        }
    }

    fun rename(item: FItem, name: String) = runOp("이름 바꾸는 중…", "이름을 바꿨습니다") { FileOps.rename(item.file, name) }
    fun newFolder(dir: File, name: String) = runOp("만드는 중…", "폴더를 만들었습니다") { FileOps.newFolder(dir, name) }
    fun newFile(dir: File, name: String) = runOp("만드는 중…", "파일을 만들었습니다") { FileOps.newFile(dir, name) }

    fun compress(items: List<FItem>, name: String) {
        val dir = items.first().file.parentFile ?: return
        val zipName = if (name.endsWith(".zip", true)) name else "$name.zip"
        runOp("압축하는 중…", "$zipName 으로 압축했습니다") {
            FileOps.zip(items.map { it.file }, FileOps.uniqueTarget(dir, zipName))
        }
    }

    fun extract(item: FItem) {
        val dir = item.file.parentFile ?: return
        runOp("압축 푸는 중…", "압축을 풀었습니다") { FileOps.unzip(item.file, dir) }
    }
}
