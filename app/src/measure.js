// 거리·면적 측정. 점을 찍어 가며 선을 그리고, 값은 화면 크기 고정 라벨로 보여 준다.
import { el, fmtLen, fmtArea } from './ui.js';

export function polyLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
const NS = 'http://www.w3.org/2000/svg';
export function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/**
 * opts:
 *  stage        — createStage() 결과
 *  labelLayer   — 라벨을 넣을 div(무대 위, 변환 없음)
 *  locate(pt)   — 내용 좌표 → { key, x, y, origin:{x,y}, g, toContent? } (해당 쪽의 SVG 그룹과 쪽 안 좌표;
 *                 toContent(p) 가 있으면 쪽 좌표→내용 좌표 변환에 그것을 쓴다). 없으면 null
 *  mmPerUnit(key) — 쪽 좌표 1 단위가 몇 mm 인지. 모르면 null
 *  askScale(key, p1, p2) — 축척을 모를 때 물어보는 함수(Promise<boolean>)
 *  onChange()   — 측정 목록이 바뀌었을 때
 */
export function createMeasure(opts) {
  const items = []; // { key, kind:'distance'|'area', pts:[{x,y}], el, label }
  let mode = null;
  let cur = null;
  let awaitingScale = null;

  function labelFor(item) {
    const mm = opts.mmPerUnit(item.key);
    if (item.kind === 'area') {
      const a = polyArea(item.pts);
      return mm ? fmtArea(a * mm * mm) : a.toFixed(1) + ' 단위²';
    }
    const d = polyLength(item.pts);
    return mm ? fmtLen(d * mm) : d.toFixed(1) + ' 단위';
  }
  function anchor(item) {
    if (item.kind === 'area') {
      const c = item.pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
      return { x: c.x / item.pts.length, y: c.y / item.pts.length };
    }
    const p = item.pts[item.pts.length - 1], q = item.pts[item.pts.length - 2] || p;
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  function draw(item) {
    if (item.el) item.el.remove();
    const pts = item.pts.map((p) => `${p.x},${p.y}`).join(' ');
    const g = svgEl('g', { class: 'measure' });
    g.appendChild(svgEl(item.kind === 'area' && item.done ? 'polygon' : 'polyline', { points: pts }));
    const r = item.markerR ? item.markerR() : 3;
    for (const p of item.pts) g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r }));
    item.el = g;
    item.g.appendChild(g);
    if (!item.label) { item.label = el('div', 'mlabel'); opts.labelLayer.appendChild(item.label); }
    item.label.textContent = labelFor(item);
    place(item);
  }
  function place(item) {
    const t = opts.stage.transform;
    const a = anchor(item);
    const c = item.toContent ? item.toContent(a) : { x: item.origin.x + a.x, y: item.origin.y + a.y };
    item.label.style.left = c.x * t.s + t.tx + 'px';
    item.label.style.top = c.y * t.s + t.ty + 'px';
  }
  function refresh() { for (const it of items) if (it.label) place(it); }
  opts.stage.onChange(refresh);

  async function addPoint(pt) {
    if (!mode) return;
    const loc = opts.locate(pt);
    if (!loc) return;
    if (awaitingScale) {
      awaitingScale.pts.push({ x: loc.x, y: loc.y });
      awaitingScale.g = loc.g; awaitingScale.origin = loc.origin; awaitingScale.key = loc.key; awaitingScale.toContent = loc.toContent; awaitingScale.markerR = loc.markerR;
      draw(awaitingScale);
      if (awaitingScale.pts.length === 2) {
        const [p1, p2] = awaitingScale.pts;
        const ok = await opts.askScale(loc.key, p1, p2);
        awaitingScale.el.remove(); awaitingScale.label.remove();
        awaitingScale = null;
        if (ok) opts.onChange();
      }
      return;
    }
    if (opts.mmPerUnit(loc.key) == null && opts.askScale) {
      awaitingScale = { key: loc.key, kind: 'distance', pts: [{ x: loc.x, y: loc.y }], g: loc.g, origin: loc.origin, toContent: loc.toContent, markerR: loc.markerR };
      draw(awaitingScale);
      awaitingScale.label.textContent = '기준 길이의 두 번째 점을 누르세요';
      return;
    }
    if (!cur || cur.key !== loc.key) {
      finish();
      cur = { key: loc.key, kind: mode, pts: [], g: loc.g, origin: loc.origin, toContent: loc.toContent, markerR: loc.markerR, done: false };
      items.push(cur);
    }
    cur.pts.push({ x: loc.x, y: loc.y });
    draw(cur);
  }
  function finish() {
    if (!cur) return;
    const min = cur.kind === 'area' ? 3 : 2;
    if (cur.pts.length < min) remove(cur);
    else { cur.done = true; draw(cur); }
    cur = null;
    opts.onChange();
  }
  function remove(item) {
    if (item.el) item.el.remove();
    if (item.label) item.label.remove();
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
  }

  return {
    items,
    get mode() { return mode; },
    setMode(m) { finish(); mode = m; if (awaitingScale) { awaitingScale.el.remove(); awaitingScale.label.remove(); awaitingScale = null; } },
    addPoint,
    finish,
    /** 마지막 점(또는 마지막 측정)을 지운다. */
    undo() {
      if (cur && cur.pts.length) { cur.pts.pop(); if (cur.pts.length) draw(cur); else { remove(cur); cur = null; } return true; }
      if (items.length) { remove(items[items.length - 1]); opts.onChange(); return true; }
      return false;
    },
    clear() { for (const it of [...items]) remove(it); cur = null; opts.onChange(); },
    /** 축척이 바뀌었을 때 라벨 다시 계산 */
    relabel() { for (const it of items) { if (it.label) it.label.textContent = labelFor(it); } },
    /** 쪽 그룹이 다시 만들어졌을 때(회전 등) 다시 그린다. */
    redraw(keyToGroup) {
      for (const it of items) {
        const loc = keyToGroup(it.key);
        if (!loc) { remove(it); continue; }
        it.g = loc.g; it.origin = loc.origin;
        if (loc.map) it.pts = it.pts.map(loc.map);
        draw(it);
      }
    },
    labelFor,
    anchor,
  };
}
