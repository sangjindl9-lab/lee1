# 현장뷰 (SiteView)

Hik-Connect처럼 Hikvision NVR·DVR·IP카메라를 웹과 안드로이드 앱에서 보는 프로그램입니다.
Hikvision 클라우드(P2P)를 쓰지 않고, 장비의 **ISAPI(HTTP)와 RTSP에 직접 접속**합니다.

## 기능
- 장비 추가: IP·포트·계정 입력 → 모델·시리얼·채널 자동 조회, 같은 네트워크 장비 검색(SADP)
- 실시간: 1/4/9/16 분할, 고화질/자동 화질, 소리, 스냅샷, 전체화면, 더블클릭 크게 보기
- PTZ: 8방향·줌(누르고 있는 동안 이동), 속도, 프리셋 이동 (NVR은 PTZCtrlProxy 사용)
- 녹화 재생: 날짜별 녹화 검색, 24시간 타임라인(상시·모션·이벤트 색 구분), ±30초 이동
- 알람: 장비 alertStream 실시간 수신 → 사진 자동 저장, 알림 토스트·브라우저 알림, 녹화 바로 재생
- 장비 정보: 펌웨어·장비 시각·HDD 사용량, 채널 이름 변경, 재부팅

## 구조
- `server/` Node.js(Express) — ISAPI Digest 클라이언트, SQLite(node:sqlite), go2rtc로 RTSP→브라우저(MSE) 변환
- `public/` 웹 화면 (모바일·PC 겸용)
- `app/` 안드로이드 앱(Capacitor) — 서버 주소를 입력하면 같은 화면을 앱으로 표시
- `server/sim.js` 데모용 가상 NVR (`DEMO=1`)

## 설치 (현장 서버·미니PC)
```bash
docker compose up -d      # http://서버IP:8080, 첫 계정 admin / admin1234
```
서버가 카메라와 같은 네트워크에 있어야 합니다. 밖에서 볼 때는 공유기에서 서버 8080 포트만 포워딩하면 됩니다.

## 장비 쪽 설정
- 알람을 받으려면 장비의 각 이벤트(모션·선 넘기·영역 침입 등) 연동 방법에서 **감시센터 통보(Notify Surveillance Center)**를 켭니다.
- 장비 웹 계정(admin)이 ISAPI와 RTSP에 그대로 쓰입니다.

## 안드로이드 앱
`siteview` 브랜치에 push하면 GitHub Actions가 APK를 빌드해 릴리스 `siteview-latest`에 올립니다.
