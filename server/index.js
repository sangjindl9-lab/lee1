'use strict';
/* CCTV 설치 제안서 프로그램 – 서버 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');
const sizeOf = require('image-size').imageSize || require('image-size');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILE_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'proposal.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, model TEXT, maker TEXT, data TEXT NOT NULL DEFAULT '{}', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, title TEXT NOT NULL, customer_name TEXT, customer_phone TEXT, customer_address TEXT, site_type TEXT, status TEXT NOT NULL DEFAULT '작성 중', staff_id TEXT, data TEXT NOT NULL DEFAULT '{}', share_token TEXT UNIQUE, is_sample INTEGER DEFAULT 0, ver INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, proposal_id TEXT, name TEXT, mime TEXT, size INTEGER, path TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')));
`);
const uid = () => crypto.randomUUID();
const J = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const getSetting = (k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? J(r.value) : d; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
class Store extends session.Store {
  get(sid, cb) { const r = db.prepare('SELECT * FROM sessions WHERE sid=?').get(sid); cb(null, r && r.expire > Date.now() ? JSON.parse(r.sess) : null); }
  set(sid, s, cb) { db.prepare('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire').run(sid, JSON.stringify(s), Date.now() + 12 * 3600e3); cb && cb(); }
  destroy(sid, cb) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb && cb(); }
}
let secret = process.env.SESSION_SECRET || getSetting('secret', null); if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setSetting('secret', secret); }
app.use(session({ store: new Store(), secret, resave: false, saveUninitialized: false, name: 'prop.sid', cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 12 * 3600e3 } }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: (+process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024 } });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { timeout: 180000, maxBuffer: 1 << 26 }, (e, so, se) => e ? no(Object.assign(e, { stderr: String(se) })) : ok(String(so))));

// ----- 초기 데이터 -----
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users(id,username,name,password_hash,role) VALUES(?,?,?,?,?)').run(uid(), process.env.ADMIN_USER || 'admin', '관리자', bcrypt.hashSync(pw, 10), 'admin');
  console.log(`[초기 설정] 관리자 ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD 값)' : pw}`);
}
if (!getSetting('company', null)) setSetting('company', { name: process.env.COMPANY_NAME || '회사명', tel: '', email: '', address: '', biz_no: '', slogan: '안전한 일상을 지키는 CCTV 설치 전문', logo_file_id: null, color: '#1f4e79' });
if (!getSetting('notices', null)) setSetting('notices', {
  fov: '도면의 색 영역은 카메라 화각과 감시 거리로 계산한 평면상 예상 범위입니다. 벽·가구·나무·조명 조건과 설치 높이에 따라 실제 화면은 달라질 수 있으며, 설치 시 현장 확인 후 최종 위치를 정합니다.',
  quote: '본 견적은 제안일로부터 30일간 유효하며, 현장 여건(배관·고소 작업 등)에 따라 변동될 수 있습니다.',
  service: '설치일로부터 1년간 무상 A/S를 제공합니다. (소비자 과실·천재지변 제외)',
  privacy: 'CCTV 설치·운영 시 개인정보 보호법에 따른 안내판 설치 등 관련 규정을 준수해야 합니다.'
});
if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) require('./seed-products').seed(db, uid);

// ----- 인증 -----
function auth(req, res, next) { const u = req.session.uid && db.prepare('SELECT id,username,name,phone,role,active FROM users WHERE id=?').get(req.session.uid); if (!u || !u.active) return res.status(401).json({ error: '로그인이 필요합니다.' }); req.user = u; next(); }
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '관리자만 가능합니다.' });
// 라이선스 (체험 30일 · 만료/중지 시 보기 전용 · 사용자 수 제한)
require('./license')(app, { product: 'proposal', appVersion: require('../package.json').version, getSetting, setSetting, countActiveUsers: () => db.prepare('SELECT COUNT(*) n FROM users WHERE active=1').get().n, auth, admin });
const fails = new Map();
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}; const k = username + req.ip; const f = fails.get(k) || 0;
  if (f >= 8) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.password_hash)) { fails.set(k, f + 1); setTimeout(() => fails.delete(k), 600000); return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }); }
  req.session.regenerate(() => { req.session.uid = u.id; res.json({ ok: true }); });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => res.json({ user: req.user, company: getSetting('company', {}) }));
app.post('/api/me/password', auth, (req, res) => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id); const { current, next } = req.body || {}; if (!bcrypt.compareSync(current || '', u.password_hash)) return res.status(400).json({ error: '현재 비밀번호가 다릅니다.' }); if (!next || next.length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상' }); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), u.id); res.json({ ok: true }); });
app.put('/api/me', auth, (req, res) => { db.prepare('UPDATE users SET name=COALESCE(?,name), phone=? WHERE id=?').run(req.body.name || null, req.body.phone || '', req.user.id); res.json({ ok: true }); });
app.get('/api/users', auth, admin, (req, res) => res.json(db.prepare('SELECT id,username,name,phone,role,active FROM users ORDER BY created_at').all()));
app.post('/api/users', auth, admin, (req, res) => { const b = req.body || {}; if (!b.username || !b.name || !b.password || b.password.length < 8) return res.status(400).json({ error: '아이디·이름·8자 이상 비밀번호를 입력하세요.' }); if (db.prepare('SELECT 1 FROM users WHERE username=?').get(b.username)) return res.status(409).json({ error: '이미 있는 아이디입니다.' }); db.prepare('INSERT INTO users(id,username,name,phone,password_hash,role) VALUES(?,?,?,?,?,?)').run(uid(), b.username, b.name, b.phone || '', bcrypt.hashSync(b.password, 10), b.role === 'admin' ? 'admin' : 'staff'); res.json({ ok: true }); });
app.put('/api/users/:id', auth, admin, (req, res) => { const b = req.body || {}; if (req.params.id === req.user.id && (b.active === false || b.role === 'staff')) return res.status(400).json({ error: '자기 자신은 변경할 수 없습니다.' }); db.prepare('UPDATE users SET role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=?').run(b.role || null, b.active == null ? null : (b.active ? 1 : 0), req.params.id); if (b.password) { if (b.password.length < 8) return res.status(400).json({ error: '8자 이상' }); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(b.password, 10), req.params.id); } res.json({ ok: true }); });

// ----- 설정 -----
app.get('/api/settings', auth, (req, res) => res.json({ company: getSetting('company', {}), notices: getSetting('notices', {}) }));
app.put('/api/settings', auth, admin, (req, res) => { if (req.body.company) setSetting('company', { ...getSetting('company', {}), ...req.body.company }); if (req.body.notices) setSetting('notices', { ...getSetting('notices', {}), ...req.body.notices }); res.json({ ok: true }); });

// ----- 파일 -----
function sniff(buf) { const h = buf.slice(0, 8); if (h[0] === 0xff && h[1] === 0xd8) return 'image/jpeg'; if (h.slice(0, 4).toString('hex') === '89504e47') return 'image/png'; if (h.slice(0, 4).toString() === 'RIFF') return 'image/webp'; if (h.slice(0, 5).toString() === '%PDF-') return 'application/pdf'; return null; }
async function storeFile(proposalId, f, allowPdf) {
  const mime = sniff(f.buffer); if (!mime || (mime === 'application/pdf' && !allowPdf)) throw Object.assign(new Error(allowPdf ? 'JPG·PNG 이미지 또는 PDF 파일만 올릴 수 있습니다.' : 'JPG·PNG 이미지만 올릴 수 있습니다.'), { status: 415 });
  const id = uid(); const dir = path.join(FILE_DIR, id); fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'original' + ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[mime])); fs.writeFileSync(p, f.buffer);
  const meta = {};
  if (mime.startsWith('image/')) { const d = sizeOf(f.buffer); meta.width = d.width; meta.height = d.height; }
  else { const info = await run('pdfinfo', [p]); meta.pages = +((info.match(/Pages:\s+(\d+)/) || [])[1] || 1); }
  db.prepare('INSERT INTO files(id,proposal_id,name,mime,size,path,meta) VALUES(?,?,?,?,?,?,?)').run(id, proposalId, Buffer.from(f.originalname, 'latin1').toString('utf8'), mime, f.buffer.length, path.relative(DATA_DIR, p), JSON.stringify(meta));
  return { id, mime, meta };
}
const fileRow = id => { const r = db.prepare('SELECT * FROM files WHERE id=?').get(id); if (r) { r.abs = path.join(DATA_DIR, r.path); r.meta = J(r.meta); } return r; };
// PDF 페이지 → PNG (도면 배경)
async function pdfPage(f, page) { const out = path.join(path.dirname(f.abs), `page-${page}`); if (!fs.existsSync(out + '.png')) await run('pdftoppm', ['-png', '-r', '150', '-f', String(page), '-l', String(page), '-singlefile', f.abs, out]); return out + '.png'; }
async function planImage(fid, page) { const f = fileRow(fid); if (!f) return null; return f.mime === 'application/pdf' ? pdfPage(f, page || 1) : f.abs; }
app.post('/api/files', auth, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const r = await storeFile(req.body.proposal_id || null, req.file, req.body.plan === '1');
  if (req.body.plan === '1') {
    // 도면: PDF는 선택 페이지를 이미지로 변환해 크기 확인
    const page = +req.body.page || 1; const img = await planImage(r.id, page); const d = sizeOf(fs.readFileSync(img));
    return res.json({ ...r, page, width: d.width, height: d.height });
  }
  res.json(r);
}));
app.get('/api/files/:id', auth, wrap(async (req, res) => { const f = fileRow(req.params.id); if (!f) return res.status(404).end(); if (f.mime === 'application/pdf') return res.type('png').sendFile(await planImage(f.id, +req.query.page || 1)); res.type(f.mime).sendFile(f.abs); }));

// ----- 제품 -----
const prodObj = r => ({ id: r.id, kind: r.kind, name: r.name, model: r.model, maker: r.maker, data: J(r.data), sort: r.sort, active: !!r.active });
app.get('/api/products', auth, (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY kind, sort, name').all().map(prodObj)));
app.post('/api/products', auth, (req, res) => {
  const b = req.body || {}; if (!b.name) return res.status(400).json({ error: '제품명을 입력하세요.' });
  const id = b.id && db.prepare('SELECT 1 FROM products WHERE id=?').get(b.id) ? b.id : uid();
  if (id === b.id) db.prepare("UPDATE products SET kind=?,name=?,model=?,maker=?,data=?,active=?,updated_at=datetime('now') WHERE id=?").run(b.kind || 'camera', b.name, b.model || '', b.maker || '', JSON.stringify(b.data || {}), b.active === false ? 0 : 1, id);
  else db.prepare('INSERT INTO products(id,kind,name,model,maker,data) VALUES(?,?,?,?,?,?)').run(id, b.kind || 'camera', b.name, b.model || '', b.maker || '', JSON.stringify(b.data || {}));
  res.json(prodObj(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
});

// ----- 제안서 -----
const propObj = r => r && ({ id: r.id, title: r.title, customer_name: r.customer_name, customer_phone: r.customer_phone, customer_address: r.customer_address, site_type: r.site_type, status: r.status, staff_id: r.staff_id, share_token: r.share_token, is_sample: !!r.is_sample, ver: r.ver, created_at: r.created_at, updated_at: r.updated_at, data: J(r.data) });
const FIELDS = ['title', 'customer_name', 'customer_phone', 'customer_address', 'site_type', 'status', 'staff_id'];
app.get('/api/proposals', auth, (req, res) => res.json(db.prepare('SELECT p.*, u.name staff_name FROM proposals p LEFT JOIN users u ON u.id=p.staff_id ORDER BY p.updated_at DESC').all().map(r => { const o = propObj(r); o.staff_name = r.staff_name; o.cam_count = (o.data.cams || []).length; delete o.data; return o; })));
app.post('/api/proposals', auth, (req, res) => {
  const b = req.body || {}; const id = uid();
  const data = b.data || { plans: [], cams: [], marks: [], quote: { vat: true, lines: [] }, options: { paper: 'A4', orient: 'landscape', show_detail: true, show_quote: true, show_notice: true }, date: new Date().toISOString().slice(0, 10) };
  db.prepare(`INSERT INTO proposals(id,${FIELDS.join(',')},data,is_sample) VALUES(?,${FIELDS.map(() => '?').join(',')},?,?)`).run(id, b.title || ((b.customer_name || '고객') + ' CCTV 설치 제안'), b.customer_name || '', b.customer_phone || '', b.customer_address || '', b.site_type || '', b.status || '작성 중', b.staff_id || req.user.id, JSON.stringify(data), b.is_sample ? 1 : 0);
  res.json({ id });
});
app.get('/api/proposals/:id', auth, (req, res) => { const p = propObj(db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id)); if (!p) return res.status(404).json({ error: '제안서가 없습니다.' }); res.json(p); });
app.put('/api/proposals/:id', auth, (req, res) => {
  const cur = db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id); if (!cur) return res.status(404).json({ error: '제안서가 없습니다.' });
  const b = req.body || {};
  if (b.ver != null && b.ver !== cur.ver && !b.force) return res.status(409).json({ error: '다른 직원이 먼저 수정했습니다. 새로 불러온 뒤 다시 수정하세요.', current: propObj(cur) });
  const sets = FIELDS.filter(k => k in b);
  db.prepare(`UPDATE proposals SET ${sets.map(k => k + '=?').concat(['data=?', 'ver=ver+1', "updated_at=datetime('now')"]).join(',')} WHERE id=?`).run(...sets.map(k => b[k]), JSON.stringify(b.data || J(cur.data)), cur.id);
  res.json({ ver: cur.ver + 1 });
});
app.delete('/api/proposals/:id', auth, (req, res) => { db.prepare('DELETE FROM proposals WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.post('/api/proposals/:id/copy', auth, (req, res) => { const c = db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id); if (!c) return res.status(404).end(); const id = uid(); db.prepare(`INSERT INTO proposals(id,${FIELDS.join(',')},data) VALUES(?,${FIELDS.map(() => '?').join(',')},?)`).run(id, c.title + ' (사본)', c.customer_name, c.customer_phone, c.customer_address, c.site_type, '작성 중', req.user.id, c.data); res.json({ id }); });
// 고객 공유 링크 (로그인 없이 보기 전용)
app.post('/api/proposals/:id/share', auth, (req, res) => { const t = req.body && req.body.revoke ? null : crypto.randomBytes(18).toString('base64url'); db.prepare('UPDATE proposals SET share_token=? WHERE id=?').run(t, req.params.id); res.json({ token: t }); });

// ----- 출력 -----
const PDF = require('./pdf');
async function renderFor(p, opts) {
  const products = db.prepare('SELECT * FROM products').all().map(prodObj);
  const staff = p.staff_id ? db.prepare('SELECT name, phone FROM users WHERE id=?').get(p.staff_id) : null;
  return PDF.render({ proposal: p, products, company: getSetting('company', {}), notices: getSetting('notices', {}), staff, opts: opts || {}, planImage, fileRow });
}
app.post('/api/proposals/:id/pdf', auth, wrap(async (req, res) => {
  const p = propObj(db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id)); if (!p) return res.status(404).end();
  const buf = await renderFor(p, req.body || {});
  res.type('pdf').setHeader('Content-Disposition', "attachment; filename=\"CCTV_proposal.pdf\"; filename*=UTF-8''" + encodeURIComponent(`${p.customer_name || '고객'}_CCTV설치제안서.pdf`)); res.send(buf);
}));
app.get('/api/proposals/:id/pdf', auth, wrap(async (req, res) => {
  const p = propObj(db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id)); if (!p) return res.status(404).end();
  let o = {}; try { o = JSON.parse(req.query.o || '{}'); } catch { }
  const buf = await renderFor(p, o); res.type('pdf').setHeader('Content-Disposition', "attachment; filename=\"CCTV_proposal.pdf\"; filename*=UTF-8''" + encodeURIComponent(`${p.customer_name || '고객'}_CCTV설치제안서.pdf`)); res.send(buf);
}));
// 휴대폰 미리보기: PDF를 쪽별 PNG 이미지로
app.post('/api/proposals/:id/preview', auth, wrap(async (req, res) => {
  const p = propObj(db.prepare('SELECT * FROM proposals WHERE id=?').get(req.params.id)); if (!p) return res.status(404).end();
  const buf = await renderFor(p, req.body || {}); const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pv-'));
  try { fs.writeFileSync(path.join(dir, 'a.pdf'), buf); await run('pdftoppm', ['-png', '-r', '80', path.join(dir, 'a.pdf'), path.join(dir, 'p')]);
    const pages = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64'));
    res.json({ pages }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));
const shared = t => t && propObj(db.prepare('SELECT * FROM proposals WHERE share_token=?').get(t));
app.get('/api/share/:t', (req, res) => {
  const p = shared(req.params.t); if (!p) return res.status(404).json({ error: '링크가 만료되었거나 잘못되었습니다.' });
  const products = db.prepare('SELECT * FROM products').all().map(prodObj); const staff = p.staff_id ? db.prepare('SELECT name, phone FROM users WHERE id=?').get(p.staff_id) : null;
  const { customer_phone, ...pub } = p; res.json({ proposal: pub, products, company: getSetting('company', {}), notices: getSetting('notices', {}), staff });
});
app.get('/api/share/:t/file/:fid', wrap(async (req, res) => {
  const p = shared(req.params.t); if (!p) return res.status(404).end();
  const d = p.data; const ok = (d.plans || []).some(x => x.file_id === req.params.fid) || (d.cams || []).some(c => c.photo_file_id === req.params.fid) || getSetting('company', {}).logo_file_id === req.params.fid || db.prepare("SELECT 1 FROM products WHERE data LIKE ?").get(`%${req.params.fid}%`);
  if (!ok) return res.status(403).end();
  const f = fileRow(req.params.fid); if (!f) return res.status(404).end();
  if (f.mime === 'application/pdf') return res.type('png').sendFile(await planImage(f.id, +req.query.page || 1)); res.type(f.mime).sendFile(f.abs);
}));
app.get('/api/share/:t/pdf', wrap(async (req, res) => { const p = shared(req.params.t); if (!p) return res.status(404).end(); const buf = await renderFor(p, p.data.options || {}); res.type('pdf').setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent('CCTV설치제안서.pdf')); res.send(buf); }));

app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/s/:t', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 's.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => { if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '파일이 너무 큽니다.' }); console.error(err); res.status(err.status || 500).json({ error: err.status ? err.message : '서버 오류: ' + err.message }); });

const PORT = +process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => {
  console.log(`CCTV 설치 제안서 프로그램: http://localhost:${PORT}`);
  if (process.env.SEED_SAMPLE === '1' && !db.prepare('SELECT 1 FROM proposals WHERE is_sample=1').get()) require('../scripts/sample').seed({ db, uid, storeFile, sizeOf }).then(id => console.log('[샘플] 제안서 생성', id)).catch(e => console.error('[샘플] 실패', e.message));
});
module.exports = { app, db };
