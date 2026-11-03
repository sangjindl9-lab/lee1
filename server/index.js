// 현장뷰 서버
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import httpProxy from 'http-proxy';
import { db, devices, encrypt, hashPassword, checkPassword, SECRET, SNAP_DIR } from './db.js';
import * as hik from './hik.js';
import { IsapiError } from './isapi.js';
import { startGo2rtc, liveStream, playbackStream, dropDeviceStreams, GO2RTC_PORT } from './streams.js';
import { subscribe, startMonitoring, watchDevice, unwatchDevice, checkOnline, online, decorate } from './alarms.js';
import { discover } from './discover.js';
import { simRouter, SIM_USER, SIM_PASS } from './sim.js';

const PORT = Number(process.env.PORT || 8080);
const DEMO = process.env.DEMO === '1';
const APK_URL = 'https://github.com/sangjindl9-lab/lee1/releases/download/siteview-latest/siteview.apk';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// ── 로그인 세션 (서명된 쿠키) ─────────────────────────────
const SESSION_DAYS = 30;
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(userId) {
  const body = `${userId}.${Date.now() + SESSION_DAYS * 86400000}`;
  return `${body}.${sign(body)}`;
}
function readToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sv_session=([^;]+)/);
  if (!m) return null;
  const [uid, exp, sig] = m[1].split('.');
  if (!sig || sign(`${uid}.${exp}`) !== sig || Number(exp) < Date.now()) return null;
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(uid)) || null;
}
function setCookie(req, res, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sv_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
const requireAuth = (req, res, next) => {
  req.user = readToken(req);
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다' });
  next();
};

if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)')
    .run(process.env.ADMIN_USER || 'admin', hashPassword(process.env.ADMIN_PASSWORD || 'admin1234'));
}

// ── 데모용 가상 NVR ───────────────────────────────────
app.use('/sim', (req, res, next) => {
  // 가상 장비는 서버 내부에서만 호출
  const ip = req.socket.remoteAddress || '';
  if (!/^(::ffff:)?127\.0\.0\.1$|^::1$/.test(ip)) return res.status(404).end();
  next();
}, simRouter());

// ── go2rtc 프록시 (영상) ───────────────────────────────
const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${GO2RTC_PORT}`, ws: true, changeOrigin: true });
proxy.on('error', (e, req, res) => { if (res?.writeHead && !res.headersSent) { res.writeHead(502); res.end('video relay error'); } });
app.use('/go2rtc', (req, res) => {
  if (!readToken(req) && !/^\/video-(stream|rtc)\.js/.test(req.url)) return res.status(401).end();
  proxy.web(req, res);
});

app.use(express.json());
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e instanceof IsapiError ? (e.status === 401 ? 400 : e.status >= 500 ? 502 : 400) : 500;
  if (!(e instanceof IsapiError)) console.error(e);
  res.status(status).json({ error: e.message });
});

// ── 계정 ──────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
  if (!u || !checkPassword(String(password), u.pass_hash)) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다' });
  setCookie(req, res, makeToken(u.id), SESSION_DAYS * 86400);
  res.json({ username: u.username });
});
app.post('/api/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });
app.get('/api/config', (req, res) => res.json({ demo: DEMO, apkUrl: APK_URL, version: '1.0.0' }));

app.use('/api', requireAuth);
app.get('/api/me', (req, res) => res.json(req.user));
app.post('/api/password', (req, res) => {
  const { current = '', next = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(String(current), u.pass_hash)) return res.status(400).json({ error: '현재 비밀번호가 틀렸습니다' });
  if (String(next).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(next)), u.id);
  res.json({ ok: true });
});

// ── 장비 ──────────────────────────────────────────────
const withStatus = (d) => ({ ...d, status: online.get(d.id) || null });
app.get('/api/devices', (req, res) => res.json(devices.all().map(withStatus)));

function readDeviceForm(b, existing) {
  const host = String(b.host ?? existing?.host ?? '').trim();
  if (!host) throw new IsapiError('장비 IP(주소)를 입력하세요', 400);
  return {
    name: String(b.name ?? existing?.name ?? '').trim(),
    host,
    httpPort: Number(b.httpPort ?? existing?.httpPort) || 80,
    rtspPort: Number(b.rtspPort ?? existing?.rtspPort) || 554,
    https: !!(b.https ?? existing?.https),
    username: String(b.username ?? existing?.username ?? 'admin').trim(),
  };
}

app.post('/api/devices', wrap(async (req, res) => {
  const f = readDeviceForm(req.body);
  const password = String(req.body.password || '');
  const p = await hik.probe(hik.clientFor(f, password));
  const r = db.prepare(`INSERT INTO devices (name, host, http_port, rtsp_port, https, username, pass_enc, kind, model, serial, firmware, mac, channels)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    f.name || p.deviceName || p.model || f.host, f.host, f.httpPort, f.rtspPort, f.https ? 1 : 0, f.username,
    encrypt(password), p.kind, p.model, p.serial, p.firmware, p.mac, JSON.stringify(p.channels));
  const id = Number(r.lastInsertRowid);
  online.set(id, { online: true, checkedAt: Date.now() });
  watchDevice(id);
  res.json(withStatus(devices.get(id)));
}));

