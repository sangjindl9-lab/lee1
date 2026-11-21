#!/bin/sh
# Railway 시작 스크립트: 볼륨(/data)의 SQLite 가 처음 만들어질 때만 데모 시드를 넣는다.
# (seed.ts 는 기존 데이터를 지우므로 재시작마다 돌리면 안 된다.)
set -e
DB_FILE="${DATABASE_URL#file:}"
FIRST=0
[ -f "$DB_FILE" ] || FIRST=1
mkdir -p "$(dirname "$DB_FILE")" "${STORAGE_ROOT:-./storage}"
npx prisma db push --skip-generate
if [ "$FIRST" = "1" ]; then
  echo "[start] 새 DB — 데모 시드 입력"
  node --import tsx prisma/seed.ts
fi
exec npx next start -H 0.0.0.0 -p "${PORT:-3220}"
