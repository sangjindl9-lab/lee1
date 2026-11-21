import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { tx } from './db.js';
import { sendMail } from './mail.js';

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_DAYS = 60;

export interface AuthUser { userId: string; deviceId: string }

export function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET (32+ chars) is required');
  return new TextEncoder().encode(s);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function issueTokens(db: Db, userId: string, deviceId: string) {
  const access = await new SignJWT({ dev: deviceId }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${ACCESS_TTL_SEC}s`).sign(secret());
  const refresh = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO refresh_tokens(user_id, device_id, token_hash, expires_at) VALUES($1,$2,$3, now() + interval '${REFRESH_TTL_DAYS} days')`,
    [userId, deviceId, sha256(refresh)]);
  return { accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL_SEC };
}

/** Authorization: Bearer <access> 검증. 실패 시 401. */
export async function requireUser(req: FastifyRequest): Promise<AuthUser> {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw httpError(401, 'unauthorized');
  try {
    const { payload } = await jwtVerify(h.slice(7), secret(), { algorithms: ['HS256'] });
    return { userId: String(payload.sub), deviceId: String(payload.dev) };
  } catch {
    throw httpError(401, 'token_expired');
  }
}

export function httpError(status: number, code: string) {
  const e = new Error(code) as Error & { statusCode: number };
  e.statusCode = status;
  return e;
}

const emailOk = (e: unknown): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;

async function upsertDevice(db: Db, userId: string, deviceId: unknown, platform: unknown, model: unknown, appVersion: unknown) {
  if (typeof deviceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(deviceId)) throw httpError(400, 'bad_device_id');
  const p = ['android', 'ios', 'windows', 'web', 'macos', 'linux', 'eink'].includes(String(platform)) ? String(platform) : 'android';
  const ex = await db.query('SELECT user_id FROM user_devices WHERE id=$1', [deviceId]);
  if (ex.rows.length && ex.rows[0].user_id !== userId) {
    // 같은 기기에서 다른 계정으로 로그인: 기기 ID가 계정마다 달라야 하므로 거부(앱이 새 기기 ID를 만든다)
    throw httpError(409, 'device_belongs_to_other_account');
  }
  await db.query(`INSERT INTO user_devices(id, user_id, platform, model, app_version, last_seen_at) VALUES($1,$2,$3,$4,$5, now())
    ON CONFLICT (id) DO UPDATE SET model=EXCLUDED.model, app_version=EXCLUDED.app_version, last_seen_at=now(), deleted_at=NULL, updated_at=now()`,
    [deviceId, userId, p, String(model ?? '').slice(0, 100), String(appVersion ?? '').slice(0, 40)]);
}

async function audit(db: Db, actorId: string | null, action: string, req: FastifyRequest, detail?: object) {
  await db.query('INSERT INTO audit_logs(actor_type, actor_id, action, ip, user_agent, detail) VALUES($1,$2,$3,$4,$5,$6)',
    ['user', actorId, action, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 200), detail ?? null]);
}

async function makeEmailToken(db: Db, userId: string, purpose: 'verify' | 'reset') {
  const t = randomBytes(24).toString('base64url');
  await db.query(`INSERT INTO email_tokens(user_id, purpose, token_hash, expires_at) VALUES($1,$2,$3, now() + interval '1 day')`, [userId, purpose, sha256(t)]);
  return t;
}

// 로그인 실패 제한(메모리, 서버 1대 기준. 여러 대면 Redis로 교체)
const failures = new Map<string, { n: number; until: number }>();
function checkLock(key: string) { const f = failures.get(key); if (f && f.until > Date.now()) throw httpError(429, 'too_many_attempts'); }
function fail(key: string) { const f = failures.get(key) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 10 * 60_000; f.n = 0; } failures.set(key, f); }

