#!/bin/sh
# ROLE: api(기본) | worker(파이프라인) | render(렌더링) | beat(주기 작업)
set -e
case "${ROLE:-api}" in
  api)    alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" ;;
  worker) exec celery -A app.tasks:celery_app worker -Q pipeline -n pipeline@%h --concurrency "${WORKER_CONCURRENCY:-4}" --loglevel info ;;
  render) exec celery -A app.tasks:celery_app worker -Q render -n render@%h --concurrency "${RENDER_CONCURRENCY:-1}" --loglevel info ;;
  beat)   exec celery -A app.tasks:celery_app beat --loglevel info ;;
  *) echo "알 수 없는 ROLE: $ROLE" && exit 1 ;;
esac
