import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const bad = (msg, code) => new HttpError(400, msg, code);

/** async 라우트 오류를 공통 처리기로 넘긴다 */
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const p2 = n => String(n).padStart(2, '0');
/** 한국 시간 기준 오늘 'YYYY-MM-DD' */
export function today() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().slice(0, 10);
}
export function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export function nightsList(a, b) { const out = []; for (let d = a; d < b; d = addDays(d, 1)) out.push(d); return out; }
export function isWeekendNight(s) { const w = new Date(s + 'T00:00:00Z').getUTCDay(); return w === 5 || w === 6; }
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = (v, def = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; };
export const bool = v => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export const normPhone = s => String(s || '').replace(/[^0-9]/g, '');
export function fmtPhone(s) {
  const d = normPhone(s);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith('02') ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}
export const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
export function bookingCode() {
  const d = today().replace(/-/g, '').slice(2);
  return `SO${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
export function csv(rows) {
  return '﻿' + rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
