package kr.eumsoft.notepro.core

import java.util.UUID

/** 펜 종류. code 값은 DB·백업 파일에 저장되므로 절대 바꾸지 않는다. */
enum class PenType(val code: Int) {
    BALLPOINT(0), FOUNTAIN(1), PENCIL(2), HIGHLIGHTER(3), BRUSH(4);

    companion object {
        fun fromCode(c: Int): PenType = entries.firstOrNull { it.code == c } ?: BALLPOINT
    }
}

/** 자동 보정된 도형 종류(0 = 손글씨 그대로). */
object ShapeKind {
    const val NONE = 0
    const val LINE = 1
    const val CIRCLE = 2
    const val ELLIPSE = 3
    const val RECT = 4
    const val TRIANGLE = 5
    const val ARROW = 6
    const val POLYGON = 7
}

class Bounds(var l: Float, var t: Float, var r: Float, var b: Float) {
    fun intersects(o: Bounds) = l <= o.r && r >= o.l && t <= o.b && b >= o.t
    fun contains(x: Float, y: Float) = x in l..r && y in t..b
    fun outset(d: Float) = Bounds(l - d, t - d, r + d, b + d)
    val width get() = r - l
    val height get() = b - t
}

/**
 * 하나의 필기 획. 벡터 데이터로만 저장한다(화면 이미지와 분리).
 * points: (x, y, pressure, tilt) 반복, 좌표 단위는 페이지 포인트(1/72 inch).
 * 불변 객체 — 수정은 항상 새 객체를 만든다(멀티윈도우·되돌리기 안전).
 */
class Stroke(
    val id: String,
    val pageId: String,
    val pen: PenType,
    val color: Int,
    val width: Float,
    val opacity: Float,
    val points: FloatArray,
    val createdAt: Long,
    val shape: Int = ShapeKind.NONE,
) {
    val count: Int get() = points.size / STRIDE

    val bounds: Bounds by lazy {
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        var i = 0
        while (i < points.size) {
            val x = points[i]; val y = points[i + 1]
            if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y
            i += STRIDE
        }
        if (points.isEmpty()) Bounds(0f, 0f, 0f, 0f) else Bounds(l, t, r, b).outset(width * 1.5f + 1f)
    }

    fun copy(
        id: String = this.id, pageId: String = this.pageId, points: FloatArray = this.points,
        width: Float = this.width, shape: Int = this.shape, color: Int = this.color, opacity: Float = this.opacity,
    ) = Stroke(id, pageId, pen, color, width, opacity, points, createdAt, shape)

    companion object {
        const val STRIDE = 4
        fun newId(): String = UUID.randomUUID().toString()
    }
}

enum class PaperStyle(val key: String) {
    BLANK("blank"), LINED("lined"), GRID("grid"), DOT("dot");
    companion object { fun of(k: String?) = entries.firstOrNull { it.key == k } ?: BLANK }
}

enum class PageTemplate(val key: String) {
    NONE("none"), MEETING("meeting"), PLANNER("planner"), STUDY("study");
    companion object { fun of(k: String?) = entries.firstOrNull { it.key == k } ?: NONE }
}

/** 용지 규격(포인트). */
enum class PaperSize(val key: String, val w: Float, val h: Float) {
    A3("A3", 842f, 1191f), A4("A4", 595f, 842f), A5("A5", 420f, 595f), B5("B5", 499f, 709f),
    LETTER("Letter", 612f, 792f);
    companion object { fun of(k: String?) = entries.firstOrNull { it.key == k } ?: A4 }
}

object BackgroundType {
    const val PAPER = 0
    const val PDF = 1
}

data class PageData(
    val id: String,
    val notebookId: String,
    val index: Int,
    val width: Float,
    val height: Float,
    val paper: PaperStyle,
    val template: PageTemplate,
    val bgType: Int = BackgroundType.PAPER,
    val attachmentId: String? = null,
    val pdfPage: Int = -1,
    val createdAt: Long,
    val updatedAt: Long,
    val deleted: Boolean = false,
)

data class NotebookData(
    val id: String,
    val folderId: String?,
    val title: String,
    val description: String,
    val coverColor: Int,
    val favorite: Boolean,
    val locked: Boolean,
    val infinite: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val openedAt: Long,
    val deleted: Boolean,
    val tags: List<String> = emptyList(),
)

data class FolderData(val id: String, val parentId: String?, val name: String, val createdAt: Long, val updatedAt: Long)

/** 노트 한 권 전체(버전 스냅샷·백업 단위). */
class NotebookSnapshot(
    val notebook: NotebookData,
    val pages: List<PageData>,
    val strokes: List<Stroke>,
)

class CorruptDataException(msg: String) : Exception(msg)