export function authRoutes(app: FastifyInstance, db: Db) {
  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:8080';

  app.post('/v1/auth/signup', async (req, reply) => {
    const b = req.body as any;
    if (!emailOk(b?.email)) throw httpError(400, 'bad_email');
    if (typeof b?.password !== 'string' || b.password.length < 8 || b.password.length > 200) throw httpError(400, 'weak_password');
    const email = b.email.trim().toLowerCase();
    const hash = await bcrypt.hash(b.password, 12);
    const r = await db.query(`INSERT INTO users(email, password_hash, locale, country) VALUES($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, hash, String(b.locale ?? 'ko').slice(0, 10), b.country ? String(b.country).slice(0, 2).toUpperCase() : null]);
    if (!r.rows.length) throw httpError(409, 'email_taken');
    const userId = r.rows[0].id;
    await upsertDevice(db, userId, b.deviceId, b.platform, b.model, b.appVersion);
    const t = await makeEmailToken(db, userId, 'verify');
    const mailed = await sendMail(email, 'NotePro email verification', `${publicUrl}/v1/auth/verify?token=${t}`);
    await audit(db, userId, 'signup', req);
    reply.code(201);
    return { userId, verificationMailSent: mailed, ...(await issueTokens(db, userId, b.deviceId)) };
  });

  app.get('/v1/auth/verify', async (req, reply) => {
    const t = String((req.query as any).token ?? '');
    const r = await db.query(`UPDATE email_tokens SET used_at=now() WHERE token_hash=$1 AND purpose='verify' AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [sha256(t)]);
    if (!r.rows.length) { reply.code(400).type('text/html'); return '<p>Link expired / 링크가 만료되었습니다.</p>'; }
    await db.query('UPDATE users SET email_verified_at=now(), updated_at=now() WHERE id=$1', [r.rows[0].user_id]);
    reply.type('text/html'); return '<p>Email verified. 이메일 인증이 완료되었습니다. 앱으로 돌아가세요.</p>';
  });

  app.post('/v1/auth/login', async (req) => {
    const b = req.body as any;
    if (!emailOk(b?.email) || typeof b?.password !== 'string') throw httpError(400, 'bad_request');
    const email = b.email.trim().toLowerCase();
    const key = `${email}|${req.ip}`;
    checkLock(key);
    const r = await db.query('SELECT id, password_hash FROM users WHERE email=$1 AND deleted_at IS NULL', [email]);
    const ok = r.rows.length && r.rows[0].password_hash && await bcrypt.compare(b.password, r.rows[0].password_hash);
    if (!ok) { fail(key); await audit(db, r.rows[0]?.id ?? null, 'login_failed', req); throw httpError(401, 'invalid_credentials'); }
    failures.delete(key);
    const userId = r.rows[0].id;
    await upsertDevice(db, userId, b.deviceId, b.platform, b.model, b.appVersion);
    await audit(db, userId, 'login', req, { deviceId: b.deviceId });
    return { userId, ...(await issueTokens(db, userId, b.deviceId)) };
  });

  /** Google / Apple ID 토큰 로그인. 클라이언트 ID 환경변수가 없으면 503. */
  app.post('/v1/auth/oauth', async (req) => {
    const b = req.body as any;
    const provider = b?.provider === 'apple' ? 'apple' : 'google';
    const aud = provider === 'google' ? process.env.GOOGLE_CLIENT_IDS : process.env.APPLE_CLIENT_IDS;
    if (!aud) throw httpError(503, `${provider}_login_not_configured`);
    const jwks = createRemoteJWKSet(new URL(provider === 'google' ? 'https://www.googleapis.com/oauth2/v3/certs' : 'https://appleid.apple.com/auth/keys'));
    let payload: any;
    try {
      ({ payload } = await jwtVerify(String(b.idToken ?? ''), jwks, {
        issuer: provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com',
        audience: aud.split(','),
      }));
    } catch { throw httpError(401, 'invalid_id_token'); }
    const col = provider === 'google' ? 'google_sub' : 'apple_sub';
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    let userId: string;
    const found = await db.query(`SELECT id FROM users WHERE ${col}=$1 AND deleted_at IS NULL`, [payload.sub]);
    if (found.rows.length) userId = found.rows[0].id;
    else if (email && payload.email_verified !== false && (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows.length) {
      userId = (await db.query(`UPDATE users SET ${col}=$1, updated_at=now() WHERE email=$2 RETURNING id`, [payload.sub, email])).rows[0].id;
    } else {
      userId = (await db.query(`INSERT INTO users(email, email_verified_at, ${col}) VALUES($1, now(), $2) RETURNING id`, [email, payload.sub])).rows[0].id;
    }
    await upsertDevice(db, userId, b.deviceId, b.platform, b.model, b.appVersion);
    await audit(db, userId, `login_${provider}`, req);
    return { userId, ...(await issueTokens(db, userId, b.deviceId)) };
  });

  /** 리프레시 토큰 회전: 한 번 쓴 토큰은 폐기, 재사용이 감지되면 그 기기 세션 전체 폐기(탈취 대응). */
  app.post('/v1/auth/refresh', async (req) => {
    const t = String((req.body as any)?.refreshToken ?? '');
    const r = await db.query('SELECT id, user_id, device_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash=$1', [sha256(t)]);
    const row = r.rows[0];
    if (!row) throw httpError(401, 'invalid_refresh');
    if (row.revoked_at) {
      await db.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL', [row.user_id, row.device_id]);
      throw httpError(401, 'refresh_reused');
    }
    if (new Date(row.expires_at) < new Date()) throw httpError(401, 'session_expired');
    const dev = await db.query('SELECT deleted_at FROM user_devices WHERE id=$1', [row.device_id]);
    if (!dev.rows.length || dev.rows[0].deleted_at) throw httpError(401, 'device_revoked');
    await db.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [row.id]);
    return issueTokens(db, row.user_id, row.device_id);
  });

  app.post('/v1/auth/logout', async (req) => {
    const u = await requireUser(req);
    await db.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL', [u.userId, u.deviceId]);
    return { ok: true };
  });

  app.post('/v1/auth/password-reset/request', async (req) => {
    const email = String((req.body as any)?.email ?? '').trim().toLowerCase();
    const r = await db.query('SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL', [email]);
    if (r.rows.length) {
      const t = await makeEmailToken(db, r.rows[0].id, 'reset');
      await sendMail(email, 'NotePro password reset', `Reset code: ${t}\n(${publicUrl})`);
    }
    return { ok: true }; // 가입 여부를 노출하지 않음
  });

  app.post('/v1/auth/password-reset/confirm', async (req) => {
    const b = req.body as any;
    if (typeof b?.password !== 'string' || b.password.length < 8) throw httpError(400, 'weak_password');
    const r = await db.query(`UPDATE email_tokens SET used_at=now() WHERE token_hash=$1 AND purpose='reset' AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [sha256(String(b.token ?? ''))]);
    if (!r.rows.length) throw httpError(400, 'invalid_token');
    const uid = r.rows[0].user_id;
    await db.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [await bcrypt.hash(b.password, 12), uid]);
    await db.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [uid]); // 모든 기기 재로그인
    await audit(db, uid, 'password_reset', req);
    return { ok: true };
  });

  // ---- 로그인 기기 관리 ----
  app.get('/v1/devices', async (req) => {
    const u = await requireUser(req);
    const r = await db.query(`SELECT d.id, d.platform, d.model, d.app_version, d.last_seen_at, d.last_sync_seq,
      (SELECT max(created_at) FROM sync_operations s WHERE s.device_id=d.id) AS last_push_at
      FROM user_devices d WHERE d.user_id=$1 AND d.deleted_at IS NULL ORDER BY d.last_seen_at DESC NULLS LAST`, [u.userId]);
    return { current: u.deviceId, devices: r.rows };
  });

  app.delete('/v1/devices/:id', async (req) => {
    const u = await requireUser(req);
    const id = (req.params as any).id;
    await db.query('UPDATE user_devices SET deleted_at=now() WHERE id=$1 AND user_id=$2', [id, u.userId]);
    await db.query('UPDATE refresh_tokens SET revoked_at=now() WHERE device_id=$1 AND user_id=$2 AND revoked_at IS NULL', [id, u.userId]);
    await audit(db, u.userId, 'device_revoke', req, { id });
    return { ok: true };
  });

  // ---- 계정 ----
  app.get('/v1/account', async (req) => {
    const u = await requireUser(req);
    const r = await db.query('SELECT id, email, email_verified_at, locale, country, storage_quota_bytes, storage_used_bytes, created_at FROM users WHERE id=$1', [u.userId]);
    return r.rows[0];
  });

  /** 계정 삭제: 즉시 로그인 차단, 30일 뒤 정리 작업이 데이터 영구 삭제(그 전에 내보내기 가능). */
  app.delete('/v1/account', async (req) => {
    const u = await requireUser(req);
    await tx(db, async (c) => {
      await c.query('UPDATE users SET deleted_at=now(), email=NULL, google_sub=NULL, apple_sub=NULL, password_hash=NULL, updated_at=now() WHERE id=$1', [u.userId]);
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.userId]);
    });
    await audit(db, u.userId, 'account_delete', req);
    return { ok: true, purgeAfterDays: 30 };
  });

  /** 데이터 내보내기(개인정보 이동권): 계정·노트 메타·페이지·획(JSON). 첨부는 /v1/files 로 내려받기. */
  app.get('/v1/account/export', async (req, reply) => {
    const u = await requireUser(req);
    const nbs = (await db.query('SELECT * FROM notebooks WHERE user_id=$1', [u.userId])).rows;
    const ids = nbs.map((n) => n.id);
    const pages = ids.length ? (await db.query('SELECT * FROM pages WHERE notebook_id = ANY($1)', [ids])).rows : [];
    const strokes = ids.length ? (await db.query(`SELECT id,page_id,notebook_id,pen,color,width,opacity,shape,encode(points,'base64') AS points,created_at,updated_at,deleted_at FROM pen_strokes WHERE notebook_id = ANY($1)`, [ids])).rows : [];
    const account = (await db.query('SELECT id,email,locale,country,created_at FROM users WHERE id=$1', [u.userId])).rows[0];
    const attachments = (await db.query('SELECT id,notebook_id,file_name,mime,size,sha256 FROM attachments WHERE user_id=$1', [u.userId])).rows;
    await audit(db, u.userId, 'data_export', req);
    reply.header('content-disposition', 'attachment; filename="notepro-export.json"');
    return { format: 'notepro-export-1', exportedAt: new Date().toISOString(), account, notebooks: nbs, pages, strokes, attachments };
  });
}

export const newId = () => randomUUID();
