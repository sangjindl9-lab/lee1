// CCTV 설치 제안서 – 화면
import { api, toast, h, modal, formGrid, download, confirmBox, uuid } from './ui.js';
import { renderPlan, el } from './planview.js';
const PC = window.PropCalc;
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const S = { me: null, products: [], P: null, plan: null, sel: null, tool: 'select', toolProduct: null, view: { z: 1, tx: 0, ty: 0 }, dirty: false, saving: false, undo: [], temp: null };
window.S = S;
const STATUS = ['작성 중', '제안 완료', '계약', '보류'];

function show(id) { ['login', 'list', 'editor'].forEach(x => $(x).classList.toggle('hidden', x !== id)); }
window.addEventListener('need-login', () => show('login'));
$('loginForm').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); try { await api('/api/login', { body: { username: f.get('username'), password: f.get('password') }, noAuthRedirect: true }); boot(); } catch (er) { $('loginErr').textContent = er.message; } };
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) ACT[b.dataset.act](b); });
async function boot() {
  try { S.me = await api('/api/me', { noAuthRedirect: true }); } catch { show('login'); return; }
  $('meName').textContent = `${S.me.user.name} · ${S.me.company.name || ''}`;
  document.querySelectorAll('.adm').forEach(b => b.classList.toggle('hidden', S.me.user.role !== 'admin'));
  if (S.me.company.color) document.documentElement.style.setProperty('--ac', S.me.company.color);
  S.products = await api('/api/products'); route();
}
window.addEventListener('hashchange', () => S.me && route());
function route() { const m = location.hash.match(/^#\/p\/([\w-]+)/); if (m) openProposal(m[1]); else { show('list'); loadList(); } }
async function loadList() {
  const list = await api('/api/proposals'); const q = ($('q').value || '').trim();
  const box = $('cards'); box.innerHTML = '';
  list.filter(p => !q || [p.customer_name, p.customer_address, p.title].some(v => (v || '').includes(q))).forEach(p => box.appendChild(h('div', { class: 'pcard', onclick: () => location.hash = '#/p/' + p.id },
    h('div', { class: 'row' }, h('span', { class: 't grow' }, p.customer_name || '(고객명 없음)'), h('span', { class: 'pill st-' + p.status.slice(0, 2) }, p.status)),
    h('div', { class: 'small' }, p.title), h('div', { class: 'small muted' }, p.customer_address || ''), h('div', { class: 'small muted' }, `카메라 ${p.cam_count}대 · ${p.staff_name || ''} · ${(p.updated_at || '').slice(0, 16)}`),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'grow' }), h('button', { class: 'small', onclick: async e => { e.stopPropagation(); const r = await api(`/api/proposals/${p.id}/copy`, { body: {} }); toast('사본을 만들었습니다.'); location.hash = '#/p/' + r.id; } }, '복사'), h('button', { class: 'small danger', onclick: async e => { e.stopPropagation(); if (await confirmBox(`「${p.customer_name} · ${p.title}」 제안서를 삭제합니다.`, '삭제')) { await api('/api/proposals/' + p.id, { method: 'DELETE' }); loadList(); } } }, '삭제')))));
  if (!list.length) box.appendChild(h('div', { class: 'muted' }, '아직 제안서가 없습니다. "+ 새 제안서"로 시작하세요.'));
}
$('q').oninput = () => loadList();
const CUST = [{ k: 'customer_name', label: '고객명' }, { k: 'customer_phone', label: '연락처' }, { k: 'customer_address', label: '설치 장소(주소)' }, { k: 'site_type', label: '현장 유형', type: 'select', options: ['', '단독주택', '아파트', '빌라·다세대', '상가·매장', '사무실', '공장·창고', '학교·기관', '기타'] }, { k: 'title', label: '제안서 제목' }];

const ACT = {
  logout: async () => { await api('/api/logout', { method: 'POST' }); location.hash = ''; show('login'); },
  new: async () => { const o = { site_type: '단독주택' }; const r = await modal('새 제안서', formGrid(CUST, o), [{ label: '취소' }, { label: '만들기', primary: true, action: () => { if (!o.customer_name) throw new Error('고객명을 입력하세요.'); return api('/api/proposals', { body: o }); } }]); if (r) location.hash = '#/p/' + r.id; },
  me: async () => { const o = { name: S.me.user.name, phone: S.me.user.phone }; const pw = {}; await modal('내 정보', h('div', null, formGrid([{ k: 'name', label: '이름' }, { k: 'phone', label: '연락처(제안서 담당자 표기)' }], o), h('h4', null, '비밀번호 변경'), formGrid([{ k: 'current', label: '현재', type: 'password' }, { k: 'next', label: '새 비밀번호', type: 'password' }], pw)), [{ label: '저장', primary: true, action: async () => { await api('/api/me', { method: 'PUT', body: o }); if (pw.next) await api('/api/me/password', { body: pw }); toast('저장했습니다.'); boot(); } }]); },
  products: () => productManager(),
  settings: () => settingsDialog(),
  users: () => usersDialog(),
  back: async () => { if (S.dirty) await save(); location.hash = ''; },
  info: () => { const o = { ...S.P }; modal('고객 정보', formGrid(CUST.concat([{ k: 'status', label: '진행 상태', type: 'select', options: STATUS }]), o), [{ label: '적용', primary: true, action: () => { CUST.concat([{ k: 'status' }]).forEach(f => S.P[f.k] = o[f.k]); markDirty(); $('ptitle').textContent = `${S.P.customer_name} · ${S.P.title}`; renderProps(); } }]); },
  quote: () => quoteDialog(),
  pdf: () => pdfDialog(),
  share: () => shareDialog(),
  addplan: () => addPlan()
};

