import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = pg.Pool;

export function createPool(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL ?? 10) });
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** 마이그레이션 적용(up) — 이미 적용된 번호는 건너뜀. */
export async function migrateUp(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.up.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    const v = f.replace('.up.sql', '');
    if (done.has(v)) continue;
    // 각 파일은 BEGIN/COMMIT 으로 감싸져 있어 실패 시 그 파일 전체가 취소된다
    await db.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [v]);
    applied.push(v);
  }
  return applied;
}

/** 가장 최근 마이그레이션 1개 롤백(down). 운영에서는 pg_dump 백업 후에만. */
export async function migrateDownOne(db: Db): Promise<string | null> {
  const r = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  if (!r.rows.length) return null;
  const v = r.rows[0].version as string;
  await db.query(readFileSync(join(MIGRATIONS_DIR, `${v}.down.sql`), 'utf8'));
  await db.query('DELETE FROM schema_migrations WHERE version=$1', [v]);
  return v;
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
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
