package kr.eumsoft.notepro.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * 노트 한 권의 스냅샷 이진 형식(NPSNAP, gzip). 버전 복구 지점·백업에 사용한다.
 * 끝에 "END!" 표식이 있어야 정상 — 중간에 잘린 파일은 손상으로 판정.
 */
object SnapshotCodec {
    private const val MAGIC = 0x4E50534E // 'NPSN'
    private const val VERSION = 1
    private const val END = 0x454E4421 // 'END!'

    fun encode(s: NotebookSnapshot): ByteArray {
        val bos = ByteArrayOutputStream()
        DataOutputStream(GZIPOutputStream(bos)).use { o ->
            o.writeInt(MAGIC); o.writeInt(VERSION)
            val n = s.notebook
            o.writeUTF(n.id); writeNullable(o, n.folderId); o.writeUTF(n.title); o.writeUTF(n.description)
            o.writeInt(n.coverColor); o.writeBoolean(n.favorite); o.writeBoolean(n.locked); o.writeBoolean(n.infinite)
            o.writeLong(n.createdAt); o.writeLong(n.updatedAt); o.writeLong(n.openedAt)
            o.writeInt(n.tags.size); n.tags.forEach { o.writeUTF(it) }
            o.writeInt(s.pages.size)
            for (p in s.pages) {
                o.writeUTF(p.id); o.writeInt(p.index); o.writeFloat(p.width); o.writeFloat(p.height)
                o.writeUTF(p.paper.key); o.writeUTF(p.template.key); o.writeInt(p.bgType)
                writeNullable(o, p.attachmentId); o.writeInt(p.pdfPage); o.writeLong(p.createdAt); o.writeLong(p.updatedAt)
            }
            o.writeInt(s.strokes.size)
            for (st in s.strokes) {
                o.writeUTF(st.id); o.writeUTF(st.pageId); o.writeInt(st.pen.code); o.writeInt(st.color)
                o.writeFloat(st.width); o.writeFloat(st.opacity); o.writeInt(st.shape); o.writeLong(st.createdAt)
                val blob = StrokeCodec.encode(st.points)
                o.writeInt(blob.size); o.write(blob)
            }
            o.writeInt(END)
        }
        return bos.toByteArray()
    }

    fun decode(bytes: ByteArray): NotebookSnapshot {
        try {
            DataInputStream(GZIPInputStream(ByteArrayInputStream(bytes))).use { i ->
                if (i.readInt() != MAGIC) throw CorruptDataException("bad snapshot magic")
                val ver = i.readInt()
                if (ver > VERSION) throw CorruptDataException("snapshot from newer app version $ver")
                val nb = NotebookData(
                    id = i.readUTF(), folderId = readNullable(i), title = i.readUTF(), description = i.readUTF(),
                    coverColor = i.readInt(), favorite = i.readBoolean(), locked = i.readBoolean(), infinite = i.readBoolean(),
                    createdAt = i.readLong(), updatedAt = i.readLong(), openedAt = i.readLong(), deleted = false,
                    tags = List(i.readInt()) { i.readUTF() },
                )
                val pages = List(i.readInt()) {
                    PageData(
                        id = i.readUTF(), notebookId = nb.id, index = i.readInt(), width = i.readFloat(), height = i.readFloat(),
                        paper = PaperStyle.of(i.readUTF()), template = PageTemplate.of(i.readUTF()), bgType = i.readInt(),
                        attachmentId = readNullable(i), pdfPage = i.readInt(), createdAt = i.readLong(), updatedAt = i.readLong(),
                    )
                }
                val strokes = List(i.readInt()) {
                    val id = i.readUTF(); val pageId = i.readUTF(); val pen = PenType.fromCode(i.readInt()); val color = i.readInt()
                    val w = i.readFloat(); val op = i.readFloat(); val shape = i.readInt(); val created = i.readLong()
                    val len = i.readInt()
                    if (len < 0 || len > 64 * 1024 * 1024) throw CorruptDataException("bad blob length")
                    val blob = ByteArray(len); i.readFully(blob)
                    Stroke(id, pageId, pen, color, w, op, StrokeCodec.decode(blob), created, shape)
                }
                if (i.readInt() != END) throw CorruptDataException("snapshot truncated")
                return NotebookSnapshot(nb, pages, strokes)
            }
        } catch (e: EOFException) {
            throw CorruptDataException("snapshot truncated")
        } catch (e: java.util.zip.ZipException) {
            throw CorruptDataException("snapshot gzip damaged")
        }
    }

    private fun writeNullable(o: DataOutputStream, s: String?) { o.writeBoolean(s != null); if (s != null) o.writeUTF(s) }
    private fun readNullable(i: DataInputStream): String? = if (i.readBoolean()) i.readUTF() else null

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
