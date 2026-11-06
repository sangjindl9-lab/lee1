// PDF 보기·편집: pdf.js 로 쪽을 그리고, 겹침 SVG 에 주석·측정·글자 고치기·양식 값을 그린다.
// 편집 내용은 "쪽 표시 좌표(지금 회전 상태, 1pt = 1px)" 로 저장하고, 저장할 때 pdfsave.js 가 PDF 좌표로 바꾼다.
import * as pdfjs from 'pdfjs-dist';
import { el, menu, ask, toast, confirmBox } from './ui.js';
import { createMeasure, svgEl } from './measure.js';
import { exportPdf, extractPages } from './pdfsave.js';
import * as files from './files.js';

pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.js';
const GAP = 12;
const PT_MM = 25.4 / 72;
const COLORS = [['#e53935', '빨강'], ['#1e88e5', '파랑'], ['#43a047', '초록'], ['#000000', '검정'], ['#fb8c00', '주황'], ['#8e24aa', '보라']];
const HL_COLORS = [['#ffeb3b', '노랑'], ['#69f0ae', '연두'], ['#80d8ff', '하늘'], ['#ff80ab', '분홍']];

async function loadDoc(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), cMapUrl: './cmaps/', cMapPacked: true, standardFontDataUrl: './standard_fonts/' }).promise;
  return { bytes, pdf };
}

