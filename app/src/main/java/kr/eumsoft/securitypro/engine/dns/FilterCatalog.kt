package kr.eumsoft.securitypro.engine.dns

import kr.eumsoft.securitypro.data.AdFilterSource

/**
 * 기본 필터 목록. 목록 본문은 APK 에 넣지 않고 사용자의 기기가 원 출처에서 직접 내려받는다.
 * 각 목록의 라이선스를 화면에 표시한다.
 */
object FilterCatalog {
    const val ID_USER_BLOCK = 900      // 사용자 차단 목록 (DB: blocked_domains)
    const val ID_USER_ALLOW = 901      // 사용자 허용 목록 (DB: allowed_domains, @@ 규칙)
    const val ID_THREAT = 902          // 서명된 위협 DB 의 악성·피싱 도메인

    val defaults = listOf(
        AdFilterSource(1, "adguard_dns", "AdGuard DNS filter", "AD",
            "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt", "GPL-3.0", true),
        AdFilterSource(2, "stevenblack", "StevenBlack Unified hosts", "AD",
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", "MIT", false),
        AdFilterSource(3, "disconnect_tracking", "Disconnect Tracking", "TRACKING",
            "https://s3.amazonaws.com/lists.disconnect.me/simple_tracking.txt", "GPL-3.0", true),
        AdFilterSource(4, "phishing_database", "Phishing.Database (active domains)", "PHISHING",
            "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt", "MIT", true),
        AdFilterSource(5, "urlhaus", "URLhaus malware hosts (abuse.ch)", "MALWARE",
            "https://urlhaus.abuse.ch/downloads/hostfile/", "CC0-1.0", true),
        AdFilterSource(ID_USER_BLOCK, "user_block", "사용자 차단 목록", "CUSTOM", "", "-", true),
        AdFilterSource(ID_THREAT, "eum_threat_domains", "EUM 위협 도메인 (서명된 DB)", "MALWARE", "", "CC0-1.0", true),
    )

    /** 스위치(광고/추적/피싱)와 카테고리 연결. 악성 도메인은 피싱 보호 스위치에 포함된다. */
    fun categoryEnabled(cat: String, ad: Boolean, tracking: Boolean, phishing: Boolean): Boolean = when (cat) {
        "AD" -> ad
        "TRACKING" -> tracking
        "PHISHING", "MALWARE" -> phishing
        else -> true
    }
}
