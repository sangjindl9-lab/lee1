/*
 * 이음과 문서 — 워드(docx) · 파워포인트(pptx) 보기와 글자 고치기.
 * 보기: docx-preview / pptx-preview. 고치기: 원본 파일 안의 글자(XML)만 바꿔 넣으므로
 * 그림·표·서식·레이아웃 등 나머지는 원본 그대로 저장된다. (라이브러리는 eum/lib, 처음 열 때 불러온다)
 */
(function () {
  'use strict';
  const { native, toast, remember, el, blobToB64, b64ToBytes, progressBox } = window.EumShell;
  const NS = {
    docx: { ns: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', p: 'p', r: 'r', t: 't', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    pptx: { ns: 'http://schemas.openxmlformats.org/drawingml/2006/main', p: 'p', r: 'r', t: 't', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  };
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const S = { kind: null, zip: null, uri: null, name: '', dirty: false, edit: false, parts: new Map(), slides: [], undo: [], map: new Map(), zoom: 1, fit: 1, pv: null };
  let root, view, titleEl, modeBtn, menu, sheet, loading;

  // ── 라이브러리 ────────────────────────────────────────────
  const loaded = {};
  function lib(src) {
    return loaded[src] || (loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'eum/lib/' + src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' 불러오기 실패'));
      document.head.append(s);
    }));
  }

  // ── 원본 XML 다루기 ───────────────────────────────────────
  async function part(path) {
    if (!S.parts.has(path)) {
      const f = S.zip.file(path);
      if (!f) throw new Error('문서 구성 파일이 없습니다: ' + path);
      S.parts.set(path, new DOMParser().parseFromString(await f.async('string'), 'application/xml'));
    }
    return S.parts.get(path);
  }
  function putPart(path) {
    S.zip.file(path, XML_HEAD + new XMLSerializer().serializeToString(S.parts.get(path)).replace(/^<\?xml[^>]*\?>\s*/, ''));
  }
  const K = () => NS[S.kind];
  const paragraphs = (doc) => Array.from(doc.getElementsByTagNameNS(K().ns, K().p));
  const textNodes = (p) => Array.from(p.getElementsByTagNameNS(K().ns, K().t)).filter((t) => nearestPara(t) === p);
  function nearestPara(node) {
    for (let n = node.parentNode; n; n = n.parentNode) if (n.namespaceURI === K().ns && n.localName === K().p) return n;
    return null;
  }
  const paraText = (p) => textNodes(p).map((t) => t.textContent).join('');

  /** old → next 로 바꾸는 데 필요한 조각들 [{from, to, insert}] (old 기준 위치). 바뀌지 않은 글자는 건드리지 않는다. */
  function diffHunks(old, next) {
    let a = 0;
    while (a < old.length && a < next.length && old[a] === next[a]) a++;
    let b = 0;
    while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    const o = old.slice(a, old.length - b), n = next.slice(a, next.length - b);
    if (!o.length || !n.length || o.length * n.length > 4e6) return [{ from: a, to: a + o.length, insert: n }];
    // 가장 긴 공통 부분(LCS)으로 여러 군데 고친 것을 따로따로 찾는다.
    const W = n.length + 1, L = new Uint16Array((o.length + 1) * W);
    for (let i = o.length - 1; i >= 0; i--) for (let j = n.length - 1; j >= 0; j--) {
      L[i * W + j] = o[i] === n[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
    const hunks = [];
    let i = 0, j = 0, cur = null;
    while (i < o.length || j < n.length) {
      if (i < o.length && j < n.length && o[i] === n[j]) { cur = null; i++; j++; continue; }
      if (!cur) { cur = { from: a + i, to: a + i, insert: '' }; hunks.push(cur); }
      if (j < n.length && (i === o.length || L[i * W + j + 1] >= L[(i + 1) * W + j])) cur.insert += n[j++];
      else { i++; cur.to = a + i; }
    }
    return hunks;
  }

  /** 문단 글자를 바꾼다. 바뀐 곳만 고치므로 나머지 글자의 모양(굵게·색 등)이 유지된다. */
  function setParaText(p, next) {
    const ts = textNodes(p);
    const old = ts.map((t) => t.textContent).join('');
    if (old === next) return false;
    if (!ts.length) ts.push(newRun(p));
    // 뒤에서부터 고쳐야 앞쪽 위치가 밀리지 않는다.
    for (const h of diffHunks(old, next).reverse()) replaceRange(ts, h.from, h.to, h.insert);
    return true;
  }
  /** 글자 조각들에서 [a, delEnd) 를 지우고 그 자리에 insert 를 넣는다. */
  function replaceRange(ts, a, delEnd, insert) {
    let pos = 0, placed = false;
    for (const t of ts) {
      const s = t.textContent, start = pos, end = pos + s.length;
      pos = end;
      const from = Math.max(a, start) - start, to = Math.min(delEnd, end) - start;
      // 넣을 자리: 바뀌는 구간이 시작되는 글자 조각(끝에 붙이는 경우는 마지막 조각)
      const here = !placed && a >= start && (a < end || t === ts[ts.length - 1]);
      if (!here && from >= to) continue;
      const cutFrom = here ? a - start : from, cutTo = Math.max(cutFrom, to);
      t.textContent = s.slice(0, cutFrom) + (here ? insert : '') + s.slice(cutTo);
      if (here) placed = true;
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
  }
  /** 글자가 없는 빈 문단에 글자 조각을 만든다. */
  function newRun(p) {
    const d = p.ownerDocument, k = K();
    const prefix = p.prefix ? p.prefix + ':' : '';
    const r = d.createElementNS(k.ns, prefix + k.r), t = d.createElementNS(k.ns, prefix + k.t);
    r.append(t);
    // pptx 는 문단 끝 속성(endParaRPr) 앞에, docx 는 문단 끝에 둔다.
    const tail = S.kind === 'pptx' ? Array.from(p.childNodes).find((n) => n.localName === 'endParaRPr') : null;
    p.insertBefore(r, tail || null);
    return t;
  }

  // ── 그리기 ────────────────────────────────────────────────
  async function currentBytes() {
    return S.zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  }

  async function render() {
    const top = view.scrollTop;
    const bytes = await currentBytes();
    const host = el('div', 'eum-office-doc');
    if (S.kind === 'docx') {
      await docx.renderAsync(new Blob([bytes]), host, null, {
        inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
        renderHeaders: true, renderFooters: true, renderFootnotes: false, renderEndnotes: false,
      });
      view.replaceChildren(host);
      const sec = host.querySelector('section.docx');
      S.fit = sec ? Math.min(1, (view.clientWidth - 12) / sec.offsetWidth) : 1;
      mapDocx(host, await part('word/document.xml'));
    } else {
      view.replaceChildren(host);
      if (S.pv) { try { S.pv.destroy(); } catch { /* 이미 정리됨 */ } }
      const w = view.clientWidth - 12;
      S.pv = pptxPreview.init(host, { width: w, height: Math.round(w * 0.5625), mode: 'list' });
      await S.pv.preview(bytes);
      S.fit = 1;
    }
    applyZoom();
    view.scrollTop = top;
  }
  function applyZoom() {
    const doc = view.firstElementChild;
    if (doc) doc.style.zoom = S.fit * S.zoom;
  }

  /** 화면의 문단 ↔ 원본 문단 짝짓기. 글자가 똑같은 것만 짝지어, 확실한 문단만 고칠 수 있게 한다. */
  function mapDocx(host, doc) {
    S.map = new Map();
    const norm = (s) => s.replace(/\s+/g, '');
    const body = doc.getElementsByTagNameNS(K().ns, 'body')[0];
    const xml = paragraphs(body).map((p) => ({ p, text: norm(paraText(p)) }));
    let j = 0;
    for (const dom of host.querySelectorAll('article p')) {
      const text = norm(dom.textContent);
      for (let k = j; k < Math.min(j + 8, xml.length); k++) {
        if (xml[k].text !== text) continue;
        S.map.set(dom, xml[k].p);
        j = k + 1;
        break;
      }
    }
  }

  // ── 슬라이드 순서 (pptx) ──────────────────────────────────
  async function loadSlides() {
    const pres = await part('ppt/presentation.xml');
    const rels = await part('ppt/_rels/presentation.xml.rels');
    const target = {};
    for (const r of Array.from(rels.getElementsByTagName('Relationship'))) target[r.getAttribute('Id')] = r.getAttribute('Target');
    const RID = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    S.slides = Array.from(pres.getElementsByTagNameNS('*', 'sldId'))
      .map((s) => target[s.getAttributeNS(RID, 'id')])
      .filter(Boolean)
      .map((t) => (t[0] === '/' ? t.slice(1) : 'ppt/' + t));
  }

  // ── 글자 고치기 창 ────────────────────────────────────────
  function askTexts(title, texts) {
    return new Promise((resolve) => {
      sheet.textContent = '';
      const card = el('div', 'eum-edit-card');
      const list = el('div', 'eum-edit-list');
      const areas = texts.map((t) => {
        const a = document.createElement('textarea');
        a.value = t; a.rows = Math.min(6, Math.max(1, Math.ceil(t.length / 22)));
        list.append(a);
        return a;
      });
      const acts = el('div', 'eum-edit-acts');
      const cancel = el('button', null, '취소'), ok = el('button', 'eum-edit-ok', '확인');
      const done = (v) => { sheet.hidden = true; resolve(v); };
      cancel.onclick = () => done(null);
      // 한 문단은 한 줄이다. 줄바꿈을 넣으면 빈칸으로 바꾼다.
      ok.onclick = () => done(areas.map((a) => a.value.replace(/\r?\n/g, ' ')));
      acts.append(cancel, ok);
      card.append(el('h3', null, title), list, acts);
      sheet.append(card);
      const t = document.getElementById('eum-toast');
      if (t) t.classList.remove('show');
      sheet.hidden = false;
      sheet.cancel = () => done(null);
      if (areas.length === 1) areas[0].focus();
    });
  }

  async function editParas(path, paras, title) {
    const before = paras.map(paraText);
    const after = await askTexts(title, before);
    if (!after) return;
    const snapshot = new XMLSerializer().serializeToString(S.parts.get(path));
    let changed = false;
    paras.forEach((p, i) => { if (setParaText(p, after[i])) changed = true; });
    if (!changed) return;
    S.undo.push({ path, xml: snapshot });
    putPart(path);
    setDirty(true);
    await render();
  }

  async function onTap(e) {
    if (!S.edit) return;
    if (S.kind === 'docx') {
      const dom = e.target.closest('p');
      if (!dom) return;
      const p = S.map.get(dom);
      if (!p) { toast('이 부분은 여기서 고칠 수 없습니다(머리말·글상자·쪽 나눔 문단 등).'); return; }
      await editParas('word/document.xml', [p], '문단 고치기');
    } else {
      const slide = e.target.closest('[class*="pptx-preview-slide-wrapper-"]');
      if (!slide) return;
      const idx = Number(/slide-wrapper-(\d+)/.exec(slide.className)[1]);
      const path = S.slides[idx];
      if (!path) return;
      const paras = paragraphs(await part(path)).filter((p) => paraText(p) !== '');
      if (!paras.length) { toast('이 슬라이드에는 고칠 글자가 없습니다.'); return; }
      await editParas(path, paras, `슬라이드 ${idx + 1} 글자 고치기`);
    }
  }

  async function undo() {
    const u = S.undo.pop();
    if (!u) { toast('되돌릴 내용이 없습니다.'); return; }
    S.parts.set(u.path, new DOMParser().parseFromString(u.xml, 'application/xml'));
    putPart(u.path);
    setDirty(true);
    await render();
  }

  // ── 열기·저장 ─────────────────────────────────────────────
  function setDirty(d) { S.dirty = d; titleEl.textContent = (d ? '● ' : '') + S.name; }
  function setEdit(on) {
    S.edit = on;
    root.classList.toggle('eum-office-edit', on);
    modeBtn.textContent = on ? '완료' : '편집';
    if (on) toast(S.kind === 'docx' ? '고칠 문단을 누르세요.' : '고칠 슬라이드를 누르세요.');
  }

  async function open(uri, name) {
    const kind = /\.pptx$/i.test(name) ? 'pptx' : 'docx';
    root.hidden = false;
    root.className = 'eum-loading eum-office-' + kind;
    titleEl.textContent = name;
    view.textContent = '';
    try {
      await loading.set(5, '준비하는 중');
      await lib('jszip.min.js');
      await lib(kind === 'docx' ? 'docx-preview.min.js' : 'pptx-preview.umd.js');
      await loading.set(15, '파일을 읽는 중');
      const r = await native.read({ uri });
      await loading.set(40, '문서를 푸는 중');
      const zip = await JSZip.loadAsync(b64ToBytes(r.data));
      Object.assign(S, { kind, zip, uri, name, parts: new Map(), undo: [], slides: [], zoom: 1, pv: null });
      if (kind === 'pptx') await loadSlides();
      setDirty(false);
      S.edit = false; modeBtn.textContent = '편집';
      await loading.set(60, '화면을 그리는 중');
      await render();
      await loading.set(100, '완료');
      remember(uri, name);
      return true;
    } catch (e) {
      close();
      toast('파일을 열지 못했습니다: ' + (e && e.message || e));
      return false;
    } finally {
      root.classList.remove('eum-loading');
    }
  }

  async function write(uri) {
    const blob = await S.zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    await native.write({ uri, data: await blobToB64(blob) });
  }
  async function save() {
    try {
      await write(S.uri);
      setDirty(false);
      toast('저장했습니다.');
    } catch (e) {
      toast('원본 위치에는 저장할 수 없어 저장할 곳을 선택합니다.');
      await saveAs();
    }
  }
  async function saveAs() {
    try {
      const r = await native.pickSave({ name: S.name, mime: K().mime });
      if (!r || !r.uri) return;
      await write(r.uri);
      S.uri = r.uri;
      if (r.name && r.name.toLowerCase().endsWith('.' + S.kind)) S.name = r.name;
      remember(S.uri, S.name);
      setDirty(false);
      toast('저장했습니다.');
    } catch (e) { toast('저장하지 못했습니다: ' + (e && e.message || e)); }
  }
  async function share() {
    if (S.dirty) { toast('먼저 저장해 주세요.'); return; }
    try { await native.share({ uri: S.uri, name: S.name }); } catch (e) { toast(String(e && e.message || e)); }
  }
  function close() {
    root.hidden = true;
    if (S.pv) { try { S.pv.destroy(); } catch { /* 이미 정리됨 */ } }
    Object.assign(S, { kind: null, zip: null, dirty: false, undo: [], parts: new Map(), pv: null });
    if (view) view.textContent = '';
  }

  // ── 화면 만들기 ───────────────────────────────────────────
  function build() {
    root = el('div'); root.id = 'eum-office'; root.hidden = true;
    const bar = el('header', 'eum-sbar');
    const back = el('button', 'eum-ic', '‹'); back.title = '홈'; back.onclick = () => window.EumShell.showHome();
    titleEl = el('span', 'eum-stitle');
    const bUndo = el('button', 'eum-ic eum-oedit', '↶'); bUndo.title = '되돌리기'; bUndo.onclick = undo;
    const bSave = el('button', 'eum-txt eum-oedit', '저장'); bSave.onclick = save;
    modeBtn = el('button', 'eum-txt eum-primary', '편집'); modeBtn.onclick = () => setEdit(!S.edit);
    const more = el('button', 'eum-ic', '⋮'); more.title = '더보기'; more.onclick = () => { menu.hidden = !menu.hidden; };
    bar.append(back, titleEl, bUndo, bSave, modeBtn, more);

    view = el('div', 'eum-office-view');
    view.onclick = (e) => { onTap(e).catch((err) => toast(String(err && err.message || err))); };
    let d0 = 0, z0 = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    view.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = S.zoom; } }, { passive: true });
    view.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      S.zoom = Math.max(0.5, Math.min(4, z0 * dist(e.touches) / d0));
      applyZoom();
    }, { passive: false });
    view.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });

    loading = progressBox('eum-sheet-loading');
    menu = el('div', 'eum-pop'); menu.hidden = true;
    const pop = el('div', 'eum-menu-sheet');
    for (const [label, fn] of [['다른 이름으로 저장', saveAs], ['공유', share]]) {
      const b = el('button', null, label);
      b.onclick = () => { menu.hidden = true; fn(); };
      pop.append(b);
    }
    menu.append(pop);
    menu.onclick = (e) => { if (e.target === menu) menu.hidden = true; };
    sheet = el('div', 'eum-edit-sheet'); sheet.hidden = true;

    root.append(bar, view, loading, menu, sheet);
    document.body.append(root);
  }

  /** 뒤로 가기. 처리했으면 true */
  function back() {
    if (!S.zip || root.hidden) return false;
    if (!sheet.hidden) { sheet.cancel(); return true; }
    if (!menu.hidden) { menu.hidden = true; return true; }
    return false;
  }

  build();
  window.EumOffice = {
    open, back, close,
    isOpen: () => !!S.zip,
    name: () => S.name,
    isDirty: () => S.dirty,
  };
})();
