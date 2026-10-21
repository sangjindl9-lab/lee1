import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = await openDb();
const ephemeral = !process.env.DATABASE_URL && !process.env.DATA_DIR && process.env.NODE_ENV === 'production';
const app = createApp(db, { staticDir: path.resolve(here, '..', 'dist'), ephemeral });
const port = Number(process.env.PORT) || 10000;
app.listen(port, () => {
  console.log(`예정공정표 서버 시작: 포트 ${port}, 저장소 ${db.kind}`);
  if (ephemeral) console.warn('DATABASE_URL이 없어 임시 저장소를 씁니다. 서버가 다시 시작되면 회원과 데이터가 사라집니다.');
  if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD가 설정되지 않아 관리자 로그인이 막혀 있습니다.');
  if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET이 없어 재시작할 때마다 관리자 로그인이 풀립니다.');
});
