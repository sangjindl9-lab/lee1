package kr.eumsoft.securitypro.engine.dns

/**
 * 내려받은 필터 본문을 검사·정리한다.
 * - hosts 형식 (0.0.0.0 example.com), 도메인만 있는 형식, AdGuard DNS 규칙(||example.com^) 을 지원한다.
 * - DnsLibs 가 직접 해석하므로 본문을 바꾸지 않고, 규칙 수 계산과 형식 검증만 한다.
 */
object FilterParser {
    private val domainRe = Regex("^[a-z0-9*]([a-z0-9*\\-_]{0,62})(\\.[a-z0-9*\\-_]{1,63})+\\.?$", RegexOption.IGNORE_CASE)
    private val localNames = setOf("localhost", "localhost.localdomain", "local", "broadcasthost", "ip6-localhost", "ip6-loopback", "0.0.0.0")

    /** 실제 차단·허용 규칙으로 쓰일 줄 수 */
    fun countRules(text: String): Int = text.lineSequence().count { isRule(it) }

    fun isRule(raw: String): Boolean {
        val l = raw.trim()
        if (l.isEmpty() || l.startsWith("!") || l.startsWith("#") || l.startsWith("[")) return false
        if (l.startsWith("||") || l.startsWith("@@") || l.startsWith("/") || l.startsWith("|")) return true
        val parts = l.split(Regex("\\s+"))
        if (parts.size >= 2 && looksLikeIp(parts[0])) return parts.drop(1).any { it !in localNames && domainRe.matches(it) }
        return parts.size == 1 && domainRe.matches(l) && l !in localNames
    }

    /** 내려받은 내용이 필터 목록으로 보이는지 (HTML 오류 페이지 등을 걸러낸다) */
    fun looksValid(text: String): Boolean {
        val head = text.take(2000).lowercase()
        if (head.contains("<html") || head.contains("<!doctype")) return false
        return countRules(text) > 0
    }

    fun looksLikeIp(s: String) = s.matches(Regex("^[0-9.]+$")) || s.contains(':')

    /** 사용자가 입력한 도메인을 정리한다. 잘못되면 null. */
    fun normalizeDomain(input: String): String? {
        var d = input.trim().lowercase()
        d = d.removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore(':')
        d = d.removePrefix("*.").trimEnd('.')
        return if (domainRe.matches(d) && !d.contains('*')) d else null
    }

    fun blockRule(domain: String) = "||$domain^"
    fun allowRule(domain: String) = "@@||$domain^\$important"
}
