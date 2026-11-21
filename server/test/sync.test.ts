import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPool, migrateUp, migrateDownOne } from '../src/db.js';
import { buildApp } from '../src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.STORAGE_DIR = '/tmp/notepro-test-storage';
const BASE = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/postgres?host=/tmp/pg';
const DBNAME = 'notepro_t' + Date.now();
let db: pg.Pool; let app: ReturnType<typeof buildApp>;

before(async () => {
  const admin = new pg.Pool({ connectionString: BASE });
  await admin.query(`CREATE DATABASE ${DBNAME}`); await admin.end();
  const u = new URL(BASE); u.pathname = '/' + DBNAME;
  db = createPool(u.toString());
  await migrateUp(db);
  app = buildApp(db);
});
after(async () => { await app.close(); await db.end(); });

const call = async (method: string, url: string, token?: string, body?: any, ct?: string) => {
  const r = await app.inject({ method: method as any, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ct ? { 'content-type': ct } : {}) }, payload: body });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
const NPS1 = (n = 3) => { const b = Buffer.alloc(8 + n * 16 + 4); b.write('NPS1', 0, 'latin1'); b.writeInt32LE(n, 4); return b.toString('base64'); };

async function signup(email: string, deviceId = randomUUID()) {
  const r = await call('POST', '/v1/auth/signup', undefined, { email, password: 'password123', deviceId, platform: 'android' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { ...r.body, deviceId };
}
async function login(email: string, deviceId = randomUUID()) {
  const r = await call('POST', '/v1/auth/login', undefined, { email, password: 'password123', deviceId, platform: 'android' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body, deviceId };
}
const op = (entityType: string, entityId: string, data: any, baseRev = 0, opType = 'upsert') => ({ opId: randomUUID(), entityType, entityId, opType, baseRev, data, createdAt: Date.now() });

test('계정: 가입·로그인·잘못된 비밀번호·중복 이메일', async () => {
  await signup('a@test.com');
  assert.equal((await call('POST', '/v1/auth/signup', undefined, { email: 'a@test.com', password: 'password123', deviceId: randomUUID() })).status, 409);
  assert.equal((await call('POST', '/v1/auth/login', undefined, { email: 'a@test.com', password: 'wrong-pass', deviceId: randomUUID() })).status, 401);
  await login('a@test.com');
});

test('토큰: 리프레시 회전·재사용 감지 시 세션 폐기', async () => {
  const a = await signup('r@test.com');
  const r1 = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refreshToken });
  assert.equal(r1.status, 200);
  const reuse = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: r1.body.refreshToken })).status, 401); // 탈취 대응: 전체 폐기
});

test('동기화: 두 기기, 증분 전송, 중복 전송 무시', async () => {
  const A = await signup('s@test.com'); const B = await login('s@test.com');
  const nb = randomUUID(), page = randomUUID(), st = randomUUID();
  const ops = [op('stroke', st, { pageId: page, notebookId: nb, pen: 1, color: -1, width: 2, opacity: 1, points: NPS1() }),
    op('page', page, { notebookId: nb, index: 0, width: 595, height: 842, paper: 'lined', template: 'none' }),
    op('notebook', nb, { title: '회의', tags: ['업무'] })];
  const p = await call('POST', '/v1/sync/push', A.accessToken, { ops });
  assert.deepEqual(p.body.results.map((r: any) => r.status), ['applied', 'applied', 'applied']);
  const again = await call('POST', '/v1/sync/push', A.accessToken, { ops });
  assert.ok(again.body.results.every((r: any) => r.status === 'duplicate'));
  await call('POST', '/v1/sync/push', A.accessToken, { ops: [op('element', randomUUID(), { pageId: page, notebookId: nb, x: 10, y: 20, w: 200, text: 'AI 요약', author: 'ai' })] });
  const pull = await call('GET', '/v1/sync/pull?since=0', B.accessToken);
  assert.deepEqual(pull.body.changes.map((c: any) => c.entityType), ['notebook', 'page', 'stroke', 'element']);
  assert.equal(pull.body.changes[3].data.author, 'ai');
  assert.deepEqual(pull.body.changes[0].data.tags, ['업무']);
  const pull2 = await call('GET', `/v1/sync/pull?since=${pull.body.nextSince}`, B.accessToken);
  assert.equal(pull2.body.changes.length, 0);
  const own = await call('GET', '/v1/sync/pull?since=0', A.accessToken);
  assert.equal(own.body.changes.length, 0); // 자기 작업은 되돌려 받지 않음
  const nbRows = await db.query('SELECT count(*)::int n FROM notebooks WHERE id=$1', [nb]);
  assert.equal(nbRows.rows[0].n, 1);
});

