# CCTV 공사 설계 프로그램

IP CCTV·동축 CCTV·혼합형 현장의 **도면 업로드 → 축척 설정 → 장비 배치 → 케이블·관로 경로 작성 → 계통도 → 설계 검토 → 물량산출 → PDF·Excel·DXF 출력**까지 처리하는 독립 서버 설치형 웹 프로그램입니다. 여러 사용자가 한 서버에 접속해 프로젝트별 권한으로 함께 사용합니다.

## 1. 요구 사항

| 항목 | 버전·내용 |
|---|---|
| 운영체제 | Linux (Ubuntu 22.04/24.04, Debian 12 권장) · Windows는 Docker Desktop 사용 |
| Node.js | 22.9 이상 |
| poppler-utils | `pdfinfo`, `pdftoppm`, `pdftotext` (PDF 업로드 시 필수) |
| DWG 변환(선택) | LibreDWG `dwg2dxf` 또는 ODA File Converter — `docs/DWG_엔진.md` |
| 지도(선택) | 관리자 설정 타일 서버 (기본 OpenStreetMap) |
| 브라우저 | Chrome·Edge 최신 (PC 편집), 모바일 Chrome·Safari (현장 화면) |

## 2. 설치·실행

### 방법 A — Docker (권장)
```bash
cp .env.example .env          # ADMIN_PASSWORD 등 수정
docker compose up -d --build  # LibreDWG까지 빌드 (약 5~10분)
# 접속: http://서버IP:3000
```
데이터는 `./data`(DB·원본 파일)에 저장됩니다. 이 폴더를 정기 백업하세요.

### 방법 B — 서버에 직접 설치
```bash
sudo apt-get install -y poppler-utils build-essential python3
npm ci --omit=dev
cp .env.example .env          # 값 수정
npm start                     # 최초 실행 시 DB 마이그레이션 자동 적용
```
- `better-sqlite3`는 설치 시 GitHub에서 미리 빌드된 바이너리를 받습니다. 인터넷이 막힌 서버는 `build-essential`·`python3`와 Node 헤더가 있어야 소스 빌드되며, 어려우면 Docker 방식을 쓰세요.
- 상시 운영은 `pm2 start npm --name cctv -- start` 또는 systemd 서비스로 등록합니다.
- HTTPS는 Nginx 등 역방향 프록시에서 처리하고 `.env`에 `COOKIE_SECURE=1`, `PUBLIC_URL=https://…`를 지정합니다.
- DWG를 쓰려면 LibreDWG를 설치(아래)하고 `DWG_ENGINE_PATH`를 지정하거나 관리자 화면에서 설정합니다.

```bash
# LibreDWG 소스 빌드 (GPLv3)
curl -LO https://github.com/LibreDWG/libredwg/releases/download/0.13.3/libredwg-0.13.3.tar.xz
tar xf libredwg-0.13.3.tar.xz && cd libredwg-0.13.3
./configure --prefix=/opt/libredwg --disable-bindings --disable-python --disable-docs && make -j4 && sudo make install
```

## 3. 관리자 계정 초기 설정
1. DB에 사용자가 없을 때 최초 실행하면 `ADMIN_USER`/`ADMIN_PASSWORD`로 관리자 계정과 `INIT_COMPANY` 회사가 생성됩니다. `ADMIN_PASSWORD`를 비우면 임의 비밀번호가 **서버 로그에 1회** 출력됩니다.
2. 로그인 후 상단 **비밀번호 변경**으로 즉시 바꿉니다.
3. **관리자** 메뉴에서 회사 로고, 사용자(관리자·설계자·검토자·조회자), DWG 변환 엔진을 설정합니다.
4. 프로젝트 **프로젝트 설정 → 프로젝트 멤버·권한**에서 사용자별 접근 권한을 지정합니다. (관리자는 모든 프로젝트 접근)

| 권한 | 가능한 작업 |
|---|---|
| 관리자 | 전체 프로젝트, 사용자·회사·DWG 엔진·품목 삭제 |
| 설계자 | 프로젝트 생성, 도면 업로드, 설계·편집, 출력, 백업·복원, 품목 등록 |
| 검토자 | 조회·출력 + 현장 확인 상태·사진·시험결과 등록 |
| 조회자 | 조회·출력·다운로드만 |

