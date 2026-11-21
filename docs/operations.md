# 운영 및 업데이트 설명서

## 저장소 구조 (lee1 저장소 `eum-security-pro` 브랜치)
| 경로 | 내용 |
|---|---|
| app/ | Android 앱 (Kotlin, Compose, Hilt, Room, DataStore, WorkManager) |
| native/eum-yara | YARA-X JNI (Rust) → libeumyara.so |
| native/eum-crypto | Ed25519 서명 검증 JNI (Rust) → libeumcrypto.so |
| native/dnslibs | AdGuard DnsLibs 소스 빌드 설정 |
| db_src/ | YARA 규칙·경량 패턴 원본 |
| db/ | 서명된 위협 DB (앱이 매일 확인하는 원격 업데이트 위치) |
| fixtures/ | 무해한 테스트 픽스처 APK |
| tools/ | DB 생성·서명, 문자열 생성, 픽스처 생성 스크립트 |
| .github/workflows | DnsLibs 빌드 / 앱 빌드·테스트·에뮬레이터 검수 |

## 빌드
- 앱: `eum-security-pro` 브랜치에 push 하면 Actions 가 Rust(3개 ABI) → Gradle(단위 테스트·lint·APK·AAB) → 에뮬레이터(API 29, 34) 검수를 실행하고 릴리스 `eum-security-pro-latest` 에 APK/AAB 를 올립니다.
- DnsLibs: `native/dnslibs/**` 나 워크플로를 바꾸면 다시 빌드되어 릴리스 `eum-security-dnslibs` 가 갱신됩니다 (약 15분). 버전을 올릴 때는 워크플로의 `DNSLIBS_COMMIT`·`DNSLIBS_VERSION` 과 app/build.gradle.kts 의 의존성 버전을 같이 바꿉니다.
- Android Studio: `m2/` 폴더에 릴리스의 dnslibs-m2.zip 을 풀고, `app/src/main/jniLibs/` 에 Actions 산출물 jnilibs 를 넣으면 로컬 빌드됩니다.

## Play 업로드 서명 키 (GitHub Secrets)
`RELEASE_KEYSTORE_B64`(keystore 파일 base64), `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` 를 등록하면 release APK/AAB 가 그 키로 서명됩니다. 없으면 디버그 키로 서명되어 설치는 되지만 Play 에는 올릴 수 없습니다.

## 위협 DB 업데이트 절차
1. 규칙 수정: `db_src/yara/*.yar`, `db_src/patterns.json`
2. (선택) MalwareBazaar 실데이터: abuse.ch 무료 Auth-Key 로 full CSV 를 받아 `--bazaar` 로 지정
3. 생성·서명: `python3 tools/build_threat_db.py --key eum_db_signing_key.pem [--bazaar full.csv.zip]`
   - 버전은 기본 UTC `YYYYMMDDHH` — 항상 이전보다 커야 합니다 (앱이 같거나 낮은 버전을 롤백으로 거부)
4. `db/` 를 커밋·push → 앱이 하루 1회(또는 보안 DB 화면 '지금 업데이트') 서명·SHA-256 확인 후 원자적으로 교체
5. 앱 내장 사본(`app/src/main/assets/threatdb`)도 같이 갱신되므로 다음 앱 버전에 포함됩니다.

### 서명 개인키
- `eum_db_signing_key.pem` 은 저장소에 없습니다. 분실하면 새 키로 바꾼 앱 업데이트를 배포해야 하고, 유출되면 누구나 가짜 DB 를 만들 수 있으니 오프라인으로 보관하세요.
- 공개키: `E6b1Z9gnj4hT+7w0goUYb1GBjmq+0mVcgPiEgUT89Ic=` (ThreatBundle.PUBLIC_KEY)

## 오탐 처리
- 사용자는 결과 화면 '오탐 신고' → 이메일(pm999@naver.com)
- 확인 후 해당 SHA-256 을 payload 의 `false_positives` 에 넣거나 규칙을 고쳐 새 DB 를 배포
