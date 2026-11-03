// 화면 패널: 도구막대, 도면 목록, 라이브러리, 레이어, 속성, 하단 표, 대화상자
import { api, toast, h, modal, formGrid, esc, download, waitJob, confirmBox, uuid } from './ui.js';
import * as ED from './editor.js';
import { E } from './editor.js';
import * as SV from './schview.js';
import { productManager, tableEditor } from './products.js';
import { PROJECT_FIELDS, ROLE } from './app.js';

const CAT = window.CCTVCatalog, C = window.CCTVCalc, TB = window.CCTVTables;
const $ = id => document.getElementById(id);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const TN = t => (CAT.DEVICE_TYPES[t] || {}).name || t;

export function buildChrome() {
  $('projTitle').textContent = E.model.project.name + (E.model.project.is_sample ? ' [샘플]' : '');
  $('projSys').textContent = E.model.project.system_type; $('projRole').textContent = ROLE[E.role] || E.role;
  $('btnBack').onclick = async () => { if (E.dirty.size) await ED.save(); location.hash = ''; E.pid = null; E.model = null; };
  $('btnSave').onclick = async () => { if (!E.dirty.size) { toast('변경 사항이 없습니다.'); return; } if (await ED.save()) toast('저장했습니다.'); };
  $('btnSave').disabled = !ED.canEdit();
  $('btnAddSheet').onclick = uploadDialog; $('btnAddSheet').disabled = !ED.canEdit();
  $('btnAddLayer').onclick = addLayer; $('btnAddLayer').disabled = !ED.canEdit();
  buildLibrary(); refreshToolbar(); buildTabs();
}
export function refreshAll() { refreshSheets(); refreshLayers(); refreshProps(); scheduleTables(); refreshToolbar(); }

// ----- 도구막대 -----
export function refreshToolbar() {
  const tb = $('toolbar'); if (!tb || !E.model) return; tb.innerHTML = '';
  const B = (label, on, fn, title, dis) => h('button', { class: on ? 'on' : '', onclick: fn, title: title || '', disabled: dis || null }, label);
  const T = (t, label, opt, title) => B(label, E.tool === t && (!opt || JSON.stringify(E.toolOpt) === JSON.stringify(opt)), () => ED.setTool(t, opt), title, !ED.canEdit() && !['select', 'pan', 'zoomwin', 'measure'].includes(t));
  const sep = () => h('span', { class: 'sep' });
  const plan = E.mode === 'plan';
  tb.append(B('배치도', plan, () => { E.mode = 'plan'; ED.renderBg(); ED.render(); refreshToolbar(); }), B('계통도', !plan, () => { E.mode = 'schematic'; SV.enter(); refreshToolbar(); }), sep());
  if (plan) {
    tb.append(T('select', '선택'), T('pan', '이동'), B('전체 보기', false, () => ED.fitView(), 'F'), T('zoomwin', '영역 확대'), sep(),
      B('↶', false, ED.undo, '실행 취소 Ctrl+Z', !E.undo.length), B('↷', false, ED.redo, '다시 실행 Ctrl+Y', !E.redo.length), sep(),
      ...Object.entries(CAT.CABLE_KINDS).map(([k, v]) => T('cable', v.name, { kind: k }, v.name + ' 경로 작성: 장비 클릭 → 경유점 → 장비 클릭 (Enter/더블클릭 종료)')),
      T('conduit', '배관·트레이'), sep(),
      T('text', '문자'), T('leader', '인출선'), T('dim', '치수선'), T('measure', '거리측정'), T('area', '검토영역'), T('polyline', '폴리라인'), sep(),
      B('그리드', E.snap.grid, () => { E.snap.grid = !E.snap.grid; ED.render(); refreshToolbar(); }), B('끝점 스냅', E.snap.end, () => { E.snap.end = !E.snap.end; refreshToolbar(); }), B('장비 스냅', E.snap.port, () => { E.snap.port = !E.snap.port; refreshToolbar(); }), B('직교(F8)', E.snap.ortho, () => { E.snap.ortho = !E.snap.ortho; refreshToolbar(); }), B(E.keepConn ? '이동 시 연결 유지' : '이동 시 연결 해제', E.keepConn, () => { E.keepConn = !E.keepConn; refreshToolbar(); toast(E.keepConn ? '장비를 옮기면 연결된 케이블 끝점이 따라갑니다.' : '장비를 옮기면 연결된 케이블은 제자리에 남고 미연결 처리됩니다.'); }, '장비 이동 시 케이블 연결 처리 방식'), sep(),
      T('calib', '축척 보정', null, '도면에서 두 점을 찍고 실제 거리 입력'), B('회선 추적', !!E.trace, () => E.trace ? (E.trace = null, ED.render(), refreshToolbar()) : ED.traceSel()), B('감시 커버리지', !!E.coverage, coverageCheck),
      h('input', { placeholder: '검색: 번호·명칭·IP', style: { width: '150px' }, onkeydown: e => { if (e.key === 'Enter') search(e.target.value); } }), sep());
  } else tb.append(B('자동 배치 재생성', false, () => SV.enter(true), '수동으로 옮긴 위치는 유지'), B('수동 위치 초기화', false, SV.resetManual, '', !ED.canEdit()), h('select', { onchange: e => { SV.state.groupBy = e.target.value; SV.enter(true); } }, [['zone', '현장·동·층·구역 그룹'], ['floor', '동·층 그룹'], ['sheet', '도면별 그룹'], ['box', '함체별 그룹']].map(([v, l]) => h('option', { value: v, selected: SV.state.groupBy === v }, l))), B('전체 보기', false, SV.fit), sep());
  tb.append(B('출력(PDF)', false, () => printDialog()), B('Excel', false, () => download(`/api/projects/${E.pid}/export.xlsx`)), B('DXF', false, dxfExport), sep(),
    B('지도', false, mapDialog, '위경도 기준점이 연결된 도면을 외부 지도에 표시'), B('프로젝트 설정', false, projectSettings), B('품목', false, () => productManager(E.me, list => { E.model.products = list; ED.render(); scheduleTables(); })), B('개정·이력', false, historyDialog), B('백업', false, () => download(`/api/projects/${E.pid}/backup`), '', !ED.canEdit()));
}
function search(q) {
  q = (q || '').trim().toLowerCase(); if (!q) return;
  const f = ED.all().find(({ o }) => [(o.tag || ''), (o.name || ''), ((o.props || {}).ip || '')].some(v => String(v).toLowerCase().includes(q)));
  if (!f) { toast('찾을 수 없습니다: ' + q, true); return; }
  ED.zoomTo(f.o.id);
}

// ----- 도면 목록 -----
export function refreshSheets() {
  const l = $('sheetList'); l.innerHTML = '';
  const groups = {}; E.model.sheets.forEach(s => { const k = [s.building, s.floor].filter(Boolean).join(' ') || '(동·층 미지정)'; (groups[k] = groups[k] || []).push(s); });
  Object.entries(groups).forEach(([g, list]) => { l.appendChild(h('div', { class: 'grp small muted', style: { padding: '2px 10px', background: '#f3f4f6' } }, g)); list.forEach(s => l.appendChild(h('div', { class: 'it' + (s.id === E.sheetId ? ' on' : ''), onclick: () => ED.selectSheet(s.id) }, h('span', { class: 'grow' }, s.name), !C.upmOf(s) ? h('span', { class: 'badge w', title: '축척 미설정' }, '축척') : null, s.align_pending ? h('span', { class: 'badge e', title: '개정 정합 필요' }, '정합') : null))); });
  if (!E.model.sheets.length) l.appendChild(h('div', { class: 'muted small', style: { padding: '8px 10px' } }, '도면 없음'));
}
// ----- 라이브러리 -----
function buildLibrary() {
  const l = $('library'); l.innerHTML = '';
  CAT.LIBRARY.forEach(g => { l.appendChild(h('div', { class: 'grp' }, g.group)); g.items.forEach(it => l.appendChild(h('div', { class: 'it', title: '클릭 후 도면을 클릭하여 배치', onclick: () => { if (E.mode !== 'plan') { E.mode = 'plan'; ED.renderBg(); } ED.setTool('place', it); } }, it.label))); });
  const custom = (E.model.project.settings.custom_symbols || []);
  if (custom.length) { l.appendChild(h('div', { class: 'grp' }, '사용자 정의 심볼')); custom.forEach(it => l.appendChild(h('div', { class: 'it' }, h('span', { class: 'grow', onclick: () => ED.setTool('place', { label: it.label, type: 'custom', props: { custom_label: it.label, symbol_id: it.id, prefix: it.prefix || (it.props || {}).prefix } }) }, it.label), ED.canEdit() ? h('button', { style: { padding: '0 4px' }, onclick: () => symbolEditor(it) }, '편집') : null))); }
  if (ED.canEdit()) l.appendChild(h('div', { class: 'it muted', onclick: () => symbolEditor(null) }, '+ 사용자 정의 심볼'));
}
// ----- 레이어 -----
export function refreshLayers() {
  const l = $('layerList'); l.innerHTML = '';
  ED.layers().forEach(L => l.appendChild(h('div', { class: 'it', style: { cursor: 'default' } },
    h('input', { type: 'checkbox', checked: ED.layerVisible(L.key), title: '표시', onchange: e => { E.layerVis[L.key] = e.target.checked; localStorage.setItem('cctv-layervis-' + E.pid, JSON.stringify(E.layerVis)); if (L.key === 'BG') ED.renderBg(); ED.render(); } }),
    h('span', { style: { display: 'inline-block', width: '18px', height: '0', borderTop: `2px ${L.dash ? 'dashed' : 'solid'} ${L.color}` } }),
    h('span', { class: 'grow' }, L.name),
    h('button', { title: '잠금', class: L.locked ? 'on' : '', style: { padding: '0 4px' }, disabled: !ED.canEdit(), onclick: () => setLayer(L.key, { locked: !L.locked }) }, L.locked ? '잠금' : '편집'),
    h('button', { title: '출력 포함', class: L.print !== false ? 'on' : '', style: { padding: '0 4px' }, disabled: !ED.canEdit(), onclick: () => setLayer(L.key, { print: L.print === false }) }, '출력'),
    h('input', { type: 'color', value: L.color, title: '색상', style: { width: '22px', padding: 0, border: 0 }, disabled: !ED.canEdit(), onchange: e => setLayer(L.key, { color: e.target.value }) }))));
}
async function setLayer(key, patch) { const ls = ED.layers().map(l => l.key === key ? { ...l, ...patch } : l); await saveSettings({ layers: ls }); refreshLayers(); ED.render(); }
async function addLayer() { const o = { key: '', name: '', color: '#444444' }; const r = await modal('레이어 추가', formGrid([{ k: 'name', label: '레이어명' }, { k: 'key', label: '코드(영문)' }, { k: 'color', label: '색상', type: 'color' }], o), [{ label: '추가', primary: true, value: true }]); if (!r || !o.key || !o.name) return; if (ED.layers().some(l => l.key === o.key)) { toast('같은 코드가 있습니다.', true); return; } await saveSettings({ layers: ED.layers().concat([{ key: o.key.toUpperCase(), name: o.name, color: o.color, dash: '', lw: 0.3 }]) }); refreshLayers(); }
export async function saveSettings(patch) {
  try { const p = await api(`/api/projects/${E.pid}`, { method: 'PUT', body: { settings: patch, ver: E.model.project.ver } }); p.my_role = E.role; E.model.project = p; scheduleTables(); return true; }
  catch (e) { if (e.status === 409) { toast('다른 사용자가 프로젝트 설정을 수정했습니다. 다시 불러옵니다.', true); const p = await api(`/api/projects/${E.pid}`); E.model.project = p; } else toast(e.message, true); return false; }
}
async function saveSheet(patch, reason) {
  const s = ED.sheet();
  try { const r = await api(`/api/sheets/${s.id}`, { method: 'PUT', body: { ...patch, ver: s.ver, reason } }); Object.keys(r).forEach(k => s[k] = r[k]); refreshSheets(); return true; }
  catch (e) { if (e.status === 409) { toast(e.message + ' 최신 정보를 불러옵니다.', true); await ED.reload(true); } else toast(e.message, true); return false; }
}

