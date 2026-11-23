// 동영상 촬영용: PC 역할 클라이언트 (실제 운영 서버 사용)
import WebSocket from 'ws';
const BASE = 'https://fm2-connect-production.up.railway.app';
const [email, password, phase] = process.argv.slice(2);
const api = async (p, body, token) => { const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lp = await api('/api/auth/login', { email, password, device: { kind: 'pc', name: '사무실 PC', installId: 'demo-pc', platform: 'Windows 11' } });
const P = lp.token;
const phone = (await api('/api/devices', null, P)).find((d) => d.kind === 'android');
if (phase === 'request') {
  console.log('pair', JSON.stringify(await api('/api/pair/request', { androidId: phone.id }, P)));
  process.exit(0);
}
// phase transfer: 승인될 때까지 기다린 뒤 목록·파일 받기
for (let i = 0; i < 60; i++) { const ps = await api('/api/permissions', null, P); if (ps.some((p) => p.status === 'approved')) break; await sleep(2000); }
const ws = new WebSocket(BASE.replace('https', 'wss') + '/ws?token=' + P);
await new Promise((r) => ws.on('open', r));
const pend = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'res' && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const req = (op, args) => new Promise((r) => { const id = 'v' + Math.random(); pend.set(id, r); ws.send(JSON.stringify({ t: 'req', id, to: phone.id, op, args })); });
for (let round = 0; round < 6; round++) {
  const roots = await req('roots', {}); console.log('roots', JSON.stringify(roots).slice(0, 200));
  const root = roots.data?.[0]?.path;
  if (root) {
    const l = await req('list', { path: root }); console.log('list', JSON.stringify(l).slice(0, 300));
    const f = l.data?.items?.find((x) => !x.dir);
    if (f) { let off = 0; while (off < f.size) { const r = await req('read', { path: f.path, offset: off, length: 512 * 1024 }); if (!r.ok) break; off += Buffer.from(r.data.b64, 'base64').length; } console.log('downloaded', f.name, off); }
  }
  await sleep(8000);
}
ws.close(); process.exit(0);