전역 권한과 프로젝트 권한 중 **낮은 쪽**이 적용됩니다. 파일 다운로드·QR 조회·PDF/Excel 출력 모두 서버에서 같은 권한을 검사합니다.

## 4. 샘플 프로젝트와 검증
```bash
npm run sample:drawings                       # samples/input 에 샘플 PNG·DXF 생성 (python3, Pillow, ezdxf 필요 – 이미 포함됨)
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… npm run sample:seed   # IP·동축 혼합 샘플 프로젝트 생성
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… npm run verify        # 요구사항 18장 1~16 + 추가 기능 자동 검증 (146개 항목)
BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… npm run verify:ui     # 브라우저 화면 검증 (Playwright 필요)
```
결과: `samples/output/test-results.md`, `test-results-ui.json`, 생성된 PDF·Excel·DXF, `screenshots/`.
샘플 프로젝트는 `is_sample` 표시로 실제 프로젝트와 구분되며, 목록에서 숨길 수 있습니다. 샘플 품목은 `[샘플]` 이름과 "실제 제품 사양 아님" 비고가 붙어 있습니다.

## 5. 사용 흐름
1. **새 프로젝트** → 공사명·현장·발주처·시스템 방식(IP형/동축형/혼합형) 입력
2. **+ 업로드**: JPG·PNG / PDF(여러 쪽 선택 → 쪽별 도면) / DXF / DWG(엔진 설정 시)
3. **축척 보정**: 도면에서 두 점 클릭 → 실제 거리(mm·cm·m) 입력. CAD는 단위($INSUNITS) 자동 반영 후 "CAD 단위 확인"
4. 왼쪽 라이브러리에서 장비 선택 → 도면 클릭 배치. 오른쪽 속성 패널에서 IP·VLAN·NVR 채널·신호 방식·화각 등 입력
5. 상단 케이블 도구(UTP·광·동축·복합·전원·접지) → 시작 장비 클릭 → 경유점 → 종료 장비 클릭. 포트는 자동 지정 후 속성에서 변경
6. **배관·트레이** 도구로 관로 작성 → 관로 속성의 "경로가 겹치는 케이블 자동 할당" 또는 케이블 속성에서 경유 관로 지정
7. 하단 **검토** 탭에서 오류·경고·확인 필요 확인(클릭 시 해당 객체로 이동)
8. **계통도** 전환 → 자동 배치 후 끌어서 조정(재생성 시 유지)
9. **출력(PDF)**: 도면 종류·용지·축척 방식·영역·레이어·흑백 선택 → 미리보기 → 저장/인쇄. **Excel**: 전체 산출표

단축키: `Ctrl+S` 저장, `Ctrl+Z/Y` 실행취소/다시, `Ctrl+C/V/D` 복사/붙여넣기/복제, `Ctrl+G` 그룹(`Shift`+해제), `Delete` 삭제, `R` 회전(15°), `F` 전체 보기, `F8` 직교, `Space`+드래그 이동, `Esc` 취소.

## 6. 백업·복원
- 프로젝트 화면 **백업** → zip(project.json + 원본·첨부 파일) 다운로드
- 프로젝트 목록 **백업 복원** → 새 ID로 별도 프로젝트 생성(기존 프로젝트 영향 없음)
- 서버 전체 백업: `DATA_DIR` 폴더(cctv.db, files/) 복사. SQLite WAL 사용 중이므로 서비스 정지 후 복사하거나 `sqlite3 cctv.db ".backup backup.db"` 사용

## 7. 폴더 구조
```
server/            Express API, 마이그레이션(server/migrations), 서비스(files·dxf·pdfout·excel·dxfout·backup)
shared/            화면·서버 공통 계산 모듈 (catalog, calc, tables, schematic, symbols)
public/            웹 화면 (index.html 편집기, m.html 현장 모바일)
fonts/             PDF 내장 한글 글꼴 (Noto Sans CJK KR, SIL OFL 1.1, 한글·기호 부분집합)
scripts/           샘플 생성·자동 검증
docs/              설계 문서, DWG 엔진, 구현 현황
samples/           샘플 입력 도면, 검증 결과·출력 예시
```
자세한 기술 구조는 `docs/아키텍처.md`, 기능별 구현 범위는 `docs/구현현황.md`를 참고하세요.
