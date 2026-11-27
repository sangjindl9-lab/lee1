# 이음 앱 홍보·ASO 자동화 센터 (EUM Promo & ASO Studio)

Google Play 앱의 **실시간 순위 추적 · 경쟁 앱 ASO 분석 · 홍보 글 자동 생성**을 한 화면에서 처리하는 사내용 웹 프로그램입니다.
(주)에스에스전력 / 이음소프트웨어가 운영하는 `kr.eumsoft.*` 앱을 기준으로 만들었고, 패키지명만 바꾸면 다른 앱에도 그대로 씁니다.

- Node.js 24 + TypeScript + Express + 내장 `node:sqlite` (별도 DB 서버 불필요)
- 프런트엔드는 의존성 없는 순수 HTML/CSS/JS 대시보드 (한국어 UI)
- Google Play 공개 페이지를 직접 파싱 — API 키·유료 서비스 없이 동작
- OpenAI 키는 **선택 사항**. 없으면 자체 한국어 템플릿 엔진이 실전용 초안을 생성합니다.

---

## 1. 주요 기능

### 1) 실시간 앱·키워드 순위 추적 (ASO Tracker)
- Play 스토어 상세 페이지에서 제목, 개발자, 평점, 리뷰 수, 설치 수 구간, 최근 업데이트, 버전, 카테고리, 설명, 아이콘을 파싱해 **일별 스냅샷**으로 SQLite 에 저장
- 패키지명은 물론 **Play 스토어 URL 붙여넣기로도 앱 등록** (예: `https://play.google.com/store/apps/details?id=kr.eumsoft.viewer`)
- 키워드별 **한국 스토어(`hl=ko&gl=kr`) 검색 순위**를 최대 30위(설정 시 최대 50)까지 탐색하고, 상위 1~5위 경쟁 앱의 제목·개발자·평점을 함께 저장
- `지금 순위 점검` 수동 실행 + **매일 지정 시각(KST) 자동 점검** 내장 스케줄러 (외부 크론 불필요)
- 순위 추이 차트(일별 마지막 값), 전일 대비 ▲▼ 변동, 키워드별 CSV/JSON 내보내기

### 2) 경쟁 앱 비교 & ASO 문구 개선
- 키워드 상위 1~5위 앱의 **제목(가중치 3)·간단 설명(2)·상세 설명(1)** 을 분석해 내 앱에 빠진 단어·두 단어 조합을 가중치 순으로 제시
- 경쟁사 브랜드명·설명 한 곳에만 나온 잡음 단어는 자동으로 걸러냄
- Play 제한(제목 30자, 간단 설명 80자)을 지키는 **제목·간단 설명 후보**와 상세 설명 구성안 자동 생성, 클릭 한 번으로 복사

### 3) 홍보 글 자동 생성 + 예약 발행 센터
- 채널 4종: **네이버 블로그**(제목 5안 + 본문 + 해시태그), **커뮤니티·디스콰이엇**(자기소개형·피드백 요청), **유튜브 쇼츠**(30초 타임코드 대본·자막·내레이션), **인스타그램 릴스**(5컷 구성·캡션·해시태그 15개)
- Play 링크에 채널별 **UTM 파라미터**를 자동 결합 (`utm_source=naver_blog&utm_medium=blog&...`)
- OpenAI 키를 넣으면 GPT가 문장을 고도화하고, 실패·키 없음이면 자동으로 템플릿 결과로 폴백(경고 표시)
- 생성 초안은 보관함에 쌓이고, **웹훅(Make·Zapier·Slack·자체 블로그 봇)** 으로 JSON 자동 발송 (테스트 발송 버튼 포함)
- 매일/매주 지정 시각에 채널별 초안을 자동 생성하는 스케줄러
- 1클릭 복사, HTML/Markdown 다운로드(붙여넣기용 완성 HTML)

---

### 4) 🎬 YouTube 쇼츠 풀오토 (Shorts Studio)

버튼 한 번으로 **대본 → 이미지 → 음악·내레이션 → 1080×1920 MP4** 를 만듭니다. 외부 유료 API 키가 없어도 100% 동작합니다.

