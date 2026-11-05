import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tenant } from './db/index.js';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import modelRoutes from './routes/models.js';
import publicRoutes from './routes/public.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    // 공유 쇼룸(/s/)만 iframe 삽입 허용
    if (!req.path.startsWith('/s/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(cookieParser());
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api/uploads/:id/chunks', express.raw({ type: '*/*', limit: config.chunkBytes + 1024 }));
  app.use(express.json({ limit: '4mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', publicRoutes);
  app.use('/api', requireAuth, (req, res, next) => { req.db = (fn) => tenant(req.user.companyId, fn); next(); });
  app.use('/api', projectRoutes);
  app.use('/api', modelRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'API 없음' }));

  if (fs.existsSync(WEB)) {
    app.use(express.static(WEB, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(WEB, 'index.html')));
  }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === '22P02' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? '서버 오류가 발생했습니다' : err.message });
  });
  return app;
}
