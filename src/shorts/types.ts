/** 쇼츠 스튜디오 공용 타입 */

export type Mood = 'bright' | 'focus' | 'impact';

export type VideoProviderId = 'builtin' | 'higgsfield' | 'runway' | 'kling' | 'custom';
export type TtsProviderId = 'builtin' | 'openai' | 'elevenlabs';

export type SceneRole = 'hook' | 'problem' | 'solution' | 'proof' | 'cta';

export interface SceneStat {
  value: string;
  label: string;
}

export interface Scene {
  /** 1부터 시작하는 씬 번호 */
  index: number;
  role: SceneRole;
  kicker: string;
  headline: string;
  sub: string;
  bullets: string[];
  stats: SceneStat[];
  badge: string;
  narration: string;
  duration: number;
}

export interface ShortScript {
  packageId: string;
  appName: string;
  mood: Mood;
  scenes: Scene[];
  title: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  generator: 'template' | 'openai';
  warnings: string[];
}

export interface ProviderSettings {
  videoProvider: VideoProviderId;
  videoApiKey: string;
  videoEndpoint: string;
  videoModel: string;
  ttsProvider: TtsProviderId;
  ttsApiKey: string;
  ttsVoice: string;
}

export const MOODS: { id: Mood; label: string; hint: string }[] = [
  { id: 'bright', label: '밝고 경쾌한 테크', hint: '시원한 블루·시안, 통통 튀는 비트' },
  { id: 'focus', label: '집중 업무용', hint: '차분한 네이비·틸, 낮은 텐션' },
  { id: 'impact', label: '임팩트 숏폼', hint: '강한 대비의 오렌지·핑크, 빠른 비트' },
];

export const VIDEO_PROVIDERS: { id: VideoProviderId; label: string; needsKey: boolean; hint: string }[] = [
  { id: 'builtin', label: '내장 풀오토 (FFmpeg 모션)', needsKey: false, hint: 'API 키 없이 100% 동작하는 기본 엔진' },
  { id: 'higgsfield', label: 'Higgsfield AI (힉스필드)', needsKey: true, hint: 'text-to-video로 훅 장면을 영상으로 생성' },
  { id: 'runway', label: 'Runway', needsKey: true, hint: 'Gen-4 Turbo 계열 이미지→영상 API' },
  { id: 'kling', label: 'Kling (커스텀)', needsKey: true, hint: 'Kling 호환 엔드포인트' },
  { id: 'custom', label: '커스텀 영상 API', needsKey: true, hint: '직접 운영하는 생성 API (JSON 응답에 video URL)' },
];

export const TTS_PROVIDERS: { id: TtsProviderId; label: string; needsKey: boolean; hint: string }[] = [
  { id: 'builtin', label: '내장 무료 TTS + 프로시저럴 BGM', needsKey: false, hint: '무료 음성 시도 → 실패 시 자막+BGM으로 자동 폴백' },
  { id: 'openai', label: 'OpenAI TTS', needsKey: true, hint: 'gpt-4o-mini-tts / tts-1 음성' },
  { id: 'elevenlabs', label: 'ElevenLabs', needsKey: true, hint: 'eleven_multilingual_v2 한국어 음성' },
];