// ----- 속성 패널 -----
export function refreshProps() {
  const box = $('props'); if (!box || !E.model) return; box.innerHTML = '';
  const ids = [...E.sel]; const ro = !ED.canEdit();
  if (!ids.length) { box.appendChild(sheetPanel()); return; }
  if (ids.length > 1) { box.appendChild(multiPanel(ids)); return; }
  const f = ED.find(ids[0]); if (!f) { E.sel.clear(); box.appendChild(sheetPanel()); return; }
  const o = f.o; const work = clone(o);
  const apply = (fld) => { ED.update(f.e, o, x => Object.assign(x, clone(work)), (fld && fld.label ? fld.label + ' 변경' : '속성 변경')); };
  const sec = (title, body) => h('div', { class: 'sec' }, h('div', { class: 'hd' }, title), h('div', { class: 'bd' }, body));
  if (f.e === 'devices') { devicePanel(box, o, work, apply, sec, ro); return; }
  if (f.e === 'cables') { cablePanel(box, o, work, apply, sec, ro); return; }
  if (f.e === 'conduits') { conduitPanel(box, o, work, apply, sec, ro); return; }
  box.appendChild(sec('주석', formGrid([{ k: 'type', label: '종류', readonly: true }, { k: 'text', label: '문자' }, { k: 'size', label: '글자 배율', type: 'number' }, { k: 'color', label: '색상', type: 'color' }].map(x => ({ ...x, readonly: x.readonly || ro })), work, apply)));
  if (o.type === 'area') box.appendChild(sec('감시 커버리지', h('button', { onclick: () => coverageCheck(o) }, '이 영역 사각지대·중복 검토')));
}
const P = (k, label, type, extra) => ({ label, type, get: o => (o.props || {})[k], set: (o, v) => { o.props = o.props || {}; o.props[k] = v; }, ...(extra || {}) });
function devicePanel(box, o, w, apply, sec, ro) {
  const p = w.props = w.props || {}; const T = CAT.DEVICE_TYPES[o.type];
  const prods = E.model.products.filter(x => x.category === 'device' && (!x.kind || x.kind === o.type));
  const others = t => E.model.devices.filter(d => t.includes(d.type)).map(d => [d.id, d.tag + ' ' + (d.name || '')]);
  const F = [{ section: TN(o.type) + ' – 공통' }, { k: 'tag', label: '관리번호' }, { k: 'name', label: '명칭' }, { k: 'status', label: '구분', type: 'select', options: CAT.STATUS }, { k: 'layer', label: '레이어', type: 'select', options: ED.layers().map(l => [l.key, l.name]) },
    { k: 'product_id', label: '제품(품목)', type: 'select', options: [['', '(선택 안 함)']].concat(prods.map(x => [x.id, x.name + ' ' + (x.spec || '')])) },
    P('maker', '제조사'), P('model', '모델'), P('location', '설치 위치'), P('height', '설치 높이(m)', 'number'), P('install', '설치 방식', 'select', { options: ['', '벽부', '천장', '폴', '브래킷', '랙', '기타'] }), P('housing', '방수함·하우징'), P('bracket', '폴·브래킷 품목'),
    { k: 'sheet_id', label: '도면', type: 'select', options: E.model.sheets.map(s => [s.id, s.name]) }, P('container_id', '수용 함체', 'select', { options: [['', '(없음)']].concat(others(['cabinet', 'rack'])) }), P('sym_scale', '심볼 배율', 'number'), P('power_w', '소비전력(W)', 'number'), P('power_source', '전원 방식', 'select', { options: ['', 'AC 220V', 'DC 12V', 'DC 24V', 'PoE', 'PoC', '기타'] })];
  if (o.type === 'camera') {
    F.push({ section: 'CCTV' }, P('system', '시스템 방식', 'select', { options: ['IP', '동축', '기타'] }), P('form', '형식', 'select', { options: ['고정형', '돔형', '불릿형', 'PTZ', '어안'] }), P('resolution', '해상도'), P('h_pixels', '가로 화소(px)', 'number'), P('lens', '렌즈'), P('hfov', '수평 화각(°)', 'number'), P('vfov', '수직 화각(°)', 'number'), P('direction', '촬영 방향(°, 북=0 시계)', 'number'), P('tilt', '하향각(°)', 'number'), P('range', '설계 감시거리(m)', 'number'),
      P('show_fov', '화각 표시', 'check', { get: x => (x.props || {}).show_fov !== false }), P('fov_opacity', '화각 투명도(0~1)', 'number'), P('fov_color', '화각 색상', 'color'));
    if (p.system !== '동축') F.push({ section: 'IP 속성' }, P('ip', 'IP 주소'), P('subnet', '서브넷'), P('gateway', '게이트웨이'), P('vlan', 'VLAN'), P('poe', 'PoE 사용', 'check'), P('poe_w', 'PoE 요구전력(W)', 'number'), P('poe_class', 'PoE 등급/규격'), P('bitrate_mbps', '비트레이트(Mbps)', 'number'),
      P('nvr_id', '연결 NVR', 'select', { options: [['', '(미지정)']].concat(others(['nvr', 'hvr', 'server'])) }), P('nvr_channel', 'NVR 채널', 'number'));
    if (p.system !== 'IP') F.push({ section: '동축 속성' }, P('signal', '영상 신호 방식', 'select', { options: [''].concat(CAT.SIGNALS) }), P('signal_custom', '사용자 정의 신호명'), P('out_res_mp', '출력 해상도(MP)', 'number'), P('out_fps', '출력 프레임률(fps)', 'number'), P('video_out', '영상 출력 단자', 'select', { options: ['', 'BNC', 'RCA', '기타'] }), P('video_impedance', '출력 임피던스(Ω)', 'number'),
      P('power_mode', '전원 방식', 'select', { options: [['별도전원', '별도 전원'], ['복합케이블', '영상·전원 복합케이블'], ['PoC', '동축 전원전송(PoC)']] }), P('poc_support', 'PoC 지원(사양 확인)', 'select', { options: [['', '미확인'], ['지원', '지원'], ['미지원', '미지원']] }), P('repeater', '중계기·변환기 사용'));
  }
  if (['nvr', 'dvr', 'hvr', 'encoder'].includes(o.type)) {
    F.push({ section: '녹화 장비' }, P('channels', '채널 수', 'number'), P('ip', 'IP 주소'), P('lan_ports', 'LAN 포트 수', 'number'), P('poe_ports', '내장 PoE 포트', 'number'), P('termination_required', '입력 종단 설정 필요', 'check'), P('termination_set', '종단 설정 확인', 'check'), P('poc_support', 'PoC 송출 지원', 'select', { options: [['', '미확인'], ['지원', '지원'], ['미지원', '미지원']] }), P('video_impedance', '입력 임피던스(Ω)', 'number'),
      { section: '녹화 설정 (저장용량 계산)' }, P('record_days', '녹화 일수', 'number'), P('record_hours', '하루 녹화 시간', 'number'), P('record_mode', '녹화 방식', 'select', { options: ['연속', '이벤트'] }), P('event_ratio_pct', '이벤트 녹화 비율(%)', 'number'), P('record_bitrate_mbps', '채널당 녹화 비트레이트(Mbps, 동축)', 'number'), P('disk_count', '디스크 수', 'number'), P('disk_tb', '디스크 용량(TB)', 'number'), P('raid', 'RAID', 'select', { options: ['없음', 'RAID1', 'RAID5', 'RAID6', 'RAID10'] }));
  }
  if (['switch', 'poe_switch', 'fiber_switch'].includes(o.type)) F.push({ section: '스위치' }, P('ports', 'RJ45 포트 수', 'number'), P('sfp_ports', 'SFP 포트 수', 'number'), P('poe_budget_w', '전체 PoE 예산(W)', 'number'), P('poe_port_max_w', '포트당 최대 PoE(W)', 'number'), P('ip', '관리 IP'), P('vlan', 'VLAN'));
  if (['fdf', 'patch_panel'].includes(o.type)) F.push(P('ports', '포트 수', 'number'));
  if (o.type === 'psu') F.push({ section: '전원공급장치' }, P('outputs', '출력 회로 수', 'number'), P('voltage', '출력 전압(V)', 'number'), P('current_type', 'AC/DC', 'select', { options: ['DC', 'AC'] }), P('capacity_w', '정격 용량(W)', 'number'));
  if (['panel', 'ups'].includes(o.type)) F.push(P('circuits', '회로 수', 'number'), P('outputs', '출력 수', 'number'), P('voltage', '전압(V)', 'number'), P('capacity_w', '용량(W)', 'number'));
  if (['coax_spd', 'coax_repeater', 'balun', 'video_converter', 'coax_joint'].includes(o.type)) F.push({ section: '중간 장비 사양 (제품 기준)' }, P('supported_signals', '지원 신호(쉼표 구분)', 'text', { get: x => ((x.props || {}).supported_signals || []).join(','), set: (x, v) => { x.props.supported_signals = String(v || '').split(',').map(s => s.trim()).filter(Boolean); } }), P('poc_support', 'PoC 통과 지원', 'select', { options: [['', '미확인'], ['지원', '지원'], ['미지원', '미지원']] }), P('termination_required', '종단 설정 필요', 'check'), P('termination_set', '종단 설정 확인', 'check'), P('video_impedance', '임피던스(Ω)', 'number'));
  if (o.type === 'custom') F.push({ section: '사용자 정의 장비' }, P('symbol_id', '심볼', 'select', { options: [['', '(기본 사각형)']].concat((E.model.project.settings.custom_symbols || []).map(x => [x.id, x.label])) }), P('custom_label', '장비 종류명'), P('prefix', '번호 접두어'));
  if (['fdf', 'junction_box', 'cabinet', 'custom', 'manhole', 'handhole'].includes(o.type)) F.push({ section: '광 접속(코어 단위)' }, { html: spliceEditor(o, ro) });
  if (o.type === 'offpage') F.push({ section: '도면 간 연결' }, P('link_ref', '연결 참조 기호'), { html: h('div', { class: 'small muted' }, '다른 도면에 같은 참조 기호를 가진 연결 참조를 배치하면 회선 추적·계통도에서 서로 이어집니다.') });
  F.push(P('extra_ports', '추가 포트(쉼표)'), P('note', '비고', 'textarea', { full: true }));
  box.appendChild(sec('속성', formGrid(F.map(x => x.section || x.html ? x : { ...x, readonly: ro }), w, (fld) => { if (fld.k === 'tag' && E.model.devices.some(d => d.id !== o.id && d.tag === w.tag)) toast('같은 관리번호가 이미 있습니다: ' + w.tag, true); if (fld.k === 'product_id' && w.product_id) { const pr = E.model.products.find(x => x.id === w.product_id); if (pr) { ['maker', 'model'].forEach(k => pr[k] && (w.props[k] = pr[k])); Object.entries(pr.props || {}).forEach(([k, v]) => { if (v != null && v !== '' && k !== 'note') w.props[k] = v; }); } } apply(fld); })));
  // 연결 정보
  const ix = C.index(E.model); const conn = E.model.cables.filter(c => C.endsOf(c).some(e => e.dev === o.id));
  const ports = CAT.portsFor(o);
  box.appendChild(sec(`연결 (${conn.length})`, h('div', null, h('table', { class: 'grid' }, h('tr', null, h('th', null, '포트'), h('th', null, '케이블'), h('th', null, '상대')), ports.map(pt => { const cs = conn.filter(c => C.endsOf(c).some(e => e.dev === o.id && e.port === pt.id)); return h('tr', { class: cs.length ? 'click' : '', onclick: () => cs[0] && ED.zoomTo(cs[0].id) }, h('td', null, pt.id), h('td', null, cs.map(c => c.tag).join(', ')), h('td', null, cs.map(c => { const e = C.endsOf(c).find(e => e.dev !== o.id); return e ? ((ED.dev(e.dev) || {}).tag || '') + ':' + e.port : '미연결'; }).join(', '))); })), h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { onclick: ED.traceSel }, '회선 추적')))));
  if (o.type === 'camera') {
    const g = C.fovGeometry(o, C.upmOf(ED.sheet()));
    box.appendChild(sec('화각 계산', h('div', { class: 'calc' }, g.ok ? [h('div', null, '표시 기준: ' + g.basis), g.ground ? h('div', null, `지면 투영: ${g.ground.near_m}m ~ ${g.ground.far_m == null ? '감시거리' : g.ground.far_m + 'm'}${g.ground.far_limited ? ' (설계 감시거리 제한)' : ''} — ${g.ground.assume}`) : null, g.ppm_at_range != null ? h('div', null, `픽셀 밀도(계산값): ${g.ppm_at_range} px/m @ ${g.range_m}m — ${g.ppm_basis}${E.model.project.settings.ppm_threshold ? ` / 사용자 기준 ${E.model.project.settings.ppm_threshold} px/m: ${g.ppm_at_range >= E.model.project.settings.ppm_threshold ? '기준 이상' : '기준 미만'}` : ' / 사용자 기준 미설정'}`) : null, h('div', { class: 'muted' }, '※ 계산값이며 감시 성능·식별 수준·법적 적합성을 보증하지 않습니다.')] : g.notes.join(' / '))));
  }
  const gr = (ED.sheet() || {}).georef; const ll = geoOf(gr, o.x, o.y);
  if (ll) box.appendChild(sec('지도 좌표', h('div', { class: 'calc' }, `위도 ${ll[0].toFixed(7)}, 경도 ${ll[1].toFixed(7)}`, h('div', { class: 'muted' }, `입력 기준점 ${gr.points.length}개로 보간한 값(소규모 현장 평면 근사)`))));
  fieldSection(box, o, sec);
  revSection(box, o, sec, ro);
}
// 기준점 2개 이상: 최소제곱 닮음변환으로 도면 좌표 → 위경도 근사 (기준점이 없으면 계산하지 않음)
function geoOf(gr, x, y) {
  if (!gr || !gr.points || gr.points.length < 2) return null;
  const P = gr.points.map(p => [+p.x, +p.y, +p.lng, +p.lat]); const n = P.length;
  const mx = P.reduce((s, p) => s + p[0], 0) / n, my = P.reduce((s, p) => s + p[1], 0) / n, mu = P.reduce((s, p) => s + p[2], 0) / n, mv = P.reduce((s, p) => s + p[3], 0) / n;
  let a = 0, b = 0, d = 0; P.forEach(([px, py, u, v]) => { const X = px - mx, Y = -(py - my), U = u - mu, V = v - mv; a += X * U + Y * V; b += X * V - Y * U; d += X * X + Y * Y; });
  if (!d) return null; a /= d; b /= d; const X = x - mx, Y = -(y - my);
  return [mv + b * X + a * Y, mu + a * X - b * Y];
}
function revSection(box, o, sec, ro) {
  if (!o.rev_review) return;
  box.appendChild(sec('개정 위치 검토', h('div', null, h('div', { class: 'small' }, `개정 ${o.rev_review.rev_no}: ${o.rev_review.state}`), h('button', { disabled: ro || null, onclick: () => ED.update('devices', o, x => { x.rev_review = { ...x.rev_review, state: '검토 완료', by: E.me.user.name }; }, '개정 위치 검토 완료') }, '위치 검토 완료'))));
}
function fieldSection(box, o, sec) {
  const fs = o.field || {};
  const st = h('select', { disabled: !ED.canField() || null }, CAT.FIELD_STATUS.map(s => h('option', { selected: (fs.status || '미확인') === s }, s)));
  const note = h('input', { value: fs.note || '', placeholder: '현장 메모', disabled: !ED.canField() || null });
  const send = async extra => { try { const r = await api(`/api/projects/${E.pid}/devices/${o.id}/field`, { method: 'PUT', body: { status: st.value, note: note.value, ...extra } }); const i = E.model.devices.findIndex(d => d.id === o.id); const keep = E.model.devices[i]; keep.field = r.field; keep.ver = r.ver; E.serverVer.set(o.id, r.ver); ED.render(); refreshProps(); toast('현장 확인 상태 저장'); } catch (e) { toast(e.message, true); } };
  st.onchange = () => send(); note.onchange = () => send();
  const atts = (E.model.attachments || []).filter(a => a.target_id === o.id);
  const kindSel = h('select', null, ['현장사진', '시공사진', '제품사양서'].map(k => h('option', null, k)));
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('target_type', 'device'); fd.append('target_id', o.id); fd.append('kind', kindSel.value); try { await api(`/api/projects/${E.pid}/attachments`, { body: fd }); const m = await api(`/api/projects/${E.pid}/model`); E.model.attachments = m.attachments; refreshProps(); toast('첨부 완료'); } catch (er) { toast(er.message, true); } } });
  box.appendChild(sec('현장 확인·첨부', h('div', null,
    h('div', { class: 'form' }, h('label', null, '현장 확인'), st, h('label', null, '메모'), note, h('label', null, '실제 설치 위치'), h('div', null, fs.actual ? `계획과 다름 (${fs.actual.map(v => v.toFixed(0)).join(', ')}) ` : '계획 위치와 동일 ', ED.canField() ? h('button', { onclick: () => pickActual(o, send) }, '도면에서 지정') : null, fs.actual && ED.canField() ? h('button', { onclick: () => send({ actual: null }) }, '해제') : null), h('label', null, '준공 반영'), h('input', { type: 'checkbox', checked: !!fs.as_built, disabled: !ED.canField() || null, onchange: e => send({ as_built: e.target.checked }) })),
    fs.by ? h('div', { class: 'small muted' }, `최종 확인: ${fs.by} ${String(fs.at || '').slice(0, 16).replace('T', ' ')}`) : null,
    h('div', { style: { marginTop: '6px' } }, atts.map(a => h('div', { class: 'row small' }, h('span', { class: 'badge' }, a.kind), h('a', { href: `/api/files/${a.file_id}/view`, target: '_blank' }, a.original_name), h('span', { class: 'grow' }), h('span', { class: 'muted' }, a.created_by || '')))),
    ED.canField() ? h('div', { class: 'row', style: { marginTop: '4px' } }, kindSel, h('button', { onclick: () => file.click() }, '파일·사진 첨부'), file) : null,
    h('div', { style: { marginTop: '4px' } }, h('button', { onclick: () => qrDialog(o) }, 'QR 코드')))));
}
function pickActual(o, send) {
  toast('도면에서 실제 설치 위치를 클릭하세요.');
  const svgEl = $('svg'); const fn = e => { svgEl.removeEventListener('click', fn, true); e.stopPropagation(); const p = ED.toDraw(e); send({ actual: p }); };
  setTimeout(() => svgEl.addEventListener('click', fn, true), 50);
}
function qrDialog(o) {
  const img = h('img', { src: `/api/projects/${E.pid}/devices/${o.id}/qr.png`, style: { width: '240px' } });
  modal('장비 QR 코드 – ' + o.tag, h('div', { style: { textAlign: 'center' } }, img, h('div', { style: { fontWeight: 700, fontSize: '16px' } }, o.tag), h('div', { class: 'small muted' }, 'QR로 접속해도 로그인과 프로젝트 권한이 필요합니다.')), [{ label: '인쇄', action: () => { const w = window.open(''); w.document.write(`<div style="text-align:center;font-family:sans-serif"><img src="${img.src}" style="width:60mm"><div style="font-size:16pt;font-weight:bold">${esc(o.tag)}</div><div>${esc(E.model.project.name)}</div></div>`); w.document.close(); setTimeout(() => w.print(), 400); return false; } }]);
}
function cablePanel(box, o, w, apply, sec, ro) {
  const ix = C.index(E.model); w.props = w.props || {}; w.from = w.from || {}; w.to = w.to || {};
  const prods = E.model.products.filter(x => x.category === 'cable' && x.kind === o.kind);
  const devOpts = [['', '(미연결)']].concat(E.model.devices.filter(d => d.sheet_id === o.sheet_id || d.type === 'offpage').map(d => [d.id, d.tag + ' ' + TN(d.type)]));
  const portOpts = id => { const d = ED.dev(id); return [['', '(포트 미지정)']].concat(d ? CAT.portsFor(d).map(p => [p.id, p.id + ' (' + p.kind + ')']) : []); };
  const conns = E.model.products.filter(x => x.category === 'accessory');
  const F = [{ section: CAT.CABLE_KINDS[o.kind].name }, { k: 'tag', label: '케이블 번호' }, { k: 'product_id', label: '규격(품목)', type: 'select', options: [['', '(미지정)']].concat(prods.map(x => [x.id, x.name + ' ' + (x.spec || '')])) }, { k: 'status', label: '구분', type: 'select', options: CAT.STATUS }, { k: 'method', label: '포설 방식', type: 'select', options: [''].concat(CAT.INSTALL_METHODS) },
    { section: '연결' }, { label: '시작 장비', type: 'select', options: devOpts, get: x => x.from.dev, set: (x, v) => { x.from = { dev: v || null, port: v ? ED.autoPort(ED.dev(v), o.kind, o.id) : null }; } }, { label: '시작 포트', type: 'select', options: portOpts(w.from.dev), get: x => x.from.port, set: (x, v) => x.from.port = v },
    { label: '종료 장비', type: 'select', options: devOpts, get: x => x.to.dev, set: (x, v) => { x.to = { dev: v || null, port: v ? ED.autoPort(ED.dev(v), o.kind, o.id) : null }; } }, { label: '종료 포트', type: 'select', options: portOpts(w.to.dev), get: x => x.to.port, set: (x, v) => x.to.port = v }];
  if (o.kind === 'composite') F.push({ section: '복합케이블 전원부 (같은 물리 케이블)' }, P('power_from_port', '카메라측 전원 포트'), P('power_to_dev', '전원부 종단 장비', 'select', { options: [['', '(미지정)']].concat(E.model.devices.filter(d => ['psu', 'panel', 'ups', 'power_spd', 'junction_box', 'offpage'].includes(d.type)).map(d => [d.id, d.tag])) }), P('power_to_port', '전원부 종단 포트', 'select', { options: portOpts(w.props.power_to_dev) }), P('split_tail_from_m', '시작측 분리 인입(m)', 'number'), P('split_tail_to_m', '종료측 분리 인입(m)', 'number'));
  F.push({ section: '길이' }, { k: 'vertical_m', label: '수직 길이(m)', type: 'number' }, { k: 'entry_m', label: '장비 인입 길이(m)', type: 'number' },
    { label: '여장 방식', type: 'select', options: [['project', '프로젝트 기본값'], ['fixed', '고정 길이(m)'], ['ratio', '비율(%)']], get: x => (x.slack || {}).mode || 'project', set: (x, v) => x.slack = { ...(x.slack || {}), mode: v } }, { label: '여장 값', type: 'number', get: x => (x.slack || {}).value, set: (x, v) => x.slack = { ...(x.slack || {}), value: v } }, { label: '여장 적용 대상', type: 'select', options: [['all', '측정+수직+인입'], ['measured', '도면 측정 길이만']], get: x => (x.slack || {}).target || 'all', set: (x, v) => x.slack = { ...(x.slack || {}), target: v } },
    { k: 'parent_id', label: '연속 구간(다른 도면의 같은 케이블)', type: 'select', options: [['', '(독립 케이블)']].concat(E.model.cables.filter(c => c.id !== o.id && c.kind === o.kind && !c.parent_id).map(c => [c.id, c.tag + ' @' + ((E.model.sheets.find(s => s.id === c.sheet_id) || {}).name || '')])) },
    { section: '부속 산출' }, P('factory_terminated', '공장 제작(양단 커넥터 포함)', 'check'), P('integrated_from', '시작측 장비 기본 제공/일체형 단자', 'check'), P('integrated_to', '종료측 장비 기본 제공/일체형 단자', 'check'), P('outdoor_from', '시작측 옥외(방수처리)', 'check'), P('outdoor_to', '종료측 옥외(방수처리)', 'check'),
    P('conn_from', '시작측 커넥터 품목', 'select', { options: [['', '(규칙 기본)']].concat(conns.map(x => [x.id, x.name + ' ' + (x.spec || '')])) }), P('conn_to', '종료측 커넥터 품목', 'select', { options: [['', '(규칙 기본)']].concat(conns.map(x => [x.id, x.name + ' ' + (x.spec || '')])) }));
  if (o.kind === 'fiber') F.push({ section: '광 코어' }, P('cores_used', '사용 코어(배정표 없을 때)', 'number'), P('cores_spare', '필요 예비 코어', 'number'), P('core_map', '코어 배정 메모', 'textarea', { full: true }), { html: coreEditor(o, ro) });
  if (o.kind === 'coax' || o.kind === 'composite') F.push(P('poc', '동축 전원전송 사용', 'check'));
  F.push(P('note', '비고', 'textarea', { full: true }));
  box.appendChild(sec('케이블 속성', formGrid(F.map(x => x.section ? x : { ...x, readonly: ro }), w, fld => { if (fld.label && /장비/.test(fld.label)) { /* 끝점을 장비 위치로 */ } apply(fld); refreshProps(); })));
  const L = C.cableLength(o, ix);
  box.appendChild(sec('길이 산출', h('div', { class: 'calc' }, L.final_m == null ? h('div', { class: 'warn' }, '확인 필요: ' + L.notes.join(', ')) : [h('div', null, `도면 측정: ${C.round2(L.measured_m)} m`), h('div', null, `수직: ${L.vertical_m} m / 인입: ${L.entry_m} m${L.tail_m ? ` / 분리 인입: ${L.tail_m} m` : ''}`), h('div', null, `여장: ${C.round2(L.slack_m)} m (${L.slack_desc})`), h('div', null, `합계 ${C.round2(L.total_m)} m → 반올림 단위 ${L.round_unit_m} m → `, h('b', null, `설계 수량 ${L.final_m} m`)), o.parent_id ? h('div', { class: 'muted' }, '연속 구간: 구매 물량은 원 케이블과 합산') : null, L.notes.length ? h('div', { class: 'warn' }, L.notes.join(', ')) : null])));
  // 관로 할당
  const cds = E.model.conduits.filter(c => c.sheet_id === o.sheet_id);
  box.appendChild(sec('경유 배관·트레이', h('div', null, cds.length ? cds.map(cd => h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: (o.conduit_ids || []).includes(cd.id), disabled: ro || null, onchange: e => ED.update('cables', o, x => { x.conduit_ids = (x.conduit_ids || []).filter(i => i !== cd.id); if (e.target.checked) x.conduit_ids.push(cd.id); }, '관로 할당') }), cd.tag + ' ' + ((E.model.products.find(p => p.id === cd.product_id) || {}).spec || ''))) : h('span', { class: 'muted small' }, '이 도면에 관로 없음'))));
  box.appendChild(sec('작업', h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('button', { disabled: ro || !(o.conduit_ids || []).length || null, onclick: () => routeByConduits(o), title: '할당한 배관·트레이 경로를 따라 케이블 선을 다시 그립니다' }, '관로 경로로 다시 그리기'), h('button', { onclick: ED.traceSel }, '회선 추적'), h('button', { disabled: ro || null, onclick: () => reverseCable(o) }, '방향 반전'))));
  attachSection(box, 'cable', o, sec, ['시험결과', '현장사진', '시공사진'], o.status === '재사용' ? '기존 회선 재사용: 현장 시험 결과(성적서·측정 사진)를 첨부하세요. 다른 전송방식 장비를 기존 동축에 쓰는 경우 실제 송수신 장비와 요구 조건을 장비로 등록하세요.' : '');
}
function attachSection(box, ttype, o, sec, kinds, note) {
  const atts = (E.model.attachments || []).filter(a => a.target_id === o.id);
  const kindSel = h('select', null, kinds.map(k => h('option', null, k)));
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('target_type', ttype); fd.append('target_id', o.id); fd.append('kind', kindSel.value); try { await api(`/api/projects/${E.pid}/attachments`, { body: fd }); const m = await api(`/api/projects/${E.pid}/model`); E.model.attachments = m.attachments; const fresh = m[ttype === 'cable' ? 'cables' : 'devices'].find(x => x.id === o.id); if (fresh) { const i = E.model[ttype === 'cable' ? 'cables' : 'devices'].findIndex(x => x.id === o.id); E.model[ttype === 'cable' ? 'cables' : 'devices'][i] = fresh; E.serverVer.set(fresh.id, fresh.ver); } refreshProps(); scheduleTables(); toast('첨부 완료'); } catch (er) { toast(er.message, true); } } });
  box.appendChild(sec(`첨부 (${atts.length})`, h('div', null, note ? h('div', { class: 'small warn' }, note) : null, atts.map(a => h('div', { class: 'row small' }, h('span', { class: 'badge' }, a.kind), h('a', { href: `/api/files/${a.file_id}/view`, target: '_blank' }, a.original_name), h('span', { class: 'grow' }), h('span', { class: 'muted' }, a.created_by || ''))), ED.canField() ? h('div', { class: 'row', style: { marginTop: '4px' } }, kindSel, h('button', { onclick: () => file.click() }, '파일 첨부'), file) : null)));
}
function reverseCable(o) { ED.update('cables', o, x => { x.points = C.cablePoints(o, C.index(E.model)).reverse(); const f = x.from; x.from = x.to; x.to = f; }, '케이블 방향 반전'); }
function conduitPanel(box, o, w, apply, sec, ro) {
  const prods = E.model.products.filter(x => x.category === 'conduit');
  box.appendChild(sec('배관·트레이', formGrid([{ k: 'tag', label: '관로 번호' }, { k: 'product_id', label: '품목', type: 'select', options: [['', '(미지정)']].concat(prods.map(x => [x.id, x.name + ' ' + (x.spec || '')])) }, { k: 'method', label: '시공 구분', type: 'select', options: CAT.RACEWAY_METHODS }, { k: 'status', label: '구분', type: 'select', options: CAT.STATUS }, { k: 'extra_m', label: '추가 길이(m)', type: 'number' }, { k: 'vertical_m', label: '수직 길이(m)', type: 'number' },
    { k: 'from_node', label: '시작 노드', type: 'select', options: [['', '(없음)']].concat(E.model.devices.filter(d => CAT.DEVICE_TYPES[d.type].raceNode || ['cabinet', 'junction_box', 'pole'].includes(d.type)).map(d => [d.id, d.tag])) }, { k: 'to_node', label: '종료 노드', type: 'select', options: [['', '(없음)']].concat(E.model.devices.filter(d => CAT.DEVICE_TYPES[d.type].raceNode || ['cabinet', 'junction_box', 'pole'].includes(d.type)).map(d => [d.id, d.tag])) }, { k: 'note', label: '비고', type: 'textarea', full: true }].map(x => ({ ...x, readonly: ro })), w, apply)));
  const rep = C.conduitReport(E.model).find(r => r.id === o.id);
  const cabs = E.model.cables.filter(c => (c.conduit_ids || []).includes(o.id));
  box.appendChild(sec(`수용 케이블 (${cabs.length})`, h('div', null, h('table', { class: 'grid' }, h('tr', null, h('th', null, '케이블'), h('th', null, '규격'), h('th', null, '외경')), cabs.map(c => { const p = E.model.products.find(x => x.id === c.product_id); return h('tr', { class: 'click', onclick: () => ED.zoomTo(c.id) }, h('td', null, c.tag), h('td', null, p ? p.spec || p.name : '미지정'), h('td', null, p && p.props.od_mm ? p.props.od_mm + 'mm' : h('span', { class: 'warn' }, '미입력'))); })),
    h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { disabled: ro || null, onclick: () => autoAssign(o) }, '경로가 겹치는 케이블 자동 할당')))));
  if (rep) box.appendChild(sec('산출', h('div', { class: 'calc' }, h('div', null, `길이: ${rep.len.final_m == null ? '확인 필요 (축척 미설정)' : rep.len.final_m + ' m (측정 ' + C.round2(rep.len.measured_m) + ' + 추가 ' + rep.len.extra_m + ')'} — 공용 구간 1회 집계`), h('div', null, `점유율: ${rep.fill_pct == null ? '계산 불가' : rep.fill_pct + '%'} (${rep.fill_note})`), h('div', null, `적용 기준: ${rep.fill_limit == null ? '미설정 (프로젝트 설정에서 입력)' : rep.fill_limit + '% → ' + rep.fill_state}`), rep.suggestions.length ? h('div', null, '부속 제안: ', rep.suggestions.map(s => {
    const inp = h('input', { type: 'number', value: (o.fitting_adjust || {})[s.item] || '', style: { width: '50px' }, disabled: ro || null, onchange: e => ED.update('conduits', o, x => { x.fitting_adjust = { ...(x.fitting_adjust || {}), [s.item]: e.target.value === '' ? null : +e.target.value }; }, '관로 부속 보정') });
    return h('div', null, `${s.item} 자동 ${s.qty} (${s.basis}) 보정 `, inp);
  })) : h('div', { class: 'muted' }, '부속 제안: 프로젝트 설정의 커플링 간격 규칙 입력 시 표시'))));
}
function autoAssign(cd) {
  const tol = ED.symSize() * 0.5; const ix = C.index(E.model);
  const near = (p, pts) => { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); if (Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= tol) return true; } return false; };
  const ch = [];
  E.model.cables.filter(c => c.sheet_id === cd.sheet_id && !(c.conduit_ids || []).includes(cd.id)).forEach(c => { const pts = C.cablePoints(c, ix); const mid = []; for (let i = 1; i < pts.length; i++) mid.push([(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]); const hit = mid.filter(m => near(m, cd.points)).length; if (hit) ch.push({ e: 'cables', before: clone(c), after: { ...clone(c), conduit_ids: (c.conduit_ids || []).concat([cd.id]) } }); });
  if (!ch.length) { toast('경로가 겹치는 케이블이 없습니다.'); return; }
  ED.commit('관로 자동 할당', ch); toast(`${ch.length}개 케이블을 ${cd.tag}에 할당했습니다.`);
}
function multiPanel(ids) {
  const objs = ids.map(ED.find).filter(Boolean);
  const box = h('div', { class: 'sec' }, h('div', { class: 'hd' }, `다중 선택 ${objs.length}개`));
  const bd = h('div', { class: 'bd' }); box.appendChild(bd);
  const cnt = {}; objs.forEach(f => cnt[f.e] = (cnt[f.e] || 0) + 1);
  bd.appendChild(h('div', { class: 'small' }, Object.entries(cnt).map(([k, v]) => `${{ devices: '장비', cables: '케이블', conduits: '관로', annotations: '주석' }[k]} ${v}`).join(', ')));
  if (ED.canEdit()) {
    const st = h('select', null, [''].concat(CAT.STATUS).map(s => h('option', null, s)));
    const ly = h('select', null, [['', '']].concat(ED.layers().map(l => [l.key, l.name])).map(([k, v]) => h('option', { value: k }, v)));
    bd.appendChild(h('div', { class: 'form', style: { marginTop: '6px' } }, h('label', null, '구분 일괄 변경'), st, h('label', null, '레이어(장비)'), ly));
    bd.appendChild(h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } }, h('button', { onclick: () => { const ch = objs.filter(f => f.e !== 'annotations').map(f => ({ e: f.e, before: clone(f.o), after: { ...clone(f.o), ...(st.value ? { status: st.value } : {}), ...(ly.value && f.e === 'devices' ? { layer: ly.value } : {}) } })); ED.commit('일괄 변경', ch); } }, '적용'), h('button', { onclick: () => ED.deleteSel() }, '삭제'), h('button', { onclick: () => { ED.copySel(); ED.paste(); } }, '복제'), h('button', { onclick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true })) }, '그룹(Ctrl+G)'), h('button', { onclick: renumber }, '번호 재부여')));
  }
  return box;
}
async function renumber() {
  const devs = [...E.sel].map(ED.find).filter(f => f && f.e === 'devices').map(f => f.o).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!devs.length) return; const o = { prefix: ED.devPrefix(devs[0].type, devs[0].props), start: 1 };
  if (!await modal('번호 재부여 (위→아래, 왼쪽→오른쪽 순)', formGrid([{ k: 'prefix', label: '접두어' }, { k: 'start', label: '시작 번호', type: 'number' }], o), [{ label: '적용', primary: true, value: true }])) return;
  const ch = devs.map((d, i) => ({ e: 'devices', before: clone(d), after: { ...clone(d), tag: `${o.prefix}-${String(+o.start + i).padStart(2, '0')}` } }));
  const newTags = new Set(ch.map(c => c.after.tag)); const clash = E.model.devices.filter(d => !devs.includes(d) && newTags.has(d.tag));
  if (clash.length) { toast('다른 장비와 번호가 겹칩니다: ' + clash.map(d => d.tag).join(', '), true); return; }
  ED.commit('번호 재부여', ch); toast('번호를 변경했습니다. 내부 ID로 연결되어 있어 케이블 연결은 유지됩니다.');
}
// ----- 도면(시트) 패널 -----
function sheetPanel() {
  const s = ED.sheet(); const wrap = h('div');
  const sec = (t, b) => h('div', { class: 'sec' }, h('div', { class: 'hd' }, t), h('div', { class: 'bd' }, b));
  if (!s) { wrap.appendChild(sec('도면', h('div', null, h('p', { class: 'small' }, '도면을 업로드하세요. 이미지(JPG·PNG), PDF(여러 페이지), DXF, DWG(변환 엔진 설정 시)를 지원합니다.'), h('button', { class: 'primary', onclick: uploadDialog, disabled: !ED.canEdit() || null }, '도면 업로드')))); return wrap; }
  const ro = !ED.canEdit(); const w = { name: s.name, building: s.building, floor: s.floor, zone: s.zone, sheet_no: s.sheet_no };
  wrap.appendChild(sec('도면 정보', formGrid([{ k: 'name', label: '도면명' }, { k: 'building', label: '동' }, { k: 'floor', label: '층' }, { k: 'zone', label: '구역' }, { k: 'sheet_no', label: '도면번호' }].map(x => ({ ...x, readonly: ro })), w, () => saveSheet(w))));
  const bgw = { opacity: s.opacity == null ? 1 : s.opacity, sym_size: s.sym_size || '', label_size: s.label_size || '', grid_size: s.grid_size || '' };
  const bgInfo = s.bg.kind === 'cad' ? `CAD (${s.bg.space === 'paper' ? '배치 공간' : '모델 공간'}) · 단위 ${s.bg.cad_units ? s.bg.cad_units.name : '미지정'}` : s.bg.kind === 'pdf' ? `PDF ${s.bg.page}쪽 (${s.bg.dpi}dpi 래스터 배경)` : s.bg.kind === 'image' ? '이미지 배경' : '빈 도면';
  wrap.appendChild(sec('배경', h('div', null, h('div', { class: 'small muted' }, bgInfo + ` · ${s.bg.width}×${s.bg.height}`), formGrid([{ k: 'opacity', label: '배경 투명도(0~1)', type: 'number' }, { k: 'sym_size', label: '심볼 크기(도면 단위)', type: 'number' }, { k: 'label_size', label: '라벨 글자 크기', type: 'number' }, { k: 'grid_size', label: '그리드 간격', type: 'number' }].map(x => ({ ...x, readonly: ro })), bgw, () => saveSheet({ data: { opacity: +bgw.opacity, sym_size: bgw.sym_size === '' ? null : +bgw.sym_size, label_size: bgw.label_size === '' ? null : +bgw.label_size, grid_size: bgw.grid_size === '' ? null : +bgw.grid_size } }).then(() => { ED.renderBg(); ED.render(); })),
    h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } }, h('button', { disabled: ro || null, onclick: () => rotateSheet(90) }, '90° 회전'), h('button', { disabled: ro || null, onclick: () => rotateSheet(270) }, '-90° 회전'), s.bg.file_id ? h('button', { onclick: () => download(`/api/files/${s.bg.file_id}/raw`) }, '원본 다운로드') : null, h('button', { disabled: ro || null, class: 'danger', onclick: deleteSheet }, '도면 삭제')))));
  const sc = s.scale || {}; const upm = C.upmOf(s);
  wrap.appendChild(sec('축척·좌표', h('div', null, h('div', { class: 'calc' }, upm ? [h('div', null, `1 m = ${C.round2(upm)} 도면 단위`), h('div', null, `출처: ${sc.source === 'cad' ? 'CAD 단위' : '두 점 보정'}${sc.real ? ` (${C.round2(sc.real)} ${sc.unit} 입력)` : ''}`), sc.source === 'cad' && !sc.confirmed ? h('div', { class: 'warn' }, 'CAD 단위를 확인하세요. 두 점 보정으로 대조할 수 있습니다.') : null, sc.check ? h('div', null, sc.check) : null, sc.note ? h('div', { class: 'muted' }, sc.note) : null] : h('div', { class: 'warn' }, '축척 미설정: 거리·물량은 확정값으로 표시되지 않습니다.')),
    h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } }, h('button', { disabled: ro || null, onclick: () => ED.setTool('calib') }, '두 점 축척 보정'), sc.source === 'cad' && !sc.confirmed ? h('button', { disabled: ro || null, onclick: () => saveSheet({ data: { scale: { ...sc, confirmed: true, note: 'CAD 단위 확인됨' } } }).then(refreshProps) }, 'CAD 단위 확인') : null, upm ? h('button', { disabled: ro || null, onclick: async () => { if (await confirmBox('축척을 해제하면 모든 길이가 확인 필요로 바뀝니다.')) { await saveSheet({ data: { scale: null } }); ED.render(); refreshProps(); scheduleTables(); } } }, '축척 해제') : null, h('button', { disabled: ro || null, onclick: georefDialog }, '지도 좌표 연결')),
    s.georef ? h('div', { class: 'small muted' }, `지도 좌표 연결됨: 기준점 ${s.georef.points.length}개`) : h('div', { class: 'small muted' }, '위경도가 있는 현장만 기준점을 입력해 연결합니다(임의 좌표 생성 안 함).'))));
  if (s.bg.kind === 'cad') {
    const cl = s.bg.cad_layers || {}; const box = h('div', { class: 'list', style: { maxHeight: '180px' } });
    Object.entries(cl).sort().forEach(([k, v]) => box.appendChild(h('div', { class: 'it', style: { cursor: 'default' } }, h('input', { type: 'checkbox', checked: v.visible !== false, disabled: ro || null, onchange: async e => { cl[k] = { ...v, visible: e.target.checked }; await saveSheet({ data: { bg: { ...s.bg, cad_layers: cl } } }); ED.renderBg(); } }), h('span', { class: 'grow small' }, k), h('input', { type: 'color', value: v.color_override || v.color || '#000000', disabled: ro || null, style: { width: '22px', padding: 0, border: 0 }, onchange: async e => { cl[k] = { ...v, color_override: e.target.value }; await saveSheet({ data: { bg: { ...s.bg, cad_layers: cl } } }); ED.renderBg(); } }))));
    wrap.appendChild(sec(`CAD 레이어 (${Object.keys(cl).length})`, h('div', null, box, h('div', { class: 'small muted' }, '배경 잠금은 왼쪽 레이어 패널의 "원본 도면" 잠금으로 설정합니다. 원본 파일은 변경되지 않습니다.'), h('button', { onclick: () => fileInfo(s.bg.file_id) }, '변환 경고·정보'))));
  }
  const revs = s.revisions || [];
  const ab = s.asbuilt || {};
  wrap.appendChild(sec('준공도 작성 상태', h('div', null, h('div', { class: 'row' }, h('select', { disabled: ro && !ED.canField() || null, onchange: e => saveSheet({ data: { asbuilt: { status: e.target.value, by: E.me.user.name, at: new Date().toISOString(), history: (ab.history || []).concat([{ status: e.target.value, by: E.me.user.name, at: new Date().toISOString() }]) } } }, '준공 상태 변경').then(refreshProps) }, ['미작성', '작성 중', '검토 요청', '보완 요청', '승인'].map(v => h('option', { selected: (ab.status || '미작성') === v }, v))), h('button', { onclick: () => printDialog({ keep: { asbuilt: true, sheets: [s.id] } }) }, '준공도 출력')),
    h('div', { class: 'small muted' }, `실제 위치 기록 ${E.model.devices.filter(d => d.sheet_id === s.id && d.field && d.field.actual).length}개 · 설치 완료 ${E.model.devices.filter(d => d.sheet_id === s.id && d.field && d.field.status === '설치 완료').length}/${E.model.devices.filter(d => d.sheet_id === s.id && d.type !== 'offpage').length} · 준공 반영 ${E.model.devices.filter(d => d.sheet_id === s.id && d.field && d.field.as_built).length}${ab.by ? ` · 최종 ${ab.by} ${String(ab.at).slice(0, 10)}` : ''}`))));
  wrap.appendChild(sec('개정', h('div', null, h('div', { class: 'small' }, `현재 개정: ${revs.length ? revs[revs.length - 1].rev_no : '0'} (개정 이력 ${revs.length}건)`), s.align_pending ? h('div', { class: 'warn small' }, '새 개정본이 올라왔습니다. 기준점 정합 후 기존 객체 위치를 검토하세요.') : null,
    h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'wrap' } }, h('button', { disabled: ro || null, onclick: revisionUpload }, '개정본 업로드'), s.prev_bg ? h('button', { disabled: ro || null, onclick: ED.startAlign }, '기준점 정합') : null, s.align_pending ? h('button', { disabled: ro || null, onclick: () => saveSheet({ data: { align_pending: false } }).then(refreshProps) }, '정합 생략') : null, h('button', { disabled: ro || null, onclick: async () => { const o = { rev_no: '', note: '' }; if (await modal('스냅샷 저장', formGrid([{ k: 'rev_no', label: '개정번호' }, { k: 'note', label: '메모' }], o), [{ label: '저장', primary: true, value: true }])) { if (E.dirty.size) await ED.save(); await api(`/api/sheets/${s.id}/snapshot`, { body: o }); toast('도면·물량표 스냅샷 저장'); } } }, '스냅샷 저장')))));
  return wrap;
}
async function fileInfo(fid) { const f = await api(`/api/files/${fid}/meta`); const m = f.meta; modal('파일 정보 – ' + f.name, h('div', { style: { maxWidth: '640px' } }, h('div', null, `형식: ${f.kind}${m.dwg_version ? ' (' + m.dwg_version + ')' : ''} · 크기 ${(f.size / 1024).toFixed(0)}KB`), m.units ? h('div', null, `CAD 단위: ${m.units.name}`) : null, m.stats ? h('div', null, `모델 공간 객체 ${m.stats.model} · 배치 공간 객체 ${m.stats.paper}`) : null, h('h4', null, '경고'), h('ul', null, (m.warnings || []).map(w => h('li', { class: 'small' }, w))), !(m.warnings || []).length ? h('div', { class: 'muted' }, '경고 없음') : null)); }
async function rotateSheet(deg) { if (E.dirty.size) await ED.save(); try { await api(`/api/sheets/${E.sheetId}/rotate`, { body: { deg } }); await ED.reload(true); await ED.renderBg(); ED.fitView(); toast('도면과 설계 객체를 함께 회전했습니다.'); } catch (e) { toast(e.message, true); } }
async function deleteSheet() { const s = ED.sheet(); if (!await confirmBox(`도면 「${s.name}」과 이 도면의 모든 설계 객체를 삭제합니다. 되돌릴 수 없습니다.`, '삭제')) return; await api(`/api/sheets/${s.id}`, { method: 'DELETE' }); await ED.reload(); ED.selectSheet((E.model.sheets[0] || {}).id); }
export async function calibDialog(pts) {
  const s = ED.sheet(); const du = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const o = { real: '', unit: 'm' }; const cad = s.scale && s.scale.source === 'cad' ? s.scale.upm : null;
  const r = await modal('축척 보정', h('div', null, h('p', { class: 'small' }, `선택한 두 점의 도면상 거리: ${du.toFixed(2)} 단위`), formGrid([{ k: 'real', label: '실제 거리', type: 'number' }, { k: 'unit', label: '단위', type: 'select', options: ['mm', 'cm', 'm'] }], o)), [{ label: '취소' }, { label: '적용', primary: true, value: true }]);
  if (!r) return; const real = +o.real; if (!(real > 0)) { toast('실제 거리를 입력하세요.', true); return; }
  const meters = o.unit === 'mm' ? real / 1000 : o.unit === 'cm' ? real / 100 : real;
  const upm = du / meters;
  let check = '';
  if (cad) { const diff = (upm - cad) / cad * 100; check = `CAD 단위 기준 ${C.round2(cad)} 대비 ${diff.toFixed(2)}% 차이${Math.abs(diff) > 2 ? ' – CAD 단위 설정 또는 측정점을 확인하세요' : ''}`; }
  await saveSheet({ data: { scale: { upm, p1: pts[0], p2: pts[1], real, unit: o.unit, source: 'calib', confirmed: true, check } } }, '축척 보정');
  toast(`축척 설정: 1m = ${C.round2(upm)} 단위${check ? ' / ' + check : ''}`);
  ED.render(); refreshProps(); scheduleTables(); refreshSheets();
}