app.put('/api/devices/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const cur = devices.get(id);
  if (!cur) return res.status(404).json({ error: '장비 없음' });
  const f = readDeviceForm(req.body, cur);
  const password = req.body.password ? String(req.body.password) : devices.password(id);
  const p = await hik.probe(hik.clientFor(f, password));
  // 사용자가 바꾼 채널 이름은 유지
  const channels = p.channels.map((c) => ({ ...c, name: cur.channels.find((o) => o.no === c.no && o.renamed)?.name || c.name, renamed: cur.channels.find((o) => o.no === c.no)?.renamed }));
  db.prepare(`UPDATE devices SET name=?, host=?, http_port=?, rtsp_port=?, https=?, username=?, pass_enc=?, kind=?, model=?, serial=?, firmware=?, mac=?, channels=? WHERE id=?`)
    .run(f.name || cur.name, f.host, f.httpPort, f.rtspPort, f.https ? 1 : 0, f.username, encrypt(password),
      p.kind, p.model, p.serial, p.firmware, p.mac, JSON.stringify(channels), id);
  hik.forgetClient(id);
  await dropDeviceStreams(id);
  watchDevice(id);
  checkOnline(id);
  res.json(withStatus(devices.get(id)));
}));

app.put('/api/devices/:id/channels/:ch', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const dev = devices.get(id);
  const ch = dev?.channels.find((c) => c.no === Number(req.params.ch));
  if (!ch) return res.status(404).json({ error: '채널 없음' });
  ch.name = String(req.body.name || '').trim() || ch.name;
  ch.renamed = true;
  db.prepare('UPDATE devices SET channels=? WHERE id=?').run(JSON.stringify(dev.channels), id);
  res.json(withStatus(devices.get(id)));
}));

app.delete('/api/devices/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  unwatchDevice(id);
  hik.forgetClient(id);
  await dropDeviceStreams(id);
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  res.json({ ok: true });
}));

app.get('/api/devices/:id/status', wrap(async (req, res) => res.json(await hik.deviceStatus(Number(req.params.id)))));
app.post('/api/devices/:id/reboot', wrap(async (req, res) => { await hik.reboot(Number(req.params.id)); res.json({ ok: true }); }));
app.get('/api/discover', wrap(async (req, res) => res.json(await discover())));

// ── 영상 ──────────────────────────────────────────────
const wsPath = (name) => `/go2rtc/api/ws?src=${encodeURIComponent(name)}`;
app.post('/api/live/:id/:ch', wrap(async (req, res) => {
  const name = await liveStream(Number(req.params.id), Number(req.params.ch), !!req.body?.sub);
  res.json({ name, ws: wsPath(name) });
}));
app.get('/api/snapshot/:id/:ch', wrap(async (req, res) => {
  const img = await hik.snapshot(Number(req.params.id), Number(req.params.ch), req.query.sub === '1');
  res.set('Cache-Control', 'no-store').type(img.type).send(img.data);
}));
app.get('/api/records/:id/:ch', wrap(async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '날짜 형식 오류' });
  res.json(await hik.searchRecords(Number(req.params.id), Number(req.params.ch), date));
}));
app.post('/api/playback/:id/:ch', wrap(async (req, res) => {
  const start = String(req.body?.start || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(start)) return res.status(400).json({ error: '시각 형식 오류' });
  const name = await playbackStream(Number(req.params.id), Number(req.params.ch), start);
  res.json({ name, ws: wsPath(name) });
}));

