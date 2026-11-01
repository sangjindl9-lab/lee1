// 이음사인 웹 서버
const path = require('path');
const express = require('express');
const { get, run, all, J } = require('./db');
const C = require('./core');
const F = require('./files');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  res.set({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'SAMEORIGIN' });
  next();
});

// 세션 쿠키 인증 (직원용 /api/*). 상태 변경 요청은 x-ieum 헤더를 요구해 다른 사이트에서 위조 요청을 막는다.
function parseCookies(h) { return Object.fromEntries(String(h || '').split(';').map((s) => s.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function currentUser(req) {
  const t = parseCookies(req.headers.cookie).isid;
  if (!t) return null;
  const s = get(`select * from sessions where token_hash=? and expires_at>?`, C.sha256(t), Date.now());
  if (!s) return null;
  const u = get(`select * from users where id=? and status='active'`, s.user_id);
  return u ? { ...u, _session: s.token_hash, _locked: !!s.locked } : null;
}
const wrap = require('./wrap');
function staff(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다' });
  if (req.method !== 'GET' && req.headers['x-ieum'] !== '1') return res.status(403).json({ error: '요청 헤더가 올바르지 않습니다' });
  // 대면계약 중 기기를 서명자에게 넘긴 동안: 이 세션은 담당자 비밀번호로 풀기 전까지 잠긴다 (서버에서 막음)
  if (req.user._locked && !(req.path === '/me/verify-password' || req.path === '/logout')) return res.status(423).json({ error: '담당자 화면이 잠겨 있습니다', locked: true });
  next();
}

const fails = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const f = fails.get(email) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: '로그인 시도가 많아 10분간 잠겼습니다' });
  const u = get(`select * from users where lower(email)=?`, email);
  if (!u || !C.checkPw(String(req.body?.password || ''), u.pw_hash)) {
    f.n++; if (f.n >= 5) { f.until = Date.now() + 600e3; f.n = 0; } fails.set(email, f);
    return res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않습니다' });
  }
  if (u.status !== 'active') return res.status(403).json({ error: '사용이 중지된 계정입니다 (퇴사 처리)' });
  fails.delete(email);
  const t = C.token(32);
  run(`insert into sessions(token_hash,user_id,expires_at) values(?,?,?)`, C.sha256(t), u.id, Date.now() + 12 * 3600e3);
  C.audit({ companyId: u.company_id, actor: C.actorOf(u), action: 'LOGIN', ip: req.ip });
  res.set('set-cookie', `isid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => {
  const t = parseCookies(req.headers.cookie).isid; if (t) run(`delete from sessions where token_hash=?`, C.sha256(t));
  res.set('set-cookie', 'isid=; Path=/; Max-Age=0'); res.json({ ok: true });
});

// 회사 가입 (ALLOW_SIGNUP=1 일 때만). 판매 운영 시에는 끄고 관리자가 회사를 만든다.
app.post('/api/signup', wrap(async (req, res) => {
  if (process.env.ALLOW_SIGNUP !== '1') return res.status(403).json({ error: '가입이 닫혀 있습니다' });
  const b = req.body || {};
  const id = require('./seed').createCompany({ name: b.company, bizNo: b.bizNo, adminEmail: b.email, adminName: b.name, password: b.password });
  res.status(201).json({ companyId: id });
}));

// 서명 기한 링크·첨부 다운로드 (권한 확인 후 발급한 만료 주소)
app.get('/dl/:id', (req, res) => {
  if (!F.checkSigned(Number(req.params.id), req.query.exp, req.query.sig)) return res.status(403).send('주소가 만료되었거나 올바르지 않습니다');
  const f = F.readFile(Number(req.params.id));
  res.set({ 'content-type': f.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'no-store' });
  res.send(f.buf);
});

app.use('/api/v1', require('./routes/v1'));
app.use('/api/s', require('./routes/signer'));
app.use('/api/l', require('./routes/linkpub'));
app.use('/api', staff, require('./routes/staff'));

// 화면
const pub = path.join(__dirname, '..', 'public');
app.get('/s/:token', (req, res) => res.sendFile(path.join(pub, 'sign.html')));
app.get('/l/:slug', (req, res) => res.sendFile(path.join(pub, 'link.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(pub, { index: 'index.html', setHeaders: (res, p) => { if (p.endsWith('.html')) res.set('cache-control', 'no-store'); } }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof C.HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

module.exports = { app, currentUser };
