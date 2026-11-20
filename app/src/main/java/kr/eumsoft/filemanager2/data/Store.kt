package kr.eumsoft.filemanager2.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.io.File
import java.io.IOException

class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("fm2_prefs", Context.MODE_PRIVATE)

    var showHidden by mutableStateOf(sp.getBoolean("hidden", false))
        private set
    var sort by mutableStateOf(runCatching { SortMode.valueOf(sp.getString("sort", "NAME")!!) }.getOrDefault(SortMode.NAME))
        private set
    var asc by mutableStateOf(sp.getBoolean("asc", true))
        private set
    var grid by mutableStateOf(sp.getBoolean("grid", false))
        private set
    var theme by mutableStateOf(sp.getString("theme", "system") ?: "system")
        private set
    var favorites by mutableStateOf(sp.getString("fav", "")!!.split('\n').filter { it.isNotBlank() })
        private set
    var recent by mutableStateOf(sp.getString("recent", "")!!.split('\n').filter { it.isNotBlank() })
        private set

    fun setHidden(v: Boolean) { showHidden = v; sp.edit().putBoolean("hidden", v).apply() }
    fun setSort(m: SortMode, a: Boolean) { sort = m; asc = a; sp.edit().putString("sort", m.name).putBoolean("asc", a).apply() }
    fun changeGrid(v: Boolean) { grid = v; sp.edit().putBoolean("grid", v).apply() }
    fun changeTheme(v: String) { theme = v; sp.edit().putString("theme", v).apply() }

    fun isFav(path: String) = path in favorites
    fun toggleFav(path: String) {
        favorites = if (isFav(path)) favorites - path else favorites + path
        sp.edit().putString("fav", favorites.joinToString("\n")).apply()
    }

    fun addRecent(path: String) {
        recent = (listOf(path) + recent.filter { it != path }).take(60)
        sp.edit().putString("recent", recent.joinToString("\n")).apply()
    }
    fun clearRecent() { recent = emptyList(); sp.edit().remove("recent").apply() }
}

data class TrashItem(val key: String, val file: File, val original: String, val deletedAt: Long)

/** 앱 전용 휴지통: 내부 저장소의 숨김 폴더로 옮기고, 원래 경로를 기록해 둠 */
class Trash(ctx: Context) {
    private val sp = ctx.getSharedPreferences("fm2_trash", Context.MODE_PRIVATE)

    val dir: File
        get() = File(FileOps.root, ".FileManager2_Trash").apply {
            mkdirs()
            runCatching { File(this, ".nomedia").createNewFile() }
        }

    private fun meta(): JSONObject = runCatching { JSONObject(sp.getString("meta", "{}")!!) }.getOrDefault(JSONObject())
    private fun save(j: JSONObject) { sp.edit().putString("meta", j.toString()).apply() }

    fun isInTrash(f: File) = f.absolutePath.startsWith(dir.absolutePath)

    fun add(f: File) {
        val key = "${System.currentTimeMillis()}_${f.name}"
        val t = File(dir, key)
        FileOps.moveTo(f, t)
        val j = meta()
        j.put(key, JSONObject().put("o", f.absolutePath).put("t", System.currentTimeMillis()))
        save(j)
    }

    fun list(): List<TrashItem> {
        val j = meta()
        return (dir.listFiles() ?: emptyArray())
            .filter { it.name != ".nomedia" }
            .map { f ->
                val m = j.optJSONObject(f.name)
                TrashItem(f.name, f, m?.optString("o") ?: f.name, m?.optLong("t") ?: f.lastModified())
            }
            .sortedByDescending { it.deletedAt }
    }

    fun restore(item: TrashItem): File {
        val orig = File(item.original)
        val parent = orig.parentFile ?: throw IOException("원래 위치를 알 수 없습니다")
        parent.mkdirs()
        val target = FileOps.uniqueTarget(parent, orig.name)
        FileOps.moveTo(item.file, target)
        forget(item.key)
        return target
    }

    fun deleteForever(item: TrashItem) {
        item.file.deleteRecursively()
        forget(item.key)
    }

    fun empty() {
        list().forEach { it.file.deleteRecursively() }
        save(JSONObject())
    }

    private fun forget(key: String) { val j = meta(); j.remove(key); save(j) }
}
