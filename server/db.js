const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  const dir = path.join(__dirname, '..', 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(f);
    })();
    console.log('[migrate] applied', f);
  }
}

function audit(req, action, entity, entityId, detail, siteId) {
  db.prepare('INSERT INTO audit_logs(user_id, site_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
    .run(req?.user?.id ?? null, siteId ?? null, action, entity, entityId ?? null, detail ? JSON.stringify(detail) : null);
}

module.exports = { db, migrate, audit };
