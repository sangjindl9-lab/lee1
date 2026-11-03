// 설계 편집기 핵심: 상태, 저장(자동·수동·충돌), 실행취소, 렌더링, 도구
import { api, toast, h, modal, esc, confirmBox, uuid } from './ui.js';
import * as P from './panels.js';
import * as SV from './schview.js';

const CAT = window.CCTVCatalog, C = window.CCTVCalc, SYM = window.CCTVSymbols;
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const ENTS = ['devices', 'cables', 'conduits', 'annotations'];

export const E = {
  pid: null, me: null, role: null, model: null, sheetId: null,
  view: { z: 1, tx: 0, ty: 0 }, tool: 'select', toolOpt: null, sel: new Set(), dirty: new Map(), serverVer: new Map(), gen: 0,
  undo: [], redo: [], snap: { grid: false, end: true, port: true, ortho: false }, keepConn: true, snapView: null, temp: null, trace: null, mode: 'plan',
  layerVis: {}, bgCache: {}, clip: null, saving: false, saveFail: null
};
window.E = E; // 디버그·검증용
const LS_KEY = () => 'cctv-pending-' + E.pid;

export const canEdit = () => !E.snapView && ['admin', 'designer'].includes(E.role);
export const canField = () => !E.snapView && ['admin', 'designer', 'reviewer'].includes(E.role);
export const sheet = () => E.model.sheets.find(s => s.id === E.sheetId);
export function all() { return ENTS.flatMap(e => E.model[e].map(o => ({ e, o }))); }
export function find(id) { for (const e of ENTS) { const o = E.model[e].find(x => x.id === id); if (o) return { e, o }; } return null; }
export const dev = id => E.model.devices.find(d => d.id === id);

// ===== 열기 =====
export async function openEditor(pid, sid, me) {
  if (E.pid && E.pid !== pid && E.dirty.size) { if (!await confirmBox('저장되지 않은 변경이 있습니다. 이동하면 변경 내용은 브라우저 임시 보관함에 남습니다. 계속할까요?')) { location.hash = '#/p/' + E.pid; return; } }
  if (E.pid === pid && E.model) { if (sid && sid !== E.sheetId) selectSheet(sid); return; }
  Object.assign(E, { pid, me, sel: new Set(), dirty: new Map(), serverVer: new Map(), undo: [], redo: [], trace: null, mode: 'plan', tool: 'select' });
  await reload();
  try { E.layerVis = JSON.parse(localStorage.getItem('cctv-layervis-' + pid) || '{}'); } catch { E.layerVis = {}; }
  const firstSheet = sid && E.model.sheets.find(s => s.id === sid) ? sid : (E.model.sheets[0] || {}).id;
  P.buildChrome();
  selectSheet(firstSheet, true);
  checkRecovery();
  startTimers();
}
export async function reload(keepView) {
  const m = await api(`/api/projects/${E.pid}/model`);
  E.model = m; E.role = m.project.my_role;
  E.serverVer = new Map(); ENTS.forEach(e => m[e].forEach(o => E.serverVer.set(o.id, o.ver)));
  E.dirty.clear(); updateSaveState();
  if (keepView) { P.refreshAll(); render(); }
}
export function selectSheet(sid, fit) {
  E.sheetId = sid; E.sel.clear(); E.temp = null;
  if (sid && location.hash !== `#/p/${E.pid}/s/${sid}`) history.replaceState(null, '', `#/p/${E.pid}/s/${sid}`);
  renderBg().then(() => { if (fit !== false) fitView(); });
  P.refreshAll(); render();
}

// ===== 변경·실행취소 =====
// changes: [{e, before, after}] (before/after: 객체 복사본 또는 null)
export function commit(label, changes, opts = {}) {
  changes = changes.filter(c => JSON.stringify(c.before) !== JSON.stringify(c.after));
  if (!changes.length) return;
  if (!canEdit() && !opts.allowField) { toast('편집 권한이 없습니다.', true); revertLive(changes); return; }
  applyChanges(changes, 'after');
  E.undo.push({ label, changes }); if (E.undo.length > 200) E.undo.shift(); E.redo = [];
  afterChange();
}
function applyChanges(changes, side) {
  changes.forEach(c => {
    const target = c[side]; const id = (c.after || c.before).id; const arr = E.model[c.e];
    const i = arr.findIndex(x => x.id === id);
    if (target) { if (i >= 0) arr[i] = clone(target); else arr.push(clone(target)); }
    else if (i >= 0) arr.splice(i, 1);
    markDirty(c.e, id, target ? 'upsert' : 'delete');
  });
}
function revertLive(changes) { applyChanges(changes, 'before'); render(); }
export function undo() { const u = E.undo.pop(); if (!u) return; applyChanges(u.changes.slice().reverse(), 'before'); E.redo.push(u); toast('실행 취소: ' + u.label); afterChange(); }
export function redo() { const u = E.redo.pop(); if (!u) return; applyChanges(u.changes, 'after'); E.undo.push(u); toast('다시 실행: ' + u.label); afterChange(); }
function markDirty(e, id, op) {
  const k = e + '|' + id;
  if (op === 'delete' && !E.serverVer.has(id)) E.dirty.delete(k); // 저장 전 생성·삭제
  else E.dirty.set(k, { e, id, op, gen: ++E.gen });
  updateSaveState(); stash();
}
export function update(e, obj, fn, label) { const before = clone(obj); const after = clone(obj); fn(after); commit(label || '속성 변경', [{ e, before, after }]); return E.model[e].find(x => x.id === obj.id); }
function afterChange() { render(); P.refreshProps(); P.scheduleTables(); }

