import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { q, one, migrate, log, pool } from './db.js';
import { sendMail, mailConfigured } from './mail.js';
import { latestWindowsRelease, releaseHistory } from './releases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://fm2-connect-production.up.railway.app').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ANDROID_TEST_URL = 'https://play.google.com/apps/testing/kr.eumsoft.filemanager2';
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=kr.eumsoft.filemanager2';
const SESSION_DAYS = 90;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  // Tauri 앱(PC 프로그램)에서 호출할 수 있도록 CORS 허용 (쿠키 미사용, Bearer 토큰만)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------- 공통 유틸 ----------------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ipOf = (req) => (req.ip || '').replace('::ffff:', '');
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// 간단한 IP별 요청 제한 (인증 API)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.path + '|' + ipOf(req);
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ error: 'too_many_requests', message: '잠시 후 다시 시도해 주세요' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
    const ctx = await sessionFromToken(String(token));
    if (!ctx) return res.status(401).json({ error: 'unauthorized', message: '다시 로그인해 주세요' });
    req.ctx = ctx;
    next();
  } catch (e) { next(e); }
}

async function sessionFromToken(token) {
  if (!token || token.length < 20) return null;
  const row = await one(`
    SELECT s.id AS session_id, d.id AS device_id, d.kind, d.name AS device_name, d.revoked,
           u.id AS user_id, u.email, u.name, u.email_verified, u.deleted_at
    FROM device_sessions s JOIN devices d ON d.id = s.device_id JOIN users u ON u.id = d.user_id
    WHERE s.token_hash = $1 AND s.revoked = FALSE AND s.expires_at > now()`, [sha(token)]);
  if (!row || row.revoked || row.deleted_at) return null;
  return row;
}

// ---------------- 계정 ----------------
app.post('/api/auth/register', limit(10, 3600e3), wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!emailOk(e)) return res.status(400).json({ error: 'bad_email', message: '이메일 형식을 확인해 주세요' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'weak_password', message: '비밀번호는 8자 이상이어야 합니다' });
  const exists = await one('SELECT id FROM users WHERE email=$1', [e]);
  if (exists) return res.status(409).json({ error: 'email_taken', message: '이미 가입된 이메일입니다' });
  const hash = await bcrypt.hash(password, 11);
  const vc = code6();
  const u = await one(`INSERT INTO users(email, pw_hash, name, verify_code, verify_expires, email_verified)
    VALUES ($1,$2,$3,$4, now() + interval '30 minutes', $5) RETURNING id`,
    [e, hash, String(name || '').slice(0, 50), sha(vc), !mailConfigured()]);
  if (mailConfigured()) {
    await sendMail(e, '[파일관리자2] 이메일 인증 코드', `인증 코드: ${vc}\n\n30분 안에 앱 또는 PC 프로그램에 입력해 주세요.`);
  }
  await log(u.id, null, 'register', '', ipOf(req));
  res.json({ ok: true, needsVerification: mailConfigured() });
}));

app.post('/api/auth/verify', limit(20, 3600e3), wrap(async (req, res) => {
  const e = String(req.body?.email || '').trim().toLowerCase();
  const u = await one('SELECT id, verify_code, verify_expires FROM users WHERE email=$1', [e]);
  if (!u || !u.verify_code || u.verify_code !== sha(String(req.body?.code || '')) || new Date(u.verify_expires) < new Date())
    return res.status(400).json({ error: 'bad_code', message: '인증 코드가 올바르지 않거나 만료되었습니다' });
  await q('UPDATE users SET email_verified=TRUE, verify_code=NULL WHERE id=$1', [u.id]);
  res.json({ ok: true });
}));

app.post('/api/auth/resend', limit(5, 3600e3), wrap(async (req, res) => {
  if (!mailConfigured()) return res.status(503).json({ error: 'mail_not_configured', message: '메일 발송이 설정되지 않았습니다' });
  const e = String(req.body?.email || '').trim().toLowerCase();
  const u = await one('SELECT id, email_verified FROM users WHERE email=$1', [e]);
  if (u && !u.email_verified) {
    const vc = code6();
    await q(`UPDATE users SET verify_code=$1, verify_expires=now()+interval '30 minutes' WHERE id=$2`, [sha(vc), u.id]);
    await sendMail(e, '[파일관리자2] 이메일 인증 코드', `인증 코드: ${vc}`);
  }
  res.json({ ok: true });
}));