// ===================== 편집기 =====================
async function openProposal(id) {
  if (S.P && S.P.id !== id && S.dirty) await save();
  const p = await api('/api/proposals/' + id); S.P = p; S.P.data = Object.assign({ plans: [], cams: [], marks: [], quote: { vat: true, lines: [] }, options: {} }, p.data);
  S.plan = (S.P.data.plans[0] || {}).id || null; S.sel = null; S.undo = []; S.dirty = false; setSave();
  show('editor'); $('ptitle').textContent = `${p.customer_name} · ${p.title}`;
  buildTools(); refreshLeft(); renderProps(); draw(); setTimeout(fit, 30);
  if (!S.P.data.plans.length) setTimeout(() => toast('먼저 "+ 도면"으로 고객 집 평면도·배치도 사진(또는 PDF)을 올리세요.'), 300);
}
const plan = () => S.P.data.plans.find(p => p.id === S.plan);
function markDirty(label) { if (label) { /* 실행 취소 기록은 change() */ } S.dirty = true; setSave(); clearTimeout(S.t); S.t = setTimeout(save, 1200); }
function change(label, fn) { S.undo.push(clone(S.P.data)); if (S.undo.length > 80) S.undo.shift(); fn(S.P.data); markDirty(); draw(); refreshLeft(); renderProps(); }
function setSave(txt, cls) { const e = $('saveState'); if (txt) { e.textContent = txt; e.className = 'pill ' + cls; return; } e.textContent = S.saving ? '저장 중…' : S.dirty ? '수정됨' : '저장됨'; e.className = 'pill ' + (S.dirty ? 'dirty' : 'ok'); }
async function save() {
  if (!S.P || !S.dirty || S.saving) return; S.saving = true; setSave();
  const body = { data: S.P.data, ver: S.P.ver }; CUST.concat([{ k: 'status' }]).forEach(f => body[f.k] = S.P[f.k]);
  try { const r = await api('/api/proposals/' + S.P.id, { method: 'PUT', body }); S.P.ver = r.ver; S.dirty = false; S.saving = false; setSave(); }
  catch (e) { S.saving = false; if (e.status === 409) { if (await confirmBox('다른 직원이 이 제안서를 먼저 수정했습니다.\n[확인] 내 화면 내용으로 덮어쓰기 / [취소] 서버 내용 다시 불러오기', '덮어쓰기')) { body.force = true; const r = await api('/api/proposals/' + S.P.id, { method: 'PUT', body }); S.P.ver = r.ver; S.dirty = false; setSave(); } else { S.dirty = false; openProposal(S.P.id); } } else setSave('저장 실패 – 자동 재시도', 'fail'), setTimeout(save, 4000); }
}
window.addEventListener('beforeunload', e => { if (S.dirty) { save(); e.preventDefault(); e.returnValue = ''; } });

function buildTools() {
  const t = $('tools'); t.innerHTML = '';
  const B = (k, label, title) => h('button', { class: S.tool === k ? 'on' : '', title: title || '', onclick: () => setTool(k) }, label);
  t.append(B('select', '선택·이동'), B('cam', '카메라 추가', '왼쪽 아래 목록에서 카메라 종류를 고른 뒤 도면 클릭'), B('nvr', '녹화기'), B('monitor', '모니터'), B('route', '배선 경로', '클릭으로 점 추가, 더블클릭·Enter로 완료'), B('text', '문자'), h('span', { class: 'sep' }), B('scale', '축척 맞추기', '도면에서 길이를 아는 두 점 클릭'), h('button', { onclick: fit }, '전체 보기'), h('button', { onclick: undo, title: 'Ctrl+Z' }, '되돌리기'), h('span', { class: 'sep' }), h('span', { class: 'small muted' }, '카메라: 끌어서 이동 · 주황 점을 끌면 방향·거리 조정 · Delete 삭제'));
}
function setTool(k) { S.tool = k; S.temp = null; buildTools(); hint(); draw(); }
function hint() { $('hint').textContent = { cam: S.toolProduct ? `「${(S.products.find(p => p.id === S.toolProduct) || {}).name}」 – 설치할 위치를 클릭하세요` : '왼쪽 목록에서 카메라 종류를 먼저 고르세요', nvr: '녹화기 위치를 클릭하세요', monitor: '모니터 위치를 클릭하세요', text: '문자를 넣을 위치를 클릭하세요', route: '배선 경로: 클릭으로 점 추가, 더블클릭 또는 Enter로 완료', scale: S.temp && S.temp.pts.length ? '두 번째 점을 클릭하세요' : '길이를 아는 두 점 중 첫 번째 점을 클릭하세요(예: 방 벽 길이, 축척 막대)' }[S.tool] || ''; }
function undo() { const u = S.undo.pop(); if (!u) return; S.P.data = u; markDirty(); S.sel = null; draw(); refreshLeft(); renderProps(); }

