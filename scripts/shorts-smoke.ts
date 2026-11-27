/**
 * 로컬 쇼츠 렌더 스모크 테스트.
 * 사용: FFMPEG_PATH=... node scripts/shorts-smoke.ts kr.eumsoft.viewer bright
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { buildShort } from '../src/shorts/render.ts';
import { resolveProviders } from '../src/shorts/providers.ts';

const packageId = process.argv[2] ?? 'kr.eumsoft.viewer';
const mood = (process.argv[3] ?? 'bright') as 'bright' | 'focus' | 'impact';
const narration = process.argv[4] !== 'nonarration';
const dataDir = path.resolve(process.cwd(), '.shorts-smoke-data');

const config = loadConfig({ dataDir, adminPassword: null, enableScheduler: false, shortsDir: path.join(dataDir, 'shorts') });
fs.mkdirSync(config.shortsDir, { recursive: true });
const store = new Store(config);
const app = store.getAppByPackage(packageId) ?? store.upsertApp(packageId);
const providers = resolveProviders(store, config);
const shownProviders = { ...providers, video: { ...providers.video, apiKey: providers.video.apiKey ? '***' : '' }, tts: { ...providers.tts, apiKey: providers.tts.apiKey ? '***' : '' } };
console.log('media:', { ffmpeg: config.ffmpegPath, ffprobe: config.ffprobePath });
console.log('providers:', JSON.stringify(shownProviders, null, 2));

const started = Date.now();
const result = await buildShort(
  store,
  config,
  {
    shortId: 901,
    app,
    snapshot: store.latestAppSnapshot(app.id),
    keywords: store.listKeywords(app.id, true).map((k) => k.term),
    mood,
    narration,
    providers: {
      videoProvider: providers.video.id,
      videoApiKey: providers.video.apiKey,
      videoEndpoint: providers.video.endpoint,
      videoModel: providers.video.model,
      ttsProvider: providers.tts.id,
      ttsApiKey: providers.tts.apiKey,
      ttsVoice: providers.tts.voice,
    },
    aiKey: null,
    aiModel: 'gpt-4o-mini',
  },
  (stage, progress, note) => console.log(`[${stage}] ${progress}% ${note ?? ''}`),
);

console.log(JSON.stringify({
  file: result.file,
  bytes: result.bytes,
  duration: result.duration,
  engine: result.engine,
  warnings: result.warnings,
  title: result.script.title,
  hashtags: result.script.hashtags,
  elapsedSec: Math.round((Date.now() - started) / 100) / 10,
}, null, 2));
store.close();
