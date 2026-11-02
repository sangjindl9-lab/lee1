import { h, clear, state, GET, POST, PUT, api, toast, modal, formFields, fmt, today, resultTag, reviewTag, statusTag, catLabel, perm, table, download, siteUrl } from './ui.js';
import { renderCard, openAssetForm, showTrace } from './card.js';
import { viewerPage } from './viewer.js';
import * as pages from './pages.js';
import { mobileAsset } from './mobile.js';

const app = document.getElementById('app');

const NAV = [
  ['dashboard', '현장 대시보드'], ['drawings', '도면 관리'], ['viewer', '도면 뷰어'], ['assets', '전체 설비 목록'], null,
  ['power', '전력케이블'], ['fiber', '광케이블·코어·접속'], ['lan', 'LAN·랙·포트'], ['cctv', 'CCTV'], null,
  ['live', '실시간 상태'], ['measurements', '측정·성적서'], ['worklogs', '작업·보수 이력'], ['issues', '누락·부적합·만료'], ['outputs', '출력·엑셀'], null,
  ['settings', '사용자·권한·시험기준'],
];

async function boot() {
  try {
    state.me = await api('GET', '/api/me', undefined, { noRedirect: true });
    state.meta = await GET('/api/meta');
    try { localStorage.setItem('ch-session', JSON.stringify({ me: state.me, meta: state.meta })); } catch {}
  } catch (e) {
    state.me = null;
    // 통신이 끊긴 경우: 마지막 로그인 정보로 화면만 열고(오프라인 모드), 저장은 단말 대기열로
    if (e.status === 0) { try { const c = JSON.parse(localStorage.getItem('ch-session')); if (c) { state.me = c.me; state.meta = c.meta; state.offline = true; } } catch {} }
    else { try { localStorage.removeItem('ch-session'); } catch {} }
  }
  window.addEventListener('hashchange', route);
  route();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
}

async function route() {
  const { parts, query } = parseHash();
  if (parts[0] === 'login' || !state.me) return loginPage(query.get('next'));
  if (parts[0] === 'm' && parts[1] === 'asset') return mobileShell(Number(parts[2]));
  if (parts[0] !== 's') {
    const s = state.me.sites[0];
    if (!s) return clear(app, topbar(), h('div', { class: 'main' }, h('div', { class: 'box' }, '접근 가능한 현장이 없습니다. 관리자에게 현장 권한을 요청하세요.', state.me.user.role === 'admin' ? [' ', h('a', { href: '#/s/0/settings' }, '설정')] : null)));
    location.hash = `#/s/${s.id}/dashboard`; return;
  }
  const sid = Number(parts[1]);
  state.site = state.me.sites.find(s => s.id === sid) || (state.me.user.role === 'admin' && sid === 0 ? { id: 0, name: '(현장 없음)', perm: {} } : null);
  if (!state.site) { toast('이 현장에 접근할 권한이 없습니다.', true); location.hash = '#/'; return; }
  const view = parts[2] || 'dashboard';
  const main = h('div', { class: 'main' });
  const nav = h('div', { class: 'nav' }, NAV.map(n => n ? h('a', { href: siteUrl(n[0]), class: (view === n[0] || (view === 'asset' && n[0] === 'assets')) ? 'on' : '', onclick: () => nav.classList.remove('open') }, n[1]) : h('div', { class: 'sep' })));
  clear(app, topbar(nav), h('div', { class: 'layout' }, nav, main));
  if (state.site.is_demo && view !== 'viewer') main.appendChild(h('div', { class: 'demo-flag' }, '시연용 데이터 현장입니다. 실제 현장 데이터와 구분되어 있으며 출력물에도 "시연용"으로 표시됩니다.'));
  const body = h('div');
  main.appendChild(body);
  try {
    switch (view) {
      case 'dashboard': return await pages.dashboard(body);
      case 'drawings': return await pages.drawings(body);
      case 'viewer': return await viewerPage(main, parts[3] ? Number(parts[3]) : null, query);
      case 'assets': return await pages.assetList(body, { query });
      case 'asset': return await assetDetail(body, Number(parts[3]));
      case 'power': return await pages.assetList(body, { category: 'power_cable', query });
      case 'fiber': return await pages.fiber(body, query);
      case 'lan': return await pages.lan(body, query);
      case 'cctv': return await pages.assetList(body, { category: 'cctv', query });
      case 'measurements': return await pages.measurements(body);
      case 'live': return await pages.live(body);
      case 'worklogs': return await pages.worklogs(body);
      case 'issues': return await pages.issues(body, query);
      case 'outputs': return await pages.outputs(body);
      case 'settings': return await pages.settings(body);
      default: clear(body, '없는 화면입니다.');
    }
  } catch (e) { console.error(e); clear(main, h('div', { class: 'box err' }, e.message)); }
}

function topbar(nav) {
  const sel = h('select', { onchange: (e) => { const v = parseHash(); v.parts[1] = e.target.value; location.hash = '#/' + v.parts.slice(0, 3).join('/'); } },
    state.me.sites.map(s => h('option', { value: s.id, selected: s.id === state.site?.id }, `${s.name}`)));
  return h('div', { class: 'topbar' },
    nav ? h('button', { class: 'menu-btn sm', onclick: () => nav.classList.toggle('open') }, '메뉴') : null,
    h('div', { class: 'brand' }, '회로·케이블 이력관리'),
    state.me.sites.length ? sel : null,
    h('div', { class: 'sp' }),
    h('div', { class: 'user' }, `${state.me.user.name} (${{ admin: '관리자', site_manager: '현장관리자', worker: '작업자', viewer: '조회자' }[state.me.user.role]})`),
    h('button', { class: 'sm', onclick: async () => { await POST('/api/logout'); state.me = null; try { localStorage.removeItem('ch-session'); } catch {} location.hash = '#/login'; } }, '로그아웃'));
}

function loginPage(next) {
  const u = h('input', { type: 'text', autocomplete: 'username' });
  const p = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' });
  const submit = async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      await api('POST', '/api/login', { username: u.value, password: p.value }, { noRedirect: true });
      state.me = await GET('/api/me'); state.meta = await GET('/api/meta');
      try { localStorage.setItem('ch-session', JSON.stringify({ me: state.me, meta: state.meta })); } catch {}
      if (next && next.startsWith('/q/')) { location.href = next; return; }
      location.hash = next && next !== 'login' ? '#' + next : '#/';
    } catch (er) { err.textContent = er.message; }
  };
  clear(app, h('form', { class: 'login', onsubmit: submit },
    h('h1', null, '회로·케이블 이력관리'), h('div', { class: 'muted small' }, '전기·정보통신 설비 시공·유지보수 이력'),
    h('label', { class: 'field' }, '아이디', u), h('label', { class: 'field' }, '비밀번호', p), err,
    h('button', { class: 'primary', type: 'submit' }, '로그인')));
  u.focus();
}

async function assetDetail(body, id) {
  const box = h('div', { class: 'box' });
  clear(body, h('div', { class: 'pagehead' }, h('a', { href: 'javascript:history.back()' }, '← 목록으로')), box);
  await renderCard(box, id, {});
}

async function mobileShell(id) {
  const main = h('div', { class: 'main mobile' });
  clear(app, h('div', { class: 'topbar' }, h('div', { class: 'brand' }, '설비 이력'), h('div', { class: 'sp' }), h('a', { href: '#/', style: { color: '#fff', fontSize: '13px' } }, 'PC 화면')), main);
  await mobileAsset(main, id);
}

boot();
export { route };
