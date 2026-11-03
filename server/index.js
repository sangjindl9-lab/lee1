import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { db, all, get, run, J, token, audit, getSetting, setSetting, hashPw, checkPw, ensureAdmin, FILE_DIR, DATA_DIR } from './db.js';
import { compute, answers } from './compute.js';
import { evaluate, alternatives } from './engine/load.js';
import { runExtraction, aiConfigured, LOW_CONF } from './ai.js';
import { reportPdf, reportXlsx } from './report.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

const today = () => new Date().toISOString().slice(0, 10);
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- 인증 ----------
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))]; })); }
app.use((req, _res, next) => {
  const t = cookies(req).sid || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (t) {
    const s = get('SELECT u.*, s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', t);
    if (s && s.expires > new Date().toISOString()) { delete s.pw; req.user = s; req.sid = t; }
  }
  next();
});
const need = (...roles) => (req, res, next) => {
  if (!req.user) return bad(res, 401, '로그인이 필요합니다.');
  if (roles.length && !roles.includes(req.user.role)) return bad(res, 403, '권한이 없습니다.');
  next();
};
function startSession(res, userId, req) {
  const t = token(); const exp = new Date(Date.now() + 30 * 864e5).toISOString();
  run('INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)', t, userId, exp);
  res.setHeader('Set-Cookie', `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
  return t;
}
const tries = new Map();
app.post('/api/auth/login', (req, res) => {
  const { email, pw } = req.body || {};
  const k = req.ip + ':' + email; const t = tries.get(k) || { n: 0, at: Date.now() };
  if (t.n >= 8 && Date.now() - t.at < 10 * 60e3) return bad(res, 429, '로그인 시도가 많습니다. 10분 후 다시 시도하세요.');
  const u = get('SELECT * FROM users WHERE email=?', String(email || '').trim().toLowerCase());
  if (!u || !checkPw(String(pw || ''), u.pw)) { tries.set(k, { n: t.n + 1, at: Date.now() }); return bad(res, 401, '이메일 또는 비밀번호가 맞지 않습니다.'); }
  tries.delete(k);
  const tk = startSession(res, u.id, req);
  res.json({ ok: true, token: tk });
});
app.post('/api/auth/register', (req, res) => {
  const { email, pw, name, role, company_name, phone } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return bad(res, 400, '이메일 형식을 확인하세요.');
  if (String(pw || '').length < 8) return bad(res, 400, '비밀번호는 8자 이상이어야 합니다.');
  if (get('SELECT id FROM users WHERE email=?', e)) return bad(res, 409, '이미 가입된 이메일입니다.');
  const r = role === 'contractor' ? 'contractor' : 'user';
  let cid = null;
  if (r === 'contractor') {
    if (!company_name) return bad(res, 400, '업체명을 입력하세요.');
    cid = run('INSERT INTO companies (name, phone) VALUES (?,?)', company_name, phone || null).lastInsertRowid;
  }
  const id = run('INSERT INTO users (email, pw, name, role, company_id) VALUES (?,?,?,?,?)', e, hashPw(pw), name || null, r, cid).lastInsertRowid;
  audit(id, 'user', id, null, 'register', null, { role: r });
  const tk = startSession(res, id, req);
  res.json({ ok: true, token: tk });
});
app.post('/api/auth/logout', (req, res) => { if (req.sid) run('DELETE FROM sessions WHERE token=?', req.sid); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const c = req.user.company_id ? get('SELECT * FROM companies WHERE id=?', req.user.company_id) : null;
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, company: c, entitled: entitled(req.user) } });
});
function entitled(u) {
  if (u.role === 'admin') return true;
  if (u.plan_until && u.plan_until >= today()) return true;
  const c = u.company_id ? get('SELECT plan_until FROM companies WHERE id=?', u.company_id) : null;
  return !!(c?.plan_until && c.plan_until >= today());
}

app.get('/api/config', (_req, res) => {
  res.json({ service_name: getSetting('service_name', '이음전력 진단'), logo: getSetting('logo_file_id', null) ? '/api/logo' : null,
    operator: getSetting('operator', {}), ai: aiConfigured(), low_conf: LOW_CONF, payments: getSetting('payments_note', '결제 연동 전: 이용권은 관리자가 부여합니다.') });
});
app.get('/api/logo', (_req, res) => { const id = getSetting('logo_file_id'); const f = id && get('SELECT * FROM files WHERE id=?', id); if (!f) return res.sendStatus(404); res.type(f.mime).sendFile(f.path); });

// ---------- 접근 제어 ----------
export function canAccess(user, site) {
  if (!user || !site) return false;
  if (user.role === 'admin') return true;
  if (site.owner_id === user.id) return true;
  if (user.company_id && (site.company_id === user.company_id ||
    get('SELECT id FROM site_shares WHERE site_id=? AND company_id=? AND revoked_at IS NULL', site.id, user.company_id))) return true;
  return false;
}
const siteAccess = (req, res, next) => {
  if (!req.user) return bad(res, 401, '로그인이 필요합니다.');
  const s = get('SELECT * FROM sites WHERE id=?', Number(req.params.id));
  if (!s || !canAccess(req.user, s)) return bad(res, 404, '장소를 찾을 수 없거나 접근 권한이 없습니다.');
  req.site = s; next();
};
const maskAddr = (a) => { if (!a) return ''; const t = String(a).split(/\s+/); return t.length <= 2 ? t[0] + ' ***' : t.slice(0, 2).join(' ') + ' ***'; };
const maskNo = (v) => (v ? String(v).replace(/.(?=.{4})/g, '*') : v);
const touch = (id) => run('UPDATE sites SET updated_at=CURRENT_TIMESTAMP WHERE id=?', id);

// ---------- 장소 ----------
app.get('/api/sites', need(), (req, res) => {
  const u = req.user;
  const list = u.role === 'admin' ? all('SELECT * FROM sites ORDER BY updated_at DESC')
    : all(`SELECT * FROM sites WHERE owner_id=? OR (? IS NOT NULL AND (company_id=? OR id IN (SELECT site_id FROM site_shares WHERE company_id=? AND revoked_at IS NULL))) ORDER BY updated_at DESC`,
      u.id, u.company_id, u.company_id, u.company_id);
  res.json(list.map((s) => ({ id: s.id, name: s.name, address: s.owner_id === u.id ? s.address : maskAddr(s.address), mine: s.owner_id === u.id,
    industry: J(s.info).industry || '', contract_kw: J(s.info).contract_kw ?? null, updated_at: s.updated_at })));
});
app.post('/api/sites', need(), (req, res) => {
  const { name, address, info = {} } = req.body || {};
  if (!name) return bad(res, 400, '장소명을 입력하세요.');
  const cid = ['contractor', 'reviewer'].includes(req.user.role) ? req.user.company_id : null;
  const id = run('INSERT INTO sites (owner_id, company_id, name, address, info) VALUES (?,?,?,?,?)', req.user.id, cid, name, address || null, JSON.stringify(info)).lastInsertRowid;
  audit(req.user.id, 'site', id, id, 'create', null, { name, address, info });
  res.json({ id });
});
app.get('/api/sites/:id', siteAccess, (req, res) => {
  const s = req.site; const id = s.id; const mine = s.owner_id === req.user.id || req.user.role === 'admin';
  const info = J(s.info); if (!mine && info.customer_no) info.customer_no = maskNo(info.customer_no);
  const rows = (t) => all(`SELECT * FROM ${t} WHERE site_id=? ORDER BY id`, id).map((r) => ({ ...J(r.data), id: r.id, panel_id: r.panel_id, file_id: r.file_id, qr_token: r.qr_token }));
  res.json({
    id, name: s.name, address: s.address, info, assumptions: J(s.assumptions), ai_consent: !!s.ai_consent, ai_consent_at: s.ai_consent_at, mine,
    company_id: s.company_id,
    devices: rows('devices'), panels: rows('panels'), circuits: rows('circuits'), measurements: rows('measurements'),
    bills: all('SELECT * FROM bills WHERE site_id=? ORDER BY id', id).map((b) => { const d = J(b.data); if (!mine && d.customer_no) d.customer_no = maskNo(d.customer_no); return { ...d, id: b.id, file_id: b.file_id, confirmed: !!b.confirmed }; }),
    files: all('SELECT id, kind, name, mime, size, width, height, created_at FROM files WHERE site_id=? ORDER BY id DESC', id),
    extractions: all('SELECT * FROM extractions WHERE site_id=? ORDER BY id DESC', id).map((e) => ({ ...e, raw: undefined, fields: J(e.fields, []), findings: J(e.findings, []) })),
    reviews: all('SELECT r.*, u.name, u.role FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE site_id=? ORDER BY r.id DESC', id),
    shares: all('SELECT sh.*, c.name AS company FROM site_shares sh JOIN companies c ON c.id=sh.company_id WHERE site_id=? ORDER BY sh.id DESC', id),
    records: all('SELECT * FROM records WHERE site_id=? ORDER BY id DESC', id),
    reports: all('SELECT id, kind, created_at, created_by FROM reports WHERE site_id=? ORDER BY id DESC', id),
    consults: all('SELECT * FROM consults WHERE site_id=? ORDER BY id DESC', id),
  });
});
app.put('/api/sites/:id', siteAccess, (req, res) => {
  const s = req.site; const b = req.body || {};
  const before = { name: s.name, address: s.address, info: J(s.info), assumptions: J(s.assumptions), ai_consent: s.ai_consent };
  const info = b.info ? { ...J(s.info), ...b.info } : J(s.info);
  if (b.info && s.owner_id !== req.user.id && req.user.role !== 'admin' && /\*/.test(String(b.info.customer_no || ''))) info.customer_no = J(s.info).customer_no; // 마스킹값으로 덮어쓰기 방지
  const asm = b.assumptions ? { ...J(s.assumptions), ...b.assumptions } : J(s.assumptions);
  let consent = s.ai_consent; let consentAt = s.ai_consent_at;
  if (b.ai_consent !== undefined) {
    if (s.owner_id !== req.user.id && req.user.role !== 'admin') return bad(res, 403, '외부 AI 전송 동의는 장소 소유자만 바꿀 수 있습니다.');
    consent = b.ai_consent ? 1 : 0; consentAt = b.ai_consent ? new Date().toISOString() : null;
  }
  run('UPDATE sites SET name=?, address=?, info=?, assumptions=?, ai_consent=?, ai_consent_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    b.name ?? s.name, b.address ?? s.address, JSON.stringify(info), JSON.stringify(asm), consent, consentAt, s.id);
  audit(req.user.id, 'site', s.id, s.id, 'update', before, { name: b.name, address: b.address, info, assumptions: asm, ai_consent: consent });
  res.json({ ok: true });
});
app.delete('/api/sites/:id', siteAccess, (req, res) => {
  const s = req.site;
  if (s.owner_id !== req.user.id && req.user.role !== 'admin') return bad(res, 403, '장소 소유자만 삭제할 수 있습니다.');
  for (const f of all('SELECT path FROM files WHERE site_id=?', s.id)) fs.rmSync(f.path, { force: true });
  run('DELETE FROM sites WHERE id=?', s.id);
  audit(req.user.id, 'site', s.id, null, 'delete', { name: s.name }, null);
  res.json({ ok: true });
});
app.get('/api/sites/:id/export', siteAccess, (req, res) => {
  const id = req.site.id; const t = (n) => all(`SELECT * FROM ${n} WHERE site_id=?`, id);
  res.setHeader('Content-Disposition', `attachment; filename="site-${id}.json"`);
  res.json({ exported_at: new Date().toISOString(), site: { ...req.site, info: J(req.site.info) }, devices: t('devices'), panels: t('panels'), circuits: t('circuits'),
    measurements: t('measurements'), bills: t('bills'), files: all('SELECT id, kind, name, mime, size, created_at FROM files WHERE site_id=?', id), extractions: t('extractions'), reviews: t('reviews'), records: t('records'), reports: t('reports') });
});

// 하위 항목(기기·분전반·회로·실측·고지서) 공통 CRUD + 변경 기록
const CHILD = { devices: 'device', panels: 'panel', circuits: 'circuit', measurements: 'measurement', bills: 'bill' };
for (const [table, ent] of Object.entries(CHILD)) {
  app.post(`/api/sites/:id/${table}`, siteAccess, (req, res) => {
    const { panel_id, file_id, confirmed, ...data } = req.body || {};
    let id;
    if (table === 'circuits') {
      if (!get('SELECT id FROM panels WHERE id=? AND site_id=?', panel_id, req.site.id)) return bad(res, 400, '분전반을 먼저 선택하세요.');
      id = run('INSERT INTO circuits (site_id, panel_id, data) VALUES (?,?,?)', req.site.id, panel_id, JSON.stringify(data)).lastInsertRowid;
    } else if (table === 'panels') id = run('INSERT INTO panels (site_id, data, qr_token) VALUES (?,?,?)', req.site.id, JSON.stringify(data), token(12)).lastInsertRowid;
    else if (table === 'bills') id = run('INSERT INTO bills (site_id, file_id, data, confirmed, confirmed_by) VALUES (?,?,?,?,?)', req.site.id, file_id || null, JSON.stringify(data), confirmed ? 1 : 0, confirmed ? req.user.id : null).lastInsertRowid;
    else if (table === 'devices') id = run('INSERT INTO devices (site_id, file_id, data) VALUES (?,?,?)', req.site.id, file_id || null, JSON.stringify(data)).lastInsertRowid;
    else id = run(`INSERT INTO ${table} (site_id, data) VALUES (?,?)`, req.site.id, JSON.stringify(data)).lastInsertRowid;
    audit(req.user.id, ent, id, req.site.id, 'create', null, req.body); touch(req.site.id);
    res.json({ id });
  });
  app.put(`/api/sites/:id/${table}/:cid`, siteAccess, (req, res) => {
    const row = get(`SELECT * FROM ${table} WHERE id=? AND site_id=?`, Number(req.params.cid), req.site.id);
    if (!row) return bad(res, 404, '항목을 찾을 수 없습니다.');
    const { panel_id, file_id, confirmed, id: _i, ...data } = req.body || {};
    const merged = { ...J(row.data), ...data };
    run(`UPDATE ${table} SET data=? WHERE id=?`, JSON.stringify(merged), row.id);
    if (table === 'bills' && confirmed !== undefined) run('UPDATE bills SET confirmed=?, confirmed_by=? WHERE id=?', confirmed ? 1 : 0, req.user.id, row.id);
    if (table === 'circuits' && panel_id) run('UPDATE circuits SET panel_id=? WHERE id=? AND EXISTS (SELECT 1 FROM panels WHERE id=? AND site_id=?)', panel_id, row.id, panel_id, req.site.id);
    audit(req.user.id, ent, row.id, req.site.id, 'update', J(row.data), merged); touch(req.site.id);
    res.json({ ok: true });
  });
  app.delete(`/api/sites/:id/${table}/:cid`, siteAccess, (req, res) => {
    const row = get(`SELECT * FROM ${table} WHERE id=? AND site_id=?`, Number(req.params.cid), req.site.id);
    if (!row) return bad(res, 404, '항목을 찾을 수 없습니다.');
    if (table === 'panels') run('DELETE FROM circuits WHERE panel_id=?', row.id);
    if (table === 'circuits') for (const d of all('SELECT * FROM devices WHERE site_id=?', req.site.id)) { const dd = J(d.data); if (String(dd.circuit_id) === String(row.id)) { dd.circuit_id = null; run('UPDATE devices SET data=? WHERE id=?', JSON.stringify(dd), d.id); } }
    run(`DELETE FROM ${table} WHERE id=?`, row.id);
    audit(req.user.id, ent, row.id, req.site.id, 'delete', J(row.data), null); touch(req.site.id);
    res.json({ ok: true });
  });
}

// ---------- 파일(비공개 저장) ----------
const upload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
function sniff(p) {
  const b = Buffer.alloc(12); const fd = fs.openSync(p, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.slice(0, 4).toString() === '%PDF') return 'application/pdf';
  if (b.slice(4, 12).toString().startsWith('ftyphei') || b.slice(4, 12).toString().startsWith('ftypmif')) return 'image/heic';
  return null;
}
const KINDS = ['panel', 'main_breaker', 'branch_breaker', 'circuit_label', 'panel_inside', 'meter', 'nameplate', 'bill', 'drawing', 'before', 'after', 'logo', 'other'];
async function saveUpload(req, res, siteId) {
  const f = req.file;
  if (!f) { bad(res, 400, '파일이 없습니다.'); return null; }
  const mime = sniff(f.path);
  if (!mime || mime === 'image/heic') { fs.rmSync(f.path, { force: true }); bad(res, 415, mime === 'image/heic' ? 'HEIC 사진은 지원하지 않습니다. 카메라 설정을 "호환성 우선(JPG)"으로 바꾸거나 다시 촬영하세요.' : '지원하지 않는 파일 형식입니다(JPG·PNG·WEBP·PDF만 가능).'); return null; }
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'other';
  const dir = path.join(FILE_DIR, String(siteId ?? 'common')); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, token(16) + (mime === 'application/pdf' ? '.pdf' : '.img'));
  let width = null; let height = null;
  if (mime !== 'application/pdf') {
    try { const m = await sharp(f.path).metadata(); const rot = (m.orientation || 1) >= 5; width = rot ? m.height : m.width; height = rot ? m.width : m.height; }
    catch { fs.rmSync(f.path, { force: true }); bad(res, 400, '이미지 파일이 손상되어 열 수 없습니다. 다시 촬영하세요.'); return null; }
  }
  fs.renameSync(f.path, dest);
  const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
  const id = run('INSERT INTO files (site_id, owner_id, kind, name, mime, size, path, width, height) VALUES (?,?,?,?,?,?,?,?,?)', siteId, req.user.id, kind, name, mime, f.size, dest, width, height).lastInsertRowid;
  audit(req.user.id, 'file', id, siteId, 'upload', null, { kind, name, size: f.size });
  return { id, kind, name, mime, size: f.size, width, height };
}
const uploadMw = (req, res, next) => upload.single('file')(req, res, (err) => err ? bad(res, 400, err.code === 'LIMIT_FILE_SIZE' ? '파일이 15MB를 넘습니다.' : '업로드 오류: ' + err.message) : next());
app.post('/api/sites/:id/files', siteAccess, uploadMw, wrap(async (req, res) => { const f = await saveUpload(req, res, req.site.id); if (f) { touch(req.site.id); res.json(f); } }));
app.get('/api/files/:fid', need(), wrap(async (req, res) => {
  const f = get('SELECT * FROM files WHERE id=?', Number(req.params.fid));
  if (!f) return bad(res, 404, '파일 없음');
  const ok = f.site_id ? canAccess(req.user, get('SELECT * FROM sites WHERE id=?', f.site_id)) : (f.owner_id === req.user.id || req.user.role === 'admin' || f.kind === 'logo');
  if (!ok) return bad(res, 404, '파일 없음');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.query.w && f.mime !== 'application/pdf') {
    const w = Math.min(1600, Math.max(64, Number(req.query.w) || 400));
    return res.type('image/jpeg').send(await sharp(f.path).rotate().resize(w, w, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
  }
  if (f.mime !== 'application/pdf') return res.type('image/jpeg').send(await sharp(f.path).rotate().jpeg({ quality: 90 }).toBuffer());
  res.type(f.mime).sendFile(f.path);
}));
app.delete('/api/sites/:id/files/:fid', siteAccess, (req, res) => {
  const f = get('SELECT * FROM files WHERE id=? AND site_id=?', Number(req.params.fid), req.site.id);
  if (!f) return bad(res, 404, '파일 없음');
  fs.rmSync(f.path, { force: true }); run('DELETE FROM files WHERE id=?', f.id);
  audit(req.user.id, 'file', f.id, req.site.id, 'delete', { name: f.name }, null); res.json({ ok: true });
});

// ---------- 사진·고지서 분석 ----------
const TARGET_OF = { bill: 'bill', panel: 'panel', main_breaker: 'panel', branch_breaker: 'panel', circuit_label: 'panel', panel_inside: 'panel', nameplate: 'nameplate', meter: 'meter' };
app.post('/api/sites/:id/extract', siteAccess, wrap(async (req, res) => {
  const { file_id, target_id } = req.body || {};
  const f = get('SELECT * FROM files WHERE id=? AND site_id=?', Number(file_id), req.site.id);
  if (!f) return bad(res, 404, '파일 없음');
  const target = req.body.target || TARGET_OF[f.kind];
  if (!target) return bad(res, 400, '분석 대상이 아닌 파일입니다.');
  let out;
  if (!aiConfigured()) out = { status: 'not_configured', error: '사진 분석(AI) 미설정 — 값을 직접 입력하세요.' };
  else if (!req.site.ai_consent) out = { status: 'no_consent', error: '외부 AI 전송 동의가 없어 분석하지 않았습니다. 장소 정보에서 동의 후 다시 시도하거나 직접 입력하세요.' };
  else out = await runExtraction(target, f);
  const id = run('INSERT INTO extractions (site_id, file_id, target, target_id, provider, status, raw, fields, findings, error) VALUES (?,?,?,?,?,?,?,?,?,?)',
    req.site.id, f.id, target, target_id || null, out.provider || null, out.status, out.raw ? JSON.stringify(out.raw) : null,
    JSON.stringify(out.fields || []), JSON.stringify(out.findings || []), out.error || (out.unreadable?.length ? '확인 불가: ' + out.unreadable.join(', ') : null)).lastInsertRowid;
  audit(req.user.id, 'extraction', id, req.site.id, 'analyze', null, { file_id: f.id, target, status: out.status });
  res.json({ id, status: out.status, error: out.error || null, fields: out.fields || [], findings: out.findings || [], unreadable: out.unreadable || [] });
}));

// 사용자가 확인·수정한 값만 반영. 원본값·수정값·확인자 저장
app.post('/api/sites/:id/extractions/:eid/apply', siteAccess, (req, res) => {
  const ex = get('SELECT * FROM extractions WHERE id=? AND site_id=?', Number(req.params.eid), req.site.id);
  if (!ex || ex.status !== 'done') return bad(res, 400, '반영할 분석 결과가 없습니다.');
  const decisions = req.body.fields || []; // [{idx, status: confirmed|edited|rejected, value / fields}]
  const fields = J(ex.fields, []); const now = new Date().toISOString(); const sid = req.site.id;
  decisions.forEach((d) => {
    const f = fields[d.idx]; if (!f) return;
    f.status = d.status; f.confirmed_by = req.user.id; f.confirmed_at = now;
    if (d.status === 'edited') { if (ex.target === 'panel') { f.edited = d.fields; } else f.edited_value = d.value; }
    if (d.role) f.role = d.role; if (d.label !== undefined) f.label = d.label;
  });
  const accepted = fields.filter((f) => f.status === 'confirmed' || f.status === 'edited');
  const val = (f) => (f.status === 'edited' ? f.edited_value : f.value);
  const created = [];
  if (ex.target === 'panel') {
    let panelId = Number(req.body.panel_id) || ex.target_id;
    if (!panelId || !get('SELECT id FROM panels WHERE id=? AND site_id=?', panelId, sid)) panelId = run('INSERT INTO panels (site_id, data, qr_token) VALUES (?,?,?)', sid, JSON.stringify({ name: '분전반', photo_file_id: ex.file_id }), token(12)).lastInsertRowid;
    for (const b of accepted) {
      const bf = { ...(b.status === 'edited' ? b.edited : b.fields), source: 'photo', extraction_id: ex.id };
      if (b.role === 'main') {
        const p = get('SELECT * FROM panels WHERE id=?', panelId); const pd = J(p.data);
        audit(req.user.id, 'panel', panelId, sid, 'apply_extraction', pd, { ...pd, main_breaker: bf });
        run('UPDATE panels SET data=? WHERE id=?', JSON.stringify({ ...pd, main_breaker: bf, photo_file_id: pd.photo_file_id || ex.file_id }), panelId);
      } else {
        const cid = run('INSERT INTO circuits (site_id, panel_id, data) VALUES (?,?,?)', sid, panelId, JSON.stringify({ name: b.label || `회로 ${b.idx + 1}`, spare: b.spare, breaker: bf })).lastInsertRowid;
        created.push(cid); audit(req.user.id, 'circuit', cid, sid, 'apply_extraction', null, bf);
      }
    }
  } else if (ex.target === 'bill') {
    const data = { source: 'bill_photo', extraction_id: ex.id };
    for (const f of accepted) data[f.key] = val(f);
    const billId = ex.target_id && get('SELECT id FROM bills WHERE id=? AND site_id=?', ex.target_id, sid) ? ex.target_id : null;
    if (billId) { const b = get('SELECT * FROM bills WHERE id=?', billId); run('UPDATE bills SET data=?, confirmed=1, confirmed_by=? WHERE id=?', JSON.stringify({ ...J(b.data), ...data }), req.user.id, billId); }
    else created.push(run('INSERT INTO bills (site_id, file_id, data, confirmed, confirmed_by) VALUES (?,?,?,1,?)', sid, ex.file_id, JSON.stringify(data), req.user.id).lastInsertRowid);
    audit(req.user.id, 'bill', billId || created[0], sid, 'apply_extraction', null, data);
  } else if (ex.target === 'nameplate') {
    const map = { maker: 'maker', model: 'model', voltage: 'voltage', pf: 'pf', efficiency: 'efficiency', cooling_capacity: 'cooling_capacity_kw', heating_capacity: 'heating_capacity_kw', motor_output: 'motor_output_kw', rated_current: 'rated_current', start_current: 'start_current_a' };
    const data = { source: 'nameplate', extraction_id: ex.id };
    for (const f of accepted) {
      const v = val(f);
      if (f.key === 'power') { data.power_value = v; data.power_unit = f.unit === 'kW' ? 'kW' : 'W'; }
      else if (f.key === 'phase') data.phase = /3|삼/.test(String(v)) ? '3' : '1';
      else if (['cooling_capacity', 'heating_capacity', 'motor_output'].includes(f.key)) data[map[f.key]] = f.unit === 'W' ? Number(v) / 1000 : v;
      else if (f.key === 'start_current') { data.start_current_a = v; data.start_source = '명판'; }
      else if (map[f.key]) data[map[f.key]] = v;
    }
    const devId = ex.target_id && get('SELECT id FROM devices WHERE id=? AND site_id=?', ex.target_id, sid) ? ex.target_id : null;
    if (devId) { const d = get('SELECT * FROM devices WHERE id=?', devId); run('UPDATE devices SET data=? WHERE id=?', JSON.stringify({ ...J(d.data), ...data }), devId); audit(req.user.id, 'device', devId, sid, 'apply_extraction', J(d.data), data); }
    else { data.name = data.model || '명판 등록 기기'; data.qty = 1; data.status = req.body.status || 'current'; created.push(run('INSERT INTO devices (site_id, file_id, data) VALUES (?,?,?)', sid, ex.file_id, JSON.stringify(data)).lastInsertRowid); }
  } else if (ex.target === 'meter') {
    const data = { source: 'meter_photo', note: accepted.map((f) => `${f.label || f.key}: ${val(f)}${f.unit || ''}`).join(', ') };
    created.push(run('INSERT INTO measurements (site_id, data) VALUES (?,?)', sid, JSON.stringify(data)).lastInsertRowid);
  }
  run('UPDATE extractions SET fields=?, applied_by=?, applied_at=? WHERE id=?', JSON.stringify(fields), req.user.id, now, ex.id);
  audit(req.user.id, 'extraction', ex.id, sid, 'review', null, decisions); touch(sid);
  res.json({ ok: true, created });
});

// ---------- 계산 결과 ----------
app.get('/api/sites/:id/result', siteAccess, (req, res) => {
  const c = compute(req.site.id, { companyId: req.user.company_id });
  res.json({ ...c, answers: answers(c) });
});
app.post('/api/quick', (req, res) => { // 무료 간편 계산(저장 안 함)
  const { site = {}, devices = [], panels = [], circuits = [] } = req.body || {};
  const r = evaluate({ site, devices, panels, circuits });
  res.json({ result: r, alternatives: alternatives(r, devices) });
});

// 견적·한전 신청 조건·요금 조건
app.put('/api/sites/:id/quote', siteAccess, (req, res) => {
  const { items, kepco_req, tariff_req, confirmed } = req.body || {};
  const cid = req.user.company_id ?? req.site.company_id ?? null;
  if (confirmed && !['contractor', 'admin'].includes(req.user.role)) return bad(res, 403, '업체 확정 견적은 전기공사업체만 지정할 수 있습니다.');
  const q = get('SELECT * FROM quotes WHERE site_id=? AND company_id IS ?', req.site.id, cid);
  const next = { items: items ?? J(q?.items, []), kepco_req: kepco_req ?? J(q?.kepco_req), tariff_req: tariff_req ?? J(q?.tariff_req), confirmed: confirmed ? 1 : 0 };
  if (q) run('UPDATE quotes SET items=?, kepco_req=?, tariff_req=?, confirmed=?, created_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', JSON.stringify(next.items), JSON.stringify(next.kepco_req), JSON.stringify(next.tariff_req), next.confirmed, req.user.id, q.id);
  else run('INSERT INTO quotes (site_id, company_id, items, kepco_req, tariff_req, confirmed, created_by) VALUES (?,?,?,?,?,?,?)', req.site.id, cid, JSON.stringify(next.items), JSON.stringify(next.kepco_req), JSON.stringify(next.tariff_req), next.confirmed, req.user.id);
  audit(req.user.id, 'quote', q?.id, req.site.id, q ? 'update' : 'create', q ? { items: J(q.items), kepco_req: J(q.kepco_req), confirmed: q.confirmed } : null, next); touch(req.site.id);
  res.json({ ok: true });
});

// ---------- 검토 의견 ----------
app.post('/api/sites/:id/reviews', siteAccess, (req, res) => {
  if (!['reviewer', 'contractor', 'admin'].includes(req.user.role)) return bad(res, 403, '검토 담당자·업체만 의견을 남길 수 있습니다.');
  if (!req.body?.opinion) return bad(res, 400, '의견을 입력하세요.');
  const id = run('INSERT INTO reviews (site_id, user_id, opinion) VALUES (?,?,?)', req.site.id, req.user.id, req.body.opinion).lastInsertRowid;
  audit(req.user.id, 'review', id, req.site.id, 'create', null, req.body); res.json({ id });
});

// ---------- 보고서 ----------
function photoLines(siteId) {
  const ex = all("SELECT * FROM extractions WHERE site_id=? AND status='done' AND applied_at IS NOT NULL", siteId);
  return ex.map((e) => ({ file_id: e.file_id, lines: [`[${{ panel: '분전반·차단기', bill: '고지서', nameplate: '기기 명판', meter: '계량기' }[e.target]}] 분석 #${e.id}`,
    ...J(e.fields, []).filter((f) => f.status === 'confirmed' || f.status === 'edited').map((f) => e.target === 'panel'
      ? `${f.role === 'main' ? '주' : '분기'} ${f.label || ''} ${Object.entries(f.status === 'edited' ? f.edited : f.fields).filter(([, v]) => v != null && v !== false).map(([k, v]) => `${k}=${v}`).join(' ')} (${f.status === 'edited' ? '수정' : '확인'})`
      : `${f.label || f.key}: ${f.sensitive ? maskNo(f.status === 'edited' ? f.edited_value : f.value) : (f.status === 'edited' ? f.edited_value : f.value)}${f.unit || ''} (${f.status === 'edited' ? '수정, 원본 ' + f.original_value : '확인'} · 신뢰도 ${Math.round(f.confidence * 100)}%)`),
    ...J(e.findings, []).map((x) => `외관 의심: ${x.desc} — 현장 확인 필요`)] }));
}
app.post('/api/sites/:id/reports', siteAccess, (req, res) => {
  const kind = req.body?.kind === 'detail' ? 'detail' : 'basic';
  if (kind === 'detail' && !entitled(req.user)) return bad(res, 402, '상세 보고서는 이용권이 필요합니다. (결제 연동 전: 관리자에게 이용권 부여 요청)');
  const calc = compute(req.site.id, { companyId: req.user.company_id });
  const coId = req.user.company_id || req.site.company_id;
  const co = coId ? get('SELECT * FROM companies WHERE id=?', coId) : null;
  const logo = co?.logo_file ? get('SELECT path FROM files WHERE id=?', co.logo_file) : null;
  const snapshot = { created_at: new Date().toISOString(), service_name: getSetting('service_name', '이음전력 진단'), kind,
    company: co ? { name: co.name, phone: co.phone, address: co.address, quote_valid_days: co.quote_valid_days, logo_path: logo?.path || null } : null,
    masked_address: req.site.owner_id === req.user.id ? req.site.address : maskAddr(req.site.address),
    calc, answers: answers(calc), photos: kind === 'detail' ? photoLines(req.site.id) : [],
    reviews: all('SELECT r.opinion, r.created_at, u.name FROM reviews r LEFT JOIN users u ON u.id=r.user_id WHERE site_id=? ORDER BY r.id', req.site.id) };
  const id = run('INSERT INTO reports (site_id, created_by, kind, snapshot) VALUES (?,?,?,?)', req.site.id, req.user.id, kind, JSON.stringify(snapshot)).lastInsertRowid;
  audit(req.user.id, 'report', id, req.site.id, 'create', null, { kind, verdict: calc.result.verdict, versions: calc.versions });
  res.json({ id });
});
function reportFor(req, res) {
  const rep = get('SELECT * FROM reports WHERE id=?', Number(req.params.rid));
  if (!rep || !canAccess(req.user, get('SELECT * FROM sites WHERE id=?', rep.site_id))) { bad(res, 404, '보고서를 찾을 수 없습니다.'); return null; }
  return { ...rep, snapshot: J(rep.snapshot) };
}
app.get('/api/reports/:rid', need(), (req, res) => { const r = reportFor(req, res); if (r) res.json(r); });
app.get('/api/reports/:rid/pdf', need(), wrap(async (req, res) => {
  const r = reportFor(req, res); if (!r) return;
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="report-${r.id}.pdf"`);
  await reportPdf(r, res);
}));
app.get('/api/reports/:rid/xlsx', need(), wrap(async (req, res) => {
  const r = reportFor(req, res); if (!r) return;
  if (r.kind !== 'detail' && !entitled(req.user)) return bad(res, 402, 'Excel 내보내기는 상세 보고서(이용권)에서 제공됩니다.');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition', `attachment; filename="report-${r.id}.xlsx"`);
  res.send(Buffer.from(await reportXlsx(r)));
}));
app.post('/api/reports/:rid/share', need(), (req, res) => {
  const r = reportFor(req, res); if (!r) return;
  const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
  const t = token(18); const exp = new Date(Date.now() + days * 864e5).toISOString();
  run('INSERT INTO share_links (token, report_id, expires_at, created_by) VALUES (?,?,?,?)', t, r.id, exp, req.user.id);
  audit(req.user.id, 'share_link', r.id, r.site_id, 'create', null, { days });
  res.json({ url: `/s/${t}`, expires_at: exp });
});
app.get('/s/:token', wrap(async (req, res) => {
  const l = get('SELECT * FROM share_links WHERE token=?', req.params.token);
  if (!l || l.expires_at < new Date().toISOString()) return res.status(410).type('text/plain; charset=utf-8').send('공유 링크가 만료되었거나 없습니다.');
  run('UPDATE share_links SET views=views+1 WHERE token=?', l.token);
  const rep = get('SELECT * FROM reports WHERE id=?', l.report_id); const snap = J(rep.snapshot);
  snap.masked_address = maskAddr(snap.calc.bundle.site.address); // 공유본은 항상 마스킹
  res.type('application/pdf'); await reportPdf({ ...rep, snapshot: snap }, res);
}));

// ---------- 업체 공유(고객 동의)·상담 ----------
app.get('/api/companies', need(), (_req, res) => res.json(all('SELECT id, name, phone FROM companies ORDER BY name')));
app.post('/api/sites/:id/shares', siteAccess, (req, res) => {
  if (req.site.owner_id !== req.user.id) return bad(res, 403, '장소 소유자(고객)만 업체에 자료를 공유할 수 있습니다.');
  const co = get('SELECT id FROM companies WHERE id=?', Number(req.body?.company_id)); if (!co) return bad(res, 400, '업체를 선택하세요.');
  const id = run('INSERT INTO site_shares (site_id, company_id, consent_by) VALUES (?,?,?)', req.site.id, co.id, req.user.id).lastInsertRowid;
  audit(req.user.id, 'share', id, req.site.id, 'consent', null, { company_id: co.id }); res.json({ id });
});
app.delete('/api/sites/:id/shares/:sid', siteAccess, (req, res) => {
  if (req.site.owner_id !== req.user.id) return bad(res, 403, '장소 소유자만 철회할 수 있습니다.');
  run('UPDATE site_shares SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND site_id=?', Number(req.params.sid), req.site.id);
  audit(req.user.id, 'share', Number(req.params.sid), req.site.id, 'revoke', null, null); res.json({ ok: true });
});
app.post('/api/sites/:id/consults', siteAccess, (req, res) => {
  const id = run('INSERT INTO consults (site_id, user_id, company_id, message, phone) VALUES (?,?,?,?,?)', req.site.id, req.user.id, req.body?.company_id || null, req.body?.message || '', req.body?.phone || '').lastInsertRowid;
  audit(req.user.id, 'consult', id, req.site.id, 'create', null, req.body); res.json({ id });
});
app.get('/api/consults', need('contractor', 'reviewer', 'admin'), (req, res) => {
  const rows = req.user.role === 'admin' ? all('SELECT c.*, s.name AS site FROM consults c LEFT JOIN sites s ON s.id=c.site_id ORDER BY c.id DESC')
    : all('SELECT c.*, s.name AS site FROM consults c LEFT JOIN sites s ON s.id=c.site_id WHERE c.company_id=? ORDER BY c.id DESC', req.user.company_id);
  res.json(rows);
});
app.put('/api/consults/:cid', need('contractor', 'admin'), (req, res) => {
  run('UPDATE consults SET status=? WHERE id=? AND (company_id=? OR ?)', String(req.body?.status || '접수'), Number(req.params.cid), req.user.company_id, req.user.role === 'admin' ? 1 : 0); res.json({ ok: true });
});

// 공사 전후 사진·실제 비용 기록
app.post('/api/sites/:id/records', siteAccess, (req, res) => {
  const { kind, file_id, amount, note } = req.body || {};
  if (!['before', 'after', 'actual_cost', 'device_added', 'note'].includes(kind)) return bad(res, 400, '기록 종류 오류');
  const id = run('INSERT INTO records (site_id, kind, file_id, amount, note, created_by) VALUES (?,?,?,?,?,?)', req.site.id, kind, file_id || null, amount ?? null, note || null, req.user.id).lastInsertRowid;
  audit(req.user.id, 'record', id, req.site.id, 'create', null, req.body); res.json({ id });
});
app.get('/api/sites/:id/audit', siteAccess, (req, res) => res.json(all('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE site_id=? ORDER BY a.id DESC LIMIT 300', req.site.id)));

// QR 분전반 이력(토큰을 아는 사람만, 민감정보 제외)
app.get('/q/:token', (req, res) => {
  const p = get('SELECT * FROM panels WHERE qr_token=?', req.params.token);
  if (!p) return res.status(404).type('text/plain; charset=utf-8').send('등록되지 않은 QR입니다.');
  const pd = J(p.data); const s = get('SELECT * FROM sites WHERE id=?', p.site_id);
  const cs = all('SELECT * FROM circuits WHERE panel_id=? ORDER BY id', p.id).map((c) => J(c.data));
  const hist = all("SELECT action, entity, at FROM audit WHERE site_id=? AND entity IN ('panel','circuit','record','device') ORDER BY id DESC LIMIT 50", p.site_id);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const br = (b = {}) => [b.poles && b.poles + 'P', b.af && b.af + 'AF', b.at && b.at + 'AT', b.sens_ma && b.sens_ma + 'mA', b.ka && b.ka + 'kA'].filter(Boolean).join(' ') || '미확인';
  const ACT = { create: '등록', update: '수정', delete: '삭제', apply_extraction: '사진 추출값 반영' };
  res.type('html').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>분전반 이력</title>
<style>body{font:15px/1.5 system-ui,"Noto Sans KR",sans-serif;margin:0;padding:16px;background:#f5f6f4;color:#1b1f1d}h1{font-size:20px}table{width:100%;border-collapse:collapse;background:#fff}td,th{border:1px solid #ddd;padding:6px;text-align:left;font-size:14px}.m{color:#666;font-size:13px}</style></head><body>
<h1>${esc(pd.name || '분전반')}</h1><p class="m">${esc(s.name)} · ${esc(maskAddr(s.address))}<br>${esc(getSetting('service_name', '이음전력 진단'))} QR 이력 조회 — 실시간 계측 정보가 아닙니다.</p>
<p>주차단기: ${esc(br(pd.main_breaker))}</p><table><tr><th>회로</th><th>차단기</th></tr>${cs.map((c) => `<tr><td>${esc(c.name)}${c.spare ? ' (예비)' : ''}</td><td>${esc(br(c.breaker))}</td></tr>`).join('')}</table>
<h2 style="font-size:16px">변경 이력</h2><table>${hist.map((h) => `<tr><td>${esc(h.at)}</td><td>${esc({ panel: '분전반', circuit: '회로', record: '공사 기록', device: '기기' }[h.entity])} ${esc(ACT[h.action] || h.action)}</td></tr>`).join('') || '<tr><td>이력 없음</td></tr>'}</table></body></html>`);
});
app.get('/api/sites/:id/panels/:pid/qr.png', siteAccess, wrap(async (req, res) => {
  const p = get('SELECT * FROM panels WHERE id=? AND site_id=?', Number(req.params.pid), req.site.id); if (!p) return bad(res, 404, '없음');
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.type('png').send(await QRCode.toBuffer(`${base}/q/${p.qr_token}`, { width: 360, margin: 1 }));
}));

