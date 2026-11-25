import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createServer, type CreatedServer } from '../src/server.ts';

interface Harness {
  base: string;
  server: Server;
  created: CreatedServer;
  tempDir: string;
}

async function start(overrides: Record<string, unknown> = {}): Promise<Harness> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-promo-api-'));
  const created = createServer({
    dataDir: tempDir,
    seedDemoData: false,
    enableScheduler: false,
    adminPassword: null,
    ...overrides,
  });
  const server = created.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, server, created, tempDir };
}

async function stop(harness: Harness): Promise<void> {
  await new Promise<void>((resolve) => harness.server.close(() => resolve()));
  await harness.created.close();
  fs.rmSync(harness.tempDir, { recursive: true, force: true });
}

interface JsonInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function json(harness: Harness, pathname: string, init: JsonInit = {}) {
  const res = await fetch(`${harness.base}${pathname}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

describe('API 기본 흐름', () => {
  let h: Harness;
  before(async () => {
    h = await start();
  });
  after(async () => {
    await stop(h);
  });

  test('GET /api/health', async () => {
    const { status, data } = await json(h, '/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.service, 'eum-promo-aso-studio');
  });

  test('GET /api/apps 는 처음에 비어 있다', async () => {
    const { status, data } = await json(h, '/api/apps');
    assert.equal(status, 200);
    assert.deepEqual(data.apps, []);
  });

  test('POST /api/apps: 잘못된 패키지명은 400', async () => {
    const { status, data } = await json(h, '/api/apps', { method: 'POST', body: { packageId: 'not a package' } });
    assert.equal(status, 400);
    assert.match(data.error, /패키지명/);
  });

  test('POST /api/apps: Play 스토어 URL 도 받는다', async () => {
    const created = await json(h, '/api/apps', {
      method: 'POST',
      body: { packageId: 'https://play.google.com/store/apps/details?id=kr.eumsoft.zip&hl=ko', fetchNow: false },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.app.package_id, 'kr.eumsoft.zip');
  });

  test('POST /api/apps: 앱 등록(네트워크 없이) + 키워드', async () => {
    const created = await json(h, '/api/apps', {
      method: 'POST',
      body: { packageId: 'kr.eumsoft.viewer', label: '이음뷰어', keywords: ['DWG 뷰어', 'PDF 뷰어'], fetchNow: false },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.app.package_id, 'kr.eumsoft.viewer');

    const list = await json(h, '/api/apps');
    assert.ok(list.data.apps.length >= 1);
    const viewer = list.data.apps.find((a: any) => a.package_id === 'kr.eumsoft.viewer');
    assert.equal(viewer.keywordCount, 2);

    const detail = await json(h, `/api/apps/${created.data.app.id}`);
    assert.equal(detail.data.keywords.length, 2);
    assert.equal(detail.data.keywords[0].latest, null);
  });

  test('POST /api/apps/:id/keywords: 중복은 그대로, 새 키워드 추가', async () => {
    const apps = await json(h, '/api/apps');
    const appId = apps.data.apps.find((a: any) => a.package_id === 'kr.eumsoft.viewer').id;
    const added = await json(h, `/api/apps/${appId}/keywords`, { method: 'POST', body: { terms: ['DWG 뷰어', '캐드 뷰어'] } });
    assert.equal(added.status, 201);
    assert.equal(added.data.all.length, 3);

    const short = await json(h, `/api/apps/${appId}/keywords`, { method: 'POST', body: { term: 'a' } });
    assert.equal(short.status, 400);
  });

  test('PUT /api/settings: 시각·깊이 검증', async () => {
    const bad = await json(h, '/api/settings', { method: 'PUT', body: { rank_schedule_time: '25:99' } });
    assert.equal(bad.status, 400);
    const depth = await json(h, '/api/settings', { method: 'PUT', body: { rank_depth: 80 } });
    assert.equal(depth.status, 400);
    const ok = await json(h, '/api/settings', {
      method: 'PUT',
      body: { rank_schedule_time: '08:30', rank_depth: 30, webhook_url: 'https://example.com/hook' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.settings.rank_schedule_time, '08:30');
  });

  test('GET /api/settings: OpenAI 키는 마스킹해서 보여준다', async () => {
    await json(h, '/api/settings', { method: 'PUT', body: { openai_api_key: 'sk-1234567890abcdef' } });
    const { data } = await json(h, '/api/settings');
    assert.match(data.settings.openai_api_key, /^sk-••••cdef$/);
    assert.equal(data.settings.openai_key_set, true);
  });

  test('POST /api/apps/:id/content: 템플릿으로 초안 생성', async () => {
    const apps = await json(h, '/api/apps');
    const appId = apps.data.apps[0].id;
    const result = await json(h, `/api/apps/${appId}/content`, {
      method: 'POST',
      body: { channel: 'naver_blog', useAi: false },
    });
    assert.equal(result.status, 201);
    assert.equal(result.data.generator, 'template');
    assert.equal(result.data.draft.channel, 'naver_blog');
    assert.ok(result.data.draft.body_md.includes('utm_source='));
    assert.ok(result.data.draft.body_html.includes('<h2>'));
  });

  test('POST content: 지원하지 않는 채널은 400', async () => {
    const apps = await json(h, '/api/apps');
    const appId = apps.data.apps[0].id;
    const result = await json(h, `/api/apps/${appId}/content`, { method: 'POST', body: { channel: 'tiktok' } });
    assert.equal(result.status, 400);
  });

  test('GET /api/drafts · 다운로드 · 상태 변경', async () => {
    const drafts = await json(h, '/api/drafts');
    assert.ok(drafts.data.drafts.length >= 1);
    const id = drafts.data.drafts[0].id;

    const html = await fetch(`${h.base}/api/drafts/${id}/download?format=html`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-disposition') ?? '', /attachment/);
    const body = await html.text();
    assert.match(body, /<!doctype html>/);

    const md = await fetch(`${h.base}/api/drafts/${id}/download?format=md`);
    assert.equal(md.status, 200);
    assert.match(await md.text(), /^# /);

    const patched = await json(h, `/api/drafts/${id}`, { method: 'PATCH', body: { status: 'used' } });
    assert.equal(patched.status, 200);
    const after = await json(h, `/api/drafts/${id}`);
    assert.equal(after.data.draft.status, 'used');
  });

  test('GET /api/export: JSON·CSV 내보내기', async () => {
    const jsonExport = await fetch(`${h.base}/api/export?format=json`);
    assert.equal(jsonExport.status, 200);
    const payload = JSON.parse(await jsonExport.text());
    assert.ok(payload.apps.length >= 1);
    assert.ok(payload.apps.some((a: any) => a.package_id === 'kr.eumsoft.viewer'));
    const csv = await fetch(`${h.base}/api/export?format=csv`);
    const csvText = await csv.text();
    assert.match(csvText, /"키워드"/);
    assert.match(csvText, /DWG 뷰어/);
  });

  test('없는 API 는 404 JSON', async () => {
    const { status, data } = await json(h, '/api/nope');
    assert.equal(status, 404);
    assert.match(data.error, /없는 API/);
  });

  test('정적 대시보드(index.html)를 제공한다', async () => {
    const res = await fetch(`${h.base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /이음 앱 홍보·ASO 자동화 센터/);
    const css = await fetch(`${h.base}/styles.css`);
    assert.equal(css.status, 200);
  });

  test('스케줄러 상태 API', async () => {
    const { status, data } = await json(h, '/api/scheduler');
    assert.equal(status, 200);
    assert.equal(data.rank.enabled, true);
    assert.ok(data.rank.nextRunKst);
  });
});

