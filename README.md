# EUM SECURITY PRO

Android 광고 차단·악성코드 검사 통합 보안 앱 (Kotlin · Jetpack Compose · Material 3, Android 10+).

- **광고 차단**: AdGuard DnsLibs(소스 빌드) + Android VpnService. VPN 에는 가상 DNS 주소만 라우팅하고, DNS 패킷은 DnsLibs `DnsTunListener` 가 처리 → `DnsProxy` 가 필터링. 일반 트래픽은 VPN 을 거치지 않음.
- **악성코드 검사**: SHA-256 해시 DB · YARA-X(Rust JNI) · Kotlin APK 정적 분석(매니페스트·서명·DEX·네이티브) · 위험 권한 조합 → 종합 판정(위험/주의/알려진 위협 미발견/검사 불가).
- **업데이트**: Ed25519 서명 + SHA-256 + 롤백 거부 + 원자적 교체. 광고 필터와 위협 DB 독립 업데이트(하루 1회).

빌드·운영: [docs/operations.md](docs/operations.md) · 제한사항: [docs/limitations.md](docs/limitations.md) · 개인정보: [docs/privacy-policy.md](docs/privacy-policy.md) · 스토어: [docs/play-store-listing.md](docs/play-store-listing.md)

설치용 APK: Releases → `eum-security-pro-latest` → `eum-security-pro.apk`
