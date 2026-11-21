# 가족앨범 · 육아기록

아이 사진·영상을 원본 그대로 보관하고, 초대받은 가족이 쉽게 열람하며, 보호자가 수유·수면을 기록하는 가족용 서비스입니다.
Next.js App Router + TypeScript + Prisma(SQLite) + Tailwind CSS 4 + Vitest 구성입니다.

## 실행

```bash
npm install
cp .env.example .env  # DATABASE_URL 등 설정
npm run db:setup      # prisma generate + db push + 시드
npm run dev           # http://localhost:3220
```

데모 계정 (비밀번호 모두 `demo1234`)

| 계정 | 역할 | 화면 |
| --- | --- | --- |
| dad@demo.family (이상진, 아빠) | 부모 | `/app` |
| mom@demo.family (김하늘, 엄마) | 부모 | `/app` |
| grandma@demo.family (박순자, 할머니) | 조부모 | `/simple` |
| grandpa@demo.family (이만복, 할아버지) | 조부모 | `/simple` |
| aunt@demo.family (이지은, 이모) | 가족 | `/simple` |

시드 데이터: 첫째 서준(2023-03-02), 둘째 지우(2025-06-20), 앨범·태그·좋아요·댓글,
자정을 넘긴 수면 기록(어제 23:40 → 오늘 01:10), 진행 중 수면 기록,
그리고 **둘째 지우의 생후 10개월 시점 동영상**(2026-04-22 촬영)이 들어 있습니다.

## 검증

```bash
npm run typecheck    # tsc --noEmit
npm run test         # Vitest — 서비스 계층 시나리오 36개
npm run build        # prisma generate + next build
npm run smoke        # 실제 next start 서버에 HTTP 로 53개 항목 검증
npm run verify       # typecheck + test + build
```

`npm run smoke` 는 별도 SQLite(`prisma/smoke.db`)와 스토리지(`test-storage/smoke`)에 시드한 뒤
3221 포트로 서버를 띄워 확인하고 종료합니다. 개발용 DB는 건드리지 않습니다.

## 기능 메모

### 1. 다중 업로드
- 파일마다 `대기 / 전송 중 / 완료 / 실패` 상태. 원본·미리보기 파일 **그리고** DB 레코드가 모두 저장된 뒤에만 `완료`.
- 업로드 세션과 항목 상태는 서버 DB(`UploadSession`, `UploadItem`)에 남아 브라우저를 다시 열어도 복원되고,
  파일 바이트는 IndexedDB 에 보관해 `실패한 항목만 다시 올리기`가 그대로 동작합니다.
- 중복 방지: 파일 내용 SHA-256 + `dedupeKey(albumId:hash)` 유니크 제약. 같은 파일을 다시 올리면 기존 항목으로 연결되고 새 레코드를 만들지 않습니다.
- 결과 요약: `100개 중 97개 완료, 3개 재시도` 형식.
- 업로드 화면의 `일부 전송 실패 시뮬레이션`은 33번째 파일마다 첫 시도에 서버가 `502`를 돌려주도록 만든 테스트 장치입니다.

### 2. 원본 보관 · 다운로드 · 휴지통
- 이미지: 원본 바이트 그대로 + 1280px WebP 미리보기 + 480px 썸네일(sharp).
  동영상: 원본과 `미리보기 720p / 원본 1080p` 표기를 분리 저장. (서버에 ffmpeg 이 없어 실제 축소 인코딩은 다음 단계)
- 선택 원본 ZIP, 기간 원본 ZIP (`/api/download`). ZIP 안에 `MANIFEST.csv`(아이·촬영일·공개범위·태그·해시)를 함께 넣습니다.
- 삭제는 소프트 삭제이며 복구는 **DB에 저장된 원래 childId/albumId/capturedAt/visibility**만 사용합니다.
  클라이언트가 다른 아이를 지정해도 무시합니다.
- 업로드 직전 확인 모달에서 대상 아이·앨범·공개범위·열람 가능한 가족을 보여줍니다.

### 3. 광고 제거 결제
- 상품 2종: `광고 제거 · 개인(2,900원/월, 결제자 본인만)` / `광고 제거 · 가족 전체(4,900원/월, 초대된 가족 전원)`.
  결제 화면에서 제거되는 광고 종류와 적용 대상을 비교 표시합니다.
- 설정 화면에서 적용 상태·결제 계정·적용 시작 확인, `구매 복원`, `결제 상태 재확인`, `문의 접수`(DB 저장).
- 광고는 `(사용자, 슬롯, 날짜)` 유니크 이력으로 하루 1회만 노출되어, 새로고침·재실행·업로드 재시도로 다시 뜨지 않습니다.
- 실제 Google Play / App Store 결제는 스토어 계정·상품 등록·영수증 검증 키가 필요합니다.
  키가 없으면 `STORE_NOT_CONFIGURED` 로 안내하고, 데모는 `WEB_MOCK` 결제로 전체 흐름을 검증합니다(아래 "추가 설정 필요" 참고).

