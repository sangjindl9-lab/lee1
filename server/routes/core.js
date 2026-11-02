const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireAdmin, assertSite, membership, accessibleSiteIds, hashPassword, checkPassword, HttpError } = require('../auth');
const defs = require('../lib/defs');
const { h, clean } = require('../lib/svc');
const { issues, ISSUE_TYPES } = require('../lib/issues');

const r = express.Router();

r.post('/login', h(async (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || ''));
  if (!u || !u.active || !checkPassword(String(password || ''), u.password_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  req.session.regenerate(err => {
    if (err) throw err;
    req.session.userId = u.id;
    req.user = u;
    audit(req, 'login', 'user', u.id);
    req.session.save(() => res.json({ ok: true }));
  });
}));

r.post('/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

r.get('/me', requireAuth, (req, res) => {
  const ids = accessibleSiteIds(req.user);
  const sites = ids.length ? db.prepare(`SELECT * FROM sites WHERE id IN (${ids.map(() => '?').join(',')}) AND archived=0 ORDER BY is_demo, name`).all(...ids) : [];
  res.json({ user: req.user, sites: sites.map(s => ({ ...s, perm: membership(req.user, s.id) })) });
});

r.get('/meta', requireAuth, (req, res) => res.json({ ...defs, ISSUE_TYPES }));

// ---------- 현장 ----------
r.post('/sites', requireAuth, requireAdmin, h(async (req, res) => {
  const { code, name, address, client, period } = req.body;
  if (!clean(code) || !clean(name)) throw new HttpError(400, '현장코드와 현장명은 필수입니다.');
  const info = db.prepare('INSERT INTO sites(code,name,address,client,period) VALUES (?,?,?,?,?)').run(clean(code), clean(name), clean(address), clean(client), clean(period));
  audit(req, 'create', 'site', info.lastInsertRowid, req.body, info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
}));

r.put('/sites/:id', requireAuth, requireAdmin, h(async (req, res) => {
  const s = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id);
  if (!s) throw new HttpError(404, '현장을 찾을 수 없습니다.');
  const m = { ...s, ...req.body };
  db.prepare('UPDATE sites SET code=?, name=?, address=?, client=?, period=?, archived=? WHERE id=?').run(m.code, m.name, m.address, m.client, m.period, m.archived ? 1 : 0, s.id);
  audit(req, 'update', 'site', s.id, req.body, s.id);
  res.json({ ok: true });
}));

// ---------- 사용자·권한 ----------
r.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, name, role, phone, active, created_at FROM users ORDER BY id').all();
  const mem = db.prepare('SELECT * FROM site_members').all();
  res.json(users.map(u => ({ ...u, sites: mem.filter(m => m.user_id === u.id) })));
});

r.post('/users', requireAuth, requireAdmin, h(async (req, res) => {
  const { username, password, name, role, phone } = req.body;
  if (!clean(username) || !clean(name) || !password) throw new HttpError(400, '아이디, 이름, 비밀번호는 필수입니다.');
  if (String(password).length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
  if (!['admin', 'site_manager', 'worker', 'viewer'].includes(role)) throw new HttpError(400, '역할이 올바르지 않습니다.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
  const info = db.prepare('INSERT INTO users(username,password_hash,name,role,phone) VALUES (?,?,?,?,?)').run(clean(username), hashPassword(password), clean(name), role, clean(phone));
  audit(req, 'create', 'user', info.lastInsertRowid, { username, role });
  res.json({ id: info.lastInsertRowid });
}));

r.put('/users/:id', requireAuth, requireAdmin, h(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  const m = { ...u, ...req.body };
  if (!['admin', 'site_manager', 'worker', 'viewer'].includes(m.role)) throw new HttpError(400, '역할이 올바르지 않습니다.');
  db.prepare('UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?').run(m.name, m.role, m.phone, m.active ? 1 : 0, u.id);
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(req.body.password), u.id);
  }
  audit(req, 'update', 'user', u.id, { ...req.body, password: req.body.password ? '(변경)' : undefined });
  res.json({ ok: true });
}));

r.put('/users/:id/sites', requireAuth, requireAdmin, h(async (req, res) => {
  const uid = Number(req.params.id);
  const list = Array.isArray(req.body.sites) ? req.body.sites : [];
  db.transaction(() => {
    db.prepare('DELETE FROM site_members WHERE user_id=?').run(uid);
    const ins = db.prepare('INSERT INTO site_members(user_id,site_id,can_view,can_create,can_edit,can_delete,can_review) VALUES (?,?,?,?,?,?,?)');
    for (const s of list) ins.run(uid, s.site_id, 1, s.can_create ? 1 : 0, s.can_edit ? 1 : 0, s.can_delete ? 1 : 0, s.can_review ? 1 : 0);
  })();
  audit(req, 'update', 'site_members', uid, list);
  res.json({ ok: true });
}));

r.get('/audit', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT l.*, u.name AS user_name, s.name AS site_name FROM audit_logs l
    LEFT JOIN users u ON u.id=l.user_id LEFT JOIN sites s ON s.id=l.site_id
    WHERE (? IS NULL OR l.site_id=?) ORDER BY l.id DESC LIMIT 500`).all(req.query.site_id || null, req.query.site_id || null);
  res.json(rows);
});

// ---------- 대시보드 ----------
r.get('/sites/:sid/dashboard', requireAuth, h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(sid);
  const byCat = db.prepare('SELECT category, status, COUNT(*) n FROM assets WHERE site_id=? AND retired=0 GROUP BY category, status').all(sid);
  const issueCounts = {};
  for (const t of Object.keys(ISSUE_TYPES)) issueCounts[t] = issues(sid, t).length;
  const recent = db.prepare(`SELECT w.*, a.mgmt_no, a.category FROM work_logs w JOIN assets a ON a.id=w.asset_id
     WHERE w.site_id=? AND w.superseded_by IS NULL ORDER BY w.work_at DESC, w.id DESC LIMIT 10`).all(sid);
  const pendingReview = db.prepare(`SELECT COUNT(*) n FROM measurements WHERE site_id=? AND superseded_by IS NULL AND review_status='검토 대기'`).get(sid).n;
  const drawings = db.prepare('SELECT COUNT(*) n FROM drawings WHERE site_id=? AND archived=0').get(sid).n;
  res.json({ site, byCat, issueCounts, recent, pendingReview, drawings });
}));

r.get('/sites/:sid/issues', requireAuth, h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const type = req.query.type;
  if (!ISSUE_TYPES[type]) throw new HttpError(400, '조회 유형이 올바르지 않습니다.');
  res.json(issues(sid, type, Number(req.query.days || 90)));
}));

module.exports = r;