export async function openPdf(bytes, ctx) {
  const { stage, content, labelLayer, tools, setHint } = ctx;
  setHint('문서를 여는 중…');
  const docs = [await loadDoc(bytes)];
  const state = { docs, pages: [], formValues: {}, mmPerPt: null, dirty: false };
  const dpr = Math.min(3, window.devicePixelRatio || 1);

  // ── 쪽 목록 만들기 ──
  for (let i = 0; i < docs[0].pdf.numPages; i++) state.pages.push(await makePage(0, i));
  async function makePage(docIndex, idx) {
    const p = await docs[docIndex].pdf.getPage(idx + 1);
    return { doc: docIndex, idx, page: p, baseRot: p.rotate || 0, rot: 0, edits: [], texts: null, widgets: null, renderedScale: null, task: null };
  }
  function viewport(pg, scale = 1) { return pg.page.getViewport({ scale, rotation: (pg.baseRot + pg.rot) % 360 }); }

  // ── 도구 상태 ──
  let mode = null; // null|'ink'|'highlight'|'text'|'shape'|'image'|'textfix'|'form'|'measure'
  let shape = 'rect';
  let color = COLORS[0][0], hlColor = HL_COLORS[0][0], width = 2;
  let textSize = 12;
  let temp = null;
  const undoStack = [];

  // ── 배치 ──
  content.innerHTML = '';
  const overlay = svgEl('svg', { class: 'pdf-overlay' });
  let layoutW = 0, layoutH = 0;
  function layout() {
    let y = GAP, maxW = 0;
    for (const pg of state.pages) {
      const vp = viewport(pg);
      pg.w = vp.width; pg.h = vp.height;
      maxW = Math.max(maxW, pg.w);
    }
    for (const pg of state.pages) {
      pg.x0 = Math.round((maxW - pg.w) / 2) + GAP; pg.y0 = y;
      y += pg.h + GAP;
      if (!pg.el) {
        pg.el = el('div', 'page');
        pg.canvas = el('canvas');
        pg.el.appendChild(pg.canvas);
        pg.num = el('div', 'pagenum');
        pg.el.appendChild(pg.num);
        pg.g = svgEl('g', {});
      }
      pg.el.style.left = pg.x0 + 'px'; pg.el.style.top = pg.y0 + 'px';
      pg.el.style.width = pg.w + 'px'; pg.el.style.height = pg.h + 'px';
      pg.g.setAttribute('transform', `translate(${pg.x0},${pg.y0})`);
      pg.num.textContent = state.pages.indexOf(pg) + 1;
    }
    layoutW = maxW + GAP * 2; layoutH = y;
    content.querySelectorAll('.page').forEach((e) => e.remove());
    overlay.innerHTML = '';
    for (const pg of state.pages) { content.appendChild(pg.el); overlay.appendChild(pg.g); drawEdits(pg); }
    content.appendChild(overlay);
    overlay.setAttribute('width', layoutW); overlay.setAttribute('height', layoutH);
    overlay.setAttribute('viewBox', `0 0 ${layoutW} ${layoutH}`);
    stage.setContentSize(layoutW, layoutH);
  }
  layout();
  stage.fitWidth();
  if (state.pages.length === 1 && state.pages[0].h * stage.transform.s > stage.visibleRect().h * stage.transform.s) { /* 세로로 긴 쪽은 폭 맞춤 유지 */ }

  // ── 그리기(렌더링) ──
  let renderTimer = null, closed = false;
  function scheduleRender(final) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderVisible, final ? 60 : 250);
  }
  stage.onChange((t, final) => scheduleRender(final));
  function renderVisible() {
    if (closed) return;
    const vis = stage.visibleRect();
    const s = stage.transform.s;
    const target = Math.min(4, Math.max(0.5, Math.ceil(s * dpr * 4) / 4));
    for (const pg of state.pages) {
      const near = pg.y0 < vis.y + vis.h * 2 && pg.y0 + pg.h > vis.y - vis.h;
      if (!near) {
        if (pg.renderedScale != null) { if (pg.task) pg.task.cancel(); pg.canvas.width = pg.canvas.height = 1; pg.renderedScale = null; }
        continue;
      }
      if (pg.renderedScale === target || pg.rendering === target) continue;
      renderPage(pg, target);
    }
  }
  function renderPage(pg, scale) {
    if (pg.task) { pg.task.cancel(); pg.task = null; }
    const vp = viewport(pg, scale);
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    pg.rendering = scale;
    const task = pg.page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    pg.task = task;
    task.promise.then(() => {
      if (pg.task !== task) return;
      pg.task = null; pg.rendering = null;
      pg.canvas.width = c.width; pg.canvas.height = c.height;
      pg.canvas.getContext('2d').drawImage(c, 0, 0);
      pg.renderedScale = scale;
    }).catch(() => { if (pg.task === task) { pg.task = null; pg.rendering = null; } });
  }
  renderVisible();

  // ── 좌표 ──
  function pageAt(pt) {
    for (const pg of state.pages) {
      if (pt.x >= pg.x0 && pt.x <= pg.x0 + pg.w && pt.y >= pg.y0 && pt.y <= pg.y0 + pg.h) return pg;
    }
    return null;
  }
  const local = (pg, pt) => ({ x: pt.x - pg.x0, y: pt.y - pg.y0 });

  // ── 편집 요소 그리기 ──
  function drawEdits(pg) {
    pg.g.querySelectorAll('.edit').forEach((e) => e.remove());
    for (const ed of pg.edits) {
      const e = editEl(ed);
      if (e) { e.classList.add('edit'); pg.g.appendChild(e); }
    }
    if (mode === 'textfix') drawTextBoxes(pg);
    if (mode === 'form') drawWidgets(pg);
  }
  function editEl(ed) {
    switch (ed.type) {
      case 'ink': case 'highlight':
        return svgEl('polyline', { points: ed.pts.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: ed.color, 'stroke-width': ed.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: ed.type === 'highlight' ? 0.45 : 1, style: ed.type === 'highlight' ? 'mix-blend-mode:multiply' : '' });
      case 'text': {
        const t = svgEl('text', { x: ed.x, y: ed.y + ed.size * 0.88, 'font-size': ed.size, fill: ed.color, 'font-family': 'EumFont, sans-serif' });
        ed.text.split('\n').forEach((line, i) => { const ts = svgEl('tspan', { x: ed.x, dy: i ? ed.size * 1.2 : 0 }); ts.textContent = line; t.appendChild(ts); });
        return t;
      }
      case 'rect': return svgEl('rect', { x: Math.min(ed.x1, ed.x2), y: Math.min(ed.y1, ed.y2), width: Math.abs(ed.x2 - ed.x1), height: Math.abs(ed.y2 - ed.y1), fill: 'none', stroke: ed.color, 'stroke-width': ed.width });
      case 'ellipse': return svgEl('ellipse', { cx: (ed.x1 + ed.x2) / 2, cy: (ed.y1 + ed.y2) / 2, rx: Math.abs(ed.x2 - ed.x1) / 2, ry: Math.abs(ed.y2 - ed.y1) / 2, fill: 'none', stroke: ed.color, 'stroke-width': ed.width });
      case 'line': return svgEl('line', { x1: ed.x1, y1: ed.y1, x2: ed.x2, y2: ed.y2, stroke: ed.color, 'stroke-width': ed.width, 'stroke-linecap': 'round' });
      case 'arrow': {
        const g = svgEl('g', { stroke: ed.color, fill: ed.color, 'stroke-width': ed.width, 'stroke-linecap': 'round' });
        g.appendChild(svgEl('line', { x1: ed.x1, y1: ed.y1, x2: ed.x2, y2: ed.y2 }));
        const [a, b] = arrowHead(ed);
        g.appendChild(svgEl('polygon', { points: `${ed.x2},${ed.y2} ${a.x},${a.y} ${b.x},${b.y}` }));
        return g;
      }
      case 'image': return svgEl('image', { x: ed.x, y: ed.y, width: ed.w, height: ed.h, href: ed.dataUrl, preserveAspectRatio: 'none' });
      case 'textfix': {
        const g = svgEl('g', {});
        g.appendChild(svgEl('rect', { x: ed.x - 1, y: ed.y - 1, width: ed.w + 2, height: ed.h + 2, fill: '#fff' }));
        const t = svgEl('text', { x: ed.x, y: ed.y + ed.h * 0.82, 'font-size': ed.h * 0.95, fill: ed.color, 'font-family': 'EumFont, sans-serif' });
        t.textContent = ed.text;
        g.appendChild(t);
        return g;
      }
    }
    return null;
  }
  function arrowHead(ed) {
    const ang = Math.atan2(ed.y2 - ed.y1, ed.x2 - ed.x1), L = 4 + ed.width * 3;
    return [{ x: ed.x2 - L * Math.cos(ang - 0.45), y: ed.y2 - L * Math.sin(ang - 0.45) }, { x: ed.x2 - L * Math.cos(ang + 0.45), y: ed.y2 - L * Math.sin(ang + 0.45) }];
  }

  // ── 글자 고치기: 쪽의 글자 상자 ──
  async function loadTexts(pg) {
    if (pg.texts) return pg.texts;
    const tc = await pg.page.getTextContent();
    const vp = viewport(pg);
    pg.texts = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const [a, b, c, d, e, f] = it.transform;
      const fs = Math.hypot(c, d) || Math.hypot(a, b);
      const corners = [[e, f], [e + it.width, f], [e, f + fs], [e + it.width, f + fs]].map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      pg.texts.push({ str: it.str, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
    return pg.texts;
  }
  function drawTextBoxes(pg) {
    pg.g.querySelectorAll('.tbox').forEach((e) => e.remove());
    for (const t of pg.texts || []) pg.g.appendChild(svgEl('rect', { class: 'tbox edit', x: t.x, y: t.y, width: t.w, height: t.h }));
  }
  // ── 양식(폼) 칸 ──
  async function loadWidgets(pg) {
    if (pg.widgets) return pg.widgets;
    pg.widgets = [];
    if (pg.doc !== 0) return pg.widgets;
    const anns = await pg.page.getAnnotations();
    const vp = viewport(pg);
    for (const a of anns) {
      if (a.subtype !== 'Widget' || !a.fieldName) continue;
      const r = vp.convertToViewportRectangle(a.rect);
      pg.widgets.push({ name: a.fieldName, type: a.fieldType, checkBox: !!a.checkBox, radio: !!a.radioButton, exportValue: a.exportValue, options: a.options || [], value: a.fieldValue, x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]), readOnly: !!a.readOnly });
    }
    return pg.widgets;
  }
  function drawWidgets(pg) {
    pg.g.querySelectorAll('.wbox').forEach((e) => e.remove());
    for (const w of pg.widgets || []) {
      const g = svgEl('g', { class: 'wbox edit' });
      g.appendChild(svgEl('rect', { x: w.x, y: w.y, width: w.w, height: w.h }));
      const v = state.formValues[w.name];
      if (v !== undefined) {
        const t = svgEl('text', { x: w.x + 2, y: w.y + Math.min(w.h * 0.75, 11), 'font-size': Math.min(w.h * 0.7, 10), 'font-family': 'EumFont, sans-serif' });
        t.textContent = w.checkBox || w.radio ? (v ? '✔' : '') : String(v);
        g.appendChild(t);
      }
      pg.g.appendChild(g);
    }
  }

  // ── 측정 ──
  const measure = createMeasure({
    stage, labelLayer,
    locate(pt) {
      const pg = pageAt(pt);
      if (!pg) return null;
      const l = local(pg, pt);
      return { key: pg, x: l.x, y: l.y, origin: { x: pg.x0, y: pg.y0 }, g: pg.g };
    },
    mmPerUnit: () => state.mmPerPt,
    async askScale(pg, p1, p2) {
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const r = await ask('이 두 점 사이의 실제 길이', [{ name: 'mm', label: '실제 길이 (mm)', type: 'number', placeholder: '예: 3000' }]);
      if (!r || !(r.mm > 0)) return false;
      state.mmPerPt = r.mm / d;
      measure.relabel();
      toast('축척이 정해졌습니다. 이제 점을 찍어 재세요.');
      return true;
    },
    onChange() { state.dirty = true; updateTools(); },
  });
  async function setScaleByRatio() {
    const r = await ask('도면 축척', [{ name: 'n', label: '1 : N (예: 100)', type: 'number', value: 100 }]);
    if (!r || !(r.n > 0)) return;
    state.mmPerPt = PT_MM * r.n;
    measure.relabel();
    toast(`축척 1:${r.n} 로 잽니다`);
  }

  // ── 도구 ──
  function addEdit(pg, ed) { pg.edits.push(ed); undoStack.push({ pg, ed }); state.dirty = true; drawEdits(pg); }
  function undo() {
    if (mode === 'measure') { if (!measure.undo()) toast('되돌릴 것이 없습니다'); return; }
    const u = undoStack.pop();
    if (!u) { toast('되돌릴 것이 없습니다'); return; }
    if (u.form) { if (u.prev === undefined) delete state.formValues[u.form]; else state.formValues[u.form] = u.prev; for (const pg of state.pages) drawEdits(pg); return; }
    const i = u.pg.edits.lastIndexOf(u.ed);
    if (i >= 0) u.pg.edits.splice(i, 1);
    drawEdits(u.pg);
  }

  stage.setTapHandler((pt) => { if (!mode) return false; onTap(pt); return true; });
  async function onTap(pt) {
    const pg = pageAt(pt);
    if (!pg) return;
    const l = local(pg, pt);
    if (mode === 'measure') return measure.addPoint(pt);
    if (mode === 'text') {
      const r = await ask('글 넣기', [{ name: 't', type: 'textarea', placeholder: '내용' }, { name: 's', label: '글자 크기(pt)', type: 'number', value: textSize }]);
      if (!r || !r.t.trim()) return;
      textSize = r.s || 12;
      addEdit(pg, { type: 'text', x: l.x, y: l.y, text: r.t, size: textSize, color });
    } else if (mode === 'image') {
      const f = await files.pickOpen('image/*');
      if (!f) return;
      const bytes = await files.readFile(f.uri);
      const mime = /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
      const blob = new Blob([bytes], { type: mime });
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
      const r = await ask('이미지 크기', [{ name: 'mm', label: '가로 길이(mm)', type: 'number', value: 30 }]);
      if (!r || !(r.mm > 0)) return;
      const w = r.mm / PT_MM, h = w * img.height / img.width;
      addEdit(pg, { type: 'image', x: l.x - w / 2, y: l.y - h / 2, w, h, dataUrl, bytes, mime });
    } else if (mode === 'textfix') {
      const texts = await loadTexts(pg);
      const hit = texts.find((t) => l.x >= t.x - 2 && l.x <= t.x + t.w + 2 && l.y >= t.y - 2 && l.y <= t.y + t.h + 2);
      if (!hit) { toast('글자 위를 누르세요'); return; }
      const r = await ask('글자 고치기', [{ name: 't', value: hit.str, type: 'text' }]);
      if (!r) return;
      addEdit(pg, { type: 'textfix', x: hit.x, y: hit.y, w: hit.w, h: hit.h, text: r.t, color: '#000000' });
    } else if (mode === 'form') {
      const ws = await loadWidgets(pg);
      const w = ws.find((t) => l.x >= t.x && l.x <= t.x + t.w && l.y >= t.y && l.y <= t.y + t.h);
      if (!w) { toast('입력란 위를 누르세요'); return; }
      if (w.readOnly) { toast('읽기 전용 칸입니다'); return; }
      const prev = state.formValues[w.name];
      let v;
      if (w.checkBox) v = !(prev !== undefined ? prev : (w.value && w.value !== 'Off'));
      else if (w.radio) v = w.exportValue;
      else if (w.options && w.options.length) {
        const r = await ask(w.name, [{ name: 'v', type: 'select', value: prev ?? w.value, options: w.options.map((o) => ({ label: o.displayValue, value: o.exportValue })) }]);
        if (!r) return; v = r.v;
      } else {
        const r = await ask(w.name, [{ name: 'v', type: 'text', value: prev ?? (w.value || '') }]);
        if (!r) return; v = r.v;
      }
      state.formValues[w.name] = v;
      undoStack.push({ form: w.name, prev });
      state.dirty = true;
      drawEdits(pg);
    }
  }

  // 펜·형광펜·도형: 한 손가락으로 그리기
  function drawHandler() {
    return {
      start(pt) {
        const pg = pageAt(pt); if (!pg) { temp = null; return; }
        const l = local(pg, pt);
        if (mode === 'ink' || mode === 'highlight') temp = { pg, ed: { type: mode, pts: [l], color: mode === 'ink' ? color : hlColor, width: mode === 'ink' ? width : width * 7 } };
        else temp = { pg, ed: { type: shape, x1: l.x, y1: l.y, x2: l.x, y2: l.y, color, width } };
        temp.el = editEl(temp.ed); temp.el.classList.add('edit'); pg.g.appendChild(temp.el);
      },
      move(pt) {
        if (!temp) return;
        const l = local(temp.pg, pt);
        if (temp.ed.pts) temp.ed.pts.push(l); else { temp.ed.x2 = l.x; temp.ed.y2 = l.y; }
        temp.el.remove(); temp.el = editEl(temp.ed); temp.el.classList.add('edit'); temp.pg.g.appendChild(temp.el);
      },
      end(pt, isTap) {
        if (!temp) return;
        temp.el.remove();
        const ed = temp.ed;
        const ok = ed.pts ? ed.pts.length > 1 : Math.hypot(ed.x2 - ed.x1, ed.y2 - ed.y1) > 2;
        if (ok) addEdit(temp.pg, ed);
        temp = null;
      },
      cancel() { if (temp) { temp.el.remove(); temp = null; } },
    };
  }

  const btn = (label, icon, on, cls) => { const b = el('button', 'tool' + (cls ? ' ' + cls : '')); b.innerHTML = `<span class="ic">${icon}</span>${label}`; b.onclick = on; return b; };
  function setMode(m) {
    if (mode === 'measure' && m !== 'measure') measure.setMode(null);
    mode = m;
    stage.setDrawHandler(['ink', 'highlight', 'shape'].includes(m) ? drawHandler() : null);
    if (m === 'textfix') for (const pg of state.pages) loadTexts(pg).then(() => drawEdits(pg));
    else if (m === 'form') for (const pg of state.pages) loadWidgets(pg).then(() => drawEdits(pg));
    for (const pg of state.pages) drawEdits(pg);
    updateTools();
  }
  function updateTools() {
    tools.innerHTML = '';
    const on = (m) => (mode === m ? 'on' : '');
    const sw = (c) => `<span class="swatch" style="background:${c}"></span>`;
    if (mode === 'measure') {
      const mm = measure.mode;
      tools.appendChild(btn('나가기', '←', () => setMode(null)));
      tools.appendChild(btn('거리', '📏', () => { measure.setMode('distance'); updateTools(); }, mm === 'distance' ? 'on' : ''));
      tools.appendChild(btn('면적', '⬠', () => { measure.setMode('area'); updateTools(); }, mm === 'area' ? 'on' : ''));
      tools.appendChild(btn('완료', '✓', () => { measure.finish(); updateTools(); }));
      tools.appendChild(btn('되돌리기', '↶', undo));
      tools.appendChild(btn('축척', '1:N', setScaleByRatio));
      setHint(state.mmPerPt == null ? '축척을 모릅니다 → "축척" 버튼으로 1:N 을 넣거나, 길이를 아는 두 점을 먼저 누르세요'
        : mm === 'area' ? '꼭짓점을 차례로 누른 뒤 완료' : '점을 차례로 누르세요 · 완료로 끝내기');
      return;
    }
    tools.appendChild(btn('보기', '✋', () => setMode(null), mode == null ? 'on' : ''));
    tools.appendChild(btn('펜', '✎', () => setMode('ink'), on('ink')));
    tools.appendChild(btn('형광펜', '▬', () => setMode('highlight'), on('highlight')));
    tools.appendChild(btn('글', 'T', () => setMode('text'), on('text')));
    tools.appendChild(btn('도형', { rect: '▭', ellipse: '◯', line: '╱', arrow: '➚' }[shape], async () => {
      if (mode !== 'shape') return setMode('shape');
      const p = await menu([{ label: '사각형', id: 'rect', icon: '▭' }, { label: '타원', id: 'ellipse', icon: '◯' }, { label: '직선', id: 'line', icon: '╱' }, { label: '화살표', id: 'arrow', icon: '➚' }], '도형');
      if (p) { shape = p.id; updateTools(); }
    }, on('shape')));
    tools.appendChild(btn('이미지', '🖼', () => setMode('image'), on('image')));
    tools.appendChild(btn('글자고치기', '✐', () => setMode('textfix'), on('textfix')));
    tools.appendChild(btn('양식', '☑', () => setMode('form'), on('form')));
    tools.appendChild(btn('측정', '📏', () => setMode('measure'), on('measure')));
    tools.appendChild(btn('쪽', '▤', pagesPanel));
    if (['ink', 'text', 'shape'].includes(mode)) tools.appendChild(btn('색', sw(color), async () => {
      const p = await menu(COLORS.map(([c, n]) => ({ label: n, icon: sw(c), c })), '색');
      if (p) { color = p.c; updateTools(); }
    }));
    if (mode === 'highlight') tools.appendChild(btn('색', sw(hlColor), async () => {
      const p = await menu(HL_COLORS.map(([c, n]) => ({ label: n, icon: sw(c), c })), '형광 색');
      if (p) { hlColor = p.c; updateTools(); }
    }));
    if (['ink', 'highlight', 'shape'].includes(mode)) tools.appendChild(btn('굵기', String(width), async () => {
      const p = await menu([1, 2, 4, 6].map((w) => ({ label: w + 'pt', w })), '굵기');
      if (p) { width = p.w; updateTools(); }
    }));
    if (mode) tools.appendChild(btn('되돌리기', '↶', undo));
    setHint({ ink: '한 손가락으로 그립니다 · 두 손가락으로 이동·확대', highlight: '한 손가락으로 칠합니다', text: '글을 넣을 자리를 누르세요', shape: '한 손가락으로 끌어 그립니다 · 도형 버튼을 다시 누르면 종류 선택',
      image: '이미지를 넣을 자리를 누르세요(도장·서명 등)', textfix: '고칠 글자를 누르세요(흰 상자로 덮고 새 글자를 씁니다)', form: '입력란을 누르세요' }[mode] || '');
  }
  // 메뉴 아이콘에 HTML(색 견본)을 쓰므로 menu 의 아이콘 칸은 innerHTML 로
  updateTools();

  // ── 쪽 관리 ──
  async function pagesPanel() {
    const back = el('div', 'backdrop');
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('span', null, `쪽 관리 (${state.pages.length}쪽)`));
    const close = el('button', 'btn', '닫기');
    close.onclick = () => back.remove();
    head.appendChild(close);
    panel.appendChild(head);
    const list = el('div', 'panel-list');
    panel.appendChild(list);
    const foot = el('div', 'panel-foot');
    const ins = el('button', 'btn', 'PDF 끼워넣기');
    ins.onclick = async () => {
      const f = await files.pickOpen('application/pdf');
      if (!f) return;
      try {
        const d = await loadDoc(await files.readFile(f.uri));
        docs.push(d);
        for (let i = 0; i < d.pdf.numPages; i++) state.pages.push(await makePage(docs.length - 1, i));
        state.dirty = true; layout(); renderVisible(); refresh();
        toast(`${d.pdf.numPages}쪽을 끝에 넣었습니다. 순서는 ↑↓ 로 옮기세요.`);
      } catch (e) { toast('PDF 를 열 수 없습니다: ' + e.message); }
    };
    const ext = el('button', 'btn', '일부 쪽만 저장(나누기)');
    ext.onclick = async () => {
      const r = await ask('저장할 쪽', [{ name: 'r', label: '예: 1-3,5', placeholder: '1-3,5', value: '1-' + state.pages.length }]);
      if (!r) return;
      const idx = parseRange(r.r, state.pages.length);
      if (!idx.length) return toast('쪽 범위가 잘못됐습니다');
      const target = await files.pickSave(ctx.name.replace(/\.pdf$/i, '') + '_일부.pdf');
      if (!target) return;
      setHint('저장 중…');
      try {
        const bytes = await extractPages(state, idx, await fontBytes());
        await files.writeFile(target.uri, bytes, target.name);
        toast('저장했습니다: ' + target.name);
      } catch (e) { toast('저장 실패: ' + e.message); }
      setHint('');
    };
    foot.append(ins, ext);
    panel.appendChild(foot);
    back.appendChild(panel);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    function refresh() {
      list.innerHTML = '';
      head.firstChild.textContent = `쪽 관리 (${state.pages.length}쪽)`;
      state.pages.forEach((pg, i) => {
        const row = el('div', 'prow');
        const th = el('canvas', 'thumb');
        row.appendChild(th);
        thumb(pg, th);
        row.appendChild(el('span', 'pname', `${i + 1}쪽`));
        const b = (t, fn) => { const x = el('button', 'btn small', t); x.onclick = fn; row.appendChild(x); };
        b('↑', () => { if (i > 0) { state.pages.splice(i - 1, 0, state.pages.splice(i, 1)[0]); after(); } });
        b('↓', () => { if (i < state.pages.length - 1) { state.pages.splice(i + 1, 0, state.pages.splice(i, 1)[0]); after(); } });
        b('⟳', () => { rotatePage(pg); after(); });
        b('✕', async () => { if (state.pages.length === 1) return toast('마지막 쪽은 지울 수 없습니다'); if (await confirmBox(`${i + 1}쪽을 지울까요?`, '지우기')) { state.pages.splice(i, 1); after(); } });
        list.appendChild(row);
      });
    }
    function after() { state.dirty = true; layout(); renderVisible(); measure.redraw((pg) => state.pages.includes(pg) ? { g: pg.g, origin: { x: pg.x0, y: pg.y0 } } : null); refresh(); }
    refresh();
  }
  function thumb(pg, canvas) {
    const vp = viewport(pg, 0.25);
    canvas.width = vp.width; canvas.height = vp.height;
    pg.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.catch(() => {});
  }
  function rotatePage(pg) {
    const h = pg.h;
    const map = (p) => ({ x: h - p.y, y: p.x });
    pg.rot = (pg.rot + 90) % 360;
    for (const ed of pg.edits) {
      if (ed.pts) ed.pts = ed.pts.map(map);
      else if ('x1' in ed) { const a = map({ x: ed.x1, y: ed.y1 }), b = map({ x: ed.x2, y: ed.y2 }); ed.x1 = a.x; ed.y1 = a.y; ed.x2 = b.x; ed.y2 = b.y; }
      else if (ed.type === 'image' || ed.type === 'textfix') { const a = map({ x: ed.x, y: ed.y + ed.h }); ed.x = a.x; ed.y = a.y; [ed.w, ed.h] = [ed.h, ed.w]; }
      else { const a = map({ x: ed.x, y: ed.y }); ed.x = a.x; ed.y = a.y; }
    }
    pg.texts = null; pg.widgets = null; pg.renderedScale = null;
    for (const it of measure.items) if (it.key === pg) it.pts = it.pts.map(map);
  }
  function parseRange(s, n) {
    const out = [];
    for (const part of s.split(',')) {
      const m = part.trim().match(/^(\d+)?\s*-?\s*(\d+)?$/);
      if (!m || !part.trim()) continue;
      if (part.includes('-')) { const a = Number(m[1] || 1), b = Number(m[2] || n); for (let i = a; i <= b; i++) if (i >= 1 && i <= n && !out.includes(i - 1)) out.push(i - 1); }
      else { const i = Number(m[1]); if (i >= 1 && i <= n && !out.includes(i - 1)) out.push(i - 1); }
    }
    return out;
  }

  let font = null;
  async function fontBytes() {
    if (!font) font = new Uint8Array(await (await fetch('./NotoSansKR-sub.ttf')).arrayBuffer());
    return font;
  }

  async function save(target) {
    setHint('저장 중…');
    try {
      const bytes = await exportPdf(state, measure.items, measure.labelFor, await fontBytes());
      await files.writeFile(target.uri, bytes, target.name);
      state.dirty = false;
      toast('저장했습니다: ' + target.name);
      return true;
    } catch (e) {
      console.error(e);
      toast('저장 실패: ' + e.message, 4000);
      return false;
    } finally { setHint(''); updateTools(); }
  }

  return {
    type: 'pdf',
    dirty: () => state.dirty,
    save: () => save({ uri: ctx.uri, name: ctx.name }),
    async saveAs() {
      const t = await files.pickSave(ctx.name);
      if (!t) return false;
      const ok = await save(t);
      if (ok) { ctx.uri = t.uri; ctx.name = t.name; files.remember(t.uri, t.name); }
      return ok;
    },
    async more() {
      const pick = await menu([
        { label: '저장', icon: '💾', id: 'save' },
        { label: '다른 이름으로 저장', icon: '📄', id: 'saveas' },
        { label: '공유', icon: '📤', id: 'share' },
        '-',
        { label: '쪽 관리(회전·삭제·순서·합치기·나누기)', icon: '▤', id: 'pages' },
        { label: '축척 정하기(1:N)', icon: '📐', id: 'scale' },
        { label: '측정 모두 지우기', icon: '🧹', id: 'clear' },
        { label: '폭 맞춤', icon: '⤢', id: 'fit' },
      ]);
      if (!pick) return;
      if (pick.id === 'save') await this.save();
      if (pick.id === 'saveas') await this.saveAs();
      if (pick.id === 'share') { if (!state.dirty || await this.save()) await files.share(ctx.uri, ctx.name); }
      if (pick.id === 'pages') pagesPanel();
      if (pick.id === 'scale') setScaleByRatio();
      if (pick.id === 'clear') measure.clear();
      if (pick.id === 'fit') stage.fitWidth();
    },
    destroy() {
      closed = true; clearTimeout(renderTimer);
      for (const pg of state.pages) if (pg.task) pg.task.cancel();
      for (const d of docs) d.pdf.destroy();
      measure.clear(); content.innerHTML = ''; labelLayer.innerHTML = ''; stage.setTapHandler(null); stage.setDrawHandler(null);
    },
  };
}
