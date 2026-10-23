# 공사내역서 자동 재가공 · 기성/설계변경 관리 시스템

기존 공사원가내역서 엑셀을 업로드하면 시트·열 구조를 자동 인식해 계약내역으로 가져오고,
기성내역서(회차별 전회·금회·누계·잔여)와 설계변경내역서(당초·변경·증감, 변경 원가계산서)를
규칙 기반 Decimal 계산 엔진으로 생성해 **원본 서식 또는 표준양식 엑셀**로 출력합니다.

- 프론트엔드: React 19 + TypeScript (Vite)
- 백엔드: Python 3.12 / FastAPI / SQLAlchemy 2 / openpyxl
- DB: PostgreSQL (운영) · SQLite (개발 기본값)
- 배포: Docker (단일 이미지에 프론트 빌드 포함) / docker-compose / Railway

## 핵심 흐름

```
엑셀 업로드 → 자동 분석(시트 역할·열 매핑·수식/반올림/참조 관계·금액 검증)
  → 계약내역 v0 가져오기 → 기성 회차 생성 → 금회 입력(수량/누계/기성률/엑셀 일괄)
  → 전회·금회·누계·잔여 자동 계산 → 확정 → 기성 엑셀 출력(표준/원본서식)
  → 설계변경(수량·단가·규격·신규·삭제) → 당초·변경·증감 + 변경 원가계산서 → 승인 → 계약내역 v1
  → 이후 기성은 변경계약 기준 잔량 계산, 확정된 기성은 불변
```

## 빠른 실행 (개발)

```bash
# 백엔드
cd backend
pip install -r requirements.txt
cp .env.example .env            # DATABASE_URL 을 비우면 SQLite 사용
uvicorn app.main:app --reload --port 8000

# 프론트엔드 (다른 터미널)
cd frontend
npm install
npm run dev                     # http://localhost:5173  (/api 는 8000 으로 프록시)
```

최초 관리자: `admin / admin1234` (환경변수 `ADMIN_USERNAME`, `ADMIN_PASSWORD` 로 변경).

## 운영 배포

### docker-compose (PostgreSQL 포함)
```bash
SECRET_KEY=$(openssl rand -hex 32) docker compose up -d --build
# http://서버:8000
```

### 단일 Docker 이미지
```bash
docker build -t naeyeok .
docker run -d -p 8000:8000 -v naeyeok-data:/data \
  -e DATABASE_URL=postgresql://user:pw@host:5432/db -e SECRET_KEY=... naeyeok
```

### Railway
저장소를 연결하면 `railway.json` 의 Dockerfile 빌드가 사용됩니다. PostgreSQL 플러그인을 추가하고
`DATABASE_URL`(자동 주입), `SECRET_KEY`, `ADMIN_PASSWORD` 변수를 설정하세요. `/data` 볼륨을 마운트해야 업로드 원본이 보존됩니다.

### 환경변수
| 변수 | 설명 | 기본값 |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy URL (`postgresql://…`, `postgres://` 자동 보정) | `sqlite:///backend/data/app.db` |
| `SECRET_KEY` | JWT 서명 키 | change-me… (반드시 변경) |
| `STORAGE_DIR` | 업로드 원본·출력 파일 저장 경로 | `backend/data/files` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 첫 실행 시 생성되는 관리자 | admin / admin1234 |
| `ACCESS_TOKEN_MINUTES` | 로그인 유지 시간 | 720 |
| `MAX_UPLOAD_MB` | 업로드 용량 제한 | 100 |

테이블은 첫 실행 시 자동 생성됩니다 (`Base.metadata.create_all`).

## 테스트

```bash
cd backend
python -m pytest tests -q
```
- `tests/test_engine.py` — 합성 엑셀 2종(표준형 A / 단일금액 구역형 B) 분석, 반올림 감지·적용, 명세서 4-4 기성 계산 예시, Decimal 정밀도
- `tests/test_e2e.py` — 실제 샘플(`samples/`) 업로드→분석→가져오기→1차 기성→확정→2차 기성(전회 반영)→표준/원본서식 출력→설계변경(수량·신규·삭제)→변경 원가 재계산→승인→3차 기성 잔량, 시트 역할/열 매핑 지정

결과 엑셀은 LibreOffice 재계산 기준 수식 오류 0건을 확인했습니다 (원본 서식 출력 시 매크로 함수·외부참조 수식은 저장값으로 고정).

## 프로젝트 구조