### 4. 수면 기록
- 날짜+시각을 각각 받아 timestamp 차이로 계산하므로 자정을 넘겨도 정확합니다(`23:40 → 01:10 = 90분`).
- 수면 시작만 저장(`ONGOING`)하고 나중에 종료 시각 입력.
- 오류는 `fieldErrors` 로 어느 칸인지 내려주고, 화면은 그 칸 아래에 표시하며 입력값을 유지합니다.

### 5. 검색
- 자연어 해석(`parseNaturalQuery`): `둘째 생후 10개월 때 찍은 동영상` → 아이=지우, 생후 10개월, 동영상.
- 조건: 아이, 생후 개월(생년월일 대비 촬영일 자동 계산), 연도, 월, 사진/동영상, 즐겨찾기, 해시태그(AND 조합).
- 태그 직접 붙이기, 태그별 모아보기(건수 포함).

### 6. 가족 간편 모드
- `/simple`: 큰 글씨·큰 버튼, 최신 사진 우선, `새 사진`·`좋아요`·`댓글` 버튼을 첫 화면에 배치.
- 사진을 누르면 전체 화면 뷰어(`/simple/viewer/[id]`), 좌우 버튼·스와이프·키보드로 이전/다음.
- 결제 메뉴는 간편 모드 어디에도 없고, 부모 계정의 `설정 → 광고 제거 상품 보기`(확인 모달)에서만 접근합니다.

## 추가 설정이 필요한 항목 (실결제 연동)

| 항목 | 현재 상태 | 필요 작업 |
| --- | --- | --- |
| Google Play 인앱 결제 | 데모(`WEB_MOCK`)만 동작, 실결제는 `409 STORE_NOT_CONFIGURED` | Play Console 상품 등록, 서비스 계정 JSON → `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, 서버 영수증 검증(`purchases.products.get`) |
| Apple App Store IAP | 동일 | App Store Connect 상품 등록, 공유 암호 → `APPLE_IAP_SHARED_SECRET`, `verifyReceipt`/App Store Server API |
| 동영상 미리보기 트랜스코딩 | 원본 저장 + 화질 표기만 | ffmpeg 워커 추가(720p H.264 생성) |
| 가족 초대 링크 | 시드의 고정 초대코드만 | 초대 코드 발급·수락 API/화면 |
| 푸시 알림 | 없음 | FCM/APNs 연결 |

## 안드로이드 앱 (android/)

이 웹앱을 그대로 감싸는 안드로이드 WebView 앱입니다. 패키지 `kr.eumsoft.familyalbum`, 앱 이름 `가족앨범`. (minSdk 24 / targetSdk 36)

- 앱이 여는 주소는 빌드 시 `BuildConfig.APP_URL` 로 들어갑니다. 기본값 `https://family-album.onrender.com`.
  바꾸려면 `-PappUrl=...`, `APP_URL` 환경변수, `android/local.properties` 의 `appUrl=` 중 하나를 씁니다.
- 사진·동영상 여러 개 고르기(`onShowFileChooser` + `EXTRA_ALLOW_MULTIPLE`), 원본·ZIP 다운로드(`DownloadManager`, 로그인 쿠키 전달),
  IndexedDB 업로드 복원(`domStorageEnabled`/`databaseEnabled`), 뒤로가기 시 웹 히스토리 우선 이동을 처리합니다.

```bash
cd android
./gradlew assembleDebug        # android/app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # 서명 키가 없으면 디버그 키로 서명해 설치 가능한 APK 생성
```

Android Studio 로는 `android/` 폴더를 열면 됩니다(첫 실행 시 `local.properties` 자동 생성).
로컬 개발 서버를 보게 하려면 `android/local.properties` 에 `appUrl=http://10.0.2.2:3220`(에뮬레이터 기준)을 넣습니다.

CI 는 `.github/workflows/family-album-apk.yml` 이 담당합니다. `android/**` 변경이 푸시되거나 수동 실행(`workflow_dispatch`, `app_url` 입력)하면
디버그 APK 를 만들어 Artifact 로 올리고, 태그 푸시나 수동 실행에서 `create_release` 를 켜면 Release 에도 첨부합니다.
런처 아이콘 PNG 는 `node scripts/gen-android-icons.mjs` 로 다시 만들 수 있습니다.

## 구조

```
prisma/schema.prisma   데이터 모델 (User, Family, Child, Album, MediaAsset, UploadSession/Item,
                       CareRecord, Tag, Like, Comment, Purchase, AdImpression, Inquiry)
prisma/seed.ts         시드 (사진 파일도 실제 생성)
src/lib/               auth, media(sharp), upload, library(휴지통/태그/좋아요), care, search, billing, zip
src/app/api/           REST API (인증, 업로드, 미디어, 검색, 육아기록, 결제, 문의, 다운로드)
src/app/app/           부모 화면
src/app/simple/        조부모 간편 모드
tests/                 Vitest 시나리오 (업로드·휴지통·결제·수면·검색)
scripts/smoke.mjs      실서버 HTTP 스모크 테스트
android/               안드로이드 WebView 앱 (Gradle Kotlin DSL, kr.eumsoft.familyalbum)
.github/workflows/     family-album-apk.yml — 디버그 APK 빌드 CI
```
