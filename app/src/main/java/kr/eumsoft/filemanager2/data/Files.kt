package kr.eumsoft.filemanager2.data

import android.content.Context
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.charset.Charset
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

data class FItem(
    val path: String,
    val name: String,
    val isDir: Boolean,
    val size: Long,
    val modified: Long,
    val childCount: Int = -1,
) {
    val ext: String get() = name.substringAfterLast('.', "").lowercase()
    val file: File get() = File(path)
    val hidden: Boolean get() = name.startsWith(".")
}

fun File.toItem(countChildren: Boolean = true): FItem = FItem(
    path = absolutePath,
    name = name,
    isDir = isDirectory,
    size = if (isDirectory) 0L else length(),
    modified = lastModified(),
    childCount = if (isDirectory && countChildren) (list()?.size ?: 0) else -1,
)

enum class FileType { FOLDER, IMAGE, VIDEO, AUDIO, PDF, DOC, SHEET, SLIDE, TEXT, CODE, ARCHIVE, APK, OTHER }

object FileTypes {
    val image = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif")
    val video = setOf("mp4", "mkv", "avi", "mov", "wmv", "3gp", "webm", "flv", "m4v", "ts")
    val audio = setOf("mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus", "amr", "mid", "midi")
    val pdf = setOf("pdf")
    val doc = setOf("doc", "docx", "hwp", "hwpx", "odt", "rtf")
    val sheet = setOf("xls", "xlsx", "csv", "ods", "cell")
    val slide = setOf("ppt", "pptx", "odp", "show")
    val text = setOf("txt", "md", "log", "ini", "cfg", "conf", "json", "xml", "yaml", "yml", "properties", "srt", "smi")
    val code = setOf("java", "kt", "js", "html", "htm", "css", "py", "c", "cpp", "h", "sh", "gradle", "kts", "sql")
    val archive = setOf("zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "alz", "egg")
    val apk = setOf("apk", "apks", "xapk")

    fun of(item: FItem): FileType = if (item.isDir) FileType.FOLDER else ofExt(item.ext)

    fun ofExt(e: String): FileType = when (e) {
        in image -> FileType.IMAGE
        in video -> FileType.VIDEO
        in audio -> FileType.AUDIO
        in pdf -> FileType.PDF
        in doc -> FileType.DOC
        in sheet -> FileType.SHEET
        in slide -> FileType.SLIDE
        in text -> FileType.TEXT
        in code -> FileType.CODE
        in archive -> FileType.ARCHIVE
        in apk -> FileType.APK
        else -> FileType.OTHER
    }

    fun isImage(name: String) = name.substringAfterLast('.', "").lowercase() in image

    fun mime(f: File): String {
        val e = f.extension.lowercase()
        return when (e) {
            "apk" -> "application/vnd.android.package-archive"
            "hwp" -> "application/x-hwp"
            "hwpx" -> "application/haansofthwpx"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(e) ?: "*/*"
        }
    }
}

enum class Category(val label: String) {
    IMAGES("이미지"), VIDEOS("동영상"), AUDIO("오디오"), DOCS("문서"),
    DOWNLOADS("다운로드"), APKS("설치 파일"), ARCHIVES("압축 파일"), RECENT("최근 파일")
}

enum class SortMode(val label: String) { NAME("이름"), DATE("수정한 날짜"), SIZE("크기"), TYPE("종류") }

data class Volume(val name: String, val path: String, val total: Long, val free: Long, val removable: Boolean) {
    val used: Long get() = total - free
    val ratio: Float get() = if (total > 0) used.toFloat() / total else 0f
}

fun Long.fmtSize(): String {
    if (this < 1024) return "$this B"
    val units = arrayOf("KB", "MB", "GB", "TB")
    var v = this / 1024.0
    var i = 0
    while (v >= 1024 && i < units.size - 1) { v /= 1024; i++ }
    return if (v >= 100) String.format(Locale.US, "%.0f %s", v, units[i]) else String.format(Locale.US, "%.1f %s", v, units[i])
}

private val dateFmt = SimpleDateFormat("yyyy.MM.dd HH:mm", Locale.KOREA)
fun Long.fmtDate(): String = dateFmt.format(Date(this))

fun sortItems(list: List<FItem>, mode: SortMode, asc: Boolean): List<FItem> {
    val cmp: Comparator<FItem> = when (mode) {
        SortMode.NAME -> compareBy { it.name.lowercase() }
        SortMode.DATE -> compareBy { it.modified }
        SortMode.SIZE -> compareBy<FItem> { if (it.isDir) it.childCount.toLong() else it.size }
        SortMode.TYPE -> compareBy<FItem> { it.ext }.thenBy { it.name.lowercase() }
    }
    val ordered = if (asc) cmp else cmp.reversed()
    return list.sortedWith(compareBy<FItem> { !it.isDir }.then(ordered))
}

object FileOps {
    val root: File get() = Environment.getExternalStorageDirectory()

