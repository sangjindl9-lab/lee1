# 데브볼트 (DevVault)

소프트웨어·소스코드·맞춤 개발·지식재산권을 **계약 조건과 함께** 거래하는 B2B 소프트웨어 마켓 플랫폼입니다.

- 서비스명은 `src/lib/brand.ts` **한 곳**에서 관리됩니다. (`데브볼트 / DevVault`)
- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + PostgreSQL 18 + Prisma 6
- 결제·대금보호·납품·검수·분쟁·환불·정산 **7개 상태를 분리**하고, 각 단계의 실제 근거를 화면에 표시합니다.
- 결제는 **테스트 PG(샌드박스)** 로 동작합니다. 실제 카드 승인·송금은 발생하지 않습니다.

---

## 1. 빠른 실행

```bash
# 1) 의존성
npm install

# 2) 환경변수
cp .env.example .env
#  DATABASE_URL, APP_SECRET, VAULT_MASTER_KEY 를 환경에 맞게 수정

# 3) DB 준비 (PostgreSQL 16 이상)
createdb devvault
createdb devvault_test

# 4) 스키마 적용 + 데모 데이터
npx prisma migrate deploy
npm run db:seed

# 5) 개발 서버
npm run dev        # http://localhost:3000
```

프로덕션 빌드:

```bash
npm run build && npm run start
```

## 2. 데모 계정

| 역할 | 이메일 | 비밀번호 |
| --- | --- | --- |
| 구매자(기업 구매 담당) | `buyer@devvault.kr` | `devvault1234` |
| 판매자(사업자) | `seller@devvault.kr` | `devvault1234` |
| 판매자(개인) | `seller2@devvault.kr` | `devvault1234` |
| 심사·고객지원 운영자 | `reviewer@devvault.kr` | `devvault1234` |
| 정산 운영자 | `settlement@devvault.kr` | `devvault1234` |
| 최고관리자 | `admin@devvault.kr` | `devvault1234` |

시드에는 판매 중 상품 4건, 결제·납품·검수 진행 중인 데모 거래 1건, 지식재산권 자산 1건이 포함됩니다.

## 3. 테스트

```bash
# 테스트 전용 DB 를 사용한다 (.env 의 TEST_DATABASE_URL)
npm test

# 타입 검사 / 빌드
npm run typecheck
npm run build
```

`npm test` 는 테스트 DB에 `prisma migrate deploy` 를 자동 적용한 뒤 실행합니다.
현재 **20개 테스트 전체 통과** (원문 필수 테스트 14개 + 청약철회 동의 + 추가 5개).

| # | 테스트 | 파일 |
| --- | --- | --- |
| 1 | 결제하지 않은 사용자의 파일 접근 차단 | `tests/01-access.test.ts` |
| 2 | 타인 주문과 정산 정보 접근 차단 | `tests/01-access.test.ts` |
| 3 | 결제 완료 후 파일 전달 실패 시 복구 | `tests/01-access.test.ts` |
| 4 | 빈 파일 및 누락 파일 납품 처리 | `tests/01-access.test.ts` |
| 5 | 계약과 다른 파일로 몰래 교체 시도 | `tests/01-access.test.ts` |
| 6 | 판매자 탈퇴 후 기존 구매 접근 | `tests/01-access.test.ts` |
| 7 | 미납품 상태의 검수·정산 차단 | `tests/01-access.test.ts` |
| 8 | 분쟁 중 지급 시도 | `tests/02-settlement.test.ts` |
| 9 | 환불과 정산의 동시 실행 | `tests/02-settlement.test.ts` |
| 10 | 중복·지연·역순 웹훅 | `tests/02-settlement.test.ts` |
| 11 | 외부 지급 요청 타임아웃 | `tests/02-settlement.test.ts` |
| 12 | 부분 환불 미지원 결제수단 처리 | `tests/02-settlement.test.ts` |
| 13 | 검수 기한과 외부 자동확정 일정 충돌 | `tests/03-policy.test.ts` |
| 14 | 환불 뒤 이미 다운로드한 파일의 처리 한계 표시 | `tests/02-settlement.test.ts` |
| 15 | 디지털 콘텐츠 청약철회 제한 사전 동의 로그 | `tests/03-policy.test.ts` |
| + | 기정산 거래의 사후 환수 분리 | `tests/03-policy.test.ts` |
| + | 분쟁 판단 AI 단독 불가 | `tests/03-policy.test.ts` |
| + | 대사(Reconciliation) 불일치 탐지 | `tests/03-policy.test.ts` |

## 4. 구현 범위

### 메뉴·회원
- 솔루션 마켓 / 소스코드 마켓 / 맞춤 개발 의뢰 / 지식재산권 거래 / 전문가 찾기 / 안전거래 안내 / 고객지원
- 구매 관리·판매 관리·견적·의뢰 관리·거래별 작업실·계약·검수·메시지·정산·신고·분쟁
- 회원은 구매자·판매자 역할 동시 보유, 기업 계정은 관리자·구매 담당자·검수 담당자 권한 분리
- 운영자 권한: 심사 / 고객지원 / 정산 / 최고관리자 (`src/server/services/rbac.ts`)

