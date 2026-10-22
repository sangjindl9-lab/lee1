#!/bin/sh
# DB 전체 덤프 + 첨부파일 묶음. 사용: docker compose exec backup sh /scripts/backup.sh
set -eu
TS=$(date +%Y%m%d-%H%M%S)
DIR=/backups/$TS
mkdir -p "$DIR"
pg_dump --format=custom --no-owner --file="$DIR/erp.dump"
tar -czf "$DIR/storage.tar.gz" -C /data storage
( cd "$DIR" && sha256sum erp.dump storage.tar.gz > SHA256SUMS )
echo "백업 완료: $DIR ($(du -sh "$DIR" | cut -f1))"
find /backups -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_KEEP_DAYS:-30}" -exec rm -rf {} + 2>/dev/null || true
