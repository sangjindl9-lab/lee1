'use strict';
/* 고객관리(계약·전자서명·과금·상담) 시험 — 실제 PostgreSQL (TEST_DATABASE_URL) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createPool, migrate } = require('../lib/db');
const { buildApp } = require('../server');
const L = require('../lib/license');
const { addMonths } = require('../lib/crm');

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:devpass@127.0.0.1:5432/portal_test';
const PW = 'test-admin-password-1';
let pool, server, base, cookie = '';
const { privateKey } = crypto.generateKeyPairSync('ed25519');
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function call(path, { method = 'GET', json } = {}) {
  const res = await fetch(base + '/api/admin' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-portal': '1', cookie },
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
  await migrate(pool); // 두 번 돌려도 문제없어야 한다 (운영 DB 재시작)
  const app = buildApp({ pool, privateKey, adminPassword: PW, sessionSecret: 'x'.repeat(40) });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('/login', { method: 'POST', json: { password: PW } });
});
after(async () => {
  server.close();
  await pool.end();
});

let cust, k;
const start = L.kstToday();
test('계약 작성: 요금제로 이용료 자동 계산, 고객 단계가 제안·견적으로', async () => {
  cust = (await call('/customers', { method: 'POST', json: { name: '삼우전선', bizRegNo: '431-86-01056', deployment: 'ONPREM' } })).body.id;
  assert.equal((await call('/crm/customers')).body[0].stage, '리드');
  const bad = await call('/contracts', { method: 'POST', json: { customerId: cust, product: 'SS-ERP', planId: 'gm-std', startsOn: start, endsOn: L.oneYearFrom(start) } });
  assert.equal(bad.status, 400, '다른 제품의 요금제는 거부');
  // 스탠다드 설치형 3,000,000 + 추가 5명×100,000 + 세금계산서 600,000 = 4,100,000 / 1회: 구축비 1,500,000 + 이전 500,000
  const r = await call('/contracts', { method: 'POST', json: { customerId: cust, product: 'SS-ERP', deployment: 'ONPREM', planId: 'erp-std', seats: 20, options: ['taxinv', 'migrate'], startsOn: start, endsOn: L.oneYearFrom(start), billMethod: '분기 분납', payMethod: 'CMS 자동이체', payDays: 10 } });
  assert.equal(r.status, 201);
  assert.match(r.body.no, /^SS-C-\d{4}-001$/);
  k = (await call('/contracts/' + r.body.id)).body;
  assert.equal(k.annualFee, 4100000);
  assert.equal(k.onceFee, 2000000);
  assert.equal(k.status, 'DRAFT');
  assert.equal((await call('/crm/customers')).body[0].stage, '제안·견적');
});

test('전자서명: 한쪽만 서명하면 서명대기, 내용 수정 시 서명 초기화, 양측 서명이면 체결·해시', async () => {
  assert.equal((await call(`/contracts/${k.id}/sign`, { method: 'POST', json: { who: 'provider', name: '김세인', image: SIG } })).status, 400, '동의 없이는 서명 불가');
  assert.equal((await call(`/contracts/${k.id}/sign`, { method: 'POST', json: { who: 'provider', name: '김세인', image: 'data:text/html,<x>', agree: true } })).status, 400);
  assert.equal((await call(`/contracts/${k.id}/sign`, { method: 'POST', json: { who: 'provider', name: '김세인', image: SIG, agree: true } })).body.status, 'PENDING');
  // 수정하면 서명이 지워진다
  await call('/contracts/' + k.id, { method: 'PUT', json: { ...k, seats: 20 } });
  assert.equal((await call('/contracts/' + k.id)).body.status, 'DRAFT');
  assert.deepEqual((await call('/contracts/' + k.id)).body.signatures, {});
  await call(`/contracts/${k.id}/sign`, { method: 'POST', json: { who: 'provider', name: '김세인', image: SIG, agree: true } });
  const done = await call(`/contracts/${k.id}/sign`, { method: 'POST', json: { who: 'customer', name: '삼우 대표', image: SIG, agree: true, method: '화상 미팅 서명' } });
  assert.equal(done.body.status, 'SIGNED');
  assert.match(done.body.docHash, /^[0-9a-f]{64}$/);
  assert.equal((await call('/crm/customers')).body[0].stage, '운영중');
  assert.equal((await call('/contracts/' + k.id, { method: 'PUT', json: k })).status, 400, '체결 후 수정 불가');
  assert.equal((await call('/contracts/' + k.id, { method: 'DELETE' })).status, 400, '체결 후 삭제 불가');
});

test('청구 일정: 분기 분납 4회, 1회성 비용은 첫 회차, 합계는 연 이용료와 같다', async () => {
  const r = await call(`/contracts/${k.id}/invoices`, { method: 'POST' });
  assert.equal(r.body.count, 4);
  assert.equal((await call(`/contracts/${k.id}/invoices`, { method: 'POST' })).status, 400, '두 번 만들 수 없다');
  const list = (await call('/invoices?customerId=' + cust)).body;
  assert.equal(list.length, 4);
  assert.equal(list[0].supply, 1025000 + 2000000);
  assert.equal(list.reduce((a, i) => a + i.supply, 0), 4100000 + 2000000);
  assert.equal(list[0].vat, Math.round(list[0].supply * 0.1));
  assert.equal(list[1].issueDate, addMonths(start, 3));
  assert.equal(list[0].dueDate, L.addDays(start, 10));
  assert.equal(list[0].payMethod, 'CMS 자동이체');
});

test('입금: 부분입금 → 완납, 납기 지난 청구는 연체, 입금 있는 청구는 삭제 불가', async () => {
  let [first] = (await call('/invoices?customerId=' + cust)).body;
  await call(`/invoices/${first.id}/pay`, { method: 'POST', json: { amount: 1000000, date: start } });
  [first] = (await call('/invoices?customerId=' + cust)).body;
  assert.equal(first.state, '부분입금');
  await call(`/invoices/${first.id}/pay`, { method: 'POST', json: { amount: first.total - 1000000, date: start, taxInvoice: true } });
  [first] = (await call('/invoices?customerId=' + cust)).body;
  assert.equal(first.state, '완납');
  assert.equal(first.payments.length, 2);
  assert.equal(first.taxInvoice, true);
  assert.equal((await call('/invoices/' + first.id, { method: 'DELETE' })).status, 400);

  const late = await call('/invoices', { method: 'POST', json: { customerId: cust, period: '커스터마이징 개발비', issueDate: L.addDays(start, -40), dueDate: L.addDays(start, -35), supply: 500000, billed: true } });
  assert.equal(late.status, 201);
  const s = (await call('/crm/summary')).body;
  assert.equal(s.overdue.count, 1);
  assert.equal(s.overdue.total, 550000);
  assert.equal(s.overdue.list[0].overdueDays, 35);
  assert.equal(s.arr, 4100000);
  assert.ok(s.monthly.at(-1).paid >= first.total);
  const csv = await call('/invoices?format=csv');
  assert.match(csv.body, /연체/);
});

test('SS-ERP 계약 체결 후 기존 발급 기능으로 라이선스 발급, 계약에 연결', async () => {
  const lic = await call(`/customers/${cust}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: k.seats, startsOn: k.startsOn, expiresAt: k.endsOn, amount: k.annualFee, memo: k.no } });
  assert.equal(lic.status, 201);
  assert.equal((await call(`/contracts/${k.id}/license`, { method: 'POST', json: { licenseRowId: lic.body.id } })).status, 200);
  assert.equal((await call('/contracts/' + k.id)).body.licenseRowId, lic.body.id);
  assert.equal((await call('/contracts/' + k.id)).body.customer.hasLicense, true);
});

test('갱신 계약은 다음 날부터 1년, 1회성 비용 제외 / 해지하면 고객 단계가 해지로', async () => {
  const r = await call(`/contracts/${k.id}/renew`, { method: 'POST' });
  const nk = (await call('/contracts/' + r.body.id)).body;
  assert.equal(nk.startsOn, L.addDays(k.endsOn, 1));
  assert.equal(nk.onceFee, 0);
  assert.deepEqual(nk.options, ['taxinv']);
  assert.equal(nk.annualFee, 4100000);
  assert.equal(nk.renewOf, k.id);
  assert.equal((await call(`/contracts/${k.id}/terminate`, { method: 'POST' })).status, 200);
  assert.equal((await call('/crm/customers')).body[0].stage, '해지');
});

test('상담 기록과 요금제 설정', async () => {
  assert.equal((await call('/tickets', { method: 'POST', json: { customerId: cust, title: '' } })).status, 400);
  const t = await call('/tickets', { method: 'POST', json: { customerId: cust, type: '커스터마이징', title: '발주서 양식 변경', body: '회사 양식 그대로' } });
  assert.equal(t.status, 201);
  assert.equal((await call('/crm/summary')).body.openTickets.length, 1);
  await call('/tickets/' + t.body.id, { method: 'PUT', json: { title: '발주서 양식 변경', status: '완료' } });
  assert.equal((await call('/crm/summary')).body.openTickets.length, 0);

  const cfg = (await call('/crm/config')).body;
  assert.equal(cfg.saved, false);
  cfg.plans[0].hosting = 2000000;
  assert.equal((await call('/crm/config', { method: 'PUT', json: { ...cfg, examplePrices: false } })).status, 200);
  const after = (await call('/crm/config')).body;
  assert.equal(after.saved, true);
  assert.equal(after.plans[0].hosting, 2000000);
  assert.equal(after.examplePrices, false);
  assert.equal((await call('/crm/config', { method: 'PUT', json: { ...cfg, plans: [] } })).status, 400);
});