// ----- 업로드 -----
export async function uploadDialog() {
  const inp = h('input', { type: 'file', accept: '.jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf,.dxf,.dwg' });
  const info = h('div', { class: 'small', style: { margin: '8px 0' } }); const prog = h('div', { class: 'prog' }, h('div'));
  const ex = { building: '', floor: '', zone: '' };
  const dwg = await api('/api/settings/dwg');
  const body = h('div', { style: { width: '640px' } }, h('p', { class: 'small muted' }, '지원: 이미지(JPG·PNG 등), PDF(단일·다중 페이지), DXF, DWG' + (dwg.configured ? '' : ' — DWG 변환 엔진 설정 필요(현재 미설정: DXF 또는 PDF로 저장하여 업로드하세요)')), inp, formGrid([{ k: 'building', label: '동' }, { k: 'floor', label: '층' }, { k: 'zone', label: '구역' }], ex), prog, info);
  let fileRec = null, meta = null, pages = [], space = 'model', vectorBg = true;
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return; info.innerHTML = '업로드 중…'; prog.firstChild.style.width = '10%';
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await api(`/api/projects/${E.pid}/files`, { body: fd }); fileRec = r.file;
      info.textContent = '파일 분석 중…';
      const j = await waitJob(r.job, j => { prog.firstChild.style.width = j.progress + '%'; info.textContent = `분석 ${j.status} (${j.progress}%)`; });
      meta = j.result; info.innerHTML = '';
      if (fileRec.kind === 'pdf') {
        info.appendChild(h('div', null, `PDF ${meta.pages}쪽 – ${meta.note}`));
        const th = h('div', { class: 'thumbs' });
        pages = []; for (let i = 1; i <= meta.pages; i++) { const pg = { page: i, name: `${f.name.replace(/\.pdf$/i, '')} ${meta.pages > 1 ? i + '쪽' : ''}`.trim(), on: meta.pages <= 12 || i === 1 }; pages.push(pg); th.appendChild(h('label', null, i <= (meta.thumbs || []).length ? h('img', { src: `/api/files/${fileRec.id}/thumb/${i - 1}` }) : h('div', { class: 'muted' }, i + '쪽'), h('span', null, h('input', { type: 'checkbox', checked: pg.on, onchange: e => pg.on = e.target.checked }), i + '쪽'), h('input', { value: pg.name, onchange: e => pg.name = e.target.value }))); }
        info.appendChild(h('div', { class: 'small muted' }, '선택한 페이지를 각각의 도면으로 등록합니다.')); info.appendChild(th);
        if (meta.hasText) info.appendChild(h('label', { class: 'row small', style: { marginTop: '6px' } }, h('input', { type: 'checkbox', checked: true, onchange: e => vectorBg = e.target.checked }), '벡터 PDF를 벡터 배경으로 사용(확대해도 선명, 출력도 벡터). 선은 배경이며 설계 객체로 바뀌지 않습니다.'));
      } else if (fileRec.kind === 'dxf' || fileRec.kind === 'dwg') {
        info.appendChild(h('div', null, `CAD 단위: ${meta.units.name} · 모델 공간 객체 ${meta.stats.model}개 · 배치 공간 객체 ${meta.stats.paper}개 · 레이어 ${Object.keys(meta.layers).length}개`));
        info.appendChild(h('div', { class: 'row' }, '사용할 공간: ', h('select', { onchange: e => space = e.target.value }, h('option', { value: 'model' }, '모델 공간'), meta.stats.paper ? h('option', { value: 'paper' }, '배치 공간') : null)));
        if (meta.warnings.length) info.appendChild(h('ul', { class: 'warn' }, meta.warnings.map(w => h('li', null, w))));
        pages = [{ page: 1, name: f.name.replace(/\.(dxf|dwg)$/i, ''), on: true }];
      } else { info.appendChild(h('div', null, `이미지 ${meta.width}×${meta.height}px – 배경으로 사용하며 설계 객체는 별도로 저장됩니다.`)); pages = [{ page: 1, name: f.name.replace(/\.[^.]+$/, ''), on: true }]; }
    } catch (e) { info.innerHTML = ''; info.appendChild(h('div', { class: 'err' }, e.message)); fileRec = null; }
  };
  const r = await modal('도면·지도 업로드', body, [{ label: '빈 도면 만들기', action: async () => { const r = await api(`/api/projects/${E.pid}/sheets`, { body: { name: '빈 도면', ...ex } }); return r.ids; } }, { label: '도면 등록', primary: true, action: async () => {
    if (!fileRec) throw new Error('파일을 먼저 선택하고 분석이 끝날 때까지 기다리세요.');
    const sel = pages.filter(p => p.on); if (!sel.length) throw new Error('등록할 페이지를 선택하세요.');
    const r = await api(`/api/projects/${E.pid}/sheets`, { body: { file_id: fileRec.id, pages: sel, space, vector: vectorBg, ...ex } });
    const j = await waitJob(r.job, j => { prog.firstChild.style.width = j.progress + '%'; info.firstChild && (info.firstChild.textContent = `도면 생성 ${j.progress}%`); });
    return j.result.sheet_ids;
  } }]);
  if (r && r.length) { await ED.reload(); ED.selectSheet(r[0]); toast(`도면 ${r.length}개를 등록했습니다.${C.upmOf(E.model.sheets.find(s => s.id === r[0])) ? '' : ' 축척 보정을 진행하세요.'}`); }
}
async function revisionUpload() {
  const s = ED.sheet(); const inp = h('input', { type: 'file', accept: '.jpg,.jpeg,.png,.pdf,.dxf,.dwg' }); const o = { rev_no: String((s.revisions || []).length), note: '', page: 1 };
  const r = await modal('개정본 업로드 – ' + s.name, h('div', null, h('p', { class: 'small' }, '현재 도면·객체·물량표가 스냅샷으로 보관된 후 배경이 새 파일로 바뀝니다. 업로드 후 기준점 정합으로 객체 위치를 맞추세요.'), inp, formGrid([{ k: 'rev_no', label: '개정번호' }, { k: 'note', label: '개정 사유' }, { k: 'page', label: 'PDF 페이지', type: 'number' }], o)), [{ label: '취소' }, { label: '업로드', primary: true, action: async () => {
    if (!inp.files[0]) throw new Error('파일을 선택하세요.'); if (E.dirty.size) await ED.save();
    const fd = new FormData(); fd.append('file', inp.files[0]); Object.entries(o).forEach(([k, v]) => fd.append(k, v));
    const x = await api(`/api/sheets/${s.id}/revision`, { body: fd }); await waitJob(x.job); return true;
  } }]);
  if (r) { await ED.reload(true); await ED.renderBg(); ED.fitView(); toast('개정본을 등록했습니다. 기준점 정합을 진행하세요.'); }
}