// ===== 저장 =====
function updateSaveState() {
  const s = $('saveState'); if (!s) return;
  if (E.saveFail) { s.className = 'savebox fail'; s.textContent = '저장 실패 – ' + E.dirty.size + '건 미저장'; }
  else if (E.saving) { s.className = 'savebox dirty'; s.textContent = '저장 중…'; }
  else if (E.dirty.size) { s.className = 'savebox dirty'; s.textContent = '미저장 ' + E.dirty.size + '건'; }
  else { s.className = 'savebox saved'; s.textContent = '저장됨'; }
}
function stash() { try { if (E.dirty.size) localStorage.setItem(LS_KEY(), JSON.stringify({ at: new Date().toISOString(), ops: buildOps() })); else localStorage.removeItem(LS_KEY()); } catch { } }
function buildOps() {
  return [...E.dirty.values()].map(d => {
    if (d.op === 'delete') return { op: 'delete', entity: d.e, id: d.id, ver: E.serverVer.get(d.id) };
    const o = E.model[d.e].find(x => x.id === d.id); if (!o) return null;
    const data = clone(o); delete data.ver; delete data.updated_at; delete data.updated_by;
    return { op: 'upsert', entity: d.e, data, ver: E.serverVer.get(d.id) };
  }).filter(Boolean);
}
export async function save(opts = {}) {
  if (E.saving || !E.dirty.size) return true;
  if (!canEdit()) { toast('편집 권한이 없어 저장할 수 없습니다.', true); return false; }
  E.saving = true; updateSaveState();
  const snapshot = new Map([...E.dirty.entries()].map(([k, v]) => [k, v.gen]));
  const ops = buildOps();
  try {
    const r = await api(`/api/projects/${E.pid}/batch`, { body: { ops, force: !!opts.force, reason: opts.reason } });
    r.results.forEach(x => { if (x.deleted) E.serverVer.delete(x.id); else { E.serverVer.set(x.id, x.ver); const o = E.model[x.entity].find(y => y.id === x.id); if (o) o.ver = x.ver; } });
    snapshot.forEach((g, k) => { const d = E.dirty.get(k); if (d && d.gen === g) E.dirty.delete(k); });
    E.saveFail = null; hideBanner('savefail'); stash();
    return true;
  } catch (e) {
    if (e.status === 409) { E.saveFail = null; await conflictDialog(e.data.conflicts); return false; }
    E.saveFail = e.message; stash();
    showBanner('savefail', `자동 저장 실패: ${e.message} — 변경 내용 ${E.dirty.size}건은 이 브라우저에 임시 보관되었습니다.`, [['다시 시도', () => save()], ['변경 내용 파일로 받기', exportPending]]);
    return false;
  } finally { E.saving = false; updateSaveState(); }
}
function exportPending() { const b = new Blob([JSON.stringify({ project: E.pid, ops: buildOps() }, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(b), download: '미저장_변경내용.json' }); a.click(); }
async function conflictDialog(conf) {
  const list = h('ul', null, conf.map(c => h('li', null, `${{ devices: '장비', cables: '케이블', conduits: '관로', annotations: '주석' }[c.entity]} ${c.current ? (c.current.tag || c.current.type || '') : '(삭제됨)'} — 수정자 ${c.current ? c.current.updated_by || '' : ''} ${c.current ? c.current.updated_at || '' : ''}`)));
  const v = await modal('동시 편집 충돌', h('div', null, h('p', null, '다른 사용자가 같은 객체를 먼저 수정했습니다. 아무것도 저장되지 않았습니다.'), list), [{ label: '서버 버전 불러오기 (내 변경 취소)', value: 'reload' }, { label: '내 변경으로 덮어쓰기', value: 'force', danger: true }]);
  if (v === 'reload') { await reload(true); toast('서버 최신 버전을 불러왔습니다.'); }
  else if (v === 'force') { await save({ force: true }); }
}
function checkRecovery() {
  let p; try { p = JSON.parse(localStorage.getItem(LS_KEY()) || 'null'); } catch { }
  if (!p || !p.ops || !p.ops.length) return;
  showBanner('recover', `이전 세션에서 저장되지 않은 변경 ${p.ops.length}건이 있습니다 (${p.at.slice(0, 16).replace('T', ' ')}).`, [['복구 후 저장', async () => {
    p.ops.forEach(op => { const arr = E.model[op.entity]; if (op.op === 'delete') { const i = arr.findIndex(x => x.id === op.id); if (i >= 0) arr.splice(i, 1); } else { const i = arr.findIndex(x => x.id === op.data.id); if (i >= 0) arr[i] = op.data; else arr.push(op.data); } E.dirty.set(op.entity + '|' + (op.id || op.data.id), { e: op.entity, id: op.id || op.data.id, op: op.op, gen: ++E.gen }); if (op.ver != null) E.serverVer.set(op.id || op.data.id, op.ver); });
    hideBanner('recover'); render(); P.refreshAll(); await save();
  }], ['버리기', () => { localStorage.removeItem(LS_KEY()); hideBanner('recover'); }]]);
}
export function showBanner(key, msg, actions, info) {
  hideBanner(key);
  $('banners').appendChild(h('div', { class: 'banner' + (info ? ' info' : ''), 'data-k': key }, h('span', { class: 'grow' }, msg), (actions || []).map(([l, f]) => h('button', { onclick: f }, l))));
}
export function hideBanner(key) { const b = $('banners').querySelector(`[data-k="${key}"]`); if (b) b.remove(); }
let timers = [];
function startTimers() {
  timers.forEach(clearInterval); timers = [];
  let lastSeq = null;
  timers.push(setInterval(() => { if (E.dirty.size && !E.drag && !E.saving && canEdit()) save(); }, 5000));
  const hb = async () => {
    try {
      const r = await api(`/api/projects/${E.pid}/heartbeat`, { body: { sheet: E.sheetId, editing: E.dirty.size > 0, since: lastSeq || 0 } });
      $('presence').textContent = r.others.length ? '접속 중: ' + r.others.map(o => o.name + (o.editing ? '(편집 중)' : '')).join(', ') : '';
      if (lastSeq != null && r.log_seq > lastSeq && r.foreign > 0 && !E.saving && !E.snapView) {
        if (!E.dirty.size) { await reload(true); toast('다른 사용자의 변경 내용을 반영했습니다.'); }
        else showBanner('remote', '다른 사용자가 이 프로젝트를 변경했습니다. 저장 후 새로 불러오세요.', [['저장 후 새로고침', async () => { if (await save()) { await reload(true); hideBanner('remote'); } }]], true);
      }
      lastSeq = r.log_seq;
    } catch { }
  };
  hb(); timers.push(setInterval(hb, 15000));
  window.onbeforeunload = () => E.dirty.size ? '저장되지 않은 변경이 있습니다.' : undefined;
}
// 내 저장으로 인한 log_seq 증가는 무시하도록 저장 직후 heartbeat 기준 갱신
const _save = save;

// ===== 좌표·뷰 =====
const svg = () => $('svg');
export function toDraw(e) { const r = svg().getBoundingClientRect(); return [(e.clientX - r.left - E.view.tx) / E.view.z, (e.clientY - r.top - E.view.ty) / E.view.z]; }
export function sheetDims(s) { s = s || sheet(); if (!s) return [1000, 700]; const W = s.bg.width || 1000, H = s.bg.height || 700; return (s.rotation || 0) % 180 ? [H, W] : [W, H]; }
export function fitView(box) {
  const r = svg().getBoundingClientRect(); const [W, H] = sheetDims(); const b = box || { x: 0, y: 0, w: W, h: H };
  if (!b.w || !b.h || !r.width) return;
  const z = Math.min(r.width / b.w, r.height / b.h) * 0.94;
  E.view = { z, tx: r.width / 2 - (b.x + b.w / 2) * z, ty: r.height / 2 - (b.y + b.h / 2) * z }; applyView();
}
function applyView() { const vp = svg().querySelector('#vp'); if (vp) vp.setAttribute('transform', `matrix(${E.view.z},0,0,${E.view.z},${E.view.tx},${E.view.ty})`); status(); renderOverlay(); }
export function zoomAt(f, cx, cy) { const z = Math.min(Math.max(E.view.z * f, 1e-4), 1e4); E.view.tx = cx - (cx - E.view.tx) * z / E.view.z; E.view.ty = cy - (cy - E.view.ty) * z / E.view.z; E.view.z = z; applyView(); }
export function zoomTo(id) {
  const f = find(id); if (!f) return;
  const o = f.o; if (o.sheet_id && o.sheet_id !== E.sheetId) selectSheet(o.sheet_id, false);
  setTimeout(() => {
    const pts = o.points ? (f.e === 'cables' ? C.cablePoints(o, C.index(E.model)) : o.points) : [[o.x, o.y]];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const s = symSize() * 6;
    fitView({ x: Math.min(...xs) - s, y: Math.min(...ys) - s, w: Math.max(...xs) - Math.min(...xs) + 2 * s, h: Math.max(...ys) - Math.min(...ys) + 2 * s });
    E.sel = new Set([id]); render(); P.refreshProps();
  }, 60);
}
export const symSize = () => { const s = sheet(); if (!s) return 20; const [W, H] = sheetDims(s); return +(s.sym_size || Math.max(W, H) / 70); };
const labSize = () => { const s = sheet(); return +((s && s.label_size) || symSize() * 0.42); };
const px = n => n / E.view.z; // 화면 픽셀 → 도면 단위

// ===== 렌더링 =====
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
function bgMatrix(rot, W, H) { return { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, H, 0], 180: [-1, 0, 0, -1, W, H], 270: [0, -1, 1, 0, 0, W] }[rot || 0]; }
export function layers() { return (E.model.project.settings.layers || CAT.LAYERS); }
const layerOf = k => layers().find(l => l.key === k) || { color: '#333', dash: '', lw: 0.3 };
export const layerVisible = k => E.layerVis[k] !== false;
const layerLocked = k => !!layerOf(k).locked;

