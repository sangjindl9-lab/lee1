#!/usr/bin/env bash
# 백업 복원: 대상 DB의 기존 데이터를 백업 시점으로 교체하고 첨부파일을 되돌림
#   사용법: scripts/restore.sh <백업폴더>
#   주의: 복원 전 서버(uvicorn)를 중지하세요. 현재 데이터는 덮어쓰여집니다.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?복원할 백업 폴더를 지정하세요 (예: backups/20261018_120000)}"
[ -f backend/.env ] && set -a && . backend/.env && set +a
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다}"
: "${FILE_STORAGE_DIR:?FILE_STORAGE_DIR 이 필요합니다}"
( cd "$SRC" && sha256sum -c SHA256SUMS )
if [ "${FORCE:-}" != "1" ]; then
  read -r -p "현재 데이터베이스와 첨부파일을 '$SRC' 시점으로 덮어씁니다. 계속하려면 YES 입력: " ans
  [ "$ans" = "YES" ] || { echo "취소했습니다."; exit 1; }
fi
PGURL="${DATABASE_URL/postgresql+psycopg/postgresql}"
pg_restore --clean --if-exists --no-owner --dbname="$PGURL" "$SRC/db.dump"
mkdir -p "$FILE_STORAGE_DIR"
OLD="$FILE_STORAGE_DIR.before-restore.$(date +%s)"
mv "$FILE_STORAGE_DIR" "$OLD" && mkdir -p "$FILE_STORAGE_DIR"
tar -xzf "$SRC/files.tar.gz" -C "$FILE_STORAGE_DIR"
echo "복원 완료. 복원 전 첨부파일은 $OLD 에 남겨두었습니다(확인 후 삭제)."
