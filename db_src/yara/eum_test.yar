// EUM SECURITY PRO 테스트 규칙 (운영 탐지 아님). 무해한 테스트 픽스처 검증용.
rule EUM_TEST_Marker : test
{
    meta:
        severity = "HIGH"
        confidence = 100
        description = "EUM SECURITY PRO 무해한 테스트 마커"
    strings:
        $m = "EUM-SECURITY-TEST-MALWARE-MARKER-0001"
    condition:
        $m
}

// 업계 표준 안티바이러스 테스트 파일(EICAR) 앞부분 — 전체 문자열은 넣지 않는다.
rule EUM_TEST_EICAR_Prefix : test
{
    meta:
        severity = "HIGH"
        confidence = 100
        description = "EICAR 안티바이러스 테스트 파일"
    strings:
        $e = { 58 35 4F 21 50 25 40 41 50 5B 34 5C 50 5A 58 35 34 28 50 5E 29 37 43 43 29 37 7D 24 45 49 43 41 52 }
    condition:
        $e at 0
}
