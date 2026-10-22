import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { q, one } from './db.js';
import { config, isProd, enabledProviders } from './config.js';
import { HttpError, wrap, sha256, randomToken, safeEqual, audit, parse, forbidden } from './util.js';

const SID = isProd ? '__Host-mm_sid' : 'mm_sid';
const OST = isProd ? '__Host-mm_oauth' : 'mm_oauth';
const cookieBase = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };

/* ---------------- 세션 ---------------- */
export async function createSession(req, res, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q('INSERT INTO sessions(id,user_id,csrf,expires_at,ip,ua) VALUES ($1,$2,$3,$4,$5,$6)',
    [sha256(token), userId, csrf, expires, req.ip, String(req.get('user-agent') || '').slice(0, 300)]);
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [userId]);
  res.cookie(SID, token, { ...cookieBase, expires });
}

export async function loadUser(req, res, next) {
  try {
    const token = req.cookies?.[SID];
    if (token && token.length < 100) {
      const row = await one(
        `SELECT s.id sid, s.csrf, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.id=$1 AND s.expires_at>now()`, [sha256(token)]);
      if (row && row.status === 'active') {
        req.session = { id: row.sid, csrf: row.csrf };
        const { sid, csrf, expires_at, ...user } = row;
        req.user = user;
        // 만료 7일 이내면 연장 (자주 쓰는 사용자는 계속 로그인 유지)
        if (new Date(expires_at) - Date.now() < 7 * 864e5) {
          const exp = new Date(Date.now() + config.sessionDays * 864e5);
          await q('UPDATE sessions SET expires_at=$2 WHERE id=$1', [row.sid, exp]);
          res.cookie(SID, token, { ...cookieBase, expires: exp });
        }
      } else if (row) {
        await q('DELETE FROM sessions WHERE id=$1', [row.sid]);
        res.clearCookie(SID, cookieBase);
      }
    }
    next();
  } catch (e) { next(e); }
}

export const requireAuth = (req, res, next) =>
  req.user ? next() : next(new HttpError(401, '로그인이 필요해요.', 'AUTH'));

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, '로그인이 필요해요.', 'AUTH'));
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/* CSRF: 상태를 바꾸는 요청은 Origin이 같은 사이트여야 하고, 로그인 상태면 세션별 토큰도 맞아야 함 */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  let ok = false;
  try { ok = !!origin && new URL(origin).host === req.get('host'); } catch {}
  if (!ok) return next(new HttpError(403, '요청 출처를 확인할 수 없어요.', 'CSRF'));
  if (req.session && !safeEqual(req.get('x-csrf-token'), req.session.csrf))
    return next(new HttpError(403, '보안 토큰이 만료됐어요. 새로고침 후 다시 시도해 주세요.', 'CSRF'));
  next();
}

/* ---------------- OAuth ---------------- */
const PROVIDERS = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    me: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile', pkce: true,
    profile: d => ({ id: d.sub, name: d.name || d.email?.split('@')[0], email: d.email_verified ? d.email : null, avatar: d.picture }),
  },
  kakao: {
    auth: 'https://kauth.kakao.com/oauth/authorize',
    token: 'https://kauth.kakao.com/oauth/token',
    me: 'https://kapi.kakao.com/v2/user/me',
    scope: '', pkce: true,
    profile: d => {
      const a = d.kakao_account || {};
      return { id: String(d.id), name: a.profile?.nickname || d.properties?.nickname || '카카오 사용자',
        email: a.is_email_verified ? a.email : null, avatar: a.profile?.profile_image_url || null };
    },
  },
  naver: {
    auth: 'https://nid.naver.com/oauth2.0/authorize',
    token: 'https://nid.naver.com/oauth2.0/token',
    me: 'https://openapi.naver.com/v1/nid/me',
    scope: '', pkce: false,
    profile: d => {
      const r = d.response || {};
      return { id: r.id, name: r.name || r.nickname || '네이버 사용자', email: r.email || null, avatar: r.profile_image || null };
    },
  },
};

