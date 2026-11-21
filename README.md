# 노트프로 (NotePro) — 1단계

글로벌 AI 필기·PDF·노트 관리 앱 **노트프로**(원래 지시서 이름: EUM SMART NOTE PRO)의 1단계 소스입니다.
Android(폰·태블릿) 네이티브 Kotlin + Jetpack Compose, 패키지 `kr.eumsoft.notepro`.

- 설계서: `docs/ARCHITECTURE.md` (아키텍처·DB·필기 엔진·동기화 프로토콜·화면·일정·위험)
- 진행 보고: `docs/STATUS.md` (완료 / 테스트 완료 / 미구현 / 확인 필요)
- 서버 DB: `docs/db/server_001_init.up.sql` · `.down.sql`, 마이그레이션 절차 `docs/MIGRATIONS.md`

## 구조
```
app/src/main/java/kr/eumsoft/notepro/
  core/     플랫폼 독립 로직(획 코덱·지우개/올가미·도형 보정·펜 모델·스냅샷·암호화 백업)
  data/     SQLite DB·저장소·세션(멀티윈도우 공유)·버전·백업·설정
  render/   획·용지·템플릿 그리기
  pdf/      PDF 가져오기·배경 렌더·주석 포함 내보내기
  ui/       Compose 화면, ui/canvas/NoteCanvasView = 필기 엔진
app/src/test         JVM 단위 테스트(core)
app/src/androidTest  기기 계측 테스트(DB 재시작·되돌리기·버전·페이지 복구·100쪽 PDF·백업·강제 종료)
.github/workflows/notepro.yml   빌드·단위 테스트·APK·에뮬레이터 검수
```

## 빌드
```bash
# JDK 17, Android SDK(compileSdk 36), Gradle 8.11.1
gradle testDebugUnitTest assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```
GitHub Actions에서는 `notepro` 브랜치에 올리면 자동으로 빌드되고, Releases의 `notepro-latest`에 사내 테스트 APK가 올라갑니다
(디버그 서명 — Google Play 배포용 아님).

## 설치
APK를 휴대폰에서 내려받아 설치(Android 8.0 이상). "출처를 알 수 없는 앱" 허용이 필요할 수 있습니다.
