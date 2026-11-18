# 이음마켓 EUM MARKET

소프트웨어·소스코드를 판매하고, 맞춤 개발을 의뢰하며, 지식재산권을 거래하는 플랫폼. 거래마다 돈과 납품물의 상태를 7개 항목으로 나눠 추적한다.

**지금은 테스트 결제 시뮬레이터만 연결되어 있다. 실제 결제, 결제대금 보호, 판매자 지급은 이루어지지 않는다.** 실결제 전에 필요한 일은 `docs/06` 에 있다.

## 실행

Node.js 22.18 이상.

```bash
npm install
cp .env.example .env      # 값 채우기. 개발에서는 비워 둬도 실행된다
npm run build
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='10자 이상' npm start
```

- `DATABASE_URL` 을 비우면 내장 Postgres(PGlite)가 `DATA_DIR` 아래에 만들어진다. 운영에서는 PostgreSQL 서버를 쓴다.
- 처음 실행할 때 DB 마이그레이션, 최고관리자 계정, 기본 수수료 정책(10%, 운영 전 조정)이 만들어진다.
- 운영(`NODE_ENV=production`)에서는 `SESSION_SECRET`, `FILE_MASTER_KEY`, `SIMPG_WEBHOOK_SECRET` 이 없으면 시작하지 않는다.

### 처음 한 바퀴 돌려 보기

1. 회원가입 → 판매 관리에서 판매자 등록, 정산 계좌 등록
2. 최고관리자로 로그인 → 운영 → 판매자 승인, 계좌 확인 완료
3. 판매자: 상품 등록 → 버전 만들기 → 납품 파일 올리기 → 심사에 제출
4. 운영: 상품 승인
5. 다른 계정으로 구매 → 테스트 결제창에서 결제 승인 → 거래 작업실에서 내려받기, 구매확정
6. 운영 → 거래 → 주문 → 판매자 지급 요청 → 테스트: 은행 이체 완료 시뮬레이션 → 대사 실행

## 배포 (Railway 등)

- 빌드 `npm run build`, 시작 `npm start`
- PostgreSQL 을 추가하고 `DATABASE_URL` 연결
- 영구 볼륨을 만들어 `DATA_DIR` 로 지정(납품 파일이 여기에 저장된다). 볼륨이 없으면 재배포 때 파일이 사라진다
- `.env.example` 의 비밀값 설정

## 구성

| 위치 | 내용 |
| --- | --- |
| `prisma/migrations/` | DB 스키마(SQL, 기준). CHECK 제약과 불변성 트리거 포함 |
| `prisma/schema.prisma` | 같은 구조의 Prisma 표기(참조용, SQL에서 생성) |
| `src/domain/states.ts` | 7대 상태 전이 규칙 |
| `src/domain/ledger.ts` | 수수료·세무·원장 계산 |
| `src/server/` | 인증, 상품·파일, 보관소·검사, 주문·결제·분쟁·환불·정산·대사, 맞춤 개발, 지식재산권, 기업 계정 |
| `src/server/providers/sim.ts` | 테스트 결제 시뮬레이터(결제 사업자 어댑터 인터페이스) |
| `src/app/` | 화면(Next.js App Router)과 서버 액션 |
| `test/` | 테스트 56건 |
| `docs/` | 설계, 상태 규칙, 금액·세무, 운영 매뉴얼, 연동 현황·미구현, 출시 전 검토, 테스트 결과 |

## 검증

```bash
npm test            # 상태 규칙 16, 원장 8, DB 제약 12, 통합 20
npm run validate    # schema.prisma 검증, SQL과 일치 확인
```

통합 테스트는 내장 Postgres, 실제 파일 보관소, 테스트 결제 시뮬레이터로 등록부터 정산까지 실행한다. 별도 DB 설치가 필요 없다.

## 기술 스택

Next.js 16(App Router) · TypeScript · PostgreSQL(SQL 직접 실행) · 로컬 암호화 보관소 · 결제 사업자 어댑터. Prisma ORM과 S3 저장소는 적용하지 못했다(이유는 `docs/05`).