test('충돌: 같은 획을 두 기기가 수정 → 양쪽 보존, 삭제 vs 수정 → 삭제 안 함', async () => {
  const A = await signup('c@test.com'); const B = await login('c@test.com');
  const nb = randomUUID(), page = randomUUID(), st = randomUUID();
  await call('POST', '/v1/sync/push', A.accessToken, { ops: [op('notebook', nb, { title: 'x' }), op('page', page, { notebookId: nb }), op('stroke', st, { pageId: page, notebookId: nb, points: NPS1() })] });
  const a2 = await call('POST', '/v1/sync/push', A.accessToken, { ops: [op('stroke', st, { pageId: page, notebookId: nb, color: 1, points: NPS1(4) }, 1)] });
  assert.equal(a2.body.results[0].status, 'applied');
  const b2 = await call('POST', '/v1/sync/push', B.accessToken, { ops: [op('stroke', st, { pageId: page, notebookId: nb, color: 2, points: NPS1(5) }, 1)] });
  assert.equal(b2.body.results[0].status, 'conflict');
  const copy = b2.body.results[0].copyId;
  const rows = await db.query('SELECT id, color FROM pen_strokes WHERE notebook_id=$1 ORDER BY color', [nb]);
  assert.deepEqual(rows.rows.map((r) => r.color), [1, 2]);
  assert.ok(rows.rows.some((r) => r.id === copy));
  // B가 오래된 rev 로 삭제 시도 → 지워지지 않음
  const del = await call('POST', '/v1/sync/push', B.accessToken, { ops: [op('stroke', st, { pageId: page, notebookId: nb, points: NPS1() }, 1, 'delete')] });
  assert.equal(del.body.results[0].status, 'conflict');
  assert.equal((await db.query('SELECT deleted_at FROM pen_strokes WHERE id=$1', [st])).rows[0].deleted_at, null);
  const orig = await call('GET', `/v1/sync/entity/stroke/${st}`, B.accessToken);
  assert.equal(orig.body.data.color, 1); // 충돌 뒤 원본(다른 기기 버전)을 받을 수 있음
  assert.equal((await call('GET', `/v1/sync/entity/stroke/${st}`, (await signup('c2@test.com')).accessToken)).status, 404);
  const pullB = await call('GET', '/v1/sync/pull?since=0', B.accessToken);
  assert.ok(pullB.body.changes.some((c: any) => c.data.id === copy), '충돌 사본은 만든 기기에도 내려감');
});

test('격리: 다른 사용자는 남의 노트를 읽거나 쓸 수 없음', async () => {
  const A = await signup('i1@test.com'); const X = await signup('i2@test.com');
  const nb = randomUUID(), page = randomUUID();
  await call('POST', '/v1/sync/push', A.accessToken, { ops: [op('notebook', nb, { title: 'secret' }), op('page', page, { notebookId: nb })] });
  const hack = await call('POST', '/v1/sync/push', X.accessToken, { ops: [op('notebook', nb, { title: 'hacked' }, 1), op('stroke', randomUUID(), { pageId: page, notebookId: nb, points: NPS1() })] });
  assert.ok(hack.body.results.every((r: any) => r.status === 'rejected'), JSON.stringify(hack.body));
  assert.equal((await db.query('SELECT title FROM notebooks WHERE id=$1', [nb])).rows[0].title, 'secret');
  assert.equal((await call('GET', '/v1/sync/pull?since=0', X.accessToken)).body.changes.length, 0);
});

test('파일: 조각 업로드·실패 조각만 재전송·해시 검증·다운로드', async () => {
  const A = await signup('f@test.com');
  const data = Buffer.alloc(9 * 1024 * 1024 + 5, 7); data[100] = 1;
  const sha = createHash('sha256').update(data).digest('hex');
  const c0 = data.subarray(0, 8 * 1024 * 1024), c1 = data.subarray(8 * 1024 * 1024);
  assert.equal((await call('PUT', `/v1/files/${sha}/chunks/1?total=2`, A.accessToken, c1, 'application/octet-stream')).status, 200);
  assert.equal((await call('POST', `/v1/files/${sha}/complete`, A.accessToken)).status, 409);
  const st = await call('GET', `/v1/files/${sha}/status`, A.accessToken);
  assert.deepEqual(st.body.received, [1]);
  assert.equal((await call('PUT', `/v1/files/${sha}/chunks/0?total=2`, A.accessToken, c0, 'application/octet-stream')).status, 200);
  assert.equal((await call('POST', `/v1/files/${sha}/complete`, A.accessToken)).status, 200);
  const dl = await app.inject({ method: 'GET', url: `/v1/files/${sha}`, headers: { authorization: `Bearer ${A.accessToken}` } });
  assert.equal(createHash('sha256').update(dl.rawPayload).digest('hex'), sha);
  const X = await signup('f2@test.com');
  assert.equal((await call('GET', `/v1/files/${sha}`, X.accessToken)).status, 404);
  const bk = await call('POST', '/v1/backups', A.accessToken, { sha256: sha, kind: 'auto' });
  assert.equal(bk.status, 200);
  assert.equal((await call('GET', '/v1/backups', A.accessToken)).body.backups.length, 1);
});

test('기기 관리: 기기 해제 시 그 기기 토큰 무효', async () => {
  const A = await signup('d@test.com'); const B = await login('d@test.com');
  const list = await call('GET', '/v1/devices', A.accessToken);
  assert.equal(list.body.devices.length, 2);
  await call('DELETE', `/v1/devices/${B.deviceId}`, A.accessToken);
  assert.equal((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: B.refreshToken })).status, 401);
});

test('계정 삭제·데이터 내보내기', async () => {
  const A = await signup('e@test.com');
  const nb = randomUUID();
  await call('POST', '/v1/sync/push', A.accessToken, { ops: [op('notebook', nb, { title: 'export me' })] });
  const ex = await call('GET', '/v1/account/export', A.accessToken);
  assert.equal(ex.body.notebooks[0].title, 'export me');
  assert.equal((await call('DELETE', '/v1/account', A.accessToken)).status, 200);
  assert.equal((await call('POST', '/v1/auth/login', undefined, { email: 'e@test.com', password: 'password123', deviceId: randomUUID() })).status, 401);
});

test('마이그레이션: 최신 1개 롤백 후 다시 적용', async () => {
  const v = await migrateDownOne(db);
  assert.ok(v);
  const again = await migrateUp(db);
  assert.deepEqual(again, [v]);
});
