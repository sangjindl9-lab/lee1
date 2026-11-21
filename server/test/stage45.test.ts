import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPool, migrateUp } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/admin.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.STORAGE_DIR = '/tmp/notepro-test-storage';
process.env.AI_PROVIDER = 'mock';
process.env.ADMIN_BOOTSTRAP_EMAIL = 'owner@notepro.test';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'owner-password-123';
const BASE = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost/postgres?host=/tmp/pg&port=5433';
const DBNAME = 'notepro_s' + Date.now();
let db: pg.Pool; let app: ReturnType<typeof buildApp>;

before(async () => {
  const admin = new pg.Pool({ connectionString: BASE }); await admin.query(`CREATE DATABASE ${DBNAME}`); await admin.end();
  const u = new URL(BASE); u.pathname = '/' + DBNAME; db = createPool(u.toString());
  await migrateUp(db); await bootstrapAdmin(db); app = buildApp(db);
});
after(async () => { await app.close(); await db.end(); });

const call = async (method: string, url: string, token?: string, body?: any, ct?: string) => {
  const r = await app.inject({ method: method as any, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ct ? { 'content-type': ct } : {}) }, payload: body });
  let b: any = r.body; try { b = r.json(); } catch { }
  return { status: r.statusCode, body: b };
};
async function user(email: string) {
  const r = await call('POST', '/v1/auth/signup', undefined, { email, password: 'password123', deviceId: randomUUID(), platform: 'android' });
  return r.body;
}

test('AI: 동의 필수, 결과에 AI 표시, 하루 한도, 비용 기록', async () => {
  const u = await user('ai@test.com');
  assert.equal((await call('POST', '/v1/ai/summarize', u.accessToken, { text: '회의 내용' })).status, 400); // 동의 없음
  const r = await call('POST', '/v1/ai/summarize', u.accessToken, { text: '회의 내용', consentVersion: '1' });
  assert.equal(r.status, 200); assert.equal(r.body.author, 'ai'); assert.ok(r.body.text.includes('회의'));
  assert.equal((await call('POST', '/v1/ai/unknown', u.accessToken, { text: 'x', consentVersion: '1' })).status, 404);
  for (let i = 0; i < 19; i++) await call('POST', '/v1/ai/keywords', u.accessToken, { text: 'q', consentVersion: '1' });
  assert.equal((await call('POST', '/v1/ai/todos', u.accessToken, { text: 'x', consentVersion: '1' })).status, 429); // 무료 20회
  const rows = (await db.query(`SELECT count(*)::int n FROM ai_requests WHERE state='done'`)).rows[0].n;
  assert.equal(rows, 20);
});

test('구독 권한: 기본 무료, 운영에서는 영수증 검증 없이 유료 불가', async () => {
  const u = await user('b@test.com');
  assert.equal((await call('GET', '/v1/billing/entitlements', u.accessToken)).body.plan, 'free');
  assert.equal((await call('POST', '/v1/billing/purchase', u.accessToken, { plan: 'pro' })).status, 503);
  process.env.BILLING_VERIFY = 'off';
  assert.equal((await call('POST', '/v1/billing/purchase', u.accessToken, { plan: 'pro' })).body.plan, 'pro');
  delete process.env.BILLING_VERIFY;
  assert.equal((await call('GET', '/v1/ai/usage', u.accessToken)).body.dailyLimit, 300);
});

test('문서 변환: 지원 안 하는 형식 안내, 변환기 없으면 503', async () => {
  const u = await user('c@test.com');
  assert.equal((await call('POST', '/v1/convert?name=a.exe', u.accessToken, Buffer.from('x'), 'application/octet-stream')).status, 415);
  process.env.SOFFICE = '/nonexistent/soffice';
  assert.equal((await call('POST', '/v1/convert?name=a.docx', u.accessToken, Buffer.from('x'), 'application/octet-stream')).status, 503);
});

test('관리자: 로그인·통계·역할 제한·노트 내용 비노출', async () => {
  const u = await user('d@test.com');
  const nb = randomUUID(), page = randomUUID();
  await call('POST', '/v1/sync/push', u.accessToken, { ops: [
    { opId: randomUUID(), entityType: 'notebook', entityId: nb, opType: 'upsert', baseRev: 0, data: { title: 'TOP-SECRET-TITLE' } },
    { opId: randomUUID(), entityType: 'page', entityId: page, opType: 'upsert', baseRev: 0, data: { notebookId: nb } }] });
  assert.equal((await call('POST', '/admin/api/login', undefined, { email: 'owner@notepro.test', password: 'wrong' })).status, 401);
  const t = (await call('POST', '/admin/api/login', undefined, { email: 'owner@notepro.test', password: 'owner-password-123' })).body.token;
  const s = await call('GET', '/admin/api/stats', t);
  assert.ok(s.body.users.total >= 1);
  for (const p of ['stats', 'users', 'subscriptions', 'payments', 'storage', 'sync', 'errors', 'ai', 'support', 'notices', 'versions', 'health']) {
    const r = await call('GET', '/admin/api/' + p, t);
    assert.equal(r.status, 200, p);
    assert.ok(!JSON.stringify(r.body).includes('TOP-SECRET-TITLE'), `${p} must not expose note content`);
  }
  assert.equal((await call('GET', '/admin/api/stats', u.accessToken)).status, 401); // 일반 사용자 토큰 거부
  // support 역할은 결제 화면 불가
  await db.query(`INSERT INTO admin_users(email, password_hash, role) VALUES('s@x.com', $1, 'support')`, [(await import('bcryptjs')).default.hashSync('support-pass-1234', 4)]);
  const ts = (await call('POST', '/admin/api/login', undefined, { email: 's@x.com', password: 'support-pass-1234' })).body.token;
  assert.equal((await call('GET', '/admin/api/payments', ts)).status, 403);
  assert.equal((await call('GET', '/admin/api/support', ts)).status, 200);
  const html = await app.inject({ method: 'GET', url: '/admin' });
  assert.ok(html.body.includes('노트프로 관리자'));
});

test('문의·공지·앱 버전·오류 보고', async () => {
  const u = await user('e@test.com');
  assert.equal((await call('POST', '/v1/support', u.accessToken, { subject: '동기화 질문', body: '내용', platform: 'android' })).status, 200);
  assert.equal((await call('POST', '/v1/errors', undefined, { platform: 'android', appVersion: '0.2', errors: [{ kind: 'crash', message: 'NPE', stack: 'a\nb' }] })).body.received, 1);
  const t = (await call('POST', '/admin/api/login', undefined, { email: 'owner@notepro.test', password: 'owner-password-123' })).body.token;
  await call('POST', '/admin/api/notices', t, { locale: 'ko', title: '점검 안내', body: '...', published: true });
  assert.equal((await call('GET', '/v1/notices?locale=ko')).body.notices[0].title, '점검 안내');
  await call('POST', '/admin/api/versions', t, { platform: 'android', latest: '0.3.0', minSupported: '0.2.0' });
  assert.equal((await call('GET', '/v1/app-version?platform=android')).body.version.latest, '0.3.0');
  assert.equal((await call('GET', '/admin/api/errors', t)).body.errors[0].n, 1);
});