function refreshLeft() {
  const pl = $('plans'); pl.innerHTML = '';
  S.P.data.plans.forEach(p => pl.appendChild(h('div', { class: 'it' + (p.id === S.plan ? ' on' : ''), onclick: () => { S.plan = p.id; S.sel = null; draw(); refreshLeft(); renderProps(); setTimeout(fit, 10); } }, h('span', { class: 'grow' }, p.name || '도면'), PC.num(p.upm) ? null : h('span', { class: 'pill dirty', title: '축척 미설정' }, '축척'))));
  if (!S.P.data.plans.length) pl.appendChild(h('div', { class: 'it muted small' }, '도면 없음'));
  const cl = $('camlist'); cl.innerHTML = '';
  PC.numbered(S.P.data).forEach(c => { const I = PC.camInfo(c, S.products); cl.appendChild(h('div', { class: 'it' + (S.sel === c.id ? ' on' : ''), onclick: () => { if (c.plan !== S.plan) { S.plan = c.plan; setTimeout(fit, 10); } S.sel = c.id; draw(); refreshLeft(); renderProps(); } }, h('span', { class: 'dot', style: { background: c.color } }, c.no), h('span', { class: 'grow' }, h('div', null, c.place || '(위치명 입력)'), h('div', { class: 'small muted' }, I.name)))); });
  const pa = $('palette'); pa.innerHTML = '';
  S.products.filter(p => p.kind === 'camera' && p.active).forEach(p => pa.appendChild(h('div', { class: 'it' + (S.toolProduct === p.id && S.tool === 'cam' ? ' on' : ''), onclick: () => { S.toolProduct = p.id; setTool('cam'); refreshLeft(); } }, h('span', { class: 'grow' }, h('div', null, p.name), h('div', { class: 'small muted' }, `${p.data.type || ''} · 화각 ${p.data.hfov ?? '?'}° · ${p.data.range_m ?? '?'}m`)))));
}

