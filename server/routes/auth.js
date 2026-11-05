import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { system, tenant, audit } from '../db/index.js';
import { issueSession, clearSession, requireAuth, requireRole } from '../auth.js';

const r = Router();
const attempts = new Map(); // 간단한 로그인 시도 제한 (IP+이메일, 15분 10회)

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const emailOk = (e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

r.post('/signup', async (req, res) => {
  const { companyName, name, email, password } = req.body || {};
  if (!companyName?.trim() || !name?.trim()) return bad(res, '회사명과 이름을 입력하세요');
  if (!emailOk(email)) return bad(res, '이메일 형식이 올바르지 않습니다');
  if (!password || password.length < 8) return bad(res, '비밀번호는 8자 이상이어야 합니다');
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await system(async (c) => {
      const { rows: [co] } = await c.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName.trim()]);
      const { rows: [u] } = await c.query(
        "INSERT INTO users (company_id,email,password_hash,name,role) VALUES ($1,lower($2),$3,$4,'admin') RETURNING id,company_id,email,name,role",
        [co.id, email.trim(), hash, name.trim()]);
      await audit(c, { companyId: co.id, userId: u.id, action: 'company.signup', target: co.id });
      return u;
    });
    issueSession(res, user);
    res.status(201).json({ user });
  } catch (e) {
    if (e.code === '23505') return bad(res, '이미 가입된 이메일입니다', 409);
    throw e;
  }
});

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const k = `${req.ip}|${String(email).toLowerCase()}`;
  const a = attempts.get(k) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return bad(res, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요', 429);
  const u = await system(async (c) => (await c.query('SELECT * FROM users WHERE email=lower($1)', [String(email || '').trim()])).rows[0]);
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) {
    a.n++; attempts.set(k, a);
    return bad(res, '이메일 또는 비밀번호가 올바르지 않습니다', 401);
  }
  attempts.delete(k);
  await tenant(u.company_id, (c) => audit(c, { companyId: u.company_id, userId: u.id, action: 'user.login' }));
  issueSession(res, u);
  res.json({ user: { id: u.id, company_id: u.company_id, email: u.email, name: u.name, role: u.role } });
});

r.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

r.get('/me', requireAuth, async (req, res) => {
  const data = await tenant(req.user.companyId, async (c) => {
    const { rows: [u] } = await c.query('SELECT id,email,name,role FROM users WHERE id=$1', [req.user.id]);
    const { rows: [co] } = await c.query('SELECT id,name,brand,limits FROM companies WHERE id=$1', [req.user.companyId]);
    return { user: u, company: co };
  });
  if (!data.user) return bad(res, '사용자 없음', 401);
  res.json(data);
});

// 관리자: 같은 회사 사용자 추가·목록
r.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  res.json(await tenant(req.user.companyId, async (c) => (await c.query('SELECT id,email,name,role,created_at FROM users ORDER BY created_at')).rows));
});
r.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { email, name, password, role = 'member' } = req.body || {};
  if (!emailOk(email) || !name || !password || password.length < 8) return bad(res, '이메일·이름·비밀번호(8자 이상)를 확인하세요');
  if (!['admin', 'member', 'viewer'].includes(role)) return bad(res, '역할 오류');
  try {
    const u = await tenant(req.user.companyId, async (c) => {
      const { rows: [u] } = await c.query(
        'INSERT INTO users (company_id,email,password_hash,name,role) VALUES ($1,lower($2),$3,$4,$5) RETURNING id,email,name,role',
        [req.user.companyId, email, await bcrypt.hash(password, 10), name, role]);
      await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'user.create', target: u.id });
      return u;
    });
    res.status(201).json(u);
  } catch (e) { if (e.code === '23505') return bad(res, '이미 가입된 이메일입니다', 409); throw e; }
});
r.get('/audit', requireAuth, requireRole('admin'), async (req, res) => {
  res.json(await tenant(req.user.companyId, async (c) =>
    (await c.query('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300')).rows));
});
export default r;
