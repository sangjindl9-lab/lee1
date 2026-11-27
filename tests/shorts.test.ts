import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { createServer, type CreatedServer } from '../src/server.ts';
import { buildAss, sceneOverlay } from '../src/shorts/ass.ts';
import { generateBgmWav } from '../src/shorts/bgm.ts';
import { findBinary, probe, resolveMedia } from '../src/shorts/ffmpeg.ts';
import { renderBackground, THEMES } from '../src/shorts/png.ts';
import { providerSettingsView, resolveProviders } from '../src/shorts/providers.ts';
import { buildShortScript } from '../src/shorts/script.ts';
import { buildShort } from '../src/shorts/render.ts';

function tempStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-shorts-'));
  const config = loadConfig({ dataDir: dir, adminPassword: null, enableScheduler: false });
  return { store: new Store(config), dir };
}

describe('쇼츠 대본 생성', () => {
  test('이음뷰어: 5씬 · 훅/문제/해결/근거/CTA 구조', () => {
    const { store, dir } = tempStore();
    const app = store.getAppByPackage('kr.eumsoft.viewer')!;
    const script = buildShortScript({
      app,
      snapshot: store.latestAppSnapshot(app.id),
      keywords: store.listKeywords(app.id, true).map((k) => k.term),
      mood: 'bright',
      seed: 'kr.eumsoft.viewer-test',
    });
    assert.equal(script.scenes.length, 5);
    assert.deepEqual(
      script.scenes.map((s) => s.role),
      ['hook', 'problem', 'solution', 'proof', 'cta'],
    );
    assert.equal(script.appName, '이음뷰어');
    assert.match(script.scenes[0].headline, /도면|DWG/);
    assert.ok(script.scenes[2].bullets.length >= 3);
    assert.ok(script.scenes[3].stats.length === 3);
    assert.ok([...script.title].length <= 100);
    assert.match(script.title, /#Shorts/);
    assert.ok(script.hashtags.includes('#Shorts'));
    assert.match(script.description, /play\.google\.com/);
    assert.ok(script.scenes.every((scene) => scene.narration.length >= 5));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('앱마다 이름·키워드가 대본에 반영된다', () => {
    const { store, dir } = tempStore();
    for (const [pkg, expected] of [
      ['kr.eumsoft.zip', '이음ZIP'],
      ['kr.eumsoft.docs', '이음과 문서'],
    ] as const) {
      const app = store.getAppByPackage(pkg)!;
      const script = buildShortScript({
        app,
        snapshot: null,
        keywords: store.listKeywords(app.id, true).map((k) => k.term),
        mood: 'focus',
        seed: pkg,
      });
      assert.equal(script.appName, expected);
      assert.ok(script.title.includes(expected));
      assert.match(script.hashtags.join(' '), /#Shorts/);
    }
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('쇼츠 자산 생성', () => {
  test('프로시저럴 BGM: RIFF/WAVE 44.1kHz 스테레오, 무음 아님', () => {
    for (const mood of ['bright', 'focus', 'impact'] as const) {
      const bgm = generateBgmWav(mood, 6, 'test');
      assert.equal(bgm.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.equal(bgm.buffer.subarray(8, 12).toString('ascii'), 'WAVE');
      assert.equal(bgm.sampleRate, 44_100);
      assert.equal(bgm.buffer.readUInt32LE(24), 44_100);
      assert.equal(bgm.buffer.readUInt16LE(22), 2);
      assert.equal(bgm.buffer.length, 44 + Math.round(6 * 44_100) * 4);
      assert.ok(bgm.rms > 0.02, `${mood} BGM RMS 너무 낮음: ${bgm.rms}`);
      assert.ok(bgm.peak <= 1);
    }
  });

  test('씬 배경 PNG: 540×960 RGBA PNG', () => {
    const png = renderBackground(THEMES.bright, 0, 7);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 540);
    assert.equal(png.readUInt32BE(20), 960);
    assert.ok(png.length > 10_000);
  });

  test('ASS 자막: 5개 씬 텍스트 + 오버레이 좌표', () => {
    const { store, dir } = tempStore();
    const app = store.getAppByPackage('kr.eumsoft.viewer')!;
    const script = buildShortScript({ app, snapshot: null, keywords: ['DWG 뷰어'], mood: 'bright', seed: 'ass' });
    const timeline = script.scenes.map((_, i) => ({ index: i + 1, start: i * 4, duration: 4 }));
    const { content, overlays } = buildAss({
      script,
      theme: THEMES.bright,
      timeline,
      hasIcon: true,
      hasShot: true,
      fontFamily: 'Noto Sans CJK KR',
    });
    assert.match(content, /\[V4\+ Styles\]/);
    assert.match(content, /PlayResX: 1080/);
    assert.match(content, /PlayResY: 1920/);
    const dialogues = content.split('\n').filter((line) => line.startsWith('Dialogue:'));
    assert.ok(dialogues.length >= 15, `Dialogue 이벤트가 ${dialogues.length}개뿐입니다.`);
    assert.ok(dialogues.some((line) => line.includes('도면')));
    assert.equal(overlays.length, 5);
    assert.ok(overlays[0].icon);
    assert.ok(overlays[3].shot);
    assert.equal(sceneOverlay('problem', true, true).icon, null);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('쇼츠 프로바이더 설정', () => {
  test('기본값은 키 없이 동작하는 내장 엔진', () => {
    const { store, dir } = tempStore();
    const config = loadConfig({ dataDir: dir, adminPassword: null, enableScheduler: false });
    const resolved = resolveProviders(store, config);
    assert.equal(resolved.video.id, 'builtin');
    assert.equal(resolved.video.ready, true);
    assert.equal(resolved.tts.id, 'builtin');
    assert.equal(resolved.tts.ready, true);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Higgsfield/ElevenLabs 키를 저장하면 연결 상태로 바뀌고 키는 마스킹된다', () => {
    const { store, dir } = tempStore();
    const config = loadConfig({ dataDir: dir, adminPassword: null, enableScheduler: false });
    store.setSetting('shorts_video_provider', 'higgsfield');
    store.setSetting('shorts_video_api_key', 'key-id:secret-value-123456');
    store.setSetting('shorts_tts_provider', 'elevenlabs');
    store.setSetting('shorts_tts_api_key', 'xi-secret-key-abcdef');
    const resolved = resolveProviders(store, config);
    assert.equal(resolved.video.id, 'higgsfield');
    assert.equal(resolved.video.ready, true);
    assert.equal(resolved.tts.id, 'elevenlabs');
    assert.equal(resolved.tts.ready, true);
    const view = providerSettingsView(store, config) as Record<string, any>;
    assert.equal(view.shorts_video_key_set, true);
    assert.match(String(view.shorts_video_api_key), /••••/);
    assert.ok(!String(view.shorts_video_api_key).includes('secret-value'));
    assert.equal((view.resolved as any).video.id, 'higgsfield');
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('쇼츠 API', () => {
  let harness: { base: string; server: Server; created: CreatedServer; tempDir: string; appId: number };

  before(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-promo-shorts-'));
    const created = createServer({ dataDir: tempDir, seedDemoData: true, enableScheduler: false, adminPassword: null });
    const server = created.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as { port: number };
    const app = created.store.getAppByPackage('kr.eumsoft.viewer')!;
    harness = { base: `http://127.0.0.1:${address.port}`, server, created, tempDir, appId: app.id };
  });

  after(async () => {
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
    await harness.created.close();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  const call = async (pathname: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${harness.base}${pathname}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data: data as any };
  };

  test('GET /api/shorts/providers — 엔진·분위기 목록', async () => {
    const res = await call('/api/shorts/providers');
    assert.equal(res.status, 200);
    assert.equal(res.data.videoProviders.length, 5);
    assert.equal(res.data.ttsProviders.length, 3);
    assert.ok(res.data.moods.some((m: any) => m.id === 'impact'));
    assert.equal(res.data.providers.shorts_video_provider, 'builtin');
  });

  test('GET /api/shorts — 빈 목록', async () => {
    const res = await call('/api/shorts');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.shorts, []);
  });

  test('POST /api/shorts — 잘못된 앱/분위기는 거부', async () => {
    const missing = await call('/api/shorts', { method: 'POST', body: { appId: 9999 } });
    assert.equal(missing.status, 404);
    const badMood = await call('/api/shorts', { method: 'POST', body: { appId: harness.appId, mood: 'loud' } });
    assert.equal(badMood.status, 400);
    const badProvider = await call('/api/shorts', {
      method: 'POST',
      body: { appId: harness.appId, videoProvider: 'sora' },
    });
    assert.equal(badProvider.status, 400);
  });

  test('PUT /api/settings — 프로바이더 저장·마스킹·검증', async () => {
    const saved = await call('/api/settings', {
      method: 'PUT',
      body: {
        shorts_video_provider: 'higgsfield',
        shorts_video_api_key: 'hf-id:hf-secret-123456',
        shorts_video_endpoint: 'https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video',
        shorts_video_model: 'seedance-2.0',
        shorts_tts_provider: 'openai',
        shorts_tts_voice: 'alloy',
      },
    });
    assert.equal(saved.status, 200);
    const view = await call('/api/settings');
    assert.equal(view.data.settings.shorts_video_provider, 'higgsfield');
    assert.equal(view.data.settings.shorts_video_key_set, true);
    assert.match(view.data.settings.shorts_video_api_key, /••••/);
    assert.equal(view.data.settings.resolved.video.ready, true);
    assert.match(view.data.settings.shorts_video_endpoint, /higgsfield/);

    const invalid = await call('/api/settings', { method: 'PUT', body: { shorts_video_provider: 'sora' } });
    assert.equal(invalid.status, 400);
    const masked = await call('/api/settings', {
      method: 'PUT',
      body: { shorts_video_api_key: view.data.settings.shorts_video_api_key },
    });
    assert.equal(masked.status, 200);
    const after = await call('/api/settings');
    assert.equal(after.data.settings.resolved.video.ready, true, '마스킹 값은 키를 덮어쓰지 않아야 합니다.');
  });

  test('DELETE /api/shorts/:id — 없는 항목은 404', async () => {
    const res = await call('/api/shorts/12345', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

const ffmpegAvailable = Boolean(findBinary('ffmpeg') && findBinary('ffprobe'));

describe('쇼츠 실제 렌더 (ffmpeg 필요)', { skip: ffmpegAvailable ? false : 'ffmpeg 없음' }, () => {
  test('이음뷰어 1080×1920 · 30fps · H.264/AAC MP4 생성', { timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-shorts-render-'));
    const config = loadConfig({ dataDir: dir, adminPassword: null, enableScheduler: false, shortsDir: path.join(dir, 'shorts') });
    const store = new Store(config);
    const app = store.getAppByPackage('kr.eumsoft.viewer')!;
    const providers = resolveProviders(store, config);
    const result = await buildShort(
      store,
      config,
      {
        shortId: 1,
        app,
        snapshot: store.latestAppSnapshot(app.id),
        keywords: store.listKeywords(app.id, true).map((k) => k.term),
        mood: 'bright',
        narration: false,
        providers: {
          videoProvider: 'builtin',
          videoApiKey: '',
          videoEndpoint: '',
          videoModel: '',
          ttsProvider: 'builtin',
          ttsApiKey: '',
          ttsVoice: '',
        },
        aiKey: null,
        aiModel: 'gpt-4o-mini',
      },
      () => undefined,
    );
    assert.ok(fs.existsSync(result.file));
    assert.ok(result.bytes > 300_000, `파일이 너무 작습니다: ${result.bytes}`);
    const media = await resolveMedia({}, dir);
    const info = await probe(media, result.file);
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);
    assert.equal(info.codec, 'h264');
    assert.equal(info.audioCodec, 'aac');
    assert.ok(info.durationSec && info.durationSec >= 12 && info.durationSec <= 28, `길이 ${info.durationSec}`);
    assert.ok(Math.abs((info.fps ?? 0) - 30) < 0.5);
    assert.equal(providers.video.id, 'builtin');
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
