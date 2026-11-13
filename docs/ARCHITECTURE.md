# 프로젝트일정표 — 아키텍처

## 1. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 24 (이 PC에 설치된 v24.20.0, npm 11) | 추가 설치 불필요 |
| 언어 | TypeScript (strict) | 서버·클라이언트·계산 로직이 타입을 공유 |
| 서버 | Express 4 | 단순한 REST API와 정적 파일 제공 |
| 클라이언트 | React 18 + Vite | 표 중심의 상호작용 화면, 빠른 빌드 |
| 저장소 | 로컬 JSON 파일(`data/db.json`) | 외부 DB·네이티브 모듈 빌드 없이 동작 |
| 그래프 | 직접 그리는 SVG 컴포넌트 | 차트 라이브러리 의존 없이 테스트 가능 |
| 테스트 | Vitest, Supertest, React Testing Library(jsdom) | 단위·API·컴포넌트 테스트를 한 실행기로 처리 |
| 서버 개발 실행 | tsx | TypeScript 서버를 바로 실행 |

단일 npm 패키지로 구성합니다(워크스페이스 없음).

### npm 스크립트

| 명령 | 동작 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm test` | `vitest run` — 전체 자동 테스트 |
| `npm run build` | `tsc -p tsconfig.server.json`(→ `dist/server`) 후 `vite build`(→ `dist/client`) |
| `npm start` | `node dist/server/server/index.js` — API와 빌드된 화면을 한 포트에서 제공 |
| `npm run dev` | API 서버(tsx watch)와 Vite 개발 서버 동시 실행, `/api`는 프록시 |

### 환경 변수 (`.env.example`에 이름만 기재)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `PORT` | 3000 | 서버 포트 |
| `DATA_DIR` | `./data` | JSON 데이터 파일 폴더 |

## 2. 폴더 구조

```
/
├─ package.json
├─ tsconfig.json              # 공통(클라이언트·테스트 타입 검사)
├─ tsconfig.server.json       # 서버 빌드용(src/server + src/shared)
├─ vite.config.ts             # 클라이언트 빌드, 개발 프록시
├─ vitest.config.ts           # 테스트 환경(node / jsdom 구분)
├─ index.html                 # Vite 진입 HTML
├─ .env.example
├─ README.md                  # 한국어 실행·사용 안내
├─ docs/                      # 기획 문서, DESIGN.md
├─ data/                      # 실행 시 생성(db.json), git 제외
├─ src/
│  ├─ shared/                 # 서버·클라이언트 공용, 부수효과 없는 순수 코드
│  │  ├─ types.ts             # 데이터 모델·API 응답 타입
│  │  ├─ dates.ts             # 날짜 문자열(YYYY-MM-DD) 연산, 기간 생성
│  │  ├─ bohal.ts             # 보할·계획·실적·요약 계산
│  │  ├─ validation.ts        # 입력 검증 규칙과 한국어 오류 메시지
│  │  └─ csv.ts               # 공정표 → CSV 문자열
│  ├─ server/
│  │  ├─ index.ts             # 환경 변수 읽기, 서버 시작
│  │  ├─ app.ts               # createApp(store): Express 앱 조립
│  │  ├─ store.ts             # JSON 파일 저장소
│  │  ├─ errors.ts            # HttpError, 오류 응답 미들웨어
│  │  └─ routes/
│  │     ├─ projects.ts       # 프로젝트 CRUD
│  │     ├─ tasks.ts          # 공종 CRUD, 순서 변경
│  │     ├─ progress.ts       # 실적 기록
│  │     └─ schedule.ts       # 공정표 계산 결과, CSV
│  └─ client/
│     ├─ main.tsx
│     ├─ App.tsx              # 라우팅(해시 기반), 공통 레이아웃
│     ├─ api.ts               # fetch 래퍼
│     ├─ format.ts            # 숫자·날짜 표시 형식
│     ├─ styles/              # tokens.css, base.css, print.css
│     ├─ pages/
│     │  ├─ ProjectListPage.tsx
│     │  └─ ProjectDetailPage.tsx
│     └─ components/
│        ├─ ProjectForm.tsx
│        ├─ TaskTable.tsx
│        ├─ TaskForm.tsx
│        ├─ ProgressDialog.tsx
│        ├─ ScheduleToolbar.tsx
│        ├─ BohalTable.tsx
│        ├─ SummaryCards.tsx
│        └─ SCurveChart.tsx
└─ tests/
   ├─ setup.ts
   ├─ shared/                 # bohal, dates, validation, csv 단위 테스트
   ├─ server/                 # store, API(Supertest) 테스트
   ├─ client/                 # 컴포넌트 테스트(jsdom)
   └─ e2e/                    # 빌드 산출물 구동 스모크 테스트
```

## 3. 데이터 모델

날짜는 모두 `YYYY-MM-DD` 문자열이며 시간대 변환 없이 달력 날짜로 다룹니다.

```ts
type WeightBasis = 'amount' | 'manual';
type PeriodUnit = 'month' | 'week';

