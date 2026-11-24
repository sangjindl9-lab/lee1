import { invoke } from '@tauri-apps/api/core';

export const SERVER = 'https://fm2.ieumerp.kr';
export const WS_URL = SERVER.replace('https://', 'wss://') + '/ws';
export const APP_VERSION = '0.3.0';

export class ApiError extends Error { constructor(public code: string, msg: string, public status = 0) { super(msg); } }

// 로그인 토큰은 Windows 자격 증명 관리자에 보관하고, 실행 중에는 메모리에만 둡니다.
let memToken: string | null = null;
export async function initSession() {
  try { memToken = (await invoke<string | null>('secret_get', { key: 'session' })) ?? null; } catch { memToken = null; }
  const legacy = localStorage.getItem('fm2.token');
  if (legacy) {
    if (!memToken) { memToken = legacy; try { await invoke('secret_set', { key: 'session', value: legacy }); } catch { /* */ } }
    localStorage.removeItem('fm2.token');
  }
}
const LS = {
  get token() { return memToken; },
  set token(v: string | null) {
    memToken = v;
    (v ? invoke('secret_set', { key: 'session', value: v }) : invoke('secret_del', { key: 'session' })).catch(() => {});
  },
  get email() { return localStorage.getItem('fm2.email'); },
  set email(v: string | null) { v ? localStorage.setItem('fm2.email', v) : localStorage.removeItem('fm2.email'); },
  get installId() {
    let v = localStorage.getItem('fm2.install');
    if (!v) { v = 'pc-' + crypto.randomUUID(); localStorage.setItem('fm2.install', v); }
    return v;
  },
};
export const session = LS;

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(f: () => void) { onUnauthorized = f; }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(SERVER + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(LS.token ? { Authorization: 'Bearer ' + LS.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요');
  }
  const text = await r.text();
  let j: any = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  if (!r.ok) {
    if (r.status === 401 && LS.token) { LS.token = null; onUnauthorized(); }
    throw new ApiError(j.error || 'http_' + r.status, j.message || `요청 실패 (${r.status})`, r.status);
  }
  return j as T;
}

export type SysInfo = { name: string; os: string; downloads: string };
export const sysInfo = () => invoke<SysInfo>('sys_info');

export async function login(email: string, password: string) {
  const si = await sysInfo();
  const j = await api<{ token: string; user: { email: string } }>('POST', '/api/auth/login', {
    email, password, device: { kind: 'pc', name: si.name, model: 'Windows PC', platform: si.os, appVersion: APP_VERSION, installId: LS.installId },
  });
  LS.token = j.token; LS.email = j.user.email;
  return j;
}
export async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* */ }
  LS.token = null;
}

export type Perm = { id: string; androidId: string; pcId: string; status: string; folders: string[]; readOnly: boolean; androidName: string; pcName: string; androidOnline: boolean; pcOnline: boolean };
export type Device = { id: string; kind: 'pc' | 'android'; name: string; model: string; platform: string; app_version: string; last_seen: string | null; online: boolean; self: boolean };
export type RItem = { name: string; path: string; dir: boolean; size: number; mtime: number; count?: number };

export function fmtSize(n: number) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) return '-';
  if (sec < 60) return Math.ceil(sec) + '초';
  if (sec < 3600) return Math.floor(sec / 60) + '분 ' + Math.ceil(sec % 60) + '초';
  return Math.floor(sec / 3600) + '시간 ' + Math.floor((sec % 3600) / 60) + '분';
}
