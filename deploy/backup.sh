#!/usr/bin/env bash
# DB 백업 (pg_dump custom 형식) + 인증서·키 디렉터리 백업
# 사용: ./backup.sh /backup/경로     (cron 예: 0 2 * * * /opt/eum/deploy/backup.sh /backup/eum)
set -euo pipefail
DEST=${1:?백업 경로를 지정하세요}
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
cd "$(dirname "$0")"
docker compose exec -T db pg_dump -U eum -Fc eum > "$DEST/eum-db-$TS.dump"
docker compose run --rm --no-deps -v "$DEST":/backup --entrypoint sh server -c "tar czf /backup/eum-data-$TS.tgz -C /data ."
sha256sum "$DEST/eum-db-$TS.dump" "$DEST/eum-data-$TS.tgz" > "$DEST/eum-$TS.sha256"
find "$DEST" -name 'eum-*' -mtime +${KEEP_DAYS:-30} -delete
echo "백업 완료: $DEST (eum-*-$TS)"
