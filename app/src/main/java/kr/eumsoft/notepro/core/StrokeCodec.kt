package kr.eumsoft.notepro.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32

/**
 * 획 좌표 이진 형식(NPS1).
 *  [4] magic 'N','P','S','1'
 *  [4] 점 개수 n
 *  [n*4*4] float (x,y,pressure,tilt)
 *  [4] CRC32 (앞의 전체 바이트)
 * 손상된 데이터는 CRC 불일치로 감지된다.
 */
object StrokeCodec {
    private val MAGIC = byteArrayOf('N'.code.toByte(), 'P'.code.toByte(), 'S'.code.toByte(), '1'.code.toByte())

    fun encode(points: FloatArray): ByteArray {
        require(points.size % Stroke.STRIDE == 0) { "points stride" }
        val n = points.size / Stroke.STRIDE
        val buf = ByteBuffer.allocate(8 + points.size * 4 + 4).order(ByteOrder.LITTLE_ENDIAN)
        buf.put(MAGIC)
        buf.putInt(n)
        for (f in points) buf.putFloat(f)
        val crc = CRC32().apply { update(buf.array(), 0, buf.position()) }.value
        buf.putInt(crc.toInt())
        return buf.array()
    }

    fun decode(bytes: ByteArray): FloatArray {
        if (bytes.size < 12) throw CorruptDataException("too short")
        for (i in 0 until 4) if (bytes[i] != MAGIC[i]) throw CorruptDataException("bad magic")
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        buf.position(4)
        val n = buf.int
        if (n < 0 || bytes.size != 8 + n * Stroke.STRIDE * 4 + 4) throw CorruptDataException("bad length")
        val crc = CRC32().apply { update(bytes, 0, bytes.size - 4) }.value.toInt()
        val stored = ByteBuffer.wrap(bytes, bytes.size - 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
        if (crc != stored) throw CorruptDataException("crc mismatch")
        val out = FloatArray(n * Stroke.STRIDE)
        for (i in out.indices) out[i] = buf.float
        return out
    }
}
