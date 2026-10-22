/**
 * API 호출 — 같은 출처(/api/v1)로만 요청. 세션은 HttpOnly 쿠키, 상태 변경은 CSRF 헤더 동봉.
 * 서버가 모든 권한·계산을 다시 검증하므로 화면은 결과만 표시한다.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: { field: string; message: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.body.fields ?? []) if (f.field && !out[f.field]) out[f.field] = f.message;
    return out;
  }
}

let companyId: string | null = null;
export const setApiCompany = (id: string | null) => {
  companyId = id;
};
export const getApiCompany = () => companyId;

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)erp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

type Handler = (e: ApiError) => void;
let onAuthError: Handler | null = null;
export const setAuthErrorHandler = (h: Handler | null) => {
  onAuthError = h;
};

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; noCompany?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(init.json);
  }
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrf());
  if (companyId && !init.noCompany) headers.set('x-company-id', companyId);
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, method, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요' });
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, body ?? { code: 'HTTP_' + res.status, message: res.status === 413 ? '파일이 너무 큽니다' : '요청을 처리하지 못했습니다' });
    if (res.status === 401 || err.body.code === 'PASSWORD_CHANGE_REQUIRED') onAuthError?.(err);
    throw err;
  }
  return body as T;
}

/** 파일 내려받기 (엑셀·첨부) — 같은 출처 링크로 브라우저가 쿠키와 함께 받게 한다 */
export async function download(path: string, fallbackName: string) {
  const headers = new Headers();
  if (companyId) headers.set('x-company-id', companyId);
  const res = await fetch(`/api/v1${path}`, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: 'DOWNLOAD', message: '파일을 받을 수 없습니다' }));
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function upload<T>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: 'POST', body: form });
}

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