- **대본**: 앱 메타/키워드/실제 스토어 문구 기반 5씬(훅 → 문제 → 해결 → 근거 → CTA) + 유튜브 제목·설명·해시태그 (`OPENAI_API_KEY`가 있으면 문장 고도화)
- **이미지**: Play 스토어 아이콘·스크린샷 자동 다운로드 → 원형 마스크, 실패 시 폴백 아이콘 카드. 씬별 540×960 그라데이션 배경(3가지 분위기)을 순수 Node PNG로 생성 후 1080×1920으로 확대
- **음악**: 저작권 걱정 없는 프로시저럴 BGM 합성기(밝은 테크 / 집중 업무 / 임팩트 숏폼, 44.1kHz 스테레오 WAV)
- **내레이션**: 내장 무료 TTS(구글 번역 TTS) 시도 → 실패 시 자막+BGM으로 안전 폴백. OpenAI TTS·ElevenLabs 연결 가능
- **영상**: FFmpeg zoompan(Ken Burns) + xfade 크로스페이드 + ASS 한글 타이포그래피 자막 + BGM·내레이션 믹싱 → `H.264/AAC, 30fps, +faststart`
- **외부 AI 영상(선택)**: Higgsfield / Runway / Kling·커스텀 API 키를 설정하면 훅 장면을 생성형 영상으로 대체(`GET /api/shorts/providers` 로 상태 확인). 실패하면 자동으로 내장 엔진 폴백 + 경고 기록
- 완성본은 `/data/shorts/videos/` 에 보관, 화면에서 `<video>` 미리보기 · MP4 다운로드 · 대본/제목·태그 복사 · 삭제

필요 패키지: `ffmpeg`(+libass/libx264), 한글 폰트 `fonts-noto-cjk`. Dockerfile에는 기본 설치되어 있습니다.

## 2. 빠른 실행

### 로컬 실행
```bash
cd eum-promo
npm install
npm run dev            # http://localhost:3100  (TypeScript 직접 실행)
```

배포용으로는 빌드 후 실행합니다.
```bash
npm run build
npm start
```

첫 실행 시 실제로 공개된 이음소프트웨어 앱 3개가 자동 등록됩니다.
- `kr.eumsoft.viewer` — PDF·캐드 뷰어(DWG·DXF)
- `kr.eumsoft.zip` — 이음ZIP
- `kr.eumsoft.docs` — 이음과 문서

> 시드를 넣지 않으려면 `SEED_DEMO=0` 으로 실행하세요. 이미 등록된 앱은 건드리지 않습니다.

### 환경 변수
| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3100` | 서버 포트 |
| `DATA_DIR` | `./data` | SQLite 파일 위치 (`eum-promo.db`) |
| `ADMIN_PASSWORD` | (없음) | 설정하면 로그인 화면 + 세션 쿠키 보호 활성화 |
| `AUTH_SECRET` | `ADMIN_PASSWORD` | 세션 서명 키 (배포 시 별도 값 권장) |
| `RANK_DEPTH` | `30` | 순위 탐색 깊이 (5~50) |
| `PLAY_LANG` / `PLAY_COUNTRY` | `ko` / `KR` | 수집 로케일 |
| `OPENAI_API_KEY` | (없음) | 있으면 AI 생성 사용 가능 (설정 화면에서도 입력 가능) |
| `OPENAI_MODEL` | `gpt-4o-mini` | 사용할 모델 |
| `SEED_DEMO` | `1` | 첫 실행 시 이음 앱 시드 등록 |
| `SCHEDULER` | `1` | 내장 스케줄러 사용 |

### 쇼츠 관련 환경 변수 (선택)

| 변수 | 설명 |
| --- | --- |
| `FFMPEG_PATH` / `FFPROBE_PATH` | ffmpeg 경로 (Docker 이미지에는 설치되어 있어 비워둡니다) |
| `SHORTS_DIR` | 완성 영상 보관 경로 (기본 `$DATA_DIR/shorts`) |
| `SHORTS_FONT` | 한글 폰트 패밀리 (기본 `Noto Sans CJK KR`) |
| `HIGGSFIELD_API_KEY` | 힉스필드 API 키 (`Key ID:Secret`) — 설정 화면에서도 저장 가능 |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS 키 |

### Docker
```bash
docker build -t eum-promo .
docker run -d --name eum-promo -p 3100:3100 \
  -e ADMIN_PASSWORD='원하는비밀번호' \
  -v eum-promo-data:/data \
  eum-promo
