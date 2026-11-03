// SQLite(관계형) 저장소. node:sqlite 내장 모듈 사용 — 별도 DB 서버 없이 볼륨 1개로 운영·백업
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const FILE_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILE_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'jindan.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, biz_no TEXT,
  logo_file INTEGER, quote_valid_days INTEGER DEFAULT 30, plan_until TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, name TEXT,
  role TEXT NOT NULL CHECK(role IN ('user','contractor','reviewer','admin')), company_id INTEGER REFERENCES companies(id),
  plan_until TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL, address TEXT, info TEXT NOT NULL DEFAULT '{}', assumptions TEXT NOT NULL DEFAULT '{}',
  ai_consent INTEGER DEFAULT 0, ai_consent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_shares (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id), consent_by INTEGER, consent_at TEXT DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE, owner_id INTEGER,
  kind TEXT, name TEXT, mime TEXT, size INTEGER, path TEXT NOT NULL, width INTEGER, height INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, file_id INTEGER,
  data TEXT NOT NULL DEFAULT '{}', confirmed INTEGER DEFAULT 0, confirmed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}', file_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS panels (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}', qr_token TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS circuits (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  panel_id INTEGER REFERENCES panels(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS measurements (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS extractions (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL, target TEXT NOT NULL, target_id INTEGER, provider TEXT, status TEXT NOT NULL, raw TEXT, fields TEXT, findings TEXT,
  error TEXT, applied_by INTEGER, applied_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, opinion TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quotes (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, company_id INTEGER,
  items TEXT NOT NULL DEFAULT '[]', kepco_req TEXT NOT NULL DEFAULT '{}', tariff_req TEXT NOT NULL DEFAULT '{}', confirmed INTEGER DEFAULT 0,
  created_by INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_by INTEGER, kind TEXT DEFAULT 'basic', snapshot TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS share_links (token TEXT PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_by INTEGER, views INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS consults (id INTEGER PRIMARY KEY, site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE, user_id INTEGER,
  company_id INTEGER, message TEXT, phone TEXT, status TEXT DEFAULT '접수', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, file_id INTEGER, amount INTEGER, note TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rates_kepco (id INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rates_tariff (id INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS unit_prices (id INTEGER PRIMARY KEY, company_id INTEGER, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS standards (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS device_refs (id INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, entity TEXT, entity_id INTEGER, site_id INTEGER, action TEXT,
  before TEXT, after TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_audit_site ON audit(site_id);
`);

export const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

export function audit(userId, entity, entityId, siteId, action, before, after) {
  run('INSERT INTO audit (user_id, entity, entity_id, site_id, action, before, after) VALUES (?,?,?,?,?,?,?)',
    userId ?? null, entity, entityId ?? null, siteId ?? null, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
}

export function getSetting(key, def = null) { const r = get('SELECT value FROM settings WHERE key=?', key); return r ? J(r.value, def) : def; }
export function setSetting(key, value) { run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }

// 비밀번호: scrypt
export function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
export function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':'); if (!salt || !h) return false;
  const a = crypto.scryptSync(pw, salt, 32); const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 최초 관리자: 환경변수 ADMIN_EMAIL / ADMIN_PASSWORD
export function ensureAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  if (!get('SELECT id FROM users WHERE email=?', ADMIN_EMAIL)) {
    run('INSERT INTO users (email, pw, name, role) VALUES (?,?,?,?)', ADMIN_EMAIL, hashPw(ADMIN_PASSWORD), '관리자', 'admin');
    console.log('관리자 계정 생성:', ADMIN_EMAIL);
  }
}
