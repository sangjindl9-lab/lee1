// 이음챗 서비스워커: 휴대폰 알림 표시와 알림을 눌렀을 때 해당 화면 열기만 담당한다(캐시하지 않음).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '이음챗', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { view: d.view || null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const view = e.notification.data?.view;
  const url = view ? `/?open=${encodeURIComponent(`${view.type}:${view.id}`)}` : '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { c.postMessage({ type: 'open', view }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
