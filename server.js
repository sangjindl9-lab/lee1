'use strict';
/* 현장별 공사관리 서버 — Express + SQLite
   - 실제 로그인(세션 쿠키, bcrypt 비밀번호)
   - 모든 읽기·쓰기에 서버측 권한 검사 (금액 정보는 권한 없는 사용자에게 아예 보내지 않음)
   - 동시 수정 충돌 방지(rev), 변경 기록(audit), 파일 원본 저장, 자동 백업 */
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
const BK = path.join(DATA, 'backups');
[DATA, UP, BK].forEach(d => fs.mkdirSync(d, { recursive: true }));

const db = new Database(path.join(DATA, 'app.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS records(col TEXT NOT NULL, id TEXT NOT NULL, site_id TEXT, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, updated_at TEXT, updated_by TEXT, PRIMARY KEY(col,id));
CREATE INDEX IF NOT EXISTS rec_site ON records(site_id);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, site_ids TEXT NOT NULL DEFAULT '[]', pw TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT, last_login TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id TEXT, user_name TEXT, action TEXT, col TEXT, rec_id TEXT, site_id TEXT, summary TEXT);
`);

/* ---------- 공통 ---------- */
const kst = () => new Date(Date.now() + 9 * 3600e3);
const nowStr = () => kst().toISOString().slice(0, 16).replace('T', ' ');
const today = () => kst().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
const E = (status, msg) => Object.assign(new Error(msg), { status });
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLS = ['sites', 'logs', 'labor', 'costs', 'subs', 'bills', 'docs', 'partners'];
const PERM_KEYS = ['viewMoney', 'allSites', 'editSites', 'editChanges', 'editLogs', 'editLabor', 'editCosts', 'editBills', 'editDocs', 'editPartners'];
const MONEY_SITE = ['primeInput', 'subInput', 'ourInput', 'rate', 'subMode', 'confirmedSupply', 'changes', 'history'];
const MONEY_DOC_CATS = ['계약서·변경계약서', '청구·정산 서류', '영수증·거래명세서'];
const ROLES = ['admin', 'office', 'field'];

const DEFAULT_SETTINGS = {
  company: process.env.COMPANY_NAME || '㈜에스에스전력',
  kinds: ['통신선로', '구내통신', 'CCTV', '방송·음향', '전기', '기타'],
  docCats: ['현장 사진', '계약서·변경계약서', '도면·시방서', '착공 서류', '준공 서류', '청구·정산 서류', '영수증·거래명세서', '회사 양식', '기타'],
  costCats: ['자재', '장비 임대료', '외주비', '운반비', '기타'],
  perms: {
    office: { viewMoney: true, allSites: true, editSites: true, editChanges: true, editLogs: true, editLabor: true, editCosts: true, editBills: true, editDocs: true, editPartners: true },
    field: { viewMoney: false, allSites: false, editSites: false, editChanges: false, editLogs: true, editLabor: false, editCosts: false, editBills: false, editDocs: true, editPartners: false }
  }
};

const q = {
  get: db.prepare('SELECT * FROM records WHERE col=? AND id=?'),
  all: db.prepare('SELECT * FROM records WHERE col=?'),
  ins: db.prepare('INSERT INTO records(col,id,site_id,data,rev,updated_at,updated_by) VALUES(?,?,?,?,1,?,?)'),
  upd: db.prepare('UPDATE records SET site_id=?, data=?, rev=rev+1, updated_at=?, updated_by=? WHERE col=? AND id=?'),
  del: db.prepare('DELETE FROM records WHERE col=? AND id=?'),
  bySite: db.prepare('SELECT * FROM records WHERE site_id=? AND col<>\'sites\''),
  audit: db.prepare('INSERT INTO audit(at,user_id,user_name,action,col,rec_id,site_id,summary) VALUES(?,?,?,?,?,?,?,?)')
};
const parse = r => r ? Object.assign(JSON.parse(r.data), { _rev: r.rev }) : null;
const rows = col => q.all.all(col).map(parse);

function getSettings() {
  let r = parse(q.get.get('settings', 'main'));
  if (!r) {
    q.ins.run('settings', 'main', null, JSON.stringify(DEFAULT_SETTINGS), nowStr(), 'system');
    r = parse(q.get.get('settings', 'main'));
  }
  return r;
}
getSettings();

/* 최초 관리자 */
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) { pw = crypto.randomBytes(6).toString('base64url'); fs.writeFileSync(path.join(DATA, 'initial-admin.txt'), `아이디 ${username}\n비밀번호 ${pw}\n`); }
  db.prepare('INSERT INTO users(id,username,name,role,site_ids,pw,active,must_change,created_at) VALUES(?,?,?,?,?,?,1,1,?)')
    .run(uid(), username, '관리자', 'admin', '[]', bcrypt.hashSync(pw, 10), nowStr());
  console.log(`[초기 관리자] 아이디 ${username} / 비밀번호 ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD 환경변수 값)' : pw} — 첫 로그인 때 변경해야 합니다.`);
}

