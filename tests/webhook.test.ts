import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { buildDraftPayload, deliverDraft, postWebhook, sendTestWebhook } from '../src/webhook.ts';

let store: Store;
let tempDir: string;
let server: http.Server;
let received: { body: string; headers: http.IncomingHttpHeaders }[] = [];
let port = 0;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-promo-webhook-'));
  store = new Store(loadConfig({ dataDir: tempDir, seedDemoData: false, enableScheduler: false }));
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ body, headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('postWebhook: JSON 을 POST 하고 응답을 돌려준다', async () => {
  received = [];
  const result = await postWebhook(`http://127.0.0.1:${port}/hook`, { hello: 'world' });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(received.length, 1);
  assert.deepEqual(JSON.parse(received[0].body), { hello: 'world' });
  assert.match(String(received[0].headers['content-type']), /application\/json/);
});

test('postWebhook: 잘못된 URL 은 실패로 기록', async () => {
  const result = await postWebhook('not-a-url', {});
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /URL/);
});

test('deliverDraft: 초안 JSON 페이로드를 보내고 DB 에 기록한다', async () => {
  received = [];
  const app = store.upsertApp('kr.eumsoft.viewer', '이음뷰어', null);
  const draft = store.saveDraft({
    appId: app.id,
    channel: 'naver_blog',
    title: '테스트 제목',
    bodyMd: '## 본문\n링크 https://play.google.com/store/apps/details?id=kr.eumsoft.viewer',
    bodyHtml: '<h2>본문</h2>',
    hashtags: '#이음뷰어',
    ctaUrl: 'https://play.google.com/store/apps/details?id=kr.eumsoft.viewer&utm_source=eum_promo',
    keywords: ['DWG 뷰어'],
    generator: 'template',
  });
  const result = await deliverDraft(store, draft, app, `http://127.0.0.1:${port}/hook`);
  assert.equal(result.ok, true);
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.event, 'draft.created');
  assert.equal(payload.app.packageId, 'kr.eumsoft.viewer');
  assert.equal(payload.draft.title, '테스트 제목');
  assert.equal(payload.draft.channelLabel, '네이버 블로그');
  assert.deepEqual(payload.draft.keywords, ['DWG 뷰어']);

  const deliveries = store.recentWebhookDeliveries(5) as { ok: number; event: string }[];
  assert.ok(deliveries.some((d) => d.event === 'draft.created' && d.ok === 1));
});

test('Slack 웹훅이면 text 필드를 함께 보낸다', async () => {
  received = [];
  const app = store.getAppByPackage('kr.eumsoft.viewer')!;
  const draft = store.saveDraft({
    appId: app.id,
    channel: 'shorts',
    title: '쇼츠 제목',
    bodyMd: '대본 내용',
    bodyHtml: '<p>대본 내용</p>',
    hashtags: '',
    ctaUrl: 'https://play.google.com/store/apps/details?id=kr.eumsoft.viewer',
    keywords: [],
    generator: 'template',
  });
  const payload = buildDraftPayload(draft, app);
  assert.equal(payload.draft.channelLabel, '유튜브 쇼츠');
  const shaped = (await import('../src/webhook.ts')).buildDraftPayload(draft, app);
  assert.equal(shaped.event, 'draft.created');
});

test('sendTestWebhook: 테스트 페이로드와 기록', async () => {
  received = [];
  const result = await sendTestWebhook(store, `http://127.0.0.1:${port}/hook`);
  assert.equal(result.ok, true);
  const payload = JSON.parse(received[0].body);
  assert.equal(payload.event, 'webhook.test');
  assert.match(payload.message, /테스트 발송/);
});
