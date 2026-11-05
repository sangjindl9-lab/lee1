import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

/** 회사 범위 트랜잭션: RLS 역할로 전환 후 실행. 일반 요청은 모두 여기를 거친다. */
export async function tenant(companyId, fn) {
  if (!companyId) throw new Error('companyId 없음');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE eum_app');
    await c.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** 시스템 범위: 회원가입·로그인 조회·공유토큰 조회·작업 큐 선점에만 사용 */
export async function system(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function audit(c, { companyId, userId, action, target, meta }) {
  await c.query('INSERT INTO audit_logs (company_id,user_id,action,target,meta) VALUES ($1,$2,$3,$4,$5)',
    [companyId, userId || null, action, target || null, meta || {}]);
}