const userRow = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const pubUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, siteIds: JSON.parse(u.site_ids || '[]'), active: !!u.active, mustChange: !!u.must_change, lastLogin: u.last_login || '' });
function perms(u) {
  const o = {};
  if (u.role === 'admin') { PERM_KEYS.forEach(k => o[k] = true); return o; }
  const p = (getSettings().perms || {})[u.role] || {};
  PERM_KEYS.forEach(k => o[k] = !!p[k]);
  return o;
}
function visibleSet(u, P) {
  const sites = rows('sites');
  const ids = new Set(u.siteIds);
  return new Set(sites.filter(s => P.allSites || ids.has(s.id)).map(s => s.id));
}
function stripSite(s) { const o = { ...s }; MONEY_SITE.forEach(k => delete o[k]); o._moneyHidden = true; return o; }
const docVisible = (d, P) => P.viewMoney || !(MONEY_DOC_CATS.includes(d.cat) || d.costId || d.billId || d.changeId || d.subId);

function buildState(uRow) {
  const u = pubUser(uRow), P = perms(u), vis = visibleSet(u, P);
  const inSite = r => vis.has(r.siteId);
  const settings = getSettings();
  const users = u.role === 'admin'
    ? db.prepare('SELECT * FROM users ORDER BY created_at').all().map(pubUser)
    : db.prepare('SELECT id,name,role FROM users WHERE active=1').all();
  return {
    me: { ...u, perms: P },
    settings,
    users,
    sites: rows('sites').filter(s => vis.has(s.id)).map(s => P.viewMoney ? s : stripSite(s)),
    logs: rows('logs').filter(inSite),
    labor: (P.viewMoney || P.editLabor) ? rows('labor').filter(inSite) : [],
    costs: (P.viewMoney || P.editCosts) ? rows('costs').filter(inSite) : [],
    subs: (P.viewMoney || P.editCosts) ? rows('subs').filter(inSite) : [],
    bills: (P.viewMoney || P.editBills) ? rows('bills').filter(inSite) : [],
    docs: rows('docs').filter(d => inSite(d) && docVisible(d, P)).map(d => { const o = { ...d }; if (o.file) o.file = { hasThumb: !!o.file.thumb }; return o; }),
    partners: rows('partners'),
    serverTime: nowStr()
  };
}

/* ---------- 쓰기 검증 ---------- */
const COL_PERM = { logs: 'editLogs', labor: 'editLabor', costs: 'editCosts', subs: 'editCosts', bills: 'editBills', docs: 'editDocs', partners: 'editPartners' };
const LABEL = { sites: '현장', logs: '작업일지', labor: '인건비', costs: '비용', subs: '외주 계약', bills: '청구', docs: '사진·서류', partners: '거래처', settings: '설정' };
const label = r => (r.name || r.worker || r.partner || (r.content || '').split('\n')[0] || (r.seq ? r.seq + '회 ' + (r.kind || '') : '') || r.id || '').toString().slice(0, 50);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pick = (o, ks) => { const r = {}; ks.forEach(k => { if (o && o[k] !== undefined) r[k] = o[k]; }); return r; };

function clean(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw E(400, '잘못된 데이터 형식입니다.');
  if (!ID_RE.test(String(rec.id || ''))) throw E(400, '기록 번호(id) 형식이 올바르지 않습니다.');
  const o = { ...rec }; delete o._rev; delete o._moneyHidden;
  return o;
}