    fun volumes(ctx: Context): List<Volume> {
        val out = mutableListOf<Volume>()
        runCatching { out += vol("내부 저장소", root, false) }
        runCatching {
            ctx.getExternalFilesDirs(null).drop(1).filterNotNull().forEach { d ->
                val r = File(d.absolutePath.substringBefore("/Android/"))
                if (r.exists()) out += vol("SD 카드", r, true)
            }
        }
        return out
    }

    private fun vol(name: String, f: File, removable: Boolean): Volume {
        val s = StatFs(f.path)
        return Volume(name, f.absolutePath, s.totalBytes, s.availableBytes, removable)
    }

    fun list(dir: File, showHidden: Boolean): List<FItem> =
        (dir.listFiles() ?: emptyArray())
            .filter { showHidden || !it.name.startsWith(".") }
            .map { it.toItem() }

    fun uniqueTarget(dir: File, name: String): File {
        var t = File(dir, name)
        if (!t.exists()) return t
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (t.exists()) { t = File(dir, "$base ($i)$ext"); i++ }
        return t
    }

    fun copy(src: File, destDir: File): File {
        val target = uniqueTarget(destDir, src.name)
        if (src.isDirectory) src.copyRecursively(target, overwrite = false)
        else src.copyTo(target, overwrite = false)
        target.setLastModified(src.lastModified())
        return target
    }

    fun move(src: File, destDir: File): File {
        if (src.parentFile?.absolutePath == destDir.absolutePath) return src
        val target = uniqueTarget(destDir, src.name)
        moveTo(src, target)
        return target
    }

    fun moveTo(src: File, target: File) {
        if (src.renameTo(target)) return
        if (src.isDirectory) src.copyRecursively(target, overwrite = false) else src.copyTo(target, overwrite = false)
        if (!src.deleteRecursively()) throw IOException("원본을 지우지 못했습니다: ${src.name}")
    }

    fun rename(src: File, newName: String): File {
        val t = File(src.parentFile, newName)
        if (t.exists()) throw IOException("같은 이름이 이미 있습니다")
        if (!src.renameTo(t)) throw IOException("이름을 바꾸지 못했습니다")
        return t
    }

    fun newFolder(dir: File, name: String): File {
        val f = File(dir, name)
        if (f.exists()) throw IOException("같은 이름이 이미 있습니다")
        if (!f.mkdirs()) throw IOException("폴더를 만들지 못했습니다")
        return f
    }

    fun newFile(dir: File, name: String): File {
        val f = File(dir, name)
        if (f.exists()) throw IOException("같은 이름이 이미 있습니다")
        if (!f.createNewFile()) throw IOException("파일을 만들지 못했습니다")
        return f
    }

    fun zip(files: List<File>, out: File) {
        ZipOutputStream(BufferedOutputStream(FileOutputStream(out))).use { zos ->
            for (f in files) {
                val base = f.parentFile ?: continue
                f.walkTopDown().forEach { x ->
                    if (x.absolutePath == out.absolutePath) return@forEach
                    val rel = x.relativeTo(base).path.replace('\\', '/')
                    if (x.isDirectory) {
                        zos.putNextEntry(ZipEntry("$rel/")); zos.closeEntry()
                    } else {
                        zos.putNextEntry(ZipEntry(rel).apply { time = x.lastModified() })
                        x.inputStream().use { it.copyTo(zos) }
                        zos.closeEntry()
                    }
                }
            }
        }
    }

