// REST 클라이언트. 모든 경로는 상대 경로(/api/...)로 호출한다.

const TOKEN_KEY = 'eum.access_token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** 서버에 연결할 수 없는 상황(네트워크 오류, 프록시 게이트웨이 오류) */
  get unreachable(): boolean {
    return this.code === 'NETWORK';
  }
}

type GlobalHandler = (err: ApiError) => void;
let globalHandler: GlobalHandler | null = null;
/** 401, 403 MFA_SETUP_REQUIRED 처리를 위해 앱 루트에서 등록한다. */
export function setGlobalErrorHandler(h: GlobalHandler | null): void {
  globalHandler = h;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | null | undefined>;
  stepUpToken?: string;
  /** 전역 처리(로그아웃/MFA 이동)를 하지 않음 */
  silent?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  // 호스트를 지정하지 않는 상대 URL: 개발 시 Vite 프록시, 운영 시 같은 서버로 간다.
  let url = '/api' + (path.startsWith('/') ? path : '/' + path);
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  return url;
}

function messageText(m: unknown): string {
  if (Array.isArray(m)) return m.map(String).join(', ');
  if (typeof m === 'string') return m;
  return '';
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.stepUpToken) headers['X-Step-Up-Token'] = opts.stepUpToken;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'same-origin',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', '관제 서버에 연결할 수 없습니다.');
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    let err: ApiError;
    if (json === null && (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500)) {
      err = new ApiError(res.status, 'NETWORK', '관제 서버에 연결할 수 없습니다.');
    } else {
      const code = typeof obj.code === 'string' ? obj.code : `HTTP_${res.status}`;
      const msg = messageText(obj.message) || defaultMessage(res.status);
      err = new ApiError(res.status, code, msg);
    }
    if (!opts.silent && globalHandler) globalHandler(err);
    throw err;
  }
  return json as T;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return '요청 값이 올바르지 않습니다.';
    case 401:
      return '인증이 필요합니다. 다시 로그인하세요.';
    case 403:
      return '권한이 없습니다.';
    case 404:
      return '대상을 찾을 수 없습니다.';
    case 409:
      return '요청이 현재 상태와 충돌합니다.';
    default:
      return `서버 오류 (${status})`;
  }
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
