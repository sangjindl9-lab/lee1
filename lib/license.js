'use strict';
/**
 * 라이선스 서명 — 이음ERP 의 parseLicense() 와 같은 형식
 *   <base64url(JSON payload)>.<base64url(Ed25519 서명)>
 */
const crypto = require('crypto');

function loadPrivateKey(b64OrPem) {
  if (!b64OrPem) throw new Error('LICENSE_PRIVATE_KEY 가 설정되지 않았습니다');
  const pem = b64OrPem.includes('BEGIN') ? b64OrPem : Buffer.from(b64OrPem, 'base64').toString('utf8');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('LICENSE_PRIVATE_KEY 는 Ed25519 키여야 합니다');
  return key;
}

function publicKeyPem(privateKey) {
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
}

function sign(payload, privateKey) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${sig}`;
}

function verify(text, publicKey) {
  const [body, sig] = String(text).trim().split('.');
  if (!body || !sig) return null;
  const ok = crypto.verify(null, Buffer.from(body), publicKey, Buffer.from(sig, 'base64url'));
  return ok ? JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) : null;
}

// ── 날짜 (모두 한국 시간 기준 YYYY-MM-DD) ──
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 연간 구독: 시작일부터 1년 뒤 전날까지 (2026-11-01 → 2027-10-31) */
function oneYearFrom(ymd, years = 1) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysUntil(ymd) {
  const end = new Date(ymd + 'T23:59:59+09:00').getTime();
  return Math.ceil((end - Date.now()) / 86400000);
}

// ── 사업자등록번호 (국세청 체크섬) ──
const normBiz = (v) => String(v ?? '').replace(/[^0-9]/g, '');
function isValidBiz(v) {
  const n = normBiz(v);
  if (!/^\d{10}$/.test(n)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(n[i]) * w[i];
  sum += Math.floor((Number(n[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(n[9]);
}

/** 설치 코드: SS-XXXX-XXXX-XXXX (헷갈리는 0/O/1/I 제외) */
function activationCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const s = [...bytes].map((b) => A[b % A.length]).join('');
  return `SS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

module.exports = { loadPrivateKey, publicKeyPem, sign, verify, kstToday, addDays, oneYearFrom, daysUntil, normBiz, isValidBiz, activationCode };
