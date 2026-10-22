import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, q } from './db.js';
import { config, isProd } from './config.js';
import { loadUser, csrfGuard, authRouter } from './auth.js';
import { publicRouter } from './routes/public.js';
import { guestRouter } from './routes/guest.js';
import { hostRouter } from './routes/host.js';
import { adminRouter } from './routes/admin.js';
import { HttpError, todayKST } from './util.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 로드밸런서 뒤에서 실제 IP를 쓰기 위함

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://*.kakaocdn.net', 'https://*.googleusercontent.com', 'https://*.pstatic.net'],
      'connect-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'upgrade-insecure-requests': isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next(); });
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

// 요청 수 제한 (무차별 대입·스크래핑 방어)
const lim = (windowMin, max, msg) => rateLimit({ windowMs: windowMin * 60e3, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: msg || '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }) });
app.use('/api', lim(1, 240));
app.use(['/auth', '/api/auth'], lim(10, 30, '로그인 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.'));
const bookLim = lim(10, 30);
app.use('/api/bookings', (req, res, next) => (req.method === 'POST' ? bookLim(req, res, next) : next()));
app.use(/^\/api\/host\/listings\/\d+\/photos$/, lim(10, 40, '사진 업로드가 너무 잦아요. 잠시 후 다시 시도해 주세요.'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(loadUser);
app.use(authRouter);
app.use('/api', csrfGuard);
app.use(publicRouter);
app.use(guestRouter);
app.use(hostRouter);
app.use(adminRouter);
app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소예요.' }));

// 화면 (빌드된 React)
const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  const indexHtml = fs.readFileSync(path.join(dist, 'index.html'));
  app.get('*', (req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' }).send(indexHtml));
}

// 에러 처리: 내부 오류 내용은 사용자에게 보여주지 않음
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') err = new HttpError(413, '요청이 너무 커요.');
  if (err.type === 'entity.parse.failed') err = new HttpError(400, '요청 형식이 올바르지 않아요.');
  const status = err.status || 500;
  if (status >= 500) console.error(req.method, req.path, err);
  res.status(status).json({ error: status >= 500 ? '일시적인 오류가 생겼어요. 잠시 후 다시 시도해 주세요.' : err.message, code: status >= 500 ? undefined : err.code });
});

// 주기 작업: 응답 기한 지난 요청 만료, 숙박 끝난 예약 완료 처리, 만료 세션 정리
async function jobs() {
  try {
    await q(`UPDATE bookings SET status='expired', decided_at=now() WHERE status='requested'
      AND (created_at < now() - make_interval(hours => $1) OR check_in <= $2::date)`, [config.requestHoldHours, todayKST()]);
    await q(`UPDATE bookings SET status='completed' WHERE status='confirmed' AND check_out <= $1::date`, [todayKST()]);
    await q(`DELETE FROM sessions WHERE expires_at < now()`);
  } catch (e) { console.error('jobs', e.message); }
}

await migrate();
if (config.seedDemo) await seedDemo().catch(e => console.error('seed', e));
await jobs();
setInterval(jobs, 10 * 60e3).unref();
app.listen(config.port, () => console.log(`머묾 서버 실행 중 :${config.port} (${isProd ? 'production' : 'dev'})`));
