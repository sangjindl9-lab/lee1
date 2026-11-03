// 현장뷰 웹 앱
import { VideoRTC } from '/go2rtc/video-rtc.js';

// ── 영상 플레이어 (go2rtc VideoRTC 확장) ───────────────────
class SvVideo extends VideoRTC {
  constructor() {
    super();
    this.mode = 'mse,hls,mjpeg';
    this.media = 'video,audio';
    this.visibilityCheck = false;
  }
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.addEventListener('playing', () => this.dispatchEvent(new Event('sv-playing')));
  }
  onmjpeg() {
    super.onmjpeg();
    this.dispatchEvent(new Event('sv-playing'));
  }
  stop() {
    this.wsURL = '';
    if (this.reconnectTID) { clearTimeout(this.reconnectTID); this.reconnectTID = 0; }
    this.ondisconnect();
  }
}
customElements.define('sv-video', SvVideo);

// ── 공통 도우미 ───────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const today = () => localIso(new Date()).slice(0, 10);
const parseLocal = (s) => new Date(s.length === 10 ? `${s}T00:00:00` : s);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  ptz: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  hd: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M10 10v4M7 12h3M13 10v4h2a2 2 0 0 0 0-4z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10zM17 10l4 4M21 10l-4 4"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  live: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/></svg>',
  arrow: (deg) => `<svg viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path d="M12 5v14M6 11l6-6 6 6"/></svg>`,
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/login')) { showLogin(); throw new Error('로그인이 필요합니다'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `오류 ${res.status}`);
  return data;
}

function toast(msg, { type = '', html = null, onClick = null, ms = 3500 } = {}) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = html || esc(msg);
  if (onClick) t.onclick = () => { onClick(); t.remove(); };
  $('#toasts').prepend(t);
  setTimeout(() => t.remove(), ms);
}
const fail = (e) => toast(e.message || String(e), { type: 'err' });

function openSheet(html, onMount) {
  $('#sheet').innerHTML = html;
  $('#modal').hidden = false;
  onMount?.($('#sheet'));
}
function closeSheet() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeSheet();
});
const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close>${ICON.x}</button></div>`;

// ── 상태 ────────────────────────────────────────────
const state = {
  config: {},
  user: null,
  devices: [],
  tab: null,
  unread: 0,
};
const devById = (id) => state.devices.find((d) => d.id === id);
const chanOf = (devId, ch) => devById(devId)?.channels.find((c) => c.no === ch);
const chanLabel = (devId, ch) => {
  const d = devById(devId);
  const c = chanOf(devId, ch);
  return d ? `${c?.name || `채널 ${ch}`}` : '(삭제된 장비)';
};
const isOnline = (d) => d.status?.online !== false;

async function loadDevices() {
  state.devices = await api('/api/devices');
  return state.devices;
}

// ── 로그인 / 시작 ────────────────────────────────────
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#demoHint').hidden = !state.config.demo;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#loginError').textContent = '';
  try {
    state.user = await api('/api/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    await start();
  } catch (err) { $('#loginError').textContent = err.message; }
});

async function boot() {
  state.config = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  try {
    state.user = await api('/api/me');
    await start();
  } catch { showLogin(); }
}

async function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  await loadDevices().catch(fail);
  connectEvents();
  refreshUnread();
  go(location.hash.slice(1) || 'devices');
}

// ── 탭 이동 ───────────────────────────────────────────
const pages = {};
function go(tab) {
  if (!pages[tab]) tab = 'devices';
  if (state.tab && state.tab !== tab) pages[state.tab].hide?.();
  state.tab = tab;
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${tab}`));
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  pages[tab].show();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

// ═════════════════ 장비 ═════════════════
pages.devices = {
  el: $('#page-devices'),
  async show() {
    this.render();
    await loadDevices().catch(fail);
    this.render();
  },
  render() {
    const list = state.devices;
    this.el.innerHTML = `
      <div class="topbar"><h1>장비</h1><button class="btn primary sm" data-act="add">${ICON.plus}장비 추가</button></div>
      <div class="wrap">
        ${list.length ? list.map((d) => `
          <div class="dev-card" data-dev="${d.id}">
            <div class="dev-head">
              <span class="dot ${d.status ? (isOnline(d) ? 'on' : 'off') : ''}"></span>
              <div class="meta"><b>${esc(d.name)}</b>
                <small>${esc(d.model || d.kind || '')} · ${d.host === 'demo' ? '데모 장비' : esc(d.host)} · ${d.channels.length}채널${d.status && !isOnline(d) ? ` · <span style="color:var(--bad)">오프라인</span>` : ''}</small></div>
              <button class="icon-btn" data-act="menu">${ICON.more}</button>
            </div>
            <div class="chan-grid">
              ${d.channels.map((c) => `
                <button class="chan" data-act="open" data-ch="${c.no}">
                  ${isOnline(d) ? `<img loading="lazy" alt="" src="/api/snapshot/${d.id}/${c.no}?sub=1&t=${Math.floor(Date.now() / 60000)}" onerror="this.remove()">` : ''}
                  <div class="play">${ICON.play}</div>
                  <span><i class="dot ${c.online === false ? 'off' : 'on'}"></i>${esc(c.name)}</span>
                </button>`).join('')}
            </div>
            <div class="dev-actions">
              <button class="btn sm" data-act="liveall">${ICON.live}전체 실시간</button>
              <button class="btn sm" data-act="playback">${ICON.clock}녹화 재생</button>
              <button class="btn sm" data-act="info">정보·설정</button>
            </div>
          </div>`).join('') : `
          <div class="empty"><b>등록된 장비가 없습니다</b>NVR·DVR·IP카메라의 IP 주소와 계정을 입력해 추가하세요.<br><br>
            <button class="btn primary" data-act="add">${ICON.plus}장비 추가</button></div>`}
      </div>`;
  },
};
pages.devices.el.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const devId = Number(b.closest('[data-dev]')?.dataset.dev);
  const act = b.dataset.act;
  if (act === 'add') deviceForm();
  if (act === 'open') { live.showChannels([{ devId, ch: Number(b.dataset.ch) }]); }
  if (act === 'liveall') { live.showChannels(devById(devId).channels.map((c) => ({ devId, ch: c.no }))); }
  if (act === 'playback') { playback.open(devId, devById(devId).channels[0]?.no || 1); }
  if (act === 'info' || act === 'menu') deviceInfo(devId);
});