describe('관리자 비밀번호 보호', () => {
  let h: Harness;
  before(async () => {
    h = await start({ adminPassword: 'eum-secret-1234', authSecret: 'test-secret' });
  });
  after(async () => {
    await stop(h);
  });

  test('비밀번호가 없으면 API 는 401', async () => {
    const { status, data } = await json(h, '/api/apps');
    assert.equal(status, 401);
    assert.equal(data.code, 'AUTH_REQUIRED');
  });

  test('session 상태는 authRequired=true', async () => {
    const { data } = await json(h, '/api/session');
    assert.equal(data.authRequired, true);
    assert.equal(data.authenticated, false);
  });

  test('틀린 비밀번호는 401, 맞으면 쿠키 발급', async () => {
    const wrong = await json(h, '/api/login', { method: 'POST', body: { password: 'nope' } });
    assert.equal(wrong.status, 401);

    const ok = await json(h, '/api/login', { method: 'POST', body: { password: 'eum-secret-1234' } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.ok(cookie);
    const sessionCookie = cookie.split(';')[0];

    const authed = await json(h, '/api/apps', { headers: { Cookie: sessionCookie } });
    assert.equal(authed.status, 200);

    const forged = await json(h, '/api/apps', { headers: { Cookie: 'eum_promo_session=v1.9999999999999.fake' } });
    assert.equal(forged.status, 401);
  });
});
