package kr.eumsoft.purchasenote.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** 사용자가 공유·선택한 이미지를 앱 전용 저장소로 복사한다. 갤러리 원본은 건드리지 않는다. */
object ImageStore {
    const val MAX_BYTES = 40L * 1024 * 1024

    class ImportError(val reason: Reason) : Exception(reason.name)
    enum class Reason { NOT_IMAGE, TOO_LARGE, COPY_FAILED }

    fun dir(c: Context) = File(c.filesDir, "receipts").apply { mkdirs() }
    fun file(c: Context, name: String) = File(dir(c), name)

    data class Copied(val temp: File, val sha256: String, val mime: String)

    /** 임시 파일로 복사하며 SHA-256 계산. 이미지가 아니거나 너무 크면 ImportError */
    fun copyToTemp(c: Context, uri: Uri): Copied {
        val tmp = File(c.cacheDir, "import-" + UUID.randomUUID())
        try {
            val input: InputStream = c.contentResolver.openInputStream(uri) ?: throw ImportError(Reason.COPY_FAILED)
            val md = MessageDigest.getInstance("SHA-256")
            var total = 0L
            input.use { ins ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = ins.read(buf); if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw ImportError(Reason.TOO_LARGE)
                        md.update(buf, 0, n); out.write(buf, 0, n)
                    }
                }
            }
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(tmp.path, o)
            if (o.outWidth <= 0 || o.outHeight <= 0) throw ImportError(Reason.NOT_IMAGE)
            val mime = o.outMimeType ?: "image/*"
            return Copied(tmp, md.digest().joinToString("") { "%02x".format(it) }, mime)
        } catch (e: ImportError) { tmp.delete(); throw e }
        catch (e: SecurityException) { tmp.delete(); throw ImportError(Reason.COPY_FAILED) }
        catch (e: Exception) { tmp.delete(); throw ImportError(Reason.COPY_FAILED) }
    }

    fun extFor(mime: String) = when (mime) { "image/png" -> "png"; "image/webp" -> "webp"; "image/gif" -> "gif"; "image/heif", "image/heic" -> "heic"; else -> "jpg" }

    /** 메모리에 맞게 줄여서 읽고 EXIF 회전을 반영. 실패하면 null */
    fun loadBitmap(f: File, maxSide: Int): Bitmap? = try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var sample = 1
        while (maxOf(o.outWidth, o.outHeight) / sample > maxSide) sample *= 2
        val bmp = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
        if (bmp == null) null else {
            val rot = try {
                when (ExifInterface(f.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f
                }
            } catch (e: Exception) { 0f }
            if (rot == 0f) bmp else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot) }, true)
        }
    } catch (e: OutOfMemoryError) { null } catch (e: Exception) { null }
}
