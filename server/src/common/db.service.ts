import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export type Q = <T extends QueryResultRow = any>(sql: string, params?: any[]) => Promise<T[]>;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger('DB');
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  async query<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T[]> {
    const r = await this.pool.query<T>(sql, params);
    return r.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async tx<T>(fn: (q: Q, client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: Q = async (sql, params = []) => (await client.query(sql, params)).rows;
      const out = await fn(q, client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }

  /** migrations/*.sql 을 이름순으로 1회씩 적용 */
  async migrate(): Promise<void> {
    const dir = path.resolve(__dirname, '..', '..', 'migrations');
    await this.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await this.query<{ name: string }>('SELECT name FROM schema_migrations')).map(r => r.name));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await this.tx(async q => {
        await q(sql);
        await q('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      });
      this.log.log(`마이그레이션 적용: ${f}`);
    }
  }

  async onModuleDestroy() { await this.pool.end(); }
}
