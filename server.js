// 이음 홍보센터 — 앱 홍보 글 생성·발행·예약·링크 통계 서버
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  db, getSetting, setSetting, kstNow, kstDay, kstTime, nowIso,
  parseApp, parsePost, parseChannel, parseRule, linkFor,
} = require('./lib/db');
const gen = require('./lib/generate');
const pub = require('./lib/publish');
const CHECKLIST = require('./lib/checklist');
const landing = require('./lib/landing');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ---------- 기본 설정 ----------
function baseUrl(req) {
  const s = getSetting('site', {});
  if (s.baseUrl) return String(s.baseUrl).replace(/\/+$/, '');
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}
const brand = () => getSetting('site', {}).brand || '이음소프트';

// ---------- 로그인 ----------
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function initAuth() {
  if (!getSetting('secret')) setSetting('secret', crypto.randomBytes(32).toString('hex'));
  if (getSetting('auth')) return;
  const id = process.env.ADMIN_ID || 'admin';
  let pw = process.env.ADMIN_PW;
  if (!pw) {
    pw = crypto.randomBytes(9).toString('base64url');
    console.log(`[처음 실행] 관리자 비밀번호가 지정되지 않아 임시로 만들었습니다 — 아이디 ${id} / 비밀번호 ${pw}`);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('auth', { id, salt, hash: hashPw(pw, salt) });
}
initAuth();

function sign(value) { return crypto.createHmac('sha256', getSetting('secret')).update(value).digest('base64url'); }
function makeToken(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${body}.${sign(body)}`; }
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const isAuthed = (req) => !!readToken(cookies(req).eum_promo);
function requireAuth(req, res, next) { if (isAuthed(req)) return next(); res.status(401).json({ error: '로그인이 필요합니다' }); }

const loginTries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const tries = (loginTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (tries.length >= 8) return res.status(429).json({ error: '잠시 뒤에 다시 시도하세요 (10분에 8번까지)' });
  const auth = getSetting('auth');
  const { id, pw } = req.body || {};
  const ok = id === auth.id && hashPw(pw || '', auth.salt) === auth.hash;
  if (!ok) { tries.push(now); loginTries.set(ip, tries); return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않습니다' }); }
  loginTries.delete(ip);
  const token = makeToken({ id, exp: now + 30 * 24 * 3600 * 1000 });
  res.setHeader('Set-Cookie', `eum_promo=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'eum_promo=; Path=/; HttpOnly; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req) }));

// ---------- 공개 주소 (로그인 없이 열림) ----------
const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|yeti|daum|kakaotalk-scrap|whatsapp|telegram|discord|curl|wget|python|headless/i;
app.get('/r/:code', (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE code = ?').get(req.params.code);
  if (!link) return res.redirect('/apps');
  const a = parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(link.app_id));
  if (!a) return res.redirect('/apps');
  if (!BOT.test(req.get('user-agent') || '')) {
    db.prepare('INSERT INTO clicks(code, app_id, source, day, ts) VALUES(?,?,?,?,?)').run(link.code, a.id, link.source, kstDay(), nowIso());
  }
  let dest = a.store_url || `/a/${a.slug}`;
  if (/play\.google\.com\/store\/apps\/details/.test(dest) && !/referrer=/.test(dest)) {
    const ref = encodeURIComponent(`utm_source=${link.source}&utm_medium=promo&utm_campaign=${a.slug}`);
    dest += `${dest.includes('?') ? '&' : '?'}referrer=${ref}`;
  }
  res.redirect(302, dest);
});
app.get('/a/:slug', (req, res) => {
  const a = parseApp(db.prepare('SELECT * FROM apps WHERE slug = ? AND is_public = 1').get(req.params.slug));
  if (!a) return res.status(404).send(landing.listPage(publicApps(), { baseUrl: baseUrl(req), brand: brand() }));
  const others = publicApps().filter((o) => o.id !== a.id).slice(0, 6);
  const installUrl = a.store_url ? `/r/${linkFor(a.id, 'landing')}` : '';
  res.send(landing.appPage(a, others, { baseUrl: baseUrl(req), installUrl, brand: brand() }));
});
function publicApps() { return db.prepare('SELECT * FROM apps WHERE is_public = 1 ORDER BY id DESC').all().map(parseApp); }
app.get('/apps', (req, res) => res.send(landing.listPage(publicApps(), { baseUrl: baseUrl(req), brand: brand() })));
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req);
  const urls = [`${b}/apps`, ...publicApps().map((a) => `${b}/a/${a.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${gen.esc(u)}</loc></url>`).join('')}</urlset>`);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /apps\nAllow: /a/\nDisallow: /api/\nDisallow: /r/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
// 내 앱들이 서로를 소개할 때 불러 쓰는 목록 (교차 홍보)
app.get('/api/public/apps.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const exclude = String(req.query.exclude || '');
  const b = baseUrl(req);
  res.json(publicApps().filter((a) => a.package !== exclude && a.store_url).map((a) => ({
    name: a.name, name_en: a.name_en, tagline: a.tagline, tagline_en: a.tagline_en, package: a.package, icon: a.icon_url,
    url: `${b}/r/${linkFor(a.id, 'crosspromo')}`,
  })));
});

// ---------- 구글 연결 (블로거) ----------
app.get('/api/oauth/google/start', requireAuth, (req, res) => {
  const g = getSetting('google', {});
  if (!g.clientId) return res.status(400).send('설정에서 구글 클라이언트 ID를 먼저 넣어 주세요');
  const state = makeToken({ ch: Number(req.query.channel), exp: Date.now() + 15 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: g.clientId, redirect_uri: `${baseUrl(req)}/api/oauth/google/callback`, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/blogger', access_type: 'offline', prompt: 'consent', state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});
app.get('/api/oauth/google/callback', async (req, res) => {
  try {
    const st = readToken(req.query.state);
    if (!st) throw new Error('연결 요청이 만료됐습니다. 다시 시도하세요');
    if (req.query.error) throw new Error(String(req.query.error));
    const g = getSetting('google', {});
    const tok = await pub.jsonFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: `${baseUrl(req)}/api/oauth/google/callback`, grant_type: 'authorization_code' }),
    });
    if (!tok.refresh_token) throw new Error('구글이 갱신 토큰을 주지 않았습니다. 구글 계정의 앱 연결을 해제한 뒤 다시 시도하세요');
    const ch = parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(st.ch));
    if (!ch) throw new Error('채널을 찾을 수 없습니다');
    const cfg = { ...ch.config, refreshToken: tok.refresh_token };
    const blogs = await pub.bloggerBlogs(tok.refresh_token);
    if (blogs.length === 1) { cfg.blogId = blogs[0].id; cfg.blogName = blogs[0].name; }
    db.prepare('UPDATE channels SET config = ? WHERE id = ?').run(JSON.stringify(cfg), ch.id);
    res.redirect('/#/channels');
  } catch (e) {
    res.status(400).send(`<meta charset="utf-8"><p>구글 연결에 실패했습니다: ${gen.esc(e.message)}</p><p><a href="/#/channels">돌아가기</a></p>`);
  }
});

// ---------- 여기부터 로그인 필요 ----------
app.use('/api', (req, res, next) => (req.path.startsWith('/public/') ? next() : requireAuth(req, res, next)));

const ICON_NAMES = ['calendar-check', 'smartphone', 'pen-line', 'archive', 'repeat', 'plug', 'list-checks', 'chart-column', 'settings', 'plus', 'copy', 'send', 'clock', 'trash-2', 'external-link', 'check', 'x', 'chevron-right', 'chevron-left', 'log-out', 'download', 'refresh-cw', 'menu', 'link', 'pencil', 'circle-alert', 'play', 'ellipsis'];
const ICONS = {};
for (const n of ICON_NAMES) {
  try {
    const svg = fs.readFileSync(path.join(__dirname, 'node_modules', 'lucide-static', 'icons', `${n}.svg`), 'utf8');
    ICONS[n] = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[^>]*>/, '').replace('</svg>', '').replace(/\s+/g, ' ').trim();
  } catch {}
}

function maskChannel(ch) {
  const type = pub.CHANNEL_TYPES[ch.type];
  const config = { ...ch.config };
  for (const f of type?.fields || []) if (f.secret && config[f.key]) config[f.key] = '••••••';
  const connected = ch.type === 'blogger' ? !!ch.config.refreshToken : (type?.fields || []).every((f) => ch.config[f.key]);
  delete config.refreshToken;
  return { ...ch, config, connected, label: type?.label || ch.type, format: type?.format || 'short' };
}
function resolveTarget(target) {
  if (String(target).startsWith('ch:')) {
    const ch = parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(target.slice(3))));
    if (!ch) return null;
    const t = pub.CHANNEL_TYPES[ch.type];
    return { key: target, type: ch.type, label: ch.name || t.label, format: t.format, channel: ch, manual: false };
  }
  const m = pub.MANUAL_TARGETS[target];
  return m ? { key: target, type: target, label: m.label, format: m.format, channel: null, manual: true, writeUrl: m.writeUrl } : null;
}
const aiConfig = () => { const a = getSetting('ai', {}); return a.apiKey ? a : null; };

app.get('/api/meta', (req, res) => {
  const ai = getSetting('ai', {});
  res.json({
    kinds: gen.KINDS, langs: gen.LANGS, channelTypes: pub.CHANNEL_TYPES, manualTargets: pub.MANUAL_TARGETS,
    checklist: CHECKLIST, icons: ICONS, baseUrl: baseUrl(req), brand: brand(), aiReady: !!ai.apiKey,
  });
});

// ---------- 앱 ----------
function slugify(s) {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || `app-${crypto.randomBytes(3).toString('hex')}`;
}
function uniqueSlug(want, exceptId = 0) {
  let slug = slugify(want);
  let i = 2;
  while (db.prepare('SELECT 1 FROM apps WHERE slug = ? AND id != ?').get(slug, exceptId)) slug = `${slugify(want)}-${i++}`;
  return slug;
}
const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
const words = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean);
function appFields(b) {
  const pkg = String(b.package || '').trim();
  return {
    name: String(b.name || '').trim(), name_en: String(b.name_en || '').trim(),
    tagline: String(b.tagline || '').trim(), tagline_en: String(b.tagline_en || '').trim(),
    package: pkg, store_url: String(b.store_url || '').trim() || (pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : ''),
    category: String(b.category || '').trim(), description: String(b.description || '').trim(), description_en: String(b.description_en || '').trim(),
    features: JSON.stringify(lines(b.features)), features_en: JSON.stringify(lines(b.features_en)),
    audience: String(b.audience || '').trim(), keywords: JSON.stringify(words(b.keywords)),
    icon_url: String(b.icon_url || '').trim(), screenshots: JSON.stringify(lines(b.screenshots)),
    price: String(b.price || '무료').trim(), is_public: b.is_public === false || b.is_public === 0 ? 0 : 1,
  };
}
app.get('/api/apps', (req, res) => {
  const rows = db.prepare('SELECT * FROM apps ORDER BY id DESC').all().map(parseApp);
  const counts = Object.fromEntries(db.prepare("SELECT app_id, COUNT(*) c FROM posts WHERE status = 'published' GROUP BY app_id").all().map((r) => [r.app_id, r.c]));
  const since = kstDay(new Date(kstNow().getTime() - 29 * 86400000));
  const clicks = Object.fromEntries(db.prepare('SELECT app_id, COUNT(*) c FROM clicks WHERE day >= ? GROUP BY app_id').all(since).map((r) => [r.app_id, r.c]));
  res.json(rows.map((a) => ({ ...a, published: counts[a.id] || 0, clicks30: clicks[a.id] || 0 })));
});
app.post('/api/apps', (req, res) => {
  const f = appFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '앱 이름을 넣어 주세요' });
  const slug = uniqueSlug(req.body.slug || f.name_en || f.package.split('.').pop() || f.name);
  const keys = Object.keys(f);
  const r = db.prepare(`INSERT INTO apps(slug, ${keys.join(',')}, created_at) VALUES(?, ${keys.map(() => '?').join(',')}, ?)`).run(slug, ...keys.map((k) => f[k]), nowIso());
  res.json(parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(r.lastInsertRowid)));
});
app.put('/api/apps/:id', (req, res) => {
  const id = Number(req.params.id);
  const f = appFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '앱 이름을 넣어 주세요' });
  const keys = Object.keys(f);
  db.prepare(`UPDATE apps SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  if (req.body.slug) db.prepare('UPDATE apps SET slug = ? WHERE id = ?').run(uniqueSlug(req.body.slug, id), id);
  res.json(parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(id)));
});
app.delete('/api/apps/:id', (req, res) => { db.prepare('DELETE FROM apps WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// 구글 플레이 페이지에서 이름·설명·아이콘 가져오기
app.post('/api/apps/import', async (req, res) => {
  try {
    const input = String(req.body?.package || '').trim();
    const pkg = (input.match(/[?&]id=([\w.]+)/) || [])[1] || input;
    if (!/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(pkg)) return res.status(400).json({ error: '패키지 이름 또는 구글 플레이 주소를 넣어 주세요 (예: kr.eumsoft.app)' });
    const out = { package: pkg, store_url: `https://play.google.com/store/apps/details?id=${pkg}` };
    for (const [hl, suffix] of [['ko', ''], ['en', '_en']]) {
      const r = await fetch(`https://play.google.com/store/apps/details?id=${pkg}&hl=${hl}`, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'accept-language': hl }, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return res.status(404).json({ error: '구글 플레이에서 이 앱을 찾지 못했습니다. 아직 공개 전이면 직접 입력해 주세요' });
      if (!r.ok) throw new Error(`구글 플레이 응답 ${r.status}`);
      const html = await r.text();
      const meta = (prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i')); return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ''; };
      const title = meta('og:title').replace(/\s*[-–]\s*(Google Play\s*앱|Apps on Google Play)\s*$/i, '');
      const [name, ...rest] = title.split(/\s[-–:]\s/);
      out[`name${suffix}`] = name || title;
      if (rest.length) out[`tagline${suffix}`] = rest.join(' - ');
      out[`description${suffix}`] = meta('og:description') || meta('description');
      if (!suffix) {
        out.icon_url = meta('og:image');
        const shots = [...html.matchAll(/<img[^>]+src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"[^>]*alt="[^"]*(?:스크린샷|Screenshot)[^"]*"/gi)].map((m) => m[1].replace(/=w\d+-h\d+.*$/, '=w720-h1280'));
        out.screenshots = [...new Set(shots)].slice(0, 6);
      }
    }
    res.json(out);
  } catch (e) { res.status(502).json({ error: `가져오지 못했습니다: ${e.message}. 직접 입력해 주세요` }); }
});

// ---------- 채널 ----------
app.get('/api/channels', (req, res) => res.json(db.prepare('SELECT * FROM channels ORDER BY id').all().map(parseChannel).map(maskChannel)));
app.post('/api/channels', (req, res) => {
  const { type, name, config } = req.body || {};
  const t = pub.CHANNEL_TYPES[type];
  if (!t) return res.status(400).json({ error: '채널 종류를 고르세요' });
  const r = db.prepare('INSERT INTO channels(type, name, config, created_at) VALUES(?,?,?,?)').run(type, String(name || t.label).trim(), JSON.stringify(config || {}), nowIso());
  res.json(maskChannel(parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(r.lastInsertRowid))));
});
app.put('/api/channels/:id', (req, res) => {
  const ch = parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(req.params.id)));
  if (!ch) return res.status(404).json({ error: '채널이 없습니다' });
  const incoming = req.body?.config || {};
  const cfg = { ...ch.config };
  for (const [k, v] of Object.entries(incoming)) if (v !== '••••••' && k !== 'refreshToken') cfg[k] = typeof v === 'string' ? v.trim() : v;
  db.prepare('UPDATE channels SET name = ?, config = ?, enabled = ? WHERE id = ?').run(String(req.body?.name || ch.name).trim(), JSON.stringify(cfg), req.body?.enabled === false ? 0 : 1, ch.id);
  res.json(maskChannel(parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id))));
});
app.delete('/api/channels/:id', (req, res) => { db.prepare('DELETE FROM channels WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });
app.post('/api/channels/:id/test', async (req, res) => {
  try {
    const ch = parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(req.params.id)));
    res.json({ ok: true, message: await pub.testChannel(ch) });
  } catch (e) { res.status(400).json({ error: `연결 실패: ${e.message}` }); }
});
app.get('/api/channels/:id/blogs', async (req, res) => {
  try {
    const ch = parseChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(req.params.id)));
    res.json(await pub.bloggerBlogs(ch.config.refreshToken));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- 글 ----------
function insertPost(a, kind, lang, tgt, out, extra = {}) {
  const r = db.prepare(`INSERT INTO posts(app_id, kind, lang, target, channel_id, title, body_html, body_text, tags, status, scheduled_at, link_code, engine, created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.id, kind, lang, tgt.key, tgt.channel?.id ?? null, out.title, out.html, out.text, JSON.stringify(out.tags || []),
    extra.status || 'draft', extra.scheduled_at || null, extra.link_code || '', out.engine || 'template', nowIso());
  return Number(r.lastInsertRowid);
}
function getPost(id) {
  const p = parsePost(db.prepare('SELECT p.*, a.name app_name, a.slug app_slug FROM posts p JOIN apps a ON a.id = p.app_id WHERE p.id = ?').get(id));
  if (!p) return null;
  const t = resolveTarget(p.target);
  return { ...p, target_label: t?.label || p.target, target_format: t?.format || 'short', manual: t ? t.manual : true, write_url: t?.writeUrl || '' };
}
function focusFor(appId, kind) { return db.prepare('SELECT COUNT(*) c FROM posts WHERE app_id = ? AND kind = ?').get(appId, kind).c; }

async function createPost(a, kind, lang, tgt, opts = {}, extra = {}) {
  const code = linkFor(a.id, tgt.type);
  const link = a.store_url ? `${opts.base}/r/${code}` : `${opts.base}/a/${a.slug}`;
  const out = await gen.generate(a, kind, lang, { link, note: opts.note, focus: opts.focus ?? focusFor(a.id, kind), target: tgt.type, engine: opts.engine }, aiConfig());
  return insertPost(a, kind, lang, tgt, out, { ...extra, link_code: code });
}

app.post('/api/generate', async (req, res) => {
  const { app_id, kind, lang = 'ko', targets = [], note = '', engine } = req.body || {};
  const a = parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(Number(app_id)));
  if (!a) return res.status(400).json({ error: '앱을 고르세요' });
  if (!gen.KIND_MAP[kind]) return res.status(400).json({ error: '글 종류를 고르세요' });
  const tgts = targets.map(resolveTarget).filter(Boolean);
  if (!tgts.length) return res.status(400).json({ error: '올릴 곳을 하나 이상 고르세요' });
  try {
    const ids = [];
    const start = focusFor(a.id, kind);
    for (let i = 0; i < tgts.length; i++) {
      ids.push(await createPost(a, kind, lang, tgts[i], { base: baseUrl(req), note, focus: start + i, engine })); // 올릴 곳마다 다른 기능을 다뤄 같은 글이 겹치지 않게
    }
    res.json(ids.map(getPost));
  } catch (e) { res.status(e.code === 'NEED_AI' ? 400 : 502).json({ error: e.message, code: e.code }); }
});
// 구독 중인 AI에 붙여 넣을 요청문
app.post('/api/prompt', (req, res) => {
  const { app_id, kind, lang = 'ko', target, note = '' } = req.body || {};
  const a = parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(Number(app_id)));
  const tgt = resolveTarget(target);
  if (!a || !tgt) return res.status(400).json({ error: '앱과 올릴 곳을 고르세요' });
  const code = linkFor(a.id, tgt.type);
  const link = a.store_url ? `${baseUrl(req)}/r/${code}` : `${baseUrl(req)}/a/${a.slug}`;
  res.json({ prompt: gen.buildPrompt(a, kind, lang, { link, note, target: tgt.type }) });
});
// AI가 써 준 결과를 붙여 넣어 글로 저장
app.post('/api/posts/from-ai', (req, res) => {
  const { app_id, kind, lang = 'ko', target, raw } = req.body || {};
  const a = parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(Number(app_id)));
  const tgt = resolveTarget(target);
  if (!a || !tgt || !String(raw || '').trim()) return res.status(400).json({ error: 'AI가 써 준 내용을 붙여 넣어 주세요' });
  const out = gen.parseAiOutput(raw, kind);
  res.json(getPost(insertPost(a, kind, lang, tgt, out, { link_code: linkFor(a.id, tgt.type) })));
});

app.get('/api/posts', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.status) { where.push(`p.status IN (${String(req.query.status).split(',').map(() => '?').join(',')})`); args.push(...String(req.query.status).split(',')); }
  if (req.query.app_id) { where.push('p.app_id = ?'); args.push(Number(req.query.app_id)); }
  const rows = db.prepare(`SELECT p.id FROM posts p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(p.scheduled_at, p.created_at) DESC, p.id DESC LIMIT 200`).all(...args);
  res.json(rows.map((r) => getPost(r.id)).map(({ body_html, ...rest }) => ({ ...rest, body_text: rest.body_text.slice(0, 160) })));
});
app.get('/api/posts/:id', (req, res) => { const p = getPost(Number(req.params.id)); p ? res.json(p) : res.status(404).json({ error: '글이 없습니다' }); });
app.put('/api/posts/:id', (req, res) => {
  const p = getPost(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '글이 없습니다' });
  const b = req.body || {};
  const html = b.body_html !== undefined ? gen.sanitizeHtml(b.body_html) : p.body_html;
  const text = b.body_text !== undefined ? String(b.body_text) : (b.body_html !== undefined ? gen.stripHtml(html) : p.body_text);
  const finalHtml = b.body_html === undefined && b.body_text !== undefined ? gen.textToHtml(text) : html;
  db.prepare('UPDATE posts SET title = ?, body_html = ?, body_text = ?, tags = ? WHERE id = ?')
    .run(b.title ?? p.title, finalHtml, text, JSON.stringify(b.tags ? words(b.tags) : p.tags), p.id);
  res.json(getPost(p.id));
});
app.delete('/api/posts/:id', (req, res) => { db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

async function publishPost(id) {
  const p = getPost(id);
  if (!p) throw new Error('글이 없습니다');
  const tgt = resolveTarget(p.target);
  if (!tgt) throw new Error('올릴 곳이 삭제됐습니다');
  if (tgt.manual) { // 직접 붙여 넣는 곳은 "올릴 차례"로 넘긴다
    db.prepare("UPDATE posts SET status = 'ready', error = '' WHERE id = ?").run(id);
    return getPost(id);
  }
  try {
    const r = await pub.publish(tgt.channel, p);
    db.prepare("UPDATE posts SET status = 'published', published_at = ?, remote_url = ?, error = '' WHERE id = ?").run(nowIso(), r.url || '', id);
  } catch (e) {
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(String(e.message).slice(0, 500), id);
    throw e;
  }
  return getPost(id);
}
app.post('/api/posts/:id/publish', async (req, res) => {
  try { res.json(await publishPost(Number(req.params.id))); } catch (e) { res.status(502).json({ error: `발행 실패: ${e.message}` }); }
});
app.post('/api/posts/:id/schedule', (req, res) => {
  const at = new Date(req.body?.at);
  if (Number.isNaN(at.getTime())) return res.status(400).json({ error: '예약 시각을 넣어 주세요' });
  db.prepare("UPDATE posts SET status = 'scheduled', scheduled_at = ?, error = '' WHERE id = ?").run(at.toISOString(), Number(req.params.id));
  res.json(getPost(Number(req.params.id)));
});
app.post('/api/posts/:id/unschedule', (req, res) => {
  db.prepare("UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id = ?").run(Number(req.params.id));
  res.json(getPost(Number(req.params.id)));
});
// 직접 올린 글을 "올렸음"으로 표시 (올린 글 주소는 선택)
app.post('/api/posts/:id/done', (req, res) => {
  db.prepare("UPDATE posts SET status = 'published', published_at = ?, remote_url = ? WHERE id = ?").run(nowIso(), String(req.body?.url || '').trim(), Number(req.params.id));
  res.json(getPost(Number(req.params.id)));
});
app.post('/api/posts/:id/regenerate', async (req, res) => {
  try {
    const p = getPost(Number(req.params.id));
    const a = parseApp(db.prepare('SELECT * FROM apps WHERE id = ?').get(p.app_id));
    const tgt = resolveTarget(p.target);
    const link = a.store_url ? `${baseUrl(req)}/r/${p.link_code || linkFor(a.id, tgt.type)}` : `${baseUrl(req)}/a/${a.slug}`;
    const out = await gen.generate(a, p.kind, p.lang, { link, note: req.body?.note || '', focus: Math.floor(Math.random() * 50), target: tgt.type, engine: req.body?.engine }, aiConfig());
    db.prepare('UPDATE posts SET title = ?, body_html = ?, body_text = ?, tags = ?, engine = ? WHERE id = ?').run(out.title, out.html, out.text, JSON.stringify(out.tags), out.engine, p.id);
    res.json(getPost(p.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- 자동 규칙 ----------
const ruleView = (r) => { const t = resolveTarget(r.target); return { ...r, target_label: t?.label || '삭제된 채널', manual: t ? t.manual : true }; };
app.get('/api/autopilot', (req, res) => res.json(db.prepare('SELECT * FROM autopilot ORDER BY id').all().map(parseRule).map(ruleView)));
function ruleFields(b) {
  const tgt = resolveTarget(b.target);
  if (!tgt) throw new Error('올릴 곳을 고르세요');
  const kinds = (b.kinds || []).filter((k) => gen.KIND_MAP[k]);
  if (!kinds.length) throw new Error('글 종류를 하나 이상 고르세요');
  const days = (b.days || []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!days.length) throw new Error('요일을 하나 이상 고르세요');
  if (!/^\d{2}:\d{2}$/.test(b.time || '')) throw new Error('시각을 넣어 주세요');
  return { name: String(b.name || '').trim(), app_ids: JSON.stringify((b.app_ids || []).map(Number)), target: tgt.key, channel_id: tgt.channel?.id ?? null, kinds: JSON.stringify(kinds), lang: b.lang || 'ko', days: JSON.stringify(days), time: b.time, enabled: b.enabled === false ? 0 : 1 };
}
app.post('/api/autopilot', (req, res) => {
  try {
    const f = ruleFields(req.body || {});
    const keys = Object.keys(f);
    const r = db.prepare(`INSERT INTO autopilot(${keys.join(',')}, created_at) VALUES(${keys.map(() => '?').join(',')}, ?)`).run(...keys.map((k) => f[k]), nowIso());
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/autopilot/:id', (req, res) => {
  try {
    const f = ruleFields(req.body || {});
    const keys = Object.keys(f);
    db.prepare(`UPDATE autopilot SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/autopilot/:id', (req, res) => { db.prepare('DELETE FROM autopilot WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

async function runRule(rule, base) {
  const tgt = resolveTarget(rule.target);
  if (!tgt) throw new Error('올릴 곳이 삭제됐습니다');
  const all = db.prepare('SELECT * FROM apps ORDER BY id').all().map(parseApp);
  const pool = rule.app_ids.length ? all.filter((a) => rule.app_ids.includes(a.id)) : all;
  if (!pool.length) throw new Error('등록된 앱이 없습니다');
  // 앱을 한 바퀴 돌 때마다 글 종류를 바꿔 같은 글이 되풀이되지 않게 한다
  const a = pool[rule.cursor % pool.length];
  const kind = rule.kinds[Math.floor(rule.cursor / pool.length) % rule.kinds.length];
  const id = await createPost(a, kind, rule.lang, tgt, { base });
  db.prepare('UPDATE autopilot SET cursor = cursor + 1, last_run_day = ? WHERE id = ?').run(kstDay(), rule.id);
  return publishPost(id);
}
app.post('/api/autopilot/:id/run', async (req, res) => {
  try {
    const rule = parseRule(db.prepare('SELECT * FROM autopilot WHERE id = ?').get(Number(req.params.id)));
    res.json(await runRule(rule, baseUrl(req)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- 체크리스트 ----------
app.get('/api/checklist/:appId', (req, res) => {
  res.json(Object.fromEntries(db.prepare('SELECT * FROM checklist WHERE app_id = ?').all(Number(req.params.appId)).map((r) => [r.item_key, { done: !!r.done, note: r.note, done_at: r.done_at }])));
});
app.put('/api/checklist/:appId/:key', (req, res) => {
  const done = req.body?.done ? 1 : 0;
  db.prepare(`INSERT INTO checklist(app_id, item_key, done, note, done_at) VALUES(?,?,?,?,?)
    ON CONFLICT(app_id, item_key) DO UPDATE SET done = excluded.done, note = excluded.note, done_at = excluded.done_at`)
    .run(Number(req.params.appId), req.params.key, done, String(req.body?.note || ''), done ? nowIso() : null);
  res.json({ ok: true });
});

// ---------- 통계 ----------
function sourceLabel(s) { return pub.CHANNEL_TYPES[s]?.label || pub.MANUAL_TARGETS[s]?.label || ({ landing: '앱 소개 페이지', crosspromo: '내 다른 앱' })[s] || s; }
app.get('/api/stats', (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 14));
  const list = [];
  for (let i = days - 1; i >= 0; i--) list.push(kstDay(new Date(kstNow().getTime() - i * 86400000)));
  const prevStart = kstDay(new Date(kstNow().getTime() - (days * 2 - 1) * 86400000));
  const byDay = Object.fromEntries(db.prepare('SELECT day, COUNT(*) c FROM clicks WHERE day >= ? GROUP BY day').all(list[0]).map((r) => [r.day, r.c]));
  const pubByDay = Object.fromEntries(db.prepare("SELECT substr(datetime(published_at, '+9 hours'), 1, 10) d, COUNT(*) c FROM posts WHERE status = 'published' AND published_at IS NOT NULL GROUP BY d").all().map((r) => [r.d, r.c]));
  const total = list.reduce((n, d) => n + (byDay[d] || 0), 0);
  const prev = db.prepare('SELECT COUNT(*) c FROM clicks WHERE day >= ? AND day < ?').get(prevStart, list[0]).c;
  res.json({
    days, total, prev,
    series: list.map((d) => ({ day: d, clicks: byDay[d] || 0, posts: pubByDay[d] || 0 })),
    byApp: db.prepare('SELECT a.name, COUNT(*) c FROM clicks k JOIN apps a ON a.id = k.app_id WHERE k.day >= ? GROUP BY k.app_id ORDER BY c DESC LIMIT 12').all(list[0]),
    bySource: db.prepare('SELECT source, COUNT(*) c FROM clicks WHERE day >= ? GROUP BY source ORDER BY c DESC').all(list[0]).map((r) => ({ name: sourceLabel(r.source), c: r.c })),
  });
});
app.get('/api/dashboard', (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const twoWeeks = new Date(Date.now() - 14 * 86400000).toISOString();
  const ids = (sql, ...a) => db.prepare(sql).all(...a).map((r) => getPost(r.id)).map(({ body_html, ...p }) => ({ ...p, body_text: p.body_text.slice(0, 120) }));
  res.json({
    apps: db.prepare('SELECT COUNT(*) c FROM apps').get().c,
    channels: db.prepare('SELECT COUNT(*) c FROM channels').get().c,
    publishedWeek: db.prepare("SELECT COUNT(*) c FROM posts WHERE status = 'published' AND published_at >= ?").get(weekAgo).c,
    publishedPrevWeek: db.prepare("SELECT COUNT(*) c FROM posts WHERE status = 'published' AND published_at >= ? AND published_at < ?").get(twoWeeks, weekAgo).c,
    ready: ids("SELECT id FROM posts WHERE status = 'ready' ORDER BY id DESC LIMIT 20"),
    scheduled: ids("SELECT id FROM posts WHERE status = 'scheduled' ORDER BY scheduled_at LIMIT 10"),
    failed: ids("SELECT id FROM posts WHERE status = 'failed' ORDER BY id DESC LIMIT 5"),
    recent: ids("SELECT id FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 6"),
    drafts: db.prepare("SELECT COUNT(*) c FROM posts WHERE status = 'draft'").get().c,
  });
});

// ---------- 설정 ----------
app.get('/api/settings', (req, res) => {
  const ai = getSetting('ai', {});
  const g = getSetting('google', {});
  res.json({
    site: { brand: brand(), baseUrl: getSetting('site', {}).baseUrl || '' }, effectiveBaseUrl: baseUrl(req),
    ai: { provider: ai.provider || 'anthropic', model: ai.model || '', hasKey: !!ai.apiKey },
    google: { clientId: g.clientId || '', hasSecret: !!g.clientSecret, redirectUri: `${baseUrl(req)}/api/oauth/google/callback` },
    adminId: getSetting('auth').id,
  });
});
app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  if (b.site) setSetting('site', { brand: String(b.site.brand || '').trim() || '이음소프트', baseUrl: String(b.site.baseUrl || '').trim().replace(/\/+$/, '') });
  if (b.ai) {
    const cur = getSetting('ai', {});
    setSetting('ai', { provider: b.ai.provider || cur.provider || 'anthropic', model: String(b.ai.model || '').trim(), apiKey: b.ai.clearKey ? '' : (String(b.ai.apiKey || '').trim() || cur.apiKey || '') });
  }
  if (b.google) {
    const cur = getSetting('google', {});
    setSetting('google', { clientId: String(b.google.clientId || '').trim(), clientSecret: String(b.google.clientSecret || '').trim() || cur.clientSecret || '' });
  }
  res.json({ ok: true });
});
app.post('/api/password', (req, res) => {
  const auth = getSetting('auth');
  const { current, next } = req.body || {};
  if (hashPw(current || '', auth.salt) !== auth.hash) return res.status(400).json({ error: '현재 비밀번호가 맞지 않습니다' });
  if (String(next || '').length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상으로 해 주세요' });
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('auth', { id: auth.id, salt, hash: hashPw(next, salt) });
  res.json({ ok: true });
});
app.post('/api/ai-test', async (req, res) => {
  try {
    const ai = aiConfig();
    if (!ai) throw new Error('AI 키를 먼저 저장하세요');
    const a = { name: '시험 앱', tagline: '연결 확인용', category: '도구', price: '무료', description: '연결 확인', features: ['확인'], audience: '', keywords: [] };
    const out = await gen.generate(a, 'sns_short', 'ko', { target: 'bluesky' }, ai);
    res.json({ ok: true, message: `연결됨 — "${out.text.slice(0, 60)}"` });
  } catch (e) { res.status(400).json({ error: `AI 연결 실패: ${e.message}` }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소입니다' }));

// ---------- 화면 ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: '서버에서 문제가 생겼습니다' }); });

// ---------- 예약 발행·자동 규칙 (1분마다 확인) ----------
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare("SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 10").all(nowIso());
    for (const { id } of due) { try { await publishPost(id); } catch (e) { console.error(`[예약 발행 실패] 글 ${id}: ${e.message}`); } }
    const today = kstDay();
    const weekday = kstNow().getUTCDay();
    const time = kstTime();
    for (const rule of db.prepare('SELECT * FROM autopilot WHERE enabled = 1').all().map(parseRule)) {
      if (rule.last_run_day === today || !rule.days.includes(weekday) || time < rule.time) continue;
      try { await runRule(rule, baseUrl()); }
      catch (e) {
        console.error(`[자동 규칙 실패] ${rule.id}: ${e.message}`);
        db.prepare('UPDATE autopilot SET last_run_day = ? WHERE id = ?').run(today, rule.id); // 같은 날 되풀이 시도하지 않음
      }
    }
  } finally { ticking = false; }
}
setInterval(tick, 60 * 1000);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`이음 홍보센터 실행 중 — 포트 ${PORT}`));
