# CCTV 라이선스 관리 (판매자 전용)

㈜에스에스전력이 **CCTV 공사 설계**, **CCTV 설치 제안서** 프로그램 고객에게 제품별 연간 구독 라이선스를 발급·연장·중지하고, 고객·계약·과금·상담을 관리하는 사이트입니다. 이음ERP 라이선스 관리자(sspower `license-portal`)를 바탕으로 만들었습니다.
**고객에게 배포하지 않습니다.**

## 기능
- 고객(회사) 등록 — 사업자등록번호 검증, 판매 방식(호스팅형/설치형), 설치 코드(`CC-XXXX-XXXX-XXXX`) 자동 생성
- 제품별 라이선스 발급: 신규(1년) · 연장 · 사용자 수 변경 · 사용 중지 · 중지 해제
- 발급 대장(CSV), 만료 30일 이내 고객, 제품별 사용 현황
- 고객관리: 영업 단계, 이용 계약서·전자서명, 청구 일정·입금, 상담·지원, 요금제
- 고객 프로그램 자동 갱신 API `POST /api/v1/check` — `{ code, bizRegNos, product: 'design'|'proposal', activeUsers, appVersion, serverUrl }`

## 환경변수
| 이름 | 내용 |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `LICENSE_PRIVATE_KEY` | 판매자 서명 비밀키 (Ed25519 PEM 을 base64 로 인코딩). **유출 금지** |
| `ADMIN_PASSWORD` | 처음 관리자 비밀번호 (12자 이상). 화면 **설정 > 관리자 비밀번호 변경**에서 바꾸면 이후로는 바뀐 비밀번호만 쓰임 |
| `SESSION_SECRET` | 로그인 쿠키 서명용 무작위 문자열 |
| `NODE_ENV` | `production` |

비밀키에 대응하는 공개키는 두 프로그램의 `server/license.js` 에 있는 `VENDOR_PUBLIC_KEY` 와 같아야 합니다.

## 시험
```
TEST_DATABASE_URL=postgresql://... npm test
```
