# 이음챗

동네 기반 채팅 앱 (React + Node WebSocket).

## 기능
- 토크: 한 줄 글 피드, 성별·지역 필터, 포인트로 30분 상단 고정
- 쪽지: 대화 신청 → 수락/거절 → 1:1 실시간 채팅, 읽음 표시, 메시지 삭제
- 그룹채팅: 주제별 방, 비밀방(비밀번호), 최대 인원, 방장 강퇴
- 라운지: 게시글, 좋아요, 댓글
- MY: 프로필, 포인트 충전·내역, 출석체크, 친구·차단 목록, 다크 모드, 탈퇴
- 신고(자동 차단), 차단, 만 19세 이상 확인

## 실행
```
npm install
npm run build     # 화면 빌드 (dist)
npm start         # http://localhost:3000
```
개발 중에는 `npm start` 와 `npm run dev` 를 함께 실행합니다.

## 배포 (Railway / Render)
- Build: `npm install && npm run build`
- Start: `npm start`
- 데이터는 `DATA_DIR`(기본 `./data`)의 `db.json` 에 저장됩니다. 재배포해도 유지하려면 볼륨을 연결하고 `DATA_DIR` 을 그 경로로 지정하세요.

## 체험판
`npm run build:demo` → `dist-demo/index.html` 한 파일. 서버 없이 가상 회원과 동작합니다.

## 구조
- `shared/core.js` 채팅 규칙 전체 (서버와 체험판이 공유)
- `server/index.js` 정적 파일 + `/ws`
- `src/` React 화면

## 포인트
- 적립: 가입 축하, 출석체크(3일·7일 연속 보너스), Google Play 결제, 관리자 지급
- 사용: 대화 신청(거절되면 환불), 토크 상단 고정
- 모든 증감은 포인트 내역에 남고, 회원은 MY > 포인트 내역에서 확인합니다.

## Google Play 결제 (자동 충전)
흐름: 앱에서 상품 선택 → Google Play 결제창 → 결제 토큰을 서버로 전송 → 서버가 Google(Android Publisher API)에 직접 확인 → 포인트 지급 → 소모 처리.
같은 결제 토큰은 한 번만 지급되고, 결제 후 앱이 꺼져도 충전 화면을 다시 열면 자동 복구됩니다.

Google Play 결제는 Play 스토어에서 설치한 안드로이드 앱 안에서만 동작합니다. 준비 순서:
1. 이 서버를 https 주소로 배포합니다.
2. Bubblewrap 으로 안드로이드 앱(TWA)을 만듭니다. `twa-manifest.json` 의 `features.playBilling.enabled` 를 `true` 로 켭니다.
3. Play Console 에 앱을 올리고 인앱 상품을 만듭니다. 상품 ID는 관리자 > 설정 > 충전 상품의 "Play 상품 ID"와 같게 합니다 (기본값 `point_100`, `point_500`, `point_1000`, `point_3000`).
4. Google Cloud 에서 서비스 계정을 만들고 Play Console > 사용자 및 권한에 초대해 재무 데이터·주문 관리 권한을 줍니다.
5. 서버 환경변수를 넣습니다.

| 환경변수 | 내용 |
|---|---|
| `ADMIN_PASSWORD` | 관리자 화면 비밀번호 (없으면 관리자 화면 잠김) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 서비스 계정 키 JSON 전체 |
| `ANDROID_PACKAGE` | 앱 패키지명 (예: `kr.eumsoft.chat`) |
| `ANDROID_SHA256` | 앱 서명 인증서 SHA-256 지문 (Play 앱 서명 키). `/.well-known/assetlinks.json` 으로 제공됩니다 |
| `DATA_DIR` | 데이터 저장 폴더 |

## 관리자
`https://주소/admin` 으로 접속해 `ADMIN_PASSWORD` 로 로그인합니다.
- 현황: 오늘·누적 매출, 회원, 접속자, 회원 보유 포인트 합계, 최근 포인트 변동
- 충전: 결제 내역, 환불 처리(지급 포인트 회수)
- 회원: 검색, 포인트 지급·차감(사유 기록), 이용 정지
- 신고: 처리 완료 표시, 대상 정지
- 콘텐츠: 토크·라운지 글·그룹방 삭제
- 설정: 포인트 규칙, 충전 상품, 공지, 금지어

## 아직 없는 것
로그인(휴대폰·소셜 인증), 사진 전송, 푸시 알림, Google 환불 자동 반영(지금은 관리자가 환불 처리), 실제 위치 기반 거리순.
지금은 기기에 저장된 토큰으로 사용자를 구분합니다. 유료 포인트를 팔기 전에 계정 인증과 DB(PostgreSQL 등) 전환이 필요합니다. 기기를 바꾸면 계정과 포인트를 되찾을 수 없기 때문입니다.