interface Project {
  id: string;              // UUID
  name: string;            // 1~100자
  description: string;
  startDate: string;
  endDate: string;
  weightBasis: WeightBasis;
  createdAt: string;       // ISO 8601
  updatedAt: string;
}

interface Task {
  id: string;
  projectId: string;
  category: string;        // 구분(빈 문자열 허용)
  name: string;            // 공종명
  weightValue: number;     // 금액 또는 가중치, > 0
  startDate: string;
  endDate: string;
  order: number;           // 표시 순서(0부터)
}

interface ProgressRecord {
  id: string;
  taskId: string;
  date: string;
  percent: number;         // 그 날짜까지의 누계 진척률 0~100
}
```

### 저장 파일 `data/db.json`

```json
{ "version": 1, "projects": [], "tasks": [], "progress": [] }
```

- 파일이 없으면 빈 구조로 생성합니다.
- 쓰기는 `db.json.tmp`에 기록한 뒤 이름을 바꿔 교체합니다.
- 쓰기 요청은 저장소 내부에서 순차 처리합니다.

### 계산 결과(저장하지 않고 요청 시 계산)

```ts
interface Period { key: string; label: string; start: string; end: string; }
// 월: key "2026-01", label "2026년 1월" / 주: key는 주 시작일, label "1/5~1/11"

interface ScheduleRow {
  taskId: string; category: string; name: string;
  weightValue: number;
  bohal: number;               // %
  startDate: string; endDate: string;
  currentPercent: number;      // 기준일 현재 공종 진척률
  planned: (number | null)[];  // 기간별 계획값, 작업 기간이 아니면 null
}

interface Schedule {
  project: Project;
  unit: PeriodUnit;
  asOf: string;                       // 기준일
  periods: Period[];
  asOfPeriodIndex: number | null;     // 기준일이 속한 기간, 범위 밖이면 null
  rows: ScheduleRow[];
  totals: {
    weightValue: number;
    bohal: number;                    // 100 또는 0
    periodPlanned: number[];
    cumulativePlanned: number[];
    periodActual: (number | null)[];  // 기준일 이후 기간은 null
    cumulativeActual: (number | null)[];
  };
  summary: {
    plannedToDate: number;            // 기준일 현재 계획 누계(일 단위 배분)
    actualToDate: number;
    variance: number;                 // actual − planned
    status: 'ahead' | 'onTrack' | 'behind';
  };
}
```

### 계산 규칙 (`src/shared/bohal.ts`)

1. 보할 `b_i = weightValue_i / Σ weightValue × 100`.
2. 공종 일수 `D_i = endDate − startDate + 1`.
3. 기간 p의 공종 계획값 `= b_i × overlapDays(공종, p) / D_i`. 겹침이 0이면 `null`.
4. `periodPlanned[p] = Σ_i 계획값`, `cumulativePlanned[p] = Σ_{q≤p} periodPlanned[q]`.
5. 날짜 d의 공종 진척률 `r_i(d)` = d 이하 날짜의 기록 중 가장 최근 값, 없으면 0.
6. 기간 p의 평가일 `e_p = min(p.end, asOf)`. `p.start > asOf` 이면 실적은 `null`.
7. `cumulativeActual[p] = Σ_i b_i × r_i(e_p) / 100`, `periodActual[p] = cumulativeActual[p] − cumulativeActual[p−1]`(첫 기간은 이전 값 0).
8. `plannedToDate = Σ_i b_i × clamp((asOf − startDate_i + 1) / D_i, 0, 1)`.
9. `variance ≥ 1` → `ahead`, `variance ≤ −1` → `behind`, 그 외 `onTrack`.
10. 반올림은 표시 단계(화면, CSV)에서만 소수 둘째 자리로 수행합니다.

## 4. API

기본 경로 `/api`, 본문은 JSON입니다. 오류 응답 형식: `{ "error": { "code": string, "message": string(한국어), "fields"?: { [필드]: string } } }`.

| 메서드 | 경로 | 설명 | 성공 응답 |
|---|---|---|---|
| GET | `/api/health` | 상태 확인 | 200 `{ ok: true }` |
| GET | `/api/projects?asOf=` | 프로젝트 목록(공종 수, 계획·실적 누계 포함) | 200 `ProjectSummary[]` |
| POST | `/api/projects` | 프로젝트 생성 | 201 `Project` |
| GET | `/api/projects/:id` | 프로젝트와 공종·실적 조회 | 200 `{ project, tasks, progress }` |
| PUT | `/api/projects/:id` | 프로젝트 수정 | 200 `Project` |
| DELETE | `/api/projects/:id` | 프로젝트와 소속 데이터 삭제 | 204 |
| POST | `/api/projects/:id/tasks` | 공종 추가(맨 뒤 순서) | 201 `Task` |
| PUT | `/api/projects/:id/tasks/:taskId` | 공종 수정 | 200 `Task` |
| DELETE | `/api/projects/:id/tasks/:taskId` | 공종과 그 실적 삭제 | 204 |
| PUT | `/api/projects/:id/tasks/order` | 순서 변경. 본문 `{ taskIds: string[] }` | 200 `Task[]` |
| PUT | `/api/projects/:id/tasks/:taskId/progress` | 실적 등록·덮어쓰기. 본문 `{ date, percent }` | 200 `ProgressRecord` |
| DELETE | `/api/projects/:id/tasks/:taskId/progress/:date` | 실적 삭제 | 204 |
| GET | `/api/projects/:id/schedule?unit=month\|week&asOf=YYYY-MM-DD` | 보할 공정표 계산 결과 | 200 `Schedule` |
| GET | `/api/projects/:id/schedule.csv?unit=&asOf=` | 공정표 CSV(UTF-8 BOM, `Content-Disposition: attachment`) | 200 `text/csv` |

- `unit` 기본값 `month`, `asOf` 기본값 서버의 오늘 날짜.
- 상태 코드: 검증 실패 400(`VALIDATION_ERROR`), 대상 없음 404(`NOT_FOUND`), 그 외 500(`INTERNAL_ERROR`).
- `/api` 이외의 경로는 `dist/client`의 정적 파일을 제공하고, 없는 경로는 `index.html`을 반환합니다.

### 검증 규칙 (`src/shared/validation.ts`, 서버와 클라이언트가 공유)

- 프로젝트: 이름 1~100자, 날짜 형식과 실재 여부, `endDate ≥ startDate`, `weightBasis` 값, 기간 변경 시 모든 공종이 새 기간 안에 있을 것.
- 공종: 공종명 1~100자, `weightValue`는 0보다 큰 유한한 수, `endDate ≥ startDate`, 프로젝트 기간 안.
- 실적: 날짜 형식, `percent` 0~100, 같은 공종에서 더 이른 날짜의 값보다 작지 않고 더 늦은 날짜의 값보다 크지 않을 것.

## 5. 화면 구성

라우팅은 해시 기반입니다(`#/`, `#/projects/:id`).