function applyBatch(uRow, body) {
  const u = pubUser(uRow), P = perms(u);
  const vis = visibleSet(u, P);
  const upserts = body.upserts || {}, deletes = body.deletes || {};
  const touchedLogs = new Set(), filesToRemove = [];
  const by = u.name, at = nowStr();
  const audit = (action, col, id, siteId, summary) => q.audit.run(at, u.id, u.name, action, col, id, siteId || null, summary);
  const need = (k, what) => { if (!P[k]) throw E(403, `${what} 권한이 없습니다. 관리자에게 권한을 요청하세요.`); };
  const needSite = id => { if (id && !vis.has(id)) throw E(403, '이 현장에 대한 권한이 없습니다.'); };

  /* 삭제: 현장 먼저(연결 기록 함께 삭제) */
  for (const col of ['sites', ...COLS.filter(c => c !== 'sites')]) {
    for (const d of (deletes[col] || [])) {
      const row = q.get.get(col, String(d.id || ''));
      if (!row) continue;
      const old = parse(row);
      if (d._rev != null && d._rev !== row.rev) throw E(409, `다른 사용자가 먼저 이 ${LABEL[col]} 기록을 수정했습니다. 최신 내용을 불러왔으니 확인 후 다시 시도하세요.`);
      if (col === 'sites') {
        need('editSites', '현장 삭제'); needSite(old.id);
        for (const r of q.bySite.all(old.id)) { const x = parse(r); if (x.file) filesToRemove.push(x.file); }
        db.prepare("DELETE FROM records WHERE site_id=? AND col<>'sites'").run(old.id);
      } else {
        need(COL_PERM[col], `${LABEL[col]} 삭제`); if (col !== 'partners') needSite(old.siteId);
        if (col === 'docs' && old.file) filesToRemove.push(old.file);
        if (col === 'labor' && old.logId) touchedLogs.add(old.logId);
      }
      q.del.run(col, old.id);
      audit('삭제', col, old.id, old.siteId || (col === 'sites' ? old.id : null), `${LABEL[col]} 삭제: ${label(old)}`);
    }
  }

  /* 설정 */
  for (const rec of (upserts.settings || [])) {
    if (u.role !== 'admin') throw E(403, '설정은 관리자만 바꿀 수 있습니다.');
    const row = q.get.get('settings', 'main');
    if (rec._rev != null && row && rec._rev !== row.rev) throw E(409, '다른 관리자가 먼저 설정을 바꿨습니다. 최신 설정을 불러왔으니 다시 확인하세요.');
    const o = clean({ ...rec, id: 'main' }); delete o.id;
    const s = { company: String(o.company || '').slice(0, 60), kinds: [].concat(o.kinds || []).map(String).slice(0, 100), docCats: [].concat(o.docCats || []).map(String).slice(0, 100), costCats: [].concat(o.costCats || []).map(String).slice(0, 100), perms: {} };
    for (const r of ['office', 'field']) { s.perms[r] = {}; PERM_KEYS.forEach(k => s.perms[r][k] = !!((o.perms || {})[r] || {})[k]); }
    q.upd.run(null, JSON.stringify(s), at, by, 'settings', 'main');
    audit('수정', 'settings', 'main', null, '설정 변경');
  }

  /* 추가·수정 */
  for (const col of COLS) {
    for (const raw of (upserts[col] || [])) {
      const rec = clean(raw);
      const row = q.get.get(col, rec.id);
      const old = parse(row);
      if (old && raw._rev !== row.rev) throw E(409, `다른 사용자가 먼저 이 ${LABEL[col]} 기록(${label(old)})을 수정했습니다. 최신 내용을 불러왔으니 확인 후 다시 입력하세요.`);
      if (!old && raw._rev != null) throw E(409, `이 ${LABEL[col]} 기록은 이미 삭제되었습니다. 최신 내용을 불러왔습니다.`);
      let siteId = col === 'sites' ? rec.id : (rec.siteId || null);

      if (col === 'sites') {
        if (!String(rec.name || '').trim()) throw E(400, '공사명이 비어 있습니다.');
        if (!old) {
          need('editSites', '현장 등록');
          if (!P.viewMoney) MONEY_SITE.forEach(k => delete rec[k]);
        } else {
          needSite(old.id);
          if (!P.viewMoney) Object.assign(rec, pick(old, MONEY_SITE));
          const keys = new Set([...Object.keys(old), ...Object.keys(rec)].filter(k => k !== '_rev'));
          const changedKeys = [...keys].filter(k => !same(old[k], rec[k]));
          const info = changedKeys.filter(k => !MONEY_SITE.includes(k));
          const money = changedKeys.filter(k => MONEY_SITE.includes(k) && k !== 'changes' && k !== 'history');
          const chg = changedKeys.filter(k => k === 'changes');
          if (info.length || money.length) need('editSites', '현장 수정');
          if (chg.length) need('editChanges', '계약 변경 관리');
          if (changedKeys.includes('history') && !P.editSites && !P.editChanges) throw E(403, '현장 수정 권한이 없습니다.');
          if (!changedKeys.length) continue;
        }
      } else {
        need(COL_PERM[col], `${LABEL[col]} 저장`);
        if (col !== 'partners') {
          if (!siteId || !q.get.get('sites', siteId)) throw E(400, `${LABEL[col]}의 현장이 지정되지 않았거나 삭제된 현장입니다.`);
          needSite(siteId); if (old) needSite(old.siteId);
        } else siteId = null;
        if (col === 'docs') { rec.file = old ? old.file : null; if (!old) { rec.author = by; } }
        if (col === 'labor') { if (rec.logId) touchedLogs.add(rec.logId); if (old && old.logId) touchedLogs.add(old.logId); }
        if (col === 'logs' && !old) { rec.author = rec.author || by; }
        if (old && same({ ...old, _rev: undefined }, { ...rec, _rev: undefined })) continue;
      }
      if (!old) {
        q.ins.run(col, rec.id, siteId, JSON.stringify(rec), at, by);
        if (col === 'sites') vis.add(rec.id);
        if (col === 'sites' && !P.allSites) {
          const ids = JSON.parse(uRow.site_ids || '[]'); ids.push(rec.id);
          db.prepare('UPDATE users SET site_ids=? WHERE id=?').run(JSON.stringify(ids), u.id); vis.add(rec.id);
        }
        audit('등록', col, rec.id, siteId, `${LABEL[col]} 등록: ${label(rec)}`);
      } else {
        q.upd.run(siteId, JSON.stringify(rec), at, by, col, rec.id);
        audit('수정', col, rec.id, siteId, `${LABEL[col]} 수정: ${label(rec)}`);
      }
    }
  }

  /* 작업일지 공수 중복 반영 방지 */
  for (const logId of touchedLogs) {
    const log = parse(q.get.get('logs', logId));
    if (!log || log.manDays == null) continue;
    const used = rows('labor').filter(l => l.logId === logId && l.unit === '공수').reduce((a, l) => a + (Number(l.qty) || 0), 0);
    if (used > Number(log.manDays) + 1e-9) throw E(400, `작업일지(${log.date})의 공수는 ${log.manDays}인데 인건비로 ${used}공수가 잡혀 있습니다. 같은 인건비가 두 번 계산되지 않도록 공수를 줄여 주세요.`);
  }
  return filesToRemove;
}
function removeFiles(list) { for (const f of list) for (const n of [f.stored, f.thumb]) if (n) fs.rm(path.join(UP, path.basename(n)), { force: true }, () => {}); }

