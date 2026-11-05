// PostgreSQL 기반 비동기 작업 큐 (FOR UPDATE SKIP LOCKED). 여러 워커 프로세스가 동시에 돌아도 중복 실행 없음.
import os from 'node:os';
import { system, tenant } from '../db/index.js';

export const WORKER_ID = `${os.hostname()}:${process.pid}`;

export async function enqueue(c, { companyId, type, payload, userId, maxAttempts = 2 }) {
  const { rows } = await c.query(
    'INSERT INTO jobs (company_id,type,payload,created_by,max_attempts) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [companyId, type, payload, userId || null, maxAttempts]);
  return rows[0];
}

export async function claim(types) {
  return system(async (c) => {
    const { rows } = await c.query(
      `UPDATE jobs SET status='running', attempts=attempts+1, started_at=now(), progress=0, error=NULL,
              message=$2
        WHERE id = (SELECT id FROM jobs WHERE status='queued' AND type = ANY($1)
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`, [types, `작업자 ${WORKER_ID}`]);
    return rows[0] || null;
  });
}

export const progress = (job, p, message) =>
  tenant(job.company_id, (c) => c.query('UPDATE jobs SET progress=$2, message=COALESCE($3,message) WHERE id=$1', [job.id, p, message || null]));

export async function finish(job, result) {
  await tenant(job.company_id, (c) => c.query(
    "UPDATE jobs SET status='done', progress=1, result=$2, finished_at=now(), message='완료' WHERE id=$1", [job.id, result || {}]));
}

/** 실패: 재시도 횟수가 남으면 다시 대기열로 */
export async function fail(job, err) {
  const msg = (err?.message || String(err)).slice(0, 2000);
  await tenant(job.company_id, (c) => c.query(
    `UPDATE jobs SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
            error=$2, message = CASE WHEN attempts < max_attempts THEN '실패 — 자동 재시도 대기' ELSE '실패' END,
            finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
      WHERE id=$1`, [job.id, msg]));
}

/** 프로세스가 죽어 'running' 으로 남은 작업 복구 */
export const recoverStale = () => system((c) => c.query(
  `UPDATE jobs SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
          error = COALESCE(error,'작업자 중단으로 복구됨')
    WHERE status='running' AND started_at < now() - interval '30 minutes'`));
