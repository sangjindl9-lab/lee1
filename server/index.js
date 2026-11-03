'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const QRCode = require('qrcode');
const { db, uid, J, DATA_DIR, getSetting, setSetting } = require('./db');
const M = require('./model');
const F = require('./services/files');
const CAT = require('../shared/catalog');
const CALC = require('../shared/calc');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));

// ----- 세션 저장소 (SQLite) -----
class SqliteStore extends session.Store {
  get(sid, cb) { const r = db.prepare('SELECT sess, expire FROM sessions WHERE sid=?').get(sid); if (!r || r.expire < Date.now()) return cb(null, null); cb(null, JSON.parse(r.sess)); }
  set(sid, sess, cb) { const exp = Date.now() + ((sess.cookie && sess.cookie.maxAge) || 86400000); db.prepare('INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire').run(sid, JSON.stringify(sess), exp); cb && cb(null); }
  destroy(sid, cb) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb && cb(null); }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
let secret = process.env.SESSION_SECRET || getSetting('session_secret', null);
if (!secret) { secret = require('crypto').randomBytes(32).toString('hex'); setSetting('session_secret', secret); }
app.use(session({ store: new SqliteStore(), secret, resave: false, saveUninitialized: false, name: 'cctv.sid', cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 12 * 3600 * 1000 } }));
setInterval(() => db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now()), 3600 * 1000).unref();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: (+(process.env.MAX_UPLOAD_MB || 200)) * 1024 * 1024 } });

// ----- 인증·권한 -----
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function auth(req, res, next) {
  const u = req.session.uid && db.prepare('SELECT id,company_id,username,name,role,active FROM users WHERE id=?').get(req.session.uid);
  if (!u || !u.active) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = u; next();
}
function admin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' }); next(); }
// 라이선스 (체험 30일 · 만료/중지 시 보기 전용 · 사용자 수 제한)
require('./license')(app, { product: 'design', appVersion: require('../package.json').version, getSetting, setSetting, countActiveUsers: () => db.prepare('SELECT COUNT(*) n FROM users WHERE active=1').get().n, auth, admin });
// 프로젝트 역할: admin > designer > reviewer > viewer
function projRole(user, pid) {
  const p = db.prepare('SELECT company_id FROM projects WHERE id=?').get(pid);
  if (!p) return { exists: false };
  if (user.role === 'admin') return { exists: true, role: 'admin' };
  const m = db.prepare('SELECT role FROM project_members WHERE project_id=? AND user_id=?').get(pid, user.id);
  if (!m) return { exists: true, role: null };
  // 전역 역할이 프로젝트 역할보다 낮으면 낮은 쪽 적용
  const rank = { viewer: 1, reviewer: 2, designer: 3 };
  const r = rank[user.role] < rank[m.role] ? user.role : m.role;
  return { exists: true, role: r };
}
const LEVEL = { viewer: 1, reviewer: 2, designer: 3, admin: 4 };
function need(level) {
  return (req, res, next) => {
    const pid = req.params.pid || req.pidFromFile;
    const r = projRole(req.user, pid);
    if (!r.exists) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
    if (!r.role) return res.status(403).json({ error: '이 프로젝트에 대한 접근 권한이 없습니다.' });
    if (LEVEL[r.role] < LEVEL[level]) return res.status(403).json({ error: { designer: '설계·편집 권한이 필요합니다.', reviewer: '검토자 이상 권한이 필요합니다.', admin: '관리자 권한이 필요합니다.' }[level] || '권한이 없습니다.' });
    req.projRole = r.role; next();
  };
}
// 파일 → 프로젝트 권한
function fileAccess(req, res, next) {
  const f = db.prepare('SELECT project_id FROM files WHERE id=?').get(req.params.fid);
  if (!f) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  if (!f.project_id) { if (req.user) return next(); return res.status(403).json({ error: '권한 없음' }); }
  req.pidFromFile = f.project_id; need('viewer')(req, res, next);
}
function sheetAccess(level) {
  return (req, res, next) => {
    const s = db.prepare('SELECT project_id FROM sheets WHERE id=?').get(req.params.sid);
    if (!s) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
    req.params.pid = s.project_id; need(level)(req, res, next);
  };
}

// ----- 초기 관리자 -----
function ensureAdmin() {
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (n) return;
  const cid = uid();
  db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').run(cid, process.env.INIT_COMPANY || '기본 회사');
  const pw = process.env.ADMIN_PASSWORD || require('crypto').randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users(id,company_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)').run(uid(), cid, process.env.ADMIN_USER || 'admin', '관리자', bcrypt.hashSync(pw, 10), 'admin');
  console.log(`[초기 설정] 관리자 계정 생성: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD 환경변수 값)' : pw}  ← 로그인 후 비밀번호를 변경하세요.`);
  require('./seed-products').seed(db);
}
ensureAdmin();
if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) require('./seed-products').seed(db);
// DWG 엔진 환경변수 자동 설정
if (process.env.DWG_ENGINE_PATH && !getSetting('dwg_engine', null)) setSetting('dwg_engine', { type: process.env.DWG_ENGINE_TYPE || 'libredwg', path: process.env.DWG_ENGINE_PATH });

// ===== 인증 API =====
const loginFails = new Map();
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = (username || '') + '|' + req.ip; const f = loginFails.get(key) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60000) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.password_hash)) { loginFails.set(key, { n: f.n + 1, t: Date.now() }); return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }); }
  loginFails.delete(key);
  req.session.regenerate(() => { req.session.uid = u.id; res.json({ ok: true }); });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => { const c = db.prepare('SELECT * FROM companies WHERE id=?').get(req.user.company_id); res.json({ user: req.user, company: c }); });
app.post('/api/me/password', auth, (req, res) => {
  const { current, next } = req.body || {}; const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', u.password_hash)) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  if (!next || next.length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), u.id); res.json({ ok: true });
});