function deviceForm(dev = null) {
  openSheet(`${sheetHead(dev ? '장비 수정' : '장비 추가')}
    <form class="form" id="devForm">
      ${dev ? '' : `<button type="button" class="btn block" id="scanBtn">같은 네트워크에서 장비 찾기</button><div class="found" id="found"></div>`}
      <label>장비 이름<input name="name" placeholder="예: 1공구 현장 NVR" value="${esc(dev?.name || '')}"></label>
      <label>IP 주소 또는 도메인<input name="host" required placeholder="예: 192.168.0.64" value="${esc(dev?.host || '')}" autocapitalize="off"></label>
      <div class="two">
        <label>HTTP 포트<input name="httpPort" type="number" value="${dev?.httpPort || 80}"></label>
        <label>RTSP 포트<input name="rtspPort" type="number" value="${dev?.rtspPort || 554}"></label>
      </div>
      <div class="two">
        <label>장비 아이디<input name="username" value="${esc(dev?.username || 'admin')}" autocapitalize="off"></label>
        <label>장비 비밀번호<input name="password" type="password" ${dev ? 'placeholder="바꿀 때만 입력"' : 'required'}></label>
      </div>
      <label class="check"><input type="checkbox" name="https" ${dev?.https ? 'checked' : ''}> HTTPS로 접속</label>
      <p class="muted" style="margin:0;font-size:13px">장비 웹페이지에 접속하는 계정과 같습니다. 외부에서 접속하려면 공유기에서 HTTP·RTSP 포트를 포워딩하세요.</p>
      <p class="form-error" id="devErr"></p>
      <button class="btn primary block" type="submit">${dev ? '저장' : '연결하고 추가'}</button>
    </form>`, (sheet) => {
    const form = $('#devForm', sheet);
    $('#scanBtn', sheet)?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '찾는 중… (3초)';
      try {
        const list = await api('/api/discover');
        $('#found', sheet).innerHTML = list.length ? list.map((d) => `
          <button type="button" data-ip="${esc(d.ip)}" data-port="${d.httpPort}"><span><b>${esc(d.ip)}</b><br><small class="muted">${esc(d.model)} ${esc(d.serial.slice(-9))}</small></span><small class="muted">${d.activated ? '' : '미활성'}</small></button>`).join('')
          : '<p class="muted" style="margin:0">찾은 장비가 없습니다. 서버와 장비가 같은 네트워크인지 확인하세요.</p>';
      } catch (err) { fail(err); }
      e.target.disabled = false; e.target.textContent = '다시 찾기';
    });
    $('#found', sheet)?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ip]');
      if (!b) return;
      form.host.value = b.dataset.ip;
      form.httpPort.value = b.dataset.port;
      form.password.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      f.https = !!f.https;
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = '장비에 연결 중…';
      $('#devErr', sheet).textContent = '';
      try {
        const saved = await api(dev ? `/api/devices/${dev.id}` : '/api/devices', { method: dev ? 'PUT' : 'POST', body: f });
        closeSheet();
        toast(`${saved.name} — ${saved.channels.length}개 채널을 불러왔습니다`);
        await loadDevices();
        if (state.tab === 'devices') pages.devices.render();
      } catch (err) {
        $('#devErr', sheet).textContent = err.message;
        btn.disabled = false; btn.textContent = dev ? '저장' : '연결하고 추가';
      }
    });
  });
}

