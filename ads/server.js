// 이음 앱 배너 광고 서버 — 배너 목록 API + 관리자 페이지. 데이터는 DATA_DIR(기본 /data)에 JSON·이미지로 저장.
import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHmac, createHash, randomBytes } from 'node:crypto';

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || '/data';
const PASS = process.env.ADMIN_PASSWORD || 'eum1234';
const SECRET = process.env.SESSION_SECRET || randomBytes(16).toString('hex');
mkdirSync(join(DATA, 'img'), { recursive: true });
const DB = join(DATA, 'banners.json');
const load = () => (existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf8')) : { banners: [] });
const save = (db) => writeFileSync(DB, JSON.stringify(db, null, 1));
const sign = (v) => v + '.' + createHmac('sha256', SECRET).update(v).digest('hex').slice(0, 24);
const ok = (c) => { if (!c) return false; const [v, s] = c.split('.'); return sign(v) === c && Date.now() - Number(v) < 30 * 864e5; };

const app = express();
app.use(express.json());
// 앱(WebView: https://localhost 등)이 다른 출처에서 /api 를 부르므로 CORS 허용
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cookieParser());
app.use('/img', express.static(join(DATA, 'img'), { maxAge: '1d' }));
app.use(express.static('public'));

// ── 신규 설치자 집계(중복 제외) ──
// 앱이 켜질 때 부르는 /api/banners·/api/version 요청으로 기기를 구분한다.
// 기기 키: 앱이 보내는 무작위 설치 ID(?id=), 없으면 IP+User-Agent 해시(근사치). 개인정보는 저장하지 않는다.
const APPS_OK = ['eum-zip', 'eum-viewer', 'eum-docs'];
const INST = join(DATA, 'installs.json');
let inst = existsSync(INST) ? JSON.parse(readFileSync(INST, 'utf8')) : {}; // {app:{seen:{key:day}, days:{day:{n,a:{key:1}}}}}
let instDirty = false;
setInterval(() => { if (instDirty) { instDirty = false; writeFileSync(INST, JSON.stringify(inst)); } }, 5000);
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function seen(req, appId) {
  if (!APPS_OK.includes(appId)) return;
  const raw = String(req.query.id || '');
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const key = /^[A-Za-z0-9-]{8,64}$/.test(raw) ? 'i:' + raw
    : 'h:' + createHash('sha256').update(ip + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 16);
  const a = (inst[appId] ||= { seen: {}, days: {} });
  const d = kstDay();
  const day = (a.days[d] ||= { n: 0, a: {} });
  if (!a.seen[key]) { a.seen[key] = d; day.n++; instDirty = true; }
  if (!day.a[key]) { day.a[key] = 1; instDirty = true; }
}
app.get('/api/hello', (req, res) => { seen(req, String(req.query.app || '')); res.json({ ok: true }); });

// ── 앱이 쓰는 API ──
const today = () => new Date().toISOString().slice(0, 10);
app.get('/api/banners', (req, res) => {
  const appId = req.query.app || 'eum-viewer';
  seen(req, appId);
  const d = today();
  const list = load().banners
    .filter((b) => b.active && (b.apps || ['eum-viewer']).includes(appId) && (!b.start || b.start <= d) && (!b.end || b.end >= d))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((b) => ({ id: b.id, slot: b.slot, title: b.title, image: '/img/' + b.image, link: b.link, bg: b.bg || '' }));
  res.set('Cache-Control', 'private, max-age=60'); // 길게 캐시하면 실행 집계가 빠진다
  res.json(list);
});
// 앱 최신 버전 안내: 앱이 켜질 때 받아서 자기 versionCode 보다 크면 "업데이트" 안내를 띄운다.
const VER = join(DATA, 'versions.json');
const loadVer = () => (existsSync(VER) ? JSON.parse(readFileSync(VER, 'utf8')) : {});
app.get('/api/version', (req, res) => {
  seen(req, String(req.query.app || ''));
  res.set('Cache-Control', 'private, max-age=60');
  res.json(loadVer()[req.query.app] || { code: 0 });
});
app.post('/api/banners/:id/:kind(imp|click)', (req, res) => {
  const db = load();
  const b = db.banners.find((x) => x.id === req.params.id);
  if (b) { b.stats = b.stats || { imp: 0, click: 0 }; b.stats[req.params.kind]++; save(db); }
  res.json({ ok: true });
});