```
backend/app/
  excel/loader.py          수식본·값본 동시 로드, 외부참조/오류셀/매크로/숨김시트 수집
  excel/classifier.py      시트 역할 분류 (이름 사전 + 헤더 키워드 + 공종줄/합계줄/일목줄 마커)
  excel/column_mapper.py   2행 헤더·병합·열 순서 변경 대응 열 자동 인식, 사용자 매핑 적용
  excel/parser.py          행 유형(공종/품목/소계/변경행) 판별, 공종 트리, 단가 출처·반올림 규칙 감지,
                           당초·변경 2행형 인식, 원가계산서 비목·요율 추출, 일위대가 파싱
  excel/validator.py       수량×단가=금액, 소계 대조, 원가계산서 대조(관급 제외 비교)
  excel/analyzer.py        분석 오케스트레이션 (여러 내역서 시트 분리형 지원)
  excel/export_progress.py 기성 엑셀: 표준양식 / 원본서식(시트 복제 + 기성 열 추가)
  excel/export_change.py   설계변경 엑셀: 대비표·2행형 변경내역서·증감총괄·변경원가·신규품목·사유서
  services/calc.py         Decimal 반올림·금액 계산 규칙
  services/progress.py     기성 계산 엔진 (전회/금회/누계/잔여/기성률, 검증, 확정)
  services/design_change.py 설계변경 계산·승인(새 계약 버전 생성, 기성 인정수량 보호)
  services/costcalc.py     원가계산서 제비율 재계산
  models.py                projects, source_files, workbook_sheets, mapping_rules, contract_versions,
                           estimate_items, unit_price_analyses, cost_rate_rules, progress_claims,
                           progress_items, design_changes, design_change_items, export_templates, audit_logs
  routers/                 core(인증·공사·대시보드) files estimates progress changes
frontend/src/pages/        대시보드, 공사개요, 원본내역서 관리(열 매핑 편집기), 내역서 편집,
                           기성 회차/작성, 설계변경 목록/작성, 일위대가, 원가계산서, 변경이력, 관리자
samples/                   학습·테스트용 실제 내역서 4종
```

## 주요 API
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/login` | 로그인 (OAuth2 form) |
| GET/POST | `/api/projects` | 공사 목록/등록 |
| POST | `/api/projects/{id}/files` | 엑셀 업로드 (`sync=true` 동기 분석) |
| GET | `/api/files/{id}/analysis` | 분석 결과 (시트 역할·열 매핑·검증·원가·일위대가) |
| PUT | `/api/files/{id}/sheets/{sheet}` | 시트 역할·열 매핑 지정 → 재분석, 양식 규칙 저장 |
| POST | `/api/files/{id}/import` | 계약내역 버전 생성 |
| GET/PUT | `/api/versions/{id}/items` | 품목 조회 / draft 수정 |
| POST | `/api/projects/{id}/claims` | 기성 회차 생성 |
| PUT | `/api/claims/{id}/inputs` | 금회 입력 (`this_qty` / `cum_qty` / `rate` / `this_rate`) |
| POST | `/api/claims/{id}/upload-qty` | 수량 엑셀 일괄 업로드 |
| POST | `/api/claims/{id}/confirm` | 회차 확정 |
| GET | `/api/claims/{id}/export?mode=standard\|original` | 기성 엑셀 |
| POST | `/api/projects/{id}/changes` | 설계변경 차수 생성 |
| PUT | `/api/changes/{id}/items` | 변경 항목 (modify/add/delete/spec_change/reset) |
| POST | `/api/changes/{id}/approve` | 승인 → 새 계약 버전 |
| GET | `/api/changes/{id}/export` | 설계변경 엑셀 |

## 알려진 한계 / 다음 단계
- PDF 출력은 서버에 LibreOffice 설치 시 `soffice --headless --convert-to pdf` 로 변환하는 방식이 가장 안정적입니다 (현재 엑셀 출력에 인쇄 설정(A4 가로, 반복 제목, 페이지 번호)을 넣어두었습니다).
- 발주처 지정 양식(사용자 지정 템플릿) 자동 삽입은 `export_templates` 테이블과 매핑 구조를 마련해 두었으며 UI 연결이 필요합니다.
- 한전 설계서형(단일 금액 열 + 집계표 횡배치)은 품목·재료/노무 구역 인식까지 지원하며, 집계표 과목별 합산은 열 매핑 편집기로 보완합니다.
- 대용량 파일은 업로드 후 백그라운드 분석(`sync=false`)으로 처리하며 목록에서 상태가 갱신됩니다.
