/** 외부 AI 영상 프로바이더 어댑터 — Higgsfield / Runway·Kling 호환 / 커스텀 API */
import fs from 'node:fs';
import { sleep } from '../util.ts';
import type { VideoProviderId } from './types.ts';

export interface ExternalClipResult {
  ok: boolean;
  file: string | null;
  provider: VideoProviderId;
  label: string;
  warning: string | null;
  requestId: string | null;
  elapsedMs: number;
}

const LABELS: Record<VideoProviderId, string> = {
  builtin: '내장 풀오토',
  higgsfield: 'Higgsfield AI',
  runway: 'Runway',
  kling: 'Kling',
  custom: '커스텀 영상 API',
};

const DEFAULT_ENDPOINTS: Partial<Record<VideoProviderId, string>> = {
  higgsfield: 'https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video',
  runway: 'https://api.dev.runwayml.com/v1/text_to_video',
  kling: '',
  custom: '',
};

export function providerLabel(provider: VideoProviderId): string {
  return LABELS[provider] ?? provider;
}

function findVideoUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (/\.(mp4|mov|webm)(\?|$)/i.test(value) || /^https:\/\/.*\/videos?\//i.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['video', 'video_url', 'url', 'output', 'outputs', 'result', 'data', 'videos']) {
      if (key in obj) {
        const found = findVideoUrl(obj[key], depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

async function download(url: string, target: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20_000) return false;
    fs.writeFileSync(target, buf);
    return true;
  } catch {
    return false;
  }
}

interface SubmitOptions {
  provider: VideoProviderId;
  apiKey: string;
  endpoint: string;
  model: string;
  prompt: string;
  outFile: string;
  pollTimeoutMs: number;
}

/** 한 편 생성: 제출 → (필요 시) 폴링 → MP4 다운로드 */
export async function generateExternalClip(options: SubmitOptions): Promise<ExternalClipResult> {
  const started = Date.now();
  const { provider, apiKey, model, prompt, outFile, pollTimeoutMs } = options;
  const endpoint = options.endpoint.trim() || DEFAULT_ENDPOINTS[provider] || '';
  const label = providerLabel(provider);
  const fail = (warning: string, requestId: string | null = null): ExternalClipResult => ({
    ok: false,
    file: null,
    provider,
    label,
    warning,
    requestId,
    elapsedMs: Date.now() - started,
  });

  if (!endpoint) return fail(`${label} 엔드포인트가 설정되지 않았습니다.`);
  if (!apiKey) return fail(`${label} API 키가 설정되지 않았습니다.`);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'higgsfield') headers.Authorization = `Key ${apiKey}`;
  else headers.Authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    prompt,
    duration: 5,
    aspect_ratio: '9:16',
    resolution: '720p',
    generate_audio: false,
  };
  if (model) body.model = model;

  let submit: Response;
  try {
    submit = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return fail(`${label} 요청 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  const submitText = await submit.text();
  if (!submit.ok) return fail(`${label} 응답 ${submit.status}: ${submitText.slice(0, 200)}`);

  let payload: unknown;
  try {
    payload = JSON.parse(submitText);
  } catch {
    return fail(`${label} 응답을 해석하지 못했습니다.`);
  }
  const obj = payload as Record<string, unknown>;
  const requestId = typeof obj.request_id === 'string' ? obj.request_id : typeof obj.id === 'string' ? obj.id : null;
  const statusUrl =
    (typeof obj.status_url === 'string' && obj.status_url) ||
    (typeof obj.statusUrl === 'string' && obj.statusUrl) ||
    (requestId ? endpoint.replace(/\/[^/]+$/, `/requests/${requestId}/status`) : '');

  let direct = findVideoUrl(payload);
  const deadline = Date.now() + pollTimeoutMs;
  while (!direct && statusUrl && Date.now() < deadline) {
    const status = String(obj.status ?? '').toLowerCase();
    if (['failed', 'error', 'canceled', 'cancelled', 'nsfw'].includes(status)) {
      return fail(`${label} 생성 실패(${status}): ${JSON.stringify(payload).slice(0, 200)}`, requestId);
    }
    await sleep(4_000);
    try {
      const res = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      payload = await res.json();
      direct = findVideoUrl(payload);
      const status2 = String((payload as Record<string, unknown>).status ?? '').toLowerCase();
      if (!direct && ['failed', 'error', 'canceled', 'cancelled', 'nsfw'].includes(status2)) {
        return fail(`${label} 생성 실패(${status2})`, requestId);
      }
    } catch {
      // 계속 폴링
    }
  }

  if (!direct) {
    return fail(`${label} 결과 영상 URL을 받지 못했습니다(대기 ${Math.round(pollTimeoutMs / 1000)}초).`, requestId);
  }
  if (!(await download(direct, outFile))) {
    return fail(`${label} 영상 다운로드에 실패했습니다.`, requestId);
  }
  return { ok: true, file: outFile, provider, label, warning: null, requestId, elapsedMs: Date.now() - started };
}

/** 훅 장면용 프롬프트 (한국어 앱 맥락을 영어 장면 묘사로) */
export function heroPrompt(appName: string, category: string, mood: string): string {
  const style =
    mood === 'impact'
      ? 'bold high-contrast lighting, punchy motion, energetic'
      : mood === 'focus'
        ? 'calm minimal studio light, slow cinematic dolly, clean desk'
        : 'bright airy tech lighting, smooth camera glide, subtle blue and cyan glow';
  return [
    `Vertical 9:16 short-form ad b-roll for a Korean mobile app called "${appName}" (${category}).`,
    `No text, no letters, no logos in frame.`,
    style + ', premium product commercial feel, shallow depth of field, 4k detail.',
  ].join(' ');
}