// ---------- 업체 설정 ----------
app.get('/api/company', need('contractor', 'reviewer'), (req, res) => res.json({ company: get('SELECT * FROM companies WHERE id=?', req.user.company_id),
  members: all('SELECT id, email, name, role FROM users WHERE company_id=?', req.user.company_id) }));
app.put('/api/company', need('contractor'), (req, res) => {
  const b = req.body || {}; const c = get('SELECT * FROM companies WHERE id=?', req.user.company_id);
  run('UPDATE companies SET name=?, phone=?, address=?, biz_no=?, quote_valid_days=?, logo_file=? WHERE id=?', b.name ?? c.name, b.phone ?? c.phone, b.address ?? c.address, b.biz_no ?? c.biz_no, b.quote_valid_days ?? c.quote_valid_days, b.logo_file ?? c.logo_file, c.id);
  audit(req.user.id, 'company', c.id, null, 'update', c, b); res.json({ ok: true });
});
app.post('/api/company/logo', need('contractor'), uploadMw, wrap(async (req, res) => {
  req.body.kind = 'logo'; const f = await saveUpload(req, res, null); if (!f) return;
  run('UPDATE companies SET logo_file=? WHERE id=?', f.id, req.user.company_id); res.json(f);
}));
app.post('/api/company/members', need('contractor'), (req, res) => {
  const { email, pw, name, role } = req.body || {}; const e = String(email || '').trim().toLowerCase();
  if (!e || String(pw || '').length < 8) return bad(res, 400, '이메일과 8자 이상 비밀번호를 입력하세요.');
  if (get('SELECT id FROM users WHERE email=?', e)) return bad(res, 409, '이미 가입된 이메일입니다.');
  const id = run('INSERT INTO users (email, pw, name, role, company_id) VALUES (?,?,?,?,?)', e, hashPw(pw), name || null, role === 'reviewer' ? 'reviewer' : 'contractor', req.user.company_id).lastInsertRowid;
  audit(req.user.id, 'user', id, null, 'create_member', null, { email: e, role }); res.json({ id });
});

