/*
 * 이음과 문서 앱 화면 — 편집기(rhwp-studio) 위에 얹는 모바일 껍데기.
 *  - 홈(문서 열기·새 문서·최근 문서), 상단 바(보기/편집 전환·저장·더보기)
 *  - 휴대폰 파일 열기/저장/인쇄/공유를 안드로이드 플러그인(EumFiles)으로 연결
 * 편집기보다 먼저 실행되어야 한다(파일 선택기를 바꿔 끼우기 때문).
 */
(function () {
  'use strict';

  // ── 안드로이드 연결 ─────────────────────────────────────────
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  // 테스트에서는 window.__eumNativeMock 으로 같은 모양의 가짜를 넣는다.
  const native = window.__eumNativeMock
    || (isNative ? new Proxy({}, { get: (_, m) => (o) => cap.nativePromise('EumFiles', m, o || {}) }) : null);

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  const abort = () => new DOMException('취소됨', 'AbortError');

  // ── 최근 문서 ──────────────────────────────────────────────
  const RECENT_KEY = 'eum.recents';
  function recents() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }
  function saveRecents(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* 저장 공간 없음 */ }
  }
  function remember(uri, name) {
    saveRecents([{ uri, name, t: Date.now() }, ...recents().filter((r) => r.uri !== uri)]);
  }
  function forget(uri) {
    saveRecents(recents().filter((r) => r.uri !== uri));
  }

  // ── 파일 핸들: 편집기가 쓰는 File System Access 모양을 안드로이드 파일로 흉내 낸다 ──
  function makeHandle(uri, name) {
    return {
      kind: 'file',
      name,
      eumUri: uri,
      async getFile() {
        const r = await native.read({ uri });
        return new File([b64ToBytes(r.data)], name);
      },
      async createWritable() {
        let blob = null;
        return {
          async write(data) { blob = data; },
          async close() {
            await native.write({ uri, data: await blobToB64(blob) });
            remember(uri, name);
          },
        };
      },
      async isSameEntry(other) { return !!other && other.eumUri === uri; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
  }

  let launchConsumer = null;
  let pendingLaunch = null;
  function openHandle(handle) {
    armed = true;
    const params = { files: [handle] };
    if (launchConsumer) launchConsumer(params); else pendingLaunch = params;
  }
  // ── 한글 외 문서(엑셀·워드·PPT) 화면 ──────────────────────
  let viewersLoaded;
  const viewersReady = new Promise((resolve) => { viewersLoaded = resolve; }); // 화면 코드가 실린 뒤
  const viewers = () => [window.EumSheet, window.EumOffice].filter(Boolean);
  const openViewer = () => viewers().find((v) => v.isOpen());
  /** 다른 문서로 넘어가기 전에, 저장 안 한 엑셀·워드·PPT 가 있으면 물어본다. */
  function leaveViewer() {
    const v = openViewer();
    return !v || !v.isDirty() || confirm('저장하지 않은 변경 내용이 있습니다. 버리고 계속할까요?');
  }
  /** 엑셀·워드·PPT 면 해당 화면으로 보내고 true. 한글 문서면 false. */
  function routeOther(uri, name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'xls' || ext === 'doc' || ext === 'ppt') {
      toast(`구형 ${ext} 파일은 ${ext}x 로 저장한 뒤 열어 주세요.`);
      return true;
    }
    const key = { xlsx: 'EumSheet', xlsm: 'EumSheet', docx: 'EumOffice', pptx: 'EumOffice' }[ext];
    if (!key) return false;
    if (!leaveViewer()) return true;
    viewersReady.then(() => {
      for (const v of viewers()) if (v !== window[key]) v.close();
      return window[key].open(uri, name);
    }).then((ok) => { if (ok) hideHome(); });
    return true;
  }
  async function openUri(uri, name) {
    // 다른 앱이 잠시 열어 준 파일은 앱을 다시 켜면 접근 권한이 사라진다 → 다시 고르게 한다.
    if (typeof native.canRead === 'function' && !(await native.canRead({ uri })).ok) {
      forget(uri);
      renderHome();
      if (await ask(`「${name}」에 지금은 접근할 수 없습니다.\n다른 앱에서 잠시 열어 준 파일은 앱을 다시 켜면 권한이 사라집니다.\n\n파일을 다시 선택할까요?`, '파일 선택')) pickAndOpen();
      return;
    }
    if (routeOther(uri, name)) return;
    if (!leaveViewer()) return;
    remember(uri, name);
    openHandle(makeHandle(uri, name));
  }

  if (native) {
    window.showOpenFilePicker = async () => {
      const r = await native.pickOpen();
      if (!r || !r.uri) throw abort();
      if (routeOther(r.uri, r.name) || !leaveViewer()) throw abort();
      remember(r.uri, r.name);
      return [makeHandle(r.uri, r.name)];
    };
    window.showSaveFilePicker = async (opts) => {
      const suggested = (opts && opts.suggestedName) || '문서.hwp';
      const r = await native.pickSave({ name: suggested });
      if (!r || !r.uri) throw abort();
      const ext = suggested.slice(suggested.lastIndexOf('.')).toLowerCase();
      // 안드로이드가 확장자를 떼어 버린 이름을 돌려주면 편집기 검증에 걸리므로 원래 이름을 쓴다.
      const name = r.name && r.name.toLowerCase().endsWith(ext) ? r.name : suggested;
      return makeHandle(r.uri, name);
    };
    // 다른 앱에서 넘어온 파일·최근 문서를 편집기의 "파일로 실행" 통로에 넣는다.
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer(fn) {
          launchConsumer = fn;
          if (pendingLaunch) { fn(pendingLaunch); pendingLaunch = null; }
        },
      },
    });
    window.addEventListener('eumLaunch', (e) => {
      const f = typeof e.detail === 'string' ? JSON.parse(e.detail) : (e.detail || e);
      if (f && f.uri) openUri(f.uri, f.name);
    });
    native.getLaunch().then((f) => { if (f && f.uri) openUri(f.uri, f.name); }).catch(() => {});

    // 웹뷰에서는 <a download> 가 동작하지 않는다 → 저장 위치를 물어 직접 쓴다(HTML 내보내기 등).
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download || !this.href.startsWith('blob:')) return anchorClick.call(this);
      const name = this.download;
      fetch(this.href).then((r) => r.blob()).then(async (blob) => {
        const r = await native.pickSave({ name });
        if (!r || !r.uri) return;
        await native.write({ uri: r.uri, data: await blobToB64(blob) });
        toast('저장했습니다: ' + (r.name || name));
      }).catch((err) => toast('저장하지 못했습니다: ' + (err && err.message || err)));
    };
  }

  // ── 편집기 접근 ────────────────────────────────────────────
  const studio = () => window.rhwpStudio && window.rhwpStudio.automation;
  function run(id) {
    const a = studio();
    if (!a) return;
    try { return a.execute(id, {}, { allowDialog: true }); } catch (e) { toast(String(e && e.message || e)); }
  }
  const ctx = () => (studio() ? studio().getContext() : {});
  const fileName = () => (window.__wasm && window.__wasm.fileName) || '문서';
  const isDirty = () => !!(window.__documentState && window.__documentState.isDirty());

  // ── 상태 ──────────────────────────────────────────────────
  let mode = 'view';       // 'view' | 'edit'
  let docOpened = false;   // 홈에서 문서를 열거나 새로 만든 적이 있는가
  let wantEditOnLoad = false;
  let armed = false;       // 사용자가 문서를 열거나 만들라고 한 뒤인가

  function toast(msg) {
    let t = $('eum-toast');
    if (!t) { t = el('div'); t.id = 'eum-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** 불러오기 진행률 상자: box.set(퍼센트, 설명) — 화면이 실제로 갱신되도록 한 프레임 기다린다 */
  function progressBox(className) {
    const box = el('div', className);
    const bar = el('div', 'eum-prog'); const fill = el('b'); bar.append(fill);
    const label = el('span', null, '');
    box.append(bar, label);
    box.set = async (pct, text) => {
      fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      label.textContent = `${text} ${Math.round(pct)}%`;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    };
    return box;
  }

  function setMode(next) {
    mode = next;
    document.documentElement.classList.toggle('eum-view', mode === 'view');
    document.documentElement.classList.toggle('eum-edit', mode === 'edit');
    // 보기 모드 = 편집기의 "양식 모드"(본문 수정 불가). 실수로 문서가 바뀌지 않게 한다.
    if (ctx().hasDocument && !!ctx().isFormMode !== (mode === 'view')) run('view:form-mode');
    const ae = document.activeElement;
    if (ae && ae.tagName === 'TEXTAREA') {
      if (mode === 'view') { ae.setAttribute('inputmode', 'none'); ae.blur(); } else ae.removeAttribute('inputmode');
    }
    const b = $('eum-mode');
    if (b) b.textContent = mode === 'view' ? '편집' : '완료';
    window.dispatchEvent(new Event('resize'));
  }

  function refreshBar() {
    const t = $('eum-title');
    if (t) t.textContent = (isDirty() ? '● ' : '') + fileName();
  }

  // ── 홈 화면 ───────────────────────────────────────────────
  function fmtDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderHome() {
    const list = $('eum-recents');
    list.textContent = '';
    const other = openViewer();
    if (docOpened || other) {
      const cur = el('button', 'eum-row eum-current');
      cur.append(el('span', 'eum-ext', '열림'), el('span', 'eum-row-main', other ? other.name() : fileName()), el('span', 'eum-row-sub', '열어 둔 문서로 돌아가기'));
      cur.onclick = hideHome;
      list.append(cur);
    }
    const items = recents();
    if (!items.length) {
      list.append(el('p', 'eum-empty', native
        ? '최근에 연 문서가 없습니다.\n「문서 열기」로 한글(hwp · hwpx) · 엑셀(xlsx) · 워드(docx) · PPT(pptx) 파일을 선택하세요.'
        : '「문서 열기」로 hwp · hwpx 파일을 선택하세요.'));
      return;
    }
    for (const r of items) {
      const row = el('div', 'eum-row');
      const ext = (r.name.split('.').pop() || '').toLowerCase();
      const open = el('button', 'eum-row-open');
      open.append(el('span', 'eum-ext eum-ext-' + ext, ext.toUpperCase()), el('span', 'eum-row-main', r.name), el('span', 'eum-row-sub', fmtDate(r.t)));
      open.onclick = () => { wantEditOnLoad = false; openUri(r.uri, r.name); };
      const del = el('button', 'eum-row-del', '✕');
      del.title = '목록에서 지우기';
      del.onclick = () => { forget(r.uri); renderHome(); };
      row.append(open, del);
      list.append(row);
    }
  }
  // ── 홈 배너(자체 광고): 통합 광고 서버에서 받아 상단·하단 자리에 표시. 켜진 배너가 없으면 자리 숨김 ──
  const ADS_BASE = 'https://ads-production-a599.up.railway.app';
  let bannersLoadedAt = 0;
  async function loadBanners() {
    if (Date.now() - bannersLoadedAt < 10 * 60 * 1000) return;
    let list;
    try {
      const r = await fetch(ADS_BASE + '/api/banners?app=eum-docs', { cache: 'no-store' });
      if (!r.ok) return;
      list = await r.json();
    } catch (e) { return; }
    if (!Array.isArray(list)) return;
    bannersLoadedAt = Date.now(); // 실패하면 다음 홈 진입 때 다시 받는다
    for (const slot of ['top', 'bottom']) {
      const box = $('eum-ad-' + slot);
      const b = list.find((x) => x && typeof x === 'object' && x.slot === slot);
      box.textContent = '';
      box.hidden = !(b && b.image);
      if (box.hidden) continue;
      const img = el('img'); img.alt = b.title || '광고';
      img.src = /^https?:/.test(b.image) ? b.image : ADS_BASE + b.image;
      img.onerror = () => { box.hidden = true; };
      img.onload = () => { fetch(ADS_BASE + '/api/banners/' + b.id + '/imp', { method: 'POST' }).catch(() => {}); };
      if (b.link) {
        const a = el('a'); a.href = b.link; a.target = '_blank'; a.rel = 'noopener';
        a.onclick = () => { fetch(ADS_BASE + '/api/banners/' + b.id + '/click', { method: 'POST' }).catch(() => {}); };
        a.append(img); box.append(a);
      } else box.append(img);
    }
  }

  function showHome() { renderHome(); loadBanners(); $('eum-home').hidden = false; }
  function hideHome() { $('eum-home').hidden = true; refreshBar(); }

  // ── 더보기 메뉴 ───────────────────────────────────────────
  function closeMenu() { $('eum-menu').hidden = true; }
  async function share() {
    const h = window.__wasm && window.__wasm.currentFileHandle;
    if (!native || !h || !h.eumUri || isDirty()) { toast('먼저 문서를 저장해 주세요.'); return; }
    try { await native.share({ uri: h.eumUri, name: h.name }); } catch (e) { toast(String(e && e.message || e)); }
  }
  const MENU = [
    ['다른 이름으로 저장', () => run('file:save-as')],
    ['PDF로 저장 · 인쇄', () => run('file:print-to-pdf')],
    ['공유', share],
    ['찾기', () => run('edit:find')],
    ['폭 맞춤', () => run('view:zoom-fit-width')],
    ['쪽 맞춤', () => run('view:zoom-fit-page')],
    ['편집 용지', () => run('file:page-setup')],
    ['프로그램 정보', () => { $('eum-about').hidden = false; }],
  ];

  // ── 인쇄: 편집기가 숨은 iframe 에 만든 인쇄용 쪽들을 본 화면으로 옮겨 안드로이드 인쇄 창에 넘긴다 ──
  function hookPrintFrame(frame) {
    frame.addEventListener('load', () => {
      try { frame.contentWindow.print = () => nativePrint(frame.contentDocument); } catch { /* 접근 불가 */ }
    });
  }
  async function nativePrint(doc) {
    let root = $('eum-print-root');
    if (root) root.remove();
    root = el('div');
    root.id = 'eum-print-root';
    for (const s of doc.querySelectorAll('style')) root.append(s.cloneNode(true));
    for (const n of doc.body.children) root.append(document.importNode(n, true));
    document.body.append(root);
    try {
      await native.print({ name: fileName().replace(/\.(hwp|hwpx|hml)$/i, '') });
    } catch (e) {
      toast('인쇄 창을 열지 못했습니다: ' + (e && e.message || e));
    }
    // 인쇄 창이 내용을 읽어 갈 시간을 준 뒤, 앱으로 돌아오면 치운다.
    const cleanup = () => { if (!document.hidden) { root.remove(); document.removeEventListener('visibilitychange', cleanup); } };
    setTimeout(() => document.addEventListener('visibilitychange', cleanup), 1500);
  }

  // ── 두 손가락 확대/축소 ───────────────────────────────────
  function installPinch(container) {
    let d0 = 0, z0 = 1, raf = 0, want = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const vm = () => window.__canvasView && window.__canvasView.getViewportManager();
    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2 && vm()) { d0 = dist(e.touches); z0 = vm().getZoom(); }
    }, { passive: true });
    container.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      want = Math.max(0.25, Math.min(5, z0 * dist(e.touches) / d0));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; vm().setZoom(want); });
    }, { passive: false });
    container.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }

  // ── 뒤로 가기 ─────────────────────────────────────────────
  /** 파일을 먼저 고르고, 종류에 맞는 화면으로 보낸다. */
  async function pickAndOpen() {
    const r = await native.pickOpen();
    if (r && r.uri) openUri(r.uri, r.name);
  }

  /** 확인 창. 확인을 누르면 true */
  let askClose = null;
  function ask(message, okLabel) {
    return new Promise((resolve) => {
      const box = $('eum-ask');
      box.textContent = '';
      const card = el('div', 'eum-ask-card');
      const acts = el('div', 'eum-edit-acts');
      const cancel = el('button', null, '취소'), ok = el('button', 'eum-edit-ok', okLabel);
      askClose = (v) => { box.hidden = true; askClose = null; resolve(v); };
      cancel.onclick = () => askClose(false);
      ok.onclick = () => askClose(true);
      acts.append(cancel, ok);
      card.append(el('p', null, message), acts);
      box.append(card);
      box.hidden = false;
    });
  }

  async function onBack() {
    if (askClose) { askClose(false); return; }
    if (!$('eum-about').hidden) { $('eum-about').hidden = true; return; }
    if (!$('eum-menu').hidden) { closeMenu(); return; }
    const other = openViewer();
    const unsaved = other ? other.isDirty() : (docOpened && isDirty());
    if (!$('eum-home').hidden) {
      const msg = unsaved ? '저장하지 않은 변경 내용이 있습니다.\n앱을 종료하면 사라집니다. 종료할까요?' : '앱을 종료할까요?';
      if (await ask(msg, '종료') && native) native.exit();
      return;
    }
    // 열려 있는 메뉴·입력 창이 있으면 그것부터 닫는다.
    if (viewers().some((v) => v.back())) return;
    if (document.querySelector('.dialog-overlay, .modal-overlay, .menu-item.open, dialog[open]')) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const msg = unsaved
      ? '저장하지 않은 변경 내용이 있습니다.\n홈으로 나갈까요?\n\n문서는 닫히지 않고, 홈의 「열어 둔 문서」에서 다시 돌아올 수 있습니다.'
      : '문서 화면에서 나가 홈으로 갈까요?';
    if (await ask(msg, '홈으로')) showHome();
  }

  // ── 화면 만들기 ───────────────────────────────────────────
  function build() {
    const bar = el('header'); bar.id = 'eum-bar';
    const back = el('button', 'eum-ic', '‹'); back.title = '홈'; back.onclick = showHome;
    const title = el('span'); title.id = 'eum-title';
    const undo = el('button', 'eum-ic eum-edit-only', '↶'); undo.title = '되돌리기'; undo.onclick = () => run('edit:undo');
    const redo = el('button', 'eum-ic eum-edit-only', '↷'); redo.title = '다시 실행'; redo.onclick = () => run('edit:redo');
    const save = el('button', 'eum-txt eum-edit-only', '저장'); save.onclick = () => run('file:save');
    const modeBtn = el('button', 'eum-txt eum-primary', '편집'); modeBtn.id = 'eum-mode';
    modeBtn.onclick = () => setMode(mode === 'view' ? 'edit' : 'view');
    const more = el('button', 'eum-ic', '⋮'); more.title = '더보기'; more.onclick = () => { $('eum-menu').hidden = !$('eum-menu').hidden; };
    bar.append(back, title, undo, redo, save, modeBtn, more);
    document.body.prepend(bar);

    const menu = el('div'); menu.id = 'eum-menu'; menu.hidden = true;
    const sheet = el('div', 'eum-menu-sheet');
    for (const [label, fn] of MENU) {
      const b = el('button', null, label);
      b.onclick = () => { closeMenu(); fn(); };
      sheet.append(b);
    }
    menu.append(sheet);
    menu.onclick = (e) => { if (e.target === menu) closeMenu(); };
    document.body.append(menu);

    const home = el('div'); home.id = 'eum-home';
    const head = el('div', 'eum-home-head');
    const logo = el('img', 'eum-logo'); logo.src = 'eum/icon.png'; logo.alt = '';
    const headText = el('div');
    headText.append(el('h1', null, '이음과 문서'), el('p', null, '한글 · 엑셀 · 워드 · PPT 보기 · 편집'));
    head.append(logo, headText);
    const acts = el('div', 'eum-home-acts');
    const bOpen = el('button', 'eum-act eum-act-primary', '문서 열기');
    bOpen.onclick = async () => {
      wantEditOnLoad = false;
      if (!native) { armed = true; run('file:open'); return; }
      pickAndOpen();
    };
    const bNew = el('button', 'eum-act', '새 문서');
    bNew.onclick = () => { if (!leaveViewer()) return; armed = true; wantEditOnLoad = true; run('file:new-doc'); };
    acts.append(bOpen, bNew);
    const sec = el('h2', null, '최근 문서');
    const list = el('div'); list.id = 'eum-recents';
    const adTop = el('div', 'eum-ad'); adTop.id = 'eum-ad-top'; adTop.hidden = true;
    const adBottom = el('div', 'eum-ad'); adBottom.id = 'eum-ad-bottom'; adBottom.hidden = true;
    home.append(head, adTop, acts, sec, list, adBottom);
    document.body.append(home);

    const about = el('div'); about.id = 'eum-about'; about.hidden = true;
    const card = el('div', 'eum-about-card');
    card.append(
      el('h2', null, '이음과 문서'),
      el('p', null, 'hwp · hwpx · xlsx · docx · pptx 문서를 열고, 고치고, 같은 형식으로 저장합니다.'),
      el('p', 'eum-small', '문서 엔진: rhwp v0.8.7 (MIT License, © Edward Kim)\n엑셀: ExcelJS · fast-formula-parser (MIT), SSF (Apache-2.0)\n워드·PPT: docx-preview (Apache-2.0), pptx-preview (ISC), JSZip (MIT)\n글꼴: Pretendard · Noto · 나눔 · 고운 등 공개 글꼴 (SIL OFL 외)'),
    );
    const ok = el('button', 'eum-act eum-act-primary', '확인'); ok.onclick = () => { about.hidden = true; };
    card.append(ok);
    about.append(card);
    document.body.append(about);

    const askBox = el('div'); askBox.id = 'eum-ask'; askBox.hidden = true;
    document.body.append(askBox);

    renderHome();
    loadBanners();
    setMode('view');

    if (native) {
      window.EumShell = { native, toast, remember, el, blobToB64, b64ToBytes, showHome, progressBox };
      const load = (src) => new Promise((resolve) => {
        const js = document.createElement('script');
        js.src = src; js.onload = resolve;
        document.head.append(js);
      });
      Promise.all([load('eum/eum-sheet.js'), load('eum/eum-office.js')]).then(viewersLoaded);
    }

    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.id === 'rhwp-print-surface' && native) hookPrintFrame(n);
    }).observe(document.body, { childList: true });

    // 보기 모드에서는 자판이 올라오지 않게 한다.
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t.tagName !== 'TEXTAREA' || t.closest('.dialog, .dialog-overlay, dialog')) return;
      if (mode === 'view') t.setAttribute('inputmode', 'none'); else t.removeAttribute('inputmode');
    });

    window.addEventListener('eumBack', onBack);
    const sc = $('scroll-container');
    if (sc) installPinch(sc);
  }

  // 편집기가 준비되면 문서 이벤트에 연결한다.
  function connect() {
    const bus = window.__eventBus;
    if (!bus || !studio()) { setTimeout(connect, 100); return; }
    // 문서 열기·새 문서 모두 초기화 끝에 이 호출을 지난다.
    const ds = window.__documentState;
    const markClean = ds.markClean.bind(ds);
    ds.markClean = (reason) => {
      markClean(reason);
      // 편집기가 시작하면서 스스로 만드는 빈 문서는 홈을 닫지 않는다.
      if (reason !== 'document-initialized' || !armed) return;
      docOpened = true;
      for (const v of viewers()) v.close();
      hideHome();
      setTimeout(() => { setMode(wantEditOnLoad ? 'edit' : 'view'); wantEditOnLoad = false; refreshBar(); }, 0);
    };
    bus.on('document-dirty-changed', refreshBar);
    refreshBar();
  }

  document.addEventListener('DOMContentLoaded', () => { build(); connect(); });
})();
