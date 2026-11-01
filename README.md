# 이음사인 — 전자문서·전자서명

전기·통신공사 회사가 쓰는 독립형 전자계약 프로그램입니다. 한 개의 템플릿·문서 처리 엔진 위에서 네 가지 계약 방식을 지원합니다.

| 방식 | 문서 생성 | 참여자 확인 |
|---|---|---|
| ① 비대면계약 | 담당자가 작성 → 수신자별 개별 링크 | 서명 링크 / 이메일·휴대폰 인증번호 |
| ② 대면계약 | 담당자가 작성 → 기기 한 대로 차례 서명 | 담당자가 확인 방법 기록(신분증 대조 등) + 1회용 서명 세션 |
| ③ 링크계약 | 공통 URL·QR 접속자마다 별도 문서 | 휴대폰 인증번호 또는 인증 없음 |
| ④ 대량계약 | 엑셀 행마다 독립 문서(큐 처리) | 비대면과 같음 |

네 방식 모두 같은 `documents`·`participants` 데이터와 `src/engine.js` 를 씁니다. 별도 메뉴·별도 데이터로 중복 구현하지 않았습니다.

## 실행 방법

필요: **Node.js 22.5 이상** (내장 SQLite 사용, 별도 DB 서버 없음)

```bash
npm install
cp .env.example .env        # 값 수정
# 환경변수를 셸에 넣고 실행 (예)
DATA_DIR=./data ADMIN_EMAIL=admin@example.kr ADMIN_PASSWORD='바꿀비밀번호' COMPANY_NAME='㈜에스에스전력' npm start
# → http://localhost:3000
```

- 회사가 하나도 없으면 첫 실행 때 `ADMIN_*` 값으로 회사·관리자를 만들고, 업무 예시 서식 5종(회사 검토용)을 넣습니다.
- `DATA_DIR` 에 `ieumsign.db` 와 `files/` 가 생깁니다. **이 폴더가 백업 대상**입니다.
- 도커: `docker build -t ieumsign . && docker run -p 3000:3000 -v ieumsign-data:/data --env-file .env ieumsign`
- Railway·Render: 시작 명령 `node server.js`, 영구 볼륨을 `/data` 에 붙이고 `DATA_DIR=/data`, `BASE_URL` 을 실제 주소로.

## 시험

```bash
npm test     # 실제 HTTP 서버 + 임시 DB 로 12개 시나리오 실행 (약 10초)
```

## 데이터베이스 (SQLite, `src/db.js`)

| 묶음 | 표 |
|---|---|
| 회사·조직 | companies(브랜딩·설정), departments, groups_, group_members, users(역할·개별 권한·퇴사), sessions(대면 잠금 포함) |
| 서식 | templates(개인/회사 공용), template_versions(버전 고정), template_shares(부서·그룹·사용자) |
| 문서 | documents(방식·상태·버전·내용 해시), participants(역할·확인 방법·서명), doc_attachments, files(SHA-256 고정본) |
| 결재 | approval_lines, approval_rules(제한된 조건 규칙), approvals(차수·단계·승인 대상 해시) |
| 직인 | seals, seal_policies(사전날인), seal_usages(날인 기록 · 대표자 승인 여부 분리) |
| 링크·대량 | link_campaigns, link_starts, bulk_jobs, bulk_rows, jobs(작업 큐) |
| 분류·일정·의견 | folders, doc_folders, doc_tags, class_rules, schedules, schedule_history, comments, comment_revisions, comment_reads |
| 연동 | api_keys, idempotency, events, webhooks, webhook_deliveries |
| 기록 | audit_logs(회사별 해시 체인), outbox(메일·문자·앱 알림), inbox |

표는 서버 시작 때 자동으로 만들어집니다. 나중에 추가된 열은 `db.js` 아래쪽에서 `alter table` 로 붙입니다.

## 폴더

```
server.js            실행 파일
src/db.js            스키마·DB 도우미
src/core.js          권한 목록, 감사 해시 체인, 이벤트, 알림
src/engine.js        문서 처리 엔진 (생성·수정·재결재·발송·서명·완료·분류·일정)
src/pdf.js           완료 PDF (본문·서명·사진대장 2×2·도면·첨부 PDF 병합·처리 이력 확인서)
src/queue.js         작업 큐 (대량 발송, Webhook 재전송, 일정 알림, 기한 만료)
src/routes/staff.js  직원 API      routes/bulk.js 대량계약     routes/signer.js 외부 서명자
src/routes/linkpub.js 공개 링크 접수  routes/v1.js 외부 연동 API
public/              직원 화면(index.html·app.js), 서명 화면(sign.html), 링크 접수(link.html)
fonts/               PDF용 한글 글꼴 (Noto Sans KR, SIL OFL)
test/                시나리오 테스트와 시험용 그림
docs/                API 연동 가이드, 완료 보고
```