app.post('/api/auth/login', limit(20, 600e3), wrap(async (req, res) => {
  const { email, password, device } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const u = await one('SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL', [e]);
  if (u?.locked_until && new Date(u.locked_until) > new Date())
    return res.status(423).json({ error: 'locked', message: '로그인 시도가 많아 잠시 잠겼습니다. 15분 후 다시 시도해 주세요' });
  if (!u || !(await bcrypt.compare(String(password || ''), u.pw_hash))) {
    if (u) {
      const f = u.failed_logins + 1;
      await q(`UPDATE users SET failed_logins=$1, locked_until = CASE WHEN $1 >= 8 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$2`, [f >= 8 ? 0 : f, u.id]);
      await log(u.id, null, 'login_failed', '', ipOf(req));
    }
    return res.status(401).json({ error: 'bad_credentials', message: '이메일 또는 비밀번호가 올바르지 않습니다' });
  }
  if (!u.email_verified) return res.status(403).json({ error: 'not_verified', message: '이메일 인증이 필요합니다' });
  const d = device || {};
  const kind = d.kind === 'pc' ? 'pc' : d.kind === 'android' ? 'android' : null;
  if (!kind || !d.installId) return res.status(400).json({ error: 'bad_device', message: '기기 정보가 없습니다' });
  const dev = await one(`
    INSERT INTO devices(user_id, kind, name, model, platform, app_version, install_id, last_seen, last_ip)
    VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)
    ON CONFLICT (user_id, install_id) DO UPDATE SET name=EXCLUDED.name, model=EXCLUDED.model, platform=EXCLUDED.platform,
      app_version=EXCLUDED.app_version, last_seen=now(), last_ip=EXCLUDED.last_ip, revoked=FALSE
    RETURNING id, kind, name`,
    [u.id, kind, String(d.name || kind).slice(0, 60), String(d.model || '').slice(0, 60), String(d.platform || '').slice(0, 60),
      String(d.appVersion || '').slice(0, 20), String(d.installId).slice(0, 80), ipOf(req)]);
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO device_sessions(device_id, token_hash, expires_at, ip) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4)`,
    [dev.id, sha(token), String(SESSION_DAYS), ipOf(req)]);
  await q('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
  // 새 위치(IP) 로그인 감지
  const seen = await one(`SELECT 1 FROM access_logs WHERE user_id=$1 AND action='login' AND ip=$2 LIMIT 1`, [u.id, ipOf(req)]);
  await log(u.id, dev.id, 'login', `${kind} ${dev.name}${seen ? '' : ' (새 위치)'}`, ipOf(req));
  if (!seen) notifyUser(u.id, { t: 'security', message: `새 위치에서 로그인: ${dev.name}` }, dev.id);
  res.json({ token, user: { id: u.id, email: u.email, name: u.name }, device: dev });
}));

app.post('/api/auth/forgot', limit(5, 3600e3), wrap(async (req, res) => {
  if (!mailConfigured()) return res.status(503).json({ error: 'mail_not_configured', message: '메일 발송이 아직 설정되지 않아 비밀번호 재설정을 할 수 없습니다. 고객지원으로 문의해 주세요' });
  const e = String(req.body?.email || '').trim().toLowerCase();
  const u = await one('SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL', [e]);
  if (u) {
    const c = code6();
    await q(`UPDATE users SET reset_code=$1, reset_expires=now()+interval '20 minutes' WHERE id=$2`, [sha(c), u.id]);
    await sendMail(e, '[파일관리자2] 비밀번호 재설정 코드', `재설정 코드: ${c}\n\n20분 안에 입력해 주세요. 요청하지 않았다면 이 메일을 무시하세요.`);
  }
  res.json({ ok: true });
}));

app.post('/api/auth/reset', limit(10, 3600e3), wrap(async (req, res) => {
  const { email, code, password } = req.body || {};
  const u = await one('SELECT id, reset_code, reset_expires FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
  if (!u || !u.reset_code || u.reset_code !== sha(String(code || '')) || new Date(u.reset_expires) < new Date())
    return res.status(400).json({ error: 'bad_code', message: '코드가 올바르지 않거나 만료되었습니다' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'weak_password', message: '비밀번호는 8자 이상이어야 합니다' });
  await q('UPDATE users SET pw_hash=$1, reset_code=NULL WHERE id=$2', [await bcrypt.hash(password, 11), u.id]);
  // 비밀번호 변경 시 모든 기기 로그아웃
  await q('UPDATE device_sessions SET revoked=TRUE WHERE device_id IN (SELECT id FROM devices WHERE user_id=$1)', [u.id]);
  await log(u.id, null, 'password_reset', '', ipOf(req));
  res.json({ ok: true });
}));

app.post('/api/auth/logout', auth, wrap(async (req, res) => {
  await q('UPDATE device_sessions SET revoked=TRUE WHERE id=$1', [req.ctx.session_id]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const c = req.ctx;
  res.json({ user: { id: c.user_id, email: c.email, name: c.name }, device: { id: c.device_id, kind: c.kind, name: c.device_name } });
}));

app.delete('/api/account', auth, wrap(async (req, res) => {
  const u = await one('SELECT pw_hash FROM users WHERE id=$1', [req.ctx.user_id]);
  if (!u || !(await bcrypt.compare(String(req.body?.password || ''), u.pw_hash)))
    return res.status(401).json({ error: 'bad_password', message: '비밀번호가 올바르지 않습니다' });
  for (const d of await q('SELECT id FROM devices WHERE user_id=$1', [req.ctx.user_id])) kick(d.id);
  await q('DELETE FROM users WHERE id=$1', [req.ctx.user_id]);
  res.json({ ok: true });
}));

// ---------------- 기기 ----------------
app.get('/api/devices', auth, wrap(async (req, res) => {
  const rows = await q(`SELECT id, kind, name, model, platform, app_version, created_at, last_seen, revoked
    FROM devices WHERE user_id=$1 AND revoked=FALSE ORDER BY kind, last_seen DESC NULLS LAST`, [req.ctx.user_id]);
  res.json(rows.map((d) => ({ ...d, online: sockets.has(d.id), self: d.id === req.ctx.device_id })));
}));

app.post('/api/devices/:id/revoke', auth, wrap(async (req, res) => {
  const d = await one('SELECT id FROM devices WHERE id=$1 AND user_id=$2', [req.params.id, req.ctx.user_id]);
  if (!d) return res.status(404).json({ error: 'not_found' });
  await q('UPDATE devices SET revoked=TRUE WHERE id=$1', [d.id]);
  await q('UPDATE device_sessions SET revoked=TRUE WHERE device_id=$1', [d.id]);
  await q(`UPDATE device_permissions SET status='revoked', decided_at=now() WHERE android_id=$1 OR pc_id=$1`, [d.id]);
  kick(d.id);
  await log(req.ctx.user_id, req.ctx.device_id, 'device_revoked', d.id, ipOf(req));
  res.json({ ok: true });
}));

// ---------------- 연결 승인 / 권한 ----------------
function permRow(p) {
  return { id: p.id, androidId: p.android_id, pcId: p.pc_id, status: p.status, folders: p.folders, readOnly: p.read_only,
    androidName: p.android_name, pcName: p.pc_name, createdAt: p.created_at, decidedAt: p.decided_at,
    androidOnline: sockets.has(p.android_id), pcOnline: sockets.has(p.pc_id) };
}
const PERM_SELECT = `SELECT p.*, a.name AS android_name, c.name AS pc_name FROM device_permissions p
  JOIN devices a ON a.id=p.android_id JOIN devices c ON c.id=p.pc_id`;

app.get('/api/permissions', auth, wrap(async (req, res) => {
  const col = req.ctx.kind === 'android' ? 'p.android_id' : 'p.pc_id';
  const rows = await q(`${PERM_SELECT} WHERE ${col}=$1 AND a.revoked=FALSE AND c.revoked=FALSE ORDER BY p.created_at DESC`, [req.ctx.device_id]);
  res.json(rows.map(permRow));
}));

// PC → 같은 계정의 모바일에 연결 요청
app.post('/api/pair/request', auth, wrap(async (req, res) => {
  if (req.ctx.kind !== 'pc') return res.status(400).json({ error: 'pc_only' });
  const a = await one(`SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND kind='android' AND revoked=FALSE`, [req.body?.androidId, req.ctx.user_id]);
  if (!a) return res.status(404).json({ error: 'not_found', message: '모바일 기기를 찾을 수 없습니다' });
  const p = await one(`INSERT INTO device_permissions(android_id, pc_id, status) VALUES ($1,$2,'pending')
    ON CONFLICT (android_id, pc_id) DO UPDATE SET status = CASE WHEN device_permissions.status='approved' THEN 'approved' ELSE 'pending' END
    RETURNING id`, [a.id, req.ctx.device_id]);
  const full = await one(`${PERM_SELECT} WHERE p.id=$1`, [p.id]);
  send(a.id, { t: 'pair_request', permission: permRow(full) });
  await log(req.ctx.user_id, req.ctx.device_id, 'pair_request', a.id, ipOf(req));
  res.json(permRow(full));
}));

function cleanFolders(f) {
  if (!Array.isArray(f)) return [];
  return [...new Set(f.filter((x) => typeof x === 'string' && x.startsWith('/') && !x.includes('..') && x.length < 500))].slice(0, 50);
}

app.post('/api/permissions/:id/approve', auth, wrap(async (req, res) => {
  if (req.ctx.kind !== 'android') return res.status(403).json({ error: 'android_only', message: '모바일에서만 승인할 수 있습니다' });
  const folders = cleanFolders(req.body?.folders);
  if (!folders.length) return res.status(400).json({ error: 'no_folders', message: '허용할 폴더를 하나 이상 선택해 주세요' });
  const p = await one(`UPDATE device_permissions SET status='approved', folders=$1, read_only=$2, decided_at=now()
    WHERE id=$3 AND android_id=$4 RETURNING *`, [JSON.stringify(folders), !!req.body?.readOnly, req.params.id, req.ctx.device_id]);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const full = await one(`${PERM_SELECT} WHERE p.id=$1`, [p.id]);
  send(p.pc_id, { t: 'perm_changed', permission: permRow(full) });
  await log(req.ctx.user_id, req.ctx.device_id, 'pair_approved', `${p.pc_id} ${folders.join(',')}`, ipOf(req));
  res.json(permRow(full));
}));

for (const action of ['reject', 'revoke']) {
  app.post(`/api/permissions/:id/${action}`, auth, wrap(async (req, res) => {
    const status = action === 'reject' ? 'rejected' : 'revoked';
    const p = await one(`UPDATE device_permissions SET status=$1, decided_at=now()
      WHERE id=$2 AND (android_id=$3 OR pc_id=$3) RETURNING *`, [status, req.params.id, req.ctx.device_id]);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const full = await one(`${PERM_SELECT} WHERE p.id=$1`, [p.id]);
    send(p.pc_id, { t: 'perm_changed', permission: permRow(full) });
    send(p.android_id, { t: 'perm_changed', permission: permRow(full) });
    await log(req.ctx.user_id, req.ctx.device_id, 'pair_' + status, p.id, ipOf(req));
    res.json(permRow(full));
  }));
}

// 모바일에서 일회용 연결 코드 발급 (5분 유효)
app.post('/api/pair/code', auth, limit(20, 3600e3), wrap(async (req, res) => {
  if (req.ctx.kind !== 'android') return res.status(403).json({ error: 'android_only' });
  const folders = cleanFolders(req.body?.folders);
  if (!folders.length) return res.status(400).json({ error: 'no_folders', message: '허용할 폴더를 하나 이상 선택해 주세요' });
  let c;
  for (let i = 0; i < 5; i++) {
    c = code6();
    const ok = await one(`INSERT INTO pair_codes(code, android_id, folders, read_only, expires_at) VALUES ($1,$2,$3,$4, now()+interval '5 minutes')
      ON CONFLICT (code) DO NOTHING RETURNING code`, [c, req.ctx.device_id, JSON.stringify(folders), !!req.body?.readOnly]);
    if (ok) break;
  }
  await q(`DELETE FROM pair_codes WHERE expires_at < now() - interval '1 day'`);
  res.json({ code: c, expiresInSec: 300 });
}));

// PC에서 코드 입력 → 바로 연결 (같은 계정만)
app.post('/api/pair/redeem', auth, limit(10, 600e3), wrap(async (req, res) => {
  if (req.ctx.kind !== 'pc') return res.status(400).json({ error: 'pc_only' });
  const c = await one(`SELECT pc.*, d.user_id FROM pair_codes pc JOIN devices d ON d.id=pc.android_id
    WHERE pc.code=$1 AND pc.used=FALSE AND pc.expires_at > now()`, [String(req.body?.code || '').trim()]);
  if (!c || c.user_id !== req.ctx.user_id) return res.status(400).json({ error: 'bad_code', message: '코드가 올바르지 않거나 만료되었습니다 (같은 계정으로 로그인했는지 확인해 주세요)' });
  await q('UPDATE pair_codes SET used=TRUE WHERE code=$1', [c.code]);
  const p = await one(`INSERT INTO device_permissions(android_id, pc_id, status, folders, read_only, decided_at)
    VALUES ($1,$2,'approved',$3,$4, now())
    ON CONFLICT (android_id, pc_id) DO UPDATE SET status='approved', folders=EXCLUDED.folders, read_only=EXCLUDED.read_only, decided_at=now()
    RETURNING id`, [c.android_id, req.ctx.device_id, JSON.stringify(c.folders), c.read_only]);
  const full = await one(`${PERM_SELECT} WHERE p.id=$1`, [p.id]);
  send(c.android_id, { t: 'perm_changed', permission: permRow(full) });
  await log(req.ctx.user_id, req.ctx.device_id, 'pair_code_used', c.android_id, ipOf(req));
  res.json(permRow(full));
}));

app.get('/api/logs', auth, wrap(async (req, res) => {
  const rows = await q(`SELECT l.action, l.detail, l.ip, l.at, d.name AS device_name FROM access_logs l
    LEFT JOIN devices d ON d.id=l.device_id WHERE l.user_id=$1 ORDER BY l.at DESC LIMIT 100`, [req.ctx.user_id]);
  res.json(rows);
}));

app.get('/api/transfers', auth, wrap(async (req, res) => {
  const rows = await q(`SELECT direction, path, size, status, started_at, finished_at FROM file_transfers
    WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100`, [req.ctx.user_id]);
  res.json(rows);
}));

// ---------------- 배포·다운로드 정보 ----------------
app.get('/api/config', (req, res) => {
  res.json({ publicUrl: PUBLIC_URL, downloadUrl: PUBLIC_URL + '/download', androidTestUrl: ANDROID_TEST_URL, androidStoreUrl: ANDROID_STORE_URL, mail: mailConfigured() });
});

app.get('/api/releases/latest', wrap(async (req, res) => {
  const r = await latestWindowsRelease();
  if (!r) return res.status(404).json({ error: 'no_release', message: '아직 배포된 Windows 설치 파일이 없습니다' });
  res.json(r);
}));
app.get('/api/releases', wrap(async (req, res) => res.json(await releaseHistory())));

app.get('/download/windows', wrap(async (req, res) => {
  const r = await latestWindowsRelease();
  if (!r) return res.status(404).send('아직 배포된 Windows 설치 파일이 없습니다');
  q('UPDATE app_releases SET downloads = downloads + 1 WHERE platform=$1 AND version=$2', ['windows', r.version]).catch(() => {});
  res.redirect(302, r.url);
}));

// QR 코드: 이 사이트 주소 또는 Play 주소만 허용
app.get('/api/qr', wrap(async (req, res) => {
  const u = String(req.query.url || PUBLIC_URL + '/download');
  if (!(u.startsWith(PUBLIC_URL) || u.startsWith('https://play.google.com/'))) return res.status(400).send('허용되지 않은 주소');
  res.type('png').send(await QRCode.toBuffer(u, { width: 360, margin: 1 }));
}));

// ---------------- 관리자 ----------------
function adminOnly(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24 || !crypto.timingSafeEqual(Buffer.from(sha(t)), Buffer.from(sha(ADMIN_TOKEN))))
    return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.get('/api/admin/stats', adminOnly, wrap(async (req, res) => {
  const [u] = await q('SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL');
  const devs = await q(`SELECT kind, count(*)::int AS n FROM devices WHERE revoked=FALSE GROUP BY kind`);
  const [p] = await q(`SELECT count(*)::int AS n FROM device_permissions WHERE status='approved'`);
  const [t] = await q(`SELECT count(*)::int AS n, coalesce(sum(size),0)::bigint AS bytes FROM file_transfers WHERE started_at > now()-interval '30 days'`);
  const releases = await q('SELECT platform, version, downloads, published_at FROM app_releases ORDER BY published_at DESC LIMIT 20');
  const failed = await q(`SELECT ip, count(*)::int AS n FROM access_logs WHERE action='login_failed' AND at > now()-interval '1 day' GROUP BY ip ORDER BY n DESC LIMIT 20`);
  const errors = recentErrors.slice(-50).reverse();
  res.json({ users: u.n, devices: devs, onlineNow: sockets.size, approvedConnections: p.n, transfers30d: t, releases, suspiciousLogins: failed, errors });
}));
app.post('/api/admin/notices', adminOnly, wrap(async (req, res) => {
  const n = await one('INSERT INTO notices(title, body) VALUES ($1,$2) RETURNING *', [String(req.body?.title || ''), String(req.body?.body || '')]);
  res.json(n);
}));
app.get('/api/notices', wrap(async (req, res) => res.json(await q('SELECT id, title, body, created_at FROM notices ORDER BY created_at DESC LIMIT 20'))));

app.get('/health', (req, res) => res.json({ ok: true, db: !!pool, online: sockets.size }));

// ---------------- 웹사이트 (정적 페이지) ----------------
const pub = path.join(__dirname, '..', 'public');
const pages = { '/': 'index.html', '/download': 'download.html', '/guide': 'guide.html', '/updates': 'updates.html',
  '/support': 'support.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/admin': 'admin.html' };
for (const [route, file] of Object.entries(pages)) app.get(route, (req, res) => res.sendFile(path.join(pub, file)));
app.use(express.static(pub, { maxAge: '1h', extensions: ['html'] }));

const recentErrors = [];
app.use((err, req, res, next) => {
  console.error(err);
  recentErrors.push({ at: new Date().toISOString(), path: req.path, message: String(err.message).slice(0, 300) });
  if (recentErrors.length > 200) recentErrors.shift();
  res.status(500).json({ error: 'server_error', message: '서버 오류가 발생했습니다' });
});

// ---------------- WebSocket 중계 ----------------
/** deviceId -> { ws, ctx } */
const sockets = new Map();
/** requestId -> { pcId, androidId, op, path, size } */
const pending = new Map();

function send(deviceId, msg) {
  const s = sockets.get(deviceId);
  if (s && s.ws.readyState === 1) { s.ws.send(JSON.stringify(msg)); return true; }
  return false;
}
function kick(deviceId) {
  const s = sockets.get(deviceId);
  if (s) { try { s.ws.close(4001, 'revoked'); } catch {} sockets.delete(deviceId); }
}
async function notifyUser(userId, msg, exceptId) {
  for (const [id, s] of sockets) if (s.ctx.user_id === userId && id !== exceptId) send(id, msg);
}
async function presence(ctx, online) {
  if (ctx.kind !== 'android') return;
  const pcs = await q(`SELECT pc_id FROM device_permissions WHERE android_id=$1 AND status IN ('approved','pending')`, [ctx.device_id]);
  for (const p of pcs) send(p.pc_id, { t: 'presence', deviceId: ctx.device_id, online });
}

const ALLOWED_OPS = new Set(['list', 'stat', 'read', 'write', 'mkdir', 'rename', 'delete', 'roots', 'thumb']);
const WRITE_OPS = new Set(['write', 'mkdir', 'rename', 'delete']);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 * 1024 });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const ctx = await sessionFromToken(url.searchParams.get('token') || '').catch(() => null);
  if (!ctx) { ws.close(4001, 'unauthorized'); return; }
  const old = sockets.get(ctx.device_id);
  if (old) try { old.ws.close(4000, 'replaced'); } catch {}
  sockets.set(ctx.device_id, { ws, ctx });
  ws.isAlive = true;
  q('UPDATE devices SET last_seen=now() WHERE id=$1', [ctx.device_id]).catch(() => {});
  presence(ctx, true).catch(() => {});
  ws.send(JSON.stringify({ t: 'hello', deviceId: ctx.device_id, kind: ctx.kind }));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    try {
      if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }));
      if (m.t === 'req' && ctx.kind === 'pc') return await relayRequest(ctx, ws, m);
      if (m.t === 'res' && ctx.kind === 'android') return await relayResponse(ctx, m);
    } catch (e) {
      console.error('ws', e);
      if (m?.id) ws.send(JSON.stringify({ t: 'res', id: m.id, ok: false, error: 'server_error', message: '서버 오류' }));
    }
  });
  ws.on('close', () => {
    const s = sockets.get(ctx.device_id);
    if (s && s.ws === ws) {
      sockets.delete(ctx.device_id);
      presence(ctx, false).catch(() => {});
      for (const [id, p] of pending) {
        if (p.androidId === ctx.device_id) {
          send(p.pcId, { t: 'res', id, ok: false, error: 'device_offline', message: '모바일 연결이 끊어졌습니다' });
          pending.delete(id);
        }
      }
    }
  });
});

async function relayRequest(ctx, ws, m) {
  const reply = (ok, extra) => ws.send(JSON.stringify({ t: 'res', id: m.id, ok, ...extra }));
  if (!m.id || !ALLOWED_OPS.has(m.op)) return reply(false, { error: 'bad_request', message: '지원하지 않는 요청' });
  const perm = await one(`SELECT * FROM device_permissions WHERE android_id=$1 AND pc_id=$2 AND status='approved'`, [m.to, ctx.device_id]);
  if (!perm) return reply(false, { error: 'not_permitted', message: '모바일에서 이 PC의 연결을 승인하지 않았습니다' });
  if (perm.read_only && WRITE_OPS.has(m.op)) return reply(false, { error: 'read_only', message: '읽기 전용으로 허용된 연결입니다' });
  if (!sockets.has(m.to)) return reply(false, { error: 'device_offline', message: '모바일이 오프라인입니다. 앱의 PC 연결 화면에서 연결을 켜 주세요' });
  const args = m.args || {};
  pending.set(m.id, { pcId: ctx.device_id, androidId: m.to, op: m.op, path: args.path, at: Date.now() });
  send(m.to, { t: 'req', id: m.id, from: ctx.device_id, fromName: ctx.device_name, op: m.op, args, perm: { folders: perm.folders, readOnly: perm.read_only } });
  // 전송 기록 (첫 조각에서만)
  if ((m.op === 'read' || m.op === 'write') && Number(args.offset || 0) === 0) {
    q(`INSERT INTO file_transfers(user_id, from_device, to_device, direction, path, size) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.user_id, m.op === 'read' ? m.to : ctx.device_id, m.op === 'read' ? ctx.device_id : m.to,
        m.op === 'read' ? 'mobile_to_pc' : 'pc_to_mobile', String(args.path || '').slice(0, 500), Number(args.total || 0)]).catch(() => {});
  }
  if (['delete', 'rename', 'mkdir'].includes(m.op)) log(ctx.user_id, ctx.device_id, 'remote_' + m.op, String(args.path || ''), null);
}

