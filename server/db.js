// 저장소: DATABASE_URL이 있으면 PostgreSQL, 없으면 JSON 파일(DATA_DIR, 기본 ./data).
// 테이블 이름은 gj_ 로 시작해 같은 DB를 다른 프로그램과 함께 써도 겹치지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export async function openDb() {
  if (process.env.DATABASE_URL) return openPg(process.env.DATABASE_URL);
  return openFile(process.env.DATA_DIR || path.resolve('data'));
}

// ───────────────────────── PostgreSQL ─────────────────────────
async function openPg(url) {
  const { default: pg } = await import('pg');
  const local = /localhost|127\.0\.0\.1/.test(url) || !/\./.test(new URL(url).hostname);
  const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gj_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at DATE,
      max_ips INT NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gj_users_lower_name ON gj_users (lower(username));
    CREATE TABLE IF NOT EXISTS gj_user_ips (
      user_id INT NOT NULL REFERENCES gj_users(id) ON DELETE CASCADE,
      ip TEXT NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, ip)
    );
    CREATE TABLE IF NOT EXISTS gj_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES gj_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS gj_projects (
      user_id INT NOT NULL REFERENCES gj_users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, id)
    );
  `);
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const userCols = `id, username, pass_hash, name, company, phone, memo, active, to_char(expires_at,'YYYY-MM-DD') AS expires_at, max_ips, created_at, last_login`;
  return {
    kind: 'postgres',
    async getUserByName(username) {
      return (await q(`SELECT ${userCols} FROM gj_users WHERE lower(username)=lower($1)`, [username]))[0] || null;
    },
    async getUser(id) {
      return (await q(`SELECT ${userCols} FROM gj_users WHERE id=$1`, [id]))[0] || null;
    },
    async listUsers() {
      const users = await q(`SELECT ${userCols}, (SELECT count(*)::int FROM gj_projects p WHERE p.user_id=u.id) AS project_count FROM gj_users u ORDER BY id DESC`);
      const ips = await q(`SELECT user_id, ip, first_seen, last_seen FROM gj_user_ips ORDER BY first_seen`);
      return users.map((u) => ({ ...u, ips: ips.filter((i) => i.user_id === u.id) }));
    },
    async createUser(u) {
      return (
        await q(
          `INSERT INTO gj_users (username, pass_hash, name, company, phone, memo, expires_at, max_ips) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [u.username, u.pass_hash, u.name, u.company, u.phone, u.memo, u.expires_at || null, u.max_ips],
        )
      )[0].id;
    },
    async updateUser(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return;
      const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
      await q(`UPDATE gj_users SET ${sets} WHERE id=$1`, [id, ...keys.map((k) => (k === 'expires_at' ? patch[k] || null : patch[k]))]);
    },
    async deleteUser(id) {
      await q(`DELETE FROM gj_users WHERE id=$1`, [id]);
    },
    async listIps(userId) {
      return q(`SELECT ip, first_seen, last_seen FROM gj_user_ips WHERE user_id=$1 ORDER BY first_seen`, [userId]);
    },
    async addIp(userId, ip) {
      await q(`INSERT INTO gj_user_ips (user_id, ip) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, ip]);
    },
    async touchIp(userId, ip) {
      await q(`UPDATE gj_user_ips SET last_seen=now() WHERE user_id=$1 AND ip=$2`, [userId, ip]);
    },
    async removeIps(userId, ip) {
      if (ip) await q(`DELETE FROM gj_user_ips WHERE user_id=$1 AND ip=$2`, [userId, ip]);
      else await q(`DELETE FROM gj_user_ips WHERE user_id=$1`, [userId]);
    },
    async createSession(tokenHash, userId) {
      await q(`INSERT INTO gj_sessions (token_hash, user_id) VALUES ($1,$2)`, [tokenHash, userId]);
    },
    async getSession(tokenHash) {
      return (await q(`SELECT token_hash, user_id, created_at, last_seen FROM gj_sessions WHERE token_hash=$1`, [tokenHash]))[0] || null;
    },
    async touchSession(tokenHash) {
      await q(`UPDATE gj_sessions SET last_seen=now() WHERE token_hash=$1`, [tokenHash]);
    },
    async deleteSession(tokenHash) {
      await q(`DELETE FROM gj_sessions WHERE token_hash=$1`, [tokenHash]);
    },
    async deleteUserSessions(userId) {
      await q(`DELETE FROM gj_sessions WHERE user_id=$1`, [userId]);
    },
    async listProjects(userId) {
      return (await q(`SELECT data FROM gj_projects WHERE user_id=$1`, [userId])).map((r) => r.data);
    },
    async saveProject(userId, id, data) {
      await q(
        `INSERT INTO gj_projects (user_id, id, data, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (user_id, id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
        [userId, id, data],
      );
    },
    async deleteProject(userId, id) {
      await q(`DELETE FROM gj_projects WHERE user_id=$1 AND id=$2`, [userId, id]);
    },
    async close() {
      await pool.end();
    },
  };
}

