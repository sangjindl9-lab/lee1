# 실행·배포 가이드

## 1. 요구 사항

| 항목 | 버전 | 비고 |
| --- | --- | --- |
| Node.js | 20 LTS 이상 (검증: 24.22.3) | |
| PostgreSQL | 14 이상 (검증: 18.6) | `uuid`, `pgcrypto` 확장 불필요 |
| 디스크 | 납품 파일 크기 × 버전 수 | 기본 업로드 1건 50MB 제한 |
| 메모리 | 1GB 이상 | 빌드 시 512MB 이상 |

## 2. 로컬 실행

```bash
npm install
cp .env.example .env       # DATABASE_URL, APP_SECRET, VAULT_MASTER_KEY 수정
createdb devvault && createdb devvault_test
npx prisma migrate deploy
npm run db:seed            # 데모 계정·상품·거래
npm run dev
```

## 3. 테스트

```bash
npm test          # TEST_DATABASE_URL 로 마이그레이션 후 20개 테스트 실행
npm run typecheck
npm run build
```

테스트는 `tests/global-setup.ts` 에서 `prisma migrate deploy` 를 실행하고, 각 테스트 전에
`TRUNCATE ... RESTART IDENTITY CASCADE` 로 데이터를 초기화합니다. **개발 DB가 아닌 테스트 DB만 사용합니다.**

## 4. 프로덕션 빌드

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start        # 기본 3000 포트
```

### 리버스 프록시 (Nginx 예시)

```nginx
server {
  listen 443 ssl http2;
  server_name devvault.kr;

  client_max_body_size 60m;   # 업로드 50MB + 여유

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # 감사 로그 IP
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }
}
```

> `X-Forwarded-For` 를 반드시 전달하세요. 청약철회 동의·다운로드 기록에 IP가 저장됩니다.

### Docker (예시)

```dockerfile
FROM node:24-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

`VAULT_DIR` 는 **영속 볼륨**으로 마운트해야 합니다. 컨테이너 재생성 시 볼륨이 사라지면 기존 주문의 납품물을
받을 수 없습니다.

## 5. 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | O | PostgreSQL 접속 문자열 |
| `TEST_DATABASE_URL` | 테스트 시 | 테스트 전용 DB |
| `APP_SECRET` | O | 세션 쿠키·웹훅 서명 HMAC 키 |
| `VAULT_MASTER_KEY` | O | 납품 파일 암호화 키(변경 시 기존 파일 복호화 불가) |
| `VAULT_DIR` | O | 비공개 파일 보관 경로 |
| `MOCKPG_WEBHOOK_SECRET` | O | 테스트 PG 웹훅 서명 검증 키 |
| `PG_PROVIDER` | - | 현재 `mockpg` |

`VAULT_MASTER_KEY` 를 잃으면 기존 납품물을 복호화할 수 없습니다. KMS/Secrets Manager 에 백업하세요.

## 6. 백업·복구

- **DB**: 일 1회 `pg_dump -Fc devvault` + WAL 아카이빙 권장
- **볼트**: `VAULT_DIR` 증분 백업(파일은 암호화되어 있어 키 없이는 내용 확인 불가)
- 복구 순서: DB 복구 → 볼트 복구 → `npm run start` → 주문 상세에서 파일 해시 일치 확인
- 해시가 주문 스냅샷과 다르면 다운로드가 자동 차단됩니다(파일 교체·손상 감지).

## 7. 배포 전 점검 체크리스트

- [ ] `APP_SECRET`, `VAULT_MASTER_KEY`, `MOCKPG_WEBHOOK_SECRET` 을 임의 난수로 교체
- [ ] `.env` 가 저장소에 커밋되지 않았는지 확인 (`.gitignore` 포함)
- [ ] DB 사용자 권한 최소화(DDL은 마이그레이션 계정만)
- [ ] HTTPS 적용, `secure` 쿠키 동작 확인 (`NODE_ENV=production`)
- [ ] 업로드 경로가 웹 루트 밖인지 확인 (`VAULT_DIR`)
- [ ] 백업·복구 리허설 1회
- [ ] 실제 PG 도입 여부 결정 → 미도입 시 화면에 "테스트 결제" 표기 유지
- [ ] 약관·개인정보처리방침 법률 검토 (`docs/REAL-PG-LEGAL-CHECKLIST.md`)

## 8. 실제 PG 로 교체하는 방법

1. `src/server/payments/provider.ts` 의 `PgProvider` 인터페이스 구현체를 새로 만든다.
   (예: `src/server/payments/toss.ts`)
2. `getProvider()` 의 반환값을 교체한다.
3. 웹훅 라우트(`src/app/api/webhooks/`)에 사업자별 서명 검증 규격을 적용한다.
4. `METHOD_AUTO_CONFIRM_DAYS` 를 사업자 정책 값으로 교체한다.
5. 대사(`runReconciliation`)가 사업자 조회 API를 사용하도록 `getPayment`/`getPayout` 을 구현한다.
6. 결제수단별 부분 환불 지원 여부(`refundSupport`)를 실제 계약 내용으로 채운다.

**서비스 로직은 그대로 재사용**됩니다. 상태 전이·원장·잠금·검수 흐름은 PG와 무관하게 동작합니다.
