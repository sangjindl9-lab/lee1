# 현장통합 그룹웨어 (1차)

전기·정보통신공사업체용 업무 프로그램. 공사 등록 → 설계내역 → 공정계획 → 작업일보 → 공정률, 자재요청 → 결재 → 견적 → 발주 → 부분입고·반품까지 서버 DB에 저장되며 권한·결재·출력이 연결되어 동작합니다.

## 구성

| 구분 | 기술 | 선택 이유 |
|---|---|---|
| 서버 | Python 3.11+ / FastAPI / SQLAlchemy 2 | 입력값 검증(Pydantic)·트랜잭션 제어가 명확, 유지보수 인력 확보 용이 |
| DB | PostgreSQL 14+ | 금액 `NUMERIC`(소수 오차 없음), 행 잠금으로 입고·결재 동시처리 안전 |
| 마이그레이션 | Alembic | 스키마 변경 이력 관리 |
| 파일 | 서버 디스크 (`FILE_STORAGE_DIR`) | 단순·백업 쉬움. `services/storage.py` 교체로 S3 호환 저장소 전환 가능 |
| 화면 | 빌드 없는 한국어 SPA (HTML/JS) | Node 빌드 없이 서버에 바로 배포 |
| PDF | WeasyPrint | HTML→PDF, 한글 폰트·표 머리글 반복·쪽번호·가로 출력 |
| 엑셀 | openpyxl | 실제 .xlsx 생성·업로드 검증 |

```
backend/app/
  models.py          데이터 모델 (모든 업무 테이블에 company_id)
  security.py        세션 인증, CSRF, Argon2 비밀번호, 서버측 권한·현장 범위 검사
  permissions.py     권한 목록·기본 역할·문서번호 기본 형식
  services/          공정률 계산, 결재 엔진, 파일 저장, PDF, 엑셀, 감사로그·채번
  routers/           API (auth, admin, projects, boq, daily_reports, worklogs, materials, approvals, files, dashboard, exports, imports)
  templates/pdf/     출력 양식 (작업일보, 발주서, 자재요청서, 결재문서, 공정현황, 사진대장)
backend/migrations/  Alembic 마이그레이션
backend/tests/       필수 검증 시나리오 테스트
frontend/            화면 (index.html, css, js/pages)
scripts/             backup.sh, restore.sh
```

## 설치·실행 (Ubuntu 기준)

```bash
# 1) 시스템 패키지: PostgreSQL, PDF 렌더링 라이브러리, 한글 폰트
sudo apt install -y postgresql python3-venv libpango-1.0-0 libpangoft2-1.0-0 fonts-noto-cjk fonts-nanum

# 2) DB 생성
sudo -u postgres psql -c "create user gw with password '강력한비밀번호';"
sudo -u postgres psql -c "create database groupware owner gw;"

# 3) 파이썬 환경
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# 4) 설정
cp .env.example .env      # DATABASE_URL, FILE_STORAGE_DIR 수정

# 5) 테이블 생성 + 회사·관리자 초기화
alembic upgrade head
python -m app.cli init --company "우리회사(주)" --admin-login admin --admin-name "관리자"
#   → 관리자 비밀번호를 물어봅니다. 첫 로그인 때 비밀번호를 다시 바꾸게 됩니다.

# (선택) 화면 확인용 데모 데이터 — 이름에 [데모], 공사에 '데모' 표시
python -m app.cli seed-demo

# 6) 실행
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

브라우저에서 `http://서버주소:8000` 접속.

### 운영 시 권장
- 앞단에 Nginx/Caddy로 HTTPS 적용 후 `.env`에 `COOKIE_SECURE=true`, `APP_ENV=production`
- 프로세스 관리: systemd 서비스로 `uvicorn app.main:app --workers 2` 실행
- 업로드 크기 제한(`MAX_UPLOAD_MB`)과 Nginx `client_max_body_size`를 맞추기
- 스키마가 바뀐 새 버전 배포 시: 백업 → 코드 교체 → `alembic upgrade head` → 재시작

## 초기 관리자 설정 순서

1. `admin`으로 로그인 → 새 비밀번호 설정
2. **회사·문서번호**: 회사명, 사업자번호, 로고·직인 이미지, 원 미만 처리(기본 절사), 부가세율(기본 0.1), 문서번호 형식, 직종·날씨·사진 구분 목록
3. **부서·직책**: 기본값 수정
4. **역할·권한**: 7개 기본 역할(관리자, 대표·임원, 공무, 구매, 경리, 현장소장, 현장 직원)의 권한 확인·수정
5. **사용자**: 직원 계정 생성 (초기 비밀번호는 첫 로그인 때 본인이 변경)
6. **결재선**: 문서 종류·금액 구간별 기본 결재선 (없으면 기안자가 상신 때 지정)
7. **공사 등록** → 공사 화면 > 개요 > 참여 직원에서 현장 배정

## 데이터 저장·백업·복원

- DB: PostgreSQL (`DATABASE_URL`), 첨부파일: `FILE_STORAGE_DIR` 폴더
- 삭제는 휴지통 보관(소프트 삭제). 관리자 > 휴지통에서 복구
- 모든 등록·수정·삭제·결재·로그인은 감사로그(관리자 > 변경이력)에 변경 전후 값과 함께 기록

```bash
scripts/backup.sh /백업/경로          # DB 덤프 + 첨부파일 압축 + SHA256 체크섬
# 서버를 멈춘 뒤
scripts/restore.sh /백업/경로/20261018_064500   # 체크섬 확인 → 'YES' 입력 시 복원
```
매일 백업 예시(crontab): `0 2 * * * /srv/groupware/scripts/backup.sh /backup/groupware`
백업 폴더는 **다른 디스크나 외부 저장소**에 보관하세요.

## 테스트

```bash
createdb -O gw groupware_test
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql+psycopg://gw:비밀번호@localhost/groupware_test pytest -q tests
```
테스트는 `groupware_test` DB의 스키마를 지우고 다시 만듭니다. 운영 DB를 지정하지 마세요.

## 주요 계산 규칙

- **항목 공정률** = 기준일까지 *승인된* 일보의 누계 수량 ÷ 설계수량 × 100. 설계수량 0 → 계산 불가로 제외
- **전체 공정률** = 항목 공정률(100% 상한)의 가중평균 (설계금액 가중 또는 사용자 지정 가중). 단위가 다른 수량은 합산하지 않음
- **계획 공정률** = 기간별 계획 누계수량이 있으면 그 값, 없으면 계획 시작~종료일 균등 배분
- 일보 실적은 승인 시점에 `progress_entries`로 고정 → 재저장·재승인해도 중복되지 않고, 정정 승인 시 교체·승인취소 시 제거. 승인 당시 설계수량·전일누계도 함께 고정되어 과거 승인본 수치가 바뀌지 않음
- **미입고** = 발주 − 취소 − (입고 누계 − 반품 누계). 입고는 발주서 행 잠금 + 요청 키로 중복 처리 방지
- 금액은 `NUMERIC`, 원 미만은 회사 설정(기본 절사). 부가세는 품목별 계산 후 합산
