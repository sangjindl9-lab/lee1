import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET 환경변수가 필요합니다');
}
export const config = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/eum3d',
  dataDir: DATA_DIR,
  storageDir: path.join(DATA_DIR, 'storage'),
  tmpDir: path.join(DATA_DIR, 'tmp'),
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // 렌더 워커(헤드리스 브라우저)가 앱에 접속할 내부 주소
  internalUrl: (process.env.INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, ''),
  runWorker: process.env.RUN_WORKER !== 'false',
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024,
  chunkBytes: 8 * 1024 * 1024,
  maxRenderSeconds: Number(process.env.MAX_RENDER_SECONDS || 120),
  secureCookies: process.env.NODE_ENV === 'production',
};
