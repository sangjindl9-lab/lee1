// API 클라이언트: 세션 쿠키(HttpOnly) + CSRF 헤더
let csrf = "";
export function setCsrf(t: string) {
  csrf = t;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Handler = () => void;
let onUnauthorized: Handler = () => {};
export function setUnauthorizedHandler(h: Handler) {
  onUnauthorized = h;
}

async function parseError(r: Response): Promise<ApiError> {
  let msg = `요청 실패 (HTTP ${r.status})`;
  let code = "";
  try {
    const j = await r.json();
    const d = j?.detail;
    if (typeof d === "string") msg = d;
    else if (d && typeof d === "object") {
      msg = d.message ?? msg;
      code = d.code ?? "";
    }
  } catch {
    /* 본문 없음 */
  }
  return new ApiError(r.status, msg, code);
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  const r = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  if (!r.ok) {
    const e = await parseError(r);
    if (r.status === 401 && !path.endsWith("/auth/login")) onUnauthorized();
    throw e;
  }
  if (opts.raw) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>("PUT", p, b);
export const del = <T = any>(p: string) => api<T>("DELETE", p);

export function qs(o: Record<string, string | number | boolean | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
}