// ----- 하단 표 -----
const TAB_NAMES = { review: '검토', equipment: '장비 일람', cables: '케이블', quantity: '물량산출', summary: '공종별 집계', cctv: 'CCTV 수량', channels: '채널 배정', ports: '스위치 포트', ip: 'IP 주소', coax: '동축 회선', fiber: '광코어', splices: '광 접속', power: '전원 회로', conduit: '배관·트레이', boxes: '함체·폴', accessories: '커넥터·부속', storage: '저장용량' };
let curTab = 'review', tabTimer = null;
function buildTabs() {
  const t = $('tabs'); t.innerHTML = '';
  Object.entries(TAB_NAMES).forEach(([k, v]) => t.appendChild(h('button', { class: 'tab' + (curTab === k ? ' on' : ''), 'data-k': k, onclick: () => { curTab = k; [...t.children].forEach(b => b.classList.toggle('on', b.dataset.k === k)); $('bottom').classList.remove('min'); renderTables(); } }, v)));
  t.appendChild(h('span', { class: 'grow' })); t.appendChild(h('button', { class: 'tab', onclick: () => $('bottom').classList.toggle('min') }, '접기/펴기'));
}
export function scheduleTables() { clearTimeout(tabTimer); tabTimer = setTimeout(renderTables, 250); }
function renderTables() {
  const b = $('tabBody'); if (!b || !E.model) return;
  let tb; try { tb = TB.build(E.model); } catch (e) { b.innerHTML = ''; b.appendChild(h('div', { class: 'err', style: { padding: '8px' } }, '표 계산 오류: ' + e.message)); console.error(e); return; }
  E.tables = tb;
  const t = tb[curTab]; b.innerHTML = '';
  const bar = h('div', { class: 'row', style: { padding: '3px 8px', background: '#fafafa', borderBottom: '1px solid #eee' } }, h('b', null, t.title), h('span', { class: 'muted small' }, ` ${t.rows.length}행`), h('span', { class: 'grow' }));
  if (curTab === 'review') { const n = l => t.rows.filter(r => r[0] === l).length; bar.appendChild(h('span', null, h('span', { class: 'badge e' }, '오류 ' + n('오류')), ' ', h('span', { class: 'badge w' }, '경고 ' + n('경고')), ' ', h('span', { class: 'badge c' }, '확인 필요 ' + n('확인 필요')))); }
  if (curTab === 'accessories' && ED.canEdit()) bar.appendChild(h('button', { onclick: accessoryAdjust }, '수량 보정·산출 규칙'));
  if (curTab === 'quantity' && ED.canEdit()) bar.appendChild(h('button', { onclick: manualItems }, '수동 항목 추가'));
  if (curTab === 'equipment') bar.appendChild(h('span', null, h('button', { onclick: () => download(`/api/projects/${E.pid}/devices/template.xlsx`) }, '엑셀 양식(현재 장비)'), ED.canEdit() ? h('button', { onclick: importDevices }, '엑셀 일괄 등록·수정') : null));
  b.appendChild(bar);
  const table = h('table', { class: 'grid' }, h('tr', null, t.head.map(x => h('th', null, x))));
  t.rows.forEach((r, i) => { const refs = (t.refs && t.refs[i]) || []; const tr = h('tr', { class: refs.length ? 'click' : '', onclick: () => { if (!refs.length) return; const id = refs[0].id; if (refs[0].type === 'sheet') { ED.selectSheet(id); return; } ED.zoomTo(id); if (refs.length > 1) { E.sel = new Set(refs.map(x => x.id)); ED.render(); refreshProps(); } } }, r.map((c, ci) => h('td', { class: typeof c === 'number' ? 'num' : (curTab === 'review' && ci === 0 ? ({ '오류': 'err', '경고': 'warn', '확인 필요': 'chk' }[c] || '') : '') }, c == null ? '' : String(c)))); table.appendChild(tr); });
  if (!t.rows.length) table.appendChild(h('tr', null, h('td', { colspan: t.head.length, class: 'muted' }, '해당 항목 없음')));
  b.appendChild(table);
}
async function importDevices() {
  const inp = h('input', { type: 'file', accept: '.xlsx' }); const res = h('div', { class: 'small' });
  let file = null;
  inp.onchange = async () => { file = inp.files[0]; const fd = new FormData(); fd.append('file', file); try { const r = await api(`/api/projects/${E.pid}/devices/import?dry=1`, { body: fd }); res.innerHTML = ''; res.appendChild(h('div', null, `신규 ${r.created} · 수정 ${r.updated}`)); if (r.errors.length) res.appendChild(h('ul', { class: 'err' }, r.errors.map(e => h('li', null, e)))); } catch (e) { res.textContent = e.message; } };
  const ok = await modal('장비 엑셀 일괄 등록·수정', h('div', { style: { width: '520px' } }, h('p', { class: 'small muted' }, '양식의 내부ID가 있으면 수정, 없으면 신규입니다. 번호를 바꿔도 내부ID로 연결이 유지됩니다. 좌표가 없으면 도면 좌상단에 임시 배치됩니다.'), inp, res), [{ label: '취소' }, { label: '적용', primary: true, action: async () => { if (!file) throw new Error('파일을 선택하세요.'); if (E.dirty.size) await ED.save(); const fd = new FormData(); fd.append('file', file); const r = await api(`/api/projects/${E.pid}/devices/import`, { body: fd }); toast(`적용 ${r.applied}건${r.errors.length ? ', 오류 ' + r.errors.length + '건 제외' : ''}`); return true; } }]);
  if (ok) await ED.reload(true);
}
async function accessoryAdjust() {
  const st = E.model.project.settings; const adj = clone(st.accessory_adjust || {}); const rules = clone(st.accessory_rules && st.accessory_rules.length ? st.accessory_rules : C.DEFAULT_RULES);
  const acc = C.accessories(E.model);
  const body = h('div', { style: { width: '820px' } });
  body.appendChild(h('h4', null, '자동 산출 수량과 보정'));
  const t = h('table', { class: 'grid' }, h('tr', null, ['역할', '품목', '자동', '보정(±)', '사유'].map(x => h('th', null, x))));
  acc.forEach(a => { adj[a.role] = adj[a.role] || {}; t.appendChild(h('tr', null, h('td', null, a.label), h('td', null, a.product ? a.product.name + ' ' + (a.product.spec || '') : h('span', { class: 'warn' }, '품목 미등록')), h('td', { class: 'num' }, a.auto), h('td', null, h('input', { type: 'number', value: adj[a.role].delta || '', style: { width: '70px' }, onchange: e => adj[a.role].delta = e.target.value === '' ? null : +e.target.value })), h('td', null, h('input', { value: adj[a.role].reason || '', onchange: e => adj[a.role].reason = e.target.value })))); });
  body.appendChild(t);
  body.appendChild(h('h4', null, '산출 규칙 (끝단 조건별 수량)'));
  body.appendChild(h('p', { class: 'small muted' }, '끝단 조건: device=장비, camera=카메라, panel=패치패널, fdf=광분배함, power=복합 전원부, outdoor=옥외 표시 끝단, any=모든 끝단. 수량 cores_used=사용 코어 수. 공장 제작·일체형 단자로 표시된 끝단은 커넥터를 산출하지 않습니다.'));
  body.appendChild(tableEditor('규칙', { rules }, 'rules', [['cable_kind', '케이블(*=전체)'], ['end', '끝단 조건'], ['role', '역할(품목 role)'], ['qty', '끝단당 수량'], ['label', '설명']]));
  if (await modal('커넥터·부속 산출', body, [{ label: '취소' }, { label: '저장', primary: true, value: true }])) { rules.forEach(r => { if (r.qty !== 'cores_used' && r.qty !== '' && !isNaN(+r.qty)) r.qty = +r.qty; }); await saveSettings({ accessory_adjust: adj, accessory_rules: rules }); renderTables(); }
}
async function manualItems() {
  const items = clone(E.model.project.settings.manual_items || []);
  const body = h('div', { style: { width: '760px' } }, tableEditor('수동 추가 항목 (자동 산출과 구분되어 표시)', { items }, 'items', [['cat', '공종'], ['name', '품명'], ['spec', '규격'], ['unit', '단위'], ['qty', '수량', 'number'], ['status', '구분'], ['reason', '사유']]));
  if (await modal('수동 항목', body, [{ label: '저장', primary: true, value: true }])) { await saveSettings({ manual_items: items }); renderTables(); }
}
export function showTrace(circs, ix) {
  const body = h('div', { style: { width: '640px' } });
  if (!circs.length) body.appendChild(h('p', null, '선택한 객체가 포함된 카메라 회선이 없습니다. 선택 케이블의 양단 장비를 강조했습니다.'));
  circs.forEach(c => {
    const cam = ix.dev.get(c.camera);
    body.appendChild(h('div', { style: { marginBottom: '8px' } }, h('b', null, `${cam.tag} – ${{ video: '영상 회선', data: '데이터 회선', power: '전원 회선' }[c.kind]}`), ' → ', c.sink ? `${ix.dev.get(c.sink).tag} ${c.sink_port || ''}` : h('span', { class: 'err' }, '종단 미연결'),
      h('div', { class: 'small' }, c.path.map(s => `${s.cable.tag}${s.part === 'power' && s.cable.kind === 'composite' ? '(전원부)' : ''} [${(ix.dev.get(s.from.dev) || {}).tag}:${s.from.port} → ${s.to ? (ix.dev.get(s.to.dev) || {}).tag + ':' + s.to.port : '미연결'}]`).join(' ⟶ '))));
  });
  modal('회선 추적', body, null, { noFocus: true });
  refreshToolbar();
}
export function contextMenu(e, id) {
  document.querySelectorAll('.ctx').forEach(x => x.remove());
  if (id && !E.sel.has(id)) { E.sel = new Set([id]); refreshProps(); ED.renderOverlay(); }
  const items = [['회선 추적', ED.traceSel], ['복사', ED.copySel], ['붙여넣기', ED.paste], ['삭제', ED.deleteSel], ['전체 보기', () => ED.fitView()]];
  const m = h('div', { class: 'ctx', style: { left: e.clientX + 'px', top: e.clientY + 'px' } }, items.map(([l, f]) => h('div', { onclick: () => { m.remove(); f(); } }, l)));
  document.body.appendChild(m); setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 10);
}
function coverageCheck(areaObj) {
  if (E.coverage) { E.coverage = null; ED.render(); refreshToolbar(); return; }
  const s = ED.sheet(); const area = areaObj && areaObj.points ? areaObj : E.model.annotations.find(a => a.sheet_id === s.id && a.type === 'area');
  if (!area) { toast('먼저 "검토영역" 도구로 검토할 영역을 그리세요.', true); return; }
  const r = C.coverage(E.model, s.id, area.points, 70);
  if (!r) { toast('축척이 설정되어야 커버리지를 계산할 수 있습니다.', true); return; }
  E.coverage = { sheet: s.id, data: r }; ED.render(); refreshToolbar();
  toast(`${area.text || '검토 영역'}: 사각지대 ${r.blind_pct}% · 단일 감시 ${r.single_pct}% · 중복 감시 ${r.overlap_pct}% (${r.basis})`);
}
// ----- 출력 -----
export async function printDialog(pre) {
  const o = Object.assign({ kind: 'sheets', view: 'layout', paper: 'A3', orient: 'landscape', mode: 'fit', scale: 200, color: true, lineScale: 1, fontScale: 1, legend: true, sheets: [E.sheetId], areaMode: pre && pre.area ? 'area' : 'all', area: pre && pre.area, tables: [] }, pre && pre.keep ? pre.keep : {});
  const body = h('div', { style: { width: '880px', display: 'flex', gap: '12px' } });
  const left = h('div', { style: { width: '330px' } }); const frame = h('iframe', { style: { flex: 1, height: '62vh', border: '1px solid #ccc' } });
  body.append(left, frame);
  const draw = () => {
    left.innerHTML = '';
    left.appendChild(formGrid([{ k: 'kind', label: '출력물', type: 'select', options: [['sheets', '도면'], ['schematic', 'CCTV 계통도'], ['tables', '장비표·물량표'], ['legend', '범례표']] },
      ...(o.kind === 'sheets' ? [{ k: 'view', label: '도면 종류', type: 'select', options: [['layout', 'CCTV 배치도'], ['network', 'UTP·광케이블 경로도'], ['coax', '동축케이블 경로도'], ['power', '전원케이블 경로도'], ['video_power', '영상·전원 통합 경로도'], ['raceway', '배관·트레이 경로도'], ['all', '종합(전체 레이어)']] }] : []),
      { k: 'paper', label: '용지', type: 'select', options: ['A4', 'A3', 'A2', 'A1'] }, { k: 'orient', label: '방향', type: 'select', options: [['landscape', '가로'], ['portrait', '세로']] },
      ...(o.kind === 'sheets' ? [{ k: 'mode', label: '축척 방식', type: 'select', options: [['fit', '용지 맞춤 (축척 표기 없음)'], ['scale', '지정 축척']] }, ...(o.mode === 'scale' ? [{ k: 'scale', label: '축척 1:', type: 'number' }] : []), { k: 'areaMode', label: '출력 영역', type: 'select', options: [['all', '도면 전체'], ['view', '현재 화면'], ['area', '지정 영역']] }] : []),
      { k: 'color', label: '컬러', type: 'select', options: [['true', '컬러'], ['false', '흑백']], get: x => String(x.color), set: (x, v) => x.color = v === 'true' }, { k: 'lineScale', label: '선 굵기 배율', type: 'number' }, { k: 'fontScale', label: '글자 크기 배율', type: 'number' }, ...(o.kind === 'sheets' ? [{ k: 'legend', label: '범례 포함', type: 'check' }, { k: 'asbuilt', label: '준공도로 출력', type: 'check', help: '철거 제외, 실제 설치 위치 반영, 준공 표기' }] : [])], o, () => draw()));
    if (o.kind === 'sheets') {
      left.appendChild(h('div', { class: 'small', style: { marginTop: '6px', fontWeight: 600 } }, '출력 도면 (일괄 PDF)'));
      left.appendChild(h('div', { style: { maxHeight: '110px', overflow: 'auto' } }, E.model.sheets.map(s => h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: o.sheets.includes(s.id), onchange: e => { o.sheets = o.sheets.filter(x => x !== s.id); if (e.target.checked) o.sheets.push(s.id); } }), s.name, C.upmOf(s) ? '' : h('span', { class: 'warn' }, ' (축척 미설정)')))));
      left.appendChild(h('div', { class: 'small', style: { marginTop: '6px', fontWeight: 600 } }, '레이어 출력'));
      o.layers = o.layers || Object.fromEntries(ED.layers().map(l => [l.key, l.print !== false]));
      left.appendChild(h('div', { style: { maxHeight: '110px', overflow: 'auto', columns: 2 } }, ED.layers().map(l => h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: o.layers[l.key], onchange: e => o.layers[l.key] = e.target.checked }), l.name))));
      if (o.areaMode === 'area') left.appendChild(h('div', { class: 'row small' }, o.area ? `영역 지정됨 (${o.area.w.toFixed(0)}×${o.area.h.toFixed(0)})` : '영역 미지정', h('button', { onclick: () => { closeFn && closeFn(null); ED.setTool('printarea'); toast('출력할 영역을 드래그하세요.'); } }, '도면에서 지정')));
      if (o.mode === 'scale') left.appendChild(h('div', { class: 'small muted' }, '지정 축척 출력물은 인쇄 시 "실제 크기(100%)"로 인쇄해야 축척이 성립합니다.'));
    }
    if (o.kind === 'tables') { left.appendChild(h('div', { class: 'small', style: { marginTop: '6px', fontWeight: 600 } }, '표 선택 (미선택 시 전체)')); left.appendChild(h('div', { style: { maxHeight: '180px', overflow: 'auto', columns: 2 } }, Object.entries(TAB_NAMES).map(([k, v]) => h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: o.tables.includes(k), onchange: e => { o.tables = o.tables.filter(x => x !== k); if (e.target.checked) o.tables.push(k); } }), v)))); }
    left.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'primary', onclick: preview }, '미리보기 생성')));
  };
  let blob = null, closeFn = null;
  const reqBody = () => { const b = { ...o }; if (o.areaMode === 'view') { const r = $('svg').getBoundingClientRect(); b.area = { x: -E.view.tx / E.view.z, y: -E.view.ty / E.view.z, w: r.width / E.view.z, h: r.height / E.view.z }; } else if (o.areaMode !== 'area') b.area = null; if (E.snapView) b.snapshot_id = E.snapView.id; b.title = o.kind === 'sheets' ? null : { schematic: 'CCTV 계통도', tables: '장비표·물량표', legend: '범례표' }[o.kind]; return b; };
  const preview = async () => { if (E.dirty.size) await ED.save(); frame.srcdoc = '<p style="font-family:sans-serif">PDF 생성 중…</p>'; try { const r = await api(`/api/projects/${E.pid}/pdf`, { raw: true, body: reqBody() }); blob = await r.blob(); frame.removeAttribute('srcdoc'); frame.src = URL.createObjectURL(blob); } catch (e) { frame.srcdoc = `<p style="color:#c00;font-family:sans-serif">${esc(e.message)}</p>`; } };
  draw();
  await modal('도면 출력', body, [{ label: 'PDF 저장', primary: true, action: async () => { if (!blob) await preview(); if (!blob) return false; const a = h('a', { href: URL.createObjectURL(blob), download: `${E.model.project.name}_${o.kind === 'sheets' ? '도면' : o.kind}.pdf` }); a.click(); return false; } }, { label: '인쇄', action: async () => { if (!blob) await preview(); frame.contentWindow && frame.contentWindow.print(); return false; } }], { onOpen: (m, close) => { closeFn = close; preview(); }, noFocus: true });
}
async function dxfExport() {
  const s = ED.sheet(); if (!s) return; const o = { bg: s.bg.kind === 'cad' };
  const dwg = await api('/api/settings/dwg');
  const r = await modal('CAD 내보내기 – ' + s.name, h('div', { style: { width: '460px' } }, h('p', { class: 'small' }, '신규 설계 객체의 좌표·레이어·심볼(BLOCK)·문자를 DXF(R12)로 내보냅니다.'), h('p', { class: 'small muted' }, s.bg.kind === 'cad' ? 'CAD 배경 도면은 원본 좌표계로 복원됩니다. 원본 배경 포함 시 해석 가능한 선·원·문자만 포함되며 블록·해치 등 원본 구조는 보존되지 않으므로, 원본 도면에 이 파일을 외부참조로 겹쳐 쓰는 방식을 권장합니다.' : C.upmOf(s) ? '이미지/PDF 배경 도면은 m 단위 좌표로 내보내며 배경 이미지는 포함되지 않습니다.' : '축척 미설정 도면은 픽셀 단위로 내보냅니다.'), s.bg.kind === 'cad' ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: o.bg, onchange: e => o.bg = e.target.checked }), '원본 배경 포함') : null, !dwg.export_ready ? h('p', { class: 'small warn' }, 'DWG 내보내기: ODA File Converter 미연결로 비활성 (관리자 설정)') : null), [dwg.export_ready ? { label: 'DWG 다운로드', value: 'dwg' } : null, { label: 'DXF 다운로드', primary: true, value: 'dxf' }].filter(Boolean));
  if (r === 'dxf') download(`/api/sheets/${s.id}/export.dxf?bg=${o.bg ? 1 : 0}`).catch(e => toast(e.message, true));
  if (r === 'dwg') download(`/api/sheets/${s.id}/export.dwg?bg=${o.bg ? 1 : 0}`).catch(e => toast(e.message, true));
}
// ----- 프로젝트 설정 -----
async function projectSettings() {
  const p = clone(E.model.project); const st = p.settings; const ro = !ED.canEdit();
  const body = h('div', { style: { width: '760px' } });
  body.appendChild(h('h4', null, '프로젝트 정보'));
  body.appendChild(formGrid(PROJECT_FIELDS.map(f => ({ ...f, readonly: ro })), p));
  body.appendChild(h('h4', null, '산출 기준'));
  st.slack = st.slack || { mode: 'ratio', value: 10, target: 'all' };
  body.appendChild(formGrid([{ label: '기본 여장 방식', type: 'select', options: [['ratio', '비율(%)'], ['fixed', '고정(m)']], get: () => st.slack.mode, set: (o, v) => st.slack.mode = v }, { label: '기본 여장 값', type: 'number', get: () => st.slack.value, set: (o, v) => st.slack.value = v }, { label: '여장 적용 대상', type: 'select', options: [['all', '측정+수직+인입'], ['measured', '도면 측정 길이만']], get: () => st.slack.target, set: (o, v) => st.slack.target = v },
    { k: 'round_unit_m', label: '케이블 반올림 단위(m, 올림)', type: 'number' }, { k: 'fill_limit_pct', label: '관로 점유율 기준(%)', type: 'number', help: '적용 기준(예: 설계기준·발주처 기준)을 확인하여 입력' }, { k: 'fill_basis', label: '점유율 기준 근거' }, { k: 'vd_limit_pct', label: '전압강하 기준(%)', type: 'number' }, { k: 'coupling_interval_m', label: '커플링 산출 간격(m)', type: 'number' }, { k: 'ppm_threshold', label: '픽셀 밀도 기준(px/m)', type: 'number' }].map(f => ({ ...f, readonly: ro })), st));
  body.appendChild(h('h4', null, '동축 감쇠 계산용 신호별 기준 주파수 (사용자 입력, 미입력 시 감쇠 계산 안 함)'));
  st.signal_ref_freq = st.signal_ref_freq || {};
  body.appendChild(formGrid(CAT.SIGNALS.filter(s => s !== '사용자 정의').map(s => ({ label: s + ' (MHz)', type: 'number', get: () => st.signal_ref_freq[s], set: (o, v) => st.signal_ref_freq[s] = v, readonly: ro })), st));
  body.appendChild(h('h4', null, '도곽 서명란·사용자 도곽'));
  body.appendChild(formGrid([{ k: 'sign_design', label: '설계' }, { k: 'sign_review', label: '검토' }, { k: 'sign_approve', label: '승인' }].map(f => ({ ...f, readonly: ro })), st));
  body.appendChild(h('div', { class: 'row small', style: { marginTop: '4px' } }, '사용자 도곽 이미지(하단 30mm 영역에 배치): ', h('input', { type: 'file', accept: 'image/*', disabled: ro || null, onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('target_type', 'project'); fd.append('target_id', E.pid); fd.append('kind', '현장사진'); const r = await api(`/api/projects/${E.pid}/attachments`, { body: fd }); st.titleblock_file_id = r.file_id; toast('도곽 이미지 등록 – 저장을 누르세요.'); } }), st.titleblock_file_id ? h('button', { onclick: () => { st.titleblock_file_id = null; toast('기본 도곽 사용 – 저장을 누르세요.'); } }, '기본 도곽으로') : null));
  body.appendChild(h('h4', null, '사용자 도곽 문자 위치 (도곽 이미지 기준 mm, 하단 30mm 영역 왼쪽 위가 0,0)'));
  st.titleblock_fields = st.titleblock_fields || {};
  const TBF = ['회사', '공사명', '도면명', '도면번호', '축척', '작성일', '개정', '설계', '검토', '승인'];
  const tf = h('table', { class: 'grid' }, h('tr', null, ['항목', 'X(mm)', 'Y(mm)', '글자(mm)', '표시'].map(x => h('th', null, x))));
  TBF.forEach(k => { const v = st.titleblock_fields[k] = st.titleblock_fields[k] || {}; tf.appendChild(h('tr', null, h('td', null, k), ...['x', 'y', 'size'].map(f => h('td', null, h('input', { type: 'number', step: 'any', value: v[f] ?? '', style: { width: '70px' }, disabled: ro || null, onchange: e => v[f] = e.target.value === '' ? null : +e.target.value }))), h('td', null, h('input', { type: 'checkbox', checked: v.x != null, disabled: true })))); });
  body.appendChild(h('div', { class: 'small muted' }, st.titleblock_file_id ? '도곽 이미지가 등록되어 있습니다. 위치 지정 후 저장 → 출력 미리보기로 확인하세요. X를 비우면 해당 항목은 표시하지 않습니다.' : '사용자 도곽 이미지를 등록한 경우에만 적용됩니다(미등록 시 기본 도곽).'));
  body.appendChild(tf);
  body.appendChild(h('div', null, h('button', { disabled: ro || null, onclick: () => { let x = 2; TBF.forEach((k, i) => { st.titleblock_fields[k] = { x: 3 + i * 40, y: 12, size: 3 }; }); toast('기본 위치를 채웠습니다. 저장 후 미리보기로 조정하세요.'); } }, '기본 위치 채우기')));
  body.appendChild(h('h4', null, '단가 (선택 기능 – 사용자가 확보한 단가만 입력)'));
  const q = C.quantities(E.model); st.prices = st.prices || {};
  const keys = [...new Set(q.map(r => r.name + '|' + r.spec))];
  const pt = h('table', { class: 'grid' }, h('tr', null, ['품명', '규격', '재료비', '노무비', '경비'].map(x => h('th', null, x))));
  keys.forEach(k => { const [n, s] = k.split('|'); const v = st.prices[k] = st.prices[k] || {}; pt.appendChild(h('tr', null, h('td', null, n), h('td', null, s), ...['mat', 'lab', 'exp'].map(f => h('td', null, h('input', { type: 'number', value: v[f] ?? '', style: { width: '80px' }, disabled: ro || null, onchange: e => v[f] = e.target.value === '' ? null : +e.target.value }))))); });
  body.appendChild(h('div', { style: { maxHeight: '180px', overflow: 'auto' } }, pt));
  body.appendChild(h('p', { class: 'small muted' }, '공식 품셈·시중 단가는 제공하지 않습니다. 입력한 단가는 Excel 내보내기의 "내역" 시트에만 반영됩니다.'));
  // 멤버
  body.appendChild(h('h4', null, '프로젝트 멤버·권한'));
  const [users, members] = await Promise.all([api('/api/users'), api(`/api/projects/${E.pid}/members`)]);
  const mm = new Map(members.map(m => [m.user_id, m.role]));
  const mt = h('table', { class: 'grid' }, h('tr', null, ['사용자', '전역 권한', '프로젝트 권한'].map(x => h('th', null, x))));
  users.filter(u => u.role !== 'admin').forEach(u => mt.appendChild(h('tr', null, h('td', null, u.name + ' (' + u.username + ')'), h('td', null, ROLE[u.role]), h('td', null, h('select', { disabled: ro || null, onchange: e => e.target.value ? mm.set(u.id, e.target.value) : mm.delete(u.id) }, [['', '접근 불가'], ['designer', '설계자'], ['reviewer', '검토자'], ['viewer', '조회자']].map(([v, l]) => h('option', { value: v, selected: (mm.get(u.id) || '') === v }, l)))))));
  body.appendChild(mt); body.appendChild(h('p', { class: 'small muted' }, '관리자는 모든 프로젝트에 접근합니다. 전역 권한이 프로젝트 권한보다 낮으면 낮은 쪽이 적용됩니다.'));
  const r = await modal('프로젝트 설정', body, ro ? null : [{ label: '취소' }, { label: '저장', primary: true, value: true }]);
  if (!r) return;
  const pb = {}; PROJECT_FIELDS.forEach(f => pb[f.k] = p[f.k]);
  try { const np = await api(`/api/projects/${E.pid}`, { method: 'PUT', body: { ...pb, settings: st, ver: E.model.project.ver } }); np.my_role = E.role; E.model.project = np; await api(`/api/projects/${E.pid}/members`, { method: 'PUT', body: { members: [...mm.entries()].map(([user_id, role]) => ({ user_id, role })) } }); toast('프로젝트 설정을 저장했습니다.'); buildChrome(); scheduleTables(); ED.render(); }
  catch (e) { toast(e.message, true); }
}
// ----- 개정·이력 -----
async function historyDialog() {
  const body = h('div', { style: { width: '860px' } });
  const s = ED.sheet();
  const revs = s ? await api(`/api/sheets/${s.id}/revisions`) : [];
  body.appendChild(h('h4', null, `개정 스냅샷 – ${s ? s.name : ''}`));
  const rt = h('table', { class: 'grid' }, h('tr', null, ['개정', '메모', '작성자', '일시', ''].map(x => h('th', null, x))));
  revs.forEach(r => rt.appendChild(h('tr', null, h('td', null, r.rev_no), h('td', null, r.note || ''), h('td', null, r.created_by), h('td', null, r.created_at), h('td', null, h('button', { onclick: () => compare(r) }, '현재와 비교'), ' ', h('button', { onclick: () => viewSnapshot(r) }, '도면 보기')))));
  if (!revs.length) rt.appendChild(h('tr', null, h('td', { colspan: 5, class: 'muted' }, '스냅샷 없음 (도면 패널의 "스냅샷 저장" 또는 개정본 업로드 시 생성)')));
  body.appendChild(rt);
  body.appendChild(h('h4', null, '변경 이력'));
  const log = await api(`/api/projects/${E.pid}/log?limit=400`);
  const AN = { create: '생성', update: '수정', delete: '삭제', field: '현장 확인', disconnect: '연결 해제', revision: '개정', transform: '좌표 변환', snapshot: '스냅샷', members: '멤버', restore: '복원' };
  const lt = h('table', { class: 'grid' }, h('tr', null, ['일시', '변경자', '대상', '작업', '변경 내용', '사유'].map(x => h('th', null, x))));
  log.forEach(l => { const tag = (l.after && (l.after.tag || l.after.name)) || (l.before && (l.before.tag || l.before.name)) || ''; const diff = l.before && l.after && typeof l.before === 'object' ? Object.keys({ ...l.before, ...l.after }).filter(k => !['ver', 'updated_at', 'updated_by'].includes(k) && JSON.stringify(l.before[k]) !== JSON.stringify(l.after[k])).slice(0, 6).join(', ') : ''; lt.appendChild(h('tr', { class: ED.find(l.entity_id) ? 'click' : '', onclick: () => ED.find(l.entity_id) && ED.zoomTo(l.entity_id) }, h('td', { class: 'small' }, l.ts), h('td', null, l.user_name || ''), h('td', null, `${{ devices: '장비', cables: '케이블', conduits: '관로', annotations: '주석', sheet: '도면', project: '프로젝트', attachment: '첨부' }[l.entity] || l.entity} ${tag}`), h('td', null, AN[l.action] || l.action), h('td', { class: 'small' }, diff), h('td', { class: 'small' }, l.reason || ''))); });
  body.appendChild(h('div', { style: { maxHeight: '45vh', overflow: 'auto' } }, lt));
  modal('개정·변경 이력', body, null, { noFocus: true });
}
async function compare(rev) {
  const r = await api(`/api/projects/${E.pid}/revisions/${rev.id}/compare`);
  const body = h('div', { style: { width: '780px' } }, h('h4', null, `객체 변경 (스냅샷 ${r.rev.rev_no} → 현재)`), h('table', { class: 'grid' }, h('tr', null, ['구분', '변경', '번호', '항목'].map(x => h('th', null, x))), r.objects.map(o => h('tr', { class: 'click', onclick: () => ED.find(o.id) && ED.zoomTo(o.id) }, h('td', null, o.type), h('td', { class: o.change === '삭제' ? 'err' : o.change === '추가' ? 'ok' : 'warn' }, o.change), h('td', null, o.tag), h('td', null, o.fields || '')))), !r.objects.length ? h('div', { class: 'muted' }, '변경 없음') : null,
    h('h4', null, '물량 변동'), h('table', { class: 'grid' }, h('tr', null, ['공종', '품명', '규격', '단위', '이전', '현재', '증감'].map(x => h('th', null, x))), r.quantities.map(q => h('tr', null, h('td', null, q.cat), h('td', null, q.name), h('td', null, q.spec), h('td', null, q.unit), h('td', { class: 'num' }, q.before), h('td', { class: 'num' }, q.after), h('td', { class: 'num ' + (q.delta > 0 ? 'ok' : 'err') }, (q.delta > 0 ? '+' : '') + q.delta)))));
  modal('설계 변경 전후 비교', body, null, { noFocus: true });
}