### 4대 거래 유형
- **완성형 사용권**: PC/웹/모바일, 기간제·영구, 사용자 수 조건
- **소스코드 구매**: 전체/모듈, 수정·상업적 이용·재배포 범위, 제3자 라이선스·외부 비용 고지
- **맞춤 개발**: 의뢰 → 견적(단계별 금액·산출물) → 계약 초안 → 양측 서명 → 단계별 별도 주문 결제 → 검수 → 변경 계약
- **지식재산권**: 양도·독점/비독점 허락, 비공개 자료실(NDA), 독점 잠금, 권리 이전 절차 분리

### 안전거래 3요소
1. **결제대금 보호** — PG 상태를 그대로 표시. 테스트 PG는 `모의 보류`로 표시하며 실제 보호로 표현하지 않음
2. **납품물 보관** — AES-256-GCM 암호화 비공개 볼트, 주문 시점 스냅샷 고정, 만료 서명 URL
3. **검수 후 정산** — 결제·납품·검수·분쟁·환불·잔액 확인 후 지급, 중복 지급 차단

### 보안·파일
- SHA-256 해시(동일성 확인용으로 명시), 비밀키·개인정보 패턴 탐지(AWS/Google/Slack/GitHub 키, PEM 개인키, 주민번호, 카드번호)
- ZIP 중앙 디렉터리 직접 검사: 압축 폭탄(비율·총량·항목 수), 경로 탈출, 절대 경로, 심볼릭 링크, 암호화 항목
- 업로드 50MB 제한, 파일별 검사 상태(대기/검사 중/통과/문제 발견/검사 불가)
- 관리자 접근·다운로드·계좌 변경·심사·판단·지급 이력은 감사 로그로 기록

### 수수료·세금·정산
- 정책 우선순위: 판매자별 > 카테고리별 > 기본, 프로모션 할인 기간
- **주문 시점 정책 스냅샷 고정** (이후 정책 변경이 기존 주문에 영향 없음)
- 사업자: 세금계산서 발행 전제 / 개인: 3.3% 원천징수
- 원장(ledger) 기반 잔액 계산 + `idempotencyKey` 유니크 + 주문 행 `FOR UPDATE` 잠금으로 이중 지급·환불 경쟁 방어

### 상태·대사
- 7개 상태 분리(결제/대금보호/납품/검수/분쟁/환불/정산) + `rowVersion` 낙관적 잠금
- MockPG 외부 원장 테이블(`MockPgTx`)과 내부 상태를 비교하는 대사 실행 및 불일치 목록

## 5. 미구현·미지원 (정확히 표시)

- **실결제/PG 연동 없음**: `MockPgProvider` 만 구현. `src/server/payments/provider.ts` 인터페이스 교체로 실제 연동
- **실제 대금 보호 없음**: 테스트 PG의 모의 보류 상태이며, 에스크로 전문 계약이 아님
- **악성코드 검사 없음**: 패턴 기반 사전 점검만 수행(바이러스 스캔·샌드박스 실행 미포함)
- **원격 삭제 없음**: 환불 후에도 이미 받은 소스는 회수 불가(정책대로 화면에 표시)
- **본인인증·계좌 실명확인 없음**: 판매자 정산계좌는 입력·암호화 보관만 수행(외부 인증 미연동)
- **메일·SMS·푸시 발송 없음**: 알림은 인앱 알림 테이블에 기록
- **오브젝트 스토리지 미연동**: 로컬 암호화 볼트 사용(`VAULT_DIR`). 운영에서는 S3/R2 어댑터로 교체 필요
- **AI 기능**: 분쟁 참고 의견 생성 함수만 제공(외부 AI 전송 없음, 최종 판단 불가)
- **유지보수 계약·업데이트 알림 자동화**: 필드·알림 기록만 있고 정기 과금은 없음
- **법률 문서**: 약관·개인정보처리방침·계약서 모두 "법률 검토 전 초안" 표기

## 6. 프로젝트 구조

```
src/
  lib/
    brand.ts            서비스명·정책 버전·문구 (브랜드 변경은 이 파일만)
    money.ts            원화 정수 금액, 수수료·원천징수 계산, 검수기간 검증
    crypto.ts           SHA-256, HMAC 서명, AES-256-GCM, scrypt 비밀번호
    db.ts, errors.ts, ids.ts, session.ts
  server/
    security/           zip.ts(압축 폭탄·경로 탈출), scan.ts(비밀키·개인정보 탐지)
    storage/vault.ts    비공개 암호화 저장소
    payments/           provider.ts(인터페이스), mockpg.ts, webhooks.ts
    services/           orders, checkout, delivery, downloads, inspection, dispute,
                        refund, payout, ledger, reconciliation, catalog, custom-dev,
                        ip, auth, rbac, access, fee-policy, audit
  app/                  화면(App Router) + 서버 액션 + API 라우트
prisma/
  schema.prisma         40+ 모델, 7개 상태 enum
  migrations/           SQL 마이그레이션
  seed.ts               데모 데이터
tests/                  자동화 테스트 20개
docs/                   배포·운영·실결제/법무 체크리스트·아키텍처
```

## 7. 브랜드 변경 방법

`src/lib/brand.ts` 의 `nameKo`, `nameEn` 만 수정하면 헤더·푸터·타이틀·메타데이터·약관·문서·테스트가 모두
함께 바뀝니다. (현재 값: `데브볼트` / `DevVault`)
