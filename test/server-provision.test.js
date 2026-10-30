'use strict';
/* 고객 서버 자동 개설 — 가짜 Railway API 로 전체 흐름 시험 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { createPool, migrate } = require('../lib/db');
const { buildApp } = require('../server');
const R = require('../lib/railway');

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:devpass@127.0.0.1:5432/portal_test2';
const PW = 'test-admin-password-1';
let pool, server, base, rail, railUrl, ghs, ghUrl, cookie = '';
const issues = []; // 가짜 GitHub 이슈 저장
const calls = [];
let failOnce = null; // 이 mutation 이름이 처음 불릴 때 오류
let deployStatus = 'SUCCESS';
const { privateKey } = crypto.generateKeyPairSync('ed25519');

function fakeRailway(req, res) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const { query, variables } = JSON.parse(raw);
    const name = (query.match(/\{\s*(\w+)/) ?? [])[1];
    calls.push({ name, variables, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (failOnce && name === failOnce) {
      failOnce = null;
      return res.end(JSON.stringify({ errors: [{ message: '일시적 오류' }] }));
    }
    const data = {
      workspace: { workspace: { id: variables.w, name: 'ws' } },
      projectCreate: { projectCreate: { id: 'proj-1', environments: { edges: [{ node: { id: 'env-1', name: 'production' } }] } } },
      serviceCreate: { serviceCreate: { id: variables.input?.name === 'Postgres' ? 'svc-pg' : 'svc-app' } },
      serviceInstanceUpdate: { serviceInstanceUpdate: true },
      volumeCreate: { volumeCreate: { id: 'vol-' + variables.input?.serviceId } },
      serviceDomainCreate: { serviceDomainCreate: { id: 'dom-1', domain: 'erp-hn-0440-production.up.railway.app' } },
      variableCollectionUpsert: { variableCollectionUpsert: true },
      serviceConnect: { serviceConnect: { id: 'svc-app' } },
      deployments: { deployments: { edges: [{ node: { id: 'dep-1', status: deployStatus } }] } },
      serviceInstanceRedeploy: { serviceInstanceRedeploy: true },
    }[name];
    res.end(JSON.stringify(data ? { data } : { errors: [{ message: 'unknown ' + name }] }));
  });
}

function fakeGithub(req, res) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer gh-secret') { res.statusCode = 401; return res.end(JSON.stringify({ message: 'Bad credentials' })); }
    const m = req.url.match(/^\/repos\/sangjindl9-lab\/sspower(\/issues(?:\/(\d+))?)?$/);
    if (!m) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'Not Found' })); }
    if (!m[1]) return res.end(JSON.stringify({ full_name: 'sangjindl9-lab/sspower' }));
    if (req.method === 'POST') {
      const b = JSON.parse(raw);
      const i = { number: issues.length + 1, state: 'open', html_url: `https://github.com/sangjindl9-lab/sspower/issues/${issues.length + 1}`, ...b };
      issues.push(i);
      res.statusCode = 201;
      return res.end(JSON.stringify(i));
    }
    const i = issues[Number(m[2]) - 1];
    res.end(JSON.stringify(i));
  });
}

async function call(path, { method = 'GET', json } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-portal': '1', cookie }, body: json ? JSON.stringify(json) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  rail = http.createServer(fakeRailway);
  await new Promise((r) => rail.listen(0, '127.0.0.1', r));
  railUrl = `http://127.0.0.1:${rail.address().port}/graphql/v2`;
  ghs = http.createServer(fakeGithub);
  await new Promise((r) => ghs.listen(0, '127.0.0.1', r));
  ghUrl = `http://127.0.0.1:${ghs.address().port}`;
  pool = createPool(DB);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
  const app = buildApp({ pool, privateKey, adminPassword: PW, sessionSecret: 'y'.repeat(40), railwayEndpoint: railUrl, railwaySleep: () => new Promise((r) => setTimeout(r, 5)), railwayWaitMs: 2000, githubEndpoint: ghUrl, githubTokenEnv: '', publicUrl: 'https://license.example' });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  server.app = app;
  base = `http://127.0.0.1:${server.address().port}`;
  await call('/api/admin/login', { method: 'POST', json: { password: PW } });
});
after(async () => {
  server.close();
  rail.close();
  ghs.close();
  await pool.end();
});

test('임시 비밀번호는 ERP 비밀번호 정책(10자+, 3종+, 같은 문자 4연속 금지)을 지킨다', () => {
  for (let i = 0; i < 200; i++) {
    const p = R.tempPassword();
    assert.ok(p.length >= 10);
    assert.ok([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length >= 3);
    assert.ok(!/(.)\1\1\1/.test(p));
  }
});

let id;
test('Railway 연결 전에는 서버를 개설할 수 없고, 연결 확인 후 토큰은 암호화 저장된다', async () => {
  id = (await call('/api/admin/customers', { method: 'POST', json: { name: '㈜한누리통신', bizRegNo: '214-88-39612', deployment: 'HOSTED' } })).body.id;
  await call(`/api/admin/customers/${id}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: 12 } });
  assert.equal((await call(`/api/admin/customers/${id}/server`, { method: 'POST', json: { adminId: 'admin', companyCode: 'HN' } })).status, 400);
  const ok = await call('/api/admin/railway', { method: 'PUT', json: { token: 'rw-secret-token', workspaceId: 'aa4da206-c537-4674-8bed-aac1be15cb20' } });
  assert.equal(ok.status, 200);
  const stored = (await pool.query(`select value from portal_setting where key = 'railway_token'`)).rows[0].value;
  assert.ok(!stored.includes('rw-secret-token'), '토큰은 평문으로 저장하지 않는다');
  assert.equal((await call('/api/admin/railway')).body.connected, true);
});

test('잘못된 입력은 거부된다', async () => {
  assert.equal((await call(`/api/admin/customers/${id}/server`, { method: 'POST', json: { adminId: 'ad', companyCode: 'HN' } })).status, 400);
  assert.equal((await call(`/api/admin/customers/${id}/server`, { method: 'POST', json: { adminId: 'admin', companyCode: '한글' } })).status, 400);
});

test('서버 개설: 실패하면 그 단계부터 다시 이어서, 끝나면 납품서에 접속 정보가 나온다', async () => {
  failOnce = 'volumeCreate';
  const r = await call(`/api/admin/customers/${id}/server`, { method: 'POST', json: { adminId: 'Admin', companyCode: 'hn' } });
  assert.equal(r.status, 202);
  await server.app.locals.idle();
  let c = (await call('/api/admin/customers/' + id)).body;
  assert.equal(c.server.status, 'FAILED');
  assert.equal(c.server.step, 'postgresVolume');
  assert.match(c.server.error, /일시적 오류/);
  assert.equal((await call(`/api/admin/customers/${id}/delivery`)).status, 400, '끝나기 전에는 납품서 없음');
  const before = calls.filter((x) => x.name === 'projectCreate').length;

  assert.equal((await call(`/api/admin/customers/${id}/server/retry`, { method: 'POST' })).status, 202);
  await server.app.locals.idle();
  c = (await call('/api/admin/customers/' + id)).body;
  assert.equal(c.server.status, 'DONE');
  assert.equal(c.server.url, 'https://erp-hn-0440-production.up.railway.app');
  assert.equal(c.serverUrl, c.server.url);
  assert.equal(calls.filter((x) => x.name === 'projectCreate').length, before, '이미 만든 프로젝트는 다시 만들지 않는다');
  assert.ok(calls.every((x) => x.auth === 'Bearer rw-secret-token'));

  // ERP 에 넘긴 설정 확인
  const app = calls.find((x) => x.name === 'serviceCreate' && x.variables.input.name === 'ss-erp').variables.input.variables;
  assert.equal(app.INIT_COMPANY_NAME, '㈜한누리통신');
  assert.equal(app.INIT_COMPANY_BIZNO, '2148839612');
  assert.equal(app.INIT_COMPANY_CODE, 'HN');
  assert.equal(app.INIT_ADMIN_ID, 'admin');
  assert.equal(app.LICENSE_SERVER_URL, 'https://license.example');
  assert.equal(app.LICENSE_ACTIVATION_CODE, c.activationCode);
  assert.equal(app.DATABASE_URL, '${{Postgres.DATABASE_URL}}');
  assert.match(app.APP_ENCRYPTION_KEY, /^[0-9a-f]{64}$/);
  assert.equal(app.DEMO_DATA, undefined, '예시 데이터 없이 시작');
  const regions = calls.filter((x) => x.name === 'serviceInstanceUpdate').map((x) => x.variables.input.region);
  assert.deepEqual(regions, ['asia-southeast1-eqsg3a', 'asia-southeast1-eqsg3a']);
  const conn = calls.find((x) => x.name === 'serviceConnect');
  assert.deepEqual(conn.variables.input, { repo: 'sangjindl9-lab/sspower', branch: 'ss-erp' });
  const web = calls.find((x) => x.name === 'variableCollectionUpsert').variables.input.variables;
  assert.equal(web.WEB_ORIGIN, 'https://erp-hn-0440-production.up.railway.app');

  const d = (await call(`/api/admin/customers/${id}/delivery`)).body;
  assert.equal(d.adminId, 'admin');
  assert.equal(d.url, 'https://erp-hn-0440-production.up.railway.app');
  assert.equal(d.tempPassword, app.INIT_ADMIN_PASSWORD);
  assert.equal(d.license.maxUsers, 12);
  // 비밀값은 DB에 평문으로 남지 않는다
  const row = (await pool.query('select secrets from server_job where customer_id = $1', [id])).rows[0];
  assert.ok(!row.secrets.includes(d.tempPassword));
  // 두 번 개설할 수 없다
  assert.equal((await call(`/api/admin/customers/${id}/server`, { method: 'POST', json: { adminId: 'admin', companyCode: 'HN' } })).status, 400);
});

test('설치형 고객은 서버 개설 대상이 아니다', async () => {
  const oid = (await call('/api/admin/customers', { method: 'POST', json: { name: '설치형', bizRegNo: '120-81-47521', deployment: 'ONPREM' } })).body.id;
  await call(`/api/admin/customers/${oid}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: 5 } });
  assert.equal((await call(`/api/admin/customers/${oid}/server`, { method: 'POST', json: { adminId: 'admin', companyCode: 'OP' } })).status, 400);
});

test('배포가 실패하면 한 번 자동으로 다시 배포하고, 그래도 실패하면 실패로 표시', async () => {
  const xid = (await call('/api/admin/customers', { method: 'POST', json: { name: '배포실패', bizRegNo: '101-81-17536', deployment: 'HOSTED' } })).body.id;
  await call(`/api/admin/customers/${xid}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: 5 } });
  deployStatus = 'FAILED';
  const n = calls.filter((x) => x.name === 'serviceInstanceRedeploy').length;
  await call(`/api/admin/customers/${xid}/server`, { method: 'POST', json: { adminId: 'admin', companyCode: 'XF' } });
  await server.app.locals.idle();
  const c = (await call('/api/admin/customers/' + xid)).body;
  assert.equal(c.server.status, 'FAILED');
  assert.equal(calls.filter((x) => x.name === 'serviceInstanceRedeploy').length, n + 1);
  deployStatus = 'SUCCESS';
});

test('수정 요청 → GitHub 이슈, 이슈가 닫히면 완료, 재배포가 성공하면 반영으로 바뀐다', async () => {
  assert.equal((await call(`/api/admin/customers/${id}/requests`, { method: 'POST', json: { want: '발주서에 현장소장 확인 칸' } })).status, 400, 'GitHub 연결 전');
  assert.equal((await call('/api/admin/github', { method: 'PUT', json: { token: 'wrong' } })).status, 400);
  assert.equal((await call('/api/admin/github', { method: 'PUT', json: { token: 'gh-secret' } })).status, 200);
  assert.ok(!(await pool.query(`select value from portal_setting where key = 'github_token'`)).rows[0].value.includes('gh-secret'));

  const r = await call(`/api/admin/customers/${id}/requests`, { method: 'POST', json: { screen: '발주 › 발주서 출력', now: '서명란 1칸', want: '현장소장 확인 칸 추가. 다른 고객은 그대로', deploy: '고객 서버까지' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.issueNumber, 1);
  assert.equal(r.body.status, 'REQUESTED');
  assert.match(issues[0].title, /^\[고객 맞춤 — ㈜한누리통신\] 현장소장 확인 칸 추가/);
  assert.match(issues[0].body, /214-88-39612|2148839612/);
  assert.match(issues[0].body, /모듈 스위치/);
  assert.deepEqual(issues[0].labels, ['고객맞춤', '고객:㈜한누리통신']);
  const g = await call('/api/admin/requests', { method: 'POST', json: { want: '작업일보에 날씨 자동 입력' } });
  assert.equal(g.body.kind, 'GLOBAL');
  assert.equal(issues[1].labels[0], '전체업데이트');

  // 이슈가 닫히면 대장에서 완료로
  issues[0].state = 'closed'; issues[0].closed_at = new Date().toISOString();
  issues[1].state = 'closed'; issues[1].closed_at = new Date().toISOString();
  let list = (await call(`/api/admin/requests?customerId=${id}`)).body.rows;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'DONE');

  // 전체 재배포 → 성공하면 고객 건 + 전체 건 모두 반영
  const calls0 = calls.length;
  const ro = await call('/api/admin/rollouts', { method: 'POST' });
  assert.equal(ro.status, 202);
  assert.equal((await call('/api/admin/rollouts', { method: 'POST' })).status, 400, '동시에 두 번은 안 됨');
  await server.app.locals.idleRollout();
  assert.ok(calls.slice(calls0).some((x) => x.name === 'serviceInstanceRedeploy'));
  const rs = (await call('/api/admin/rollouts')).body.rows[0];
  assert.ok(rs.finishedAt);
  assert.deepEqual(rs.results.map((x) => x.status), ['SUCCESS']);
  list = (await call('/api/admin/requests')).body.rows;
  assert.deepEqual(list.map((x) => x.status), ['DEPLOYED', 'DEPLOYED']);
  assert.ok(list.every((x) => x.rolloutId === rs.id));

  // 고객 한 곳만 재배포
  assert.equal((await call(`/api/admin/customers/${id}/redeploy`, { method: 'POST' })).status, 202);
});
