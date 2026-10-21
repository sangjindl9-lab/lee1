// 서버 API (회원제). 서버가 없으면(정적 배포·아티팩트) 로컬 모드로 동작한다.
export interface IpRow {
  ip: string;
  first_seen: string;
  last_seen: string;
  current?: boolean;
}
export interface IpState {
  status: 'ok' | 'register' | 'full';
  ip: string;
  used: number;
  max: number;
  ips: IpRow[];
}
export interface Me {
  user: { id: number; username: string; name: string; company: string; expires_at: string | null };
  ipState: IpState;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', null);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new ApiError(r.status, data.code || 'error', data.message || `오류 (${r.status})`, data);
    if (url.startsWith('/api/') && !url.startsWith('/api/admin') && !url.startsWith('/api/login') && (r.status === 401 || (r.status === 403 && data.code !== 'ip_full'))) {
      window.dispatchEvent(new CustomEvent('gj-auth', { detail: err }));
    }
    throw err;
  }
  return data as T;
}

/** 서버 모드 여부: /api/health 가 JSON으로 응답하면 회원제 서버 */
export async function detectServer(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.mode === 'server';
  } catch {
    return false;
  }
}
