// 휴대폰 알림(웹 푸시) — Play 스토어 앱(TWA)과 크롬에서 동작한다.
import { DEMO } from './api.js';

export const pushSupported = () => !DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => (pushSupported() ? Notification.permission : 'unsupported');

export function registerSW(onOpen) {
  if (!pushSupported()) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open' && e.data.view) onOpen(e.data.view); });
}

const toKey = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// 권한을 묻고 구독을 만든 뒤 서버에 보낼 구독 정보를 돌려준다.
export async function enablePush(key) {
  if (!pushSupported()) throw new Error('이 기기에서는 휴대폰 알림을 쓸 수 없습니다. Play 스토어에서 설치한 이음챗 앱에서 켜 주세요.');
  if (!key) throw new Error('서버에 알림 설정이 아직 되어 있지 않습니다.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? '휴대폰 설정에서 이음챗 알림이 막혀 있습니다. 설정 > 애플리케이션 > 이음챗 > 알림에서 허용해 주세요.'
      : '알림 권한을 허용하지 않았습니다.');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) }));
  return sub.toJSON();
}

export async function disablePush() {
  if (!pushSupported()) return '';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return '';
  const { endpoint } = sub; await sub.unsubscribe().catch(() => {});
  return endpoint;
}

// 이미 허용된 기기면 구독을 조용히 다시 보낸다(구독 주소가 바뀌는 경우 대비).
export async function currentSub() {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? sub.toJSON() : null;
}