// ───────────────────────── JSON 파일 ─────────────────────────
async function openFile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gongjung-db.json');
  let state = { seq: 0, users: [], ips: [], sessions: [], projects: [] };
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    }, 50);
  };
  const now = () => new Date().toISOString();
  const pub = (u) => (u ? { ...u } : null);
  return {
    kind: 'file',
    async getUserByName(username) {
      return pub(state.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()));
    },
    async getUser(id) {
      return pub(state.users.find((u) => u.id === id));
    },
    async listUsers() {
      return [...state.users]
        .sort((a, b) => b.id - a.id)
        .map((u) => ({ ...u, project_count: state.projects.filter((p) => p.user_id === u.id).length, ips: state.ips.filter((i) => i.user_id === u.id) }));
    },
    async createUser(u) {
      if (state.users.some((x) => x.username.toLowerCase() === u.username.toLowerCase())) {
        const e = new Error('duplicate');
        e.code = '23505';
        throw e;
      }
      const id = ++state.seq;
      state.users.push({ id, active: true, created_at: now(), last_login: null, ...u, expires_at: u.expires_at || null });
      persist();
      return id;
    },
    async updateUser(id, patch) {
      const u = state.users.find((x) => x.id === id);
      if (u) Object.assign(u, patch);
      persist();
    },
    async deleteUser(id) {
      state.users = state.users.filter((u) => u.id !== id);
      state.ips = state.ips.filter((x) => x.user_id !== id);
      state.sessions = state.sessions.filter((x) => x.user_id !== id);
      state.projects = state.projects.filter((x) => x.user_id !== id);
      persist();
    },
    async listIps(userId) {
      return state.ips.filter((i) => i.user_id === userId);
    },
    async addIp(userId, ip) {
      if (!state.ips.some((i) => i.user_id === userId && i.ip === ip)) state.ips.push({ user_id: userId, ip, first_seen: now(), last_seen: now() });
      persist();
    },
    async touchIp(userId, ip) {
      const r = state.ips.find((i) => i.user_id === userId && i.ip === ip);
      if (r) r.last_seen = now();
      persist();
    },
    async removeIps(userId, ip) {
      state.ips = state.ips.filter((i) => !(i.user_id === userId && (!ip || i.ip === ip)));
      persist();
    },
    async createSession(tokenHash, userId) {
      state.sessions.push({ token_hash: tokenHash, user_id: userId, created_at: now(), last_seen: now() });
      persist();
    },
    async getSession(tokenHash) {
      return state.sessions.find((s) => s.token_hash === tokenHash) || null;
    },
    async touchSession(tokenHash) {
      const s = state.sessions.find((x) => x.token_hash === tokenHash);
      if (s) s.last_seen = now();
      persist();
    },
    async deleteSession(tokenHash) {
      state.sessions = state.sessions.filter((s) => s.token_hash !== tokenHash);
      persist();
    },
    async deleteUserSessions(userId) {
      state.sessions = state.sessions.filter((s) => s.user_id !== userId);
      persist();
    },
    async listProjects(userId) {
      return state.projects.filter((p) => p.user_id === userId).map((p) => p.data);
    },
    async saveProject(userId, id, data) {
      const r = state.projects.find((p) => p.user_id === userId && p.id === id);
      if (r) Object.assign(r, { data, updated_at: now() });
      else state.projects.push({ user_id: userId, id, data, updated_at: now() });
      persist();
    },
    async deleteProject(userId, id) {
      state.projects = state.projects.filter((p) => !(p.user_id === userId && p.id === id));
      persist();
    },
    async close() {
      clearTimeout(timer);
      fs.writeFileSync(file, JSON.stringify(state));
    },
  };
}
