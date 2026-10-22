# 머묾 (Meomul) — 숙소 공유·예약 플랫폼

에어비앤비형 숙소 공유 서비스. 게스트(검색·예약·메시지·후기), 호스트(숙소 등록·사진·달력·예약 승인·정산 현황), 관리자(숙소 심사·회원·예약·활동 기록)를 갖춘 상업용 1차 버전.

- 서버: Node.js 20+ / Express / PostgreSQL
- 화면: React 18 + Vite (빌드 결과를 서버가 그대로 제공)
- 배포: Render (`render.yaml`)

## 보안 설계
| 항목 | 적용 내용 |
|---|---|
| 로그인 | 카카오·네이버·구글 OAuth (state 검증, 구글·카카오 PKCE). 비밀번호를 저장하지 않음 |
| 세션 | 256비트 난수 토큰을 HttpOnly·Secure·SameSite=Lax 쿠키(`__Host-` 접두사)로 발급, DB에는 SHA-256 해시만 저장, 14일 만료 |
| CSRF | 상태 변경 요청은 Origin 일치 + 세션별 CSRF 토큰 헤더 필수 |
| 권한 | 게스트/호스트/관리자 역할을 서버에서 매 요청 검사. 남의 예약·숙소는 404로 숨김 |
| 이중 예약 | PostgreSQL 배타 제약(EXCLUDE USING gist)으로 동시 요청에도 같은 날짜 중복 예약 불가 |
| 요금 | 모든 금액은 서버에서 계산. 화면에서 보낸 금액은 무시 |
| 개인정보 | 상세 주소·연락처는 예약 확정 후 당사자에게만 공개. 탈퇴 시 즉시 익명화 |
| 사진 | 디코딩 검증 후 WebP로 재인코딩 → 위장 파일 차단, EXIF(GPS) 제거. 승인 전 사진은 본인·관리자만 열람 |
| 입력 | zod로 모든 입력 검증, SQL은 전부 매개변수 바인딩 |
| 헤더 | Helmet CSP(외부 스크립트 금지), HSTS, frame-ancestors none, nosniff, Permissions-Policy |
| 요청 제한 | 전체 API·로그인·예약·사진 업로드에 IP별 횟수 제한 |
| 감사 로그 | 로그인, 예약 상태 변경, 관리자 조치를 IP와 함께 기록 |
| 오류 | 내부 오류 내용·DB 코드를 사용자에게 노출하지 않음 |

`npm test` (서버 실행 중일 때)로 위 항목을 포함한 59개 통합 테스트를 돌릴 수 있다.

## 환경변수
| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소 |
| `SESSION_SECRET` | 32자 이상 난수 (필수) |
| `APP_URL` | 서비스 주소. 예 `https://meomul.onrender.com` (OAuth 콜백에 사용) |
| `ADMIN_EMAILS` | 관리자로 지정할 로그인 이메일 (쉼표 구분) |
| `KAKAO_REST_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 로그인 (Client Secret은 사용 설정 시) |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 로그인 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 로그인 |
| `DEMO_LOGIN` | `true`면 시연용 게스트·호스트·관리자 로그인 버튼 노출 — **운영 시작 전 반드시 삭제** |
| `SEED_DEMO` | `true`면 DB가 비었을 때 예시 숙소 12곳 생성 |
| `SERVICE_FEE_RATE`, `HOST_FEE_RATE` | 수수료율 (기본 0.10 / 0.03) |
| `BIZ_NAME`, `BIZ_CEO`, `BIZ_REG_NO`, `BIZ_SALES_NO`, `BIZ_ADDRESS`, `BIZ_PHONE`, `BIZ_EMAIL` | 푸터 사업자 정보 (전자상거래법 표시 의무) |

## 소셜 로그인 콜백 주소
각 개발자 센터에 아래 주소를 등록한다 (`APP_URL` 기준).
- 카카오: `{APP_URL}/auth/kakao/callback` — 카카오 로그인 활성화, 동의항목 닉네임·프로필 사진(·이메일)
- 네이버: `{APP_URL}/auth/naver/callback` — 이름·이메일·프로필 사진
- 구글: `{APP_URL}/auth/google/callback`

## 운영 전 체크리스트
- [ ] `DEMO_LOGIN`, `SEED_DEMO` 삭제 후 예시 숙소는 관리자 화면에서 게시 중지
- [ ] 소셜 로그인 키 3종 등록, `ADMIN_EMAILS` 지정
- [ ] 사업자 정보·통신판매업 신고번호 입력, 약관·개인정보처리방침 법률 검토
- [ ] Render 유료 플랜 전환 (무료 플랜은 잠들고, 무료 DB는 30일 후 만료됨) 및 DB 백업
- [ ] PG(결제) 연동: `bookings.payment_status` 컬럼과 예약 확정 흐름에 연결
- [ ] GitHub 저장소 비공개 전환

## 로컬 실행
```
npm install
npm run build
DATABASE_URL=postgres://... DEMO_LOGIN=true SEED_DEMO=true npm start
```
