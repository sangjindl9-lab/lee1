#!/bin/sh
# DB 마이그레이션 적용 후 API 시작
set -e
cd /app/backend
for i in $(seq 1 30); do
  if alembic upgrade head; then break; fi
  echo "DB 준비 대기 중... ($i)"; sleep 2
done
# X-Forwarded-For 는 앱이 NVR_TRUSTED_PROXIES 기준으로 직접 해석한다
exec uvicorn nvr.api.main:app --host 0.0.0.0 --port 8000 --workers ${NVR_API_WORKERS:-2} --no-server-header
