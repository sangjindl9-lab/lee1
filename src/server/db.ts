// DB 어댑터. DATABASE_URL 이 있으면 PostgreSQL, 없으면 내장 Postgres(PGlite, 개발·테스트용).
// 트랜잭션 콜백 안에서는 전달받은 t 로만 질의하고, 외부 사업자 호출은 하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export interface Q { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
interface Impl extends Q { exec: (sql: string) => Promise<any>; tx: <T>(fn: (t: Q) => Promise<T>) => Promise<T>; close: () => Promise<any> }

const g = globalThis as any;

async function create(memory: boolean): Promise<Impl> {
  let impl: Impl;
  if (config.databaseUrl && !memory) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    impl = {
      query: (s, p) => pool.query(s, p), exec: (s) => pool.query(s), close: () => pool.end(),
      tx: async (fn) => {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const r = await fn({ query: (s, p) => c.query(s, p) }); await c.query('COMMIT'); return r; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    let pgl: any;
    if (memory) pgl = new PGlite();
    else { fs.mkdirSync(config.dataDir, { recursive: true }); pgl = new PGlite(path.join(config.dataDir, 'pglite')); }
    await pgl.waitReady;
    impl = { query: (s, p) => pgl.query(s, p), exec: (s) => pgl.exec(s), close: () => pgl.close(),
      tx: (fn) => pgl.transaction((t: any) => fn({ query: (s, p) => t.query(s, p) })) };
  }
  await impl.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(process.cwd(), 'prisma', 'migrations');
  for (const d of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, d, 'migration.sql');
    if (!fs.existsSync(f)) continue;
    if ((await impl.query('SELECT 1 FROM schema_migrations WHERE name=$1', [d])).rows.length) continue;
    await impl.exec(fs.readFileSync(f, 'utf8'));
    await impl.query('INSERT INTO schema_migrations(name) VALUES ($1)', [d]);
  }
  return impl;
}

export function initDb(opts: { memory?: boolean } = {}): Promise<Impl> {
  if (!g.__eumDb) g.__eumDb = create(!!opts.memory);
  return g.__eumDb;
}
export const db = {
  query: async (s: string, p?: any[]) => (await initDb()).query(s, p),
  tx: async <T>(fn: (t: Q) => Promise<T>) => (await initDb()).tx(fn),
  close: async () => { if (g.__eumDb) { await (await g.__eumDb).close(); g.__eumDb = null; } },
};
export const one = async (q: Q, sql: string, params?: any[]) => (await q.query(sql, params)).rows[0] || null;
export const all = async (q: Q, sql: string, params?: any[]) => (await q.query(sql, params)).rows;
