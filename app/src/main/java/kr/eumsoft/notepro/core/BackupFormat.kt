package kr.eumsoft.notepro.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
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
 * 암호화 백업 파일(.npbak).
 *
 * 헤더: "NPBK" | ver(1) | iter(int) | salt(16) | ivPrefix(8)
 * 본문: 1MiB 단위 AES-256-GCM 조각 [len(int)][ciphertext+tag]
 *   - 조각 IV = ivPrefix(8) + 조각번호(4)
 *   - AAD = 조각번호 + 마지막 조각 여부 → 순서 바꾸기·잘라내기 감지
 * 평문: ZIP (manifest.txt + 각 항목). manifest에 항목별 SHA-256 기록 → 가져올 때 검증.
 */
object BackupCrypto {
    private val MAGIC = "NPBK".toByteArray()
    private const val VER: Byte = 1
    private const val CHUNK = 1 shl 20
    const val DEFAULT_ITER = 120_000

    private fun key(password: CharArray, salt: ByteArray, iter: Int): SecretKeySpec {
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val k = f.generateSecret(PBEKeySpec(password, salt, iter, 256)).encoded
        return SecretKeySpec(k, "AES")
    }

    private fun aad(index: Int, last: Boolean) = ByteBuffer.allocate(5).putInt(index).put(if (last) 1 else 0).array()
    private fun iv(prefix: ByteArray, index: Int) = ByteBuffer.allocate(12).put(prefix).putInt(index).array()

    /** 평문 스트림을 암호화해 out에 쓴다. */
    fun encrypt(plain: InputStream, out: OutputStream, password: CharArray, iter: Int = DEFAULT_ITER) {
        val rnd = SecureRandom()
        val salt = ByteArray(16).also { rnd.nextBytes(it) }
        val prefix = ByteArray(8).also { rnd.nextBytes(it) }
        val k = key(password, salt, iter)
        val d = DataOutputStream(out)
        d.write(MAGIC); d.writeByte(VER.toInt()); d.writeInt(iter); d.write(salt); d.write(prefix)
        var idx = 0
        var cur = readChunk(plain)
        while (true) {
            val next = if (cur.size == CHUNK) readChunk(plain) else ByteArray(0)
            val last = next.isEmpty()
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, k, GCMParameterSpec(128, iv(prefix, idx)))
            c.updateAAD(aad(idx, last))
            val ct = c.doFinal(cur)
            d.writeInt(ct.size); d.write(ct)
            idx++
            if (last) break
            cur = next
        }
        d.flush()
    }

    fun decrypt(input: InputStream, out: OutputStream, password: CharArray) {
        val d = DataInputStream(input)
        try {
            val m = ByteArray(4); d.readFully(m)
            if (!m.contentEquals(MAGIC)) throw CorruptDataException("not a NotePro backup")
            val ver = d.readByte()
            if (ver != VER) throw CorruptDataException("unsupported backup version $ver")
            val iter = d.readInt()
            if (iter !in 10_000..5_000_000) throw CorruptDataException("bad header")
            val salt = ByteArray(16); d.readFully(salt)
            val prefix = ByteArray(8); d.readFully(prefix)
            val k = key(password, salt, iter)
            var idx = 0
            var len = d.readInt()
            while (true) {
                if (len < 16 || len > CHUNK + 16) throw CorruptDataException("bad chunk")
                val ct = ByteArray(len); d.readFully(ct)
                val nextLen = try { d.readInt() } catch (e: EOFException) { -1 }
                val last = nextLen == -1
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, iv(prefix, idx)))
                c.updateAAD(aad(idx, last))
                out.write(c.doFinal(ct))
                idx++
                if (last) break
                len = nextLen
            }
        } catch (e: AEADBadTagException) {
            throw WrongPasswordOrDamaged()
        } catch (e: EOFException) {
            throw CorruptDataException("backup truncated")
        }
    }

    private fun readChunk(i: InputStream): ByteArray {
        val buf = ByteArray(CHUNK)
        var n = 0
        while (n < CHUNK) {
            val r = i.read(buf, n, CHUNK - n)
            if (r < 0) break
            n += r
        }
        return if (n == CHUNK) buf else buf.copyOf(n)
    }

    class WrongPasswordOrDamaged : Exception("wrong password or damaged backup")
}

/** 백업 ZIP 내용(평문). */
object BackupArchive {
    const val FORMAT = "notepro-backup-1"

    class Entry(val name: String, val bytes: ByteArray)

    fun write(out: OutputStream, entries: List<Entry>, createdAt: Long) {
        val zos = ZipOutputStream(out)
        val manifest = StringBuilder()
        manifest.append("format=").append(FORMAT).append('\n')
        manifest.append("created=").append(createdAt).append('\n')
        manifest.append("count=").append(entries.size).append('\n')
        for (e in entries) manifest.append("sha256 ").append(sha(e.bytes)).append(' ').append(e.name).append('\n')
        zos.putNextEntry(ZipEntry("manifest.txt")); zos.write(manifest.toString().toByteArray()); zos.closeEntry()
        for (e in entries) { zos.putNextEntry(ZipEntry(e.name)); zos.write(e.bytes); zos.closeEntry() }
        zos.finish(); zos.flush()
    }

    /** 무결성 검사 후 항목 반환. 한 항목이라도 해시가 다르면 예외. */
    fun read(input: InputStream): List<Entry> {
        val zis = ZipInputStream(input)
        val map = LinkedHashMap<String, ByteArray>()
        while (true) {
            val e = zis.nextEntry ?: break
            if (e.name.contains("..")) throw CorruptDataException("bad entry name")
            val bos = ByteArrayOutputStream()
            zis.copyTo(bos)
            map[e.name] = bos.toByteArray()
        }
        val manifest = map.remove("manifest.txt")?.toString(Charsets.UTF_8) ?: throw CorruptDataException("no manifest")
        val lines = manifest.lines()
        if (lines.firstOrNull() != "format=$FORMAT") throw CorruptDataException("unknown backup format")
        val expected = lines.filter { it.startsWith("sha256 ") }.associate {
            val parts = it.split(' ', limit = 3); parts[2] to parts[1]
        }
        val count = lines.firstOrNull { it.startsWith("count=") }?.substringAfter('=')?.toIntOrNull()
        if (count != expected.size || expected.size != map.size) throw CorruptDataException("entry count mismatch")
        for ((name, bytes) in map) {
            if (expected[name] != sha(bytes)) throw CorruptDataException("checksum mismatch: $name")
        }
        return map.map { Entry(it.key, it.value) }
    }

    fun sha(b: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
}
