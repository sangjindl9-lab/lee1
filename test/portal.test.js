'use strict';
/* 발급 관리 사이트 통합 시험 — 실제 PostgreSQL (TEST_DATABASE_URL) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createPool, migrate } = require('../lib/db');
const { buildApp } = require('../server');
const L = require('../lib/license');

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:devpass@127.0.0.1:5432/portal_test';
const PW = 'test-admin-password-1';
let pool, server, base, cookie = '';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

async function call(path, { method = 'GET', json, auth = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-portal': '1', cookie } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

before(async () => {
  pool = createPool(DB);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
  const app = buildApp({ pool, privateKey, adminPassword: PW, sessionSecret: 'x'.repeat(40) });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

test('로그인하지 않으면 관리 기능을 쓸 수 없고, 틀린 비밀번호는 거부된다', async () => {
  assert.equal((await call('/api/admin/customers', { auth: false })).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', json: { password: 'wrong' } })).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', json: { password: PW } })).status, 200);
  assert.ok(cookie.startsWith('sid='));
});

test('위조 요청(사용자 지정 헤더 없음)은 막힌다', async () => {
  const r = await fetch(base + '/api/admin/customers', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  assert.equal(r.status, 403);
});

let cust;
test('고객 등록: 사업자번호 검증·중복 거부, 설치 코드 생성', async () => {
  assert.equal((await call('/api/admin/customers', { method: 'POST', json: { name: '틀린번호', bizRegNo: '1234567890' } })).status, 400);
  const r = await call('/api/admin/customers', { method: 'POST', json: { name: '㈜테스트전기', bizRegNo: '220-86-60440', deployment: 'HOSTED', contactName: '김담당' } });
  assert.equal(r.status, 201);
  assert.equal((await call('/api/admin/customers', { method: 'POST', json: { name: '중복', bizRegNo: '2208660440' } })).status, 409);
  cust = (await call('/api/admin/customers/' + r.body.id)).body;
  assert.match(cust.activationCode, /^SS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(cust.state, 'NONE');
});

test('신규 발급: 1년, 판매자 키 서명, 고객 사업자번호 포함', async () => {
  assert.equal((await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'RENEW' } })).status, 400);
  const r = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: 15, amount: 1200000, startsOn: L.kstToday() } });
  assert.equal(r.status, 201);
  const p = L.verify(r.body.licenseText, publicKey);
  assert.ok(p, '서명 확인');
  assert.equal(p.bizRegNo, '2208660440');
  assert.equal(p.maxUsers, 15);
  assert.equal(p.expiresAt, L.oneYearFrom(L.kstToday()));
  // 다른 키로는 검증되지 않는다
  assert.equal(L.verify(r.body.licenseText, crypto.generateKeyPairSync('ed25519').publicKey), null);
});

test('연장은 기존 만료일 다음 날부터 1년, 변경은 만료일 유지', async () => {
  const before = (await call('/api/admin/customers/' + cust.id)).body.current;
  const r = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'RENEW', amount: 1200000 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.startsOn, L.addDays(before.expiresAt, 1));
  assert.equal(r.body.expiresAt, L.oneYearFrom(L.addDays(before.expiresAt, 1)));
  const c = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'CHANGE', maxUsers: 25 } });
  assert.equal(c.body.expiresAt, r.body.expiresAt);
  assert.equal(c.body.maxUsers, 25);
});

test('고객 서버 확인: 설치 코드 + 사업자번호가 맞아야 최신 라이선스를 준다', async () => {
  assert.equal((await call('/api/v1/check', { method: 'POST', auth: false, json: { code: 'SS-AAAA-BBBB-CCCC', bizRegNos: ['2208660440'] } })).status, 404);
  assert.equal((await call('/api/v1/check', { method: 'POST', auth: false, json: { code: cust.activationCode, bizRegNos: ['1018117536'] } })).status, 403);
  const ok = await call('/api/v1/check', { method: 'POST', auth: false, json: { code: cust.activationCode.toLowerCase(), bizRegNos: ['2208660440'], activeUsers: 7, appVersion: '1.0.0' } });
  assert.equal(ok.status, 200);
  assert.equal(L.verify(ok.body.license, publicKey).maxUsers, 25);
  const c = (await call('/api/admin/customers/' + cust.id)).body;
  assert.equal(c.lastActiveUsers, 7);
  assert.ok(c.lastSeenAt);
});

test('저장 용량: 기본 1GB, 변경 발급으로 늘리고 연장 때는 유지, 고객 서버가 알려 준 사용량 기록', async () => {
  const cur = (await call('/api/admin/customers/' + cust.id)).body;
  assert.equal(cur.current.storageMB, 1024, '입력 없으면 1GB');
  assert.equal(L.verify((await call('/api/admin/licenses/' + cur.licenses[0].id)).body.licenseText, publicKey).storageMB, 1024);
  assert.equal((await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'CHANGE', storageGB: 0.1 } })).status, 400);
  const ch = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'CHANGE', storageGB: 5 } });
  assert.equal(ch.status, 201);
  assert.equal(L.verify(ch.body.licenseText, publicKey).storageMB, 5120);
  const rn = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'RENEW' } });
  assert.equal(L.verify(rn.body.licenseText, publicKey).storageMB, 5120, '연장은 용량 유지');
  await call('/api/v1/check', { method: 'POST', auth: false, json: { code: cust.activationCode, bizRegNos: ['2208660440'], activeUsers: 7, usedMB: 4300 } });
  const c = (await call('/api/admin/customers/' + cust.id)).body;
  assert.equal(c.usedMB, 4300);
  assert.equal(c.current.storageMB, 5120);
});

test('사용 중지는 어제 만료로 재발급, 해제하면 원래 만료일로 돌아온다', async () => {
  const keep = (await call('/api/admin/customers/' + cust.id)).body.current.expiresAt;
  const s = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'SUSPEND', memo: '연체' } });
  assert.equal(s.body.expiresAt, L.addDays(L.kstToday(), -1));
  assert.equal((await call('/api/admin/customers/' + cust.id)).body.state, 'SUSPENDED');
  assert.equal((await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'RENEW' } })).status, 400);
  const r = await call(`/api/admin/customers/${cust.id}/licenses`, { method: 'POST', json: { kind: 'RESUME' } });
  assert.equal(r.body.expiresAt, keep);
  assert.equal((await call('/api/admin/customers/' + cust.id)).body.state, 'ACTIVE');
});

test('대시보드·발급 대장·CSV·활동 기록', async () => {
  const s = (await call('/api/admin/summary')).body;
  assert.equal(s.customers, 1);
  assert.equal(s.revenueYear.total, 2400000);
  const list = (await call('/api/admin/licenses')).body;
  assert.equal(list.length, 7);
  assert.equal(list[0].licenseText, undefined, '목록에는 라이선스 원문을 싣지 않는다');
  const csv = await call('/api/admin/licenses?format=csv');
  assert.match(csv.body, /발급일시/);
  assert.ok((await call('/api/admin/audit')).body.some((a) => a.action === 'LICENSE_ISSUE'));
  // 발급 후에는 사업자번호를 바꿀 수 없다
  assert.equal((await call('/api/admin/customers/' + cust.id, { method: 'PUT', json: { name: '바꿈', bizRegNo: '1018117536' } })).status, 400);
});

test('관리자 비밀번호를 화면에서 바꾸면 새 비밀번호로만 로그인되고 다른 세션은 끊긴다', async () => {
  const other = cookie;
  assert.equal((await call('/api/admin/password', { method: 'POST', json: { current: 'wrong-one', next: 'NewPass!2026xyz' } })).status, 400);
  assert.equal((await call('/api/admin/password', { method: 'POST', json: { current: PW, next: 'short' } })).status, 400);
  assert.equal((await call('/api/admin/password', { method: 'POST', json: { current: PW, next: 'alllowercaseletters' } })).status, 400);
  const ok = await call('/api/admin/password', { method: 'POST', json: { current: PW, next: 'NewPass!2026xyz' } });
  assert.equal(ok.status, 200);
  // 바꾼 화면은 계속 쓸 수 있다 (새 쿠키)
  assert.equal((await call('/api/admin/me')).status, 200);
  assert.ok((await call('/api/admin/me')).body.passwordChangedAt);
  // 예전 세션은 끊긴다
  const old = await fetch(base + '/api/admin/me', { headers: { cookie: other } });
  assert.equal(old.status, 401);
  // 예전 비밀번호(환경변수)는 더 이상 안 되고 새 비밀번호만 된다
  assert.equal((await call('/api/admin/login', { method: 'POST', json: { password: PW } })).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', json: { password: 'NewPass!2026xyz' } })).status, 200);
});

test('고객 ERP 접속: 접속 주소가 있어야 하고, 2분짜리 판매자 서명 티켓을 돌려준다', async () => {
  assert.equal((await call(`/api/admin/customers/${cust.id}/access`, { method: 'POST' })).status, 400);
  await call('/api/admin/customers/' + cust.id, { method: 'PUT', json: { ...cust, serverUrl: 'https://erp.example.com/' } });
  const r = await call(`/api/admin/customers/${cust.id}/access`, { method: 'POST' });
  assert.equal(r.status, 200);
  const u = new URL(r.body.url);
  assert.equal(u.origin + u.pathname, 'https://erp.example.com/api/v1/auth/vendor-login');
  const t = L.verify(u.searchParams.get('ticket'), publicKey);
  assert.equal(t.kind, 'vendor-access');
  assert.equal(t.bizRegNo, '2208660440');
  assert.ok(t.exp - t.iat <= 2 * 60_000 && t.exp > Date.now());
});
