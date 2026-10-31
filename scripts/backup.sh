#!/usr/bin/env bash
# 데이터 백업: PostgreSQL 덤프 + 첨부파일 저장소를 날짜별 폴더에 저장
#   사용법: scripts/backup.sh [백업폴더]   (기본: ./backups)
#   필요 환경변수: DATABASE_URL, FILE_STORAGE_DIR  (backend/.env 를 자동으로 읽음)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f backend/.env ] && set -a && . backend/.env && set +a
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다}"
: "${FILE_STORAGE_DIR:?FILE_STORAGE_DIR 이 필요합니다}"
DEST="${1:-./backups}/$(TZ=Asia/Seoul date +%Y%m%d_%H%M%S)"
mkdir -p "$DEST"
PGURL="${DATABASE_URL/postgresql+psycopg/postgresql}"
pg_dump --format=custom --no-owner --file="$DEST/db.dump" "$PGURL"
tar -czf "$DEST/files.tar.gz" -C "$FILE_STORAGE_DIR" .
( cd "$DEST" && sha256sum db.dump files.tar.gz > SHA256SUMS )
echo "백업 완료: $DEST"
ls -lh "$DEST"
# 보관 정책 예시: 30일 지난 백업 삭제 (필요 시 주석 해제)
# find "${1:-./backups}" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
