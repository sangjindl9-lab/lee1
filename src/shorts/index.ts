/** 쇼츠 스튜디오 서비스 — 작업 큐(한 번에 1편) + DB 기록 + 상태 조회 */
import fs from 'node:fs';
import type { AppConfig } from '../config.ts';
import type { ShortRow, Store } from '../db.ts';
import { buildShort, type BuildContext } from './render.ts';
import { resolveMedia } from './ffmpeg.ts';
import { providerSettingsView, resolveProviders } from './providers.ts';
import type { Mood, TtsProviderId, VideoProviderId } from './types.ts';

export interface CreateShortInput {
  appId: number;
  mood?: Mood;
  narration?: boolean;
  videoProvider?: VideoProviderId;
  ttsProvider?: TtsProviderId;
}

export interface ShortsRunner {
  enqueue: (input: CreateShortInput) => ShortRow;
  recover: () => void;
  status: () => Promise<Record<string, unknown>>;
}

const MOOD_SET = new Set(['bright', 'focus', 'impact']);
const VIDEO_SET = new Set(['builtin', 'higgsfield', 'runway', 'kling', 'custom']);
const TTS_SET = new Set(['builtin', 'openai', 'elevenlabs']);

export function createShortsRunner(store: Store, config: AppConfig, log: (message: string) => void = () => {}): ShortsRunner {
  let chain: Promise<void> = Promise.resolve();
  const active = new Set<number>();

  const patch = (id: number, values: Parameters<Store['updateShort']>[1]): void => {
    try {
      store.updateShort(id, values);
    } catch (err) {
      log(`[shorts] DB 갱신 실패 (${id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const runJob = async (id: number): Promise<void> => {
    const row = store.getShort(id);
    if (!row) return;
    const app = store.getApp(row.app_id);
    if (!app) {
      patch(id, { status: 'failed', stage: 'failed', error: '앱을 찾을 수 없습니다.', finished_at: new Date().toISOString() });
      return;
    }
    const providers = resolveProviders(store, config);
    const openaiKey = providers.tts.apiKey && providers.tts.id === 'openai' ? providers.tts.apiKey : resolveOpenAi(store, config);
    const context: BuildContext = {
      shortId: id,
      app,
      snapshot: store.latestAppSnapshot(app.id),
      keywords: store.listKeywords(app.id, true).map((k) => k.term),
      mood: (row.mood as Mood) ?? 'bright',
      narration: row.tts_provider !== 'none',
      providers: {
        videoProvider: (row.video_provider as VideoProviderId) ?? 'builtin',
        videoApiKey: providers.video.apiKey,
        videoEndpoint: providers.video.endpoint,
        videoModel: providers.video.model,
        ttsProvider: (row.tts_provider as TtsProviderId) ?? 'builtin',
        ttsApiKey: providers.tts.apiKey,
        ttsVoice: providers.tts.voice,
      },
      aiKey: openaiKey,
      aiModel: store.getSetting('openai_model') || config.openaiModel,
    };

    patch(id, { status: 'running', stage: 'script', progress: 3, error: null });
    try {
      const result = await buildShort(store, config, context, (stage, progress, note) => {
        patch(id, { stage, progress, status: 'running' });
        if (note) log(`[shorts:${id}] ${stage} ${progress}% — ${note}`);
      });
      patch(id, {
        status: 'done',
        stage: 'done',
        progress: 100,
        title: result.script.title,
        description: result.script.description,
        hashtags: result.script.hashtags.join(' '),
        script_json: JSON.stringify(result.script),
        file_path: result.file,
        file_bytes: result.bytes,
        duration_sec: result.duration,
        width: 1080,
        height: 1920,
        fps: 30,
        warnings_json: JSON.stringify(result.warnings),
        engine: result.engine,
        finished_at: new Date().toISOString(),
      });
      log(`[shorts:${id}] 완료 — ${result.file} (${Math.round(result.bytes / 1024)}KB, ${result.duration}s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch(id, {
        status: 'failed',
        stage: 'failed',
        error: message.slice(0, 800),
        warnings_json: JSON.stringify([message.slice(0, 400)]),
        finished_at: new Date().toISOString(),
      });
      log(`[shorts:${id}] 실패 — ${message}`);
    } finally {
      active.delete(id);
    }
  };

  const enqueue = (input: CreateShortInput): ShortRow => {
    const providers = resolveProviders(store, config);
    const mood = (input.mood && MOOD_SET.has(input.mood) ? input.mood : (store.getSetting('shorts_mood') as Mood)) ?? 'bright';
    const videoProvider = providers.video.id;
    const ttsProvider = input.narration === false ? ('none' as TtsProviderId) : providers.tts.id;
    const row = store.createShort({
      appId: input.appId,
      mood,
      engine: videoProvider === 'builtin' ? '내장 풀오토' : `${providers.video.label} 연결됨`,
      videoProvider,
      ttsProvider,
    });
    active.add(row.id);
    chain = chain.then(() => runJob(row.id)).catch(() => undefined);
    return row;
  };

  const recover = (): void => {
    const rows = store.listShorts(100);
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'running') {
        patch(row.id, {
          status: 'failed',
          stage: 'failed',
          error: '서버 재시작으로 작업이 중단되었습니다. 다시 생성해 주세요.',
          finished_at: new Date().toISOString(),
        });
      }
    }
  };

  const status = async (): Promise<Record<string, unknown>> => {
    const media = await resolveMedia(
      { ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath, font: config.shortsFont },
      path_join(config.shortsDir),
    );
    return {
      busy: active.size > 0,
      active: [...active],
      providers: providerSettingsView(store, config),
      media: { available: media.available, version: media.version, detail: media.detail, font: media.fontFamily },
    };
  };

  return { enqueue, recover, status };
}

function path_join(dir: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // 무시
  }
  return dir;
}

function resolveOpenAi(store: Store, config: AppConfig): string | null {
  const key = (store.getSetting('openai_api_key') ?? '').trim();
  return key || config.openaiApiKey;
}

/** 목록/상세 응답 변환 (스크립트 파싱 + 경고 배열) */
export function shortToJson(row: ShortRow): Record<string, unknown> {
  let script: unknown = null;
  try {
    script = row.script_json ? JSON.parse(row.script_json) : null;
  } catch {
    script = null;
  }
  let warnings: string[] = [];
  try {
    const parsed = JSON.parse(row.warnings_json || '[]');
    if (Array.isArray(parsed)) warnings = parsed.map((w) => String(w));
  } catch {
    warnings = [];
  }
  return {
    id: row.id,
    appId: row.app_id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    engine: row.engine,
    videoProvider: row.video_provider,
    ttsProvider: row.tts_provider,
    mood: row.mood,
    title: row.title,
    description: row.description,
    hashtags: row.hashtags,
    script,
    duration: row.duration_sec,
    width: row.width,
    height: row.height,
    fps: row.fps,
    bytes: row.file_bytes,
    videoUrl: row.status === 'done' ? `/api/shorts/${row.id}/video` : null,
    downloadUrl: row.status === 'done' ? `/api/shorts/${row.id}/download` : null,
    warnings,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}
