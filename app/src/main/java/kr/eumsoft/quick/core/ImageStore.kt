package kr.eumsoft.quick.core

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.MediaStore
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.io.IOException
import java.util.Date

class SaveException(msg: String) : Exception(msg)

/** 이미지 저장(갤러리 폴더 또는 사용자가 고른 폴더). 저장이 끝난 뒤에만 Uri를 돌려준다. */
class ImageStore(private val ctx: Context) {
    private val prefs = Prefs(ctx)
    private val res = ctx.contentResolver

    data class Saved(val uri: Uri, val name: String)

    fun newBaseName(): String = FileNames.build(prefs.namePattern, Date())

    @Throws(SaveException::class)
    fun save(bmp: Bitmap, baseName: String): Saved {
        val jpeg = prefs.jpeg
        val ext = if (jpeg) "jpg" else "png"
        val mime = if (jpeg) "image/jpeg" else "image/png"
        val free = try { StatFs(Environment.getExternalStorageDirectory().path).availableBytes } catch (e: Exception) { Long.MAX_VALUE }
        if (free < 20L * 1024 * 1024) throw SaveException("저장 공간이 부족합니다 (남은 공간 ${free / 1024 / 1024}MB)")
        val tree = prefs.treeUri
        return if (tree.isNotEmpty()) saveToTree(Uri.parse(tree), bmp, baseName, ext, mime, jpeg)
        else saveToGallery(bmp, baseName, ext, mime, jpeg)
    }

    private fun compress(bmp: Bitmap, out: java.io.OutputStream, jpeg: Boolean) {
        val ok = bmp.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, prefs.jpegQuality, out)
        if (!ok) throw IOException("이미지 변환 실패")
    }

    private fun saveToGallery(bmp: Bitmap, base: String, ext: String, mime: String, jpeg: Boolean): Saved {
        val folder = prefs.folderName.ifBlank { "EUM_QUICK" }.replace(Regex("[\\\\:*?\"<>|]"), "_")
        val rel = "${Environment.DIRECTORY_PICTURES}/$folder/"
        val existing = HashSet<String>()
        res.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Images.Media.DISPLAY_NAME),
            "${MediaStore.Images.Media.RELATIVE_PATH}=?", arrayOf(rel), null
        )?.use { c -> while (c.moveToNext()) existing.add(c.getString(0).substringBeforeLast('.')) }
        val name = FileNames.unique(base) { it in existing }
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "$name.$ext")
            put(MediaStore.Images.Media.MIME_TYPE, mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, rel)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = res.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw SaveException("저장 폴더를 만들 수 없습니다")
        try {
            (res.openOutputStream(uri) ?: throw IOException("파일을 열 수 없음")).use { compress(bmp, it, jpeg) }
            res.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            try { res.delete(uri, null, null) } catch (_: Exception) {}
            throw SaveException("저장 실패: ${e.message ?: "알 수 없는 오류"} (저장 공간을 확인하세요)")
        }
        return Saved(uri, "$name.$ext")
    }

    private fun saveToTree(tree: Uri, bmp: Bitmap, base: String, ext: String, mime: String, jpeg: Boolean): Saved {
        val docId = DocumentsContract.getTreeDocumentId(tree)
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
        val existing = HashSet<String>()
        try {
            res.query(
                DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId),
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null
            )?.use { c -> while (c.moveToNext()) existing.add(c.getString(0).substringBeforeLast('.')) }
        } catch (e: Exception) {
            throw SaveException("선택한 저장 폴더에 접근할 수 없습니다. 설정에서 폴더를 다시 선택하세요.")
        }
        val name = FileNames.unique(base) { it in existing }
        val uri = try { DocumentsContract.createDocument(res, parent, mime, name) } catch (e: Exception) { null }
            ?: throw SaveException("선택한 폴더에 파일을 만들 수 없습니다. 설정에서 폴더를 다시 선택하세요.")
        try {
            (res.openOutputStream(uri) ?: throw IOException("파일을 열 수 없음")).use { compress(bmp, it, jpeg) }
        } catch (e: Exception) {
            try { DocumentsContract.deleteDocument(res, uri) } catch (_: Exception) {}
            throw SaveException("저장 실패: ${e.message ?: "알 수 없는 오류"} (저장 공간을 확인하세요)")
        }
        return Saved(uri, "$name.$ext")
    }

    fun delete(uri: String): Boolean {
        if (uri.isEmpty()) return true
        val u = Uri.parse(uri)
        return try {
            if (DocumentsContract.isDocumentUri(ctx, u) && u.authority != MediaStore.AUTHORITY) DocumentsContract.deleteDocument(res, u)
            else res.delete(u, null, null) > 0
        } catch (e: Exception) { false }
    }

    companion object {
        /** Uri에서 비트맵 읽기(편집 가능한 소프트웨어 비트맵, 긴 변 최대 maxSide) */
        fun load(ctx: Context, uri: Uri, maxSide: Int = 4096): Bitmap {
            val src = ImageDecoder.createSource(ctx.contentResolver, uri)
            return ImageDecoder.decodeBitmap(src) { d, info, _ ->
                d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                d.isMutableRequired = true
                val big = maxOf(info.size.width, info.size.height)
                if (big > maxSide) {
                    val s = maxSide.toFloat() / big
                    d.setTargetSize((info.size.width * s).toInt(), (info.size.height * s).toInt())
                }
            }
        }
    }
}

/** 기기 내부 OCR (ML Kit 한국어 모델: 한국어·영어·숫자) */
object Ocr {
    private val client by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }
    fun run(bmp: Bitmap, cb: (Text?, Exception?) -> Unit) {
        try {
            client.process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener { cb(it, null) }
                .addOnFailureListener { cb(null, it) }
        } catch (e: Exception) { cb(null, e) }
    }
}
