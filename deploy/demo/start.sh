#!/bin/bash
# [클라우드 데모 전용] 한 컨테이너에서 api·recorder·worker·mediamtx·caddy·합성 시험 카메라를 함께 실행.
# 운영(현장 서버)은 docker-compose.yml 을 사용하세요.
set -euo pipefail
DATA=${NVR_DATA_DIR:-/data}
mkdir -p "$DATA/recordings" "$DATA/exports" "$DATA/secrets" /mediamtx-config
umask 077
[ -s "$DATA/secrets/master.key" ] || head -c 32 /dev/urandom | base64 > "$DATA/secrets/master.key"
[ -s "$DATA/secrets/cam.pass" ] || head -c 18 /dev/urandom | base64 | tr -d '/+=\n' > "$DATA/secrets/cam.pass"

# Railway Postgres: postgresql://… → SQLAlchemy psycopg 드라이버 표기
DBURL=${DATABASE_URL:?DATABASE_URL 이 필요합니다(Railway Postgres 연결)}
export NVR_DATABASE_URL="postgresql+psycopg://${DBURL#*://}"
export NVR_MASTER_KEY_FILE="$DATA/secrets/master.key"
export NVR_RECORDINGS_DIR="$DATA/recordings" NVR_EXPORTS_DIR="$DATA/exports"
export NVR_MEDIAMTX_CONFIG_PATH=/mediamtx-config/mediamtx.yml
export NVR_MEDIAMTX_BASE_CONFIG_PATH=/app/deploy/mediamtx/mediamtx.base.yml
export NVR_MEDIAMTX_AUTH_URL=http://127.0.0.1:8000/internal/mediamtx/auth
export NVR_LIVE_MODE=hls NVR_TRUSTED_PROXIES=127.0.0.1/32
export PYTHONPATH=/app/backend
cd /app/backend

# 합성 카메라는 루프백이 아닌 컨테이너 자체 주소로 연결(루프백은 보안상 항상 차단)
IP=$(python3.12 -c "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.connect(('10.255.255.255',1));print(s.getsockname()[0])" 2>/dev/null || true)
if [ -z "$IP" ] || [ "${IP#127.}" != "$IP" ]; then IP=$(hostname -I | tr ' ' '\n' | grep -v '^127\.' | grep -v '^$' | head -1); fi
echo "[demo] container ip: $IP"

for i in $(seq 1 30); do alembic upgrade head && break; echo "[demo] DB 대기 ($i)"; sleep 2; done
python -m nvr.demo_seed "$IP" 18554 "$DATA/secrets/cam.pass"
python -c "from nvr.worker import mediamtx_config as m; m.sync()"

PIDS=()
run() { "$@" & PIDS+=($!); }
run /usr/bin/python3.12 /app/tools/test-camera/rtsp_test_camera.py --bind "$IP" --port 18554 --user cam \
    --password-file "$DATA/secrets/cam.pass" --main-kbps "${NVR_DEMO_CAM_KBPS:-450}" --audio aac
run /usr/local/bin/mediamtx /mediamtx-config/mediamtx.yml
run /opt/venv/bin/uvicorn nvr.api.main:app --host 127.0.0.1 --port 8000 --no-server-header
run /opt/venv/bin/python -m nvr.recorder.main
run /opt/venv/bin/python -m nvr.worker.main
run caddy run --config /app/deploy/demo/Caddyfile --adapter caddyfile

trap 'kill -TERM "${PIDS[@]}" 2>/dev/null; wait' TERM INT
wait -n "${PIDS[@]}"
echo "[demo] 프로세스 하나가 종료되어 컨테이너를 재시작합니다"
kill -TERM "${PIDS[@]}" 2>/dev/null || true
wait
exit 1
