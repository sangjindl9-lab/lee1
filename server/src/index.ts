import { createPool, migrateUp } from './db.js';
import { buildApp } from './app.js';
import { bootstrapAdmin } from './admin.js';

const db = createPool();
const applied = await migrateUp(db);
await bootstrapAdmin(db);
if (applied.length) console.log('migrations applied:', applied.join(', '));
const app = buildApp(db);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
