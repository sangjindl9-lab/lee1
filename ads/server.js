// 이음 앱 배너 광고 서버 — 배너 목록 API + 관리자 페이지. 데이터는 DATA_DIR(기본 /data)에 JSON·이미지로 저장.
import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';

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
app.use(cookieParser());
app.use('/img', express.static(join(DATA, 'img'), { maxAge: '1d' }));
app.use(express.static('public'));

// ── 앱이 쓰는 API ──
const today = () => new Date().toISOString().slice(0, 10);
app.get('/api/banners', (req, res) => {
  const appId = req.query.app || 'eum-viewer';
  const d = today();
  const list = load().banners
    .filter((b) => b.active && (b.apps || ['eum-viewer']).includes(appId) && (!b.start || b.start <= d) && (!b.end || b.end >= d))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((b) => ({ id: b.id, slot: b.slot, title: b.title, image: '/img/' + b.image, link: b.link, bg: b.bg || '' }));
  res.set('Cache-Control', 'public, max-age=600');
  res.json(list);
});
// 앱 최신 버전 안내: 앱이 켜질 때 받아서 자기 versionCode 보다 크면 "업데이트" 안내를 띄운다.
const VER = join(DATA, 'versions.json');
const loadVer = () => (existsSync(VER) ? JSON.parse(readFileSync(VER, 'utf8')) : {});
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
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