// ── PTZ ───────────────────────────────────────────────
app.post('/api/ptz/:id/:ch/move', wrap(async (req, res) => {
  await hik.ptzMove(Number(req.params.id), Number(req.params.ch), req.body || {}); res.json({ ok: true });
}));
app.get('/api/ptz/:id/:ch/presets', wrap(async (req, res) => res.json(await hik.ptzPresets(Number(req.params.id), Number(req.params.ch)))));
app.post('/api/ptz/:id/:ch/presets/:pid', wrap(async (req, res) => {
  await hik.ptzGoto(Number(req.params.id), Number(req.params.ch), Number(req.params.pid)); res.json({ ok: true });
}));

// ── 알람 ──────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const where = ['id < ?'];
  const args = [before];
  if (req.query.deviceId) { where.push('device_id = ?'); args.push(Number(req.query.deviceId)); }
  if (req.query.unread === '1') where.push('is_read = 0');
  const rows = db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, limit);
  const unread = db.prepare('SELECT COUNT(*) n FROM events WHERE is_read = 0').get().n;
  res.json({ items: rows.map(decorate), unread });
});
app.post('/api/events/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
  if (ids) for (const id of ids) db.prepare('UPDATE events SET is_read = 1 WHERE id = ?').run(id);
  else db.prepare('UPDATE events SET is_read = 1').run();
  res.json({ ok: true });
});
app.get('/api/events/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  subscribe(res);
});
app.get('/api/snaps/:file', (req, res) => {
  const f = path.basename(req.params.file);
  res.set('Cache-Control', 'private, max-age=86400').sendFile(path.join(SNAP_DIR, f), (e) => e && res.status(404).end());
});

// ── 화면 ──────────────────────────────────────────────
const PUB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
app.use(express.static(PUB, { index: 'index.html', maxAge: '5m' }));
app.get(/^\/(?!api|go2rtc|sim).*/, (req, res) => res.sendFile(path.join(PUB, 'index.html')));

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/go2rtc/') && readToken(req)) {
    req.url = req.url.slice('/go2rtc'.length);
    proxy.ws(req, socket, head);
  } else socket.destroy();
});

// express의 /go2rtc 마운트는 req.url에서 접두어를 제거하므로 HTTP는 그대로 전달됨
startGo2rtc();
server.listen(PORT, () => {
  console.log(`현장뷰 서버 실행: http://localhost:${PORT}  (데모 모드: ${DEMO ? '켜짐' : '꺼짐'})`);
  if (DEMO && !devices.all().length) {
    // 첫 실행 시 가상 NVR 자동 등록
    setTimeout(async () => {
      try {
        const f = { name: '데모 현장 NVR', host: hik.DEMO_HOST, httpPort: PORT, rtspPort: 554, https: false, username: SIM_USER };
        const p = await hik.probe(hik.clientFor(f, SIM_PASS));
        p.channels = p.channels.map((c, i) => ({ ...c, name: ['정문', '주차장', '자재창고', '타워크레인'][i] || c.name, renamed: true }));
        db.prepare(`INSERT INTO devices (name, host, http_port, rtsp_port, https, username, pass_enc, kind, model, serial, firmware, mac, channels)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.host, f.httpPort, f.rtspPort, 0, f.username, encrypt(SIM_PASS),
          p.kind, p.model, p.serial, p.firmware, p.mac, JSON.stringify(p.channels));
        console.log('데모 장비 등록 완료');
      } catch (e) { console.error('데모 장비 등록 실패', e.message); }
      startMonitoring();
    }, 500);
  } else startMonitoring();
});
