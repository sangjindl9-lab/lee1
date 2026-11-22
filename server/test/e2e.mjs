// 실제 서버 + 실제 DB에 대해 모바일/PC 두 클라이언트를 흉내 내어 전체 흐름을 검증
import WebSocket from 'ws';
const BASE = process.env.BASE || 'http://localhost:8099';
const WSB = BASE.replace('http', 'ws');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function api(path, body, token, method) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
function wsc(token) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WSB + '/ws?token=' + token); const inbox = [];
    ws.on('message', (d) => { const m = JSON.parse(d); inbox.push(m); ws.emit('m', m); });
    ws.on('open', () => res({ ws, inbox, next: (pred, ms = 5000) => new Promise((r2, j2) => {
      const f = inbox.find(pred); if (f) { inbox.splice(inbox.indexOf(f), 1); return r2(f); }
      const t = setTimeout(() => j2(new Error('timeout')), ms);
      const h = (m) => { if (pred(m)) { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); ws.off('m', h); r2(m); } };
      ws.on('m', h);
    }) }));
    ws.on('error', rej);
  });
}
const email = `t${Date.now()}@example.com`;
console.log('계정');
ok((await api('/api/auth/register', { email, password: 'short' })).status === 400, '약한 비밀번호 거부');
ok((await api('/api/auth/register', { email, password: 'password123', name: '테스트' })).status === 200, '회원가입');
ok((await api('/api/auth/register', { email, password: 'password123' })).status === 409, '중복 가입 거부');
ok((await api('/api/auth/login', { email, password: 'wrong', device: { kind: 'pc', installId: 'x' } })).status === 401, '틀린 비밀번호 거부');
const la = await api('/api/auth/login', { email, password: 'password123', device: { kind: 'android', name: '갤럭시 S25', installId: 'and-1' } });
const lp = await api('/api/auth/login', { email, password: 'password123', device: { kind: 'pc', name: '사무실 PC', installId: 'pc-1' } });
ok(la.status === 200 && lp.status === 200, '모바일·PC 로그인');
const A = la.j.token, P = lp.j.token, aid = la.j.device.id, pid = lp.j.device.id;
ok((await api('/api/me', null, A)).j.device.kind === 'android', '/api/me');
const devs = (await api('/api/devices', null, P)).j;
ok(devs.length === 2, '기기 목록 2개');

console.log('WebSocket·승인');
const wa = await wsc(A), wp = await wsc(P);
await wa.next((m) => m.t === 'hello'); await wp.next((m) => m.t === 'hello');
wp.ws.send(JSON.stringify({ t: 'req', id: 'r1', to: aid, op: 'list', args: { path: '/storage/emulated/0/DCIM' } }));
ok((await wp.next((m) => m.id === 'r1')).error === 'not_permitted', '승인 전 요청 거부');
const pr = await api('/api/pair/request', { androidId: aid }, P);
ok(pr.j.status === 'pending', 'PC 연결 요청 → 대기');
const note = await wa.next((m) => m.t === 'pair_request');
ok(note.permission.pcName === '사무실 PC', '모바일에 승인 요청 알림');
ok((await api(`/api/permissions/${pr.j.id}/approve`, { folders: ['/storage/emulated/0/DCIM'] }, P)).status === 403, 'PC는 스스로 승인 불가');
const ap = await api(`/api/permissions/${pr.j.id}/approve`, { folders: ['/storage/emulated/0/DCIM', '../etc'], readOnly: false }, A);
ok(ap.j.status === 'approved' && ap.j.folders.length === 1, '모바일 승인 (잘못된 경로 제거)');
await wp.next((m) => m.t === 'perm_changed');

console.log('중계');
wp.ws.send(JSON.stringify({ t: 'req', id: 'r2', to: aid, op: 'list', args: { path: '/storage/emulated/0/DCIM' } }));
const got = await wa.next((m) => m.t === 'req' && m.id === 'r2');
ok(got.perm.folders[0] === '/storage/emulated/0/DCIM' && got.fromName === '사무실 PC', '모바일이 요청+허용 폴더 수신');
wa.ws.send(JSON.stringify({ t: 'res', id: 'r2', ok: true, data: { items: [{ name: 'a.jpg', size: 10 }] } }));
const back = await wp.next((m) => m.id === 'r2');
ok(back.ok && back.data.items[0].name === 'a.jpg', 'PC가 응답 수신');
// 큰 조각(512KB base64) 전송
const big = Buffer.alloc(512 * 1024, 7).toString('base64');
wp.ws.send(JSON.stringify({ t: 'req', id: 'r3', to: aid, op: 'read', args: { path: '/storage/emulated/0/DCIM/a.jpg', offset: 0, length: 524288, total: 524288 } }));
await wa.next((m) => m.id === 'r3');
wa.ws.send(JSON.stringify({ t: 'res', id: 'r3', ok: true, data: { b64: big, eof: true } }));
const b3 = await wp.next((m) => m.id === 'r3');
ok(b3.data.b64.length === big.length, '512KB 조각 중계');
const tr = (await api('/api/transfers', null, P)).j;
ok(tr.length >= 1 && tr[0].direction === 'mobile_to_pc', '전송 기록 저장');

console.log('연결 코드·읽기 전용');
await api(`/api/permissions/${pr.j.id}/revoke`, {}, A);
wp.ws.send(JSON.stringify({ t: 'req', id: 'r4', to: aid, op: 'list', args: {} }));
ok((await wp.next((m) => m.id === 'r4')).error === 'not_permitted', '연결 해제 후 거부');
const code = (await api('/api/pair/code', { folders: ['/storage/emulated/0/Download'], readOnly: true }, A)).j.code;
ok(/^\d{6}$/.test(code), '6자리 코드 발급');
ok((await api('/api/pair/redeem', { code: '000000' }, P)).status === 400, '틀린 코드 거부');
const rd = await api('/api/pair/redeem', { code }, P);
ok(rd.j.status === 'approved' && rd.j.readOnly === true, '코드로 연결 (읽기 전용)');
ok((await api('/api/pair/redeem', { code }, P)).status === 400, '코드 재사용 거부');
wp.ws.send(JSON.stringify({ t: 'req', id: 'r5', to: aid, op: 'delete', args: { path: '/storage/emulated/0/Download/x' } }));
ok((await wp.next((m) => m.id === 'r5')).error === 'read_only', '읽기 전용에서 삭제 거부');

console.log('오프라인·차단');
wa.ws.close(); await new Promise((r) => setTimeout(r, 400));
const pres = await wp.next((m) => m.t === 'presence' && m.online === false).catch(() => null);
ok(!!pres, 'PC에 모바일 오프라인 알림');
wp.ws.send(JSON.stringify({ t: 'req', id: 'r6', to: aid, op: 'list', args: {} }));
ok((await wp.next((m) => m.id === 'r6')).error === 'device_offline', '오프라인이면 즉시 안내');
await api(`/api/devices/${aid}/revoke`, {}, P);
ok((await api('/api/me', null, A)).status === 401, '차단된 기기 토큰 무효');
const logs = (await api('/api/logs', null, P)).j;
ok(logs.some((l) => l.action === 'pair_approved'), '접근 기록 조회');
ok((await api('/api/account', { password: 'password123' }, P, 'DELETE')).status === 200, '계정 삭제');
ok((await api('/api/me', null, P)).status === 401, '삭제 후 로그인 무효');
wp.ws.close();
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