// ===== 사용자 정의 심볼 편집기 =====
async function symbolEditor(it) {
  const list = clone(E.model.project.settings.custom_symbols || []);
  const sym = it ? clone(list.find(x => x.id === it.id) || it) : { id: uuid(), label: '', prefix: '', prims: [{ t: 'rect', x: -0.45, y: -0.45, w: 0.9, h: 0.9, fill: 'w' }, { t: 'text', x: 0, y: 0, s: 'EQ', size: 0.3 }] };
  if (!sym.id) sym.id = uuid(); sym.prims = sym.prims || [];
  const NS = 'http://www.w3.org/2000/svg'; const prev = document.createElementNS(NS, 'svg'); prev.setAttribute('viewBox', '-0.8 -0.8 1.6 1.6'); prev.style.cssText = 'width:200px;height:200px;border:1px solid #ccc;background:#fff';
  const draw = () => { prev.innerHTML = '<line x1="-0.8" y1="0" x2="0.8" y2="0" stroke="#eee" stroke-width="0.01"/><line x1="0" y1="-0.8" x2="0" y2="0.8" stroke="#eee" stroke-width="0.01"/>'; window.CCTVSymbols.prims({ type: 'custom', props: {}, _symdef: sym }).prims.forEach(q => { const fill = q.fill === 'w' ? '#fff' : q.fill === 'k' ? '#333' : 'none'; let e; if (q.t === 'rect') { e = document.createElementNS(NS, 'rect'); Object.entries({ x: q.x, y: q.y, width: q.w, height: q.h }).forEach(([k, v]) => e.setAttribute(k, v)); } else if (q.t === 'circle') { e = document.createElementNS(NS, 'circle'); e.setAttribute('cx', q.x); e.setAttribute('cy', q.y); e.setAttribute('r', q.r); } else if (q.t === 'poly') { e = document.createElementNS(NS, q.close ? 'polygon' : 'polyline'); e.setAttribute('points', (q.p || []).map(v => v.join(',')).join(' ')); } else if (q.t === 'text') { e = document.createElementNS(NS, 'text'); e.setAttribute('x', q.x); e.setAttribute('y', q.y); e.setAttribute('font-size', q.size); e.setAttribute('text-anchor', 'middle'); e.setAttribute('dominant-baseline', 'middle'); e.textContent = q.s || ''; } if (!e) return; if (q.t !== 'text') { e.setAttribute('stroke', '#333'); e.setAttribute('stroke-width', 0.03); e.setAttribute('fill', fill); } prev.appendChild(e); }); };
  const rows = sym.prims; const tbl = tableEditor('도형 (좌표 범위 -0.5~0.5, 중심 0,0)', { rows }, 'rows', [['t', '종류', 'select', [['rect', '사각형'], ['circle', '원'], ['poly', '선/다각형'], ['text', '문자']]], ['x', 'x', 'number'], ['y', 'y', 'number'], ['w', '폭', 'number'], ['h', '높이', 'number'], ['r', '반지름', 'number'], ['p', '점들(x,y 공백 구분)'], ['close', '닫기(Y)'], ['fill', '채움(w/k)'], ['s', '문자'], ['size', '글자크기', 'number']]);
  tbl.addEventListener('change', () => { rows.forEach(r => { if (typeof r.close === 'string') r.close = /^y/i.test(r.close); }); draw(); });
  const body = h('div', { style: { width: '900px', display: 'flex', gap: '12px' } }, h('div', { style: { flex: 1 } }, formGrid([{ k: 'label', label: '심볼 이름' }, { k: 'prefix', label: '번호 접두어' }], sym), tbl), h('div', null, prev, h('div', { class: 'small muted' }, '미리보기 (실제 크기는 도면 심볼 크기 설정)')));
  draw();
  const r = await modal(it ? '사용자 정의 심볼 편집' : '사용자 정의 심볼 추가', body, [it ? { label: '삭제', danger: true, value: 'del' } : null, { label: '저장', primary: true, value: 'save' }].filter(Boolean));
  if (!r) return;
  if (r === 'del') { if (E.model.devices.some(d => d.props && d.props.symbol_id === sym.id)) { toast('이 심볼을 사용하는 장비가 있어 삭제할 수 없습니다.', true); return; } await saveSettings({ custom_symbols: list.filter(x => x.id !== sym.id) }); }
  else { if (!sym.label) { toast('심볼 이름을 입력하세요.', true); return; } rows.forEach(q => { if (typeof q.close === 'string') q.close = /^y/i.test(q.close); }); const i = list.findIndex(x => x.id === sym.id); if (i >= 0) list[i] = sym; else list.push(sym); await saveSettings({ custom_symbols: list }); }
  buildLibrary(); ED.render();
}

