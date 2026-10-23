# SS-ERP 라이선스 발급 관리 (판매자 전용)

㈜에스에스전력이 SS-ERP 고객에게 연간 구독 라이선스를 발급·연장·중지하고, 발급 대장과 만료 예정 고객을 관리하는 사이트입니다.
**고객에게 배포하지 않습니다.**

## 기능
- 고객(회사) 등록 — 사업자등록번호 검증, 판매 방식(호스팅형/설치형), 설치 코드 자동 생성
- 라이선스 발급: 신규(1년) · 연장(기존 만료일 다음 날부터 1년) · 사용자 수 변경 · 사용 중지 · 중지 해제
- 발급 대장 (CSV 내보내기), 만료 30일 이내 고객 목록, 연간 발급 금액
- 고객 ERP 자동 갱신 API `POST /api/v1/check` — 설치 코드 + 사업자번호가 맞으면 최신 라이선스를 내려줌
- **고객 등록·납품 한 번에**: 고객 정보 + 연간 라이선스 + (호스팅형) 고객 전용 서버 자동 개설 → 납품서(접속 주소·관리자 아이디·임시 비밀번호) 인쇄
  - 고객마다 Railway 프로젝트를 따로 만들어 데이터베이스까지 완전히 분리, 예시 데이터 없이 빈 ERP 로 시작
  - 진행 단계 표시, 실패하면 그 단계부터 다시 시도
- 관리자 로그인(비밀번호, 화면에서 변경), 활동 기록

## 환경변수
| 이름 | 내용 |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `LICENSE_PRIVATE_KEY` | 판매자 서명 비밀키 (Ed25519 PEM 을 base64 로 인코딩). **유출 금지** |
| `ADMIN_PASSWORD` | 처음 관리자 비밀번호 (12자 이상). 화면 **설정 > 관리자 비밀번호 변경**에서 바꾸면 이후로는 바뀐 비밀번호만 쓰임 |
| `SESSION_SECRET` | 로그인 쿠키 서명용 무작위 문자열 |
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | 이 사이트 주소 (고객 서버가 라이선스를 받으러 오는 곳). 기본 `https://ss-license-production.up.railway.app` |
| `RAILWAY_API_TOKEN` / `RAILWAY_WORKSPACE_ID` | (선택) 고객 서버 자동 개설용. 화면 **설정 > Railway 연결**에서 넣어도 됨 |
| `RAILWAY_REGION` | 고객 서버 위치. 기본 `asia-southeast1-eqsg3a` (싱가포르) |

비밀키에 대응하는 공개키는 SS-ERP `apps/api/src/license/license.service.ts` 의 `VENDOR_PUBLIC_KEY` 와 같아야 합니다.

## 시험
```
TEST_DATABASE_URL=postgresql://... npm test
```
