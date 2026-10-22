/** 데이터베이스 마이그레이션 실행: npm run db:migrate */
import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './db';

export async function runMigrations(url: string) {
  const { pool, db } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config');
  runMigrations(process.env.DATABASE_URL!)
    .then(() => console.log('마이그레이션 완료'))
    .catch((e) => {
      console.error('마이그레이션 실패:', e);
      process.exit(1);
    });
}
