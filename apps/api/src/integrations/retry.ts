import { ProviderError } from './types';

/** 외부 API 재시도: 네트워크·일시 장애(retryable)만 지수 백오프로 다시 시도 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: { attempts?: number; baseMs?: number; onRetry?: (attempt: number, err: unknown) => void | Promise<void> } = {}): Promise<{ value: T; attempts: number }> {
  const max = opts.attempts ?? 3;
  const base = opts.baseMs ?? 800;
  let last: unknown;
  for (let i = 1; i <= max; i++) {
    try {
      return { value: await fn(i), attempts: i };
    } catch (e) {
      last = e;
      const retryable = e instanceof ProviderError ? e.retryable : isNetworkError(e);
      if (!retryable || i === max) throw Object.assign(e as object, { attempts: i });
      await opts.onRetry?.(i, e);
      await new Promise((r) => setTimeout(r, base * 3 ** (i - 1)));
    }
  }
  throw last;
}

export function isNetworkError(e: unknown) {
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code ?? '') || (e as Error)?.name === 'TimeoutError';
}

/** fetch + 시간 제한 + 5xx/429 는 재시도 가능 오류로 */
export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  } catch (e) {
    throw new ProviderError(`외부 서버에 연결하지 못했습니다 (${(e as Error).message})`, 'NETWORK', true);
  }
  const text = await res.text();
  if (res.status >= 500 || res.status === 429) throw new ProviderError(`외부 서버 일시 오류 (HTTP ${res.status})`, `HTTP_${res.status}`, true, text.slice(0, 500));
  return { status: res.status, ok: res.ok, text };
}
