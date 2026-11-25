// 데이터 저장소 (Node 내장 SQLite 사용 — 별도 DB 서버 불필요)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'promo.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  tagline TEXT DEFAULT '',
  tagline_en TEXT DEFAULT '',
  package TEXT DEFAULT '',
  store_url TEXT DEFAULT '',
  category TEXT DEFAULT '',
  description TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  features TEXT DEFAULT '[]',
  features_en TEXT DEFAULT '[]',
  audience TEXT DEFAULT '',
  keywords TEXT DEFAULT '[]',
  icon_url TEXT DEFAULT '',
  screenshots TEXT DEFAULT '[]',
  price TEXT DEFAULT '무료',
  is_public INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  lang TEXT DEFAULT 'ko',
  target TEXT NOT NULL,
  channel_id INTEGER,
  title TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  remote_url TEXT DEFAULT '',
  error TEXT DEFAULT '',
  link_code TEXT DEFAULT '',
  engine TEXT DEFAULT 'template',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, scheduled_at);
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  day TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_day ON clicks(day);
CREATE TABLE IF NOT EXISTS autopilot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  app_ids TEXT DEFAULT '[]',
  target TEXT NOT NULL,
  channel_id INTEGER,
  kinds TEXT DEFAULT '[]',
  lang TEXT DEFAULT 'ko',
  days TEXT DEFAULT '[1,3,5]',
  time TEXT DEFAULT '09:10',
  enabled INTEGER DEFAULT 1,
  last_run_day TEXT DEFAULT '',
  cursor INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checklist (
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  done_at TEXT,
  PRIMARY KEY (app_id, item_key)
);
`);

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function getSetting(key, fallback = null) {
  const row = getStmt.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
function setSetting(key, value) { setStmt.run(key, JSON.stringify(value)); }

// 한국 시간 기준 날짜·시각
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function kstDay(d = kstNow()) { return d.toISOString().slice(0, 10); }
function kstTime(d = kstNow()) { return d.toISOString().slice(11, 16); }
function nowIso() { return new Date().toISOString(); }

function parseRow(row, jsonFields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of jsonFields) {
    try { out[f] = JSON.parse(out[f] || 'null') ?? []; } catch { out[f] = []; }
  }
  return out;
}
const APP_JSON = ['features', 'features_en', 'keywords', 'screenshots'];
const parseApp = (r) => parseRow(r, APP_JSON);
const parsePost = (r) => parseRow(r, ['tags']);
const parseChannel = (r) => {
  if (!r) return r;
  let config = {};
  try { config = JSON.parse(r.config || '{}'); } catch {}
  return { ...r, config };
};
const parseRule = (r) => parseRow(r, ['app_ids', 'kinds', 'days']);

function newCode() { return crypto.randomBytes(4).toString('base64url').slice(0, 6); }

// 앱+출처별 추적 링크 (같은 조합이면 재사용)
function linkFor(appId, source) {
  const found = db.prepare('SELECT code FROM links WHERE app_id = ? AND source = ?').get(appId, source);
  if (found) return found.code;
  let code = newCode();
  while (db.prepare('SELECT 1 FROM links WHERE code = ?').get(code)) code = newCode();
  db.prepare('INSERT INTO links(code, app_id, source, created_at) VALUES(?,?,?,?)').run(code, appId, source, nowIso());
  return code;
}

module.exports = {
  db, DATA_DIR, getSetting, setSetting, kstNow, kstDay, kstTime, nowIso,
  parseApp, parsePost, parseChannel, parseRule, linkFor,
};