```

### Railway 배포
1. 이 저장소를 Railway 에 연결하면 `Dockerfile` 로 자동 빌드됩니다.
2. Variables 에 `ADMIN_PASSWORD`, `AUTH_SECRET`, (선택) `OPENAI_API_KEY` 를 넣습니다.
3. **Volume 을 `/data` 에 마운트**하세요. 그렇지 않으면 재배포 때 순위 기록이 사라집니다. (`DATA_DIR=/data` 가 이미지 기본값)
4. 배포 후 `/api/health` 가 `{"ok":true}` 를 돌려주면 정상입니다.

---

## 3. 화면 구성

| 화면 | 내용 |
| --- | --- |
| 대시보드 | 등록 앱·키워드·오늘 점검·초안 수, 앱별 최고 순위, 키워드 순위 요약표, 최근 작업 로그 |
| 앱 · 키워드 | 앱 등록/삭제, 정보 새로고침, 키워드 추가, `지금 순위 점검`, 키워드별 순위·변동·상위 경쟁 앱·추이 차트 |
| 경쟁 분석 · ASO | 빠진 키워드, 이미 반영된 키워드, 제목/간단 설명 후보(글자 수 검증), 상세 설명 구성안, 상위 경쟁 앱 표 |
| 콘텐츠 스튜디오 | 앱·채널·키워드 선택 → 생성 → 미리보기 → 복사/HTML 저장/웹훅 발송 |
| 보관함 | 생성 초안 목록, 상세 보기, 사용 완료 표시, 삭제, HTML·MD 다운로드 |
| 설정 | 자동 점검·생성 일정, 순위 깊이, 웹훅(테스트 발송·발송 기록), OpenAI 키, UTM, 백업/내보내기 |

스크린샷은 `docs/screenshots/` 에 있습니다. (`01-dashboard` … `10-mobile`)

---

## 4. API 요약

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/health` | 상태 확인 |
| GET | `/api/overview` | 대시보드 집계 |
| GET/POST | `/api/apps` | 앱 목록 / 앱 등록(`packageId` 또는 스토어 URL, `label?`, `keywords?`, `fetchNow?`) |
| GET/DELETE | `/api/apps/:id` | 앱 상세(스냅샷·키워드·순위) / 삭제 |
| POST | `/api/apps/:id/refresh` | Play 스토어에서 정보 새로고침 |
| POST | `/api/apps/:id/keywords` | 키워드 추가(`terms` 또는 `term`) |
| PATCH/DELETE | `/api/keywords/:id` | 활성/비활성, 삭제 |
| POST | `/api/apps/:id/check-ranks` | 순위 즉시 점검 |
| GET | `/api/apps/:id/rank-history?keywordId=&days=` | 차트용 이력 |
| GET | `/api/apps/:id/aso?keywordId=` | 경쟁 분석·문구 제안 |
| GET/POST | `/api/apps/:id/aso-plans` | 저장된 ASO 개편안 조회 / 저장(`title`, `summary`, `descriptionHead`, `keywords`, `rationale`) |
| DELETE | `/api/aso-plans/:id` | ASO 개편안 삭제 |
| POST | `/api/apps/:id/content` | 홍보 글 생성(`channel`, `keywordIds?`, `useAi?`, `deliver?`) |
| GET | `/api/drafts` · `/api/drafts/:id` | 초안 목록·상세 |
| GET | `/api/drafts/:id/download?format=html\|md` | 다운로드 |
| POST | `/api/drafts/:id/deliver` | 웹훅 즉시 발송 |
| POST | `/api/webhook/test` | 테스트 발송 |
| GET/PUT | `/api/settings` | 설정 조회/수정 (OpenAI 키는 마스킹) |
| GET | `/api/scheduler` · POST `/api/scheduler/run` | 일정 상태 / 즉시 실행(`kind=rank\|content`) |
| POST | `/api/import-developer` | 개발자 페이지에서 앱 일괄 등록 (`query=이음소프트웨어`) |
| GET | `/api/export?format=json\|csv` | 백업 |

