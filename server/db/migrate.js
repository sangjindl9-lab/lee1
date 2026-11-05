import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

export async function migrate() {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => { console.log('migrate ok'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