// ---------- 그리기 ----------
const svg = () => $('svg');
function draw() {
  const s = svg(); s.innerHTML = ''; const p = plan(); if (!p) { const t = el('text', { x: 30, y: 50, 'font-size': 16, fill: '#888' }, s); t.textContent = '도면이 없습니다. 왼쪽 "+ 도면"으로 평면도·배치도 이미지나 PDF를 올리세요.'; return; }
  const g = el('g', { transform: `matrix(${S.view.z},0,0,${S.view.z},${S.view.tx},${S.view.ty})` }, s);
  renderPlan(g, p, S.P.data, S.products, { imgUrl: pl => `/api/files/${pl.file_id}?page=${pl.page || 1}`, selected: new Set(S.sel ? [S.sel] : []), unit: 1 / S.view.z, editable: true });
  const u = 1 / S.view.z;
  // 선택 카메라 핸들 (방향+거리)
  const c = S.P.data.cams.find(x => x.id === S.sel);
  if (c && c.plan === p.id) { const I = PC.camInfo(c, S.products); if (I.hfov < 360) { const r = handleR(c, I, p); const a = (+c.dir || 0) * Math.PI / 180; const hx = c.x + r * Math.sin(a), hy = c.y - r * Math.cos(a); el('line', { x1: c.x, y1: c.y, x2: hx, y2: hy, stroke: '#ff6a00', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }, g); el('circle', { cx: hx, cy: hy, r: 9 * u, fill: '#ff6a00', stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'data-h': 'dir', class: 'handle' }, g); } }
  const m = S.P.data.marks.find(x => x.id === S.sel);
  if (m && m.type === 'route') m.points.forEach((q, i) => el('rect', { x: q[0] - 6 * u, y: q[1] - 6 * u, width: 12 * u, height: 12 * u, fill: '#fff', stroke: '#ff6a00', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'data-h': 'v' + i, class: 'handle' }, g));
  if (S.temp && S.temp.pts.length) { const pts = S.temp.pts.concat(S.temp.cur ? [S.temp.cur] : []); el('polyline', { points: pts.map(q => q.join(',')).join(' '), fill: 'none', stroke: '#ff6a00', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g); pts.forEach(q => el('circle', { cx: q[0], cy: q[1], r: 4 * u, fill: '#ff6a00' }, g)); }
}
function handleR(c, I, p) { const upm = PC.num(p.upm); return upm && I.range ? I.range * upm : p.width * 0.12; }
function fit() { const p = plan(); if (!p) return; const r = svg().getBoundingClientRect(); const z = Math.min(r.width / p.width, r.height / p.height) * 0.95; S.view = { z, tx: (r.width - p.width * z) / 2, ty: (r.height - p.height * z) / 2 }; draw(); }
const toP = e => { const r = svg().getBoundingClientRect(); return [(e.clientX - r.left - S.view.tx) / S.view.z, (e.clientY - r.top - S.view.ty) / S.view.z]; };
let drag = null;
svg().addEventListener('wheel', e => { e.preventDefault(); const r = svg().getBoundingClientRect(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const cx = e.clientX - r.left, cy = e.clientY - r.top; S.view.tx = cx - (cx - S.view.tx) * f; S.view.ty = cy - (cy - S.view.ty) * f; S.view.z *= f; draw(); }, { passive: false });
svg().addEventListener('pointerdown', e => {
  const p = plan(); if (!p) return; const pt = toP(e); const D = S.P.data;
  const hdl = e.target.getAttribute && e.target.getAttribute('data-h');
  if (hdl) { drag = { kind: 'handle', h: hdl, before: clone(D) }; svg().setPointerCapture(e.pointerId); return; }
  if (S.tool === 'cam') { if (!S.toolProduct) { toast('왼쪽 아래 목록에서 카메라 종류를 먼저 고르세요.', true); return; } const pr = S.products.find(x => x.id === S.toolProduct); const seq = Math.max(0, ...D.cams.map(c => c.seq || 0)) + 1; const id = uuid(); change('카메라 추가', d => d.cams.push({ id, plan: p.id, seq, x: pt[0], y: pt[1], dir: 180, product_id: pr.id, place: '', show_night: pr.data.place !== '실외' })); S.sel = id; setTool('select'); draw(); refreshLeft(); renderProps(); setTimeout(() => { const f = document.querySelector('#props input'); f && f.focus(); }, 50); return; }
  if (S.tool === 'nvr' || S.tool === 'monitor') { const id = uuid(); change('장비', d => d.marks.push({ id, plan: p.id, type: S.tool, x: pt[0], y: pt[1] })); S.sel = id; setTool('select'); renderProps(); return; }
  if (S.tool === 'text') { const t = prompt('표시할 문자'); if (t) { const id = uuid(); change('문자', d => d.marks.push({ id, plan: p.id, type: 'text', x: pt[0], y: pt[1], text: t })); } setTool('select'); return; }
  if (S.tool === 'route' || S.tool === 'scale') { S.temp = S.temp || { pts: [] }; S.temp.pts.push(pt); if (S.tool === 'scale' && S.temp.pts.length === 2) { const [a, b] = S.temp.pts; S.temp = null; setTool('select'); scaleDialog(a, b); return; } hint(); draw(); return; }
  const tg = e.target.closest && e.target.closest('[data-id]');
  if (tg) { const id = tg.getAttribute('data-id'); S.sel = id; const o = D.cams.find(c => c.id === id) || D.marks.find(m => m.id === id); drag = { kind: 'move', id, start: pt, orig: clone(o), before: clone(D), moved: false }; svg().setPointerCapture(e.pointerId); draw(); refreshLeft(); renderProps(); return; }
  S.sel = null; drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx: S.view.tx, ty: S.view.ty }; svg().setPointerCapture(e.pointerId); draw(); refreshLeft(); renderProps();
});
svg().addEventListener('pointermove', e => {
  const pt = toP(e); const D = S.P && S.P.data;
  if (S.temp) { S.temp.cur = pt; draw(); }
  if (!drag) return;
  if (drag.kind === 'pan') { S.view.tx = drag.tx + e.clientX - drag.sx; S.view.ty = drag.ty + e.clientY - drag.sy; draw(); return; }
  if (drag.kind === 'move') { const o = D.cams.find(c => c.id === drag.id) || D.marks.find(m => m.id === drag.id); const dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1]; if (Math.hypot(dx, dy) * S.view.z > 2) drag.moved = true; if (!drag.moved) return; if (o.points) o.points = drag.orig.points.map(q => [q[0] + dx, q[1] + dy]); else { o.x = drag.orig.x + dx; o.y = drag.orig.y + dy; } draw(); return; }
  if (drag.kind === 'handle') {
    drag.moved = true;
    if (drag.h === 'dir') { const c = D.cams.find(x => x.id === S.sel); c.dir = Math.round(((Math.atan2(pt[0] - c.x, -(pt[1] - c.y)) * 180 / Math.PI) + 360) % 360); const p = plan(); const upm = PC.num(p.upm); if (upm) c.range = Math.max(1, Math.round(Math.hypot(pt[0] - c.x, pt[1] - c.y) / upm * 2) / 2); draw(); renderProps(true); }
    else { const m = D.marks.find(x => x.id === S.sel); m.points[+drag.h.slice(1)] = pt; draw(); }
  }
});
svg().addEventListener('pointerup', () => { if (drag && drag.moved && drag.before) { S.undo.push(drag.before); markDirty(); refreshLeft(); renderProps(); } drag = null; });
svg().addEventListener('dblclick', () => finishRoute());
window.addEventListener('keydown', e => {
  if ($('editor').classList.contains('hidden') || e.target.closest('input,textarea,select') || document.querySelector('.modal-bg')) return;
  if (e.key === 'Enter') finishRoute();
  if (e.key === 'Escape') { S.temp = null; setTool('select'); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) removeSel();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
new ResizeObserver(() => S.P && plan() && draw()).observe($('stage'));
function finishRoute() { if (S.tool !== 'route' || !S.temp) return; const pts = S.temp.pts; S.temp = null; if (pts.length >= 2) { const id = uuid(); change('배선 경로', d => d.marks.push({ id, plan: S.plan, type: 'route', points: pts })); } setTool('select'); }
function removeSel() { const id = S.sel; change('삭제', d => { d.cams = d.cams.filter(c => c.id !== id); d.marks = d.marks.filter(m => m.id !== id); }); S.sel = null; draw(); refreshLeft(); renderProps(); }

async function scaleDialog(a, b) {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]); const o = { len: '', unit: 'm' };
  const r = await modal('축척 맞추기', h('div', null, h('p', { class: 'small' }, '방금 찍은 두 점 사이의 실제 길이를 입력하세요. 화각 부채꼴과 감시 거리가 실제 비율로 그려집니다.'), formGrid([{ k: 'len', label: '실제 길이', type: 'number' }, { k: 'unit', label: '단위', type: 'select', options: ['m', 'cm', 'mm'] }], o)), [{ label: '취소' }, { label: '적용', primary: true, value: true }]);
  const m = (+o.len) / ({ m: 1, cm: 100, mm: 1000 }[o.unit]); if (!r || !(m > 0)) return;
  change('축척', d => { const p = d.plans.find(x => x.id === S.plan); p.upm = px / m; p.scale_note = `두 점 ${o.len}${o.unit} 기준`; }); toast(`축척 적용: 1m = ${(px / m).toFixed(1)}px`);
}
async function addPlan() {
  const inp = h('input', { type: 'file', accept: 'image/*,application/pdf' }); const o = { name: '', page: 1, width_m: '' }; const info = h('div', { class: 'small muted' });
  const r = await modal('도면 추가', h('div', { style: { width: '460px' } }, h('p', { class: 'small' }, '고객 집 평면도, 분양 도면, 손으로 그린 배치도 사진, 지도 캡처, PDF 모두 가능합니다.'), inp, formGrid([{ k: 'name', label: '도면 이름', ph: '예: 1층, 마당, 매장 내부' }, { k: 'page', label: 'PDF 페이지', type: 'number' }, { k: 'width_m', label: '도면 가로 실제 길이(m, 선택)', type: 'number', help: '모르면 비워 두고 나중에 "축척 맞추기"' }], o), info), [{ label: '취소' }, { label: '추가', primary: true, action: async () => {
    if (!inp.files[0]) throw new Error('파일을 선택하세요.'); info.textContent = '올리는 중…';
    const fd = new FormData(); fd.append('file', inp.files[0]); fd.append('plan', '1'); fd.append('page', o.page || 1); fd.append('proposal_id', S.P.id);
    return api('/api/files', { body: fd });
  } }]);
  if (!r) return; const id = uuid();
  change('도면 추가', d => d.plans.push({ id, name: o.name || inp.files[0].name.replace(/\.[^.]+$/, ''), file_id: r.id, page: r.page || 1, width: r.width, height: r.height, upm: +o.width_m > 0 ? r.width / +o.width_m : null, scale_note: +o.width_m > 0 ? `도면 가로 ${o.width_m}m 기준` : '' }));
  S.plan = id; refreshLeft(); setTimeout(fit, 30); renderProps(); if (!(+o.width_m > 0)) toast('"축척 맞추기"로 실제 길이를 알려주면 화각이 실제 비율로 그려집니다.');
}

