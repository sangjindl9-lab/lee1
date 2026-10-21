import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-'));
delete process.env.DATABASE_URL;
const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

const db = await openDb();
const app = createApp(db, { adminId: 'admin', adminPassword: 'adminpw!', secret: 'test', secureCookie: false });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

function client(ip) {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((x) => x.split('=')));
      if (v) jar[k] = v;
      else delete jar[k];
      cookie = Object.entries(jar).map(([a, b]) => `${a}=${b}`).join('; ');
    }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { call, setIp: (x) => (ip = x) };
}

test('회원제 전체 흐름', async () => {
  const admin = client('9.9.9.9');
  assert.equal((await admin.call('GET', '/api/admin/users')).status, 401);
  assert.equal((await admin.call('POST', '/api/admin/login', { id: 'admin', password: 'x' })).status, 401);
  assert.equal((await admin.call('POST', '/api/admin/login', { id: 'admin', password: 'adminpw!' })).status, 200);
  assert.equal((await admin.call('POST', '/api/admin/users', { username: 'kim', password: 'pass1234', name: '김대리', company: 'A전기' })).status, 200);
  assert.equal((await admin.call('POST', '/api/admin/users', { username: 'lee', password: 'pass5678', max_ips: 3 })).status, 200);
  assert.equal((await admin.call('POST', '/api/admin/users', { username: 'KIM', password: 'pass1234' })).status, 409);

  // 아이디 없으면 사용 불가
  const anon = client('1.1.1.1');
  assert.equal((await anon.call('GET', '/api/projects')).status, 401);
  assert.equal((await anon.call('POST', '/api/login', { username: 'kim', password: 'wrong' })).status, 401);

  // 첫 접속 → IP 등록 필요
  const kim = client('1.1.1.1');
  let r = await kim.call('POST', '/api/login', { username: 'kim', password: 'pass1234' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ipState.status, 'register');
  assert.equal((await kim.call('GET', '/api/projects')).status, 403);
  r = await kim.call('POST', '/api/ip/register');
  assert.equal(r.body.ipState.status, 'ok');
  assert.equal(r.body.ipState.used, 1);

  // 회원별 데이터 분리
  assert.equal((await kim.call('PUT', '/api/projects/p1', { data: { id: 'p1', info: { name: '김 현장' }, tasks: [] } })).status, 200);
  const lee = client('2.2.2.2');
  await lee.call('POST', '/api/login', { username: 'lee', password: 'pass5678' });
  await lee.call('POST', '/api/ip/register');
  assert.deepEqual((await lee.call('GET', '/api/projects')).body.projects, []);
  await lee.call('PUT', '/api/projects/p1', { data: { id: 'p1', info: { name: '이 현장' }, tasks: [] } });
  assert.equal((await kim.call('GET', '/api/projects')).body.projects[0].info.name, '김 현장');
  assert.equal((await lee.call('GET', '/api/projects')).body.projects[0].info.name, '이 현장');

  // IP 3곳까지, 4번째 차단
  for (const ip of ['1.1.1.2', '1.1.1.3']) {
    kim.setIp(ip);
    assert.equal((await kim.call('GET', '/api/projects')).status, 403);
    assert.equal((await kim.call('POST', '/api/ip/register')).status, 200);
    assert.equal((await kim.call('GET', '/api/projects')).status, 200);
  }
  kim.setIp('1.1.1.4');
  r = await kim.call('POST', '/api/ip/register');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ip_full');
  r = await kim.call('GET', '/api/me');
  assert.equal(r.body.ipState.status, 'full');
  kim.setIp('1.1.1.1');
  assert.equal((await kim.call('GET', '/api/projects')).status, 200);

  // 관리자 목록·IP 초기화
  let users = (await admin.call('GET', '/api/admin/users')).body.users;
  const ku = users.find((u) => u.username === 'kim');
  assert.equal(ku.ips.length, 3);
  assert.equal(ku.project_count, 1);
  await admin.call('DELETE', `/api/admin/users/${ku.id}/ips?ip=1.1.1.2`);
  kim.setIp('1.1.1.4');
  assert.equal((await kim.call('POST', '/api/ip/register')).status, 200);
  await admin.call('DELETE', `/api/admin/users/${ku.id}/ips`);
  assert.equal((await kim.call('GET', '/api/me')).body.ipState.used, 0);
  await kim.call('POST', '/api/ip/register');

  // 만료·정지
  await admin.call('PATCH', `/api/admin/users/${ku.id}`, { expires_at: '2020-01-01' });
  assert.equal((await kim.call('GET', '/api/projects')).body.code, 'expired');
  await admin.call('PATCH', `/api/admin/users/${ku.id}`, { expires_at: '', active: false });
  assert.equal((await kim.call('GET', '/api/projects')).status, 401); // 정지 시 세션 삭제
  assert.equal((await kim.call('POST', '/api/login', { username: 'kim', password: 'pass1234' })).body.code, 'disabled');
  await admin.call('PATCH', `/api/admin/users/${ku.id}`, { active: true, password: 'newpass9' });
  assert.equal((await kim.call('POST', '/api/login', { username: 'kim', password: 'newpass9' })).status, 200);

  // 비밀번호 변경
  assert.equal((await kim.call('POST', '/api/password', { current: 'newpass9', next: 'mypass77' })).status, 200);
  await kim.call('POST', '/api/logout');
  assert.equal((await kim.call('GET', '/api/me')).status, 401);
  assert.equal((await kim.call('POST', '/api/login', { username: 'kim', password: 'mypass77' })).status, 200);

  // 회원 삭제 → 데이터 삭제
  await admin.call('DELETE', `/api/admin/users/${ku.id}`);
  users = (await admin.call('GET', '/api/admin/users')).body.users;
  assert.equal(users.length, 1);
  assert.equal((await kim.call('GET', '/api/projects')).status, 401);

  // 로그인 시도 제한
  const bad = client('5.5.5.5');
  for (let i = 0; i < 10; i++) await bad.call('POST', '/api/login', { username: 'lee', password: 'x' });
  assert.equal((await bad.call('POST', '/api/login', { username: 'lee', password: 'pass5678' })).status, 429);
});

test.after(() => { server.closeAllConnections?.(); server.close(); db.close(); });
