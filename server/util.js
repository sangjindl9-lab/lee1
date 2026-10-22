import crypto from 'node:crypto';
import { q } from './db.js';

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const notFound = (msg = '찾을 수 없어요.') => new HttpError(404, msg);
export const forbidden = (msg = '권한이 없어요.') => new HttpError(403, msg);

// async 라우트 에러를 에러 핸들러로 넘김
export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// zod 스키마로 검증, 실패하면 400
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw bad(i?.message && !i.message.startsWith('Expected') && !i.message.startsWith('Invalid') && !i.message.startsWith('Required')
      ? i.message : `입력값을 확인해 주세요 (${i?.path?.join('.') || '요청'}).`, 'VALIDATION');
  }
  return r.data;
}

export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 한국 시간 기준 오늘 날짜 'YYYY-MM-DD'
export function todayKST(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

export function bookingCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = 'MM';
  for (const x of b) s += A[x % A.length];
  return s;
}

export async function audit(req, action, target, meta = {}) {
  try {
    await q('INSERT INTO audit_logs(actor_id, action, target, meta, ip) VALUES ($1,$2,$3,$4,$5)',
      [req.user?.id || null, action, target == null ? null : String(target), meta, req.ip]);
  } catch (e) { console.error('audit 실패', e.message); }
}

// 이름·연락처 등 화면 노출용 마스킹
export const maskPhone = p => (p ? p.replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, '$1-****-$3') : null);