async function deviceInfo(devId) {
  const d = devById(devId);
  openSheet(`${sheetHead(d.name)}<div id="infoBody"><div class="empty"><div class="spinner" style="margin:auto"></div></div></div>`);
  let st = null;
  try { st = await api(`/api/devices/${devId}/status`); } catch (e) { st = { error: e.message }; }
  const body = $('#infoBody');
  if (!body) return;
  const gb = (mb) => `${(mb / 1024).toFixed(0)}GB`;
  body.innerHTML = `
    ${st.error ? `<p class="form-error">${esc(st.error)}</p>` : ''}
    <dl class="kv">
      <dt>상태</dt><dd>${isOnline(d) ? '<span style="color:var(--ok)">온라인</span>' : '<span style="color:var(--bad)">오프라인</span>'}</dd>
      <dt>모델</dt><dd>${esc(d.model)}</dd>
      <dt>종류</dt><dd>${esc(d.kind)}</dd>
      <dt>주소</dt><dd>${d.host === 'demo' ? '데모 장비' : `${esc(d.host)} (HTTP ${d.httpPort} / RTSP ${d.rtspPort})`}</dd>
      <dt>시리얼</dt><dd>${esc(d.serial)}</dd>
      <dt>펌웨어</dt><dd>${esc(d.firmware)}</dd>
      <dt>MAC</dt><dd>${esc(d.mac)}</dd>
      ${st.time ? `<dt>장비 시각</dt><dd>${esc(String(st.time.localTime).replace('T', ' ').slice(0, 19))}</dd>` : ''}
    </dl>
    ${st.hdds?.length ? `<div class="section-title">저장장치</div><div class="list">${st.hdds.map((h) => `
      <div style="display:block"><div style="display:flex;justify-content:space-between"><span>${esc(h.name)} <small>${esc(h.status)}</small></span>
      <small>${gb(h.capacityMB - h.freeMB)} / ${gb(h.capacityMB)}</small></div>
      <div class="bar"><i style="width:${h.capacityMB ? Math.round((1 - h.freeMB / h.capacityMB) * 100) : 0}%"></i></div></div>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:-8px 0 0">덮어쓰기 녹화 중이면 사용량이 100%로 보이는 것이 정상입니다.</p>` : ''}
    <div class="section-title">채널 (이름을 눌러 변경)</div>
    <div class="list">${d.channels.map((c) => `
      <button data-rename="${c.no}"><i class="dot ${c.online === false ? 'off' : 'on'}"></i><span class="grow">${esc(c.name)}</span><small>CH${c.no}${c.ip ? ` · ${esc(c.ip)}` : ''}</small></button>`).join('')}</div>
    <div class="form">
      <button class="btn block" data-a="edit">접속 정보 수정</button>
      <button class="btn block" data-a="refresh">채널 다시 불러오기</button>
      <button class="btn block" data-a="reboot">장비 재부팅</button>
      <button class="btn block danger" data-a="delete">장비 삭제</button>
    </div>`;
  body.onclick = async (e) => {
    const r = e.target.closest('[data-rename]');
    if (r) {
      const ch = Number(r.dataset.rename);
      const name = prompt('채널 이름', chanOf(devId, ch)?.name || '');
      if (name == null || !name.trim()) return;
      try { await api(`/api/devices/${devId}/channels/${ch}`, { method: 'PUT', body: { name } }); await loadDevices(); deviceInfo(devId); } catch (err) { fail(err); }
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    try {
      if (a === 'edit') deviceForm(d);
      if (a === 'refresh') { toast('채널을 다시 불러오는 중…'); await api(`/api/devices/${devId}`, { method: 'PUT', body: {} }); await loadDevices(); deviceInfo(devId); toast('완료'); }
      if (a === 'reboot' && confirm(`${d.name}을(를) 재부팅할까요? 1~2분간 영상이 끊깁니다.`)) { await api(`/api/devices/${devId}/reboot`, { method: 'POST' }); toast('재부팅 명령을 보냈습니다'); }
      if (a === 'delete' && confirm(`${d.name}을(를) 삭제할까요?`)) {
        await api(`/api/devices/${devId}`, { method: 'DELETE' });
        closeSheet(); live.removeDevice(devId); await loadDevices(); pages.devices.render();
      }
    } catch (err) { fail(err); }
  };
}

// ═════════════════ 실시간 ═════════════════
const LAYOUTS = [1, 4, 9, 16];
const live = {
  el: $('#page-live'),
  layout: store.get('sv.layout', 4),
  tiles: store.get('sv.tiles', []),
  sel: 0,
  zoom: null,        // 한 화면 크게 보기 중인 타일 번호
  quality: store.get('sv.quality', 'auto'), // auto | main | sub
  ptzOpen: false,
  sound: false,
  players: new Map(), // 타일번호 -> { key, el }
  built: false,

  save() { store.set('sv.layout', this.layout); store.set('sv.tiles', this.tiles); store.set('sv.quality', this.quality); },
  useSub() { return this.quality === 'sub' || (this.quality === 'auto' && this.layout > 1 && this.zoom == null); },

  build() {
    this.el.classList.add('fill');
    this.el.innerHTML = `
      <div class="live-bar">
        <div class="seg" id="layoutSeg">${LAYOUTS.map((n) => `<button data-layout="${n}">${n}</button>`).join('')}</div>
        <div class="grow"></div>
        <button class="btn sm" data-a="pick">${ICON.list}채널 선택</button>
      </div>
      <div class="stage" id="stage"><div class="grid" id="grid"></div></div>
      <div class="ptz" id="ptz" hidden></div>
      <div class="controls">
        <button class="icon-btn" data-a="quality" title="화질">${ICON.hd}</button>
        <button class="icon-btn" data-a="sound" title="소리">${ICON.mute}</button>
        <button class="icon-btn" data-a="snap" title="스냅샷 저장">${ICON.cam}</button>
        <button class="icon-btn" data-a="ptz" title="PTZ 제어">${ICON.ptz}</button>
        <button class="icon-btn" data-a="playback" title="녹화 재생">${ICON.clock}</button>
        <button class="icon-btn" data-a="full" title="전체화면">${ICON.full}</button>
      </div>`;
    this.el.addEventListener('click', (e) => this.onClick(e));
    $('#grid', this.el).addEventListener('dblclick', (e) => {
      const t = e.target.closest('.tile');
      if (t) this.toggleZoom(Number(t.dataset.i));
    });
    this.built = true;
  },

  show() {
    if (!this.built) this.build();
    // 삭제된 장비 채널 정리
    this.tiles = this.tiles.map((t) => (t && chanOf(t.devId, t.ch) ? t : null));
    this.renderGrid();
    this.renderPtz();
  },
  hide() {
    for (const p of this.players.values()) p.el.querySelector('sv-video')?.stop();
    this.players.clear();
    $('#grid', this.el).innerHTML = '';
  },

  showChannels(list) {
    const n = list.length;
    this.layout = n <= 1 ? 1 : n <= 4 ? 4 : n <= 9 ? 9 : 16;
    this.tiles = list.slice(0, 16);
    this.sel = 0;
    this.zoom = null;
    this.save();
    if (state.tab === 'live') { this.hide(); this.renderGrid(); } else go('live');
  },
  removeDevice(devId) {
    this.tiles = this.tiles.map((t) => (t?.devId === devId ? null : t));
    this.save();
  },

  renderGrid() {
    const grid = $('#grid', this.el);
    const count = this.zoom != null ? 1 : this.layout;
    const cols = Math.sqrt(count);
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${cols}, 1fr)`;
    $$('#layoutSeg button', this.el).forEach((b) => b.classList.toggle('on', Number(b.dataset.layout) === this.layout && this.zoom == null));
    $('[data-a=quality]', this.el).classList.toggle('on', this.quality === 'main');

    const idx = this.zoom != null ? [this.zoom] : [...Array(this.layout).keys()];
    const sub = this.useSub();
    // 필요 없는 플레이어 정리
    for (const [i, p] of this.players) {
      const t = this.tiles[i];
      const key = t ? `${t.devId}:${t.ch}:${sub}` : null;
      if (!idx.includes(i) || p.key !== key) { p.el.querySelector('sv-video')?.stop(); this.players.delete(i); }
    }
    grid.innerHTML = '';
    for (const i of idx) {
      const t = this.tiles[i];
      let p = this.players.get(i);
      if (!p) {
        const el = document.createElement('div');
        el.className = 'tile';
        el.dataset.i = i;
        p = { key: t ? `${t.devId}:${t.ch}:${sub}` : null, el };
        if (t) this.startTile(el, t, sub);
        else el.innerHTML = `<button class="add" data-a="pick">${ICON.plus}</button>`;
        this.players.set(i, p);
      }
      p.el.classList.toggle('sel', i === this.sel);
      grid.appendChild(p.el);
    }
  },

  async startTile(el, t, sub) {
    const d = devById(t.devId);
    el.innerHTML = `<sv-video></sv-video><div class="lbl">${esc(chanLabel(t.devId, t.ch))}</div>
      <div class="state"><div class="spinner"></div></div><button class="x" data-a="close">${ICON.x}</button>`;
    const v = $('sv-video', el);
    const stateEl = $('.state', el);
    if (!d || !isOnline(d)) { stateEl.innerHTML = '장비 오프라인'; return; }
    const timer = setTimeout(() => { stateEl.innerHTML = '영상 연결 지연<br><small>RTSP 포트·네트워크를 확인하세요</small>'; }, 15000);
    v.addEventListener('sv-playing', () => { clearTimeout(timer); stateEl.innerHTML = ''; if (this.sound && v.video) v.video.muted = false; });
    try {
      const r = await api(`/api/live/${t.devId}/${t.ch}`, { method: 'POST', body: { sub } });
      if (!el.isConnected && !this.players.size) return;
      v.src = r.ws;
    } catch (e) { clearTimeout(timer); stateEl.textContent = e.message; }
  },

  selectTile(i) {
    this.sel = i;
    $$('.tile', this.el).forEach((t) => t.classList.toggle('sel', Number(t.dataset.i) === i));
    this.renderPtz();
  },

  toggleZoom(i) {
    this.zoom = this.zoom == null && this.layout > 1 ? i : null;
    this.sel = i;
    this.renderGrid();
  },

  assign(devId, ch) {
    this.tiles[this.sel] = { devId, ch };
    this.save();
    const p = this.players.get(this.sel);
    if (p) { p.el.querySelector('sv-video')?.stop(); this.players.delete(this.sel); }
    // 다음 빈 칸으로 선택 이동
    const next = [...Array(this.layout).keys()].find((i) => i > this.sel && !this.tiles[i]);
    if (next != null) this.sel = next;
    this.renderGrid();
    this.renderPtz();
  },

  onClick(e) {
    const tile = e.target.closest('.tile');
    const a = e.target.closest('[data-a]')?.dataset.a;
    const lay = e.target.closest('[data-layout]');
    if (lay) {
      this.layout = Number(lay.dataset.layout);
      this.zoom = null;
      if (this.sel >= this.layout) this.sel = 0;
      this.save();
      this.renderGrid();
      return;
    }
    if (tile && !a) { this.selectTile(Number(tile.dataset.i)); return; }
    if (tile && a === 'pick') this.sel = Number(tile.dataset.i);
    if (a === 'close' && tile) {
      const i = Number(tile.dataset.i);
      this.players.get(i)?.el.querySelector('sv-video')?.stop();
      this.players.delete(i);
      this.tiles[i] = null;
      if (this.zoom === i) this.zoom = null;
      this.save();
      this.renderGrid();
      this.renderPtz();
      return;
    }
    const cur = this.tiles[this.sel];
    if (a === 'pick') channelPicker((devId, ch) => this.assign(devId, ch), (list) => this.showChannels(list));
    if (a === 'quality') {
      this.quality = this.quality === 'main' ? 'auto' : 'main';
      toast(this.quality === 'main' ? '고화질(메인 스트림)' : '자동 화질 (분할 화면은 저화질)');
      this.save();
      this.renderGrid();
    }
    if (a === 'sound') {
      this.sound = !this.sound;
      e.target.closest('button').innerHTML = this.sound ? ICON.sound : ICON.mute;
      e.target.closest('button').classList.toggle('on', this.sound);
      for (const [i, p] of this.players) {
        const v = p.el.querySelector('sv-video')?.video;
        if (v) v.muted = !this.sound || i !== this.sel;
      }
    }
    if (a === 'snap') {
      if (!cur) return toast('채널을 먼저 선택하세요');
      const v = this.players.get(this.sel)?.el.querySelector('sv-video')?.video;
      saveSnapshot(v, `${chanLabel(cur.devId, cur.ch)}`, cur);
    }
    if (a === 'ptz') { this.ptzOpen = !this.ptzOpen; this.renderPtz(); }
    if (a === 'playback') {
      if (!cur) return toast('채널을 먼저 선택하세요');
      playback.open(cur.devId, cur.ch);
    }
    if (a === 'full') fullscreen($('#stage', this.el));
  },

  renderPtz() {
    const box = $('#ptz', this.el);
    $('[data-a=ptz]', this.el)?.classList.toggle('on', this.ptzOpen);
    if (!this.ptzOpen) { box.hidden = true; return; }
    box.hidden = false;
    const cur = this.tiles[this.sel];
    if (!cur) { box.innerHTML = '<p class="muted" style="margin:0;grid-column:1/-1">PTZ를 제어할 채널(타일)을 선택하세요.</p>'; return; }
    const dirs = [[-1, 1, -45], [0, 1, 0], [1, 1, 45], [-1, 0, -90], null, [1, 0, 90], [-1, -1, -135], [0, -1, 180], [1, -1, 135]];
    box.innerHTML = `
      <div class="pad">${dirs.map((d) => (d ? `<button data-pan="${d[0]}" data-tilt="${d[1]}">${ICON.arrow(d[2])}</button>` : '<span></span>')).join('')}</div>
      <div class="ptz-side">
        <div class="ptz-row"><b style="font-size:14px">${esc(chanLabel(cur.devId, cur.ch))}</b></div>
        <div class="ptz-row">
          <button class="btn sm" data-zoom="1">줌 +</button><button class="btn sm" data-zoom="-1">줌 −</button>
          <label style="display:flex;align-items:center;gap:6px;flex:1;min-width:120px">속도<input type="range" id="ptzSpeed" min="10" max="100" value="${store.get('sv.ptzSpeed', 50)}" style="flex:1"></label>
        </div>
        <div class="presets" id="presets"><span class="muted" style="font-size:13px">프리셋 불러오는 중…</span></div>
      </div>`;
    api(`/api/ptz/${cur.devId}/${cur.ch}/presets`).then((list) => {
      $('#presets', box).innerHTML = list.length
        ? list.map((p) => `<button class="btn sm" data-preset="${p.id}">${esc(p.name)}</button>`).join('')
        : '<span class="muted" style="font-size:13px">저장된 프리셋 없음</span>';
    }).catch(() => { $('#presets', box).innerHTML = '<span class="muted" style="font-size:13px">이 채널은 PTZ를 지원하지 않을 수 있습니다</span>'; });

    const speed = () => Number($('#ptzSpeed', box).value);
    $('#ptzSpeed', box).onchange = (e) => store.set('sv.ptzSpeed', Number(e.target.value));
    let moving = null;
    const stop = () => {
      if (!moving) return;
      moving.classList.remove('press');
      moving = null;
      api(`/api/ptz/${cur.devId}/${cur.ch}/move`, { method: 'POST', body: { pan: 0, tilt: 0, zoom: 0 } }).catch(() => {});
    };
    box.onpointerdown = (e) => {
      const b = e.target.closest('[data-pan],[data-zoom]');
      if (!b) return;
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      moving = b;
      b.classList.add('press');
      const s = speed();
      const body = b.dataset.zoom
        ? { pan: 0, tilt: 0, zoom: Number(b.dataset.zoom) * s }
        : { pan: Number(b.dataset.pan) * s, tilt: Number(b.dataset.tilt) * s, zoom: 0 };
      api(`/api/ptz/${cur.devId}/${cur.ch}/move`, { method: 'POST', body }).catch((err) => { fail(err); });
    };
    box.onpointerup = box.onpointercancel = box.onpointerleave = stop;
    box.onclick = (e) => {
      const p = e.target.closest('[data-preset]');
      if (p) api(`/api/ptz/${cur.devId}/${cur.ch}/presets/${p.dataset.preset}`, { method: 'POST' })
        .then(() => toast(`프리셋 이동: ${p.textContent}`)).catch(fail);
    };
  },
};
pages.live = live;

