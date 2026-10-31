# 웹 NVR (현장 영상관제) — v0.4.0 (1·2단계, 3단계 일부, 지능형 분석, 윈도우 설치판)

여러 제조사 IP 카메라를 ONVIF·RTSP로 등록해 웹브라우저에서 실시간 감시하고, 서버에서 24시간 녹화·검색·재생·MP4 내보내기를
하는 업무용 웹 NVR 입니다. 플러그인·ActiveX 없이 PC·모바일 브라우저에서 동작합니다.

- 설계: [docs/01-설계서.md](docs/01-설계서.md)
- 설치·운영·백업/복구: [docs/02-설치운영.md](docs/02-설치운영.md)
- 검증 결과(합성 스트림 / 자동화 / 실장비 구분): [docs/03-검증결과.md](docs/03-검증결과.md)
- 미구현·제약 목록: [docs/04-미구현목록.md](docs/04-미구현목록.md)
- 윈도우 설치판(VMS 소프트웨어): [docs/05-윈도우설치.md](docs/05-윈도우설치.md) — 설치 프로그램 만들기: `bash packaging/windows/build.sh`

## 빠른 시작(리눅스 Docker)
```bash
sudo bash scripts/init-secrets.sh        # 마스터 키·DB 비밀번호·데이터 폴더 생성
sudo nano .env                           # 접속 주소·WebRTC 주소·녹화 디스크 경로
sudo docker compose up -d --build
sudo docker compose exec api python -m nvr.cli create-admin --username admin
# 브라우저: https://<NVR_SITE_ADDRESS>
```

## 구성
| 디렉터리 | 내용 |
|---|---|
| `backend/nvr/api` | 관리 API(FastAPI): 인증·권한·현장·카메라·ONVIF/RTSP 등록·녹화 검색·재생·내보내기·감사로그·mediamtx 인증 훅 |
| `backend/nvr/recorder` | 녹화 서비스: 카메라별 FFmpeg 감독, 재인코딩 없는 구간 녹화, 원자적 확정, 단절·재연결, 비정상 종료 복구 |
| `backend/nvr/worker` | 작업 서비스: MP4 내보내기, 보관 정책 정리, 만료 처리, mediamtx 설정 생성 |
| `backend/nvr/analytics` | 지능형 분석 서비스(CPU): 불꽃·연기·안전모·수위·침입·배회·군집·쓰러짐·뛰기·장시간 정지 |
| `backend/nvr/onvif` | 경량 ONVIF 클라이언트(Device·Media·Media2, SSRF 검사 포함) |
| `backend/alembic` | DB 마이그레이션 |
| `backend/tests` | 자동화 시험(pytest) |
| `frontend` | React + TypeScript 웹 화면(한국어) |
| `backend/nvr/winctl.py` 등 | 윈도우 설치판: 서비스 관리(nvrctl)·관제 프로그램(winclient)·서버 관리 아이콘(wintray) |
| `packaging/windows` | 윈도우 설치 프로그램 빌드(NSIS)·외부 구성 요소 목록(deps.txt, SHA-256) |
| `deploy` | Caddy(HTTPS·프록시), MediaMTX 설정 템플릿 |
| `scripts` | 비밀 파일 생성, 백업, 복구 |
| `tools/test-camera` | **시험 전용** 합성 RTSP 카메라·ONVIF 시뮬레이터·분석 시험 장면 생성기 (실제 카메라·실제 화재 아님) |
| `tools/verify` | 장애 시나리오 검증 도구 |

## 개발·시험
```bash
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
NVR_TEST_DATABASE_URL=postgresql+psycopg://nvr:<pw>@127.0.0.1:5432/nvr_test .venv/bin/pytest -q tests
cd ../frontend && npm ci && npm run build
```

## 지원 범위 요약
- ONVIF(Profile T 중심 Media2, Profile S 호환 Media ver10) 수동 등록, RTSP 수동 등록, TCP/UDP, HTTP 스냅샷
- 코덱: H.264/H.265 원본 녹화, AAC 원본·G.711→AAC 변환 저장. 브라우저 실시간은 H.264 권장(H.265는 브라우저 제한)
- 2단계: 예약·이벤트(전후) 녹화, ONVIF 이벤트·PTZ·자동 탐색, 이메일·웹훅 알림, 카메라 단위 권한, 북마크, 25·36분할·화면 순환
- 3단계(일부): 여러 현장 상태 통합(Edge), Profile G 검색, 다중 카메라 동기 재생, 분석 모듈 이벤트 연동
- 지능형 분석(v0.3, CPU): 불꽃·연기(시험)·안전모 미착용(색 기반 추정)·수위·침입·배회·군집·쓰러짐·뛰기·장시간 정지 — 실제 현장 정확도 미검증
- 제조사 전용 드라이버·저장영상 회수·복합 이상행동(싸움 등)·GPU 가속·장애 전환은 **미구현** — docs/04-미구현목록.md
- 모든 제조사·모델 지원을 의미하지 않습니다. 실장비 검증 전이며 ONVIF 공식 적합성 인증 제품이 아닙니다.