/* ---------- 앱 ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.json({ limit: '10mb' }));

function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function setSid(req, res, token, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
app.use((req, res, next) => {
  const t = cookies(req).sid;
  if (t) {
    const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(t);
    if (s && s.expires > Date.now()) { const u = userRow(s.user_id); if (u && u.active) { req.user = u; req.token = t; } }
  }
  next();
});
/* CSRF 방지: 상태를 바꾸는 요청은 앱이 붙이는 헤더가 있어야 함 */
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: '잘못된 요청입니다.' });
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: '로그인이 필요합니다.' });
const admin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: '관리자만 할 수 있습니다.' });
const send = (res, fn) => { try { fn(); } catch (e) { console.error(e.message); res.status(e.status || 500).json({ error: e.status ? e.message : '서버 오류가 났습니다. 잠시 뒤 다시 시도하세요.' }); } };

/* 로그인 */
const tries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, t = tries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 10) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요.' });
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.pw)) { t.n++; tries.set(ip, t); return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }); }
  tries.delete(ip);
  const token = crypto.randomBytes(32).toString('hex'), days = 30;
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token, u.id, Date.now() + days * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(nowStr(), u.id);
  setSid(req, res, token, days * 86400);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { if (req.token) db.prepare('DELETE FROM sessions WHERE token=?').run(req.token); setSid(req, res, '', 0); res.json({ ok: true }); });
