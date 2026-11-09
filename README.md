# EUM SMART VMS PRO (이음 스마트 통합관제)

공공기관 CCTV 함체용 스마트박스(SB-MB01) 원격관제와 기존 VMS 연동, 유지보수 업무까지 묶는 통합관제 소프트웨어입니다.
현재 버전 0.1.0은 개발 지시서 16장의 **1단계(작동하는 스마트박스 관제)** 입니다.

- 기능별 상태: [docs/status.md](docs/status.md)
- 검증 시나리오 실행 결과: [docs/test-results.md](docs/test-results.md)
- 장치 통신 프로토콜: [docs/protocol.md](docs/protocol.md)
- 서버 API 명세: [docs/api.md](docs/api.md)
- 설치 매뉴얼: [docs/install.md](docs/install.md)

## 구성

```
server/      관제서버 (NestJS + PostgreSQL + MQTT), DB 마이그레이션, 내장 브로커·인증서 도구
web/         웹 관제화면 (React + TypeScript)
firmware/    SB-MB01 ESP32 펌웨어 (PlatformIO)
device-sim/  장치 시뮬레이터 (시험 전용, 실제 프로토콜 사용)
tests/       검증 시나리오 (지시서 17장)
deploy/      Docker Compose, Mosquitto 설정, 백업·복원, 오프라인 설치 묶음
docs/        명세·상태·시험 결과·매뉴얼
```

## 개발 환경에서 실행

```bash
# PostgreSQL 16 이 localhost:5432 에 있고 eum DB가 있다고 가정
cd server && npm ci && npx tsc -p .
DATA_DIR=./data node dist/tools/broker.js &                     # 내장 MQTT 브로커 (mTLS, 8883)
DATA_DIR=./data BOOTSTRAP_ADMIN_USER=admin BOOTSTRAP_ADMIN_PASSWORD='관리자비밀번호' node dist/main.js
cd ../web && npm ci && npm run build                            # 서버가 web/dist 를 함께 제공
# 브라우저: http://localhost:3000  (관리자는 첫 로그인 후 OTP 설정)
```

검증 시나리오: `cd tests && npm ci && MANAGE_SERVER=1 node e2e.js` (서버를 직접 띄우고 재시작까지 시험)
