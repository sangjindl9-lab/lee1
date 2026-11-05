# 이음한글 — hwp · hwpx 편집뷰어 (안드로이드)

한컴독스처럼 한글 문서를 휴대폰에서 열어 보고, 고치고, **같은 확장자(.hwp / .hwpx)로 저장**하는 앱입니다.
인터넷 없이 동작합니다(문서가 서버로 올라가지 않습니다).

## 설치
저장소의 **Releases → "이음한글 앱 (최신)" → `eum-hwp.apk`** 를 휴대폰에서 내려받아 설치합니다.
`eum-hwp` 브랜치에 올리면 GitHub Actions 가 APK 를 자동으로 다시 만듭니다.

## 기능
- 홈: 문서 열기 · 새 문서 · 최근 문서
- 파일 관리자/메신저에서 hwp · hwpx 파일을 눌러 "이음한글"로 바로 열기
- 보기 모드(실수로 고쳐지지 않음) ↔ 편집 모드 전환, 두 손가락 확대/축소
- 편집: 글자·문단 모양, 표, 그림, 머리말/꼬리말, 각주, 수식, 쪽 설정 등 (메뉴: 파일·편집·보기·입력·서식·쪽·표·도구)
- 저장(원본에 덮어쓰기) · 다른 이름으로 저장(hwp/hwpx) · PDF로 저장/인쇄 · 공유

## 구성
| 위치 | 내용 |
|---|---|
| `app/www/eum/` | 우리 앱 화면(홈·상단 바·파일 연결) — `eum-shell.js`, `eum-shell.css` |
| `app/www/` (그 외) | 문서 엔진·편집기: 오픈소스 [rhwp](https://github.com/edwardkim/rhwp) v0.8.7 빌드본 (Rust → WebAssembly, MIT) |
| `app/android/` | 안드로이드 앱(Capacitor). `EumFilesPlugin.java` 가 파일 열기·저장·인쇄·공유 담당 |
| `scripts/build-www.sh` | 편집기 빌드본을 다시 만드는 스크립트 (엔진 버전 올릴 때만 사용) |

## 라이선스 고지
문서 엔진 rhwp 는 MIT 라이선스입니다(`THIRD_PARTY_rhwp_LICENSE`). 포함 글꼴과 그 밖의 고지는 `THIRD_PARTY_rhwp_NOTICES.md` 참고.