// ===== 광 코어 배정 / 접속 =====
function coreEditor(o, ro) {
  const work = { rows: clone((o.props || {}).core_assign || []) };
  const pr = E.model.products.find(p => p.id === o.product_id); const cores = pr && pr.props.cores;
  const box = h('div', null, tableEditor(`코어 배정 (코어 수 ${cores ?? '미입력'})`, work, 'rows', [['core', '코어', 'number'], ['use', '구분', 'select', ['사용', '예비', '불량']], ['target', '연결 대상(장비·회선)'], ['note', '비고']]));
  if (!ro) box.appendChild(h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { onclick: () => { if (cores) { const have = new Set(work.rows.map(r => +r.core)); for (let i = 1; i <= cores; i++) if (!have.has(i)) work.rows.push({ core: i, use: '예비' }); box.replaceWith(coreEditor({ ...o, props: { ...(o.props || {}), core_assign: work.rows } }, ro)); } } }, '코어 전체 행 만들기'), h('button', { class: 'primary', onclick: () => { work.rows.forEach(r => { if (!r.use) r.use = '사용'; }); ED.update('cables', o, x => { x.props = { ...(x.props || {}), core_assign: work.rows.filter(r => r.core != null && r.core !== '') }; }, '광 코어 배정'); toast('코어 배정 저장(사용 코어 수 자동 반영)'); } }, '코어 배정 적용')));
  return box;
}
function spliceEditor(o, ro) {
  const fibs = E.model.cables.filter(c => c.kind === 'fiber' && C.endsOf(c).some(e => e.dev === o.id)).map(c => [c.id, c.tag]);
  const work = { rows: clone((o.props || {}).splices || []) };
  const box = h('div', null, fibs.length ? null : h('div', { class: 'small muted' }, '이 장비에 연결된 광케이블이 없습니다.'), tableEditor('코어 접속 (입력 → 출력)', work, 'rows', [['in_cable', '입력 케이블', 'select', fibs], ['in_core', '코어', 'number'], ['out_cable', '출력 케이블', 'select', fibs], ['out_core', '코어', 'number'], ['type', '방식', 'select', ['융착', '커넥터', '패치']], ['note', '비고']]));
  if (!ro) box.appendChild(h('button', { class: 'primary', style: { marginTop: '4px' }, onclick: () => { ED.update('devices', o, x => { x.props = { ...(x.props || {}), splices: work.rows.filter(r => r.in_cable && r.out_cable) }; }, '광 접속 변경'); toast('광 접속 저장 – 검토 탭에서 코어 오류를 확인하세요.'); } }, '접속 적용'));
  return box;
}
// ===== 관로 경로로 케이블 다시 그리기 =====
function routeByConduits(o) {
  const ix = C.index(E.model); const pts0 = C.cablePoints(o, ix); if (pts0.length < 2) return;
  const start = pts0[0], end = pts0[pts0.length - 1];
  const left = E.model.conduits.filter(cd => (o.conduit_ids || []).includes(cd.id) && cd.sheet_id === o.sheet_id && (cd.points || []).length >= 2).map(cd => cd.points.map(p => p.slice()));
  if (!left.length) { toast('이 도면에 할당된 관로가 없습니다.', true); return; }
  const path = [start]; let cur = start;
  while (left.length) { let bi = 0, rev = false, bd = Infinity; left.forEach((pl, i) => { const d0 = Math.hypot(pl[0][0] - cur[0], pl[0][1] - cur[1]), d1 = Math.hypot(pl[pl.length - 1][0] - cur[0], pl[pl.length - 1][1] - cur[1]); if (d0 < bd) { bd = d0; bi = i; rev = false; } if (d1 < bd) { bd = d1; bi = i; rev = true; } }); const pl = left.splice(bi, 1)[0]; const seg = rev ? pl.reverse() : pl; seg.forEach(p => { const l = path[path.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) path.push(p); }); cur = seg[seg.length - 1]; }
  path.push(end);
  ED.update('cables', o, x => { x.points = path; }, '관로 경로로 다시 그리기');
  const L = C.cableLength(E.model.cables.find(c => c.id === o.id), C.index(E.model)); toast(`관로 경로를 따라 다시 그렸습니다. 설계 수량 ${L.final_m ?? '확인 필요'} m`);
}

