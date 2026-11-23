// 2단계: 외부 공유 링크(휴대폰 중계) · 클라우드 연동 준비 상태 검증
import WebSocket from 'ws';
import crypto from 'node:crypto';
const BASE = process.env.BASE || 'http://localhost:8099';
const WSB = BASE.replace('http', 'ws');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function api(path, body, token, method) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const email = `s${Date.now()}@example.com`;
await api('/api/auth/register', { email, password: 'password123' });
const la = await api('/api/auth/login', { email, password: 'password123', device: { kind: 'android', name: '테스트폰', installId: 'and-s' } });
const lp = await api('/api/auth/login', { email, password: 'password123', device: { kind: 'pc', name: '테스트PC', installId: 'pc-s' } });
const A = la.j.token, P = lp.j.token, aid = la.j.device.id;
const pr = await api('/api/pair/request', { androidId: aid }, P);
await api(`/api/permissions/${pr.j.id}/approve`, { folders: ['/storage/emulated/0/Download'] }, A);

// 가짜 휴대폰: 1.3MB 파일을 가진 것처럼 응답
const FILE = crypto.randomBytes(1300 * 1024);
const ws = new WebSocket(WSB + '/ws?token=' + A);
await new Promise((r) => ws.on('open', r));
let served = 0;
ws.on('message', (d) => {
  const m = JSON.parse(d); if (m.t !== 'req') return;
  const allowed = m.perm.folders.some((f) => m.args.path.startsWith(f + '/'));
  if (!allowed) return ws.send(JSON.stringify({ t: 'res', id: m.id, ok: false, error: 'denied', message: '허용 안 됨' }));
  if (m.op === 'stat') return ws.send(JSON.stringify({ t: 'res', id: m.id, ok: true, data: { name: '보고서 최종.pdf', path: m.args.path, dir: false, size: FILE.length } }));
  if (m.op === 'read') {
    served++;
    const b = FILE.subarray(m.args.offset, m.args.offset + m.args.length);
    ws.send(JSON.stringify({ t: 'res', id: m.id, ok: true, data: { b64: b.toString('base64'), size: FILE.length, eof: m.args.offset + b.length >= FILE.length } }));
  }
});
await new Promise((r) => setTimeout(r, 300));

console.log('공유 링크');
ok((await api('/api/shares', { kind: 'phone', androidId: aid, path: '/storage/emulated/0/DCIM/a.jpg' }, P)).status === 403, '허용 폴더 밖 공유 거부');
ok((await api('/api/shares', { kind: 'phone', androidId: aid, path: '/storage/emulated/0/Download/r.pdf', password: '12' }, P)).status === 400, '짧은 비밀번호 거부');
const sh = await api('/api/shares', { kind: 'phone', androidId: aid, path: '/storage/emulated/0/Download/r.pdf', password: 'abcd1234', maxDownloads: 1, expiresHours: 24 }, P);
ok(sh.status === 200 && sh.j.name === '보고서 최종.pdf' && sh.j.hasPassword, '공유 링크 생성');
const slug = sh.j.url.split('/s/')[1];
const pg = await fetch(`${BASE}/s/${slug}`);
ok(pg.status === 200 && (await pg.text()).includes('보고서 최종.pdf'), '받는 페이지 표시');
const post = (pw) => fetch(`${BASE}/s/${slug}/download`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: pw }) });
ok((await post('wrong')).status === 403, '틀린 비밀번호 거부');
const dl = await post('abcd1234');
const buf = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && buf.equals(FILE), `휴대폰에서 중계해 받기 (${buf.length} bytes, 조각 ${served}개)`);
ok(/filename\*=UTF-8''/.test(dl.headers.get('content-disposition') || ''), '한글 파일 이름');
ok((await post('abcd1234')).status >= 400, '횟수 제한 초과 거부');
const sh2 = await api('/api/shares', { kind: 'phone', androidId: aid, path: '/storage/emulated/0/Download/r.pdf' }, P);
await api(`/api/shares/${sh2.j.id}/revoke`, {}, P);
ok((await fetch(sh2.j.url)).status === 404, '공유 해제 후 접근 불가');
const list = (await api('/api/shares', null, P)).j;
ok(list.length === 2 && list.every((s) => !s.active), '내 공유 목록');
ws.close(); await new Promise((r) => setTimeout(r, 300));
const sh3 = await api('/api/shares', { kind: 'phone', androidId: aid, path: '/storage/emulated/0/Download/r.pdf' }, P);
ok(sh3.status === 409, '휴대폰 오프라인이면 공유 생성 안내');

console.log('클라우드');
const prov = (await api('/api/cloud/providers')).j;
ok(prov.length === 3 && prov.every((p) => 'ready' in p && !('missing' in p)), '공급자 3개 상태 (내부 설정값 비노출)');
const notReady = prov.find((p) => !p.ready);
if (notReady) ok((await api(`/api/cloud/${notReady.id}/start`, {}, P)).j?.error === 'not_configured', `${notReady.label}: 연동 준비 필요 안내`);
ok(Array.isArray((await api('/api/cloud', null, P)).j), '내 클라우드 연결 목록');
ok((await api('/api/cloud/gdrive/callback?state=bad&code=x')).status === 400, '위조 콜백 거부');
ok((await api('/api/cloud/00000000-0000-0000-0000-000000000000/list', null, P)).status === 404, '남의/없는 연결 접근 거부');
await api('/api/account', { password: 'password123' }, P, 'DELETE');
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
