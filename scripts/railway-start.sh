#!/bin/sh
# Railway 시작 스크립트 (PostgreSQL + 저장소 버킷)
# - 스키마를 맞추고, 사용자 테이블이 비어 있을 때만 데모(심사용) 시드를 넣는다.
#   (seed.ts 는 기존 데이터를 지우므로 데이터가 있으면 절대 돌리지 않는다)
set -e
mkdir -p "${STORAGE_ROOT:-./storage}"
npx prisma db push --skip-generate
COUNT=$(node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.user.count().then((n) => { console.log(n); return p.$disconnect(); }).catch(() => { console.log("err"); process.exit(0); });
')
if [ "$COUNT" = "0" ]; then
  echo "[start] 빈 DB — 데모 시드 입력"
  node --import tsx prisma/seed.ts
else
  echo "[start] 기존 사용자 ${COUNT}명 — 시드 건너뜀"
fi
exec npx next start -H 0.0.0.0 -p "${PORT:-3220}"