async function relayResponse(ctx, m) {
  const p = pending.get(m.id);
  if (!p || p.androidId !== ctx.device_id) return;
  if (!m.more) pending.delete(m.id);
  send(p.pcId, { t: 'res', id: m.id, ok: !!m.ok, data: m.data, error: m.error, message: m.message });
}

// 연결 유지 확인 + 오래된 요청 정리
setInterval(() => {
  for (const [id, s] of sockets) {
    if (!s.ws.isAlive) { try { s.ws.terminate(); } catch {} continue; }
    s.ws.isAlive = false;
    try { s.ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const [id, p] of pending) if (now - p.at > 120e3) {
    send(p.pcId, { t: 'res', id, ok: false, error: 'timeout', message: '모바일 응답 시간이 초과되었습니다' });
    pending.delete(id);
  }
}, 30e3).unref();

// ---------------- 시작 ----------------
(async () => {
  if (pool) {
    for (let i = 0; i < 10; i++) {
      try { await migrate(); console.log('DB ready'); break; } catch (e) { console.error('migrate retry', e.message); await new Promise((r) => setTimeout(r, 3000)); }
    }
  } else console.warn('DATABASE_URL 없음 — DB 기능 비활성');
  server.listen(PORT, () => console.log(`fm2-connect on :${PORT} (${PUBLIC_URL})`));
})();

export { app, server };
