// 오프라인에서도 화면이 열리도록 화면 파일만 보관 (API 응답·첨부파일은 보관하지 않음)
const CACHE = 'cable-history-shell-v2';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/card.js', '/js/pages.js', '/js/viewer.js', '/js/mobile.js', '/js/offline.js', '/js/otdr.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/q/') || u.pathname.startsWith('/vendor/')) return;
  // 네트워크 우선, 실패 시 보관본
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
