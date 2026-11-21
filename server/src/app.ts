import Fastify from 'fastify';
import type { Db } from './db.js';
import { authRoutes } from './auth.js';
import { syncRoutes } from './sync.js';
import { fileRoutes } from './files.js';

export function buildApp(db: Db) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 64 * 1024 * 1024, trustProxy: true });
  app.setErrorHandler((err: any, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'server_error' : err.message });
  });
  // 간단한 요청 제한(IP당 분당 600회). 여러 서버면 Redis 기반으로 교체.
  const hits = new Map<string, { n: number; t: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const now = Date.now(); const k = req.ip; const h = hits.get(k);
    if (!h || now - h.t > 60_000) hits.set(k, { n: 1, t: now }); else if (++h.n > 600) { reply.code(429).send({ error: 'rate_limited' }); }
  });
  app.get('/health', async () => ({ ok: true, db: (await db.query('SELECT 1 AS ok')).rows[0].ok === 1 }));
  authRoutes(app, db);
  syncRoutes(app, db);
  fileRoutes(app, db);
  return app;
}
