package kr.eumsoft.notepro

import kr.eumsoft.notepro.core.BackupArchive
import kr.eumsoft.notepro.core.BackupCrypto
import kr.eumsoft.notepro.core.CorruptDataException
import kr.eumsoft.notepro.core.Geometry
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.NotebookSnapshot
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.ShapeKind
import kr.eumsoft.notepro.core.ShapeRecognizer
import kr.eumsoft.notepro.core.SnapshotCodec
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.core.StrokeCodec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

class CoreTest {

    private fun line(x0: Float, y0: Float, x1: Float, y1: Float, n: Int = 40, jitter: Float = 0f, seed: Int = 1): FloatArray {
        val r = Random(seed)
        val out = FloatArray(n * 4)
        for (i in 0 until n) {
            val t = i / (n - 1f)
            out[i * 4] = x0 + (x1 - x0) * t + (r.nextFloat() - .5f) * jitter
            out[i * 4 + 1] = y0 + (y1 - y0) * t + (r.nextFloat() - .5f) * jitter
            out[i * 4 + 2] = 0.5f
        }
        return out
    }

    private fun stroke(points: FloatArray, id: String = Stroke.newId()) =
        Stroke(id, "page1", PenType.BALLPOINT, 0xFF000000.toInt(), 2f, 1f, points, 1L)

    @Test fun strokeCodecRoundTrip() {
        val p = line(0f, 0f, 100f, 50f, 100, 3f)
        assertArrayEquals(p, StrokeCodec.decode(StrokeCodec.encode(p)), 0f)
    }

    @Test fun strokeCodecDetectsCorruption() {
        val b = StrokeCodec.encode(line(0f, 0f, 10f, 10f))
        b[20] = (b[20] + 1).toByte()
        try { StrokeCodec.decode(b); fail("should detect") } catch (e: CorruptDataException) { }
        try { StrokeCodec.decode(b.copyOf(b.size - 3)); fail("should detect truncation") } catch (e: CorruptDataException) { }
    }

    @Test fun recognizesLine() {
        val r = ShapeRecognizer.recognize(line(10f, 10f, 200f, 14f, 60, 2f))
        assertNotNull(r); assertEquals(ShapeKind.LINE, r!!.kind)
    }

    @Test fun recognizesCircle() {
        val n = 80
        val pts = FloatArray(n * 4)
        val rnd = Random(3)
        for (i in 0 until n) {
            val a = 2 * PI * i / (n - 1)
            pts[i * 4] = 100f + (60 * cos(a)).toFloat() + rnd.nextFloat() * 2
            pts[i * 4 + 1] = 100f + (60 * sin(a)).toFloat() + rnd.nextFloat() * 2
            pts[i * 4 + 2] = .5f
        }
        val r = ShapeRecognizer.recognize(pts)
        assertNotNull(r); assertEquals(ShapeKind.CIRCLE, r!!.kind)
    }

    @Test fun recognizesRectangle() {
        val pts = line(0f, 0f, 200f, 0f, 30, 1.5f, 1) + line(200f, 0f, 200f, 120f, 20, 1.5f, 2) +
            line(200f, 120f, 0f, 120f, 30, 1.5f, 3) + line(0f, 120f, 0f, 2f, 20, 1.5f, 4)
        val r = ShapeRecognizer.recognize(pts)
        assertNotNull(r); assertEquals(ShapeKind.RECT, r!!.kind)
    }

    @Test fun scribbleIsNotAShape() {
        val rnd = Random(9)
        val pts = FloatArray(200) { if (it % 4 == 2) .5f else if (it % 4 == 3) 0f else rnd.nextFloat() * 100 }
        val r = ShapeRecognizer.recognize(pts)
        assertTrue(r == null || r.kind != ShapeKind.LINE)
    }

    @Test fun strokeEraserHits() {
        val s = stroke(line(0f, 0f, 100f, 0f))
        assertTrue(Geometry.hitStroke(s, 50f, 3f, 2f))
        assertTrue(!Geometry.hitStroke(s, 50f, 30f, 2f))
    }

    @Test fun areaEraserSplitsStroke() {
        val s = stroke(line(0f, 0f, 100f, 0f, 101))
        val pieces = Geometry.eraseArea(s, 50f, 0f, 5f)
        assertNotNull(pieces)
        assertEquals(2, pieces!!.size)
        assertNull(Geometry.eraseArea(s, 50f, 40f, 5f))
    }

