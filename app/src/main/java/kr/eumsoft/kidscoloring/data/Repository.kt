package kr.eumsoft.kidscoloring.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kr.eumsoft.kidscoloring.engine.Sticker
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

data class Category(val id: String, val title: String)

data class Artwork(
    val id: String, val title: String, val category: String, val difficulty: Int,
    val linePath: String, val maskPath: String, val thumbPath: String,
    val regionCount: Int, val background: Int, val available: Boolean,
    val createdAt: String, val model: String, val licenseReview: String,
)

class Catalog(val size: Int, val categories: List<Category>, val artworks: List<Artwork>) {
    fun byId(id: String) = artworks.firstOrNull { it.id == id }
}

/** 저장된 색칠 상태 */
class SavedState(val pixels: IntArray?, val regionColor: IntArray?, val stickers: List<Sticker>)

class Repository(private val ctx: Context, val db: AppDb, val settings: SettingsStore) {
    val catalog: Catalog by lazy { loadCatalog() }

    private fun assetExists(path: String) = try { ctx.assets.open(path).close(); true } catch (e: IOException) { false }

    private fun loadCatalog(): Catalog {
        val o = JSONObject(ctx.assets.open("art/catalog.json").bufferedReader().use { it.readText() })
        val cats = o.getJSONArray("categories").let { a -> List(a.length()) { a.getJSONObject(it).let { c -> Category(c.getString("id"), c.getString("title")) } } }
        val arts = o.getJSONArray("artworks").let { a ->
            List(a.length()) {
                val j = a.getJSONObject(it)
                val line = j.getString("line"); val mask = j.getString("mask"); val thumb = j.getString("thumb")
                // 이미지 파일 누락 검사: 파일이 하나라도 없으면 "준비 중"으로 표시하고 열 수 없게 한다
                val ok = j.optBoolean("available") && assetExists(line) && assetExists(mask) && assetExists(thumb)
                Artwork(j.getString("id"), j.getString("title"), j.getString("category"), j.optInt("difficulty", 1),
                    line, mask, thumb, j.optJSONArray("regions")?.length() ?: 0, j.optInt("background", 0), ok,
                    j.optString("createdAt"), j.optString("model"), j.optString("licenseReview"))
            }
        }
        return Catalog(o.getInt("size"), cats, arts)
    }

    suspend fun seedArtworks() = withContext(Dispatchers.IO) {
        db.artworks().upsertAll(catalog.artworks.map { ArtworkEntity(it.id, it.category, it.title, it.linePath, it.maskPath, it.difficulty) })
    }

    fun thumb(a: Artwork): Bitmap? = try { ctx.assets.open(a.thumbPath).use { BitmapFactory.decodeStream(it) } } catch (e: IOException) { null }

    /** 선화(알파만) */
    fun loadLine(a: Artwork): Bitmap {
        val full = ctx.assets.open(a.linePath).use { BitmapFactory.decodeStream(it) } ?: throw IOException("선화를 읽을 수 없습니다: ${a.linePath}")
        val alpha = full.extractAlpha()
        full.recycle()
        return alpha
    }