function channelPicker(onPick, onPickAll) {
  const list = state.devices;
  openSheet(`${sheetHead('채널 선택')}
    ${list.length ? list.map((d) => `
      <div class="picker-dev"><i class="dot ${isOnline(d) ? 'on' : 'off'}"></i>${esc(d.name)}
        ${onPickAll ? `<button class="btn sm" data-all="${d.id}">전체 보기</button>` : ''}</div>
      <div class="picker-ch">${d.channels.map((c) => `<button data-dev="${d.id}" data-ch="${c.no}"><i class="dot ${c.online === false ? 'off' : 'on'}"></i>${esc(c.name)}</button>`).join('')}</div>`).join('')
    : '<div class="empty"><b>등록된 장비가 없습니다</b>장비 탭에서 먼저 장비를 추가하세요.</div>'}`, (sheet) => {
    sheet.onclick = (e) => {
      const all = e.target.closest('[data-all]');
      if (all) { const id = Number(all.dataset.all); closeSheet(); onPickAll(devById(id).channels.map((c) => ({ devId: id, ch: c.no }))); return; }
      const b = e.target.closest('[data-ch]');
      if (b) { closeSheet(); onPick(Number(b.dataset.dev), Number(b.dataset.ch)); }
    };
  });
}

function fullscreen(el) {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) req.call(el).then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  else toast('이 기기는 전체화면을 지원하지 않습니다');
}

