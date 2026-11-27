/** 한국어 내레이션 TTS — 무료(구글 번역 TTS) 우선, 유료 프로바이더는 설정 시 사용 */
import fs from 'node:fs';
import type { TtsProviderId } from './types.ts';
import { audioDuration, type ShortsMedia } from './ffmpeg.ts';

export interface TtsOutcome {
  ok: boolean;
  file: string | null;
  seconds: number | null;
  provider: TtsProviderId | 'none';
  engine: string;
  warning: string | null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function trimForTts(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return [...clean].length <= max ? clean : [...clean].slice(0, max - 1).join('') + '.';
}

/** 구글 번역 TTS — 키 없이 동작하지만 차단될 수 있어 짧은 타임아웃으로 시도합니다. */
async function googleTts(text: string, outFile: string): Promise<boolean> {
  const query = trimForTts(text);
  const hosts = ['https://translate.google.com', 'https://translate.googleapis.com'];
  for (const host of hosts) {
    const url = `${host}/translate_tts?ie=UTF-8&client=tw-ob&tl=ko&ttsspeed=1&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://translate.google.com/' },
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) continue;
      fs.writeFileSync(outFile, buf);
      return true;
    } catch {
      // 다음 호스트 시도
    }
  }
  return false;
}

async function openaiTts(text: string, apiKey: string, voice: string, outFile: string): Promise<string | null> {
  const models = ['gpt-4o-mini-tts', 'tts-1'];
  let lastError = '';
  for (const model of models) {
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          voice: voice || 'alloy',
          input: trimForTts(text, 600),
          response_format: 'mp3',
          speed: 1.05,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        lastError = `OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) {
        lastError = 'OpenAI TTS 응답이 비어 있습니다.';
        continue;
      }
      fs.writeFileSync(outFile, buf);
      return null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return lastError || 'OpenAI TTS 실패';
}

async function elevenLabsTts(text: string, apiKey: string, voiceId: string, outFile: string): Promise<string | null> {
  const voice = voiceId || '21m00Tcm4TlvDq8ikWAM';
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: trimForTts(text, 600),
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return 'ElevenLabs 응답이 비어 있습니다.';
    fs.writeFileSync(outFile, buf);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function synthesizeNarration(options: {
  text: string;
  provider: TtsProviderId;
  apiKey: string;
  voice: string;
  outFile: string;
  media: ShortsMedia;
}): Promise<TtsOutcome> {
  const { text, provider, apiKey, voice, outFile, media } = options;
  const label = provider === 'openai' ? 'OpenAI TTS' : provider === 'elevenlabs' ? 'ElevenLabs' : '내장 무료 TTS';

  if (provider !== 'builtin' && !apiKey) {
    return { ok: false, file: null, seconds: null, provider, engine: label, warning: `${label} 키가 없어 내레이션 없이 만듭니다.` };
  }

  let warning: string | null = null;
  if (provider === 'openai') {
    warning = await openaiTts(text, apiKey, voice, outFile);
  } else if (provider === 'elevenlabs') {
    warning = await elevenLabsTts(text, apiKey, voice, outFile);
  } else {
    const done = await googleTts(text, outFile);
    if (!done) warning = '무료 TTS 응답이 없어 자막+BGM으로 대체합니다.';
  }

  if (warning || !fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
    return { ok: false, file: null, seconds: null, provider, engine: label, warning: warning ?? `${label} 음성을 만들지 못했습니다.` };
  }

  const seconds = await audioDuration(media, outFile);
  if (!seconds || seconds <= 0.2) {
    return { ok: false, file: null, seconds: null, provider, engine: label, warning: `${label} 음성 길이를 읽지 못했습니다.` };
  }
  return { ok: true, file: outFile, seconds, provider, engine: label, warning: null };
}
