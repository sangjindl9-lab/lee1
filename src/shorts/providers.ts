/** 쇼츠 프로바이더 설정 해석 (DB settings → 실제 사용 값) */
import type { AppConfig } from '../config.ts';
import type { Store } from '../db.ts';
import { TTS_PROVIDERS, VIDEO_PROVIDERS, type TtsProviderId, type VideoProviderId } from './types.ts';

export interface VideoProviderConfig {
  id: VideoProviderId;
  label: string;
  apiKey: string;
  endpoint: string;
  model: string;
  ready: boolean;
  detail: string;
}

export interface TtsProviderConfig {
  id: TtsProviderId;
  label: string;
  apiKey: string;
  voice: string;
  ready: boolean;
  detail: string;
}

export interface ProviderConfig {
  video: VideoProviderConfig;
  tts: TtsProviderConfig;
}

function envKey(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function resolveProviders(store: Store, config: AppConfig): ProviderConfig {
  const videoId = (store.getSetting('shorts_video_provider') || 'builtin') as VideoProviderId;
  const ttsId = (store.getSetting('shorts_tts_provider') || 'builtin') as TtsProviderId;
  const videoMeta = VIDEO_PROVIDERS.find((p) => p.id === videoId) ?? VIDEO_PROVIDERS[0];
  const ttsMeta = TTS_PROVIDERS.find((p) => p.id === ttsId) ?? TTS_PROVIDERS[0];

  const videoDbKey = (store.getSetting('shorts_video_api_key') ?? '').trim();
  const videoEnvKey =
    videoId === 'higgsfield'
      ? envKey('HIGGSFIELD_API_KEY')
      : videoId === 'runway'
        ? envKey('RUNWAY_API_KEY')
        : videoId === 'kling'
          ? envKey('KLING_API_KEY')
          : videoId === 'custom'
            ? envKey('CUSTOM_VIDEO_API_KEY')
            : '';
  const videoApiKey = videoDbKey || videoEnvKey;
  const videoEndpoint = (store.getSetting('shorts_video_endpoint') ?? '').trim();
  const videoModel = (store.getSetting('shorts_video_model') ?? '').trim();

  const ttsDbKey = (store.getSetting('shorts_tts_api_key') ?? '').trim();
  const ttsEnvKey =
    ttsId === 'openai'
      ? config.openaiApiKey || envKey('OPENAI_API_KEY')
      : ttsId === 'elevenlabs'
        ? envKey('ELEVENLABS_API_KEY')
        : '';
  const ttsApiKey = ttsDbKey || ttsEnvKey;
  const ttsVoice =
    (store.getSetting('shorts_tts_voice') ?? '').trim() ||
    (ttsId === 'openai' ? 'alloy' : ttsId === 'elevenlabs' ? '21m00Tcm4TlvDq8ikWAM' : '');

  const videoReady = videoId === 'builtin' ? true : Boolean(videoApiKey);
  const ttsReady = ttsId === 'builtin' ? true : Boolean(ttsApiKey);

  return {
    video: {
      id: videoId,
      label: videoMeta?.label ?? videoId,
      apiKey: videoApiKey,
      endpoint: videoEndpoint,
      model: videoModel,
      ready: videoReady,
      detail:
        videoId === 'builtin'
          ? 'API 키 없이 1080×1920 MP4를 바로 렌더링합니다.'
          : videoReady
            ? `${videoMeta?.label ?? videoId} 키가 설정되어 있어 훅 장면을 AI 영상으로 생성합니다.`
            : `${videoMeta?.label ?? videoId} 키가 없어 내장 엔진으로 폴백합니다.`,
    },
    tts: {
      id: ttsId,
      label: ttsMeta?.label ?? ttsId,
      apiKey: ttsApiKey,
      voice: ttsVoice,
      ready: ttsReady,
      detail:
        ttsId === 'builtin'
          ? '무료 음성을 시도하고, 실패하면 자막+BGM으로 안전하게 폴백합니다.'
          : ttsReady
            ? `${ttsMeta?.label ?? ttsId} 음성으로 내레이션을 만듭니다.`
            : `${ttsMeta?.label ?? ttsId} 키가 없어 자막+BGM으로 폴백합니다.`,
    },
  };
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

/** 설정 화면 표시용 (키는 마스킹) */
export function providerSettingsView(store: Store, config: AppConfig): Record<string, unknown> {
  const resolved = resolveProviders(store, config);
  const videoKeyDb = store.getSetting('shorts_video_api_key') ?? '';
  const ttsKeyDb = store.getSetting('shorts_tts_api_key') ?? '';
  return {
    shorts_video_provider: resolved.video.id,
    shorts_video_api_key: maskSecret(videoKeyDb),
    shorts_video_key_set: Boolean(resolved.video.apiKey),
    shorts_video_key_source: videoKeyDb ? 'db' : resolved.video.apiKey ? 'env' : 'none',
    shorts_video_endpoint: resolved.video.endpoint,
    shorts_video_model: resolved.video.model,
    shorts_tts_provider: resolved.tts.id,
    shorts_tts_api_key: maskSecret(ttsKeyDb),
    shorts_tts_key_set: Boolean(resolved.tts.apiKey),
    shorts_tts_key_source: ttsKeyDb ? 'db' : resolved.tts.apiKey ? 'env' : 'none',
    shorts_tts_voice: resolved.tts.voice,
    shorts_mood: store.getSetting('shorts_mood') ?? 'bright',
    shorts_narration: store.getSetting('shorts_narration') ?? 'true',
    resolved: {
      video: { id: resolved.video.id, label: resolved.video.label, ready: resolved.video.ready, detail: resolved.video.detail },
      tts: { id: resolved.tts.id, label: resolved.tts.label, ready: resolved.tts.ready, detail: resolved.tts.detail },
    },
  };
}