### 5.1 프로젝트 목록 (`#/`)
- 머리말: 제품명 "프로젝트일정표", **새 프로젝트** 버튼
- 프로젝트 카드 목록: 이름, 기간, 공종 수, 계획 누계/실적 누계 진행 막대, 상태 배지, 수정·삭제 버튼
- 프로젝트가 없으면 안내 문구와 새 프로젝트 버튼
- 프로젝트 생성·수정은 대화상자(`ProjectForm`)

### 5.2 프로젝트 상세 (`#/projects/:id`)
상단에 프로젝트 이름·기간·보할 기준과 목록으로 돌아가기 링크, 그 아래 탭 2개.

**탭 1 — 공종 관리**
- `TaskTable`: 구분, 공종명, 금액(또는 가중치), 보할(%), 시작일, 종료일, 현재 진척률, 동작(위로·아래로·실적 입력·수정·삭제). 마지막 행은 합계(금액 합, 보할 100.00%).
- **공종 추가** 버튼 → `TaskForm` 대화상자
- **실적 입력** → `ProgressDialog`: 해당 공종의 실적 기록 목록(날짜, 누계 진척률, 삭제)과 새 기록 입력란

**탭 2 — 보할 공정표**
- `ScheduleToolbar`: 기간 단위(월/주) 전환, 기준일 선택, CSV 내려받기, 인쇄
- `SummaryCards`: 계획 누계, 실적 누계, 편차, 상태
- `BohalTable`: 왼쪽 고정 열(구분, 공종명, 금액, 보할, 시작일, 종료일, 진척률) + 기간 열. 기간 셀에 막대와 계획값. 하단 4행(기간 계획, 누계 계획, 기간 실적, 누계 실적). 기준일 열 강조, 가로 스크롤.
- `SCurveChart`: 계획 누계(실선)와 실적 누계(다른 색 실선+점), 범례, 축 눈금, 기준일 세로선

### 5.3 공통
- 저장 성공·실패는 화면 상단 알림으로 표시, 입력 오류는 해당 입력란 아래에 표시
- 불러오는 중·빈 상태·오류 상태를 각각 표시
- 인쇄 시 `print.css`로 머리말·버튼·탭을 숨기고 가로 방향으로 공정표와 S-Curve만 출력
- 색·간격·글꼴은 `tokens.css`의 CSS 변수로 관리하고 세부 규격은 `docs/DESIGN.md`에 기록

## 6. 테스트 전략

| 층 | 대상 | 도구 |
|---|---|---|
| 단위 | `src/shared` 계산·날짜·검증·CSV | Vitest (node) |
| 저장소 | `store.ts` 읽기·쓰기·재시작 후 유지 | Vitest + 임시 폴더 |
| API | 모든 엔드포인트의 정상·오류 경로 | Supertest + `createApp(임시 저장소)` |
| 컴포넌트 | 폼 검증, 표 렌더링, S-Curve, 탭 흐름 | React Testing Library (jsdom), `fetch` 모의 |
| 스모크 | 빌드 산출물로 서버를 띄워 화면·API 응답 확인 | Vitest + 자식 프로세스 |

테스트는 `DATA_DIR`를 임시 폴더로 지정해 실제 데이터 파일을 건드리지 않습니다.