app.post('/api/me/password', auth, (req, res) => {
  const { current, next: nw } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.pw)) return res.status(400).json({ error: '지금 비밀번호가 맞지 않습니다.' });
  if (String(nw || '').length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
  db.prepare('UPDATE users SET pw=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(String(nw), 10), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, req.token);
  res.json({ ok: true });
});

/* 상태·저장 */
app.get('/api/state', auth, (req, res) => send(res, () => res.json(buildState(req.user))));
app.post('/api/batch', auth, (req, res) => {
  let files = [];
  try {
    db.transaction(() => { files = applyBatch(req.user, req.body || {}); })();
    removeFiles(files);
    res.json({ ok: true, state: buildState(userRow(req.user.id)) });
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : '저장 중 서버 오류가 났습니다. 다시 시도하세요.', state: buildState(userRow(req.user.id)) });
  }
});

/* 파일 */
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (req, f, cb) => cb(null, uid() + path.extname(Buffer.from(f.originalname, 'latin1').toString('utf8')).slice(0, 10).replace(/[^.A-Za-z0-9]/g, '')) }),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 }
});
app.post('/api/files', auth, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const f = (req.files && req.files.file || [])[0], th = (req.files && req.files.thumb || [])[0];
  const cleanup = () => removeFiles([{ stored: f && f.filename, thumb: th && th.filename }]);
  try {
    if (!f) throw E(400, '파일이 없습니다.');
    const u = pubUser(req.user), P = perms(u);
    if (!P.editDocs) throw E(403, '사진·서류 등록 권한이 없습니다.');
    let meta = {}; try { meta = JSON.parse(req.body.meta || '{}'); } catch (e) { }
    const vis = visibleSet(u, P);
    if (!meta.siteId || !vis.has(meta.siteId)) throw E(403, '이 현장에 파일을 올릴 권한이 없습니다.');
    const doc = {
      id: uid(), siteId: meta.siteId, cat: String(meta.cat || '기타'), phase: String(meta.phase || ''), desc: String(meta.desc || '').slice(0, 300),
      name: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200), size: f.size, type: f.mimetype || '',
      author: u.name, date: today(), created: Date.now(), file: { stored: f.filename, thumb: th ? th.filename : null }
    };
    ['logId', 'changeId', 'costId', 'billId', 'subId'].forEach(k => { if (meta[k] && ID_RE.test(meta[k])) doc[k] = meta[k]; });
    q.ins.run('docs', doc.id, doc.siteId, JSON.stringify(doc), nowStr(), u.name);
    q.audit.run(nowStr(), u.id, u.name, '등록', 'docs', doc.id, doc.siteId, `파일 등록: ${doc.name}`);
    const out = { ...doc, _rev: 1, file: { hasThumb: !!doc.file.thumb } };
    res.json({ ok: true, doc: out });
  } catch (e) { cleanup(); res.status(e.status || 500).json({ error: e.status ? e.message : '파일 저장 중 오류가 났습니다.' }); }
});
app.get('/api/files/:id', auth, (req, res) => {
  const d = parse(q.get.get('docs', req.params.id));
  const u = pubUser(req.user), P = perms(u);
  if (!d || !d.file || !visibleSet(u, P).has(d.siteId) || !docVisible(d, P)) return res.status(404).send('파일을 찾을 수 없거나 권한이 없습니다.');
  const name = req.query.thumb && d.file.thumb ? d.file.thumb : d.file.stored;
  const p = path.join(UP, path.basename(name));
  if (!fs.existsSync(p)) return res.status(404).send('파일이 서버에 없습니다.');
  res.set('Content-Type', req.query.thumb && d.file.thumb ? 'image/jpeg' : (d.type || 'application/octet-stream'));
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  res.set('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(p).pipe(res);
});

/* 사용자 관리 (관리자) */
function userInput(b, isNew) {
  const name = String(b.name || '').trim(), username = String(b.username || '').trim(), role = String(b.role || '');
  if (!name) throw E(400, '이름을 입력하세요.');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) throw E(400, '아이디는 영문·숫자·. _ - 로 3~30자여야 합니다.');
  if (!ROLES.includes(role)) throw E(400, '역할이 올바르지 않습니다.');
  if (isNew && String(b.password || '').length < 8) throw E(400, '처음 비밀번호는 8자 이상이어야 합니다.');
  const siteIds = [].concat(b.siteIds || []).filter(x => ID_RE.test(x));
  return { name, username, role, siteIds, active: b.active !== false };
}
const adminCount = (exceptId) => db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id<>?").get(exceptId || '').n;
app.post('/api/users', auth, admin, (req, res) => send(res, () => {
  const v = userInput(req.body || {}, true);
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(v.username)) throw E(400, '이미 있는 아이디입니다.');
  const id = uid();
  db.prepare('INSERT INTO users(id,username,name,role,site_ids,pw,active,must_change,created_at) VALUES(?,?,?,?,?,?,?,1,?)')
    .run(id, v.username, v.name, v.role, JSON.stringify(v.siteIds), bcrypt.hashSync(String(req.body.password), 10), v.active ? 1 : 0, nowStr());
  q.audit.run(nowStr(), req.user.id, req.user.name, '등록', 'users', id, null, `사용자 등록: ${v.name}(${v.username})`);
  res.json({ ok: true, state: buildState(req.user) });
}));
app.put('/api/users/:id', auth, admin, (req, res) => send(res, () => {
  const u = userRow(req.params.id); if (!u) throw E(404, '사용자를 찾을 수 없습니다.');
  const v = userInput(req.body || {}, false);
  const dup = db.prepare('SELECT id FROM users WHERE username=?').get(v.username); if (dup && dup.id !== u.id) throw E(400, '이미 있는 아이디입니다.');
  if (u.role === 'admin' && (v.role !== 'admin' || !v.active) && adminCount(u.id) === 0) throw E(400, '활성 관리자가 최소 1명은 있어야 합니다.');
  db.prepare('UPDATE users SET username=?, name=?, role=?, site_ids=?, active=? WHERE id=?').run(v.username, v.name, v.role, JSON.stringify(v.siteIds), v.active ? 1 : 0, u.id);
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw E(400, '비밀번호는 8자 이상이어야 합니다.');
    db.prepare('UPDATE users SET pw=?, must_change=1 WHERE id=?').run(bcrypt.hashSync(String(req.body.password), 10), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  }
  if (!v.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  q.audit.run(nowStr(), req.user.id, req.user.name, '수정', 'users', u.id, null, `사용자 수정: ${v.name}${req.body.password ? ' (비밀번호 초기화)' : ''}`);
  res.json({ ok: true, state: buildState(userRow(req.user.id)) });
}));
app.delete('/api/users/:id', auth, admin, (req, res) => send(res, () => {
  const u = userRow(req.params.id); if (!u) throw E(404, '사용자를 찾을 수 없습니다.');
  if (u.id === req.user.id) throw E(400, '자기 자신은 삭제할 수 없습니다.');
  if (u.role === 'admin' && adminCount(u.id) === 0) throw E(400, '마지막 관리자는 삭제할 수 없습니다.');
  db.prepare('DELETE FROM users WHERE id=?').run(u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  q.audit.run(nowStr(), req.user.id, req.user.name, '삭제', 'users', u.id, null, `사용자 삭제: ${u.name}`);
  res.json({ ok: true, state: buildState(req.user) });
}));

/* 변경 기록 */
app.get('/api/audit', auth, (req, res) => {
  const u = pubUser(req.user), P = perms(u);
  if (u.role !== 'admin' && !P.viewMoney) return res.status(403).json({ error: '변경 기록을 볼 권한이 없습니다.' });
  const site = req.query.site;
  const list = site
    ? (visibleSet(u, P).has(site) ? db.prepare('SELECT * FROM audit WHERE site_id=? ORDER BY id DESC LIMIT 300').all(site) : [])
    : (u.role === 'admin' ? db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all() : []);
  res.json({ list });
});

/* 백업 */
function dump() {
  return {
    app: 'gongsa-manager', version: 1, createdAt: nowStr(),
    records: db.prepare('SELECT col,id,site_id,data,rev,updated_at,updated_by FROM records').all(),
    users: db.prepare('SELECT * FROM users').all()
  };
}
function restore(d) {
  if (!d || d.app !== 'gongsa-manager' || !Array.isArray(d.records) || !Array.isArray(d.users)) throw E(400, '이 프로그램의 백업 파일이 아닙니다.');
  if (!d.users.some(u => u.role === 'admin' && u.active)) throw E(400, '백업에 활성 관리자 계정이 없습니다.');
  db.transaction(() => {
    db.exec('DELETE FROM records; DELETE FROM users; DELETE FROM sessions;');
    const ir = db.prepare('INSERT INTO records(col,id,site_id,data,rev,updated_at,updated_by) VALUES(@col,@id,@site_id,@data,@rev,@updated_at,@updated_by)');
    d.records.forEach(r => ir.run(r));
    const iu = db.prepare('INSERT INTO users(id,username,name,role,site_ids,pw,active,must_change,created_at,last_login) VALUES(@id,@username,@name,@role,@site_ids,@pw,@active,@must_change,@created_at,@last_login)');
    d.users.forEach(u => iu.run({ last_login: null, ...u }));
  })();
  getSettings();
}
app.get('/api/backup.json', auth, admin, (req, res) => {
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('공사관리_데이터백업_' + today() + '.json')}`);
  res.json(dump());
});
app.get('/api/backup.zip', auth, admin, (req, res) => {
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('공사관리_전체백업_' + today() + '.zip')}`);
  const z = archiver('zip', { zlib: { level: 6 } });
  z.on('error', e => { console.error(e); res.end(); });
  z.pipe(res);
  z.append(JSON.stringify(dump()), { name: 'backup.json' });
  z.directory(UP, 'uploads');
  z.finalize();
});
const restoreUp = multer({ dest: path.join(DATA, 'tmp'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
app.post('/api/restore', auth, admin, restoreUp.single('file'), (req, res) => send(res, () => {
  if (!req.file) throw E(400, '백업 파일을 선택하세요.');
  try {
    const head = fs.readFileSync(req.file.path).subarray(0, 2).toString('latin1');
    let d, zip = null;
    if (head === 'PK') { zip = new AdmZip(req.file.path); const e = zip.getEntry('backup.json'); if (!e) throw E(400, '압축 파일 안에 backup.json이 없습니다.'); d = JSON.parse(e.getData().toString('utf8')); }
    else { try { d = JSON.parse(fs.readFileSync(req.file.path, 'utf8')); } catch (e) { throw E(400, '백업 파일을 읽을 수 없습니다.'); } }
    fs.writeFileSync(path.join(BK, `before-restore-${Date.now()}.json`), JSON.stringify(dump()));
    restore(d);
    let nFiles = 0;
    if (zip) for (const e of zip.getEntries()) if (!e.isDirectory && e.entryName.startsWith('uploads/')) { fs.writeFileSync(path.join(UP, path.basename(e.entryName)), e.getData()); nFiles++; }
    res.json({ ok: true, files: nFiles });
  } finally { fs.rm(req.file.path, { force: true }, () => {}); }
}));
app.get('/api/backups', auth, admin, (req, res) => {
  const list = fs.readdirSync(BK).filter(f => f.endsWith('.json')).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(BK, f)).size }));
  res.json({ list });
});
app.get('/api/backups/:name', auth, admin, (req, res) => {
  const p = path.join(BK, path.basename(req.params.name));
  if (!fs.existsSync(p)) return res.status(404).send('없는 백업입니다.');
  res.download(p);
});
function autoBackup() {
  const name = `auto-${today()}.json`, p = path.join(BK, name);
  if (fs.existsSync(p) || kst().getUTCHours() < 3) return;
  fs.writeFileSync(p, JSON.stringify(dump()));
  const autos = fs.readdirSync(BK).filter(f => f.startsWith('auto-')).sort();
  autos.slice(0, Math.max(0, autos.length - 30)).forEach(f => fs.rmSync(path.join(BK, f), { force: true }));
  console.log('[자동 백업]', name);
}
setInterval(autoBackup, 30 * 60e3); setTimeout(autoBackup, 10e3);

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`공사관리 서버 실행: http://localhost:${PORT}  (데이터 폴더: ${DATA})`));