function ensureSvg() {
  const s = svg(); if (s.querySelector('#vp')) return;
  s.innerHTML = '';
  const defs = el('defs', null, s);
  defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" fill="#000"/></marker>';
  const vp = el('g', { id: 'vp' }, s);
  ['bg', 'grid', 'cov', 'fov', 'conduits', 'cables', 'devices', 'ann', 'overlay'].forEach(id => el('g', { id: 'L_' + id }, vp));
  bindEvents();
}
export async function renderBg() {
  ensureSvg(); const g = svg().querySelector('#L_bg'); g.innerHTML = '';
  const s = sheet(); if (!s) { g.appendChild(el('text', { x: 20, y: 40, 'font-size': 18, fill: '#888' })).textContent = '도면이 없습니다. 왼쪽 "+ 업로드"로 지도·도면 파일을 등록하세요.'; return; }
  const m = bgMatrix(s.rotation, s.bg.width, s.bg.height);
  const bgg = el('g', { transform: `matrix(${m.join(',')})`, opacity: s.opacity == null ? 1 : s.opacity, display: layerVisible('BG') ? null : 'none' }, g);
  el('rect', { x: 0, y: 0, width: s.bg.width, height: s.bg.height, fill: '#fff', stroke: '#ccc', 'vector-effect': 'non-scaling-stroke' }, bgg);
  const which = E.alignShow === 'old' && s.prev_bg ? 'old' : 'cur';
  const B = which === 'old' ? Object.values(s.prev_bg).slice(-1)[0] : s.bg;
  if (!B || B.kind === 'blank') return;
  if (B.kind === 'image' || B.kind === 'pdf') {
    const url = `/api/sheets/${s.id}/bg?v=${s.ver}${which === 'old' ? '&prev=1' : ''}${B.vector ? '&fmt=svg' : ''}`;
    el('image', { href: url, x: 0, y: 0, width: B.width, height: B.height, preserveAspectRatio: 'none' }, bgg);
  } else if (B.kind === 'cad') {
    const key = B.file_id + B.space;
    let dx = E.bgCache[key];
    if (!dx) { const r = await api(`/api/files/${B.file_id}/dxf`); dx = E.bgCache[key] = r[B.space || 'model']; }
    const cl = s.bg.cad_layers || {};
    const groups = {};
    dx.entities.forEach(e => {
      const L = cl[e.L] || {}; const col = L.color_override || (e.c === '#ffffff' ? '#000000' : e.c) || '#000';
      const k = e.L + '|' + col; const G = groups[k] = groups[k] || { L: e.L, col, d: [], t: [] };
      if (e.t === 'p') G.d.push('M' + e.p.map(p => p[0] + ' ' + p[1]).join('L'));
      else if (e.t === 'c') G.d.push(`M${e.x - e.r} ${e.y}a${e.r} ${e.r} 0 1 0 ${2 * e.r} 0a${e.r} ${e.r} 0 1 0 ${-2 * e.r} 0`);
      else if (e.t === 'tx') G.t.push(e);
    });
    Object.values(groups).forEach(G => {
      const L = cl[G.L] || {};
      const lg = el('g', { 'data-cadlayer': G.L, display: L.visible === false ? 'none' : null }, bgg);
      if (G.d.length) el('path', { d: G.d.join(''), fill: 'none', stroke: G.col, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke', opacity: 0.75 }, lg);
      G.t.forEach(t => { const tx = el('text', { x: t.x, y: t.y, 'font-size': t.h * 1.3, fill: G.col, transform: t.rot ? `rotate(${-t.rot} ${t.x} ${t.y})` : null, 'dominant-baseline': t.top ? 'hanging' : null }, lg); tx.textContent = t.s.split('\n')[0]; });
    });
  }
}
export function render() {
  if (E.mode === 'schematic') { SV.render(); return; }
  ensureSvg(); const s = sheet(); const vp = svg().querySelector('#vp');
  ['grid', 'cov', 'fov', 'conduits', 'cables', 'devices', 'ann'].forEach(k => vp.querySelector('#L_' + k).innerHTML = '');
  applyView();
  if (!s) return;
  const ix = C.index(E.model); E.ix = ix;
  const upm = C.upmOf(s); const sz = symSize(), lab = labSize();
  const sid = s.id;
  const tr = E.trace || new Set();
  // 그리드
  if (E.snap.grid) { const gs = gridSize(); const [W, H] = sheetDims(); const gg = vp.querySelector('#L_grid'); const d = []; for (let x = 0; x <= W; x += gs) d.push(`M${x} 0V${H}`); for (let y = 0; y <= H; y += gs) d.push(`M0 ${y}H${W}`); if (d.length < 4000) el('path', { d: d.join(''), stroke: '#dde3ea', 'stroke-width': 0.5, 'vector-effect': 'non-scaling-stroke', fill: 'none' }, gg); }
  // 커버리지
  if (E.coverage && E.coverage.sheet === sid) { const g = vp.querySelector('#L_cov'); E.coverage.data.cells.forEach(([x, y, w, hh, n]) => el('rect', { x, y, width: w, height: hh, fill: n === 0 ? '#e53935' : n === 1 ? '#43a047' : '#1e88e5', opacity: n === 0 ? 0.28 : 0.16 }, g)); }
  // 화각
  if (layerVisible('FOV')) E.model.devices.filter(d => d.sheet_id === sid && d.type === 'camera' && (d.props || {}).show_fov !== false).forEach(d => {
    const g0 = C.fovGeometry(d, upm); const g = vp.querySelector('#L_fov'); const p = d.props || {};
    const col = p.fov_color || layerOf('FOV').color || '#ffbf00'; const op = p.fov_opacity == null ? 0.18 : +p.fov_opacity;
    if (!g0.ok) return;
    if (g0.fisheye) el('circle', { cx: d.x, cy: d.y, r: g0.r_du, fill: col, 'fill-opacity': op, stroke: col, 'vector-effect': 'non-scaling-stroke' }, g);
    else {
      if (g0.ptz) el('circle', { cx: d.x, cy: d.y, r: g0.r_du, fill: 'none', stroke: col, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
      const poly = C.sectorPolygon(d.x, d.y, g0.dir, g0.hfov, g0.r_du);
      el('polygon', { points: poly.map(q => q.join(',')).join(' '), fill: col, 'fill-opacity': op, stroke: col, 'stroke-opacity': 0.7, 'vector-effect': 'non-scaling-stroke' }, g);
      if (g0.ground && g0.ground.near_m != null) { const pn = C.sectorPolygon(d.x, d.y, g0.dir, g0.hfov, (g0.ground.far_m || g0.range_m) * upm, g0.ground.near_m * upm); el('polygon', { points: pn.map(q => q.join(',')).join(' '), fill: 'none', stroke: col, 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' }, g); }
    }
  });
  // 관로
  if (layerVisible('RACEWAY')) E.model.conduits.filter(c => c.sheet_id === sid).forEach(cd => {
    const g = el('g', { 'data-id': cd.id, class: 'obj' }, vp.querySelector('#L_conduits')); const L = layerOf('RACEWAY'); const pts = cd.points || []; if (pts.length < 2) return;
    const d = 'M' + pts.map(p => p.join(' ')).join('L');
    el('path', { d, stroke: 'transparent', 'stroke-width': 14, fill: 'none', 'vector-effect': 'non-scaling-stroke' }, g);
    el('path', { d, stroke: L.color, 'stroke-width': 5, 'stroke-opacity': 0.45, fill: 'none', 'stroke-dasharray': L.dash, 'vector-effect': 'non-scaling-stroke', class: tr.has(cd.id) ? 'trace' : '' }, g);
    const len = C.conduitLength(cd, ix); pathLabel(g, pts, `${cd.tag || ''} ${len.final_m != null ? len.final_m + 'm' : '(축척 미설정)'}`, lab * 0.85, '#555');
  });
  // 케이블
  E.model.cables.filter(c => c.sheet_id === sid).forEach(c => {
    const KD = CAT.CABLE_KINDS[c.kind]; if (!layerVisible(KD.layer)) return; const L = layerOf(KD.layer);
    const pts = C.cablePoints(c, ix); if (pts.length < 2) return;
    const g = el('g', { 'data-id': c.id, class: 'obj' }, vp.querySelector('#L_cables'));
    const d = 'M' + pts.map(p => p.join(' ')).join('L');
    const col = c.status === '철거' ? '#888' : L.color;
    el('path', { d, stroke: 'transparent', 'stroke-width': 12, fill: 'none', 'vector-effect': 'non-scaling-stroke' }, g);
    el('path', { d, stroke: col, 'stroke-width': Math.max(1.2, (L.lw || 0.35) * 4), fill: 'none', 'stroke-dasharray': c.status === '철거' ? '3 3' : KD.dash.split(' ').map(v => v * 1.6).join(' '), 'vector-effect': 'non-scaling-stroke', class: tr.has(c.id) ? 'trace' : '' }, g);
    if (c.kind === 'composite') { const off = px(3); const op = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * off, p[1] + dx / l * off]; }); el('path', { d: 'M' + op.map(p => p.join(' ')).join('L'), stroke: layerOf('POWER').color, 'stroke-width': 1, fill: 'none', 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' }, g); }
    const open = !(c.from && c.from.dev) || !(c.to && c.to.dev);
    if (!(c.from && c.from.dev)) el('circle', { cx: pts[0][0], cy: pts[0][1], r: px(5), fill: '#fff', stroke: '#d00', 'vector-effect': 'non-scaling-stroke' }, g);
    if (!(c.to && c.to.dev)) el('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: px(5), fill: '#fff', stroke: '#d00', 'vector-effect': 'non-scaling-stroke' }, g);
    // 경유점(관로 공용 표시는 라벨)
    const len = C.cableLength(c, ix); const pr = ix.prod.get(c.product_id);
    pathLabel(g, pts, `${c.tag || ''} ${pr ? (pr.spec || pr.name) : '규격?'} ${len.final_m != null ? len.final_m + 'm' : ''}${open ? ' (미연결)' : ''}`, lab * 0.8, col);
  });
  // 교차점과 실제 접속점 구분: 접속은 접속 장비(심볼)로만 성립. 교차(비접속)는 점프 기호로 표시
  { const vis = new Set(E.model.cables.filter(c => c.sheet_id === sid && layerVisible(CAT.CABLE_KINDS[c.kind].layer)).map(c => c.id)); const gC = vp.querySelector('#L_cables'); const r = px(5);
    C.crossings(E.model, sid, ix).filter(x => vis.has(x.cable) && vis.has(x.other)).forEach(x => { const cab = ix.cab.get(x.cable); const col = layerOf(CAT.CABLE_KINDS[cab.kind].layer).color; const ca = Math.cos(x.ang), sa = Math.sin(x.ang); const g = el('g', { 'pointer-events': 'none' }, gC); el('circle', { cx: x.x, cy: x.y, r, fill: '#fff' }, g); el('path', { d: `M${x.x - r * ca} ${x.y - r * sa} A ${r} ${r} 0 0 1 ${x.x + r * ca} ${x.y + r * sa}`, fill: 'none', stroke: col, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }, g); }); }
  // 장비
  E.model.devices.filter(d => d.sheet_id === sid).forEach(d => {
    const T = CAT.DEVICE_TYPES[d.type] || {}; const lk = d.layer || T.layer; if (!layerVisible(lk)) return;
    const L = layerOf(lk); const col = d.status === '철거' ? '#888' : L.color;
    const S = SYM.prims(SYM.attach(d, E.model.project.settings)); const p = d.props || {}; const rot = S.rotate ? (+p.direction || 0) : (+d.rot || 0);
    const s0 = sz * (+p.sym_scale || 1);
    const g = el('g', { 'data-id': d.id, class: 'obj' + (tr.has(d.id) ? ' traced' : '') }, vp.querySelector('#L_devices'));
    const sg = el('g', { transform: `translate(${d.x} ${d.y}) rotate(${rot}) scale(${s0})` }, g);
    if (tr.has(d.id)) el('circle', { cx: 0, cy: 0, r: 0.85, fill: '#ff00aa', opacity: 0.25 }, sg);
    S.prims.forEach(q => {
      const fill = q.fill === 'w' ? '#fff' : q.fill === 'k' ? col : 'none';
      const a = { stroke: col, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', fill };
      if (q.t === 'rect') el('rect', { ...a, x: q.x, y: q.y, width: q.w, height: q.h }, sg);
      else if (q.t === 'circle') el('circle', { ...a, cx: q.x, cy: q.y, r: q.r }, sg);
      else if (q.t === 'poly') el(q.close ? 'polygon' : 'polyline', { ...a, points: q.p.map(v => v.join(',')).join(' ') }, sg);
      else if (q.t === 'text') { const t = el('text', { x: q.x, y: q.y, 'font-size': q.size, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: col, 'font-weight': 700, transform: rot ? `rotate(${-rot} ${q.x} ${q.y})` : null }, sg); t.textContent = q.s; }
    });
    if (d.status === '철거') el('path', { d: `M${d.x - s0 * .6} ${d.y - s0 * .6}L${d.x + s0 * .6} ${d.y + s0 * .6}M${d.x - s0 * .6} ${d.y + s0 * .6}L${d.x + s0 * .6} ${d.y - s0 * .6}`, stroke: '#000', 'vector-effect': 'non-scaling-stroke' }, g);
    const t = el('text', { x: d.x + s0 * 0.55, y: d.y - s0 * 0.55, 'font-size': lab, fill: '#111', 'font-weight': 600 }, g); t.textContent = d.tag || '';
    if (d.field && d.field.status && d.field.status !== '미확인') { const fc = { '위치 확정': '#2e7d32', '변경 필요': '#c62828', '설치 완료': '#1565c0' }[d.field.status]; el('circle', { cx: d.x - s0 * 0.6, cy: d.y - s0 * 0.6, r: s0 * 0.12, fill: fc }, g); }
    if (d.field && d.field.actual) { el('line', { x1: d.x, y1: d.y, x2: d.field.actual[0], y2: d.field.actual[1], stroke: '#1565c0', 'stroke-dasharray': '3 2', 'vector-effect': 'non-scaling-stroke' }, g); el('circle', { cx: d.field.actual[0], cy: d.field.actual[1], r: s0 * 0.2, fill: 'none', stroke: '#1565c0', 'vector-effect': 'non-scaling-stroke' }, g); }
    if (d.rev_review && d.rev_review.state === '검토 필요') el('rect', { x: d.x - s0 * .7, y: d.y - s0 * .7, width: s0 * 1.4, height: s0 * 1.4, fill: 'none', stroke: '#e65100', 'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke' }, g);
  });
  // 주석
  if (layerVisible('TEXT')) E.model.annotations.filter(a => a.sheet_id === sid).forEach(a => drawAnn(vp.querySelector('#L_ann'), a, lab, upm));
  renderOverlay();
}
function pathLabel(g, pts, text, size, col) {
  let bi = 1, bl = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > bl) { bl = l; bi = i; } }
  const a = pts[bi - 1], b = pts[bi]; let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const t = el('text', { x: mx, y: my - size * 0.35, 'font-size': size, fill: col, 'text-anchor': 'middle', transform: `rotate(${ang} ${mx} ${my})`, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': size * 0.25 }, g); t.textContent = text;
}
function drawAnn(parent, a, lab, upm) {
  const g = el('g', { 'data-id': a.id, class: 'obj' }, parent); const P = a.points || []; const col = a.color || '#000'; const sz = (+a.size || 1) * lab;
  if (a.type === 'text' && P[0]) { const t = el('text', { x: P[0][0], y: P[0][1], 'font-size': sz, fill: col }, g); t.textContent = a.text || '(문자)'; return; }
  if (P.length < 2) return;
  const d = 'M' + P.map(p => p.join(' ')).join('L') + (a.type === 'area' ? 'Z' : '');
  el('path', { d, stroke: 'transparent', 'stroke-width': 10, fill: 'none', 'vector-effect': 'non-scaling-stroke' }, g);
  el('path', { d, stroke: col, fill: a.type === 'area' ? 'rgba(30,136,229,.04)' : 'none', 'stroke-width': 1, 'stroke-dasharray': a.type === 'area' ? '6 3' : null, 'vector-effect': 'non-scaling-stroke', 'marker-start': a.type === 'leader' || a.type === 'dim' ? 'url(#arr)' : null, 'marker-end': a.type === 'dim' ? 'url(#arr)' : null }, g);
  if (a.type === 'dim' || a.type === 'measure') { const len = C.polyLen(P); pathLabel(g, P, (a.text ? a.text + ' ' : '') + (upm ? C.round2(len / upm) + ' m' : '(축척 미설정)'), sz, col); }
  if (a.type === 'leader') { const e = P[P.length - 1]; const t = el('text', { x: e[0] + sz * 0.3, y: e[1] - sz * 0.2, 'font-size': sz, fill: col }, g); t.textContent = a.text || ''; }
  if (a.type === 'area') { const t = el('text', { x: P[0][0], y: P[0][1] - sz * 0.3, 'font-size': sz, fill: '#1e88e5' }, g); t.textContent = a.text || '검토 영역'; }
}
export function renderOverlay() {
  const g = svg().querySelector('#L_overlay'); if (!g) return; g.innerHTML = '';
  if (E.mode !== 'plan' || !sheet()) return;
  const ix = E.ix || C.index(E.model);
  E.sel.forEach(id => {
    const f = find(id); if (!f || f.o.sheet_id !== E.sheetId) return; const o = f.o;
    if (f.e === 'devices') { const s = symSize() * (+(o.props || {}).sym_scale || 1) * 0.75; el('rect', { x: o.x - s, y: o.y - s, width: 2 * s, height: 2 * s, class: 'sel-outline' }, g); }
    else { const pts = f.e === 'cables' ? C.cablePoints(o, ix) : (o.points || []); if (pts.length) el('path', { d: 'M' + pts.map(p => p.join(' ')).join('L'), class: 'sel-outline' }, g); }
  });
  // 단일 선택 시 꼭짓점·방향 핸들
  if (E.sel.size === 1 && canEdit()) {
    const f = find([...E.sel][0]); if (f && f.o.sheet_id === E.sheetId) {
      const o = f.o;
      if (o.points && f.e !== 'devices') { const pts = f.e === 'cables' ? C.cablePoints(o, ix) : o.points; pts.forEach((p, i) => el('rect', { x: p[0] - px(4), y: p[1] - px(4), width: px(8), height: px(8), class: 'handle', 'data-h': 'v' + i }, g)); for (let i = 1; i < pts.length; i++) el('circle', { cx: (pts[i][0] + pts[i - 1][0]) / 2, cy: (pts[i][1] + pts[i - 1][1]) / 2, r: px(3.5), class: 'handle', 'data-h': 'm' + i, style: 'fill:#ffe0c0' }, g); }
      if (f.e === 'devices' && o.type === 'camera') { const dir = (+(o.props || {}).direction || 0) * Math.PI / 180; const r = symSize() * 2.2; const hx = o.x + r * Math.sin(dir), hy = o.y - r * Math.cos(dir); el('line', { x1: o.x, y1: o.y, x2: hx, y2: hy, stroke: '#ff6a00', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '3 2' }, g); el('circle', { cx: hx, cy: hy, r: px(6), class: 'handle', 'data-h': 'dir', style: 'fill:#ff6a00' }, g); }
    }
  }
  // 임시 도형
  const T = E.temp;
  if (T && T.pts && T.pts.length) {
    const pts = T.pts.concat(T.cur ? [T.cur] : []);
    el('path', { d: 'M' + pts.map(p => p.join(' ')).join('L'), stroke: '#ff6a00', 'stroke-width': 2, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': T.kind === 'calib' || T.kind === 'align' ? '5 3' : null }, g);
    pts.forEach(p => el('circle', { cx: p[0], cy: p[1], r: px(3), fill: '#ff6a00' }, g));
  }
  if (T && T.box) { const b = T.box; el('rect', { x: Math.min(b[0], b[2]), y: Math.min(b[1], b[3]), width: Math.abs(b[2] - b[0]), height: Math.abs(b[3] - b[1]), fill: 'rgba(31,95,168,.08)', stroke: '#1f5fa8', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }, g); }
  if (E.tool === 'cable' && E.toolOpt && E.snap.port && E.mouse && E.view.z * symSize() > 14) {
    E.model.devices.filter(d => d.sheet_id === E.sheetId && Math.hypot(d.x - E.mouse[0], d.y - E.mouse[1]) < symSize() * 4).forEach(d => portDots(d, E.toolOpt.kind).forEach(q => {
      const on = E.snapPort && E.snapPort.dev.id === d.id && E.snapPort.port === q.id;
      el('circle', { cx: q.x, cy: q.y, r: px(on ? 6 : 4), fill: q.used ? '#bbb' : on ? '#00a000' : '#fff', stroke: '#00a000', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, g);
      const t = el('text', { x: q.x + px(6), y: q.y - px(4), 'font-size': px(10), fill: q.used ? '#999' : '#006400' }, g); t.textContent = q.id;
    }));
  }
  if (E.snapPt) el('rect', { x: E.snapPt[0] - px(6), y: E.snapPt[1] - px(6), width: px(12), height: px(12), fill: 'none', stroke: '#00a000', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, g);
  if (E.alignPts) E.alignPts.forEach((p, i) => { el('circle', { cx: p[0], cy: p[1], r: px(7), fill: 'none', stroke: i < 2 ? '#d00' : '#00f', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, g); const t = el('text', { x: p[0] + px(8), y: p[1] - px(8), 'font-size': px(13), fill: i < 2 ? '#d00' : '#00f' }, g); t.textContent = ['이전 A', '이전 B', '새 A', '새 B'][i]; });
}
export function status(extra) {
  const s = sheet(); const sb = $('statusBar'); if (!sb) return; const upm = s && C.upmOf(s);
  const p = E.mouse || [0, 0];
  sb.innerHTML = '';
  [s ? `도면: ${s.name}` : '', upm ? `축척: ${C.round2(upm)} 단위/m${s.scale && s.scale.source === 'cad' && !s.scale.confirmed ? ' (CAD 단위, 확인 필요)' : ''}` : '축척 미설정 – 길이 미확정', `좌표: ${p[0].toFixed(1)}, ${p[1].toFixed(1)}${upm ? ` (${(p[0] / upm).toFixed(2)}m, ${(p[1] / upm).toFixed(2)}m)` : ''}`, `확대: ${(E.view.z * 100).toFixed(0)}%`, `도구: ${toolName()}`, E.sel.size ? `선택 ${E.sel.size}개` : '', extra || E.statusExtra || ''].filter(Boolean).forEach(t => sb.appendChild(h('span', null, t)));
}
const TOOLS = { select: '선택', pan: '이동', zoomwin: '영역 확대', place: '장비 배치', cable: '케이블', conduit: '배관·트레이', text: '문자', leader: '인출선', dim: '치수선', measure: '거리 측정', area: '검토 영역', polyline: '폴리라인', calib: '축척 보정', align: '기준점 정합', printarea: '출력 영역' };
const toolName = () => (TOOLS[E.tool] || E.tool) + (E.tool === 'cable' && E.toolOpt ? ` (${CAT.CABLE_KINDS[E.toolOpt.kind].name})` : E.tool === 'place' && E.toolOpt ? ` (${E.toolOpt.label})` : '');
export function setTool(t, opt) {
  if (t !== 'select' && t !== 'pan' && t !== 'zoomwin' && t !== 'measure' && t !== 'printarea' && !canEdit() && t !== 'align') { toast('편집 권한이 없습니다 (조회 전용).', true); return; }
  E.tool = t; E.toolOpt = opt || null; E.temp = null; E.snapPt = null;
  svg().style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  P.refreshToolbar(); status(); renderOverlay();
}
export const gridSize = () => { const s = sheet(); const upm = s && C.upmOf(s); return +(s && s.grid_size) || (upm ? upm * 1 : symSize()); };

// ===== 스냅 =====
// 케이블 도구에서 장비 주변에 표시하는 포트 연결점 (해당 케이블 종류와 맞는 포트만)
export function portDots(d, kind) {
  const ports = CAT.portsFor(d).filter(pt => !kind || CAT.cableFitsPort(kind === 'composite' ? 'coax' : kind, pt.kind)); const n = ports.length; if (!n) return [];
  const used = new Set(); E.model.cables.forEach(c => C.endsOf(c).forEach(e => { if (e.dev === d.id) used.add(e.port); }));
  const R = symSize() * (+(d.props || {}).sym_scale || 1) * 1.15 + px(6);
  return ports.map((pt, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / n; return { id: pt.id, x: d.x + R * Math.cos(a), y: d.y + R * Math.sin(a), used: used.has(pt.id) && d.type !== 'offpage' }; });
}
function snapPoint(p, opts = {}) {
  const tol = px(10); let best = null, bd = tol;
  const s = sheet(); const ix = E.ix || C.index(E.model);
  if (E.tool === 'cable' && E.snap.port && E.toolOpt) { let pb = null, pd = px(8); E.model.devices.forEach(d => { if (d.sheet_id !== s.id || Math.hypot(d.x - p[0], d.y - p[1]) > symSize() * 4) return; portDots(d, E.toolOpt.kind).forEach(q => { const dd = Math.hypot(q.x - p[0], q.y - p[1]); if (dd < pd) { pd = dd; pb = { p: [d.x, d.y], dev: d, port: q.id }; } }); }); if (pb) { E.snapPt = pb.p; E.snapPort = pb; return pb; } }
  E.snapPort = null;
  if (E.snap.port || opts.forceDev) E.model.devices.forEach(d => { if (d.sheet_id !== s.id || (opts.exclude && opts.exclude.has(d.id))) return; const dd = Math.hypot(d.x - p[0], d.y - p[1]); const r = Math.max(tol, symSize() * 0.6); if (dd < r && dd < (bd === tol ? r : bd)) { bd = dd; best = { p: [d.x, d.y], dev: d }; } });
  if (!best && E.snap.end) {
    E.model.cables.concat(E.model.conduits).forEach(c => { if (c.sheet_id !== s.id || (opts.exclude && opts.exclude.has(c.id))) return; const pts = c.kind ? C.cablePoints(c, ix) : (c.points || []); pts.forEach(q => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < bd) { bd = dd; best = { p: q.slice() }; } }); });
    E.model.annotations.forEach(a => { if (a.sheet_id !== s.id) return; (a.points || []).forEach(q => { const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < bd) { bd = dd; best = { p: q.slice() }; } }); });
  }
  let out = best ? best.p : p.slice();
  if (!best && E.snap.grid) { const gs = gridSize(); out = [Math.round(p[0] / gs) * gs, Math.round(p[1] / gs) * gs]; }
  if (!best && E.snap.ortho && opts.from) { const dx = out[0] - opts.from[0], dy = out[1] - opts.from[1]; out = Math.abs(dx) > Math.abs(dy) ? [out[0], opts.from[1]] : [opts.from[0], out[1]]; }
  E.snapPt = best ? best.p : null;
  return { p: out, dev: best && best.dev };
}

// ===== 자동 번호 =====
export function nextTag(prefix, list) {
  const re = new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '-(\\d+)$'); let mx = 0;
  list.forEach(o => { const m = (o.tag || '').match(re); if (m) mx = Math.max(mx, +m[1]); });
  return `${prefix}-${String(mx + 1).padStart(2, '0')}`;
}
export function devPrefix(type, props) { if (type === 'custom' && props && props.prefix) return props.prefix; if (type === 'camera') return (props || {}).system === 'IP' ? 'IPC' : (props || {}).system === '동축' ? 'ANC' : 'CAM'; return CAT.DEVICE_TYPES[type].prefix; }
export function autoPort(d, kind, excludeCable, part) {
  if (!d) return '';
  const ports = CAT.portsFor(d); const used = new Set();
  E.model.cables.forEach(c => { if (c.id === excludeCable) return; C.endsOf(c).forEach(e => { if (e.dev === d.id) used.add(e.port); }); });
  const k = part === 'power' ? 'power' : kind === 'composite' ? 'coax' : kind;
  const fit = ports.filter(pt => CAT.cableFitsPort(k, pt.kind));
  return ((fit.find(pt => !used.has(pt.id)) || fit[0] || ports[0] || {}).id) || '';
}

// ===== 이벤트 =====
let spaceDown = false, bound = false;
function bindEvents() {
  if (bound) return; bound = true;
  const s = svg(); const wrap = $('canvasWrap');
  s.addEventListener('wheel', e => { e.preventDefault(); const r = s.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  s.addEventListener('pointerdown', onDown); s.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  s.addEventListener('dblclick', e => { if (E.mode !== 'plan') return; if (['cable', 'conduit', 'polyline', 'leader', 'measure', 'area', 'dim'].includes(E.tool)) finishTemp(); else if (E.tool === 'select') { const id = hitId(e); if (id) { E.sel = new Set([id]); P.refreshProps(); } } });
  s.addEventListener('contextmenu', e => { e.preventDefault(); if (E.temp) { finishTemp(); return; } if (E.mode === 'plan') P.contextMenu(e, hitId(e)); });
  // 터치: 두 손가락 확대
  const touches = new Map(); let pinch = null;
  s.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 }; } }, { passive: true });
  s.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); const r = s.getBoundingClientRect(); zoomAt(d / pinch.d, pinch.cx - r.left, pinch.cy - r.top); pinch.d = d; } }, { passive: true });
  s.addEventListener('touchend', () => { pinch = null; });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; svg().style.cursor = E.tool === 'pan' ? 'grab' : 'default'; } });
  new ResizeObserver(() => applyView()).observe(wrap);
}
function hitId(e) { const t = e.target.closest && e.target.closest('[data-id]'); return t ? t.getAttribute('data-id') : null; }
function isLockedObj(f) { if (!f) return false; const lk = f.e === 'devices' ? (f.o.layer || CAT.DEVICE_TYPES[f.o.type].layer) : f.e === 'cables' ? CAT.CABLE_KINDS[f.o.kind].layer : f.e === 'conduits' ? 'RACEWAY' : 'TEXT'; return layerLocked(lk); }
function expandGroup(id) { const f = find(id); if (!f || !f.o.group_id) return [id]; return all().filter(x => x.o.group_id === f.o.group_id).map(x => x.o.id); }

function onDown(e) {
  if (E.mode === 'schematic') return SV.onDown(e);
  if (!sheet()) return;
  const p = toDraw(e); E.mouse = p;
  if (e.button === 1 || spaceDown || E.tool === 'pan' || (e.pointerType === 'touch' && E.tool === 'select' && !hitId(e))) { E.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: E.view.tx, ty: E.view.ty }; svg().setPointerCapture(e.pointerId); return; }
  if (e.button === 2) return;
  const handle = e.target.getAttribute && e.target.getAttribute('data-h');
  if (E.tool === 'select') {
    if (handle && E.sel.size === 1) { const f = find([...E.sel][0]); E.drag = { kind: 'handle', h: handle, id: f.o.id, e: f.e, before: clone(f.o), moved: false }; if (handle[0] === 'm') { const i = +handle.slice(1); const pts = f.e === 'cables' ? C.cablePoints(f.o, E.ix) : f.o.points; f.o.points = (f.e === 'cables' ? pts : f.o.points).slice(); f.o.points.splice(i, 0, p); E.drag.h = 'v' + i; } svg().setPointerCapture(e.pointerId); return; }
    const id = hitId(e);
    if (id) {
      const f = find(id);
      if (isLockedObj(f)) { E.sel = new Set([id]); P.refreshProps(); renderOverlay(); return; }
      const ids = expandGroup(id);
      if (e.shiftKey || e.ctrlKey) ids.forEach(x => E.sel.has(x) ? E.sel.delete(x) : E.sel.add(x));
      else if (!E.sel.has(id)) E.sel = new Set(ids);
      P.refreshProps(); renderOverlay(); status();
      if (canEdit()) { const objs = [...E.sel].map(find).filter(x => x && !isLockedObj(x)); E.drag = { kind: 'move', start: p, objs: objs.map(x => ({ e: x.e, before: clone(x.o) })), moved: false }; svg().setPointerCapture(e.pointerId); }
      return;
    }
    if (!e.shiftKey) { E.sel.clear(); P.refreshProps(); }
    E.temp = { box: [p[0], p[1], p[0], p[1]] }; E.drag = { kind: 'box' }; svg().setPointerCapture(e.pointerId); renderOverlay(); return;
  }
  if (E.tool === 'zoomwin' || E.tool === 'printarea') { E.temp = { box: [p[0], p[1], p[0], p[1]] }; E.drag = { kind: E.tool }; svg().setPointerCapture(e.pointerId); return; }
  if (E.tool === 'place') { const sp = snapPoint(p, { forceDev: false }); placeDevice(sp.p); return; }
  if (E.tool === 'text') { addText(snapPoint(p).p); return; }
  if (E.tool === 'align') { alignClick(p); return; }
  // 폴리라인 계열
  const from = E.temp && E.temp.pts && E.temp.pts.length ? E.temp.pts[E.temp.pts.length - 1] : null;
  const sp = snapPoint(p, { from, forceDev: E.tool === 'cable' || E.tool === 'conduit' });
  if (!E.temp) E.temp = { kind: E.tool, pts: [], devs: [] };
  if (E.tool === 'cable' && sp.dev) {
    E.temp.pts.push(sp.p); E.temp.devs.push(sp.dev.id); E.temp.ports = E.temp.ports || []; E.temp.ports[E.temp.pts.length - 1] = sp.port || null;
    if (E.temp.pts.length >= 2) { finishTemp(); return; }
  } else if (E.tool === 'conduit' && sp.dev && CAT.DEVICE_TYPES[sp.dev.type].raceNode) { E.temp.pts.push(sp.p); E.temp.devs[E.temp.pts.length - 1] = sp.dev.id; }
  else E.temp.pts.push(sp.p);
  if (E.tool === 'calib' && E.temp.pts.length === 2) { finishTemp(); return; }
  if (E.tool === 'dim' && E.temp.pts.length === 2) { finishTemp(); return; }
  renderOverlay();
}
function onMove(e) {
  if (E.mode === 'schematic') return SV.onMove(e);
  const p = toDraw(e); E.mouse = p;
  const D = E.drag;
  if (D && D.kind === 'pan') { E.view.tx = D.tx + e.clientX - D.sx; E.view.ty = D.ty + e.clientY - D.sy; applyView(); return; }
  if (D && D.kind === 'move') {
    let dx = p[0] - D.start[0], dy = p[1] - D.start[1];
    if (E.snap.grid && D.objs.length) { const b = D.objs[0].before; const ref = b.x != null ? [b.x, b.y] : b.points[0]; const gs = gridSize(); dx = Math.round((ref[0] + dx) / gs) * gs - ref[0]; dy = Math.round((ref[1] + dy) / gs) * gs - ref[1]; }
    if (Math.hypot(dx, dy) > px(2)) D.moved = true;
    if (!D.moved) return;
    D.objs.forEach(x => { const o = E.model[x.e].find(y => y.id === x.before.id); if (x.before.x != null) { o.x = x.before.x + dx; o.y = x.before.y + dy; } if (x.before.points) { const selDevs = new Set(D.objs.filter(y => y.e === 'devices').map(y => y.before.id)); o.points = x.before.points.map(q => [q[0] + dx, q[1] + dy]); } });
    render(); return;
  }
  if (D && D.kind === 'handle') {
    const f = find(D.id); const o = f.o; D.moved = true;
    if (D.h === 'dir') { const ang = Math.atan2(p[0] - o.x, -(p[1] - o.y)) * 180 / Math.PI; o.props = { ...(o.props || {}), direction: Math.round((ang + 360) % 360) }; render(); status('방향 ' + o.props.direction + '°'); return; }
    const i = +D.h.slice(1); const sp = snapPoint(p, { exclude: new Set([o.id]), forceDev: f.e === 'cables' && (i === 0 || i === o.points.length - 1) });
    if (f.e === 'cables' && D.before.points && !D.ptsInit) { o.points = C.cablePoints(o, E.ix).map(q => q.slice()); D.ptsInit = true; }
    o.points[i] = sp.p; D.endDev = sp.dev || null; D.endIdx = i;
    // 끝점을 장비에서 떼어내면 연결 해제 미리보기
    if (f.e === 'cables' && (i === 0 || i === o.points.length - 1)) { const side = i === 0 ? 'from' : 'to'; if (!sp.dev) o[side] = { dev: null, port: null }; }
    render(); return;
  }
  if (D && D.kind && E.temp && E.temp.box) { E.temp.box[2] = p[0]; E.temp.box[3] = p[1]; renderOverlay(); return; }
  if (E.temp && E.temp.pts) { const from = E.temp.pts[E.temp.pts.length - 1]; E.temp.cur = snapPoint(p, { from, forceDev: E.tool === 'cable' }).p; renderOverlay(); const s = sheet(); const upm = C.upmOf(s); const L = C.polyLen(E.temp.pts.concat([E.temp.cur])); status(upm ? `길이 ${C.round2(L / upm)} m` : `길이 ${L.toFixed(1)} (축척 미설정)`); return; }
  if (['cable', 'conduit', 'place'].includes(E.tool)) { snapPoint(p, { forceDev: E.tool !== 'place' }); renderOverlay(); }
  status();
}
function onUp(e) {
  if (E.mode === 'schematic') return SV.onUp(e);
  const D = E.drag; E.drag = null; if (!D) return;
  if (D.kind === 'move' && D.moved) {
    const changes = D.objs.map(x => ({ e: x.e, before: x.before, after: clone(E.model[x.e].find(y => y.id === x.before.id)) }));
    const movedDevs = D.objs.filter(x => x.e === 'devices').map(x => x.before.id);
    const affected = E.model.cables.filter(c => !D.objs.some(x => x.before.id === c.id) && C.endsOf(c).some(en => movedDevs.includes(en.dev)));
    // 이동 전 길이 (이동 전 위치로 계산)
    const devBefore = new Map(D.objs.filter(x => x.e === 'devices').map(x => [x.before.id, x.before]));
    const modelBefore = { ...E.model, devices: E.model.devices.map(d => devBefore.get(d.id) || d) }; const ixB = C.index(modelBefore);
    const lenB = new Map(affected.map(c => [c.id, C.cableLength(c, ixB).final_m]));
    if (!E.keepConn) {
      // 연결 해제 이동: 케이블은 원래 위치에 남고 끝단은 미연결
      affected.forEach(c => { const a = clone(c); a.points = C.cablePoints(c, ixB); ['from', 'to'].forEach(sd => { if (a[sd] && movedDevs.includes(a[sd].dev)) a[sd] = { dev: null, port: null }; }); if (a.props && movedDevs.includes(a.props.power_to_dev)) a.props.power_to_dev = null; if (a.props && movedDevs.includes(a.props.power_from_dev)) a.props.power_from_dev = null; changes.push({ e: 'cables', before: clone(c), after: a }); });
      commit('이동(연결 해제)', changes);
      if (affected.length) toast(`연결 해제 이동: 케이블 ${affected.length}개를 미연결 상태로 남겼습니다 (${affected.slice(0, 6).map(c => c.tag).join(', ')}).`);
      return;
    }
    commit('이동', changes);
    if (affected.length) { const ixA = C.index(E.model); toast(`연결 유지 – 경로 조정 결과: ${affected.slice(0, 8).map(c => { const a = C.cableLength(c, ixA).final_m, b = lenB.get(c.id); return `${c.tag} ${b ?? '?'}→${a ?? '?'}m`; }).join(', ')}${affected.length > 8 ? ' 외 ' + (affected.length - 8) + '개' : ''}`); }
    return;
  }
  if (D.kind === 'handle' && D.moved) {
    const f = find(D.id); const o = f.o;
    if (f.e === 'cables' && D.endIdx != null && (D.endIdx === 0 || D.endIdx === o.points.length - 1)) {
      const side = D.endIdx === 0 ? 'from' : 'to';
      if (D.endDev) o[side] = { dev: D.endDev.id, port: autoPort(D.endDev, o.kind, o.id) };
    }
    const after = clone(o); Object.assign(o, clone(D.before)); commit('형상 편집', [{ e: f.e, before: D.before, after }]); return;
  }
  if (D.kind === 'box' && E.temp && E.temp.box) {
    const b = E.temp.box; E.temp = null; const x0 = Math.min(b[0], b[2]), x1 = Math.max(b[0], b[2]), y0 = Math.min(b[1], b[3]), y1 = Math.max(b[1], b[3]);
    if (x1 - x0 > px(3)) { const ix = E.ix; all().forEach(({ e: en, o }) => { if (o.sheet_id !== E.sheetId) return; const pts = o.points ? (en === 'cables' ? C.cablePoints(o, ix) : o.points) : [[o.x, o.y]]; if (pts.length && pts.every(q => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1)) E.sel.add(o.id); }); }
    P.refreshProps(); renderOverlay(); status(); return;
  }
  if (D.kind === 'zoomwin' && E.temp && E.temp.box) { const b = E.temp.box; E.temp = null; fitView({ x: Math.min(b[0], b[2]), y: Math.min(b[1], b[3]), w: Math.abs(b[2] - b[0]), h: Math.abs(b[3] - b[1]) }); setTool('select'); return; }
  if (D.kind === 'printarea' && E.temp && E.temp.box) { const b = E.temp.box; E.temp = null; const area = { x: Math.min(b[0], b[2]), y: Math.min(b[1], b[3]), w: Math.abs(b[2] - b[0]), h: Math.abs(b[3] - b[1]) }; setTool('select'); P.printDialog({ area }); return; }
  if (D.kind === 'pan') return;
}
function onKey(e) {
  if ($('editor').classList.contains('hidden')) return;
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  if (document.querySelector('.modal-bg')) return;
  const k = e.key; const ctrl = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { spaceDown = true; svg().style.cursor = 'grab'; e.preventDefault(); return; }
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); save().then(ok => ok && toast('저장했습니다.')); return; }
  if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k.toLowerCase() === 'c') { copySel(); return; }
  if (ctrl && k.toLowerCase() === 'v') { paste(); return; }
  if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); copySel(); paste(); return; }
  if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); E.sel = new Set(all().filter(x => x.o.sheet_id === E.sheetId).map(x => x.o.id)); P.refreshProps(); renderOverlay(); return; }
  if (ctrl && k.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : group(); return; }
  if (k === 'Escape') { if (E.temp) { E.temp = null; renderOverlay(); } else if (E.tool !== 'select') setTool('select'); else { E.sel.clear(); E.trace = null; render(); P.refreshProps(); } return; }
  if (k === 'Enter') { finishTemp(); return; }
  if (k === 'Delete' || k === 'Backspace') { deleteSel(); return; }
  if (k === 'F8') { e.preventDefault(); E.snap.ortho = !E.snap.ortho; P.refreshToolbar(); return; }
  if (k === 'r' || k === 'R') { rotateSel(e.shiftKey ? -15 : 15); return; }
  if (k === 'f' || k === 'F') { fitView(); return; }
}

