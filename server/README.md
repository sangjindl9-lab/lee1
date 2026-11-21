# 노트프로 서버

TypeScript(Fastify) + PostgreSQL. 계정·동기화·파일·클라우드 백업·AI 게이트웨이·문서 변환·구독 권한·관리자.

## 환경변수
| 이름 | 필수 | 설명 |
|---|---|---|
| DATABASE_URL | ✔ | PostgreSQL 연결 문자열 |
| JWT_SECRET | ✔ | 32자 이상 임의 문자열 |
| STORAGE_DIR | | 파일 저장 위치(볼륨). 기본 ./storage |
| PUBLIC_URL | | 인증 메일 링크용 주소 |
| SMTP_URL, MAIL_FROM | | 메일 발송(없으면 인증 메일 미발송으로 표시) |
| ANTHROPIC_API_KEY 또는 OPENAI_API_KEY | | AI 기능(없으면 503 ai_not_configured) |
| AI_PROVIDER | | anthropic / openai / mock(테스트) |
| GOOGLE_CLIENT_IDS, APPLE_CLIENT_IDS | | 소셜 로그인 클라이언트 ID(쉼표 구분) |
| ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD | | 첫 관리자 계정(12자 이상) |
| BILLING_VERIFY | | off = 개발용(영수증 검증 없이 구독 기록). 운영에서는 설정하지 말 것 |

## 실행
```bash
npm ci && npm run build && npm start      # 시작 시 마이그레이션 자동 적용
npm run rollback                           # 최신 마이그레이션 1개 롤백(백업 후)
TEST_DATABASE_URL=postgres://... npm test  # 실제 PostgreSQL로 통합 테스트
```
관리자 화면: `https://<서버>/admin`
