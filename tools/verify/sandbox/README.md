# [시험 전용] 이미지 저장소 차단 환경용 compose 오버라이드

검증 환경에서 Docker Hub·GitHub 가 차단되어 공식 `postgres`, `caddy`, `bluenviron/mediamtx` 이미지를 받을 수 없었기 때문에
Ubuntu 패키지로 만든 대체 이미지로 전체 구성을 시험할 때 사용한 파일입니다. **운영 배포에 사용하지 마세요.**
MediaMTX 는 대체할 수 없어 제외되며(실시간 보기 미검증), 백엔드 이미지는 운영용 `backend/Dockerfile` 그대로입니다.

```bash
docker build -f tools/verify/sandbox/pg.Dockerfile -t sandbox-postgres:16 tools/verify/sandbox
cp -r frontend/dist frontend-dist && docker build -f tools/verify/sandbox/caddy.Dockerfile -t sandbox-caddy:2.6 .
docker build -f backend/Dockerfile -t web-nvr-backend:0.1.0 .
docker compose -f docker-compose.yml -f tools/verify/sandbox/docker-compose.sandbox.yml up -d
```
