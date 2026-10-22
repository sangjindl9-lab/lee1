#!/bin/sh
# Render 시연 서버 시작 순서: 마이그레이션 → (처음 한 번) 샘플 데이터 → API → (처음 한 번) 시연 발주서 → 화면
set -e
cd /app/api/apps/api
node dist/db/migrate.js

FIRST=$(node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query('select count(*)::int n from company')).then(r => { console.log(r.rows[0].n === 0 ? 'yes' : 'no'); return c.end(); }).catch(e => { console.error(e.message); process.exit(1); });
")
if [ "$FIRST" = "yes" ] && [ "$DEMO_DATA" = "true" ]; then
  SEED_DEMO=true node dist/db/seed.js
else
  node dist/db/seed.js
fi

PORT=4000 node dist/main.js &
API_PID=$!

# API 가 뜰 때까지 대기
i=0
until node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i+1)); [ $i -gt 60 ] && echo "API 시작 실패" && exit 1; sleep 1
done

if [ "$FIRST" = "yes" ] && [ "$DEMO_DATA" = "true" ]; then
  node scripts/demo-purchase.mjs http://127.0.0.1:4000 || echo "시연 발주서 생성 실패 (서비스는 계속 실행)"
fi

cd /app/web
PORT=${PORT:-10000} node apps/web/server.js &
WEB_PID=$!

# 둘 중 하나라도 죽으면 컨테이너를 재시작하게 한다
while kill -0 $API_PID 2>/dev/null && kill -0 $WEB_PID 2>/dev/null; do sleep 5; done
echo "프로세스 종료 감지 — 재시작"
exit 1