function saveSnapshot(video, label, cur) {
  const name = `현장뷰_${label}_${localIso(new Date()).replace(/[-:]/g, '').replace('T', '_')}.jpg`;
  const download = (href) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  if (video && video.videoWidth) {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    c.toBlob((b) => { const u = URL.createObjectURL(b); download(u); setTimeout(() => URL.revokeObjectURL(u), 5000); toast('스냅샷을 저장했습니다'); }, 'image/jpeg', 0.92);
  } else if (cur) {
    download(`/api/snapshot/${cur.devId}/${cur.ch}`);
  }
}

// ═════════════════ 재생 ═════════════════
const ZOOMS = [30, 90, 240]; // 1시간당 픽셀
const playback = {
  el: $('#page-playback'),
  devId: null, ch: null,
  date: today(),
  records: [],
  zoomIdx: 1,
  playStart: null,   // 현재 재생 시작 시각 (Date)
  player: null,
  timer: null,
  userScrollAt: 0,
  built: false,

  open(devId, ch, at = null) {
    this.devId = devId; this.ch = ch;
    if (at) this.date = at.slice(0, 10);
    this.pendingAt = at;
    if (state.tab === 'playback') this.show(); else go('playback');
  },

  build() {
    this.el.classList.add('fill');
    this.el.innerHTML = `
      <div class="pb-bar">
        <select id="pbChan"></select>
        <input type="date" id="pbDate">
      </div>
      <div class="pb-stage" id="pbStage">
        <div class="tile" id="pbTile"><div class="state">타임라인에서 재생할 시각을 누르세요</div></div>
        <div class="pb-clock" id="pbClock" hidden></div>
      </div>
      <div class="controls">
        <button class="btn sm" data-a="back30">−30초</button>
        <button class="btn sm" data-a="fwd30">+30초</button>
        <button class="icon-btn" data-a="snap" title="스냅샷 저장">${ICON.cam}</button>
        <button class="icon-btn" data-a="full" title="전체화면">${ICON.full}</button>
        <button class="btn sm" data-a="live">${ICON.live}실시간</button>
      </div>
      <div class="timeline-wrap">
        <div class="tl-head"><b id="tlTitle" style="font-size:14px"></b><span class="grow"></span>
          <div class="seg">${ZOOMS.map((z, i) => `<button data-zoom="${i}">${['24시간', '8시간', '3시간'][i]}</button>`).join('')}</div></div>
        <div class="tl-scroll" id="tlScroll"><div class="tl" id="tl"></div></div>
        <div class="legend"><span><i style="background:#2f6fbf"></i>상시 녹화</span><span><i style="background:var(--accent)"></i>모션</span><span><i style="background:var(--bad)"></i>이벤트</span></div>
      </div>`;
    $('#pbChan', this.el).onchange = (e) => { const [d, c] = e.target.value.split(':').map(Number); this.devId = d; this.ch = c; this.stop(); this.load(); };
    $('#pbDate', this.el).onchange = (e) => { if (e.target.value) { this.date = e.target.value; this.stop(); this.load(); } };
    $('#tlScroll', this.el).addEventListener('scroll', () => { this.userScrollAt = Date.now(); }, { passive: true });
    $('#tl', this.el).addEventListener('click', (e) => this.onTimelineClick(e));
    this.el.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zoom]');
      if (z) { this.zoomIdx = Number(z.dataset.zoom); this.renderTimeline(true); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back30' || a === 'fwd30') {
        const now = this.currentTime();
        if (!now) return toast('먼저 재생할 시각을 선택하세요');
        this.play(new Date(now.getTime() + (a === 'fwd30' ? 30000 : -30000)));
      }
      if (a === 'snap') saveSnapshot($('#pbTile sv-video', this.el)?.video, `${chanLabel(this.devId, this.ch)}_재생`);
      if (a === 'full') fullscreen($('#pbStage', this.el));
      if (a === 'live' && this.devId) live.showChannels([{ devId: this.devId, ch: this.ch }]);
    });
    this.built = true;
  },

  show() {
    if (!this.built) this.build();
    if (!state.devices.length) {
      $('#pbChan', this.el).innerHTML = '<option>등록된 장비 없음</option>';
      return;
    }
    if (!this.devId || !chanOf(this.devId, this.ch)) {
      this.devId = state.devices[0].id; this.ch = state.devices[0].channels[0]?.no || 1;
    }
    $('#pbChan', this.el).innerHTML = state.devices.map((d) => `<optgroup label="${esc(d.name)}">${d.channels.map((c) =>
      `<option value="${d.id}:${c.no}" ${d.id === this.devId && c.no === this.ch ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
    $('#pbDate', this.el).value = this.date;
    $('#pbDate', this.el).max = today();
    this.load();
  },
  hide() { this.stop(); },

  async load() {
    $('#tlTitle', this.el).textContent = `${this.date.replace(/-/g, '.')} 녹화 검색 중…`;
    this.records = [];
    this.renderTimeline();
    try {
      this.records = await api(`/api/records/${this.devId}/${this.ch}?date=${this.date}`);
      $('#tlTitle', this.el).textContent = this.records.length ? `${this.date.replace(/-/g, '.')} · 녹화 ${this.records.length}구간` : `${this.date.replace(/-/g, '.')} · 녹화 없음`;
    } catch (e) {
      $('#tlTitle', this.el).textContent = `녹화 검색 실패: ${e.message}`;
    }
    this.renderTimeline(true);
    if (this.pendingAt) { const at = this.pendingAt; this.pendingAt = null; this.play(parseLocal(at)); }
    else if (this.records.length && !this.playStart) {
      // 기본: 마지막 녹화 구간의 끝에서 5분 전
      const last = this.records[this.records.length - 1];
      const t = new Date(Math.max(parseLocal(last.start).getTime(), parseLocal(last.end).getTime() - 300000));
      this.setHead(t, true);
    }
  },

  secOfDay(d) { return (d - parseLocal(this.date)) / 1000; },

  renderTimeline(scrollToHead = false) {
    const pph = ZOOMS[this.zoomIdx];
    const tl = $('#tl', this.el);
    const width = pph * 24;
    tl.style.width = `${width}px`;
    $$('[data-zoom]', this.el).forEach((b) => b.classList.toggle('on', Number(b.dataset.zoom) === this.zoomIdx));
    const step = pph < 60 ? 2 : 1;
    let html = '<div class="track"></div>';
    for (const r of this.records) {
      const s = Math.max(0, this.secOfDay(parseLocal(r.start)));
      const e = Math.min(86400, this.secOfDay(parseLocal(r.end)));
      if (e <= s) continue;
      html += `<div class="rec ${r.type}" style="left:${(s / 3600) * pph}px;width:${Math.max(1, ((e - s) / 3600) * pph)}px"></div>`;
    }
    for (let h = 0; h <= 24; h += step) html += `<div class="tick" style="left:${h * pph}px">${pad(h)}:00</div>`;
    if (pph >= 240) for (let h = 0; h < 24; h++) html += `<div class="tick" style="left:${(h + 0.5) * pph}px;opacity:.6">${pad(h)}:30</div>`;
    html += '<div class="head" id="tlHead" hidden></div>';
    tl.innerHTML = html;
    if (this.headTime) this.setHead(this.headTime, scrollToHead);
  },

  setHead(t, scroll = false) {
    this.headTime = t;
    const head = $('#tlHead', this.el);
    if (!head) return;
    const sec = this.secOfDay(t);
    if (sec < 0 || sec > 86400) { head.hidden = true; return; }
    const x = (sec / 3600) * ZOOMS[this.zoomIdx];
    head.hidden = false;
    head.style.left = `${x}px`;
    const sc = $('#tlScroll', this.el);
    if (scroll || (Date.now() - this.userScrollAt > 4000 && (x < sc.scrollLeft + 20 || x > sc.scrollLeft + sc.clientWidth - 20))) {
      sc.scrollLeft = x - sc.clientWidth / 2;
      this.userScrollAt = 0;
    }
  },

  onTimelineClick(e) {
    const tl = $('#tl', this.el);
    const x = e.clientX - tl.getBoundingClientRect().left;
    const sec = Math.max(0, Math.min(86399, (x / ZOOMS[this.zoomIdx]) * 3600));
    let t = new Date(parseLocal(this.date).getTime() + sec * 1000);
    const inRec = this.records.find((r) => parseLocal(r.start) <= t && t < parseLocal(r.end));
    if (!inRec) {
      const next = this.records.find((r) => parseLocal(r.start) > t);
      if (!next) return toast('이후 녹화가 없습니다');
      t = parseLocal(next.start);
    }
    this.play(t);
  },

  currentTime() {
    if (!this.playStart) return null;
    const v = $('#pbTile sv-video', this.el)?.video;
    return new Date(this.playStart.getTime() + (v?.currentTime || 0) * 1000);
  },

  async play(t) {
    if (t > new Date()) t = new Date(Date.now() - 10000);
    if (localIso(t).slice(0, 10) !== this.date) { this.date = localIso(t).slice(0, 10); $('#pbDate', this.el).value = this.date; this.pendingAt = localIso(t); this.load(); return; }
    this.stop();
    this.playStart = t;
    this.setHead(t, true);
    const tile = $('#pbTile', this.el);
    tile.innerHTML = `<sv-video></sv-video><div class="lbl">${esc(chanLabel(this.devId, this.ch))} · 재생</div><div class="state"><div class="spinner"></div></div>`;
    const v = $('sv-video', tile);
    v.addEventListener('sv-playing', () => { $('.state', tile).innerHTML = ''; });
    const clock = $('#pbClock', this.el);
    clock.hidden = false;
    try {
      const r = await api(`/api/playback/${this.devId}/${this.ch}`, { method: 'POST', body: { start: localIso(t) } });
      if (this.playStart !== t) return;
      v.src = r.ws;
    } catch (e) { $('.state', tile).textContent = e.message; }
    this.timer = setInterval(() => {
      const now = this.currentTime();
      if (!now) return;
      clock.textContent = localIso(now).replace('T', ' ');
      this.setHead(now);
    }, 500);
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    $('#pbTile sv-video', this.el)?.stop();
    this.playStart = null;
    const tile = $('#pbTile', this.el);
    if (tile) tile.innerHTML = '<div class="state">타임라인에서 재생할 시각을 누르세요</div>';
    const clock = $('#pbClock', this.el);
    if (clock) clock.hidden = true;
  },
};
pages.playback = playback;

// ═════════════════ 알람 ═════════════════
const alarms = {
  el: $('#page-alarms'),
  items: [],
  filter: 'all',
  more: false,
  async show() {
    this.render(true);
    await this.load();
  },
  async load(append = false) {
    const before = append && this.items.length ? this.items[this.items.length - 1].id : '';
    try {
      const r = await api(`/api/events?limit=50${before ? `&before=${before}` : ''}${this.filter === 'unread' ? '&unread=1' : ''}`);
      this.items = append ? [...this.items, ...r.items] : r.items;
      this.more = r.items.length === 50;
      setUnread(r.unread);
    } catch (e) { fail(e); }
    this.render();
  },
  render(loading = false) {
    let lastDay = '';
    this.el.innerHTML = `
      <div class="topbar"><h1>알람</h1>
        <div class="seg"><button data-f="all" class="${this.filter === 'all' ? 'on' : ''}">전체</button><button data-f="unread" class="${this.filter === 'unread' ? 'on' : ''}">안 읽음</button></div>
        <button class="btn sm ghost" data-a="readall">모두 읽음</button></div>
      ${loading && !this.items.length ? '<div class="empty"><div class="spinner" style="margin:auto"></div></div>' : ''}
      ${!loading && !this.items.length ? '<div class="empty"><b>알람이 없습니다</b>장비에서 모션·침입 감지 같은 이벤트가 발생하면 여기에 표시됩니다.<br><small>장비 설정에서 해당 이벤트의 "감시센터 통보(Notify Surveillance Center)"를 켜야 합니다.</small></div>' : ''}
      <div style="max-width:900px;margin:0 auto">
      ${this.items.map((ev) => {
        const day = ev.time.slice(0, 10);
        const head = day !== lastDay ? `<div class="alarm-day">${day === today() ? '오늘' : day.replace(/-/g, '.')}</div>` : '';
        lastDay = day;
        return `${head}<button class="alarm" data-ev="${ev.id}">
          <div class="thumb" style="${ev.snap ? `background-image:url('${ev.snap}')` : ''}"></div>
          <div class="body"><b>${esc(ev.typeName)}</b><small>${esc(ev.deviceName)} · ${esc(ev.channelName)}</small><small>${ev.time.slice(11, 19)}</small></div>
          ${ev.read ? '' : '<i class="unread"></i>'}</button>`;
      }).join('')}
      ${this.more ? '<div style="padding:16px;text-align:center"><button class="btn" data-a="more">더 보기</button></div>' : ''}
      </div>`;
  },
  prepend(ev) {
    if (this.filter === 'all' || !ev.read) { this.items.unshift(ev); if (state.tab === 'alarms') this.render(); }
  },
  async markRead(ids) {
    await api('/api/events/read', { method: 'POST', body: ids ? { ids } : {} }).catch(() => {});
    refreshUnread();
  },
};
pages.alarms = alarms;
alarms.el.addEventListener('click', async (e) => {
  const f = e.target.closest('[data-f]');
  if (f) { alarms.filter = f.dataset.f; alarms.items = []; alarms.show(); return; }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'readall') { await alarms.markRead(null); alarms.items.forEach((i) => { i.read = true; }); alarms.render(); return; }
  if (a === 'more') { alarms.load(true); return; }
  const b = e.target.closest('[data-ev]');
  if (b) {
    const ev = alarms.items.find((x) => x.id === Number(b.dataset.ev));
    if (!ev.read) { ev.read = true; alarms.markRead([ev.id]); alarms.render(); }
    alarmDetail(ev);
  }
});