// ===== 관리자 =====
app.get('/api/companies', auth, admin, (req, res) => res.json(db.prepare('SELECT * FROM companies ORDER BY name').all()));
app.post('/api/companies', auth, admin, (req, res) => { if (!req.body.name) return res.status(400).json({ error: '회사명을 입력하세요.' }); const id = uid(); db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').run(id, req.body.name); res.json({ id }); });
app.put('/api/companies/:id', auth, admin, (req, res) => { db.prepare('UPDATE companies SET name=COALESCE(?,name), logo_file_id=COALESCE(?,logo_file_id) WHERE id=?').run(req.body.name || null, req.body.logo_file_id || null, req.params.id); res.json({ ok: true }); });
app.post('/api/companies/:id/logo', auth, admin, upload.single('file'), wrap(async (req, res) => { if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' }); const f = F.storeBuffer(null, req.file.buffer, req.file.originalname, req.user.id, null, 'logo'); db.prepare('UPDATE companies SET logo_file_id=? WHERE id=?').run(f.id, req.params.id); res.json({ file_id: f.id }); }));
app.get('/api/users', auth, (req, res) => {
  // 멤버 지정 화면에서 설계자도 사용자 목록 조회 가능(비밀번호 제외)
  res.json(db.prepare('SELECT id,company_id,username,name,role,active,created_at FROM users ORDER BY name').all());
});
app.post('/api/users', auth, admin, (req, res) => {
  const { username, name, password, role, company_id } = req.body || {};
  if (!username || !name || !password || password.length < 8) return res.status(400).json({ error: '아이디, 이름, 8자 이상 비밀번호를 입력하세요.' });
  if (!LEVEL[role]) return res.status(400).json({ error: '권한을 선택하세요.' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  const id = uid(); db.prepare('INSERT INTO users(id,company_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?)').run(id, company_id || req.user.company_id, username, name, bcrypt.hashSync(password, 10), role);
  res.json({ id });
});
app.put('/api/users/:id', auth, admin, (req, res) => {
  const { name, role, active, password } = req.body || {};
  if (req.params.id === req.user.id && (role && role !== 'admin' || active === false)) return res.status(400).json({ error: '자기 자신의 관리자 권한은 해제할 수 없습니다.' });
  db.prepare('UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=?').run(name || null, role || null, active == null ? null : (active ? 1 : 0), req.params.id);
  if (password) { if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상' }); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id); }
  res.json({ ok: true });
});
app.get('/api/settings/dwg', auth, (req, res) => { const e = getSetting('dwg_engine', null); const oda = getSetting('dwg_oda_path', null) || (e && e.type === 'oda' ? e.path : null); res.json({ configured: !!(e && e.path), export_ready: !!oda, engine: req.user.role === 'admin' ? e : (e ? { type: e.type } : null), oda_export_path: req.user.role === 'admin' ? getSetting('dwg_oda_path', null) : undefined }); });
app.put('/api/settings/dwg', auth, admin, wrap(async (req, res) => { const { type, path: p } = req.body || {}; if (!p) { setSetting('dwg_engine', null); return res.json({ ok: true, configured: false }); } const t = await F.testDwgEngine({ type, path: p }); if (!t.ok) return res.status(400).json({ error: t.message }); setSetting('dwg_engine', { type: type || 'libredwg', path: p }); res.json({ ok: true, test: t }); }));
app.post('/api/settings/dwg/test', auth, admin, wrap(async (req, res) => res.json(await F.testDwgEngine(req.body && req.body.path ? req.body : getSetting('dwg_engine', null)))));
const MAP_DEFAULT = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', maxZoom: 19, enabled: true, note: 'OpenStreetMap 공개 타일(사용량 많으면 자체 타일 서버·VWorld 등으로 변경)' };
app.get('/api/settings/map', auth, (req, res) => res.json(getSetting('map_tiles', MAP_DEFAULT)));
app.put('/api/settings/map', auth, admin, (req, res) => { const b = req.body || {}; if (b.enabled && !(/^https:\/\//.test(b.url || '') && ['{z}', '{x}', '{y}'].every(t => (b.url || '').includes(t)))) return res.status(400).json({ error: '타일 주소는 https:// 로 시작하고 {z}, {x}, {y}를 포함해야 합니다.' }); setSetting('map_tiles', { url: b.url, attribution: b.attribution || '', maxZoom: +b.maxZoom || 19, enabled: !!b.enabled, note: b.note || '' }); res.json({ ok: true }); });
app.get('/api/jobs/:id', auth, (req, res) => { const j = F.getJob(req.params.id); if (!j) return res.status(404).json({ error: '작업 없음' }); if (j.project_id && !projRole(req.user, j.project_id).role) return res.status(403).json({ error: '권한 없음' }); res.json(j); });

// ===== 프로젝트 =====
const PF = ['name', 'address', 'client', 'designer', 'contractor', 'author', 'written_at', 'drawing_no', 'revision', 'system_type'];
app.get('/api/projects', auth, (req, res) => {
  const rows = req.user.role === 'admin' ? db.prepare('SELECT p.*, NULL as my_role FROM projects p ORDER BY is_sample, updated_at DESC').all()
    : db.prepare('SELECT p.*, m.role as my_role FROM projects p JOIN project_members m ON m.project_id=p.id AND m.user_id=? ORDER BY is_sample, updated_at DESC').all(req.user.id);
  res.json(rows.map(r => { const { settings, ...x } = r; x.role = projRole(req.user, r.id).role; x.counts = db.prepare('SELECT (SELECT COUNT(*) FROM sheets WHERE project_id=?) s, (SELECT COUNT(*) FROM devices WHERE project_id=? AND type=\'camera\') c').get(r.id, r.id); return x; }));
});
app.post('/api/projects', auth, (req, res) => {
  if (!['admin', 'designer'].includes(req.user.role)) return res.status(403).json({ error: '프로젝트 생성은 관리자·설계자만 가능합니다.' });
  const b = req.body || {}; if (!b.name) return res.status(400).json({ error: '공사명을 입력하세요.' });
  const id = uid();
  const settings = { layers: CAT.LAYERS.map(l => ({ ...l, visible: true, print: true })), slack: { mode: 'ratio', value: 10, target: 'all' }, round_unit_m: 1, fill_limit_pct: null, vd_limit_pct: null, coupling_interval_m: null, accessory_rules: CALC.DEFAULT_RULES, signal_ref_freq: {} };
  db.prepare(`INSERT INTO projects(id,company_id,${PF.join(',')},is_sample,settings,created_by) VALUES(?,?,${PF.map(() => '?').join(',')},?,?,?)`).run(id, b.company_id || req.user.company_id, ...PF.map(k => b[k] || (k === 'system_type' ? '혼합형' : null)), b.is_sample ? 1 : 0, JSON.stringify(settings), req.user.id);
  if (req.user.role !== 'admin') db.prepare('INSERT INTO project_members VALUES(?,?,?)').run(id, req.user.id, 'designer');
  M.log(id, req.user, 'project', id, 'create', null, b, '프로젝트 생성');
  res.json({ id });
});
app.get('/api/projects/:pid', auth, need('viewer'), (req, res) => { const p = M.projectRow(req.params.pid); p.my_role = req.projRole; res.json(p); });
app.put('/api/projects/:pid', auth, need('designer'), (req, res) => {
  const b = req.body || {}; const cur = M.projectRow(req.params.pid);
  if (b.ver != null && b.ver !== cur.ver && !b.force) return res.status(409).json({ error: '다른 사용자가 프로젝트 정보를 먼저 수정했습니다.', current: cur });
  const sets = PF.filter(k => k in b);
  if (b.system_type && !['IP형', '동축형', '혼합형'].includes(b.system_type)) return res.status(400).json({ error: '시스템 방식 값 오류' });
  db.prepare(`UPDATE projects SET ${sets.map(k => k + '=?').concat(['settings=?', 'ver=ver+1', "updated_at=datetime('now')"]).join(',')} WHERE id=?`).run(...sets.map(k => b[k]), JSON.stringify(b.settings ? { ...cur.settings, ...b.settings } : cur.settings), req.params.pid);
  M.log(req.params.pid, req.user, 'project', req.params.pid, 'update', cur, b, b.reason);
  res.json(M.projectRow(req.params.pid));
});
app.delete('/api/projects/:pid', auth, need('admin'), (req, res) => { db.prepare('DELETE FROM projects WHERE id=?').run(req.params.pid); fs.rmSync(path.join(F.FILE_DIR, req.params.pid), { recursive: true, force: true }); res.json({ ok: true }); });
app.get('/api/projects/:pid/members', auth, need('viewer'), (req, res) => res.json(db.prepare('SELECT m.*, u.name, u.username, u.role as user_role FROM project_members m JOIN users u ON u.id=m.user_id WHERE project_id=?').all(req.params.pid)));
app.put('/api/projects/:pid/members', auth, need('designer'), (req, res) => {
  const list = (req.body && req.body.members) || [];
  db.transaction(() => { db.prepare('DELETE FROM project_members WHERE project_id=?').run(req.params.pid); list.forEach(m => { if (['designer', 'reviewer', 'viewer'].includes(m.role)) db.prepare('INSERT INTO project_members VALUES(?,?,?)').run(req.params.pid, m.user_id, m.role); }); })();
  M.log(req.params.pid, req.user, 'project', req.params.pid, 'members', null, list, '멤버 변경'); res.json({ ok: true });
});
app.get('/api/projects/:pid/model', auth, need('viewer'), (req, res) => { const m = M.loadModel(req.params.pid); m.project.my_role = req.projRole; m.attachments = db.prepare('SELECT a.*, f.original_name, f.mime FROM attachments a JOIN files f ON f.id=a.file_id WHERE a.project_id=?').all(req.params.pid); res.json(m); });
app.get('/api/projects/:pid/log', auth, need('viewer'), (req, res) => res.json(db.prepare('SELECT id,user_name,entity,entity_id,action,reason,ts, before, after FROM change_log WHERE project_id=? ORDER BY id DESC LIMIT ?').all(req.params.pid, Math.min(+req.query.limit || 300, 2000)).map(r => ({ ...r, before: J(r.before), after: J(r.after) }))));
app.get('/api/projects/:pid/review', auth, need('viewer'), (req, res) => { const m = M.loadModel(req.params.pid); res.json({ review: CALC.review(m), quantities: CALC.quantities(m), coax: CALC.coaxCircuitTable(m), storage: CALC.storage(m), bandwidth: CALC.bandwidth(m) }); });

// 동시 편집 표시
const presence = new Map();
app.post('/api/projects/:pid/heartbeat', auth, need('viewer'), (req, res) => {
  const k = req.params.pid; if (!presence.has(k)) presence.set(k, new Map());
  const m = presence.get(k); m.set(req.user.id, { name: req.user.name, sheet: req.body && req.body.sheet, t: Date.now(), editing: !!(req.body && req.body.editing) });
  const others = [...m.entries()].filter(([id, v]) => id !== req.user.id && Date.now() - v.t < 45000).map(([, v]) => v);
  const since = +(req.body && req.body.since) || 0;
  const ver = db.prepare("SELECT MAX(id) mx FROM change_log WHERE project_id=?").get(k).mx || 0;
  const foreign = since ? db.prepare("SELECT COUNT(*) n FROM change_log WHERE project_id=? AND id>? AND (user_id IS NULL OR user_id<>?)").get(k, since, req.user.id).n : 0;
  res.json({ others, log_seq: ver, foreign });
});

// 일괄 저장 (자동·수동 저장 공통). 버전 충돌 시 전체 거부
app.post('/api/projects/:pid/batch', auth, need('designer'), (req, res) => {
  const { ops = [], reason, force } = req.body || {};
  const pid = req.params.pid;
  const results = []; const conflicts = [];
  try {
    db.transaction(() => {
      for (const op of ops) {
        if (!['devices', 'cables', 'conduits', 'annotations'].includes(op.entity)) throw Object.assign(new Error('잘못된 객체 유형'), { status: 400 });
        if (op.op === 'delete') {
          const cur = db.prepare(`SELECT ver FROM ${op.entity} WHERE id=? AND project_id=?`).get(op.id, pid);
          if (cur && op.ver != null && cur.ver !== op.ver && !force) { conflicts.push({ entity: op.entity, id: op.id, current: M.getObj(op.entity, op.id) }); continue; }
          const before = M.deleteObj(pid, op.entity, op.id);
          if (before) {
            M.log(pid, req.user, op.entity, op.id, 'delete', before, null, reason);
            // 삭제된 장비에 연결된 케이블은 미연결 상태로 변경 (선은 유지)
            if (op.entity === 'devices') db.prepare('SELECT id FROM cables WHERE project_id=? AND (from_dev=? OR to_dev=?)').all(pid, op.id, op.id).forEach(r => {
              const c = M.getObj('cables', r.id); if (c.from && c.from.dev === op.id) c.from = { dev: null, port: null }; if (c.to && c.to.dev === op.id) c.to = { dev: null, port: null };
              M.upsertObj(pid, 'cables', c, req.user, null, true); M.log(pid, req.user, 'cables', c.id, 'disconnect', null, null, '연결 장비 삭제');
            });
          }
          results.push({ entity: op.entity, id: op.id, deleted: true });
        } else {
          const r = M.upsertObj(pid, op.entity, op.data, req.user, op.ver, force);
          if (r.conflict) { conflicts.push({ entity: op.entity, id: op.data.id, current: r.current }); continue; }
          M.log(pid, req.user, op.entity, r.obj.id, r.before ? 'update' : 'create', r.before, r.obj, reason);
          results.push({ entity: op.entity, id: r.obj.id, ver: r.obj.ver, obj: r.obj });
        }
      }
      if (conflicts.length) throw Object.assign(new Error('conflict'), { conflict: true });
      db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(pid);
    })();
  } catch (e) {
    if (e.conflict) return res.status(409).json({ error: '다른 사용자가 먼저 수정한 객체가 있어 저장하지 않았습니다.', conflicts });
    throw e;
  }
  res.json({ ok: true, results });
});

// 현장 확인 (검토자 이상)
app.put('/api/projects/:pid/devices/:id/field', auth, need('reviewer'), (req, res) => {
  if (!db.prepare('SELECT 1 FROM devices WHERE id=? AND project_id=?').get(req.params.id, req.params.pid)) return res.status(404).json({ error: '장비 없음' });
  const d = M.getObj('devices', req.params.id);
  const b = req.body || {}; const before = { field: d.field };
  if (b.status && !CAT.FIELD_STATUS.includes(b.status)) return res.status(400).json({ error: '현장 확인 상태 값 오류' });
  d.field = { ...(d.field || {}), ...(b.status ? { status: b.status } : {}), ...(b.note != null ? { note: b.note } : {}), ...(b.actual ? { actual: b.actual } : {}), ...(b.as_built != null ? { as_built: b.as_built } : {}), by: req.user.name, at: new Date().toISOString() };
  const r = M.upsertObj(req.params.pid, 'devices', d, req.user, null, true);
  M.log(req.params.pid, req.user, 'devices', d.id, 'field', before, { field: d.field }, b.reason || '현장 확인');
  res.json(r.obj);
});
app.get('/api/projects/:pid/devices/:id/qr.png', auth, need('viewer'), wrap(async (req, res) => {
  const base = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
  const url = `${base}/m.html#p=${req.params.pid}&d=${req.params.id}`;
  res.type('png').send(await QRCode.toBuffer(url, { width: 360, margin: 1 }));
}));

// ===== 파일·도면 =====
app.post('/api/projects/:pid/files', auth, need('designer'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const f = F.storeBuffer(req.params.pid, req.file.buffer, name, req.user.id, ['image', 'pdf', 'dxf', 'dwg']);
  const full = F.getFile(f.id);
  const job = F.runJob(req.params.pid, 'analyze:' + f.kind, req.user.id, p => F.analyze(full, p));
  res.json({ file: { id: f.id, kind: f.kind, name, size: f.size }, job });
}));
app.get('/api/files/:fid/raw', auth, fileAccess, (req, res) => { const f = F.getFile(req.params.fid); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`); res.type(f.mime || 'application/octet-stream').sendFile(f.abs); });
app.get('/api/files/:fid/view', auth, fileAccess, (req, res) => { const f = F.getFile(req.params.fid); res.type(f.mime || 'application/octet-stream').sendFile(f.abs); });
app.get('/api/files/:fid/meta', auth, fileAccess, (req, res) => { const f = F.getFile(req.params.fid); res.json({ id: f.id, name: f.original_name, kind: f.kind, size: f.size, meta: f.meta }); });
app.get('/api/files/:fid/thumb/:n', auth, fileAccess, (req, res) => { const f = F.getFile(req.params.fid); const t = (f.meta.thumbs || [])[+req.params.n]; if (!t) return res.status(404).end(); res.sendFile(path.join(f.dir, t)); });
app.get('/api/files/:fid/dxf', auth, fileAccess, (req, res) => { const f = F.getFile(req.params.fid); const p = path.join(f.dir, 'dxf.json'); if (!fs.existsSync(p)) return res.status(404).json({ error: 'CAD 해석 결과 없음' }); res.type('json').sendFile(p); });

function bgFromFile(file, opt) {
  // 도면 배경 정보 생성
  opt = opt || {};
  if (file.kind === 'image') return Promise.resolve({ kind: 'image', file_id: file.id, width: file.meta.width, height: file.meta.height });
  if (file.kind === 'pdf') return F.renderPdfPage(file, opt.page || 1).then(async r => {
    const bg = { kind: 'pdf', file_id: file.id, page: opt.page || 1, width: r.width, height: r.height, dpi: r.dpi, pdf_pt: [file.meta.page_w_pt, file.meta.page_h_pt] };
    // 벡터 PDF: SVG 변환본을 화면·출력 배경으로 사용(선 객체화는 하지 않음)
    if (opt.vector !== false && file.meta.hasText) {
      try { const svg = await F.renderPdfSvg(file, bg.page); const sz = fs.statSync(svg).size; if (sz < 40 * 1024 * 1024) { bg.vector = true; bg.svg_bytes = sz; } else bg.vector_note = 'SVG 변환본이 너무 커서(40MB 초과) 래스터 배경 사용'; }
      catch (e) { bg.vector_note = '벡터 변환 실패 – 래스터 배경 사용: ' + (e.stderr || e.message).slice(0, 120); }
    }
    return bg;
  });
  if (file.kind === 'dxf' || file.kind === 'dwg') {
    const sp = opt.space === 'paper' ? 'paper' : 'model'; const m = file.meta[sp] || {};
    return Promise.resolve({ kind: 'cad', file_id: file.id, space: sp, width: m.width, height: m.height, origin: m.origin, cad_units: file.meta.units, cad_layers: Object.fromEntries(Object.entries(file.meta.layers || {}).map(([k, v]) => [k, { color: v.color, visible: v.visible }])) });
  }
  return Promise.reject(F.httpErr(400, '도면으로 사용할 수 없는 파일입니다.'));
}

app.post('/api/projects/:pid/sheets', auth, need('designer'), wrap(async (req, res) => {
  const b = req.body || {}; const pid = req.params.pid;
  const mk = (name, data, extra) => { const id = uid(); const sort = (db.prepare('SELECT MAX(sort) m FROM sheets WHERE project_id=?').get(pid).m || 0) + 1; db.prepare('INSERT INTO sheets(id,project_id,name,building,floor,zone,sheet_no,sort,data,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, pid, name, extra.building || null, extra.floor || null, extra.zone || null, extra.sheet_no || null, sort, JSON.stringify(data), req.user.name); M.log(pid, req.user, 'sheet', id, 'create', null, { name, ...data }); return id; };
  if (!b.file_id) {
    const id = mk(b.name || '빈 도면', { bg: { kind: 'blank', width: +b.width || 4000, height: +b.height || 2800 }, opacity: 1, rotation: 0, scale: null }, b);
    return res.json({ ids: [id] });
  }
  const file = F.getFile(b.file_id); if (!file || file.project_id !== pid) return res.status(404).json({ error: '파일 없음' });
  if (file.kind === 'dwg' && !file.meta.converted) return res.status(400).json({ error: 'DWG 변환이 완료되지 않았습니다. ' + (getSetting('dwg_engine', null) ? '' : 'DWG 변환 엔진이 설정되어 있지 않습니다. DXF 또는 PDF로 업로드하세요.') });
  const pages = b.pages && b.pages.length ? b.pages : [{ page: 1, name: b.name || file.original_name.replace(/\.[^.]+$/, '') }];
  const job = F.runJob(pid, 'sheet:create', req.user.id, async prog => {
    const ids = [];
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i]; const bg = await bgFromFile(file, { page: pg.page, space: b.space, vector: b.vector });
      const scale = (bg.kind === 'cad' && bg.cad_units && bg.cad_units.upm) ? { upm: bg.cad_units.upm, source: 'cad', unit: 'm', confirmed: false, note: `CAD 단위 ${bg.cad_units.name} 기준 (확인 필요)` } : null;
      ids.push(mk(pg.name || `${file.original_name} p${pg.page}`, { bg, opacity: 1, rotation: 0, scale, revisions: [{ rev_no: '0', file_id: file.id, at: new Date().toISOString() }] }, { ...b, ...pg }));
      prog(10 + Math.round(85 * (i + 1) / pages.length));
    }
    return { sheet_ids: ids };
  });
  res.json({ job });
}));
app.put('/api/sheets/:sid', auth, sheetAccess('designer'), (req, res) => {
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid); const b = req.body || {};
  if (b.ver != null && b.ver !== r.ver && !b.force) return res.status(409).json({ error: '다른 사용자가 도면 설정을 먼저 수정했습니다.', current: M.sheetObj(r) });
  const data = { ...J(r.data), ...(b.data || {}) };
  db.prepare("UPDATE sheets SET name=COALESCE(?,name), building=?, floor=?, zone=?, sheet_no=?, sort=COALESCE(?,sort), data=?, ver=ver+1, updated_at=datetime('now'), updated_by=? WHERE id=?")
    .run(b.name || null, 'building' in b ? b.building : r.building, 'floor' in b ? b.floor : r.floor, 'zone' in b ? b.zone : r.zone, 'sheet_no' in b ? b.sheet_no : r.sheet_no, b.sort == null ? null : b.sort, JSON.stringify(data), req.user.name, req.params.sid);
  M.log(r.project_id, req.user, 'sheet', r.id, 'update', M.sheetObj(r), b, b.reason);
  res.json(M.sheetObj(db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid)));
});
app.delete('/api/sheets/:sid', auth, sheetAccess('designer'), (req, res) => {
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid);
  db.transaction(() => { ['devices', 'cables', 'conduits', 'annotations'].forEach(t => db.prepare(`DELETE FROM ${t} WHERE sheet_id=?`).run(r.id)); db.prepare('DELETE FROM sheets WHERE id=?').run(r.id); })();
  M.log(r.project_id, req.user, 'sheet', r.id, 'delete', M.sheetObj(r), null); res.json({ ok: true });
});
app.get('/api/sheets/:sid/bg', auth, sheetAccess('viewer'), wrap(async (req, res) => {
  const s = M.sheetObj(db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid));
  const B = req.query.prev && s.prev_bg ? Object.values(s.prev_bg).slice(-1)[0] : s.bg;
  if (!B || !B.file_id) return res.status(404).end();
  const f = F.getFile(B.file_id);
  if (B.kind === 'image') return res.type(f.mime).sendFile(f.abs);
  if (B.kind === 'pdf' && B.vector && req.query.fmt === 'svg') { res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"); return res.type('image/svg+xml').sendFile(await F.renderPdfSvg(f, B.page)); }
  if (B.kind === 'pdf') { const r = await F.renderPdfPage(f, B.page); return res.type('png').sendFile(r.path); }
  if (B.kind === 'cad') return res.type('json').sendFile(path.join(f.dir, 'dxf.json'));
  res.status(404).end();
}));

// 도면 회전: 배경과 설계 객체를 함께 회전 (90° 단위)
function transformSheetObjects(sid, fn, user, reason) {
  const pid = db.prepare('SELECT project_id FROM sheets WHERE id=?').get(sid).project_id;
  ['devices', 'cables', 'conduits', 'annotations'].forEach(t => db.prepare(`SELECT id FROM ${t} WHERE sheet_id=?`).all(sid).forEach(r => {
    const o = M.getObj(t, r.id);
    if (o.x != null) { [o.x, o.y] = fn([o.x, o.y]); }
    if (o.points) o.points = o.points.map(fn);
    if (o.props && o.props.direction != null && fn.rot) o.props.direction = ((+o.props.direction || 0) + fn.rot + 360) % 360;
    if (o.field && o.field.actual) o.field.actual = fn(o.field.actual);
    if (o.sch) { /* 계통도 위치는 변경 없음 */ }
    M.upsertObj(pid, t, o, user, null, true);
  }));
  M.log(pid, user, 'sheet', sid, 'transform', null, null, reason);
}
app.post('/api/sheets/:sid/rotate', auth, sheetAccess('designer'), (req, res) => {
  const deg = ((+req.body.deg || 0) % 360 + 360) % 360; if (![90, 180, 270].includes(deg)) return res.status(400).json({ error: '90°, 180°, 270°만 지원합니다.' });
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid); const s = M.sheetObj(r);
  const W = s.bg.width, H = s.bg.height; const rot0 = s.rotation || 0;
  // 현재 표시 크기
  const w = rot0 % 180 ? H : W, h = rot0 % 180 ? W : H;
  const fn = deg === 90 ? (p => [h - p[1], p[0]]) : deg === 180 ? (p => [w - p[0], h - p[1]]) : (p => [p[1], w - p[0]]);
  fn.rot = deg;
  db.transaction(() => {
    transformSheetObjects(r.id, fn, req.user, `도면 ${deg}° 회전`);
    const data = { ...J(r.data), rotation: (rot0 + deg) % 360 };
    if (data.scale && data.scale.p1) { data.scale.p1 = fn(data.scale.p1); data.scale.p2 = fn(data.scale.p2); }
    db.prepare("UPDATE sheets SET data=?, ver=ver+1, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(data), r.id);
  })();
  res.json(M.sheetObj(db.prepare('SELECT * FROM sheets WHERE id=?').get(r.id)));
});

// 개정본 업로드: 현재 상태를 스냅샷으로 보관 후 배경 교체
function snapshotSheet(sid, user, rev_no, note) {
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(sid); const s = M.sheetObj(r);
  const model = M.loadModel(r.project_id);
  const sheetModel = { ...model, devices: model.devices.filter(d => d.sheet_id === sid), cables: model.cables.filter(c => c.sheet_id === sid), conduits: model.conduits.filter(c => c.sheet_id === sid), annotations: model.annotations.filter(a => a.sheet_id === sid) };
  const snap = { sheet: s, devices: sheetModel.devices, cables: sheetModel.cables, conduits: sheetModel.conduits, annotations: sheetModel.annotations, quantities: CALC.quantities(model), review_count: CALC.review(model).length };
  const id = uid();
  db.prepare('INSERT INTO sheet_revisions(id,sheet_id,project_id,rev_no,file_id,note,snapshot,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id, sid, r.project_id, rev_no, s.bg && s.bg.file_id, note || null, JSON.stringify(snap), user.name);
  return id;
}
app.post('/api/sheets/:sid/snapshot', auth, sheetAccess('designer'), (req, res) => { const id = snapshotSheet(req.params.sid, req.user, req.body.rev_no || 'S' + Date.now(), req.body.note); M.log(req.params.pid, req.user, 'sheet', req.params.sid, 'snapshot', null, null, req.body.note); res.json({ id }); });
app.post('/api/sheets/:sid/revision', auth, sheetAccess('designer'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '개정 도면 파일이 없습니다.' });
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid); const s = M.sheetObj(r);
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const f = F.storeBuffer(r.project_id, req.file.buffer, name, req.user.id, ['image', 'pdf', 'dxf', 'dwg']);
  const rev_no = req.body.rev_no || String((s.revisions || []).length);
  const job = F.runJob(r.project_id, 'sheet:revision', req.user.id, async prog => {
    const full = F.getFile(f.id); await F.analyze(full, prog); const ff = F.getFile(f.id);
    const bg = await bgFromFile(ff, { page: +req.body.page || 1, space: req.body.space });
    const snapId = snapshotSheet(r.id, req.user, (s.revisions || []).slice(-1)[0] ? (s.revisions.slice(-1)[0].rev_no) : '0', '개정 전 스냅샷');
    const data = { ...J(r.data) };
    data.prev_bg = { ...(data.prev_bg || {}), [(s.revisions || []).slice(-1)[0] ? s.revisions.slice(-1)[0].rev_no : '0']: data.bg };
    data.bg = bg; data.revisions = (data.revisions || []).concat([{ rev_no, file_id: f.id, at: new Date().toISOString(), by: req.user.name, note: req.body.note || '', snapshot_id: snapId }]);
    data.align_pending = true;
    db.prepare("UPDATE sheets SET data=?, ver=ver+1, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(data), r.id);
    // 기존 객체 위치 검토 표시
    db.prepare('SELECT id FROM devices WHERE sheet_id=?').all(r.id).forEach(x => { const o = M.getObj('devices', x.id); o.rev_review = { rev_no, state: '검토 필요' }; M.upsertObj(r.project_id, 'devices', o, req.user, null, true); });
    M.log(r.project_id, req.user, 'sheet', r.id, 'revision', { bg: s.bg }, { bg, rev_no }, req.body.note);
    return { rev_no, snapshot_id: snapId };
  });
  res.json({ job, file_id: f.id });
}));
app.post('/api/sheets/:sid/align', auth, sheetAccess('designer'), (req, res) => {
  // 두 기준점 정합: src(이전 배경 좌표) → dst(새 배경 좌표) 닮음변환
  const { src, dst } = req.body || {}; if (!src || !dst || src.length !== 2 || dst.length !== 2) return res.status(400).json({ error: '기준점 2쌍이 필요합니다.' });
  const [a, b] = src, [c, d] = dst;
  const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [d[0] - c[0], d[1] - c[1]];
  const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2); if (!l1 || !l2) return res.status(400).json({ error: '기준점이 너무 가깝습니다.' });
  const s = l2 / l1, th = Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0]);
  const cs = Math.cos(th) * s, sn = Math.sin(th) * s;
  const fn = p => [cs * (p[0] - a[0]) - sn * (p[1] - a[1]) + c[0], sn * (p[0] - a[0]) + cs * (p[1] - a[1]) + c[1]];
  fn.rot = th * 180 / Math.PI;
  const r = db.prepare('SELECT * FROM sheets WHERE id=?').get(req.params.sid);
  db.transaction(() => {
    transformSheetObjects(r.id, fn, req.user, `개정 기준점 정합 (배율 ${s.toFixed(4)}, 회전 ${(th * 180 / Math.PI).toFixed(2)}°)`);
    const data = { ...J(r.data), align_pending: false };
    if (data.scale && data.scale.upm) { data.scale = { ...data.scale, upm: data.scale.upm * s, note: (data.scale.note || '') + ` / 정합 배율 ${s.toFixed(4)} 반영` }; if (data.scale.p1) { data.scale.p1 = fn(data.scale.p1); data.scale.p2 = fn(data.scale.p2); } }
    db.prepare("UPDATE sheets SET data=?, ver=ver+1 WHERE id=?").run(JSON.stringify(data), r.id);
  })();
  res.json({ ok: true, scale: s, rotation_deg: th * 180 / Math.PI });
});
app.get('/api/sheets/:sid/revisions', auth, sheetAccess('viewer'), (req, res) => res.json(db.prepare('SELECT id,rev_no,file_id,note,created_by,created_at FROM sheet_revisions WHERE sheet_id=? ORDER BY created_at').all(req.params.sid)));
app.get('/api/projects/:pid/revisions/:rid', auth, need('viewer'), (req, res) => { const r = db.prepare('SELECT * FROM sheet_revisions WHERE id=? AND project_id=?').get(req.params.rid, req.params.pid); if (!r) return res.status(404).json({ error: '스냅샷 없음' }); r.snapshot = J(r.snapshot); res.json(r); });
app.get('/api/projects/:pid/revisions/:rid/compare', auth, need('viewer'), (req, res) => {
  const r = db.prepare('SELECT * FROM sheet_revisions WHERE id=? AND project_id=?').get(req.params.rid, req.params.pid); if (!r) return res.status(404).json({ error: '스냅샷 없음' });
  const snap = J(r.snapshot); const cur = M.loadModel(req.params.pid);
  const diff = (a, b, label) => { const A = new Map(a.map(x => [x.id, x])), B = new Map(b.map(x => [x.id, x])); const out = []; B.forEach((v, k) => { if (!A.has(k)) out.push({ type: label, change: '추가', tag: v.tag || v.type, id: k }); else { const o = A.get(k); const ch = []; ['tag', 'x', 'y', 'product_id', 'status'].forEach(f => { if (JSON.stringify(o[f]) !== JSON.stringify(v[f])) ch.push(f === 'x' || f === 'y' ? '위치' : f); }); if (JSON.stringify(o.props) !== JSON.stringify(v.props)) ch.push('속성'); if (JSON.stringify(o.points) !== JSON.stringify(v.points)) ch.push('경로'); if (JSON.stringify(o.from) !== JSON.stringify(v.from) || JSON.stringify(o.to) !== JSON.stringify(v.to)) ch.push('연결'); if (ch.length) out.push({ type: label, change: '변경', tag: v.tag || v.type, id: k, fields: [...new Set(ch)].join(', ') }); } }); A.forEach((v, k) => { if (!B.has(k)) out.push({ type: label, change: '삭제', tag: v.tag || v.type, id: k }); }); return out; };
  const sid = r.sheet_id;
  const objs = diff(snap.devices, cur.devices.filter(d => d.sheet_id === sid), '장비').concat(diff(snap.cables, cur.cables.filter(d => d.sheet_id === sid), '케이블'), diff(snap.conduits, cur.conduits.filter(d => d.sheet_id === sid), '관로'));
  const qNow = CALC.summaryByCat(CALC.quantities(cur)), qThen = CALC.summaryByCat(snap.quantities || []);
  const key = x => x.cat + '|' + x.name + '|' + x.spec + '|' + x.unit + '|' + x.status;
  const qm = new Map(); qThen.forEach(x => qm.set(key(x), { ...x, before: x.qty, after: 0 })); qNow.forEach(x => { const k = key(x); if (qm.has(k)) qm.get(k).after = x.qty; else qm.set(k, { ...x, before: 0, after: x.qty }); });
  res.json({ rev: { rev_no: r.rev_no, created_at: r.created_at, note: r.note }, objects: objs, quantities: [...qm.values()].filter(x => x.before !== x.after).map(x => ({ cat: x.cat, name: x.name, spec: x.spec, unit: x.unit, before: x.before, after: x.after, delta: CALC.round2((x.after || 0) - (x.before || 0)) })) });
});

// ===== 품목 =====
app.get('/api/products', auth, (req, res) => res.json(M.listProducts(req.user.company_id)));
app.post('/api/products', auth, (req, res) => {
  if (!['admin', 'designer'].includes(req.user.role)) return res.status(403).json({ error: '품목 등록은 관리자·설계자만 가능합니다.' });
  const b = req.body || {}; if (!b.name || !['device', 'cable', 'conduit', 'accessory'].includes(b.category)) return res.status(400).json({ error: '품명과 분류를 입력하세요.' });
  const id = b.id && db.prepare('SELECT 1 FROM products WHERE id=?').get(b.id) ? b.id : uid();
  if (id === b.id) db.prepare("UPDATE products SET category=?,kind=?,name=?,spec=?,unit=?,maker=?,model=?,data=?,updated_at=datetime('now') WHERE id=?").run(b.category, b.kind, b.name, b.spec, b.unit, b.maker, b.model, JSON.stringify(b.props || {}), id);
  else db.prepare('INSERT INTO products(id,company_id,category,kind,name,spec,unit,maker,model,data) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, req.user.role === 'admin' && b.global ? null : req.user.company_id, b.category, b.kind, b.name, b.spec, b.unit, b.maker, b.model, JSON.stringify(b.props || {}));
  res.json(M.productObj(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
});
app.delete('/api/products/:id', auth, admin, (req, res) => { const used = ['devices', 'cables', 'conduits'].reduce((s, t) => s + db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE product_id=?`).get(req.params.id).n, 0); if (used) return res.status(400).json({ error: `사용 중인 품목입니다 (${used}개 객체). 먼저 객체의 규격을 변경하세요.` }); db.prepare('DELETE FROM products WHERE id=?').run(req.params.id); res.json({ ok: true }); });

const X = require('./services/excel');
app.get('/api/products/template.xlsx', auth, wrap(async (req, res) => { res.type('xlsx').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('품목_등록양식.xlsx')); res.send(await X.productTemplate(M.listProducts(req.user.company_id))); }));
app.post('/api/products/import', auth, upload.single('file'), wrap(async (req, res) => {
  if (!['admin', 'designer'].includes(req.user.role)) return res.status(403).json({ error: '권한 없음' });
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const r = await X.importProducts(req.file.buffer, req.user, db, uid); res.json(r);
}));
app.get('/api/projects/:pid/devices/template.xlsx', auth, need('viewer'), wrap(async (req, res) => { res.type('xlsx').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('장비_일괄등록.xlsx')); res.send(await X.deviceTemplate(M.loadModel(req.params.pid))); }));
app.post('/api/projects/:pid/devices/import', auth, need('designer'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const r = await X.importDevices(req.file.buffer, M.loadModel(req.params.pid));
  if (req.query.dry === '1') return res.json(r);
  db.transaction(() => r.ops.forEach(op => { const x = M.upsertObj(req.params.pid, 'devices', op.data, req.user, null, true); M.log(req.params.pid, req.user, 'devices', x.obj.id, x.before ? 'update' : 'create', x.before, x.obj, '엑셀 일괄 등록'); }))();
  res.json({ ...r, ops: undefined, applied: r.ops.length });
}));
app.get('/api/projects/:pid/export.xlsx', auth, need('viewer'), wrap(async (req, res) => { const m = M.loadModel(req.params.pid); res.type('xlsx').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(`${m.project.name}_물량산출.xlsx`)); res.send(await X.exportProject(m)); }));

// ===== 출력 =====
const P = require('./services/pdfout');
app.post('/api/projects/:pid/pdf', auth, need('viewer'), wrap(async (req, res) => {
  const m = M.loadModel(req.params.pid); const company = db.prepare('SELECT * FROM companies WHERE id=?').get(m.project.company_id);
  if (req.body && req.body.snapshot_id) {
    // 개정 스냅샷 도면 출력: 해당 도면의 객체·배경을 스냅샷 시점으로 교체
    const r = db.prepare('SELECT * FROM sheet_revisions WHERE id=? AND project_id=?').get(req.body.snapshot_id, req.params.pid); if (!r) return res.status(404).json({ error: '스냅샷 없음' });
    const snap = J(r.snapshot); const sid = snap.sheet.id;
    ['devices', 'cables', 'conduits', 'annotations'].forEach(k => { m[k] = m[k].filter(o => o.sheet_id !== sid).concat(snap[k] || []); });
    m.sheets = m.sheets.map(s => s.id === sid ? { ...s, ...snap.sheet, name: `${snap.sheet.name} [개정 ${r.rev_no} 스냅샷]`, revisions: [{ rev_no: r.rev_no }] } : s);
  }
  const buf = await P.render(m, req.body || {}, { company, getFile: F.getFile, renderPdfPage: F.renderPdfPage, renderPdfSvg: F.renderPdfSvg, grayImage: F.grayImage });
  res.type('pdf').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(`${m.project.name}_${req.body.title || '도면'}.pdf`)); res.send(buf);
}));
app.get('/api/sheets/:sid/export.dxf', auth, sheetAccess('viewer'), (req, res) => {
  const m = M.loadModel(req.params.pid); const out = require('./services/dxfout').exportDxf(m, req.params.sid, { includeBg: req.query.bg === '1', getFile: F.getFile });
  const s = m.sheets.find(x => x.id === req.params.sid);
  res.type('application/dxf').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(`${s.name}.dxf`)); res.send(out);
});
app.get('/api/sheets/:sid/export.dwg', auth, sheetAccess('viewer'), wrap(async (req, res) => {
  // DWG 쓰기는 ODA File Converter로만 수행 (LibreDWG dwgwrite는 검증 결과 객체·레이어 손실이 있어 사용하지 않음)
  const eng = getSetting('dwg_engine', null); const oda = getSetting('dwg_oda_path', null) || (eng && eng.type === 'oda' ? eng.path : null);
  if (!oda || !fs.existsSync(oda)) return res.status(400).json({ error: 'DWG 내보내기는 ODA File Converter가 연결된 경우에만 사용할 수 있습니다(관리자 > DWG 변환 엔진 > DWG 내보내기용 ODA 경로). 지금은 DXF 내보내기를 이용하세요.' });
  const m = M.loadModel(req.params.pid); const dxf = require('./services/dxfout').exportDxf(m, req.params.sid, { includeBg: req.query.bg === '1', getFile: F.getFile });
  const tmp = path.join(DATA_DIR, 'tmp', uid()); const inD = path.join(tmp, 'in'), outD = path.join(tmp, 'out'); fs.mkdirSync(inD, { recursive: true }); fs.mkdirSync(outD, { recursive: true });
  fs.writeFileSync(path.join(inD, 'export.dxf'), dxf);
  try { await F.run(oda, [inD, outD, 'ACAD2018', 'DWG', '0', '1', 'export.dxf'], { timeout: 300000 }); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); return res.status(500).json({ error: 'DWG 변환 실패: ' + (e.stderr || e.message).slice(0, 200) }); }
  const out = path.join(outD, 'export.dwg'); if (!fs.existsSync(out)) { fs.rmSync(tmp, { recursive: true, force: true }); return res.status(500).json({ error: 'DWG 변환 결과가 없습니다.' }); }
  const s = m.sheets.find(x => x.id === req.params.sid);
  res.type('application/acad').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(`${s.name}.dwg`)); res.send(fs.readFileSync(out)); fs.rmSync(tmp, { recursive: true, force: true });
}));
app.put('/api/settings/dwg-export', auth, admin, wrap(async (req, res) => { const p = (req.body || {}).path; if (!p) { setSetting('dwg_oda_path', null); return res.json({ ok: true }); } if (!fs.existsSync(p)) return res.status(400).json({ error: '실행 파일을 찾을 수 없습니다: ' + p }); setSetting('dwg_oda_path', p); res.json({ ok: true }); }));

// ===== 첨부 (현장사진·시공사진·사양서·시험결과) =====
app.post('/api/projects/:pid/attachments', auth, need('reviewer'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const { target_type, target_id, kind, note } = req.body;
  if (!['device', 'cable', 'conduit', 'sheet', 'project'].includes(target_type)) return res.status(400).json({ error: '대상 오류' });
  if (!['현장사진', '시공사진', '제품사양서', '시험결과'].includes(kind)) return res.status(400).json({ error: '첨부 종류 오류' });
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const f = F.storeBuffer(req.params.pid, req.file.buffer, name, req.user.id, null, kind === '제품사양서' || kind === '시험결과' ? 'spec' : 'photo');
  const id = uid(); db.prepare('INSERT INTO attachments(id,project_id,target_type,target_id,file_id,kind,note,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id, req.params.pid, target_type, target_id, f.id, kind, note || null, req.user.name);
  if (kind === '시험결과' && target_type === 'cable') { const c = M.getObj('cables', target_id); if (c) { c.props = { ...(c.props || {}), test_result: f.id }; M.upsertObj(req.params.pid, 'cables', c, req.user, null, true); } }
  M.log(req.params.pid, req.user, 'attachment', id, 'create', null, { target_type, target_id, kind, name }, note);
  res.json({ id, file_id: f.id });
}));
app.delete('/api/projects/:pid/attachments/:id', auth, need('reviewer'), (req, res) => { db.prepare('DELETE FROM attachments WHERE id=? AND project_id=?').run(req.params.id, req.params.pid); res.json({ ok: true }); });

// ===== 백업·복원 =====
const BK = require('./services/backup');
app.get('/api/projects/:pid/backup', auth, need('designer'), wrap(async (req, res) => { const p = M.projectRow(req.params.pid); res.type('zip').setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(`${p.name}_백업_${new Date().toISOString().slice(0, 10)}.zip`)); await BK.backup(req.params.pid, res); }));
app.post('/api/backup/restore', auth, upload.single('file'), wrap(async (req, res) => {
  if (!['admin', 'designer'].includes(req.user.role)) return res.status(403).json({ error: '복원은 관리자·설계자만 가능합니다.' });
  if (!req.file) return res.status(400).json({ error: '백업 파일이 없습니다.' });
  const id = BK.restore(req.file.buffer, req.user); res.json({ id });
}));