웹훅 페이로드(요약):
```json
{
  "event": "draft.created",
  "source": "eum-promo-aso-studio",
  "app": { "packageId": "kr.eumsoft.viewer", "name": "이음뷰어", "storeUrl": "https://play.google.com/store/apps/details?id=kr.eumsoft.viewer" },
  "draft": { "channel": "naver_blog", "title": "...", "bodyMarkdown": "...", "bodyHtml": "...", "hashtags": "...", "link": "...utm_source=naver_blog...", "keywords": ["DWG 뷰어"] }
}
```
Slack Incoming Webhook 주소면 `text`/`blocks` 를 함께 보내 채널에 바로 미리보기가 뜹니다.

---

### 쇼츠 API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/shorts/providers` | 엔진·프로바이더 상태, 분위기 목록, ffmpeg 준비 상태 |
| GET | `/api/shorts` | 생성 목록(상태·진행률·제목·대본) |
| POST | `/api/shorts` | `{appId, mood, narration}` → 202 비동기 생성 시작 |
| GET | `/api/shorts/:id` | 단건 상태(폴링용) |
| GET | `/api/shorts/:id/video` | MP4 스트리밍(Range 지원) |
| GET | `/api/shorts/:id/download` | MP4 다운로드 |
| DELETE | `/api/shorts/:id` | 영상 파일 + 기록 삭제 |

`PUT /api/settings` 에서 `shorts_video_provider`, `shorts_video_api_key`, `shorts_video_endpoint`, `shorts_video_model`, `shorts_tts_provider`, `shorts_tts_api_key`, `shorts_tts_voice` 를 저장합니다(키는 마스킹 저장).

## 5. 검증 결과

### 자동 테스트 (62개, 모두 통과)
```bash
npm test
```
- 파서: 상세 페이지, 검색 결과(순위·다음 페이지 토큰), 개발자 페이지, 404
- ASO: 토큰화·가중치·브랜드 필터, 30/80자 제한 검증
- 콘텐츠: 4개 채널 생성물(링크·키워드·UTM 포함), 마크다운→HTML, OpenAI 성공/실패 폴백
- 스케줄러: 매일/매주 다음 실행 시각(KST 경계값)
- 웹훅: 실제 로컬 HTTP 수신, Slack 페이로드, 발송 기록
- API: 앱·키워드·설정 검증·초안·다운로드·내보내기·관리자 비밀번호 세션(위조 쿠키 차단)

### 실제 Google Play 실측
```bash
npm run live-check
```
전체 앱 감사·ASO 진단·개편안 저장은 아래 스크립트로 실행합니다.
```bash
node scripts/full-audit.ts      # 개발자 페이지 전수 + 앱 정보 + 키워드 순위 + 경쟁사 상세
node scripts/aso-diagnose.ts    # 제목·요약·설명 키워드 배치/밀도 + 전환 요소
node scripts/apply-aso-plans.ts # ASO 개편안 저장 + 홍보 초안 생성
node scripts/capture-screens.ts # 최종 데이터 기준 화면 캡처(읽기 전용)
```
2026-11-25 실행 결과 (`docs/live-check-2026-11-25.json`):

| 앱 | 제목 | 설치 | 버전 | 최근 업데이트 |
| --- | --- | --- | --- | --- |
| kr.eumsoft.viewer | PDF·캐드 뷰어(DWG·DXF) - 이음뷰어 | 1+ | 2.0.2 | 2026-11-23 |
| kr.eumsoft.zip | 이음ZIP | 10+ | 1.7.1 | 2026-11-24 |
| kr.eumsoft.docs | 이음과 문서 | 1+ | 1.0.8 | 2026-11-22 |

- 키워드 10개 검색 파싱 성공, 오류 0건
- `이음뷰어` 검색 → **2위** (1위 `이음`, 3위 `이음 - 암환자 치유 커뮤니티`)
- `DWG 뷰어`·`캐드 뷰어`·`도면 뷰어`·`압축 풀기` 등 일반 키워드는 30위 안에 없음 → **ASO 개선이 필요한 지점을 그대로 보여줌**

