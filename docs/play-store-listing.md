# Google Play 등록 자료

## 앱 이름
- 한국어: EUM SECURITY PRO – 광고 차단·악성코드 검사
- English: EUM SECURITY PRO – Ad Block & Malware Scan

## 짧은 설명 (80자)
- 한국어: 로컬 VPN 광고·추적·피싱 차단과 근거를 보여주는 악성코드 검사를 한 앱에서.
- English: Local-VPN ad, tracker & phishing blocking plus evidence-based malware scanning.

## 자세한 설명 (한국어)
EUM SECURITY PRO 는 광고 차단과 악성코드 검사를 하나로 합친 보안 앱입니다.

■ 광고·추적·피싱 차단
• 기기 안에서만 동작하는 로컬 VPN 으로 DNS 요청을 걸러 냅니다 (AdGuard DnsLibs 엔진).
• 일반 인터넷 트래픽은 VPN 을 거치지 않아 속도가 느려지지 않습니다.
• 광고·추적·피싱 차단을 각각 켜고 끌 수 있고, 사이트 허용/차단, 앱별 제외, 일시 정지를 지원합니다.
• 차단 기록에서 오차단된 도메인을 바로 허용할 수 있습니다.
• DNS-over-HTTPS / DNS-over-TLS 서버를 선택할 수 있습니다.

■ 악성코드 검사
• SHA-256 악성 해시 DB, YARA-X 패턴, APK 정적 분석, 위험 권한 분석을 함께 사용합니다.
• 모든 결과에 탐지 엔진·규칙 버전·판정 근거·검사하지 못한 항목을 표시합니다.
• 앱 코드를 실행하지 않고 분석하며, 파일을 외부로 보내지 않습니다.
• 위협 DB 는 Ed25519 서명이 확인된 경우에만 적용됩니다.

■ 알아 두세요
• DNS 방식이므로 유튜브 동영상 광고처럼 콘텐츠와 같은 주소에서 오는 광고는 막을 수 없습니다.
• 다른 VPN 과 동시에 사용할 수 없습니다.
• '알려진 위협 미발견'은 100% 안전을 뜻하지 않습니다.

## Full description (English)
EUM SECURITY PRO combines ad blocking and malware scanning in one app.
• Local, on-device VPN that filters only DNS requests (AdGuard DnsLibs). Regular traffic bypasses the VPN, so browsing stays fast.
• Separate switches for ads, trackers and phishing; allow/block sites; per-app exclusions; pause; DoH/DoT servers.
• Malware scanning with a SHA-256 hash DB, YARA-X rules, static APK analysis and risky-permission analysis. Every verdict shows the engine, rule version and evidence.
• Nothing is uploaded: app lists, DNS logs and APK files stay on your device. Threat DB updates are applied only after Ed25519 signature verification.
Limitations: DNS blocking cannot remove ads served from the same domain as content (e.g. YouTube video ads); cannot run alongside another VPN; "No known threats found" is not a guarantee of safety.

## 카테고리 / 연락처
도구(Tools) · pm999@naver.com · 개인정보처리방침 URL: (호스팅 후 입력)

## 그래픽 자료
- 앱 아이콘 512×512: 런처 아이콘(방패) 기반 — 제작 필요
- 대표 이미지 1024×500: 제작 필요
- 휴대폰 스크린샷: 에뮬레이터 검수 결과(api34 *.png, 한국어·영어)에서 선택
- 태블릿 스크린샷: 태블릿 에뮬레이터로 별도 촬영 필요

## 데이터 보안(Data safety) 신고 안
- 수집 데이터: 없음 (모든 처리는 기기 내부, 서버로 전송하지 않음)
- 공유 데이터: 없음
- 전송 중 암호화: 해당 없음(전송하는 사용자 데이터 없음). 필터·DB 다운로드는 HTTPS
- 데이터 삭제 요청: 앱 내 '기록 모두 삭제' 및 앱 삭제

## VPN 사용 목적 신고 (VpnService)
"이 앱의 핵심 기능은 기기 내 광고·추적·피싱 도메인 차단입니다. VpnService 로 가상 DNS 주소만 라우팅하는 로컬 VPN 을 만들어 DNS 요청을 기기 안에서 필터링합니다. 사용자 트래픽을 원격 서버로 터널링하지 않고, 일반 트래픽은 VPN 을 거치지 않으며, 트래픽을 수집·판매하거나 광고에 사용하지 않습니다. HTTPS 를 복호화하지 않습니다."

## 포그라운드 서비스(specialUse) 신고
"로컬 DNS 필터링 VPN 이 실행 중임을 알리고 사용자가 즉시 끌 수 있도록 지속 알림을 표시합니다."

## QUERY_ALL_PACKAGES 사용 목적 신고
"이 앱은 백신(안티멀웨어) 앱이며, 설치된 모든 앱의 APK 해시·서명·권한을 알려진 악성코드 DB 와 대조하는 것이 핵심 기능입니다. 패키지 목록은 기기 밖으로 전송하지 않습니다." (Play 정책의 '기기 검색·백신·보안 앱' 허용 사례)

## 테스트 트랙
1) 내부 테스트 → 2) 비공개 테스트(개인 계정은 12명 이상 14일, 도플리 이용 가능) → 3) 프로덕션