function alarmDetail(ev) {
  openSheet(`${sheetHead(ev.typeName)}
    ${ev.snap ? `<img class="alarm-img" src="${ev.snap}" alt="">` : '<div class="alarm-img" style="display:grid;place-items:center;color:var(--muted)">사진 없음</div>'}
    <dl class="kv" style="margin-top:14px">
      <dt>장비</dt><dd>${esc(ev.deviceName)}</dd><dt>채널</dt><dd>${esc(ev.channelName)}</dd>
      <dt>발생 시각</dt><dd>${ev.time.replace('T', ' ')}</dd><dt>이벤트</dt><dd>${esc(ev.typeName)} <small class="muted">(${esc(ev.type)})</small></dd>
    </dl>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <button class="btn" data-a="live">${ICON.live}실시간 보기</button>
      <button class="btn primary" data-a="pb">${ICON.clock}녹화 재생</button>
    </div>`, (sheet) => {
    sheet.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a || !ev.channel || !devById(ev.deviceId)) return;
      closeSheet();
      if (a === 'live') live.showChannels([{ devId: ev.deviceId, ch: ev.channel }]);
      if (a === 'pb') playback.open(ev.deviceId, ev.channel, localIso(new Date(parseLocal(ev.time).getTime() - 10000)));
    };
  });
}

