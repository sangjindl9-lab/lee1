'use strict';
const crypto = require('crypto');
const { db } = require('./db');

function hash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verify(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const TTL = { player: 12 * 3600e3, admin: 8 * 3600e3 };
function createSession(kind, subject) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,kind,subject,expires) VALUES(?,?,?,?)').run(token, kind, subject, Date.now() + TTL[kind]);
  return token;
}
function readSession(token, kind) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=? AND kind=?').get(token, kind);
  if (!s) return null;
  if (s.expires < Date.now()) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null; }
  return s;
}
function destroy(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, name, val, maxAgeMs, secure) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`);
}
module.exports = { hash, verify, createSession, readSession, destroy, cookies, setCookie, TTL };