// ===== 지도 연동 (Leaflet) =====
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(css); const js = document.createElement('script'); js.src = '/vendor/leaflet/leaflet.js'; js.onload = () => res(window.L); js.onerror = () => { leafletP = null; rej(new Error('지도 라이브러리를 불러오지 못했습니다.')); }; document.head.appendChild(js); });
  return leafletP;
}
function geoXf(gr) {
  if (!gr || !gr.points || gr.points.length < 2) return null;
  const P = gr.points.map(p => [+p.x, +p.y, +p.lng, +p.lat]); const n = P.length;
  const mx = P.reduce((s, p) => s + p[0], 0) / n, my = P.reduce((s, p) => s + p[1], 0) / n, mu = P.reduce((s, p) => s + p[2], 0) / n, mv = P.reduce((s, p) => s + p[3], 0) / n;
  let a = 0, b = 0, d = 0; P.forEach(([px, py, u, v]) => { const X = px - mx, Y = -(py - my), U = u - mu, V = v - mv; a += X * U + Y * V; b += X * V - Y * U; d += X * X + Y * Y; });
  if (!d) return null; a /= d; b /= d;
  return (x, y) => { const X = x - mx, Y = -(y - my); return [mv + b * X + a * Y, mu + a * X - b * Y]; };
}
async function mapDialog() {
  const cfg = await api('/api/settings/map');
  const sheets = E.model.sheets.filter(s => geoXf(s.georef));
  if (!cfg.enabled) { toast('관리자 설정에서 지도 타일이 비활성화되어 있습니다.', true); return; }
  if (!sheets.length) { toast('위경도 기준점이 연결된 도면이 없습니다. 도면 패널의 "지도 좌표 연결"에서 기준점을 2개 이상 지정하세요.', true); return; }
  const div = h('div', { style: { width: '900px', height: '62vh' } });
  let Lf; try { Lf = await loadLeaflet(); } catch (e) { toast(e.message, true); return; }
  modal('지도 보기 – ' + sheets.map(s => s.name).join(', '), h('div', null, div, h('div', { class: 'small muted' }, `${cfg.note || ''} · 위치는 입력 기준점으로 보간한 근사값입니다.`)), null, { noFocus: true, onOpen: (m, close) => {
    const map = Lf.map(div); Lf.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom || 19 }).addTo(map);
    const bounds = []; const ix = C.index(E.model);
    sheets.forEach(s => { const f = geoXf(s.georef);
      E.model.conduits.filter(c => c.sheet_id === s.id).forEach(cd => Lf.polyline(cd.points.map(p => f(p[0], p[1])), { color: '#777', weight: 6, opacity: 0.4 }).addTo(map).bindTooltip(cd.tag || ''));
      E.model.cables.filter(c => c.sheet_id === s.id).forEach(c => { const L = ED.layers().find(l => l.key === CAT.CABLE_KINDS[c.kind].layer) || {}; Lf.polyline(C.cablePoints(c, ix).map(p => f(p[0], p[1])), { color: L.color || '#333', weight: 2, dashArray: CAT.CABLE_KINDS[c.kind].dash || null }).addTo(map).bindTooltip(c.tag || ''); });
      E.model.devices.filter(d => d.sheet_id === s.id && d.type !== 'offpage').forEach(d => { const ll = f(d.x, d.y); bounds.push(ll); const L = ED.layers().find(l => l.key === (d.layer || CAT.DEVICE_TYPES[d.type].layer)) || {}; Lf.circleMarker(ll, { radius: d.type === 'camera' ? 6 : 5, color: L.color || '#333', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map).bindTooltip(`${d.tag} ${TN(d.type)}<br>${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}`).on('click', () => { close(null); ED.zoomTo(d.id); }); });
    });
    setTimeout(() => { map.invalidateSize(); if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 19 }); }, 60);
  } });
}
async function georefDialog() {
  const s = ED.sheet(); const pts = clone((s.georef && s.georef.points) || []); let sel = 0;
  const cfg = await api('/api/settings/map');
  const [W, H] = ED.sheetDims(s);
  const NS = 'http://www.w3.org/2000/svg'; const mini = document.createElementNS(NS, 'svg'); mini.setAttribute('viewBox', `0 0 ${W} ${H}`); mini.style.cssText = 'width:420px;height:320px;border:1px solid #ccc;background:#fff;cursor:crosshair';
  const bgSrc = document.querySelector('#svg #L_bg'); if (bgSrc) mini.innerHTML = bgSrc.innerHTML;
  const marks = document.createElementNS(NS, 'g'); mini.appendChild(marks);
  const mapDiv = h('div', { style: { width: '420px', height: '320px', border: '1px solid #ccc' } });
  const tbl = h('div');
  let map = null, mapMarks = null;
  const draw = () => {
    marks.innerHTML = ''; const r = Math.max(W, H) / 120;
    pts.forEach((p, i) => { if (p.x == null) return; const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', r); c.setAttribute('fill', i === sel ? '#ff6a00' : '#1f5fa8'); marks.appendChild(c); const t = document.createElementNS(NS, 'text'); t.setAttribute('x', +p.x + r * 1.3); t.setAttribute('y', p.y); t.setAttribute('font-size', r * 2.5); t.textContent = String(i + 1); marks.appendChild(t); });
    if (map && mapMarks) { mapMarks.clearLayers(); pts.forEach((p, i) => { if (p.lat != null && p.lng != null && p.lat !== '' && p.lng !== '') window.L.circleMarker([+p.lat, +p.lng], { radius: 7, color: i === sel ? '#ff6a00' : '#1f5fa8' }).bindTooltip(String(i + 1), { permanent: true }).addTo(mapMarks); }); }
    tbl.innerHTML = ''; tbl.appendChild(h('table', { class: 'grid' }, h('tr', null, ['선택', '번호', '도면 X', '도면 Y', '위도', '경도', ''].map(x => h('th', null, x))), pts.map((p, i) => h('tr', null, h('td', null, h('input', { type: 'radio', name: 'gsel', checked: i === sel, onchange: () => { sel = i; draw(); } })), h('td', null, i + 1), ...['x', 'y', 'lat', 'lng'].map(k => h('td', null, h('input', { type: 'number', step: 'any', value: p[k] ?? '', style: { width: '110px' }, onchange: e => { p[k] = e.target.value === '' ? null : +e.target.value; draw(); } }))), h('td', null, h('button', { onclick: () => { pts.splice(i, 1); sel = Math.max(0, sel - 1); draw(); } }, '삭제'))))));
    tbl.appendChild(h('button', { onclick: () => { pts.push({}); sel = pts.length - 1; draw(); } }, '+ 기준점 추가'));
  };
  mini.addEventListener('click', e => { const pt = mini.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(mini.getScreenCTM().inverse()); if (!pts[sel]) pts[sel] = {}; pts[sel].x = Math.round(q.x * 10) / 10; pts[sel].y = Math.round(q.y * 10) / 10; draw(); });
  if (!pts.length) pts.push({});
  const body = h('div', { style: { width: '880px' } }, h('p', { class: 'small' }, '기준점을 선택한 뒤 왼쪽 도면과 오른쪽 지도에서 같은 위치를 각각 클릭하세요(2개 이상, 멀리 떨어진 점 권장). 측량값이 있으면 위도·경도를 직접 입력하세요. 기준점이 없으면 지도 좌표를 만들지 않습니다.'), h('div', { class: 'row', style: { alignItems: 'flex-start' } }, mini, cfg.enabled ? mapDiv : h('div', { class: 'muted small', style: { width: '420px' } }, '지도 타일 비활성화 – 위경도를 직접 입력하세요.')), tbl);
  draw();
  const r = await modal('지도 좌표 연결 – ' + s.name, body, [{ label: '연결 해제', value: 'clear' }, { label: '저장', primary: true, value: 'save' }], { noFocus: true, onOpen: async () => {
    if (!cfg.enabled) return; try { const Lf = await loadLeaflet(); map = Lf.map(mapDiv).setView([36.5, 127.8], 7); Lf.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom || 19 }).addTo(map); mapMarks = Lf.layerGroup().addTo(map);
      const ok = pts.filter(p => p.lat != null && p.lat !== ''); if (ok.length) map.fitBounds(ok.map(p => [+p.lat, +p.lng]), { maxZoom: 18, padding: [30, 30] });
      map.on('click', e => { if (!pts[sel]) pts[sel] = {}; pts[sel].lat = +e.latlng.lat.toFixed(7); pts[sel].lng = +e.latlng.lng.toFixed(7); draw(); }); draw(); setTimeout(() => map.invalidateSize(), 80); } catch (e) { toast(e.message, true); } } });
  if (r === 'clear') await saveSheet({ data: { georef: null } });
  if (r === 'save') { const valid = pts.filter(p => [p.x, p.y, p.lat, p.lng].every(v => v != null && v !== '')); if (valid.length < 2) { toast('도면 좌표와 위경도가 모두 있는 기준점이 2개 이상 필요합니다.', true); return; } await saveSheet({ data: { georef: { points: valid } } }, '지도 좌표 연결'); toast('지도 좌표를 연결했습니다.'); }
  refreshProps();
}
// ===== 스냅샷 도면 보기 (읽기 전용) =====
async function viewSnapshot(rev) {
  const r = await api(`/api/projects/${E.pid}/revisions/${rev.id}`); const snap = r.snapshot;
  if (E.dirty.size) await ED.save();
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  const sid = snap.sheet.id; const s = E.model.sheets.find(x => x.id === sid); if (!s) { toast('도면이 삭제되어 볼 수 없습니다.', true); return; }
  E.snapView = { id: rev.id, rev: r.rev_no, sheet: sid };
  ['devices', 'cables', 'conduits', 'annotations'].forEach(k => { E.model[k] = E.model[k].filter(o => o.sheet_id !== sid).concat(snap[k] || []); });
  Object.assign(s, { bg: snap.sheet.bg, rotation: snap.sheet.rotation, scale: snap.sheet.scale, opacity: snap.sheet.opacity });
  E.sel.clear(); ED.selectSheet(sid); refreshToolbar();
  ED.showBanner('snap', `개정 ${r.rev_no} 스냅샷 보기 (${r.created_at}, ${r.created_by || ''}) – 읽기 전용입니다. 출력(PDF)으로 당시 도면을 저장할 수 있습니다.`, [['스냅샷 닫기', async () => { E.snapView = null; ED.hideBanner('snap'); await ED.reload(true); await ED.renderBg(); refreshToolbar(); }]], true);
}
