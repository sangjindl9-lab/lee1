import { Pool, types } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// numeric(1700) 은 문자열 그대로 유지 (기본값과 동일하지만 명시)
types.setTypeParser(1700, (v) => v);
// date(1082) 는 'YYYY-MM-DD' 문자열로 유지 — 시간대 변환으로 하루 밀리는 문제 방지
types.setTypeParser(1082, (v) => v);

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, db };
}

export const DB_TOKEN = Symbol('DB');
export const POOL_TOKEN = Symbol('POOL');
