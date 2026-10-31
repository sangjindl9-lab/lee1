// SQLite storage (Node built-in). Money is stored in integer cents.
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'slot.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT);
CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, kind TEXT NOT NULL, subject INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS games(
  id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, min_bet INTEGER, max_bet INTEGER, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rounds(
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), game_id TEXT NOT NULL,
  bet INTEGER NOT NULL, win INTEGER NOT NULL, balance_after INTEGER NOT NULL, feature TEXT, result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS rounds_player ON rounds(player_id, id);
CREATE INDEX IF NOT EXISTS rounds_game ON rounds(game_id, created_at);
CREATE INDEX IF NOT EXISTS rounds_time ON rounds(created_at);
CREATE TABLE IF NOT EXISTS tx(
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), type TEXT NOT NULL,
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, round_id INTEGER, note TEXT, actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS tx_player ON tx(player_id, id);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
module.exports = { db, tx, file };