// ---------- 단가·요율·기준(관리자 / 업체 단가) ----------
const MASTER = { rates_kepco: 'admin', rates_tariff: 'admin', standards: 'admin', device_refs: 'admin', unit_prices: 'company' };
for (const [t, scope] of Object.entries(MASTER)) {
  app.get(`/api/master/${t}`, need(), (req, res) => {
    const rows = t === 'unit_prices' ? all('SELECT * FROM unit_prices WHERE company_id IS NULL OR company_id=? ORDER BY id DESC', req.user.company_id ?? -1) : all(`SELECT * FROM ${t} ORDER BY id DESC`);
    res.json(rows.map((r) => ({ ...J(r.data), id: r.id, kind: r.kind, company_id: r.company_id, created_at: r.created_at })));
  });
  const canWrite = (req, row) => req.user?.role === 'admin' || (scope === 'company' && req.user?.role === 'contractor' && (!row || row.company_id === req.user.company_id));
  app.post(`/api/master/${t}`, need(), (req, res) => {
    if (!canWrite(req)) return bad(res, 403, '권한이 없습니다.');
    const { kind, id: _i, company_id: _c, ...data } = req.body || {};
    data.reviewed_by = data.reviewed_by || req.user.name || req.user.email; data.reviewed_at = data.reviewed_at || today();
    const id = t === 'standards' ? run('INSERT INTO standards (kind, data) VALUES (?,?)', kind || 'ampacity', JSON.stringify(data)).lastInsertRowid
      : t === 'unit_prices' ? run('INSERT INTO unit_prices (company_id, data) VALUES (?,?)', req.user.role === 'admin' && !req.body.mine ? null : req.user.company_id, JSON.stringify(data)).lastInsertRowid
        : run(`INSERT INTO ${t} (data) VALUES (?)`, JSON.stringify(data)).lastInsertRowid;
    audit(req.user.id, t, id, null, 'create', null, data); res.json({ id });
  });
  app.put(`/api/master/${t}/:mid`, need(), (req, res) => {
    const row = get(`SELECT * FROM ${t} WHERE id=?`, Number(req.params.mid)); if (!row) return bad(res, 404, '없음');
    if (!canWrite(req, row)) return bad(res, 403, '권한이 없습니다.');
    const { kind, id: _i, company_id: _c, created_at: _ca, ...data } = req.body || {};
    run(`UPDATE ${t} SET data=? WHERE id=?`, JSON.stringify(data), row.id);
    audit(req.user.id, t, row.id, null, 'update', J(row.data), data); res.json({ ok: true });
  });
  app.delete(`/api/master/${t}/:mid`, need(), (req, res) => {
    const row = get(`SELECT * FROM ${t} WHERE id=?`, Number(req.params.mid)); if (!row) return bad(res, 404, '없음');
    if (!canWrite(req, row)) return bad(res, 403, '권한이 없습니다.');
    run(`DELETE FROM ${t} WHERE id=?`, row.id); audit(req.user.id, t, row.id, null, 'delete', J(row.data), null); res.json({ ok: true });
  });
}

