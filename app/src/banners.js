// 홈 화면 배너 광고. 서버(ads/)에서 켜 둔 배너가 있을 때만 자리가 보인다. 서버가 안 되면 조용히 숨긴다.
import { t } from './i18n.js';
import { el } from './ui.js';

export const ADS_URL = 'https://ads-production-a599.up.railway.app';
const APP_ID = 'eum-viewer';
const CACHE_KEY = 'eumviewer.banners';
const CACHE_MS = 10 * 60 * 1000;
const shown = new Set();

async function fetchBanners() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.t < CACHE_MS) return c.list;
  } catch { /* 무시 */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${ADS_URL}/api/banners?app=${APP_ID}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list }));
    return list;
  } catch { return []; } finally { clearTimeout(timer); }
}

function hit(id, kind) {
  fetch(`${ADS_URL}/api/banners/${id}/${kind}`, { method: 'POST', keepalive: true }).catch(() => {});
}

/** slots: { top: HTMLElement, bottom: HTMLElement } — 각 자리에 첫 번째 배너를 넣는다. */
export async function renderBanners(slots) {
  const list = await fetchBanners();
  for (const slot of Object.keys(slots)) {
    const host = slots[slot];
    host.innerHTML = '';
    const b = list.find((x) => x.slot === slot);
    host.hidden = !b;
    if (!b) continue;
    const a = el('a', 'banner');
    a.href = b.link || '#';
    a.target = '_blank';
    a.rel = 'noopener';
    if (b.bg) a.style.background = b.bg;
    const img = el('img');
    img.src = ADS_URL + b.image;
    img.alt = b.title || t('광고');
    img.loading = 'lazy';
    a.appendChild(img);
    a.appendChild(el('span', 'ad-tag', t('광고')));
    a.onclick = (e) => { hit(b.id, 'click'); if (!b.link) e.preventDefault(); };
    host.appendChild(a);
    if (!shown.has(b.id)) { shown.add(b.id); hit(b.id, 'imp'); }
  }
}
