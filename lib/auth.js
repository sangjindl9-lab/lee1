import crypto from 'node:crypto';
import { one, q } from './db.js';
import { HttpError, rid } from './util.js';

const SECRET = process.env.SESSION_SECRET || (() => {
  console.warn('[경고] SESSION_SECRET 이 없어 임시 키를 씁니다. 서버를 다시 시작하면 모두 로그아웃됩니다.');
  return crypto.randomBytes(32).toString('hex');
})();
const COOKIE = 'so_sess';
const MAX_AGE = 30 * 24 * 3600; // 30일

/* ---------- 비밀번호 (scrypt) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const a = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 72) return '비밀번호가 너무 깁니다.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣어주세요.';
  return null;
}

/* ---------- 서명 토큰 ---------- */
export function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verify(tok) {
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
  const [body, mac] = tok.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); if (o.exp && o.exp < Date.now() / 1000) return null; return o; } catch { return null; }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const secure = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
export function setCookie(res, req, name, value, maxAge) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
}

export async function login(res, req, user) {
  setCookie(res, req, COOKIE, sign({ uid: user.id, v: user.token_ver, exp: Math.floor(Date.now() / 1000) + MAX_AGE }), MAX_AGE);
  await q(`UPDATE users SET last_login_at=now() WHERE id=$1`, [user.id]);
}
export function logout(res, req) { setCookie(res, req, COOKIE, '', 0); }

/** 모든 요청: 쿠키로 로그인 사용자를 req.user 에 싣는다 */
export async function loadUser(req, res, next) {
  try {
    const t = verify(parseCookies(req)[COOKIE]);
    if (t && t.uid) {
      const u = await one(`SELECT * FROM users WHERE id=$1`, [t.uid]);
      if (u && u.token_ver === t.v && u.status === 'active') req.user = u;
    }
    next();
  } catch (e) { next(e); }
}
export function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, '로그인이 필요합니다.', 'login'));
  if (!req.user.profile_done) return next(new HttpError(403, '가입 정보를 먼저 완료해 주세요.', 'profile'));
  next();
}
export function requireLogin(req, res, next) { if (!req.user) return next(new HttpError(401, '로그인이 필요합니다.', 'login')); next(); }
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new HttpError(403, '관리자만 사용할 수 있습니다.'));
  next();
}

/** 관리자 이메일(환경변수 ADMIN_EMAILS)로 로그인하면 관리자 권한을 준다 */
export async function promoteIfAdmin(user) {
  const list = String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (user.email && list.includes(user.email.toLowerCase()) && user.role !== 'admin') {
    await q(`UPDATE users SET role='admin' WHERE id=$1`, [user.id]);
    user.role = 'admin';
  }
  return user;
}

/* ---------- 간단한 요청 제한 (IP 기준, 메모리) ---------- */
const hits = new Map();
export function rateLimit(key, limit, windowSec) {
  const now = Date.now(), k = key, e = hits.get(k);
  if (!e || e.reset < now) { hits.set(k, { n: 1, reset: now + windowSec * 1000 }); return true; }
  e.n++; return e.n <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (e.reset < now) hits.delete(k); }, 60_000).unref();

/* ---------- 소셜 로그인 (Google, Kakao) ---------- */
export const baseUrl = req => (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`).replace(/\/$/, '');
export const oauth = {
  google: {
    enabled: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: (redirect, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account'
    }),
    async profile(code, redirect) {
      const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) });
      const tj = await tr.json(); if (!tr.ok) throw new Error('google token: ' + JSON.stringify(tj));
      const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tj.access_token } });
      const u = await ur.json(); if (!ur.ok) throw new Error('google userinfo');
      return { uid: String(u.sub), email: u.email || null, emailVerified: !!u.email_verified, name: u.name || '' };
    }
  },
  kakao: {
    enabled: () => !!process.env.KAKAO_REST_KEY,
    authUrl: (redirect, state) => 'https://kauth.kakao.com/oauth/authorize?' + new URLSearchParams({
      client_id: process.env.KAKAO_REST_KEY, redirect_uri: redirect, response_type: 'code', state
    }),
    async profile(code, redirect) {
      const p = { grant_type: 'authorization_code', client_id: process.env.KAKAO_REST_KEY, redirect_uri: redirect, code };
      if (process.env.KAKAO_CLIENT_SECRET) p.client_secret = process.env.KAKAO_CLIENT_SECRET;
      const tr = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(p) });
      const tj = await tr.json(); if (!tr.ok) throw new Error('kakao token: ' + JSON.stringify(tj));
      const ur = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + tj.access_token } });
      const u = await ur.json(); if (!ur.ok) throw new Error('kakao me');
      const acc = u.kakao_account || {};
      return { uid: String(u.id), email: acc.email || null, emailVerified: !!(acc.is_email_valid && acc.is_email_verified), name: (acc.profile && acc.profile.nickname) || '' };
    }
  }
};
export const newState = () => rid(18);
