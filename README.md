# SS-ERP

전기·정보통신·건축공사 전문 통합 회계 ERP — 회사별 설치형

현재 버전: **전체 5단계 완료**

| 단계 | 기능 |
|---|---|
| 1 | 로그인·2단계 인증·역할 권한·회사·현장·거래처·대시보드·첨부파일·감사로그·라이선스·엑셀 출력·Docker 배포 |
| 2-A | 자재마스터·발주서·**대표이사 결재**·발주서 PDF·납품검수(부분납품) |
| 2-B | 복식부기 전표·자동 분개·지급결의(결재 후 지급)·실행예산·현장 손익·원장/재무제표·월마감·구매요청·계좌 |
| 3 | 세금계산서 수집(홈택스 엑셀·CODEF)·검수 대사·매출 발행(테스트/운영 구분)·문서 스캔(OCR/AI)·외부 연동 설정 |
| 4 | 변경계약·기성청구(PDF)·수금/미수금·하도급·노무비·준공정산 |
| 5 | 통장·카드 거래 대사·자금일보·자금수지·보고서 10종(PDF A4/A3·엑셀)·API 키·웹훅·백업·나라장터 |

| 문서 | 내용 |
|---|---|
| [docs/01_시스템설계서.md](docs/01_시스템설계서.md) | 업무분석, 메뉴, DB 관계, 보안, UI/UX 디자인 시스템, 단계별 계획 |
| [docs/02_관리자매뉴얼.md](docs/02_관리자매뉴얼.md) | 설치, 사용자·권한, 백업·복구, 라이선스, 보안 운영 |
| [docs/03_사용자매뉴얼.md](docs/03_사용자매뉴얼.md) | 화면 사용법 |
| [docs/04_외부연동_준비목록.md](docs/04_외부연동_준비목록.md) | 외부 API 계약·인증 준비물, 업체별 준비 상태 |
| [docs/05_1단계_완료보고.md](docs/05_1단계_완료보고.md) | 1단계 완료 기능, 테스트 결과, 미구현 기능 구분 |
| [docs/06_2단계-A_발주결재_완료보고.md](docs/06_2단계-A_발주결재_완료보고.md) | 자재·발주·대표이사 결재·검수 완료 보고 |
| [docs/07_2B-5단계_완료보고.md](docs/07_2B-5단계_완료보고.md) | 회계·세금계산서·공사관리·자금/외부연동 완료 보고, 테스트 결과, **검증하지 않은 외부 연동** |
| [docs/08_API_연동가이드.md](docs/08_API_연동가이드.md) | API 키·Idempotency-Key·웹훅 서명 확인 (외부 프로그램 개발자용) |
| [docs/screens/](docs/screens/) | 화면 캡처, 발주서 PDF 샘플(승인본·결재 전) |

---

## 구성

```
apps/api     NestJS 12 · Drizzle ORM · PostgreSQL 16   업무 규칙·권한·계산·감사로그 (모든 검증은 여기서)
apps/web     Next.js 16 · React 19 · Tailwind CSS 4    화면
deploy/      docker-compose · Caddy(HTTPS 자동) · 백업 스크립트
tools/license 라이선스 발급기 — 판매자 전용, 고객 배포본에서 제외
```

## 운영 설치 (Docker)

필요: Linux 서버 1대 (2코어·4GB 이상 권장), Docker 24+, 도메인(HTTPS용) 또는 사내 IP

```bash
cd deploy
cp .env.example .env
# .env 열어서 값 채우기 — 특히 아래 둘은 반드시 새로 생성
#   DB_PASSWORD        → openssl rand -base64 32
#   APP_ENCRYPTION_KEY → openssl rand -hex 32   (분실 시 암호화된 계좌번호 복구 불가 — 따로 보관)
docker compose up -d --build
docker compose logs -f api      # "API 서버 시작" 이 보이면 완료
```

`https://<ERP_DOMAIN>` 에 접속해 `.env` 의 `INIT_ADMIN_ID` / `INIT_ADMIN_PASSWORD` 로 로그인합니다. 첫 로그인 때 비밀번호를 바꾸도록 안내됩니다.

## 개발 환경

필요: Node.js 22, PostgreSQL 16

```bash
npm install
cd apps/api
cp .env.example .env               # DATABASE_URL 등 설정
npm run db:migrate                 # 테이블 생성
SEED_DEMO=true npm run db:seed     # 시연용 샘플 (회사 2곳, 현장 7곳, 거래처 5곳, 자재 20종, 역할별 사용자)
npm run build && npm start         # API  http://localhost:4000/api/v1  (문서 /api/docs)
node scripts/demo-purchase.mjs     # (선택) 시연 데이터 — 아래 4개를 차례로
node scripts/demo-tax.mjs          #   세금계산서·문서 스캔
node scripts/demo-construction.mjs #   변경계약·기성·수금·하도급·노무
node scripts/demo-finance.mjs      #   통장 거래 대사·나라장터 샘플

cd ../web
npm run dev                        # 화면 http://localhost:3000
```

샘플 계정 (비밀번호 `Demo!2026erp`)

| 아이디 | 역할 | 확인할 수 있는 것 |
|---|---|---|
| admin | 시스템관리자 | 전체 기능 + 백업·API 키·웹훅 (두 회사 모두 볼 수 있음) |
| ceo | 대표이사 (이상진) | 조회 + **결재** (발주서·지급결의·기성·변경계약·하도급) |
| acct | 회계관리자 | 전표·지급결의·세금계산서·거래내역 대사·자금일보·보고서 |
| buyer | 구매담당자 | 자재·거래처·발주서 작성·상신·검수 |
| site1 | 현장소장 | **배정된 2개 현장만** 보임, 그 현장 발주·검수 |
| tax | 외부 세무담당자 | 회계·세금계산서 열람만, 현장 메뉴 접근 불가 |
| hn.admin | 다른 회사(한누리통신) 관리자 | 에스에스전력 자료가 전혀 안 보임 |

## 테스트

```bash
cd apps/api
npm test      # 실제 PostgreSQL(erp_test DB)로 170개 항목 실행 (지시서 필수 테스트 15종 포함)
```

테스트는 `erp_test` 데이터베이스를 매번 지우고 다시 만듭니다. 운영 DB 주소를 `TEST_DATABASE_URL` 에 넣지 마세요.

## 라이선스 발급 (판매자)

```bash
node tools/license/issue-license.js --licensee "㈜고객사" --bizno 1234567890 --users 20 --expires 2027-12-31
```

출력된 문자열을 고객 관리자에게 전달하면 **관리 > 라이선스** 화면에서 등록합니다. `tools/license/keys/vendor-private.pem` 은 절대 외부에 유출하지 마세요 — 유출되면 누구나 라이선스를 만들 수 있습니다. 고객에게 소스를 줄 때는 `tools/license` 폴더를 빼고 전달하세요.
