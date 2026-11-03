// 태블릿·모바일 현장 화면: 도면 조회, 장비 검색, 현장 확인 상태, 사진 등록 (권한은 서버에서 검증)
import { api, toast, h, esc } from './ui.js';
const CAT = window.CCTVCatalog, C = window.CCTVCalc, SYM = window.CCTVSymbols;
const B = document.getElementById('mBody'); const title = document.getElementById('mTitle');
let model = null, pid = null, me = null;
const hp = () => Object.fromEntries(location.hash.slice(1).split('&').filter(Boolean).map(s => s.split('=')));
const go = (o) => { location.hash = Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join('&'); };
document.getElementById('mBack').onclick = () => { const p = hp(); if (p.d) go({ p: p.p, s: p.s }); else if (p.s) go({ p: p.p }); else go({}); };
window.addEventListener('need-login', loginView);
window.addEventListener('hashchange', route);
async function boot() { try { me = await api('/api/me', { noAuthRedirect: true }); route(); } catch { loginView(); } }
function loginView() {
  title.textContent = '로그인'; B.innerHTML = '';
  const u = h('input', { placeholder: '아이디', class: 'msearch' }), p = h('input', { type: 'password', placeholder: '비밀번호', class: 'msearch' }); const err = h('div', { class: 'err' });
  B.appendChild(h('div', { class: 'card' }, u, h('div', { style: { height: '8px' } }), p, h('div', { style: { height: '8px' } }), h('button', { class: 'primary mbtn', onclick: async () => { try { await api('/api/login', { body: { username: u.value, password: p.value }, noAuthRedirect: true }); boot(); } catch (e) { err.textContent = e.message; } } }, '로그인'), err));
}
async function route() {
  const p = hp();
  if (!p.p) return projects();
  if (pid !== p.p || !model) { try { model = await api(`/api/projects/${p.p}/model`); pid = p.p; } catch (e) { B.innerHTML = ''; B.appendChild(h('div', { class: 'card err' }, e.message)); return; } }
  if (p.d) return device(p.d);
  if (p.s) return sheetView(p.s);
  return projectHome();
}
async function projects() {
  title.textContent = '프로젝트'; const list = await api('/api/projects'); B.innerHTML = '';
  list.forEach(x => B.appendChild(h('div', { class: 'card click', onclick: () => go({ p: x.id }) }, h('b', null, x.name), x.is_sample ? h('span', { class: 'badge sample' }, ' 샘플') : null, h('div', { class: 'small muted' }, `${x.address || ''} · 도면 ${x.counts.s} · CCTV ${x.counts.c}`))));
}
function projectHome() {
  title.textContent = model.project.name; B.innerHTML = '';
  const q = h('input', { class: 'msearch', placeholder: '장비번호·명칭·IP 검색' }); const res = h('div');
  const draw = () => { res.innerHTML = ''; const s = q.value.trim().toLowerCase(); model.devices.filter(d => d.type !== 'offpage' && (!s || [d.tag, d.name, (d.props || {}).ip].some(v => String(v || '').toLowerCase().includes(s)))).slice(0, 80).forEach(d => res.appendChild(devCard(d))); };
  q.oninput = draw;
  B.appendChild(h('h3', { style: { margin: '6px 0' } }, '도면')); model.sheets.forEach(s => B.appendChild(h('div', { class: 'card click', onclick: () => go({ p: pid, s: s.id }) }, s.name, h('span', { class: 'small muted' }, ' ' + [s.building, s.floor].filter(Boolean).join(' ')))));
  B.appendChild(h('h3', { style: { margin: '10px 0 6px' } }, '장비')); B.appendChild(q); B.appendChild(h('div', { style: { height: '8px' } })); B.appendChild(res); draw();
}
function devCard(d) { const fs = (d.field || {}).status || '미확인'; return h('div', { class: 'card click', onclick: () => go({ p: pid, s: d.sheet_id, d: d.id }) }, h('b', null, d.tag), ' ', h('span', { class: 'muted small' }, (CAT.DEVICE_TYPES[d.type] || {}).name + (d.type === 'camera' ? ` ${d.props.system} ${d.props.form}` : '')), h('span', { class: 'badge', style: { float: 'right' } }, fs)); }
function sheetView(sid, focus) {
  const s = model.sheets.find(x => x.id === sid); if (!s) return projectHome(); title.textContent = s.name;
  if (!focus) B.innerHTML = '';
  const box = h('div', { class: 'mview' }); const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); box.appendChild(svg);
  const W = (s.rotation || 0) % 180 ? s.bg.height : s.bg.width, H = (s.rotation || 0) % 180 ? s.bg.width : s.bg.height;
  const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
  const m = { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, s.bg.height, 0], 180: [-1, 0, 0, -1, s.bg.width, s.bg.height], 270: [0, -1, 1, 0, 0, s.bg.width] }[s.rotation || 0];
  if (s.bg.kind === 'image' || s.bg.kind === 'pdf') { const im = document.createElementNS(NS, 'image'); im.setAttribute('href', `/api/sheets/${s.id}/bg?v=${s.ver}`); im.setAttribute('width', s.bg.width); im.setAttribute('height', s.bg.height); im.setAttribute('transform', `matrix(${m.join(',')})`); im.setAttribute('opacity', s.opacity ?? 1); g.appendChild(im); }
  else if (s.bg.kind === 'cad') api(`/api/files/${s.bg.file_id}/dxf`).then(dx => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', dx[s.bg.space || 'model'].entities.filter(e => e.t === 'p').map(e => 'M' + e.p.map(q => q.join(' ')).join('L')).join('')); p.setAttribute('stroke', '#999'); p.setAttribute('fill', 'none'); p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('transform', `matrix(${m.join(',')})`); g.insertBefore(p, g.firstChild); });
  const sz = +(s.sym_size || Math.max(W, H) / 70); const ix = C.index(model);
  model.cables.filter(c => c.sheet_id === sid).forEach(c => { const pts = C.cablePoints(c, ix); if (pts.length < 2) return; const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M' + pts.map(q => q.join(' ')).join('L')); const L = (model.project.settings.layers || CAT.LAYERS).find(l => l.key === CAT.CABLE_KINDS[c.kind].layer) || {}; p.setAttribute('stroke', L.color || '#333'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', 2); p.setAttribute('vector-effect', 'non-scaling-stroke'); g.appendChild(p); });
  model.devices.filter(d => d.sheet_id === sid).forEach(d => {
    const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', d.x); c.setAttribute('cy', d.y); c.setAttribute('r', sz * 0.45); const fs = (d.field || {}).status;
    c.setAttribute('fill', focus === d.id ? '#ff6a00' : fs === '설치 완료' ? '#1565c0' : fs === '위치 확정' ? '#2e7d32' : fs === '변경 필요' ? '#c62828' : '#fff'); c.setAttribute('stroke', '#333'); c.setAttribute('vector-effect', 'non-scaling-stroke'); c.style.cursor = 'pointer'; c.onclick = () => go({ p: pid, s: sid, d: d.id }); g.appendChild(c);
    const t = document.createElementNS(NS, 'text'); t.setAttribute('x', d.x + sz * 0.5); t.setAttribute('y', d.y - sz * 0.5); t.setAttribute('font-size', sz * 0.5); t.textContent = d.tag; g.appendChild(t);
  });
  let v = { z: 1, tx: 0, ty: 0 };
  const apply = () => g.setAttribute('transform', `matrix(${v.z},0,0,${v.z},${v.tx},${v.ty})`);
  setTimeout(() => { const r = box.getBoundingClientRect(); const fd = focus && model.devices.find(d => d.id === focus); if (fd) { v.z = Math.min(r.width, r.height) / (sz * 14); v.tx = r.width / 2 - fd.x * v.z; v.ty = r.height / 2 - fd.y * v.z; } else { v.z = Math.min(r.width / W, r.height / H); v.tx = (r.width - W * v.z) / 2; v.ty = (r.height - H * v.z) / 2; } apply(); }, 30);
  const pts = new Map(); let last = null;
  svg.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) { v.tx += e.clientX - prev[0]; v.ty += e.clientY - prev[1]; apply(); } else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (last) { const f = d / last; const r = svg.getBoundingClientRect(); const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top; v.tx = cx - (cx - v.tx) * f; v.ty = cy - (cy - v.ty) * f; v.z *= f; apply(); } last = d; } });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) last = null; }; svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const r = svg.getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top; v.tx = cx - (cx - v.tx) * f; v.ty = cy - (cy - v.ty) * f; v.z *= f; apply(); }, { passive: false });
  if (!focus) { B.appendChild(box); B.appendChild(h('div', { class: 'small muted', style: { margin: '6px 0' } }, '한 손가락 이동 · 두 손가락 확대 · 장비 원을 누르면 상세')); model.devices.filter(d => d.sheet_id === sid).forEach(d => B.appendChild(devCard(d))); }
  return box;
}
async function device(id) {
  const d = model.devices.find(x => x.id === id); if (!d) { B.innerHTML = '<div class="card err">장비를 찾을 수 없습니다.</div>'; return; }
  title.textContent = d.tag; B.innerHTML = '';
  const role = model.project.my_role; const can = ['admin', 'designer', 'reviewer'].includes(role);
  const p = d.props || {}; const fs = d.field || {};
  B.appendChild(h('div', { class: 'card' }, h('div', { class: 'kv' }, ...[['유형', (CAT.DEVICE_TYPES[d.type] || {}).name], ['명칭', d.name], ['시스템', p.system], ['형식', p.form], ['제조사·모델', [p.maker, p.model].filter(Boolean).join(' ')], ['IP', p.ip], ['설치 높이', p.height && p.height + 'm'], ['설치 위치', p.location], ['구분', d.status], ['도면', (model.sheets.find(s => s.id === d.sheet_id) || {}).name], ['비고', p.note]].filter(x => x[1]).flatMap(([k, v]) => [h('span', { class: 'muted' }, k), h('span', null, String(v))]))));
  B.appendChild(sheetView(d.sheet_id, d.id)); title.textContent = d.tag;
  const st = h('select', { class: 'msearch', disabled: !can || null }, CAT.FIELD_STATUS.map(s => h('option', { selected: (fs.status || '미확인') === s }, s)));
  const note = h('textarea', { rows: 2, disabled: !can || null, placeholder: '현장 메모' }, fs.note || '');
  const save = async () => { try { const r = await api(`/api/projects/${pid}/devices/${d.id}/field`, { method: 'PUT', body: { status: st.value, note: note.value } }); d.field = r.field; toast('저장했습니다.'); } catch (e) { toast(e.message, true); } };
  B.appendChild(h('div', { class: 'card' }, h('b', null, '현장 확인'), st, h('div', { style: { height: '6px' } }), note, can ? h('button', { class: 'primary mbtn', style: { marginTop: '6px', width: '100%' }, onclick: save }, '상태 저장') : h('div', { class: 'muted small' }, '조회 권한: 상태 변경·사진 등록 불가'), fs.by ? h('div', { class: 'small muted' }, `최종: ${fs.by} ${String(fs.at || '').slice(0, 16).replace('T', ' ')}`) : null));
  const kind = h('select', { class: 'msearch' }, ['현장사진', '시공사진'].map(k => h('option', null, k)));
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('target_type', 'device'); fd.append('target_id', d.id); fd.append('kind', kind.value); try { await api(`/api/projects/${pid}/attachments`, { body: fd }); model = await api(`/api/projects/${pid}/model`); toast('사진을 등록했습니다.'); device(id); } catch (er) { toast(er.message, true); } } });
  const atts = (model.attachments || []).filter(a => a.target_id === d.id);
  B.appendChild(h('div', { class: 'card' }, h('b', null, `사진·첨부 (${atts.length})`), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0' } }, atts.map(a => (a.mime || '').startsWith('image/') ? h('a', { href: `/api/files/${a.file_id}/view`, target: '_blank' }, h('img', { src: `/api/files/${a.file_id}/view`, style: { width: '96px', height: '72px', objectFit: 'cover' } })) : h('a', { href: `/api/files/${a.file_id}/view`, target: '_blank' }, a.original_name))), can ? h('div', null, kind, h('button', { class: 'mbtn', style: { width: '100%', marginTop: '6px' }, onclick: () => file.click() }, '사진 촬영·선택'), file) : null));
}
boot();
