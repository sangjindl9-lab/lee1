import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DATE 컬럼은 'YYYY-MM-DD' 문자열 그대로 받는다 (시간대 변환 방지)
pg.types.setTypeParser(1082, v => v);
// bigint(count, sum)는 숫자로
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1700, v => Number(v));

const url = process.env.DATABASE_URL || 'postgres://localhost:5432/stayon';
const needSsl = process.env.PGSSL === '1' || (/\.render\.com|\.amazonaws\.com|supabase|neon\.tech/.test(url) && process.env.PGSSL !== '0');

export const pool = new pg.Pool({ connectionString: url, ssl: needSsl ? { rejectUnauthorized: false } : false, max: 10 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

/** 트랜잭션: fn(client) 안의 쿼리는 모두 함께 확정되거나 함께 취소된다 */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}