function setUnread(n) {
  state.unread = n;
  const b = $('#alarmBadge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
}
const refreshUnread = () => api('/api/events?limit=1').then((r) => setUnread(r.unread)).catch(() => {});

let es = null;
function connectEvents() {
  es?.close();
  es = new EventSource('/api/events/stream');
  es.addEventListener('alarm', (m) => {
    const ev = JSON.parse(m.data);
    setUnread(state.unread + 1);
    alarms.prepend(ev);
    toast('', {
      type: 'alarm-toast', ms: 6000,
      html: `${ev.snap ? `<img src="${ev.snap}" alt="">` : ''}<div><b>${esc(ev.typeName)}</b><br><small class="muted">${esc(ev.deviceName)} · ${esc(ev.channelName)} · ${ev.time.slice(11, 19)}</small></div>`,
      onClick: () => alarmDetail(ev),
    });
    if (document.hidden && store.get('sv.notify', false) && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`현장뷰 · ${ev.typeName}`, { body: `${ev.deviceName} · ${ev.channelName}`, icon: ev.snap || '/icon.svg', tag: `ev${ev.id}` });
    }
  });
  es.addEventListener('status', (m) => {
    const s = JSON.parse(m.data);
    const d = devById(s.deviceId);
    if (!d) return;
    const was = isOnline(d);
    d.status = s;
    if (was !== isOnline(d)) {
      toast(`${d.name} ${isOnline(d) ? '다시 연결됨' : '연결 끊김'}`, { type: isOnline(d) ? '' : 'err' });
      if (state.tab === 'devices') pages.devices.render();
    }
  });
}