// ── 관리자 ──
app.post('/admin/login', (req, res) => {
  if (req.body.password !== PASS) return res.status(401).json({ error: '비밀번호가 다릅니다' });
  res.cookie('eumads', sign(String(Date.now())), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 });
  res.json({ ok: true });
});
const auth = (req, res, next) => (ok(req.cookies.eumads) ? next() : res.status(401).json({ error: '로그인 필요' }));
app.get('/admin/api/banners', auth, (req, res) => res.json(load().banners));
const upload = multer({ storage: multer.diskStorage({ destination: join(DATA, 'img'), filename: (req, f, cb) => cb(null, Date.now() + extname(f.originalname).toLowerCase()) }), limits: { fileSize: 3 * 1024 * 1024 } });
app.post('/admin/api/banners', auth, upload.single('image'), (req, res) => {
  const db = load();
  const b = req.body;
  const id = b.id || randomBytes(4).toString('hex');
  let cur = db.banners.find((x) => x.id === id);
  if (!cur) { cur = { id, stats: { imp: 0, click: 0 } }; db.banners.push(cur); }
  Object.assign(cur, { title: b.title || '', link: b.link || '', slot: b.slot || 'top', order: Number(b.order || 0), start: b.start || '', end: b.end || '', bg: b.bg || '', active: b.active === 'true' || b.active === true, apps: (b.apps || 'eum-viewer').split(',').map((s) => s.trim()).filter(Boolean) });
  if (req.file) { if (cur.image && existsSync(join(DATA, 'img', cur.image))) try { unlinkSync(join(DATA, 'img', cur.image)); } catch {} cur.image = req.file.filename; }
  save(db);
  res.json(cur);
});
app.post('/admin/api/banners/:id/toggle', auth, (req, res) => { const db = load(); const b = db.banners.find((x) => x.id === req.params.id); if (b) { b.active = !b.active; save(db); } res.json(b || {}); });
app.delete('/admin/api/banners/:id', auth, (req, res) => { const db = load(); const b = db.banners.find((x) => x.id === req.params.id); if (b && b.image) try { unlinkSync(join(DATA, 'img', b.image)); } catch {} db.banners = db.banners.filter((x) => x.id !== req.params.id); save(db); res.json({ ok: true }); });
app.get('/admin/api/installs', auth, (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const list = [];
  for (let i = 0; i < days; i++) list.push(new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10));
  const out = {};
  for (const id of APPS_OK) {
    const a = inst[id] || { seen: {}, days: {} };
    out[id] = { total: Object.keys(a.seen).length, days: list.map((d) => ({ day: d, new: a.days[d]?.n || 0, active: Object.keys(a.days[d]?.a || {}).length })) };
  }
  res.json(out);
});
app.get('/admin/api/versions', auth, (req, res) => res.json(loadVer()));
app.post('/admin/api/versions', auth, (req, res) => {
  const v = loadVer(); const b = req.body;
  v[b.app] = { code: Number(b.code || 0), name: b.name || '', notes: b.notes || '', force: !!b.force };
  writeFileSync(VER, JSON.stringify(v, null, 1));
  res.json(v);
});
app.get('/admin', (req, res) => res.sendFile(join(process.cwd(), 'public', 'admin.html')));
app.get('/', (req, res) => res.redirect('/admin'));
app.listen(PORT, () => console.log('eum-ads on', PORT, 'data', DATA));