// ---------- 속성 패널 ----------
function renderProps(light) {
  const box = $('props'); if (light && document.activeElement && box.contains(document.activeElement)) return; box.innerHTML = '';
  const D = S.P.data; const c = D.cams.find(x => x.id === S.sel); const m = D.marks.find(x => x.id === S.sel);
  if (c) {
    const n = PC.numbered(D).find(x => x.id === c.id); const I = PC.camInfo(c, S.products); const w = clone(c);
    box.appendChild(h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: n.color, width: '30px', height: '30px', fontSize: '15px' } }, n.no), h('h3', { style: { margin: 0 } }, '카메라 ' + n.no)));
    const apply = () => change('카메라 수정', d => Object.assign(d.cams.find(x => x.id === c.id), w));
    box.appendChild(formGrid([{ k: 'place', label: '설치 위치', ph: '예: 현관 앞, 주차장' }, { k: 'product_id', label: '카메라 종류', type: 'select', options: S.products.filter(p => p.kind === 'camera').map(p => [p.id, p.name]) },
      { k: 'dir', label: '방향(°)', type: 'number', help: '0=도면 위쪽, 시계 방향' }, { k: 'hfov', label: `화각(°) 기본 ${I.product.data ? I.product.data.hfov : ''}`, type: 'number', ph: '제품 기본값' }, { k: 'range', label: '표시 거리(m)', type: 'number', ph: `제품 ${I.product.data ? I.product.data.range_m : ''}m` }, { k: 'ir', label: '야간 거리(m)', type: 'number', ph: `제품 ${I.product.data ? I.product.data.ir_m || '' : ''}m` },
      { k: 'show_night', label: '야간 거리 표시', type: 'check', get: x => x.show_night !== false, set: (x, v) => x.show_night = v }, { k: 'height', label: '설치 높이(m)', type: 'number' }, { k: 'color', label: '색상', type: 'color', get: x => x.color || n.color },
      { k: 'note', label: '고객 설명 문구', type: 'textarea', full: true, ph: '예: 대문으로 들어오는 사람을 촬영합니다.' }], w, apply));
    const photo = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('proposal_id', S.P.id); try { const r = await api('/api/files', { body: fd }); change('사진', d => d.cams.find(x => x.id === c.id).photo_file_id = r.id); toast('설치 위치 사진을 넣었습니다.'); } catch (er) { toast(er.message, true); } } });
    box.appendChild(h('h3', null, '설치 위치 사진'));
    if (c.photo_file_id) box.appendChild(h('img', { src: '/api/files/' + c.photo_file_id, style: { width: '100%', borderRadius: '8px', marginBottom: '6px' } }));
    box.appendChild(h('div', { class: 'row' }, h('button', { onclick: () => photo.click() }, c.photo_file_id ? '사진 바꾸기' : '사진 넣기(현장 촬영)'), c.photo_file_id ? h('button', { onclick: () => change('사진 삭제', d => delete d.cams.find(x => x.id === c.id).photo_file_id) }, '빼기') : null, photo));
    box.appendChild(h('h3', null, '제안서 표시 내용'));
    box.appendChild(h('div', { class: 'box' }, `${I.name}${I.model ? ' (' + I.model + ')' : ''}`, h('br'), `${I.resolution || ''} ${I.lens ? '· ' + I.lens : ''}`, h('br'), `화각 ${I.hfov ?? '?'}° · 낮 약 ${I.range ?? '?'}m${I.ir ? ' · 야간 약 ' + I.ir + 'm' : ''}`, !PC.num(plan().upm) ? h('div', { class: 'err' }, '도면 축척이 없어 거리 비율이 맞지 않습니다. "축척 맞추기"를 하세요.') : null));
    box.appendChild(h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { onclick: () => { const id = uuid(); change('복제', d => d.cams.push({ ...clone(c), id, seq: Math.max(...d.cams.map(x => x.seq || 0)) + 1, x: c.x + 40, y: c.y + 40, place: '', photo_file_id: undefined })); S.sel = id; renderProps(); } }, '복제'), h('button', { onclick: () => moveOrder(c, -1) }, '번호 앞으로'), h('button', { onclick: () => moveOrder(c, 1) }, '번호 뒤로'), h('button', { class: 'danger', onclick: removeSel }, '삭제')));
    return;
  }
  if (m) { const w = clone(m); box.appendChild(h('h3', null, { nvr: '녹화기', monitor: '모니터', text: '문자', route: '배선 경로' }[m.type])); if (m.type !== 'route') box.appendChild(formGrid([{ k: 'text', label: m.type === 'text' ? '문자' : '표시 이름(선택)' }], w, () => change('수정', d => Object.assign(d.marks.find(x => x.id === m.id), w)))); else box.appendChild(h('div', { class: 'small muted' }, '주황 점을 끌어 경로를 고칠 수 있습니다.')); box.appendChild(h('button', { class: 'danger', style: { marginTop: '10px' }, onclick: removeSel }, '삭제')); return; }
  // 아무것도 선택 안 함: 제안서·도면 정보
  const p = plan(); const cams = PC.numbered(D); const Q = PC.quote(D, S.products);
  box.appendChild(h('h3', null, '제안서 요약'));
  box.appendChild(h('div', { class: 'box' }, h('b', null, S.P.customer_name || ''), ' 님 · ', S.P.site_type || '', h('br'), S.P.customer_address || '', h('br'), `카메라 ${cams.length}대 · 도면 ${D.plans.length}장`, h('br'), `견적 합계 ${PC.won(Q.total)}원${Q.vatIncluded ? '(부가세 포함)' : ''}`, h('br'), h('span', { class: 'pill st-' + S.P.status.slice(0, 2) }, S.P.status)));
  const opt = D.options = D.options || {}; const w = { date: D.date || '', memo: D.memo || '' };
  box.appendChild(h('h3', null, '제안서 정보'));
  box.appendChild(formGrid([{ k: 'date', label: '제안일', type: 'date' }, { k: 'memo', label: '상담 메모(제안서에 표시)', type: 'textarea', full: true }], w, () => change('정보', d => { d.date = w.date; d.memo = w.memo; })));
  if (p) {
    const pw = { name: p.name };
    box.appendChild(h('h3', null, '현재 도면'));
    box.appendChild(formGrid([{ k: 'name', label: '도면 이름' }], pw, () => change('도면 이름', d => d.plans.find(x => x.id === p.id).name = pw.name)));
    box.appendChild(h('div', { class: 'box', style: { marginTop: '6px' } }, PC.num(p.upm) ? `축척: 1m = ${(+p.upm).toFixed(1)}px (${p.scale_note || ''})` : h('span', { class: 'err' }, '축척 미설정 – 화각 거리가 실제 비율이 아닙니다.')));
    box.appendChild(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { onclick: () => setTool('scale') }, '축척 맞추기'), h('button', { class: 'danger', onclick: async () => { if (!await confirmBox('이 도면과 도면 위 카메라·표시를 모두 지웁니다.', '삭제')) return; change('도면 삭제', d => { d.plans = d.plans.filter(x => x.id !== p.id); d.cams = d.cams.filter(x => x.plan !== p.id); d.marks = d.marks.filter(x => x.plan !== p.id); }); S.plan = (D.plans[0] || {}).id; refreshLeft(); fit(); } }, '도면 삭제')));
  }
}
function moveOrder(c, dlt) { change('번호 순서', d => { const list = d.cams.filter(x => x.plan === c.plan).sort((a, b) => (a.seq || 0) - (b.seq || 0)); const i = list.findIndex(x => x.id === c.id), j = i + dlt; if (j < 0 || j >= list.length) return; const s = list[i].seq; list[i].seq = list[j].seq; list[j].seq = s; }); }