// ═════════════════ 더보기 ═════════════════
const inApp = /SiteViewApp/.test(navigator.userAgent);
pages.more = {
  el: $('#page-more'),
  show() {
    const notifyOn = store.get('sv.notify', false) && 'Notification' in window && Notification.permission === 'granted';
    this.el.innerHTML = `
      <div class="topbar"><h1>더보기</h1></div>
      <div class="wrap" style="max-width:640px">
        ${state.config.demo ? '<div class="list"><div><span class="grow"><b>데모 모드</b><br><small>실제 카메라 대신 가상 NVR(4채널)이 연결되어 있습니다. 실제 장비를 추가하면 함께 쓸 수 있습니다.</small></span></div></div>' : ''}
        <div class="section-title">계정</div>
        <div class="list">
          <div><span class="grow">로그인 계정</span><small>${esc(state.user?.username)}</small></div>
          <button data-a="pw"><span class="grow">비밀번호 변경</span></button>
        </div>
        <div class="section-title">알림</div>
        <div class="list">
          <label class="check" style="padding:14px 16px;margin:0"><span class="grow">화면이 꺼져 있을 때 알람 알림 받기</span><input type="checkbox" id="notifyChk" ${notifyOn ? 'checked' : ''}></label>
        </div>
        <div class="section-title">앱</div>
        <div class="list">
          ${inApp ? '<a href="https://localhost/index.html?change=1"><span class="grow">서버 주소 변경</span></a>' : `<a href="${esc(state.config.apkUrl)}"><span class="grow">안드로이드 앱 내려받기 (APK)</span><small>설치 후 이 서버 주소를 입력</small></a>`}
          <div><span class="grow">이 서버 주소</span><small>${esc(location.origin)}</small></div>
          <div><span class="grow">버전</span><small>${esc(state.config.version)}</small></div>
        </div>
        <button class="btn block danger" data-a="logout">로그아웃</button>
        <p class="muted" style="font-size:12px;margin-top:18px;line-height:1.6">현장뷰는 Hikvision 장비의 ISAPI(HTTP)와 RTSP로 직접 접속합니다. 서버(이 프로그램)가 장비와 같은 네트워크에 있거나, 장비 포트가 서버에서 접근 가능해야 합니다.</p>
      </div>`;
    $('#notifyChk', this.el).onchange = async (e) => {
      if (e.target.checked) {
        if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않습니다'); e.target.checked = false; return; }
        const p = await Notification.requestPermission();
        e.target.checked = p === 'granted';
        if (p !== 'granted') toast('알림 권한이 거부되었습니다');
      }
      store.set('sv.notify', e.target.checked);
    };
  },
};
pages.more.el.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'logout') {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    es?.close();
    live.hide();
    showLogin();
  }
  if (a === 'pw') {
    openSheet(`${sheetHead('비밀번호 변경')}<form class="form" id="pwForm">
      <label>현재 비밀번호<input type="password" name="current" required autocomplete="current-password"></label>
      <label>새 비밀번호 (6자 이상)<input type="password" name="next" required minlength="6" autocomplete="new-password"></label>
      <p class="form-error" id="pwErr"></p><button class="btn primary block">변경</button></form>`, (sheet) => {
      $('#pwForm', sheet).onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('/api/password', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); closeSheet(); toast('비밀번호를 변경했습니다'); }
        catch (err) { $('#pwErr', sheet).textContent = err.message; }
      };
    });
  }
});

window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== state.tab && !$('#app').hidden) go(t); });
boot();
