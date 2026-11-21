package kr.eumsoft.purchasenote.backup

import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.PurchaseImage
import kr.eumsoft.purchasenote.data.Status
import kr.eumsoft.purchasenote.data.StoredImage
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * 암호화 백업 파일 형식 (안드로이드 의존성 없음 → JVM 단위 테스트로 검증)
 *  "EUMPNB01"(8) | PBKDF2 반복수(4) | salt(16) | iv(12) | AES-256-GCM(zip)
 *  zip: data.json + images/<파일명>
 */
object BackupFormat {
    private val MAGIC = "EUMPNB01".toByteArray(Charsets.US_ASCII)
    private const val ITER = 120_000
    const val SCHEMA = 1

    class WrongPassword : Exception("wrong password")
    class Corrupt(msg: String) : Exception(msg)

    data class Payload(val purchases: List<Purchase>, val images: List<StoredImage>, val links: List<PurchaseImage>, val files: Map<String, ByteArray>)

    private fun key(pw: CharArray, salt: ByteArray, iter: Int): SecretKeySpec {
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val k = f.generateSecret(PBEKeySpec(pw, salt, iter, 256)).encoded
        return SecretKeySpec(k, "AES")
    }

    fun encrypt(plain: ByteArray, pw: CharArray, iter: Int = ITER): ByteArray {
        val rnd = SecureRandom(); val salt = ByteArray(16).also(rnd::nextBytes); val iv = ByteArray(12).also(rnd::nextBytes)
        val header = ByteBuffer.allocate(8 + 4 + 16 + 12).put(MAGIC).putInt(iter).put(salt).put(iv).array()
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key(pw, salt, iter), GCMParameterSpec(128, iv))
        c.updateAAD(header)
        return header + c.doFinal(plain)
    }

    fun decrypt(file: ByteArray, pw: CharArray): ByteArray {
        if (file.size < 40 + 16 || !file.copyOfRange(0, 8).contentEquals(MAGIC)) throw Corrupt("not a backup file")
        val bb = ByteBuffer.wrap(file); bb.position(8)
        val iter = bb.int
        if (iter !in 10_000..2_000_000) throw Corrupt("bad header")
        val salt = ByteArray(16).also { bb.get(it) }; val iv = ByteArray(12).also { bb.get(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(pw, salt, iter), GCMParameterSpec(128, iv))
        c.updateAAD(file, 0, 40)
        return try { c.doFinal(file, 40, file.size - 40) }
        catch (e: AEADBadTagException) { throw WrongPassword() } // 틀린 암호와 변조를 구분할 수 없음 → 둘 다 "암호가 틀렸거나 파일이 손상됨"
    }

    private fun JSONObject.optStr(k: String): String? = if (isNull(k) || !has(k)) null else getString(k)
    private fun JSONObject.optLongOrNull(k: String): Long? = if (isNull(k) || !has(k)) null else getLong(k)

    fun toZip(p: Payload): ByteArray {
        val root = JSONObject().put("schema", SCHEMA).put("app", "kr.eumsoft.purchasenote")
        root.put("purchases", JSONArray().apply { p.purchases.forEach { put(JSONObject().apply {
            put("id", it.id); put("orderKey", it.orderKey); put("productName", it.productName)
            put("store", it.store ?: JSONObject.NULL); put("orderDate", it.orderDate ?: JSONObject.NULL)
            put("amountMinor", it.amountMinor ?: JSONObject.NULL); put("currency", it.currency ?: JSONObject.NULL)
            put("orderNumber", it.orderNumber ?: JSONObject.NULL); put("link", it.link ?: JSONObject.NULL); put("memo", it.memo ?: JSONObject.NULL)
            put("status", it.status.name); put("returnBy", it.returnBy ?: JSONObject.NULL); put("exchangeBy", it.exchangeBy ?: JSONObject.NULL)
            put("warrantyBy", it.warrantyBy ?: JSONObject.NULL); put("remindDays", it.remindDays); put("remindMinute", it.remindMinute)
            put("needsReview", it.needsReview); put("createdAt", it.createdAt); put("updatedAt", it.updatedAt)
        }) } })
        root.put("images", JSONArray().apply { p.images.forEach { put(JSONObject().put("id", it.id).put("fileName", it.fileName)
            .put("sha256", it.sha256).put("mime", it.mime).put("ocrText", it.ocrText ?: JSONObject.NULL).put("createdAt", it.createdAt)) } })
        root.put("links", JSONArray().apply { p.links.forEach { put(JSONObject().put("p", it.purchaseId).put("i", it.imageId)) } })
        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { z ->
            z.putNextEntry(ZipEntry("data.json")); z.write(root.toString().toByteArray(Charsets.UTF_8)); z.closeEntry()
            p.files.forEach { (name, bytes) -> z.putNextEntry(ZipEntry("images/$name")); z.write(bytes); z.closeEntry() }
        }
        return bos.toByteArray()
    }

    /** zip → Payload. 구조가 맞지 않거나 참조하는 사진이 없으면 Corrupt */
    fun fromZip(zip: ByteArray): Payload {
        var json: String? = null; val files = HashMap<String, ByteArray>()
        try {
            ZipInputStream(ByteArrayInputStream(zip)).use { z ->
                while (true) {
                    val e = z.nextEntry ?: break
                    val n = e.name
                    if (n.contains("..") || n.startsWith("/")) throw Corrupt("bad entry")
                    val b = z.readBytes()
                    if (n == "data.json") json = String(b, Charsets.UTF_8)
                    else if (n.startsWith("images/")) files[n.removePrefix("images/")] = b
                }
            }
        } catch (e: Corrupt) { throw e } catch (e: Exception) { throw Corrupt("zip") }
        val root = try { JSONObject(json ?: throw Corrupt("no data")) } catch (e: Corrupt) { throw e } catch (e: Exception) { throw Corrupt("json") }
        if (root.optInt("schema", -1) != SCHEMA) throw Corrupt("schema")
        try {
            val ps = root.getJSONArray("purchases").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
                Purchase(id = o.getLong("id"), orderKey = o.getString("orderKey"), productName = o.getString("productName"),
                    store = o.optStr("store"), orderDate = o.optLongOrNull("orderDate"), amountMinor = o.optLongOrNull("amountMinor"),
                    currency = o.optStr("currency"), orderNumber = o.optStr("orderNumber"), link = o.optStr("link"), memo = o.optStr("memo"),
                    status = runCatching { Status.valueOf(o.getString("status")) }.getOrDefault(Status.KEEPING),
                    returnBy = o.optLongOrNull("returnBy"), exchangeBy = o.optLongOrNull("exchangeBy"), warrantyBy = o.optLongOrNull("warrantyBy"),
                    remindDays = o.optString("remindDays", "3,0"), remindMinute = o.optInt("remindMinute", 540),
                    needsReview = o.optBoolean("needsReview", false), createdAt = o.getLong("createdAt"), updatedAt = o.getLong("updatedAt"))
            } }
            val imgs = root.getJSONArray("images").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
                StoredImage(id = o.getLong("id"), fileName = o.getString("fileName"), sha256 = o.getString("sha256"), mime = o.getString("mime"),
                    ocrText = o.optStr("ocrText"), createdAt = o.getLong("createdAt"))
            } }
            val links = root.getJSONArray("links").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { PurchaseImage(it.getLong("p"), it.getLong("i")) } }
            val pIds = ps.map { it.id }.toSet(); val iIds = imgs.map { it.id }.toSet()
            if (pIds.size != ps.size || iIds.size != imgs.size) throw Corrupt("dup id")
            if (links.any { it.purchaseId !in pIds || it.imageId !in iIds }) throw Corrupt("link")
            if (imgs.any { it.fileName !in files || it.fileName.contains('/') }) throw Corrupt("missing image")
            return Payload(ps, imgs, links, files.filterKeys { k -> imgs.any { it.fileName == k } })
        } catch (e: Corrupt) { throw e } catch (e: Exception) { throw Corrupt("fields") }
    }
}