### 브라우저 UI 검증
```bash
npm run ui-check     # chromium 필요
```
- 18개 시나리오 통과, **브라우저 콘솔 오류 0건**, 페이지 예외 0건, 실패 요청 0건
- 대시보드·앱·키워드·추이 모달·ASO·스튜디오·보관함·설정·모바일 레이아웃 스크린샷 저장
- 웹훅 테스트 발송 → 로컬 수신 서버에서 실제 JSON 수신 확인

> `ui-check` 는 `CHROMIUM_PATH` 환경변수로 실행 파일을 지정할 수 있습니다. 일반 환경에서는 `npx playwright install chromium` 후 `CHROMIUM_PATH` 없이 실행하세요.

---

## 6. 설계 메모 / 한계

- **수집 방식**: Play 스토어 웹 페이지의 `AF_initDataCallback(ds:N)` 데이터를 그대로 읽습니다(공개 페이지, 로그인 불필요). 화면 HTML 클래스가 바뀌어도 데이터 구조가 유지되면 동작합니다. 구조가 바뀌면 `src/playstore/*.ts` 의 경로만 고치면 되고, `npm run live-check` 로 바로 확인할 수 있습니다.
- **순위 깊이**: Play 웹 검색은 한 페이지에 30개를 내려주고, 다음 페이지 토큰이 있을 때만 이어서 가져옵니다. 코드는 토큰이 있으면 최대 50위까지 이어 받지만, 현재 Play 는 대부분의 검색어에 토큰을 주지 않아 실질 상한은 30위입니다. 30위 밖은 `권 밖`으로 정확히 기록합니다.
- **요청 매너**: 키워드당 1회, 기본 타임아웃 20초, 5xx 재시도 2회. 앱 여러 개를 동시에 돌리지 않고 순차 처리해 차단 위험을 낮춥니다.
- **스케줄러**: 서버 프로세스 안에서 30초마다 확인합니다. 서버가 잠들면(Railway 무료 플랜 등) 실행되지 않으므로, 상시 구동 플랜이 아니면 외부 크론으로 `/api/scheduler/run` 을 호출해도 됩니다.
- **정책 준수**: 생성 글은 초안일 뿐 자동 게시하지 않습니다. Play 정책상 금지되는 과장·순위 보장·타사 상호 사용 문구는 넣지 않으며, 경쟁 앱에만 있는 키워드는 실제 지원 여부를 사람이 확인하도록 안내 문구를 함께 표시합니다. 커뮤니티 글에는 광고(자체 제작) 표시가 들어갑니다.
- **보안**: `ADMIN_PASSWORD` 를 설정하면 모든 `/api/*` 가 HMAC 서명 세션 쿠키를 요구합니다. OpenAI 키는 화면에 마스킹되어 표시되고, 마스킹 값을 다시 저장해도 실제 키를 덮어쓰지 않습니다.

---

## 7. 프로젝트 구조

```
eum-promo/
├─ src/
│  ├─ server.ts            Express 앱·API·세션
│  ├─ db.ts                node:sqlite 스키마·쿼리
│  ├─ service.ts           순위 점검·경쟁 분석·초안 생성 오케스트레이션
│  ├─ scheduler.ts         내장 스케줄러(KST)
│  ├─ webhook.ts           웹훅 페이로드·발송·기록
│  ├─ playstore/           Google Play 파서 (scriptData, appDetails, search, developer, http)
│  ├─ aso/analysis.ts      키워드 갭 분석·문구 제안
│  └─ content/             템플릿 엔진, OpenAI 연동, 마크다운 변환
├─ public/                 대시보드 (index.html, styles.css, app.js)
├─ tests/                  node:test 단위·API 테스트 + 픽스처
├─ scripts/                make-fixtures, live-check(실측), ui-check(스크린샷), full-audit·aso-diagnose·apply-aso-plans(전체 감사)
├─ docs/                   실측 결과 JSON, 스크린샷
├─ Dockerfile
└─ README.md
```

## 8. 라이선스 / 문의

사내 운영용으로 작성했습니다. 외부 배포 전에는 `docs/` 의 실측 결과와 스크린샷을 함께 확인하세요.
