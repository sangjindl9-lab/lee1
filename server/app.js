// 예정공정표 회원제 서버 — 관리자가 발급한 아이디로만 사용, 회원별 데이터 분리, 회원당 접속 IP 최대 N개(기본 3)
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const USER_COOKIE = 'gj_s';
const ADMIN_COOKIE = 'gj_a';
const SESSION_DAYS = 30;
const ADMIN_HOURS = 12;

// ───────── 비밀번호 (scrypt) ─────────
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [v, s, k] = String(stored || '').split('$');
  if (v !== 's1' || !s || !k) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 32);
  const want = Buffer.from(k, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const eq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 접속 IP — Render(Cloudflare 경유)는 CF-Connecting-IP/True-Client-IP를 덮어써서 넘겨주므로 이를 우선 사용 */
export function clientIp(req) {
  const h = (k) => String(req.headers[k] || '').split(',')[0].trim();
  let ip = h('cf-connecting-ip') || h('true-client-ip') || h('x-forwarded-for') || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

/** 오늘 날짜(KST) YYYY-MM-DD */
function todayKST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

export function createApp(db, opts = {}) {
  const ADMIN_ID = opts.adminId ?? process.env.ADMIN_ID ?? 'admin';
  const ADMIN_PASSWORD = opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';
  const SECRET = opts.secret ?? process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');
  const secureCookie = opts.secureCookie ?? process.env.NODE_ENV === 'production';
  const staticDir = opts.staticDir;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const setCookie = (res, name, value, maxAgeSec) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secureCookie) parts.push('Secure');
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), parts.join('; ')]);
  };

  // ───────── 로그인 시도 제한 (IP+아이디 기준 15분에 10회) ─────────
  const fails = new Map();
  const limited = (key) => {
    const r = fails.get(key);
    return r && r.count >= 10 && Date.now() - r.first < 15 * 60e3;
  };
  const fail = (key) => {
    const r = fails.get(key);
    if (!r || Date.now() - r.first > 15 * 60e3) fails.set(key, { count: 1, first: Date.now() });
    else r.count++;
  };

  const accountProblem = (u) => {
    if (!u.active) return { code: 'disabled', message: '사용이 중지된 아이디입니다. 관리자에게 문의하세요.' };
    if (u.expires_at && u.expires_at < todayKST()) return { code: 'expired', message: `사용 기간이 ${u.expires_at}에 끝났습니다. 관리자에게 연장을 요청하세요.` };
    return null;
  };

  const ipState = async (u, ip) => {
    const ips = await db.listIps(u.id);
    const registered = ips.some((r) => r.ip === ip);
    const status = registered ? 'ok' : ips.length < u.max_ips ? 'register' : 'full';
    return { status, ip, used: ips.length, max: u.max_ips, ips: ips.map((r) => ({ ip: r.ip, first_seen: r.first_seen, last_seen: r.last_seen, current: r.ip === ip })) };
  };

  const meBody = async (u, ip) => ({
    user: { id: u.id, username: u.username, name: u.name, company: u.company, expires_at: u.expires_at },
    ipState: await ipState(u, ip),
  });

  // 회원 세션 확인 (requireIp: 등록된 IP에서만 허용)
  const auth = (requireIp) => async (req, res, next) => {
    try {
      const token = parseCookies(req)[USER_COOKIE];
      if (!token) return res.status(401).json({ code: 'login', message: '로그인이 필요합니다.' });
      const s = await db.getSession(sha(token));
      if (!s || Date.now() - new Date(s.created_at).getTime() > SESSION_DAYS * 864e5) return res.status(401).json({ code: 'login', message: '다시 로그인하세요.' });
      const u = await db.getUser(s.user_id);
      if (!u) return res.status(401).json({ code: 'login', message: '다시 로그인하세요.' });
      const bad = accountProblem(u);
      if (bad) return res.status(403).json(bad);
      req.user = u;
      req.ip2 = clientIp(req);
      req.tokenHash = sha(token);
      if (requireIp) {
        const st = await ipState(u, req.ip2);
        if (st.status !== 'ok') return res.status(403).json({ code: 'ip', message: '등록되지 않은 장소(IP)입니다.', ipState: st });
        db.touchIp(u.id, req.ip2).catch(() => {});
      }
      db.touchSession(req.tokenHash).catch(() => {});
      next();
    } catch (e) {
      next(e);
    }
  };

  const adminToken = () => {
    const exp = Date.now() + ADMIN_HOURS * 3600e3;
    const sig = crypto.createHmac('sha256', SECRET).update(`admin.${exp}`).digest('hex');
    return `${exp}.${sig}`;
  };
  const adminAuth = (req, res, next) => {
    const t = parseCookies(req)[ADMIN_COOKIE] || '';
    const [exp, sig] = t.split('.');
    const good = exp && sig && Number(exp) > Date.now() && eq(sig, crypto.createHmac('sha256', SECRET).update(`admin.${exp}`).digest('hex'));
    if (!good) return res.status(401).json({ code: 'admin_login', message: '관리자 로그인이 필요합니다.' });
    next();
  };

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ───────── 공용 ─────────
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'server', db: db.kind }));

  // ───────── 회원 ─────────
  app.post(
    '/api/login',
    wrap(async (req, res) => {
      const { username = '', password = '' } = req.body || {};
      const ip = clientIp(req);
      const key = `${ip}|${String(username).toLowerCase()}`;
      if (limited(key)) return res.status(429).json({ code: 'locked', message: '로그인 실패가 많아 15분 동안 잠겼습니다. 잠시 뒤 다시 시도하세요.' });
      const u = username ? await db.getUserByName(String(username).trim()) : null;
      if (!u || !verifyPassword(password, u.pass_hash)) {
        fail(key);
        return res.status(401).json({ code: 'bad_login', message: '아이디 또는 비밀번호가 맞지 않습니다.' });
      }
      fails.delete(key);
      const bad = accountProblem(u);
      if (bad) return res.status(403).json(bad);
      const token = crypto.randomBytes(32).toString('base64url');
      await db.createSession(sha(token), u.id);
      await db.updateUser(u.id, { last_login: new Date().toISOString() });
      setCookie(res, USER_COOKIE, token, SESSION_DAYS * 86400);
      res.json(await meBody(u, ip));
    }),
  );

  app.post(
    '/api/logout',
    wrap(async (req, res) => {
      const token = parseCookies(req)[USER_COOKIE];
      if (token) await db.deleteSession(sha(token));
      setCookie(res, USER_COOKIE, '', 0);
      res.json({ ok: true });
    }),
  );

  app.get('/api/me', auth(false), wrap(async (req, res) => res.json(await meBody(req.user, req.ip2))));

  app.post(
    '/api/ip/register',
    auth(false),
    wrap(async (req, res) => {
      const st = await ipState(req.user, req.ip2);
      if (st.status === 'ok') return res.json(await meBody(req.user, req.ip2));
      if (st.status === 'full') return res.status(403).json({ code: 'ip_full', message: `등록 가능한 장소(IP) ${st.max}곳을 모두 사용했습니다. 관리자에게 IP 초기화를 요청하세요.`, ipState: st });
      await db.addIp(req.user.id, req.ip2);
      res.json(await meBody(req.user, req.ip2));
    }),
  );

  app.post(
    '/api/password',
    auth(true),
    wrap(async (req, res) => {
      const { current = '', next: nw = '' } = req.body || {};
      if (!verifyPassword(current, req.user.pass_hash)) return res.status(400).json({ code: 'bad_password', message: '현재 비밀번호가 맞지 않습니다.' });
      if (String(nw).length < 6) return res.status(400).json({ code: 'weak', message: '새 비밀번호는 6자 이상으로 정하세요.' });
      await db.updateUser(req.user.id, { pass_hash: hashPassword(nw) });
      res.json({ ok: true });
    }),
  );

  // 회원별 공정표 데이터 — 항상 로그인한 회원 id로만 읽고 쓴다
  app.get('/api/projects', auth(true), wrap(async (req, res) => res.json({ projects: await db.listProjects(req.user.id) })));
  app.put(
    '/api/projects/:id',
    auth(true),
    wrap(async (req, res) => {
      const data = req.body?.data;
      const id = String(req.params.id);
      if (!data || typeof data !== 'object' || data.id !== id || id.length > 80) return res.status(400).json({ code: 'bad_data', message: '저장할 데이터가 올바르지 않습니다.' });
      await db.saveProject(req.user.id, id, data);
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/projects/:id',
    auth(true),
    wrap(async (req, res) => {
      await db.deleteProject(req.user.id, String(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ───────── 관리자 ─────────
  app.post('/api/admin/login', (req, res) => {
    const { id = '', password = '' } = req.body || {};
    const ip = clientIp(req);
    const key = `admin|${ip}`;
    if (limited(key)) return res.status(429).json({ code: 'locked', message: '로그인 실패가 많아 15분 동안 잠겼습니다.' });
    if (!ADMIN_PASSWORD) return res.status(503).json({ code: 'no_admin', message: '서버에 관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았습니다.' });
    if (!eq(id, ADMIN_ID) || !eq(password, ADMIN_PASSWORD)) {
      fail(key);
      return res.status(401).json({ code: 'bad_login', message: '관리자 아이디 또는 비밀번호가 맞지 않습니다.' });
    }
    fails.delete(key);
    setCookie(res, ADMIN_COOKIE, adminToken(), ADMIN_HOURS * 3600);
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => {
    setCookie(res, ADMIN_COOKIE, '', 0);
    res.json({ ok: true });
  });
  app.get('/api/admin/me', adminAuth, (req, res) => res.json({ ok: true, id: ADMIN_ID, db: db.kind, ephemeral: !!opts.ephemeral }));

  const cleanUser = (u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    company: u.company,
    phone: u.phone,
    memo: u.memo,
    active: u.active,
    expires_at: u.expires_at,
    max_ips: u.max_ips,
    created_at: u.created_at,
    last_login: u.last_login,
    project_count: u.project_count ?? 0,
    ips: (u.ips || []).map((i) => ({ ip: i.ip, first_seen: i.first_seen, last_seen: i.last_seen })),
  });
  const validDate = (s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

  app.get('/api/admin/users', adminAuth, wrap(async (req, res) => res.json({ users: (await db.listUsers()).map(cleanUser), today: todayKST() })));

  app.post(
    '/api/admin/users',
    adminAuth,
    wrap(async (req, res) => {
      const b = req.body || {};
      const username = String(b.username || '').trim();
      if (!USERNAME.test(username)) return res.status(400).json({ code: 'bad_username', message: '아이디는 영문·숫자·._- 3~30자로 정하세요.' });
      if (String(b.password || '').length < 6) return res.status(400).json({ code: 'weak', message: '비밀번호는 6자 이상으로 정하세요.' });
      if (!validDate(b.expires_at)) return res.status(400).json({ code: 'bad_date', message: '만료일 형식이 올바르지 않습니다.' });
      try {
        const id = await db.createUser({
          username,
          pass_hash: hashPassword(b.password),
          name: String(b.name || '').slice(0, 60),
          company: String(b.company || '').slice(0, 80),
          phone: String(b.phone || '').slice(0, 40),
          memo: String(b.memo || '').slice(0, 500),
          expires_at: b.expires_at || null,
          max_ips: Math.max(1, Math.min(20, Number(b.max_ips) || 3)),
        });
        res.json({ ok: true, id });
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ code: 'duplicate', message: '이미 있는 아이디입니다.' });
        throw e;
      }
    }),
  );

  app.patch(
    '/api/admin/users/:id',
    adminAuth,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const u = await db.getUser(id);
      if (!u) return res.status(404).json({ code: 'not_found', message: '회원을 찾을 수 없습니다.' });
      const b = req.body || {};
      const patch = {};
      for (const k of ['name', 'company', 'phone', 'memo']) if (k in b) patch[k] = String(b[k] ?? '').slice(0, k === 'memo' ? 500 : 80);
      if ('active' in b) patch.active = !!b.active;
      if ('expires_at' in b) {
        if (!validDate(b.expires_at)) return res.status(400).json({ code: 'bad_date', message: '만료일 형식이 올바르지 않습니다.' });
        patch.expires_at = b.expires_at || null;
      }
      if ('max_ips' in b) patch.max_ips = Math.max(1, Math.min(20, Number(b.max_ips) || 3));
      if (b.password) {
        if (String(b.password).length < 6) return res.status(400).json({ code: 'weak', message: '비밀번호는 6자 이상으로 정하세요.' });
        patch.pass_hash = hashPassword(b.password);
      }
      await db.updateUser(id, patch);
      if (patch.pass_hash || patch.active === false) await db.deleteUserSessions(id);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/admin/users/:id/ips',
    adminAuth,
    wrap(async (req, res) => {
      await db.removeIps(Number(req.params.id), req.query.ip ? String(req.query.ip) : null);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/admin/users/:id',
    adminAuth,
    wrap(async (req, res) => {
      await db.deleteUser(Number(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ code: 'not_found', message: '없는 주소입니다.' }));

  // ───────── 화면(빌드된 정적 파일) ─────────
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    const index = path.join(staticDir, 'index.html');
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).json({ code: 'server', message: '서버 오류가 발생했습니다. 잠시 뒤 다시 시도하세요.' });
  });
  return app;
}
