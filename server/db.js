'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'cctv.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 마이그레이션 실행
function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(__dirname, 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().forEach(f => {
    if (done.has(f)) return;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations VALUES (?, datetime(\'now\'))').run(f); })();
    console.log('[migrate] 적용:', f);
  });
}
migrate();

const uid = () => crypto.randomUUID();
const J = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

// 설계 객체 테이블 정의: 컬럼으로 승격되는 키
const ENT = {
  devices: { cols: ['sheet_id', 'type', 'tag', 'product_id'] },
  cables: { cols: ['sheet_id', 'kind', 'tag', 'product_id', 'from_dev', 'to_dev', 'parent_id'] },
  conduits: { cols: ['sheet_id', 'tag', 'product_id'] },
  annotations: { cols: ['sheet_id', 'type'] }
};

function rowToObj(entity, r) {
  if (!r) return null;
  const o = { id: r.id, ver: r.ver, updated_at: r.updated_at, updated_by: r.updated_by, ...J(r.data) };
  ENT[entity].cols.forEach(c => { if (c === 'from_dev' || c === 'to_dev') return; o[c] = r[c]; });
  return o;
}
function objToCols(entity, o) {
  const cols = {};
  ENT[entity].cols.forEach(c => {
    if (c === 'from_dev') cols[c] = (o.from && o.from.dev) || null;
    else if (c === 'to_dev') cols[c] = (o.to && o.to.dev) || null;
    else cols[c] = o[c] === undefined ? null : o[c];
  });
  const data = { ...o };
  ['id', 'ver', 'updated_at', 'updated_by', 'project_id'].concat(ENT[entity].cols).forEach(k => { if (k !== 'from_dev' && k !== 'to_dev') delete data[k]; });
  return { cols, data: JSON.stringify(data) };
}

function getSetting(key, def) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? J(r.value) : def; }
function setSetting(key, val) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(val)); }

module.exports = { db, uid, J, ENT, rowToObj, objToCols, DATA_DIR, getSetting, setSetting };
