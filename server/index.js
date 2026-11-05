import fs from 'node:fs';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/index.js';
import { createApp } from './app.js';
import { startWorker, stopWorker } from './jobs/worker.js';
import { closeBrowser } from './jobs/render.js';
import { stopConvert } from './convert/pool.js';

fs.mkdirSync(config.storageDir, { recursive: true });
fs.mkdirSync(config.tmpDir, { recursive: true });
await migrate();
const server = createApp().listen(config.port, () => console.log(`EUM 3D STUDIO PRO :${config.port}`));
if (config.runWorker) startWorker();

async function shutdown() {
  server.close();
  await stopWorker();
  await closeBrowser();
  await stopConvert();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