// 카탈로그 (클라이언트 초기화)
app.get('/api/catalog', auth, (req, res) => res.json({ layers: CAT.LAYERS, kinds: CAT.CABLE_KINDS }));

// ----- 정적 파일 -----
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 오류 처리 (한국어)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `파일 용량 초과 (최대 ${process.env.MAX_UPLOAD_MB || 200}MB)` });
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : '서버 오류가 발생했습니다: ' + err.message });
});

const PORT = +(process.env.PORT || 3000);
if (require.main === module) app.listen(PORT, () => {
  console.log(`CCTV 공사 설계 프로그램 실행: http://localhost:${PORT}`);
  // SEED_SAMPLE=1: 샘플 프로젝트가 없으면 최초 1회 생성 (실제 API 경로로 저장)
  if (process.env.SEED_SAMPLE === '1' && process.env.ADMIN_PASSWORD && !db.prepare('SELECT 1 FROM projects WHERE is_sample=1').get()) {
    process.env.BASE_URL = `http://127.0.0.1:${PORT}`; process.env.SEED_INTERNAL = '1';
    require('../scripts/seed-sample').main().then(r => console.log('[샘플] 생성 완료', r.pid)).catch(e => console.error('[샘플] 생성 실패', e.message));
  }
});
module.exports = app;
