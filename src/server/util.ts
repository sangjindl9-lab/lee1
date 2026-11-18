import crypto from 'node:crypto';
import { config } from './config.ts';
import { db, one } from './db.ts';
import type { Q } from './db.ts';

export class AppError extends Error {
  status: number; code: string;
  constructor(message: string, status = 400, code = '') { super(message); this.status = status; this.code = code; }
}
export const won = (n: any) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const dtf = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const dt = (d: any) => (d ? dtf.format(new Date(d)) : '-');
export const lines = (s: any) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
export const str = (v: any, max = 5000) => String(v ?? '').trim().slice(0, max);
export const int = (v: any, min: number, max: number, name: string) => {
  const n = Number(String(v ?? '').replace(/[,\s원]/g, ''));
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${name} 값이 올바르지 않습니다`);
  return n;
};

export const randomId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
}
export const hmac = (data: string, key = config.sessionSecret) => crypto.createHmac('sha256', key).update(data).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function signToken(obj: any) { const body = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${body}.${hmac(body)}`; }
export function readToken(token: string) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp && o.exp < Date.now() ? null : o; } catch { return null; }
}
const master = () => Buffer.from(config.fileMasterKey, 'hex');
export function wrapKey(key: Buffer) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', master(), iv);
  const enc = Buffer.concat([c.update(key), c.final()]);
  return [iv, enc, c.getAuthTag()].map((b) => b.toString('hex')).join('.');
}
export function unwrapKey(wrapped: string) {
  const [iv, enc, tag] = wrapped.split('.').map((h) => Buffer.from(h, 'hex'));
  const d = crypto.createDecipheriv('aes-256-gcm', master(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
export const encryptText = (s: string) => wrapKey(Buffer.from(String(s), 'utf8'));
export const decryptText = (w: string) => unwrapKey(w).toString('utf8');

export interface User { id: number; email: string; name: string; operator_role: string | null; status: string }
export const hasRole = (u: User | null, ...roles: string[]) => !!u?.operator_role && (u.operator_role === 'super' || roles.includes(u.operator_role));
export function needRole(u: User | null, ...roles: string[]) { if (!hasRole(u, ...roles)) throw new AppError('권한이 없습니다', 403); }

export async function audit(q: Q | null, actor: User | null, action: string, targetType = '', targetId: any = '', detail = '') {
  await (q || db).query('INSERT INTO audit_logs(actor_id, actor_role, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor?.id ?? null, actor ? actor.operator_role || 'user' : 'system', action, targetType, String(targetId ?? ''), String(detail).slice(0, 2000)]);
}
export async function notify(q: Q | null, userId: number, body: string, link = '') {
  await (q || db).query('INSERT INTO notifications(user_id, body, link) VALUES ($1,$2,$3)', [userId, body, link]);
}
export async function getSetting(key: string, fallback = '') { const r = await one(db, 'SELECT value FROM settings WHERE key=$1', [key]); return r ? r.value : fallback; }
export async function setSetting(key: string, value: string, by?: User) {
  await db.query('INSERT INTO settings(key,value,updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()', [key, String(value), by?.id ?? null]);
}
