// 저장소: SQLite(node:sqlite) + 장비 비밀번호 암호화
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const SNAP_DIR = path.join(DATA_DIR, 'snaps');
fs.mkdirSync(SNAP_DIR, { recursive: true });

const keyFile = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
export const SECRET = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');

export const db = new DatabaseSync(path.join(DATA_DIR, 'siteview.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
    http_port INTEGER DEFAULT 80, rtsp_port INTEGER DEFAULT 554, https INTEGER DEFAULT 0,
    username TEXT NOT NULL, pass_enc TEXT NOT NULL,
    kind TEXT, model TEXT, serial TEXT, firmware TEXT, mac TEXT,
    channels TEXT DEFAULT '[]', sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, device_id INTEGER, channel INTEGER, type TEXT, description TEXT,
    time TEXT, snap TEXT, is_read INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS events_time ON events(time DESC);
`);

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(s) {
  const [iv, tag, enc] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', SECRET, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}

export function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

export function rowToDevice(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, host: r.host, httpPort: r.http_port, rtspPort: r.rtsp_port,
    https: !!r.https, username: r.username, kind: r.kind, model: r.model, serial: r.serial,
    firmware: r.firmware, mac: r.mac, channels: JSON.parse(r.channels || '[]'), createdAt: r.created_at,
  };
}

export const devices = {
  all: () => db.prepare('SELECT * FROM devices ORDER BY sort, id').all().map(rowToDevice),
  get: (id) => rowToDevice(db.prepare('SELECT * FROM devices WHERE id = ?').get(id)),
  password: (id) => decrypt(db.prepare('SELECT pass_enc FROM devices WHERE id = ?').get(id).pass_enc),
};