const sign = v => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');
const pack = obj => { const v = Buffer.from(JSON.stringify(obj)).toString('base64url'); return v + '.' + sign(v); };
const unpack = s => {
  if (!s || typeof s !== 'string') return null;
  const [v, sig] = s.split('.');
  if (!v || !safeEqual(sig, sign(v))) return null;
  try { return JSON.parse(Buffer.from(v, 'base64url').toString()); } catch { return null; }
};
const safeReturn = r => (typeof r === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(r) ? r : '/');
const redirectUri = p => `${config.appUrl}/auth/${p}/callback`;
const avatarOk = u => (typeof u === 'string' && /^https:\/\/[\w.-]+\.(kakaocdn\.net|googleusercontent\.com|pstatic\.net)\//.test(u) ? u.slice(0, 500) : null);

async function upsertUser(provider, p) {
  if (!p.id) throw new HttpError(400, '계정 정보를 받지 못했어요.');
  const email = p.email ? String(p.email).toLowerCase().slice(0, 200) : null;
  const name = String(p.name || '회원').slice(0, 40);
  const isAdmin = email && config.adminEmails.includes(email);
  const u = await one(
    `INSERT INTO users(provider,provider_id,email,name,avatar_url,role)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (provider,provider_id) DO UPDATE SET
       email=COALESCE(EXCLUDED.email, users.email),
       avatar_url=COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       role=CASE WHEN $7 THEN 'admin' ELSE users.role END
     RETURNING *`,
    [provider, String(p.id), email, name, avatarOk(p.avatar), isAdmin ? 'admin' : 'guest', !!isAdmin]);
  return u;
}

export const authRouter = express.Router();

authRouter.get('/auth/:provider', (req, res) => {
  const p = req.params.provider, P = PROVIDERS[p];
  if (!P || !enabledProviders().includes(p)) return res.redirect('/login?error=provider');
  const state = randomToken(24);
  const verifier = P.pkce ? randomToken(48) : null;
  res.cookie(OST, pack({ s: state, v: verifier, p, r: safeReturn(req.query.next), t: Date.now() }),
    { ...cookieBase, maxAge: 10 * 60e3 });
  const u = new URL(P.auth);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.oauth[p].id);
  u.searchParams.set('redirect_uri', redirectUri(p));
  u.searchParams.set('state', state);
  if (P.scope) u.searchParams.set('scope', P.scope);
  if (verifier) {
    u.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    u.searchParams.set('code_challenge_method', 'S256');
  }
  if (p === 'google') u.searchParams.set('prompt', 'select_account');
  res.redirect(u.toString());
});

authRouter.get('/auth/:provider/callback', wrap(async (req, res) => {
  const p = req.params.provider, P = PROVIDERS[p];
  const st = unpack(req.cookies?.[OST]);
  res.clearCookie(OST, cookieBase);
  if (!P || !st || st.p !== p || Date.now() - st.t > 10 * 60e3 || !safeEqual(st.s, req.query.state) || typeof req.query.code !== 'string')
    return res.redirect('/login?error=state');
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.oauth[p].id,
      redirect_uri: redirectUri(p), code: req.query.code });
    if (config.oauth[p].secret) body.set('client_secret', config.oauth[p].secret);
    if (st.v) body.set('code_verifier', st.v);
    if (p === 'naver') body.set('state', req.query.state);
    const tr = await fetch(P.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(8000) });
    const tok = await tr.json();
    if (!tok.access_token) throw new Error('token: ' + (tok.error || tr.status));
    const mr = await fetch(P.me, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000) });
    const prof = P.profile(await mr.json());
    const user = await upsertUser(p, prof);
    if (user.status !== 'active') return res.redirect('/login?error=suspended');
    await createSession(req, res, user.id);
    req.user = user;
    await audit(req, 'login', user.id, { provider: p });
    res.redirect(st.r || '/');
  } catch (e) {
    console.error('OAuth 실패', p, e.message);
    res.redirect('/login?error=oauth');
  }
}));

/* 데모 로그인: DEMO_LOGIN=true 일 때만 열림 (실서비스에서는 반드시 끄기) */
authRouter.post('/api/auth/demo', csrfGuard, wrap(async (req, res) => {
  if (!config.demoLogin) throw new HttpError(404, '사용할 수 없는 기능이에요.');
  const { role } = parse(z.object({ role: z.enum(['guest', 'host', 'admin']) }), req.body);
  const names = { guest: '데모 게스트', host: '데모 호스트', admin: '데모 관리자' };
  const u = await one(
    `INSERT INTO users(provider,provider_id,name,role,host_agreed_at,phone)
     VALUES ('demo',$1,$2,$1,CASE WHEN $1<>'guest' THEN now() END,CASE WHEN $1<>'guest' THEN '010-0000-0000' END)
     ON CONFLICT (provider,provider_id) DO UPDATE SET status='active' RETURNING *`, [role, names[role]]);
  await createSession(req, res, u.id);
  req.user = u;
  await audit(req, 'login', u.id, { provider: 'demo' });
  res.json({ ok: true });
}));

authRouter.post('/api/auth/logout', csrfGuard, wrap(async (req, res) => {
  if (req.session) await q('DELETE FROM sessions WHERE id=$1', [req.session.id]);
  res.clearCookie(SID, cookieBase);
  res.json({ ok: true });
}));

export const clearSessionCookie = res => res.clearCookie(SID, cookieBase);

export async function endAllSessions(userId) {
  await q('DELETE FROM sessions WHERE user_id=$1', [userId]);
}
