import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { config } from '../config';
import { createDb, DB_TOKEN, POOL_TOKEN } from './db';

const { pool, db } = createDb(config.DATABASE_URL);

@Global()
@Module({
  providers: [
    { provide: POOL_TOKEN, useValue: pool },
    { provide: DB_TOKEN, useValue: db },
  ],
  exports: [DB_TOKEN, POOL_TOKEN],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