    fun unzip(zip: File, destDir: File): File {
        val dest = uniqueTarget(destDir, zip.nameWithoutExtension)
        dest.mkdirs()
        try {
            unzipWith(zip, dest, Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            unzipWith(zip, dest, Charset.forName("CP949"))
        }
        return dest
    }

    private fun unzipWith(zip: File, dest: File, cs: Charset) {
        val canon = dest.canonicalPath
        ZipInputStream(BufferedInputStream(FileInputStream(zip)), cs).use { zis ->
            var e = zis.nextEntry
            while (e != null) {
                val out = File(dest, e.name)
                val cp = out.canonicalPath
                if (cp != canon && !cp.startsWith(canon + File.separator)) throw IOException("잘못된 압축 경로")
                if (e.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { zis.copyTo(it) }
                    if (e.time > 0) out.setLastModified(e.time)
                }
                e = zis.nextEntry
            }
        }
    }

    fun search(rootDir: File, q: String, showHidden: Boolean, limit: Int = 500): List<FItem> {
        val query = q.trim().lowercase()
        if (query.isEmpty()) return emptyList()
        return rootDir.walkTopDown()
            .onEnter { d -> (showHidden || !d.name.startsWith(".") || d == rootDir) && !d.absolutePath.endsWith("/Android/data") && !d.absolutePath.endsWith("/Android/obb") }
            .filter { it != rootDir && it.name.lowercase().contains(query) && (showHidden || !it.name.startsWith(".")) }
            .take(limit)
            .map { it.toItem() }
            .toList()
    }

    fun dirSize(f: File): Long = if (f.isFile) f.length() else f.walkTopDown().filter { it.isFile }.sumOf { it.length() }

    fun countFiles(f: File): Int = f.walkTopDown().count { it.isFile }

    // ---- MediaStore 기반 카테고리 ----
    fun category(ctx: Context, cat: Category, showHidden: Boolean): List<FItem> {
        if (cat == Category.DOWNLOADS) {
            val d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            return list(d, showHidden)
        }
        val col = MediaStore.Files.FileColumns.DATA
        val args = mutableListOf<String>()
        val sel: String = when (cat) {
            Category.IMAGES -> "${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}"
            Category.VIDEOS -> "${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO}"
            Category.AUDIO -> "${MediaStore.Files.FileColumns.MEDIA_TYPE}=${MediaStore.Files.FileColumns.MEDIA_TYPE_AUDIO}"
            Category.DOCS -> likeAny(col, FileTypes.pdf + FileTypes.doc + FileTypes.sheet + FileTypes.slide + setOf("txt"), args)
            Category.APKS -> likeAny(col, FileTypes.apk, args)
            Category.ARCHIVES -> likeAny(col, FileTypes.archive, args)
            Category.RECENT -> {
                args += ((System.currentTimeMillis() / 1000) - 30L * 24 * 3600).toString()
                "${MediaStore.Files.FileColumns.DATE_MODIFIED}>? AND ${MediaStore.Files.FileColumns.SIZE}>0"
            }
            Category.DOWNLOADS -> ""
        }
        val limit = if (cat == Category.RECENT) 300 else 5000
        return query(ctx, sel, args.toTypedArray(), "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC", limit, showHidden)
    }

    fun largestFiles(ctx: Context, limit: Int = 100): List<FItem> =
        query(ctx, "${MediaStore.Files.FileColumns.SIZE}>0", emptyArray(), "${MediaStore.Files.FileColumns.SIZE} DESC", limit, true)

    private fun likeAny(col: String, exts: Set<String>, args: MutableList<String>): String {
        exts.forEach { args += "%.$it" }
        return "(" + exts.joinToString(" OR ") { "$col LIKE ?" } + ")"
    }

    private fun query(ctx: Context, sel: String, args: Array<String>, order: String, limit: Int, showHidden: Boolean): List<FItem> {
        val out = ArrayList<FItem>()
        val uri = MediaStore.Files.getContentUri("external")
        val proj = arrayOf(MediaStore.Files.FileColumns.DATA)
        ctx.contentResolver.query(uri, proj, sel, args, order)?.use { c ->
            val i = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATA)
            while (c.moveToNext() && out.size < limit) {
                val p = c.getString(i) ?: continue
                if (!showHidden && p.contains("/.")) continue
                val f = File(p)
                if (f.isFile) out += f.toItem()
            }
        }
        return out
    }
}

// ---- 중복 파일 찾기 ----
object Duplicates {
    private const val MIN_SIZE = 1024L

    /** 같은 크기 → 같은 MD5 인 파일들을 묶어서 돌려줌. progress(현재, 전체) */
    fun find(showHidden: Boolean, trashDir: File, progress: (Int, Int) -> Unit): List<List<FItem>> {
        val root = FileOps.root
        val bySize = HashMap<Long, MutableList<File>>()
        root.walkTopDown()
            .onEnter { d ->
                d == root || ((showHidden || !d.name.startsWith(".")) &&
                    d.absolutePath != trashDir.absolutePath &&
                    !d.absolutePath.endsWith("/Android/data") && !d.absolutePath.endsWith("/Android/obb"))
            }
            .filter { it.isFile && (showHidden || !it.name.startsWith(".")) }
            .forEach { f ->
                val s = f.length()
                if (s >= MIN_SIZE) bySize.getOrPut(s) { mutableListOf() }.add(f)
            }
        val candidates = bySize.values.filter { it.size > 1 }
        val total = candidates.sumOf { it.size }
        var done = 0
        val groups = ArrayList<List<FItem>>()
        for (same in candidates) {
            val byHash = HashMap<String, MutableList<File>>()
            for (f in same) {
                val h = runCatching { md5(f) }.getOrNull()
                done++
                if (done % 5 == 0 || done == total) progress(done, total)
                if (h != null) byHash.getOrPut(h) { mutableListOf() }.add(f)
            }
            byHash.values.filter { it.size > 1 }.forEach { g ->
                groups += g.sortedBy { it.lastModified() }.map { it.toItem() }
            }
        }
        // 낭비 용량이 큰 묶음부터
        return groups.sortedByDescending { g -> g.first().size * (g.size - 1) }
    }

    private fun md5(f: File): String {
        val md = java.security.MessageDigest.getInstance("MD5")
        val buf = ByteArray(256 * 1024)
        FileInputStream(f).use { ins ->
            while (true) {
                val n = ins.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