// ---------- 견적 ----------
async function quoteDialog() {
  const D = S.P.data; const q = clone(D.quote || { vat: true, lines: [] }); q.lines = q.lines || []; q.auto_price = q.auto_price || {};
  const body = h('div', { style: { width: 'min(860px, 92vw)' } });
  const draw = () => {
    body.innerHTML = ''; const Q = PC.quote({ ...D, quote: q }, S.products);
    const t = h('table', { class: 'grid' }, h('tr', null, ['품목', '규격', '단위', '수량', '단가(원)', '금액(원)', ''].map(x => h('th', null, x))));
    Q.lines.filter(l => l.auto).forEach(l => t.appendChild(h('tr', null, h('td', null, l.name, h('div', { class: 'small muted' }, '배치한 카메라 수 자동')), h('td', null, l.spec), h('td', null, l.unit), h('td', { class: 'num' }, l.qty), h('td', null, h('input', { type: 'number', value: l.price || '', style: { width: '110px' }, onchange: e => { q.auto_price[l.key] = e.target.value === '' ? null : +e.target.value; draw(); } })), h('td', { class: 'num' }, PC.won(l.amount)), h('td'))));
    q.lines.forEach((l, i) => { const ln = Q.lines.filter(x => !x.auto)[i]; t.appendChild(h('tr', null, ...['name', 'spec', 'unit'].map(k => h('td', null, h('input', { value: l[k] || '', style: { width: k === 'unit' ? '50px' : '100%' }, onchange: e => { l[k] = e.target.value; } }))), ...['qty', 'price'].map(k => h('td', null, h('input', { type: 'number', value: l[k] ?? '', style: { width: k === 'qty' ? '60px' : '110px' }, onchange: e => { l[k] = +e.target.value; draw(); } }))), h('td', { class: 'num' }, PC.won(ln.amount)), h('td', null, h('button', { onclick: () => { q.lines.splice(i, 1); draw(); } }, '삭제')))); });
    body.appendChild(t);
    const items = S.products.filter(p => p.kind === 'item' && p.active);
    const sel = h('select', null, h('option', { value: '' }, '품목 목록에서 추가…'), items.map(p => h('option', { value: p.id }, p.name)));
    sel.onchange = () => { const p = items.find(x => x.id === sel.value); if (p) { q.lines.push({ name: p.name, spec: p.model || '', unit: p.data.unit || '식', qty: p.name === '설치비' ? D.cams.length : 1, price: p.data.price || 0 }); draw(); } };
    body.appendChild(h('div', { class: 'row', style: { margin: '8px 0' } }, sel, h('button', { onclick: () => { q.lines.push({ name: '', spec: '', unit: '식', qty: 1, price: 0 }); draw(); } }, '+ 직접 입력')));
    body.appendChild(h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '16px' } }, h('label', null, '할인 ', h('input', { type: 'number', value: q.discount || '', style: { width: '110px' }, onchange: e => { q.discount = +e.target.value || 0; draw(); } })), h('label', null, h('input', { type: 'checkbox', checked: q.vat !== false, onchange: e => { q.vat = e.target.checked; draw(); } }), ' 부가세 10% 별도 표기')));
    body.appendChild(h('div', { class: 'box', style: { textAlign: 'right', marginTop: '8px', fontSize: '14px' } }, `공급가액 ${PC.won(Q.supply)}원`, Q.vatIncluded ? ` · 부가세 ${PC.won(Q.vat)}원` : '', h('br'), h('b', { style: { fontSize: '17px' } }, `합계 ${PC.won(Q.total)}원`)));
  };
  draw();
  if (await modal('견적', body, [{ label: '취소' }, { label: '적용', primary: true, value: true }])) change('견적', d => d.quote = q);
}
// ---------- PDF ----------
async function pdfDialog() {
  await save(); const D = S.P.data; const o = Object.assign({ paper: 'A4', orient: 'landscape', show_detail: true, show_quote: true, show_notice: true }, D.options || {});
  let frame = h('iframe', { style: { width: '100%', height: '68vh', border: '1px solid #ddd', borderRadius: '8px' } }); let blob = null;
  const gen = async () => { frame.srcdoc = '<p style="font-family:sans-serif;padding:20px">제안서를 만드는 중…</p>'; try { const r = await api(`/api/proposals/${S.P.id}/pdf`, { raw: true, body: o }); blob = await r.blob(); const nf = h('iframe', { src: URL.createObjectURL(blob), style: frame.getAttribute('style') }); frame.replaceWith(nf); frame = nf; } catch (e) { frame.srcdoc = `<p style="color:#c00;padding:20px">${e.message}</p>`; } };
  const body = h('div', { style: { width: 'min(1100px, 94vw)' } }, h('div', { class: 'row', style: { flexWrap: 'wrap', marginBottom: '8px' } },
    formGrid([{ k: 'paper', label: '용지', type: 'select', options: ['A4', 'A3'] }, { k: 'orient', label: '방향', type: 'select', options: [['landscape', '가로'], ['portrait', '세로']] }], o, gen),
    ...[['show_detail', '카메라별 안내'], ['show_quote', '견적'], ['show_notice', '안내 사항']].map(([k, l]) => h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: o[k] !== false, onchange: e => { o[k] = e.target.checked; gen(); } }), ' ' + l))), frame);
  setTimeout(gen, 50);
  await modal('제안서 PDF 미리보기', body, [{ label: '인쇄', action: () => { frame.contentWindow.print(); return false; } }, { label: 'PDF 저장', primary: true, action: () => { if (!blob) return false; const a = h('a', { href: URL.createObjectURL(blob), download: `${S.P.customer_name || '고객'}_CCTV설치제안서.pdf` }); a.click(); return false; } }], { noFocus: true });
  if (JSON.stringify(D.options) !== JSON.stringify(o)) change('출력 옵션', d => d.options = o);
}
async function shareDialog() {
  await save(); const link = t => `${location.origin}/s/${t}`;
  const body = h('div', { style: { width: 'min(520px, 90vw)' } });
  const draw = () => { body.innerHTML = ''; if (S.P.share_token) { const url = link(S.P.share_token); body.append(h('p', { class: 'small' }, '이 주소를 고객에게 보내면 로그인 없이 휴대폰·태블릿에서 설치 위치도와 제안 내용을 볼 수 있습니다(수정 불가). 고객 연락처는 표시되지 않습니다.'), h('input', { value: url, readonly: true, style: { width: '100%' }, onclick: e => e.target.select() }), h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'primary', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('주소를 복사했습니다.'); } }, '주소 복사'), h('a', { href: url, target: '_blank' }, '열어보기'), h('span', { class: 'grow' }), h('button', { class: 'danger', onclick: async () => { await api(`/api/proposals/${S.P.id}/share`, { body: { revoke: true } }); S.P.share_token = null; draw(); } }, '공유 중지'))); } else body.append(h('p', null, '아직 공유 링크가 없습니다.'), h('button', { class: 'primary', onclick: async () => { const r = await api(`/api/proposals/${S.P.id}/share`, { body: {} }); S.P.share_token = r.token; draw(); } }, '공유 링크 만들기')); };
  draw(); await modal('고객 공유 링크', body, null);
}

