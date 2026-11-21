package kr.eumsoft.purchasenote.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * 날짜는 시각·시간대 없는 달력 날짜(LocalDate, DB에는 epochDay)로 다룬다.
 * 순서가 불분명하거나 연도가 없는 날짜는 확정하지 않고 후보로만 돌려준다.
 */
object Dates {
    /** 텍스트에서 찾은 날짜. options가 2개 이상이거나 needsYear면 사용자가 골라야 한다. */
    data class Found(val raw: String, val options: List<LocalDate>, val needsYear: Boolean = false, val start: Int = 0) {
        val sure: LocalDate? get() = if (!needsYear && options.size == 1) options[0] else null
    }

    private val MONTHS_EN = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    private val MONTHS_ES = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    private fun valid(y: Int, m: Int, d: Int): LocalDate? =
        if (y in 1990..2100 && m in 1..12 && d in 1..31) try { LocalDate.of(y, m, d) } catch (e: Exception) { null } else null

    private fun year2(y: Int) = if (y < 100) 2000 + y else y

    fun findAll(text: String, refYear: Int = LocalDate.now().year): List<Found> {
        val out = ArrayList<Found>()
        val used = BooleanArray(text.length)
        fun take(m: MatchResult, f: Found?) {
            if (f == null || f.options.isEmpty() && !f.needsYear) return
            if (m.range.any { used[it] }) return
            m.range.forEach { used[it] = true }
            out += f.copy(start = m.range.first)
        }
        // 1) 연도가 앞: 2027-03-04, 2027.3.4, 2027/03/04, 2027년 3월 4일, 2027年3月4日
        Regex("(?<!\\d)(\\d{4})\\s*[-./년年]\\s*(\\d{1,2})\\s*[-./월月]\\s*(\\d{1,2})\\s*[일日]?(?!\\d)").findAll(text).forEach { m ->
            val (y, mo, d) = m.destructured
            take(m, valid(y.toInt(), mo.toInt(), d.toInt())?.let { Found(m.value.trim(), listOf(it)) })
        }
        // 2) 25.03.04 / 25-03-04 (두 자리 연도가 앞) – 한국식 짧은 표기. 뒤가 연도일 가능성도 있어 후보 둘 다.
        // 3) 연도가 뒤: 03/04/2027, 3-4-27, 04.03.2027 → 일/월 순서가 불분명하면 후보 2개
        Regex("(?<!\\d)(\\d{1,2})\\s*[-./]\\s*(\\d{1,2})\\s*[-./]\\s*(\\d{4}|\\d{2})(?!\\d)").findAll(text).forEach { m ->
            val a = m.groupValues[1].toInt(); val b = m.groupValues[2].toInt(); val yRaw = m.groupValues[3]
            val opts = LinkedHashSet<LocalDate>()
            if (yRaw.length == 4) {
                val y = yRaw.toInt()
                valid(y, a, b)?.let(opts::add)   // 월/일 (미국식)
                valid(y, b, a)?.let(opts::add)   // 일/월 (유럽·중남미식)
            } else {
                val y = year2(yRaw.toInt())
                valid(y, a, b)?.let(opts::add); valid(y, b, a)?.let(opts::add)
                valid(year2(a), b, yRaw.toInt())?.let(opts::add) // yy.mm.dd
            }
            take(m, if (opts.isEmpty()) null else Found(m.value.trim(), opts.toList()))
        }
        // 4) 영어: March 4, 2027 / Mar 4 2027 / 4 March 2027
        Regex("(?i)\\b([a-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b").findAll(text).forEach { m ->
            val mi = MONTHS_EN.indexOf(m.groupValues[1].lowercase().take(3))
            if (mi >= 0) take(m, valid(m.groupValues[3].toInt(), mi + 1, m.groupValues[2].toInt())?.let { Found(m.value, listOf(it)) })
        }
        // 5) 일 월 연: 4 March 2027 / 4 de marzo de 2027 / 4 mar. 2027
        Regex("(?i)\\b(\\d{1,2})\\s+(?:de\\s+)?([a-záéíóúñ]{3,10})\\.?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b").findAll(text).forEach { m ->
            val name = m.groupValues[2].lowercase().take(3)
            val mi = MONTHS_ES.indexOf(name).takeIf { it >= 0 } ?: MONTHS_EN.indexOf(name)
            if (mi >= 0) take(m, valid(m.groupValues[3].toInt(), mi + 1, m.groupValues[1].toInt())?.let { Found(m.value, listOf(it)) })
        }
        // 6) 연도 없는 날짜: 3월 4일, 3月4日, 3/4 → 연도 확인 필요
        Regex("(?<![\\d/.-])(\\d{1,2})\\s*[월月]\\s*(\\d{1,2})\\s*[일日](?!\\d)").findAll(text).forEach { m ->
            val mo = m.groupValues[1].toInt(); val d = m.groupValues[2].toInt()
            take(m, valid(refYear, mo, d)?.let { Found(m.value, listOf(it), needsYear = true) })
        }
        return out.sortedBy { it.start }
    }

    // ---- 기한 구분 ----
    enum class Bucket { OVERDUE, TODAY, SOON, LATER }

    /** 오늘·3일 이내·기한 지남 구분. 날짜가 없으면 null(임박 목록에서 제외). */
    fun bucket(deadline: LocalDate?, today: LocalDate): Bucket? {
        if (deadline == null) return null
        return when {
            deadline.isBefore(today) -> Bucket.OVERDUE
            deadline == today -> Bucket.TODAY
            !deadline.isAfter(today.plusDays(3)) -> Bucket.SOON
            else -> Bucket.LATER
        }
    }

    /**
     * 알림 시각: 기한 날짜 - daysBefore 의 minuteOfDay(기기 현지 시간).
     * 서머타임으로 그 시각이 없으면 ZonedDateTime 규칙대로 뒤로 밀린다(날짜는 유지).
     */
    fun reminderInstant(deadline: LocalDate, daysBefore: Int, minuteOfDay: Int, zone: ZoneId): Long {
        val day = deadline.minusDays(daysBefore.toLong())
        val t = LocalTime.of(minuteOfDay / 60, minuteOfDay % 60)
        return ZonedDateTime.of(LocalDateTime.of(day, t), zone).toInstant().toEpochMilli()
    }
}