// ===== 생성 동작 =====
function placeDevice(p) {
  const pr = E.toolOpt; if (!pr) return;
  const props = clone(pr.props || {});
  const d = { id: uuid(), sheet_id: E.sheetId, type: pr.type, tag: nextTag(devPrefix(pr.type, props), E.model.devices), name: '', x: p[0], y: p[1], layer: CAT.DEVICE_TYPES[pr.type].layer, status: '신설', props };
  if (pr.type === 'camera') props.direction = 0;
  commit('장비 배치', [{ e: 'devices', before: null, after: d }]);
  E.sel = new Set([d.id]); P.refreshProps(); renderOverlay();
}
async function addText(p) {
  const o = { text: '' }; const inp = h('input', { style: { width: '320px' } });
  const v = await modal('문자 입력', inp, [{ label: '취소' }, { label: '확인', primary: true, action: () => inp.value }]);
  if (!v) return; commit('문자', [{ e: 'annotations', before: null, after: { id: uuid(), sheet_id: E.sheetId, type: 'text', points: [p], text: v, size: 1 } }]);
}
async function finishTemp() {
  const T = E.temp; if (!T || !T.pts) return; E.temp = null; renderOverlay();
  const pts = T.pts; const s = sheet();
  if (T.kind === 'cable') {
    if (pts.length < 2) return;
    const kind = E.toolOpt.kind; const fd = T.devs.length && pts[0] && T.devs[0] && dev(T.devs[0]) && Math.hypot(dev(T.devs[0]).x - pts[0][0], dev(T.devs[0]).y - pts[0][1]) < 1e-6 ? dev(T.devs[0]) : null;
    const lastDevId = T.devs[T.devs.length - 1]; const ld = lastDevId && dev(lastDevId); const td = ld && ld !== fd && Math.hypot(ld.x - pts[pts.length - 1][0], ld.y - pts[pts.length - 1][1]) < 1e-6 ? ld : null;
    const c = { id: uuid(), sheet_id: E.sheetId, kind, tag: nextTag(CAT.CABLE_KINDS[kind].prefix, E.model.cables.filter(x => !x.parent_id)), product_id: E.toolOpt.product_id || defaultProduct(kind), points: pts, from: { dev: fd ? fd.id : null, port: fd ? autoPort(fd, kind) : null }, to: { dev: td ? td.id : null, port: null }, vertical_m: 0, entry_m: 0, slack: { mode: 'project' }, status: '신설', method: '', conduit_ids: [], props: {} };
    if (td) c.to.port = autoPort(td, kind, c.id);
    const tp = T.ports || []; if (fd && tp[0]) c.from.port = tp[0]; if (td && tp[pts.length - 1]) c.to.port = tp[pts.length - 1];
    if (kind === 'composite') c.props.power_from_port = 'DC';
    commit('케이블 작성', [{ e: 'cables', before: null, after: c }]);
    E.sel = new Set([c.id]); P.refreshProps();
    if (!fd || !td) toast('미연결 끝단이 있는 케이블입니다. 끝점 핸들을 장비로 끌어 연결하세요.');
    // 연속 작성: 마지막 장비에서 다시 시작
    return;
  }
  if (T.kind === 'conduit') { if (pts.length < 2) return; const cd = { id: uuid(), sheet_id: E.sheetId, tag: nextTag('PIPE', E.model.conduits), product_id: (E.model.products.find(p => p.category === 'conduit') || {}).id || null, points: pts, method: '노출', status: '신설', extra_m: 0, from_node: T.devs[0] || null, to_node: T.devs[pts.length - 1] || null }; commit('관로 작성', [{ e: 'conduits', before: null, after: cd }]); E.sel = new Set([cd.id]); P.refreshProps(); return; }
  if (T.kind === 'calib') { if (pts.length === 2) P.calibDialog(pts); setTool('select'); return; }
  if (['polyline', 'leader', 'measure', 'area', 'dim'].includes(T.kind)) {
    if (pts.length < (T.kind === 'area' ? 3 : 2)) return;
    let text = '';
    if (T.kind === 'leader' || T.kind === 'area') { const inp = h('input', { style: { width: '300px' }, value: T.kind === 'area' ? '검토 영역' : '' }); text = await modal(T.kind === 'leader' ? '인출선 문자' : '영역 이름', inp, [{ label: '확인', primary: true, action: () => inp.value }]) || ''; }
    if (T.kind === 'measure') { const upm = C.upmOf(s); const L = C.polyLen(pts); const keep = await modal('거리 측정', h('div', null, upm ? `측정 거리: ${C.round2(L / upm)} m (도면상 ${L.toFixed(1)})` : `도면상 ${L.toFixed(1)} 단위 — 축척 미설정으로 실거리 미확정`), [{ label: '닫기', value: false }, { label: '도면에 남기기', value: true, primary: true }]); if (!keep) return; }
    commit('주석', [{ e: 'annotations', before: null, after: { id: uuid(), sheet_id: E.sheetId, type: T.kind, points: pts, text, size: 1 } }]);
  }
}
export function defaultProduct(kind) { const p = E.model.products.find(x => x.category === 'cable' && x.kind === kind); return p ? p.id : null; }
export function deleteSel() {
  if (!E.sel.size) return; if (!canEdit()) { toast('편집 권한이 없습니다.', true); return; }
  const ch = [...E.sel].map(find).filter(Boolean).filter(f => !isLockedObj(f)).map(f => ({ e: f.e, before: clone(f.o), after: null }));
  // 삭제되는 장비에 연결된 케이블 → 미연결 처리
  const ids = new Set(ch.map(c => c.before.id));
  E.model.cables.filter(c => !ids.has(c.id)).forEach(c => { let changed = false; const a = clone(c); ['from', 'to'].forEach(sd => { if (a[sd] && ids.has(a[sd].dev)) { const d = dev(a[sd].dev); a.points = C.cablePoints(c, E.ix || C.index(E.model)); a[sd] = { dev: null, port: null }; changed = true; } }); if (a.props && ids.has(a.props.power_to_dev)) { a.props.power_to_dev = null; changed = true; } if (changed) ch.push({ e: 'cables', before: clone(c), after: a }); });
  E.model.conduits.forEach(cd => { }); E.model.cables.filter(c => !ids.has(c.id) && (c.conduit_ids || []).some(x => ids.has(x))).forEach(c => ch.push({ e: 'cables', before: clone(c), after: { ...clone(c), conduit_ids: c.conduit_ids.filter(x => !ids.has(x)) } }));
  commit('삭제', ch); E.sel.clear(); P.refreshProps(); renderOverlay();
}
function rotateSel(deg) {
  const ch = [...E.sel].map(find).filter(f => f && f.e === 'devices').map(f => { const a = clone(f.o); if (a.type === 'camera') a.props.direction = (((+a.props.direction || 0) + deg) % 360 + 360) % 360; else a.rot = (((+a.rot || 0) + deg) % 360 + 360) % 360; return { e: 'devices', before: clone(f.o), after: a }; });
  commit('회전', ch);
}
function group() { if (E.sel.size < 2) return; const gid = uuid(); commit('그룹', [...E.sel].map(find).filter(Boolean).map(f => ({ e: f.e, before: clone(f.o), after: { ...clone(f.o), group_id: gid } }))); toast(`${E.sel.size}개 객체를 그룹으로 묶었습니다.`); }
function ungroup() { commit('그룹 해제', [...E.sel].map(find).filter(f => f && f.o.group_id).map(f => { const a = clone(f.o); delete a.group_id; return { e: f.e, before: clone(f.o), after: a }; })); }
export function copySel() { const objs = [...E.sel].map(find).filter(Boolean); if (!objs.length) return; const devIds = new Set(objs.filter(f => f.e === 'devices').map(f => f.o.id)); E.clip = { items: objs.filter(f => f.e !== 'cables' || ((!f.o.from.dev || devIds.has(f.o.from.dev)) && (!f.o.to.dev || devIds.has(f.o.to.dev)))).map(f => ({ e: f.e, o: clone(f.o) })) }; toast(`${E.clip.items.length}개 복사`); }
export function paste() {
  if (!E.clip || !canEdit()) return; const off = symSize() * 1.5; const map = new Map(); const ch = [];
  const devs = E.model.devices.slice(); const cabs = E.model.cables.slice();
  E.clip.items.forEach(({ e, o }) => map.set(o.id, uuid()));
  E.clip.items.forEach(({ e, o }) => {
    const n = clone(o); n.id = map.get(o.id); n.sheet_id = E.sheetId; delete n.ver; delete n.field; delete n.rev_review;
    if (n.x != null) { n.x += off; n.y += off; } if (n.points) n.points = n.points.map(p => [p[0] + off, p[1] + off]);
    if (e === 'devices') { n.tag = nextTag(devPrefix(n.type, n.props), devs); if (n.props) { delete n.props.ip; delete n.props.nvr_channel; } devs.push(n); delete n.sch; }
    if (e === 'cables') { n.tag = nextTag(CAT.CABLE_KINDS[n.kind].prefix, cabs); cabs.push(n); ['from', 'to'].forEach(s => { if (n[s] && n[s].dev) n[s].dev = map.get(n[s].dev) || null; }); n.conduit_ids = []; }
    if (n.group_id) n.group_id = map.get(n.group_id) || (map.set(n.group_id, uuid()), map.get(n.group_id));
    ch.push({ e, before: null, after: n });
  });
  commit('붙여넣기', ch); E.sel = new Set(ch.map(c => c.after.id)); P.refreshProps(); renderOverlay();
  if (ch.some(c => c.e === 'devices' && c.after.type === 'camera')) toast('붙여넣은 카메라의 IP·NVR 채널은 비워 두었습니다 (중복 방지).');
}
// ===== 기준점 정합 =====
export function startAlign() { E.alignPts = []; E.alignShow = 'old'; setTool('align'); renderBg(); toast('1단계: 이전 도면에서 기준점 A, B를 차례로 클릭하세요.'); }
async function alignClick(p) {
  E.alignPts.push(p); renderOverlay();
  if (E.alignPts.length === 2) { E.alignShow = 'cur'; await renderBg(); toast('2단계: 새 도면에서 같은 위치의 기준점 A, B를 차례로 클릭하세요.'); }
  if (E.alignPts.length === 4) {
    const [a, b, c, d] = E.alignPts; E.alignPts = null; setTool('select');
    if (E.dirty.size) await save();
    try { const r = await api(`/api/sheets/${E.sheetId}/align`, { body: { src: [a, b], dst: [c, d] } }); toast(`정합 완료: 배율 ${r.scale.toFixed(4)}, 회전 ${r.rotation_deg.toFixed(2)}°. 장비 위치 검토 표시를 확인하세요.`); await reload(true); await renderBg(); render(); }
    catch (e) { toast(e.message, true); }
  }
}
// 회선 추적
export function traceSel() {
  const ids = [...E.sel]; if (!ids.length) { toast('케이블이나 장비를 선택하세요.'); return; }
  const ix = C.index(E.model); const circ = C.circuits(E.model, ix);
  const set = new Set(ids); const hits = circ.filter(c => ids.includes(c.camera) || c.path.some(s => ids.includes(s.cable.id)) || c.inline.some(i => ids.includes(i.dev)) || ids.includes(c.sink));
  hits.forEach(c => { set.add(c.camera); if (c.sink) set.add(c.sink); c.path.forEach(s => { set.add(s.cable.id); if (s.from) set.add(s.from.dev); if (s.to) set.add(s.to.dev); (s.cable.conduit_ids || []).forEach(x => set.add(x)); }); c.inline.forEach(i => set.add(i.dev)); });
  // 직접 연결 케이블
  E.model.cables.filter(c => ids.includes(c.id)).forEach(c => C.endsOf(c).forEach(e => set.add(e.dev)));
  E.trace = set; render();
  P.showTrace(hits, ix);
}
export { CAT, C };
// 자동 검증 스크립트용 노출 (화면 동작에는 영향 없음)
window.CCTVEditor = { portDots, commit, update, symSize, fitView };
