// 휴대폰 파일 열기·저장·공유. 안드로이드에서는 EumFiles 플러그인, 브라우저(테스트)에서는 <input type=file>/다운로드.
import { t } from './i18n.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
const native = isNative ? registerPlugin('EumFiles') : null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 브라우저 테스트용: 고른 File 을 가짜 uri 로 기억한다.
const browserFiles = new Map();

/** 파일 고르기 → { uri, name } (취소하면 null) */
export async function pickOpen(mime = '*/*') {
  if (native) {
    const r = await native.pickOpen({ mime });
    return r && r.uri ? r : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (mime !== '*/*') input.accept = mime;
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      const uri = 'browser:' + Date.now() + ':' + f.name;
      browserFiles.set(uri, f);
      resolve({ uri, name: f.name });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** 파일 내용 읽기 → Uint8Array */
export async function readFile(uri) {
  if (native) {
    const r = await native.read({ uri });
    return b64ToBytes(r.data);
  }
  const f = browserFiles.get(uri);
  if (!f) throw new Error(t('파일을 다시 열어 주세요.'));
  return new Uint8Array(await f.arrayBuffer());
}

/** 같은 위치에 덮어쓰기 */
export async function writeFile(uri, bytes, name) {
  if (native) return native.write({ uri, data: bytesToB64(bytes) });
  download(bytes, name || t('문서.pdf'));
}

/** 저장 위치 고르기 → { uri, name } (취소하면 null) */
export async function pickSave(name, mime = 'application/pdf') {
  if (native) {
    const r = await native.pickSave({ name, mime });
    if (!r || !r.uri) return null;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    return { uri: r.uri, name: r.name && r.name.toLowerCase().endsWith(ext) ? r.name : name };
  }
  const uri = 'browser:save:' + name;
  browserFiles.set(uri, null);
  return { uri, name };
}

export async function share(uri, name) {
  if (native) return native.share({ uri, name });
  alert(t('브라우저에서는 공유할 수 없습니다. 안드로이드 앱에서 사용하세요.'));
}

/** 다른 앱에서 "이음뷰어로 열기"로 넘어온 파일을 받는다. */
export function onLaunch(cb) {
  if (!native) return;
  window.addEventListener('eumLaunch', (e) => {
    const f = typeof e.detail === 'string' ? JSON.parse(e.detail) : (e.detail || e);
    if (f && f.uri) cb(f);
  });
  native.getLaunch().then((f) => { if (f && f.uri) cb(f); }).catch(() => {});
}

export function onBack(cb) {
  window.addEventListener('eumBack', cb);
}

export function exitApp() {
  if (native) native.exit();
}

function download(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ── 최근 문서 ──
const RECENT_KEY = 'eumviewer.recents';
export function recents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function saveRecents(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* 저장 공간 없음 */ }
}
export function remember(uri, name) {
  if (uri.startsWith('browser:')) return;
  saveRecents([{ uri, name, t: Date.now() }, ...recents().filter((r) => r.uri !== uri)]);
}
export function forget(uri) {
  saveRecents(recents().filter((r) => r.uri !== uri));
}
