#!/usr/bin/env node
/**
 * 발급 사이트 백업(JSON.gz) 되살리기 — 빈 데이터베이스에 넣는다.
 *   DATABASE_URL=postgresql://... node scripts/restore-portal.js portal-20261030-0400.json.gz
 * 표 구조는 서버를 한 번 띄우면(마이그레이션) 만들어지므로, 서버를 먼저 띄운 뒤 끄고 실행하세요.
 */
const fs = require('fs');
const zlib = require('zlib');
const { createPool } = require('../lib/db');

(async () => {
  const file = process.argv[2];
  if (!file || !process.env.DATABASE_URL) { console.error('사용법: DATABASE_URL=... node scripts/restore-portal.js <백업파일.json.gz>'); process.exit(1); }
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  const pool = createPool(process.env.DATABASE_URL);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set session_replication_role = replica'); // 외래키 순서 무시
    for (const [t, rows] of Object.entries(data.tables)) {
      await c.query(`delete from "${t}"`);
      for (const r of rows) {
        const cols = Object.keys(r);
        await c.query(`insert into "${t}" (${cols.map((x) => `"${x}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map((k) => (r[k] !== null && typeof r[k] === 'object' && !(r[k] instanceof Date) ? JSON.stringify(r[k]) : r[k])));
      }
      console.log(`${t}: ${rows.length}행`);
    }
    await c.query('commit');
    console.log(`되살리기 완료 (${data.createdAt} 백업)`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
