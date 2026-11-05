export class ApiError extends Error { constructor(public status: number, message: string, public body?: any) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string>; raw?: BodyInit } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body || opts.raw ? 'POST' : 'GET'),
    headers: opts.raw ? opts.headers : { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `요청 실패 (${res.status})`, data);
  return data as T;
}

/** 분할 업로드 (8MB 조각, 실패한 조각은 3회까지 재전송) */
export async function uploadFile(projectId: string, file: File, onProgress: (p: number) => void) {
  const { uploadId, chunkSize } = await api(`/projects/${projectId}/uploads`, { body: { name: file.name, size: file.size } });
  const n = Math.ceil(file.size / chunkSize);
  for (let i = 0; i < n; i++) {
    const blob = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
    for (let attempt = 0; ; attempt++) {
      try { await api(`/uploads/${uploadId}/chunks/${i}`, { method: 'PUT', raw: blob, headers: { 'Content-Type': 'application/octet-stream' } }); break; }
      catch (e) { if (attempt >= 2 || (e as ApiError).status === 400) throw e; await new Promise((r) => setTimeout(r, 800)); }
    }
    onProgress((i + 1) / n);
  }
  return api(`/uploads/${uploadId}/complete`, { method: 'POST' });
}

export const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
export const fmtDate = (d: string) => new Date(d).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
