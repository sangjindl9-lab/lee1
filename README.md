# 회로·케이블 이력 관리 시스템

전기·정보통신공사업체가 시공부터 준공, 유지보수까지 쓰는 웹 프로그램입니다.
도면에서 케이블·장비를 클릭하면 연결 관계, 시공 정보, 측정 결과, 사진, 변경·보수 이력을 한 화면에서 확인합니다.

## 1. 기술 선정

| 구분 | 선택 | 이유 |
|---|---|---|
| 서버 | Node.js 20+ / Express | 설치가 간단하고 PC·클라우드 어디서나 실행됨 |
| DB | SQLite (better-sqlite3) | 별도 DB 서버 없이 파일 하나로 운영 → 10인 이하 업체에 적합. 외래키·트랜잭션·부분 유일 인덱스 지원 |
| 화면 | 빌드 없는 순수 JS(ES 모듈) | 유지보수할 때 빌드 도구가 필요 없음 |
| 도면 표시 | pdf.js (로컬 제공) | PDF 도면을 브라우저에서 표시, 외부 CDN 미사용 |
| PDF 출력 | Chromium(Playwright) | 한글 폰트, 표 머리글 반복, 페이지 나눔을 안정적으로 처리 |
| 엑셀 | ExcelJS | 양식 생성·업로드 검증·내보내기 |

## 2. 설치·실행

```bash
npm install
cp .env.example .env            # SESSION_SECRET 등 수정
ADMIN_PASSWORD=관리자비밀번호 npm run init   # 최초 관리자 생성 (8자 이상)
npm run seed:demo               # (선택) 시연용 현장·데이터 생성
npm start                       # http://localhost:3000
```

- PDF 출력에는 Chromium과 한글 폰트가 필요합니다. 일반 PC에서는 `npx playwright install chromium`, 리눅스 서버에서는 `fonts-noto-cjk` 설치.
- Docker: `docker build -t cable-history . && docker run -p 3000:3000 -v $(pwd)/data:/data -e SESSION_SECRET=... cable-history`
  (컨테이너 안에서 `node server/init-admin.js` 로 관리자 생성)
- DB 구조는 `migrations/*.sql` 순서대로 서버 시작 시 자동 적용됩니다.
- 백업 대상: `DATA_DIR` 폴더 전체 (app.db, uploads/)

## 3. 구조

```
server/
  index.js          앱 시작, QR 진입(/q/:token), 오류 처리
  config.js db.js   환경변수, DB·마이그레이션·감사 로그
  auth.js           로그인 세션(SQLite 저장), 역할·현장 권한 검사
  routes/           core(로그인·현장·사용자·대시보드) assets(설비·포트·코어·연결·추적) records(측정·기준·이력·첨부) drawings(도면·개정·표시) exports(엑셀·PDF·QR)
  lib/              svc(설비·연결 공통) graph(경로 추적·영향 조회) judge(판정) card(이력 카드) reports(PDF 문서) excel issues files
  seed-demo.js init-admin.js
public/             index.html, css/app.css, js/(app pages card viewer mobile ui)
migrations/001_init.sql
test/verify-api.js  test/verify-ui.py
```

## 4. 데이터 모델

현장 `sites` · 사용자 `users` · 현장 권한 `site_members` · 도면 `drawings` · 도면 개정본 `drawing_revisions` · 도면 표시 객체 `drawing_marks` · 설비 `assets` · 종류별 상세 `asset_details` · 민감정보 `asset_secrets` · 포트·단자·회로 `ports` · 광코어 `cable_cores` · 연결 `connections` + 끝점 `connection_endpoints` · 측정기록 `measurements` · 시험기준 버전 `test_criteria` · 작업 이력 `work_logs` · 첨부 `files` · 감사 로그 `audit_logs`

주요 규칙
- 관리번호와 내부 ID 분리. 관리번호는 현장 내 유일(교체·보관된 설비 제외).
- 포트·코어·케이블 끝단은 활성 연결 1개만 허용 — **DB 부분 유일 인덱스**와 서버 검사로 이중 차단.
- 패치패널·ODF·정보콘센트 포트는 뒤(rear, 고정 배선)와 앞(front, 패치코드)을 구분.
- 분기는 광분배기(splitter) 장비의 IN/OUT 포트로 표현.
- 도면 좌표는 페이지 기준 0~1 정규화 좌표(회전 전 기준)로 저장 → 확대율·화면 크기·회전과 무관.
- 설비 데이터와 도면 표시 객체 분리 → 한 설비를 여러 도면·페이지·개정본에 표시.
- 측정·작업 이력은 덮어쓰지 않음. 확정 기록 수정은 정정 기록 + 정정 사유로만.
- 시험기준 수정 시 새 버전 생성. 측정에는 당시 기준 사본 저장 → 과거 판정이 바뀌지 않음.
- 연결된 설비는 삭제 불가, 그 외 삭제는 보관 처리. 감사 로그는 DB 트리거로 수정·삭제 차단.
- 동시 수정: 설비·도면 표시·작업 이력에 버전 번호 → 충돌 시 409 와 안내.
- 첨부파일은 공개 경로 없이 `/api/files/:id` 에서 현장 권한 확인 후 제공. 확장자·내용 서명·크기 검사.
- 장비 비밀번호는 별도 테이블, 관리자·현장관리자만 조회(감사 기록), 카드·PDF·엑셀·QR에 포함 안 함.

