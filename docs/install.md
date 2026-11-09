# 설치 매뉴얼 (내부망 단일 서버)

> Rev 0.1 — Docker Compose 구성은 작성만 되었고 실제 Docker 환경 설치 시험은 아직 하지 않았습니다. 첫 설치는 개발사 입회하에 진행하세요.

## 1. 서버 요구사항

- Linux x86_64 (Ubuntu 22.04/24.04, Rocky 9 등), Docker Engine 24 이상 + Compose v2
- CPU 4코어, 메모리 8GB, 디스크 200GB 이상 (스마트박스 500대·10초 주기 기준 계측 1년 보관 시 약 100GB 예상 — 현장 시험 후 확정)
- 열어야 하는 포트: 8883/TCP(스마트박스 → 브로커), 웹은 기관 승인된 리버스 프록시(HTTPS)를 통해서만 공개

## 2. 폐쇄망 반입

인터넷이 되는 PC에서 `deploy/make-offline-bundle.sh` 실행 → 생성된 `dist-offline/` 폴더를 승인 절차에 따라 반입.

```bash
sha256sum -c SHA256SUMS
docker load < eum-images-0.1.0.tar.gz
tar xzf eum-deploy-0.1.0.tgz && cd deploy
```

## 3. 설정과 최초 실행

```bash
cp .env.example .env && vi .env          # DB_PASSWORD, MASTER_KEY, JWT_SECRET, BROKER_HOSTS, MQTT_PUBLIC_HOST, 최초 관리자
openssl rand -hex 32                     # MASTER_KEY, JWT_SECRET 생성용
docker compose --profile init run --rm init   # 내부 CA·브로커 인증서 생성 (최초 1회)
docker compose up -d
docker compose logs -f server            # "브로커 연결됨" 확인
```

- `MASTER_KEY`를 잃어버리면 저장된 MFA 비밀값·장치 명령키를 복호화할 수 없습니다. 기관 보안 절차에 따라 별도 보관하세요.
- 최초 관리자로 로그인하면 OTP(Google Authenticator 등) 등록 화면이 나옵니다. 등록 후 `.env`의 `BOOTSTRAP_ADMIN_PASSWORD`를 지우세요.

## 4. 스마트박스 등록

1. 웹 → 현장·함체 관리 → 현장, 함체 등록
2. 함체에서 스마트박스 등록 → **프로비저닝 묶음(JSON)이 한 번만 표시**되니 바로 내려받기
3. 펌웨어의 `data/prov.json`으로 저장 후 `pio run -t uploadfs`로 장치에 기록 (firmware/README.md)
4. 장치 전원 투입 → 대시보드에 온라인 표시 확인

## 5. 백업·복원

```bash
./backup.sh /backup/eum            # DB + 인증서·키 디렉터리, SHA-256 기록, 30일 보관
./restore.sh /backup/eum/eum-db-....dump /backup/eum/eum-data-....tgz
```
복원 후 웹 → 감사로그 → **무결성 검증**을 실행해 체인이 정상인지 확인합니다.
