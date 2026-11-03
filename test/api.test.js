import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jindan-'));
process.env.DATA_DIR = dir; process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@test.kr'; process.env.ADMIN_PASSWORD = 'admin1234';
delete process.env.ANTHROPIC_API_KEY;
const { default: app } = await import('../server/index.js');
let server; let base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function client(email, role = 'user', extra = {}) {
  const res = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, pw: 'password1', role, ...extra }) });
  const { token } = await res.json();
  return (m, p, body) => fetch(base + p, { method: m, headers: { authorization: 'Bearer ' + token, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
}
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

test('전체 흐름 + 다른 고객 접근 차단 + 보고서 재현', async () => {
  const a = await client('a@test.kr'); const b = await client('b@test.kr');
  const { id } = await (await a('POST', '/api/sites', { name: '우리 카페', address: '서울시 마포구 어딘가로 1', info: { phase: '1', v_phase: 220, contract_kw: 5, supply_type: 'kepco_direct' } })).json();
  const { id: pid } = await (await a('POST', `/api/sites/${id}/panels`, { name: '주분전반', main_breaker: { af: 50, at: 30 } })).json();
  const { id: cid } = await (await a('POST', `/api/sites/${id}/circuits`, { panel_id: pid, name: '주방', breaker: { at: 20 } })).json();
  await a('POST', `/api/sites/${id}/devices`, { name: '커피머신', power_value: 3000, pf: 1, circuit_id: cid, qty: 1 });
  await a('POST', `/api/sites/${id}/devices`, { name: '제빙기', power_value: 1500, pf: 1, circuit_id: cid, status: 'planned', qty: 1 });
  // 사진 업로드: 형식 검증
  const fd = new FormData(); fd.append('kind', 'panel'); fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg');
  const up = await (await a('POST', `/api/sites/${id}/files`, fd)).json(); assert.ok(up.id);
  const fd2 = new FormData(); fd2.append('kind', 'panel'); fd2.append('file', new Blob(['hello'], { type: 'image/jpeg' }), 'x.jpg');
  assert.equal((await a('POST', `/api/sites/${id}/files`, fd2)).status, 415);
  // AI 미설정 → 미설정 상태로 기록, 수동 입력 진행
  const ex = await (await a('POST', `/api/sites/${id}/extract`, { file_id: up.id })).json();
  assert.equal(ex.status, 'not_configured');

  const r1 = await (await a('GET', `/api/sites/${id}/result`)).json();
  assert.equal(r1.result.verdict, '배선·차단기·회로 개선 검토'); // 4500W/220V=20.5A > 20A
  // 다른 고객: 장소·사진·보고서 접근 차단
  assert.equal((await b('GET', `/api/sites/${id}`)).status, 404);
  assert.equal((await b('GET', `/api/files/${up.id}`)).status, 404);
  const { id: rid } = await (await a('POST', `/api/sites/${id}/reports`, { kind: 'basic' })).json();
  assert.equal((await b('GET', `/api/reports/${rid}`)).status, 404);
  assert.equal((await b('GET', `/api/reports/${rid}/pdf`)).status, 404);
  const pdf = await a('GET', `/api/reports/${rid}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((await pdf.arrayBuffer()).byteLength > 5000);
  // 결과 수정 후 재계산, 이전 보고서는 당시 조건 유지
  await a('PUT', `/api/sites/${id}/circuits/${cid}`, { breaker: { at: 30 } });
  const r2 = await (await a('GET', `/api/sites/${id}/result`)).json();
  assert.notEqual(r2.result.circuits[0].status, 'over');
  const old = await (await a('GET', `/api/reports/${rid}`)).json();
  assert.equal(old.snapshot.calc.result.circuits[0].status, 'over');
  // 상세 보고서는 이용권 필요
  assert.equal((await a('POST', `/api/sites/${id}/reports`, { kind: 'detail' })).status, 402);
  // 공유 링크
  const sh = await (await a('POST', `/api/reports/${rid}/share`, { days: 1 })).json();
  assert.equal((await fetch(base + sh.url)).status, 200);
  assert.equal((await fetch(base + '/s/nope')).status, 410);
  // 업체 공유(고객 동의) 후에만 업체 접근
  const c = await client('c@test.kr', 'contractor', { company_name: '테스트전기' });
  assert.equal((await c('GET', `/api/sites/${id}`)).status, 404);
  const cos = await (await c('GET', '/api/companies')).json();
  await a('POST', `/api/sites/${id}/shares`, { company_id: cos[0].id });
  const seen = await (await c('GET', `/api/sites/${id}`)).json();
  assert.equal(seen.name, '우리 카페');
  const list = await (await c('GET', '/api/sites')).json();
  assert.match(list[0].address, /\*\*\*/); // 업체 목록에서는 주소 마스킹
  // 감사 기록 존재
  const au = await (await a('GET', `/api/sites/${id}/audit`)).json();
  assert.ok(au.some((x) => x.entity === 'circuit' && x.action === 'update'));
});

test('단가 미등록 시 견적 정보 부족, 한전 요율 없음 → 확인 필요', async () => {
  const a = await client('d@test.kr');
  const { id } = await (await a('POST', '/api/sites', { name: '집', info: { phase: '1', v_phase: 220, contract_kw: 3, supply_type: 'kepco_direct' } })).json();
  await a('PUT', `/api/sites/${id}/quote`, { items: [{ code: 'NEW-CIRCUIT', name: '전용회로 신설', qty_min: 1, qty_max: 1 }], kepco_req: { app_type: 'increase', kw_after: 6, apply_date: '2026-12-01' } });
  const r = await (await a('GET', `/api/sites/${id}/result`)).json();
  assert.equal(r.quote.status, '정보 부족');
  assert.equal(r.kepco.subtotal, null);
  assert.ok(r.kepco.items.every((i) => i.status === 'unresolved'));
});