## 5. 역할

| 역할 | 기본 |
|---|---|
| 관리자 | 모든 현장, 사용자·현장 관리, 감사 로그 |
| 현장관리자 | 지정 현장, 지정 권한(등록·수정·삭제·검토), 시험기준 설정 |
| 작업자 | 지정 현장, 지정 권한 |
| 조회자 | 지정 현장 조회만 (권한 설정과 무관) |

## 6. 검증

```bash
npm run verify                                       # API 검증 (임시 데이터 폴더에 서버를 띄워 실행)
BASE=http://localhost:3000 python3 test/verify-ui.py # 화면 검증 (시연 데이터가 있는 서버, Playwright 필요)
```

## 7. 시연 데이터

`npm run seed:demo` 는 `[시연]` 이름의 현장 2개를 `is_demo=1` 로 만듭니다. 화면 상단과 PDF에 "시연용"이 표시됩니다.
시연 계정: `demo_manager`, `demo_worker`, `demo_viewer`, `demo_other`(다른 현장만 접근) — 비밀번호는 `DEMO_PASSWORD` (기본 `demo1234!`, 운영 서버에서는 반드시 변경 또는 시연 데이터 미생성).
시연 판정기준 값(절연저항 1 MΩ, 광손실 3 dB)은 **동작 확인용 예시**입니다. 실제 현장은 설계도서·감리 승인 기준을 근거 문서와 함께 등록하세요.

## 8. 추가 기능

- **DWG/DXF 자동 변환**: 표시용 도면 없이 DWG/DXF만 올리면 PDF 표시본을 자동 생성(흑백). DWG는 LibreDWG(WebAssembly, `@mlightcad/libredwg-web`), DXF는 `dxf-parser` + 자체 렌더러. 표시하지 못한 객체 수는 개정본의 '변환 기록'에 남습니다. 기존 개정본은 도면 관리·뷰어의 "자동 변환" 버튼.
- **OTDR(.sor) 해석**: Telcordia SR-4731 v1·v2. 광케이블 측정 탭 "OTDR 파일 가져오기" → 측정일시·파장·이벤트·광섬유 길이·총손실로 측정기록 생성, 트레이스 그래프·이벤트표 표시. 제조사 고유 블록은 해석하지 않음.
- **실시간 상태 감시**: 설비별 TCP 포트/HTTP 응답 주기 점검, 또는 외부 시스템(NVR·SCADA·NMS)이 `POST /api/ingest/status` 로 보고(현장별 토큰). '실시간 상태'와 '등록 상태'를 구분 표시하고 상태 변화 이력 저장. 도면에 이상 장비 표시.
- **엑셀 일괄 등록 확장**: 광코어 접속, 측정기록 양식 추가.
- **도면 편집**: 선분 더블클릭 꼭짓점 추가, 꼭짓점 오른쪽 클릭 삭제, 그리는 중 오른쪽 클릭 마지막 점 취소. 90° 회전 + 자유 각도(-45°~45°) 회전.
- **모바일 오프라인**: 사진·작업 이력·측정을 단말(IndexedDB)에 먼저 저장 → 연결되면 자동 전송. 앱을 닫아도 남음. 작업마다 고유값(client_ref)으로 서버가 중복 저장 방지. 마지막으로 연 이력 카드는 오프라인에서도 조회.

## 9. 한계와 주의

- **라이선스**: DWG 변환에 쓰는 `@mlightcad/libredwg-web`(LibreDWG)은 **GPL-3.0** 입니다. 회사 서버에서 직접 운영하는 것은 문제없지만, 이 프로그램을 **판매·배포**하면 GPL 조건(소스 공개 등)이 적용됩니다. 판매할 경우 DWG 변환을 상용 라이선스(ODA Drawings SDK, Autodesk APS 등)로 바꾸거나 이 모듈을 빼야 합니다(`server/lib/cad.js` 의 dwgToSvg).
- DWG/DXF 변환은 선·원·호·문자·블록 등 일반 객체 위주입니다. 해치·일부 특수 객체·글꼴 모양은 원본과 다를 수 있으니 중요한 도면은 CAD에서 출력한 PDF를 표시용으로 쓰는 것을 권장합니다.
- 실시간 감시: 클라우드(Render)에 올린 서버는 현장 내부망(사설 IP) 장비에 직접 접속할 수 없습니다. 내부망 장비는 현장 서버 설치 또는 외부 시스템 수신 방식을 쓰세요. ICMP ping 대신 TCP/HTTP 로 확인합니다.
- OTDR 체크섬은 일부 측정기가 다른 방식으로 계산해 '불일치'로 나올 수 있습니다(값은 참고용 경고).
- 사진 자동 축소 없음, 비밀번호 재설정은 관리자만, 2단계 인증 없음. HTTPS는 앞단(클라우드·Nginx)에서 처리.
- Render 무료 플랜: 재시작·재배포 시 데이터가 초기화되고 15분 미사용 시 잠듭니다(`SEED_DEMO=true` 이면 시작할 때 시연 데이터 재생성). 실제 운영은 유료 플랜 + 영구 디스크(DATA_DIR) 필요.