    /** 영역 마스크 → 픽셀별 영역 번호 */
    fun loadMask(a: Artwork): ShortArray {
        val opt = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888; inScaled = false }
        val bmp = ctx.assets.open(a.maskPath).use { BitmapFactory.decodeStream(it, null, opt) } ?: throw IOException("마스크를 읽을 수 없습니다: ${a.maskPath}")
        val w = bmp.width; val h = bmp.height
        if (w != catalog.size || h != catalog.size) { bmp.recycle(); throw IOException("마스크 크기가 맞지 않습니다") }
        val out = ShortArray(w * h)
        val row = IntArray(w)
        for (y in 0 until h) {
            bmp.getPixels(row, 0, w, 0, y, w, 1)
            val o = y * w
            for (x in 0 until w) { val p = row[x]; out[o + x] = (((p shr 16) and 0xFF) or (p and 0xFF00)).toShort() }
        }
        bmp.recycle()
        return out
    }

    // ───────────── 프로젝트(색칠 작업) ─────────────
    private fun projectDir(id: Long) = File(ctx.filesDir, "projects/p$id")

    suspend fun openOrCreate(artworkId: String, forceNew: Boolean): ProjectEntity = withContext(Dispatchers.IO) {
        if (!forceNew) db.projects().unfinishedFor(artworkId)?.let { return@withContext it }
        val now = System.currentTimeMillis()
        val title = catalog.byId(artworkId)?.title ?: ""
        val id = db.projects().insert(ProjectEntity(0, artworkId, now, now, "", "", false, title))
        db.projects().get(id)!!
    }

    suspend fun loadState(projectId: Long): SavedState? = withContext(Dispatchers.IO) {
        val dir = projectDir(projectId)
        val stateFile = File(dir, "state.json")
        if (!stateFile.exists()) return@withContext null
        try {
            val j = JSONObject(stateFile.readText())
            val rc = j.getJSONArray("regionColor").let { a -> IntArray(a.length()) { a.getInt(it) } }
            val st = j.getJSONArray("stickers").let { a ->
                List(a.length()) { a.getJSONObject(it).let { s -> Sticker(s.getInt("t"), s.getDouble("x").toFloat(), s.getDouble("y").toFloat(), s.getDouble("s").toFloat(), s.getInt("c")) } }
            }
            val pf = File(dir, "paint.png")
            val px = if (pf.exists()) BitmapFactory.decodeFile(pf.path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888; inScaled = false })?.let { b ->
                IntArray(b.width * b.height).also { b.getPixels(it, 0, b.width, 0, 0, b.width, b.height); b.recycle() }
            } else null
            SavedState(px, rc, st)
        } catch (e: Exception) { null }
    }

    /**
     * 편집 상태를 저장한다: paint.png(색칠 레이어만, 투명 배경) + state.json(영역 색, 스티커) + thumb.png(완성 모습).
     * 임시 파일에 쓴 뒤 이름을 바꾸므로 저장 도중 앱이 꺼져도 이전 저장본이 남는다.
     * @throws IOException 저장 공간 부족 등
     */
    suspend fun saveState(projectId: Long, w: Int, h: Int, pixels: IntArray, regionColor: IntArray, stickers: List<Sticker>, thumb: Bitmap) = withContext(Dispatchers.IO) {
        val dir = projectDir(projectId)
        if (!dir.exists() && !dir.mkdirs()) throw IOException("폴더를 만들 수 없습니다")
        if (ctx.filesDir.usableSpace < 24L * 1024 * 1024) throw IOException("저장 공간 부족")
        val bmp = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
        val tmpPaint = File(dir, "paint.png.tmp"); val tmpState = File(dir, "state.json.tmp"); val tmpThumb = File(dir, "thumb.png.tmp")
        try {
            tmpPaint.outputStream().use { if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, it)) throw IOException("이미지 저장 실패") }
            tmpThumb.outputStream().use { if (!thumb.compress(Bitmap.CompressFormat.PNG, 100, it)) throw IOException("썸네일 저장 실패") }
            val j = JSONObject()
            j.put("version", 1)
            j.put("regionColor", JSONArray().apply { regionColor.forEach { put(it) } })
            j.put("stickers", JSONArray().apply { stickers.forEach { s -> put(JSONObject().put("t", s.type).put("x", s.x.toDouble()).put("y", s.y.toDouble()).put("s", s.size.toDouble()).put("c", s.color)) } })
            tmpState.writeText(j.toString())
            if (!tmpPaint.renameTo(File(dir, "paint.png")) || !tmpState.renameTo(File(dir, "state.json")) || !tmpThumb.renameTo(File(dir, "thumb.png")))
                throw IOException("파일 바꾸기 실패")
        } finally {
            bmp.recycle()
            tmpPaint.delete(); tmpState.delete(); tmpThumb.delete()
        }
        db.projects().touch(projectId, System.currentTimeMillis(), File(dir, "thumb.png").path, dir.path)
    }

    suspend fun deleteProject(id: Long) = withContext(Dispatchers.IO) {
        projectDir(id).deleteRecursively()
        db.projects().delete(id)
    }

    /** 한 번도 저장하지 않은 빈 작업은 목록에 남기지 않는다 */
    suspend fun discardIfEmpty(id: Long) = withContext(Dispatchers.IO) {
        val p = db.projects().get(id) ?: return@withContext
        if (p.projectFilePath.isEmpty()) db.projects().delete(id)
    }
}
