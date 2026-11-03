// 계통도 화면: 배치도와 같은 데이터(장비·케이블)를 공유. 노드 이동 시 device.sch에 수동 위치 저장
import * as ED from './editor.js';
import { E } from './editor.js';
import * as P from './panels.js';
import { toast } from './ui.js';
const CAT = window.CCTVCatalog, C = window.CCTVCalc, SCH = window.CCTVSchematic;
const NS = 'http://www.w3.org/2000/svg';
export const state = { groupBy: 'zone', layout: null, view: { z: 1, tx: 20, ty: 20 } };
const el = (tag, a, p) => { const e = document.createElementNS(NS, tag); for (const k in a || {}) if (a[k] != null) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
export function enter(regen) { state.layout = null; render(); if (!regen) fit(); }
export function fit() { const L = state.layout; if (!L) return; const r = document.getElementById('svg').getBoundingClientRect(); const z = Math.min(r.width / L.width, r.height / L.height) * 0.95; state.view = { z, tx: 10, ty: 10 }; render(); }
export function resetManual() { const ch = E.model.devices.filter(d => d.sch && d.sch.manual).map(d => { const a = JSON.parse(JSON.stringify(d)); delete a.sch; return { e: 'devices', before: JSON.parse(JSON.stringify(d)), after: a }; }); ED.commit('계통도 수동 위치 초기화', ch); toast(`${ch.length}개 장비의 수동 위치를 초기화했습니다.`); }
export function render() {
  const svg = document.getElementById('svg'); svg.innerHTML = '';
  const L = state.layout = SCH.layout(E.model, { groupBy: state.groupBy });
  const vp = el('g', { transform: `matrix(${state.view.z},0,0,${state.view.z},${state.view.tx},${state.view.ty})` }, svg);
  el('rect', { x: 0, y: 0, width: L.width, height: L.height, fill: '#fff', stroke: '#ddd' }, vp);
  L.groups.forEach(g => { el('rect', { x: g.x0, y: g.y0, width: g.x1 - g.x0, height: g.y1 - g.y0, fill: 'none', stroke: '#aaa', 'stroke-dasharray': '5 4' }, vp); const t = el('text', { x: g.x0 + 4, y: g.y0 + 12, 'font-size': 10, fill: '#777' }, vp); t.textContent = g.label; });
  const nm = new Map(L.nodes.map(n => [n.id, n]));
  const lay = k => (ED.layers().find(l => l.key === k) || {});
  L.edges.forEach(e => {
    const R = e.route; const [x1, y1] = R[0], [x2, y2] = R[R.length - 1]; const pa = e.a, pb = e.b;
    const KD = CAT.CABLE_KINDS[e.kind]; const col = e.part === 'power' ? lay('POWER').color : lay(KD.layer).color;
    const g = el('g', { 'data-id': e.cable.id, style: 'cursor:pointer' }, vp);
    const d = 'M' + R.map(p => p.join(' ')).join('L');
    el('path', { d, stroke: 'transparent', 'stroke-width': 8, fill: 'none' }, g);
    el('path', { d, stroke: E.sel.has(e.cable.id) ? '#ff6a00' : col, 'stroke-width': e.part === 'power' ? 1.2 : 1.8, fill: 'none', 'stroke-dasharray': e.part === 'power' ? '10 3 2 3' : KD.dash }, g);
    const t = el('text', { x: x1 + 4, y: y1 - 3, 'font-size': 8, fill: col }, g); t.textContent = e.label;
    const t1 = el('text', { x: x1 - 3, y: y1 + 3, 'font-size': 7, 'text-anchor': 'end', fill: '#333' }, g); t1.textContent = pa.port || '';
    const t2 = el('text', { x: x2 + 3, y: y2 + 3, 'font-size': 7, fill: '#333' }, g); t2.textContent = pb.port || '';
  });
  L.nodes.forEach(n => {
    const lb = SCH.nodeLabel(n.dev); const T = CAT.DEVICE_TYPES[n.dev.type]; const col = lay(n.dev.layer || T.layer).color || '#333';
    const g = el('g', { 'data-id': n.id, 'data-node': '1', style: 'cursor:move' }, vp);
    el('rect', { x: n.x, y: n.y, width: n.w, height: n.h, fill: '#fff', stroke: E.sel.has(n.id) ? '#ff6a00' : col, 'stroke-width': E.sel.has(n.id) ? 2.5 : 1.2 }, g);
    const t = el('text', { x: n.x + 5, y: n.y + 15, 'font-size': 11, 'font-weight': 700 }, g); t.textContent = lb.title;
    const s = el('text', { x: n.x + 5, y: n.y + 30, 'font-size': 8, fill: '#444' }, g); s.textContent = lb.sub;
    const m = el('text', { x: n.x + 5, y: n.y + 44, 'font-size': 8, fill: '#666' }, g); m.textContent = (lb.model || '') + (n.manual ? ' · 수동 위치' : '');
  });
  const note = el('text', { x: 8, y: L.height - 10, 'font-size': 9, fill: '#888' }, vp); note.textContent = '※ 배치도와 같은 데이터로 생성됩니다. 장비를 끌어 위치를 조정하면 재생성 시에도 유지됩니다. 호환성 판정은 설계 검토 결과를 확인하세요.';
}
let drag = null;
export function onDown(e) {
  const t = e.target.closest('[data-id]'); const svg = document.getElementById('svg');
  if (!t) { drag = { pan: true, sx: e.clientX, sy: e.clientY, tx: state.view.tx, ty: state.view.ty }; E.sel.clear(); P.refreshProps(); svg.setPointerCapture(e.pointerId); return; }
  const id = t.getAttribute('data-id'); E.sel = new Set([id]); P.refreshProps();
  if (t.getAttribute('data-node') && ED.canEdit()) { const n = state.layout.nodes.find(x => x.id === id); const dv = E.model.devices.find(x => x.id === id); drag = { id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, moved: false, prevSch: dv.sch ? JSON.parse(JSON.stringify(dv.sch)) : null }; svg.setPointerCapture(e.pointerId); }
  render();
}
export function onMove(e) {
  if (!drag) return; const z = state.view.z;
  if (drag.pan) { state.view.tx = drag.tx + e.clientX - drag.sx; state.view.ty = drag.ty + e.clientY - drag.sy; render(); return; }
  const d = E.model.devices.find(x => x.id === drag.id); drag.moved = true;
  d.sch = { x: Math.round(drag.x + (e.clientX - drag.sx) / z), y: Math.round(drag.y + (e.clientY - drag.sy) / z), manual: true }; render();
}
export function onUp() {
  if (drag && drag.moved) { const d = E.model.devices.find(x => x.id === drag.id); const after = JSON.parse(JSON.stringify(d)); const before = JSON.parse(JSON.stringify(d)); before.sch = drag.prevSch; if (!drag.prevSch) delete before.sch; d.sch = before.sch; if (!before.sch) delete d.sch; ED.commit('계통도 위치 조정', [{ e: 'devices', before, after }]); }
  drag = null;
}
document.addEventListener('wheel', e => { if (E.mode !== 'schematic' || !e.target.closest || !e.target.closest('#svg')) return; e.preventDefault(); e.stopPropagation(); const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const r = document.getElementById('svg').getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top; state.view.tx = cx - (cx - state.view.tx) * f; state.view.ty = cy - (cy - state.view.ty) * f; state.view.z *= f; render(); }, { passive: false, capture: true });