// ===================== 관리 화면 =====================
async function productManager() {
  let list = await api('/api/products'); let kind = 'camera'; const body = h('div', { style: { width: 'min(900px, 94vw)' } });
  const edit = async p => {
    const w = clone(p); w.data = w.data || {}; const D = (k, label, type, extra) => ({ label, type, get: x => x.data[k], set: (x, v) => x.data[k] = v, ...(extra || {}) });
    const F = [{ k: 'name', label: '제품명(제안서 표기)' }, { k: 'model', label: '모델명' }, { k: 'maker', label: '제조사' }].concat(w.kind === 'camera' ? [D('type', '형태', 'select', { options: ['돔형', '불릿형', 'PTZ', '어안', '큐브형', '기타'] }), D('place', '실내/실외', 'select', { options: ['실내', '실외', '실내외'] }), D('resolution', '해상도'), D('lens', '렌즈'), D('hfov', '수평 화각(°)', 'number'), D('range_m', '감시 거리(m)', 'number'), D('ir_m', '야간 적외선 거리(m)', 'number'), D('features', '특징(고객 설명)'), D('price', '기본 단가(원)', 'number'), D('note', '메모')] : [D('unit', '단위'), D('price', '기본 단가(원)', 'number')]).concat([{ k: 'active', label: '사용', type: 'check' }]);
    const ph = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); const r = await api('/api/files', { body: fd }); w.data.photo_file_id = r.id; toast('제품 사진 등록 – 저장을 누르세요.'); } });
    const r = await modal(p.id ? '제품 수정' : '제품 추가', h('div', { style: { width: '460px' } }, formGrid(F, w), w.kind === 'camera' ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { onclick: () => ph.click() }, '제품 사진'), w.data.photo_file_id ? h('span', { class: 'small muted' }, '등록됨') : null, ph) : null), [{ label: '취소' }, { label: '저장', primary: true, action: () => api('/api/products', { body: w }) }]);
    if (r) { list = await api('/api/products'); S.products = list; draw(); }
  };
  const draw = () => {
    body.innerHTML = ''; body.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: kind === 'camera' ? 'on' : '', onclick: () => { kind = 'camera'; draw(); } }, '카메라'), h('button', { class: kind === 'item' ? 'on' : '', onclick: () => { kind = 'item'; draw(); } }, '견적 품목'), h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => edit({ kind, name: '', data: {}, active: true }) }, '+ 추가')));
    const t = h('table', { class: 'grid' }, h('tr', null, (kind === 'camera' ? ['제품명', '모델', '형태', '해상도', '화각', '거리', '단가', ''] : ['품목', '규격', '단위', '단가', '']).map(x => h('th', null, x))));
    list.filter(p => p.kind === kind).forEach(p => t.appendChild(h('tr', { style: { opacity: p.active ? 1 : 0.45 } }, ...(kind === 'camera' ? [p.name, p.model, p.data.type, p.data.resolution, (p.data.hfov ?? '') + '°', (p.data.range_m ?? '') + 'm', PC.won(p.data.price)] : [p.name, p.model, p.data.unit, PC.won(p.data.price)]).map(v => h('td', null, v ?? '')), h('td', null, h('button', { onclick: () => edit(p) }, '수정')))));
    body.appendChild(t); body.appendChild(h('p', { class: 'small muted' }, '기본 목록은 일반적인 예시 사양입니다. 실제 판매하는 제품의 모델·화각·거리·단가로 고쳐 쓰세요.'));
  };
  draw(); await modal('카메라·견적 품목', body, null, { noFocus: true });
}
async function settingsDialog() {
  const s = await api('/api/settings'); const co = s.company, nt = s.notices; const isA = S.me.user.role === 'admin';
  const logo = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); const r = await api('/api/files', { body: fd }); co.logo_file_id = r.id; toast('로고 등록 – 저장을 누르세요.'); } });
  const body = h('div', { style: { width: 'min(640px, 92vw)' } }, h('h3', null, '회사 정보 (제안서 표지·하단)'), formGrid([{ k: 'name', label: '회사명' }, { k: 'tel', label: '전화' }, { k: 'email', label: '이메일' }, { k: 'address', label: '주소' }, { k: 'biz_no', label: '사업자등록번호' }, { k: 'slogan', label: '한 줄 소개' }, { k: 'color', label: '대표 색상', type: 'color' }], co), h('div', { class: 'row', style: { margin: '8px 0' } }, h('button', { onclick: () => logo.click() }, '로고 이미지'), co.logo_file_id ? h('img', { src: '/api/files/' + co.logo_file_id, style: { height: '32px' } }) : h('span', { class: 'small muted' }, '없음'), logo),
    h('h3', null, '제안서 안내 문구'), formGrid([{ k: 'fov', label: '화각 안내', type: 'textarea', full: true }, { k: 'quote', label: '견적 안내', type: 'textarea', full: true }, { k: 'service', label: 'A/S 안내', type: 'textarea', full: true }, { k: 'privacy', label: '개인정보 안내', type: 'textarea', full: true }], nt));
  await modal('회사·안내 문구', body, isA ? [{ label: '저장', primary: true, action: async () => { await api('/api/settings', { method: 'PUT', body: { company: co, notices: nt } }); toast('저장했습니다.'); boot(); } }] : null);
}
async function usersDialog() {
  const body = h('div', { style: { width: 'min(640px, 92vw)' } });
  const draw = async () => { const us = await api('/api/users'); body.innerHTML = ''; const t = h('table', { class: 'grid' }, h('tr', null, ['아이디', '이름', '연락처', '권한', ''].map(x => h('th', null, x)))); us.forEach(u => t.appendChild(h('tr', { style: { opacity: u.active ? 1 : .5 } }, h('td', null, u.username), h('td', null, u.name), h('td', null, u.phone || ''), h('td', null, u.role === 'admin' ? '관리자' : '직원'), h('td', null, h('button', { onclick: async () => { await api('/api/users/' + u.id, { method: 'PUT', body: { active: !u.active } }).catch(e => toast(e.message, true)); draw(); } }, u.active ? '중지' : '사용'), h('button', { onclick: async () => { const pw = prompt('새 비밀번호(8자 이상)'); if (pw) await api('/api/users/' + u.id, { method: 'PUT', body: { password: pw } }).then(() => toast('변경')).catch(e => toast(e.message, true)); } }, '비밀번호'))))); body.appendChild(t); const n = { role: 'staff' }; body.appendChild(h('h3', null, '직원 추가')); body.appendChild(formGrid([{ k: 'username', label: '아이디' }, { k: 'name', label: '이름' }, { k: 'phone', label: '연락처' }, { k: 'password', label: '비밀번호(8자+)', type: 'password' }, { k: 'role', label: '권한', type: 'select', options: [['staff', '직원'], ['admin', '관리자']] }], n)); body.appendChild(h('button', { class: 'primary', style: { marginTop: '8px' }, onclick: async () => { try { await api('/api/users', { body: n }); draw(); } catch (e) { toast(e.message, true); } } }, '추가')); };
  await draw(); await modal('직원 관리', body, null, { noFocus: true });
}
boot();