// ---------- 관리자 ----------
app.get('/api/admin/settings', need('admin'), (_req, res) => res.json({ service_name: getSetting('service_name', '이음전력 진단'), operator: getSetting('operator', {}), vat_rate: getSetting('vat_rate', 0.1), payments_note: getSetting('payments_note', '결제 연동 전: 이용권은 관리자가 부여합니다.'), logo_file_id: getSetting('logo_file_id') }));
app.put('/api/admin/settings', need('admin'), (req, res) => {
  const before = {}; for (const k of ['service_name', 'operator', 'vat_rate', 'payments_note']) if (req.body[k] !== undefined) { before[k] = getSetting(k); setSetting(k, req.body[k]); }
  audit(req.user.id, 'settings', null, null, 'update', before, req.body); res.json({ ok: true });
});
app.post('/api/admin/logo', need('admin'), uploadMw, wrap(async (req, res) => { req.body.kind = 'logo'; const f = await saveUpload(req, res, null); if (f) { setSetting('logo_file_id', f.id); res.json(f); } }));
app.get('/api/admin/users', need('admin'), (_req, res) => res.json({ users: all('SELECT u.id, u.email, u.name, u.role, u.company_id, u.plan_until, u.created_at, c.name AS company FROM users u LEFT JOIN companies c ON c.id=u.company_id ORDER BY u.id DESC'), companies: all('SELECT * FROM companies ORDER BY id DESC') }));
app.put('/api/admin/users/:uid', need('admin'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id=?', Number(req.params.uid)); if (!u) return bad(res, 404, '없음');
  const b = req.body || {};
  run('UPDATE users SET role=?, company_id=?, plan_until=? WHERE id=?', b.role ?? u.role, b.company_id === undefined ? u.company_id : b.company_id || null, b.plan_until === undefined ? u.plan_until : b.plan_until || null, u.id);
  audit(req.user.id, 'user', u.id, null, 'admin_update', { role: u.role, company_id: u.company_id, plan_until: u.plan_until }, b); res.json({ ok: true });
});
app.put('/api/admin/companies/:cid', need('admin'), (req, res) => {
  const c = get('SELECT * FROM companies WHERE id=?', Number(req.params.cid)); if (!c) return bad(res, 404, '없음');
  run('UPDATE companies SET plan_until=? WHERE id=?', req.body?.plan_until || null, c.id);
  audit(req.user.id, 'company', c.id, null, 'plan', { plan_until: c.plan_until }, req.body); res.json({ ok: true });
});
app.get('/api/admin/audit', need('admin'), (_req, res) => res.json(all('SELECT a.*, u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500')));
app.get('/api/admin/backup', need('admin'), (req, res) => { // DB 스냅샷(일관된 사본)
  const p = path.join(DATA_DIR, `backup-${Date.now()}.db`); db.exec(`VACUUM INTO '${p.replace(/'/g, "''")}'`);
  audit(req.user.id, 'backup', null, null, 'download', null, null);
  res.download(p, `jindan-${today()}.db`, () => fs.rmSync(p, { force: true }));
});

// ---------- 정적 파일 ----------
app.use(express.static(path.resolve('public'), { index: 'index.html', maxAge: '5m' }));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.resolve('public/index.html')));
app.use((err, _req, res, _next) => { console.error(err); bad(res, 500, '서버 오류: ' + err.message); });

ensureAdmin();
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => console.log(`이음전력 진단 서버 :${port}`));
}
export default app;
