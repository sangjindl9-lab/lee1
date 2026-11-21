# Google Play 판 등록 자료 (광고·추적 차단 제외)

패키지: kr.eumsoft.securitypro · 카테고리: 도구 · 무료 · 광고 없음 · 문의 pm999@naver.com
개인정보처리방침: https://github.com/sangjindl9-lab/lee1/blob/eum-security-pro/docs/privacy-policy.md

## 앱 이름
- 한국어: EUM SECURITY PRO - 피싱 차단·악성코드 검사
- English: EUM SECURITY PRO - Phishing Guard & Malware Scan

## 짧은 설명
- 한국어: 피싱·악성 사이트를 차단하고 설치 앱과 APK를 근거와 함께 검사합니다.
- English: Blocks phishing & malicious sites and scans apps and APKs with clear evidence.

## 자세한 설명 (한국어)
EUM SECURITY PRO 는 피싱·악성 사이트 차단과 악성코드 검사를 한 앱에 담은 보안 앱입니다.

■ 웹 보호 (피싱·악성 사이트 차단)
• 기기 안에서만 동작하는 로컬 VPN 으로 알려진 피싱·악성코드 유포·C2 도메인으로 가는 DNS 요청을 막습니다.
• 일반 인터넷 트래픽은 VPN 을 거치지 않아 속도가 느려지지 않고, 데이터를 외부 서버로 보내지 않습니다.
• 오차단된 사이트는 차단 기록에서 바로 허용할 수 있고, 앱별로 보호에서 제외할 수 있습니다.
• DNS-over-HTTPS / DNS-over-TLS 서버를 선택할 수 있습니다.

■ 악성코드 검사
• 알려진 Android 악성 APK 해시 1만여 건(MalwareBazaar), YARA-X 패턴, APK 정적 분석, 위험 권한 분석을 함께 사용합니다.
• 결과마다 탐지 엔진·규칙 버전·판정 근거·검사하지 못한 항목을 보여 줍니다.
• 내려받은 APK 파일을 설치하기 전에 검사할 수 있습니다. 앱 코드를 실행하지 않고 분석합니다.
• 위협 DB 는 Ed25519 서명이 확인된 경우에만 적용됩니다.

■ 개인정보
• 설치 앱 목록·DNS 기록·APK 파일을 외부로 보내지 않습니다. 기록은 설정한 기간이 지나면 자동 삭제됩니다.

■ 알아 두세요
• 이 앱은 Google Play 프로텍트를 대신하지 않는 보조 보안 도구입니다. '알려진 위협 미발견'은 100% 안전을 뜻하지 않습니다.
• 다른 VPN 과 동시에 사용할 수 없습니다.

## Full description (English)
EUM SECURITY PRO combines phishing protection and malware scanning.
• Web Guard: a local, on-device VPN blocks DNS requests to known phishing, malware-distribution and C2 domains. Regular traffic bypasses the VPN, and no data is sent to our servers. Allow a domain from the block log in one tap; exclude apps; choose DoH/DoT servers.
• Malware scan: ~10,000 known Android malware hashes (MalwareBazaar), YARA-X rules, static APK analysis and risky-permission analysis. Every verdict shows the engine, rule version and evidence. Scan downloaded APKs before installing; app code is never executed. Threat DB updates are applied only after Ed25519 signature verification.
• Privacy: your app list, DNS logs and APK files never leave the device.
This is a supplementary security tool, not a replacement for Google Play Protect. "No known threats found" is not a guarantee of safety. Cannot run alongside another VPN.

## 데이터 보안 신고
수집 없음 · 공유 없음 (모든 처리는 기기 내부). 다운로드는 HTTPS.

## VpnService 신고 (핵심 기능: 기기 보안)
"기기 보안(피싱·악성코드 유포 사이트 차단) 기능입니다. VpnService 로 가상 DNS 주소만 라우팅하는 로컬 VPN 을 만들어, 알려진 피싱·악성 도메인으로 가는 DNS 요청을 기기 안에서 차단합니다. 원격 서버로 터널링하지 않고, 일반 트래픽은 VPN 을 거치지 않으며, 광고를 차단·조작하지 않고, 트래픽을 수집하거나 수익화에 사용하지 않습니다. HTTPS 를 복호화하지 않습니다."

## QUERY_ALL_PACKAGES 신고
"백신(악성코드 검사) 앱으로서 설치된 모든 앱의 APK 해시·서명·권한을 알려진 악성코드 DB 와 대조하는 것이 핵심 기능입니다. 패키지 목록은 기기 밖으로 전송하지 않습니다."

## 포그라운드 서비스 (specialUse)
"로컬 피싱·악성 사이트 차단 VPN 이 실행 중임을 알리고 사용자가 즉시 끌 수 있도록 지속 알림을 표시합니다."
