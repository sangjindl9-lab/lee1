// 이음챗 서버 — 빌드된 화면(dist)을 내려주고 /ws 로 실시간 채팅을 처리한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createCore } from '../shared/core.js';
import { verifyPurchase, googleReady } from './google.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let data;
try { data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { data = undefined; }

let timer = null;
const save = (db) => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (e) => { if (!e) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {}); });
  }, 1000);
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) console.log('ADMIN_PASSWORD 가 없어 관리자 화면(/admin)은 잠겨 있습니다.');
if (!googleReady) console.log('GOOGLE_SERVICE_ACCOUNT_JSON / ANDROID_PACKAGE 가 없어 Google 결제 검증이 꺼져 있습니다.');
const core = createCore({ data, save, adminPassword: ADMIN_PASSWORD, verifyPurchase: googleReady ? verifyPurchase : null });

const app = express();
app.get('/health', (_q, r) => r.json({ ok: true, users: Object.keys(core.db.users).length }));
// 안드로이드 앱(TWA)이 이 사이트의 주인임을 증명하는 파일
app.get('/.well-known/assetlinks.json', (_q, r) => r.json(process.env.ANDROID_PACKAGE && process.env.ANDROID_SHA256 ? [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: process.env.ANDROID_PACKAGE, sha256_cert_fingerprints: process.env.ANDROID_SHA256.split(',').map((x) => x.trim()) },
}] : []));
app.use(express.static(path.join(root, 'dist'), { extensions: ['html'] })); // /privacy → privacy.html
app.get('*', (_q, r) => r.sendFile(path.join(root, 'dist', 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  ws.alive = true;
  // Railway 등 프록시 뒤에서는 x-forwarded-for 의 첫 값이 실제 접속 IP 다.
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '');
  let count = 0; let windowStart = Date.now();
  const session = core.connect((m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, { ip, ua });
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart > 10e3) { windowStart = now; count = 0; }
    if (++count > 60) return; // 10초에 60건 넘으면 버린다
    try { session.recv(JSON.parse(raw.toString())); } catch { /* 잘못된 메시지는 무시 */ }
  });
  ws.on('close', () => session.close());
});

setInterval(() => {
  wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); });
}, 30e3);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`이음챗 서버 실행: http://localhost:${PORT}`));
