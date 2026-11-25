import { sleep } from '../util.ts';

export const PLAY_BASE = 'https://play.google.com';

export interface FetchOptions {
  hl?: string;
  gl?: string;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

export class PlayFetchError extends Error {
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'PlayFetchError';
    this.status = status;
    this.url = url;
  }
}

/**
 * Google Play HTML/응답을 가져옵니다. 일시적 5xx·네트워크 오류는 짧게 재시도합니다.
 */
export async function fetchPlayText(url: string, options: FetchOptions = {}): Promise<{ status: number; text: string; url: string }> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const headers: Record<string, string> = {
    'User-Agent':
      options.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': `${options.hl ?? 'ko'}-${(options.gl ?? 'KR').toUpperCase()},${options.hl ?? 'ko'};q=0.9,en;q=0.8`,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(options.headers ?? {}),
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.status >= 500 && attempt < retries) {
        lastError = new PlayFetchError(`Google Play 응답 오류 (${res.status})`, res.status, url);
        await sleep(400 * (attempt + 1));
        continue;
      }
      return { status: res.status, text, url: res.url || url };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new PlayFetchError(`Google Play 요청에 실패했습니다: ${reason}`, undefined, url);
}

export function buildDetailsUrl(packageId: string, hl = 'ko', gl = 'KR'): string {
  const qs = new URLSearchParams({ id: packageId, hl, gl });
  return `${PLAY_BASE}/store/apps/details?${qs.toString()}`;
}

export function buildSearchUrl(term: string, hl = 'ko', gl = 'KR'): string {
  const qs = new URLSearchParams({ c: 'apps', q: term, hl, gl, price: '0' });
  return `${PLAY_BASE}/store/search?${qs.toString()}`;
}
