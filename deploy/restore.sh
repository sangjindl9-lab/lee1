#!/usr/bin/env bash
# 복원: ./restore.sh /backup/eum-db-YYYYmmdd-HHMMSS.dump [/backup/eum-data-....tgz]
# 주의: 현재 DB 내용을 덮어씁니다. 복원 후 관리 화면 > 감사로그 > 무결성 검증을 실행하세요.
set -euo pipefail
DUMP=${1:?DB 백업 파일을 지정하세요}
DATA=${2:-}
cd "$(dirname "$0")"
sha256sum -c "$(dirname "$DUMP")"/eum-*.sha256 --ignore-missing
docker compose stop server
docker compose exec -T db dropdb -U eum --if-exists eum
docker compose exec -T db createdb -U eum eum
docker compose exec -T db pg_restore -U eum -d eum < "$DUMP"
if [ -n "$DATA" ]; then
  docker compose run --rm --no-deps -v "$(dirname "$DATA")":/backup --entrypoint sh server -c "tar xzf /backup/$(basename "$DATA") -C /data"
fi
docker compose start server
echo "복원 완료"