    @Test fun lassoSelectsInside() {
        val a = stroke(line(10f, 10f, 20f, 20f))
        val b = stroke(line(200f, 200f, 220f, 220f))
        val sel = Geometry.lassoSelect(listOf(a, b), floatArrayOf(0f, 0f, 50f, 0f, 50f, 50f, 0f, 50f))
        assertEquals(listOf(a.id), sel.map { it.id })
    }

    @Test fun transformMovesAndScales() {
        val s = stroke(line(0f, 0f, 10f, 0f, 2))
        val m = Geometry.transform(s, Geometry.Affine.translate(5f, 7f))
        assertEquals(5f, m.points[0], 1e-4f); assertEquals(7f, m.points[1], 1e-4f)
        val k = Geometry.transform(s, Geometry.Affine.scaleAbout(2f, 0f, 0f))
        assertEquals(20f, k.points[4], 1e-4f); assertEquals(4f, k.width, 1e-4f)
    }

    private fun sampleSnapshot(): NotebookSnapshot {
        val nb = NotebookData("nb1", null, "회의록 테스트", "설명", 0x112233, true, false, false, 1, 2, 3, false, listOf("업무", "회의"))
        val pg = PageData("page1", "nb1", 0, 595f, 842f, PaperStyle.LINED, PageTemplate.MEETING, createdAt = 1, updatedAt = 2)
        val strokes = (0 until 500).map { stroke(line(0f, it.toFloat(), 300f, it + 5f, 30, 1f, it), "s$it") }
        val el = kr.eumsoft.notepro.core.PageElement("e1", "page1", "nb1", "text", 10f, 20f, 200f, "AI 요약: " + "가".repeat(40000), author = "ai", createdAt = 5)
        return NotebookSnapshot(nb, listOf(pg.copy(rotation = 90, bookmarked = true)), strokes, listOf(el))
    }

    @Test fun snapshotRoundTrip() {
        val s = sampleSnapshot()
        val back = SnapshotCodec.decode(SnapshotCodec.encode(s))
        assertEquals(s.notebook, back.notebook)
        assertEquals(s.pages, back.pages)
        assertEquals(500, back.strokes.size)
        assertArrayEquals(s.strokes[123].points, back.strokes[123].points, 0f)
        assertEquals(s.elements, back.elements)
    }

    @Test fun snapshotTruncationDetected() {
        val b = SnapshotCodec.encode(sampleSnapshot())
        try { SnapshotCodec.decode(b.copyOf(b.size / 2)); fail("should detect") } catch (e: CorruptDataException) { }
    }

    @Test fun encryptedBackupRoundTripAndIntegrity() {
        val snap = SnapshotCodec.encode(sampleSnapshot())
        val big = Random(5).nextBytes(3 * 1024 * 1024 + 17) // 압축되지 않는 데이터 → 여러 조각 생성
        val zip = ByteArrayOutputStream()
        BackupArchive.write(zip, listOf(BackupArchive.Entry("notebooks/nb1.snap", snap), BackupArchive.Entry("attachments/a.pdf", big)), 42)
        val enc = ByteArrayOutputStream()
        BackupCrypto.encrypt(ByteArrayInputStream(zip.toByteArray()), enc, "비밀번호1".toCharArray(), 10_000)
        val dec = ByteArrayOutputStream()
        BackupCrypto.decrypt(ByteArrayInputStream(enc.toByteArray()), dec, "비밀번호1".toCharArray())
        val entries = BackupArchive.read(ByteArrayInputStream(dec.toByteArray()))
        assertEquals(2, entries.size)
        assertArrayEquals(big, entries.first { it.name == "attachments/a.pdf" }.bytes)

        try {
            BackupCrypto.decrypt(ByteArrayInputStream(enc.toByteArray()), ByteArrayOutputStream(), "틀림".toCharArray())
            fail("wrong password")
        } catch (e: BackupCrypto.WrongPasswordOrDamaged) { }

        val cut = enc.toByteArray().copyOf(enc.size() - 1024 * 1024 - 40) // 마지막 조각 잘라내기
        try {
            BackupCrypto.decrypt(ByteArrayInputStream(cut), ByteArrayOutputStream(), "비밀번호1".toCharArray())
            fail("truncation")
        } catch (e: Exception) { }
    }
}
