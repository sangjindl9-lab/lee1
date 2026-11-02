// 설비 이력 카드 (목록 상세 · 도면 우측 패널 · 모바일 공통)
import { h, clear, state, GET, POST, PUT, DEL, api, toast, modal, confirmBox, formFields, fmt, nowLocal, today, resultTag, reviewTag, statusTag, catLabel, table, download } from './ui.js';
import { showOtdr } from './otdr.js';

export function liveTag(m) {
  if (!m) return null;
  const cls = { '정상': 'ok', '이상': 'bad', '응답 없음': 'bad', '확인 전': 'gray', '중지': 'gray' }[m.status] || 'gray';
  return h('span', { class: 'tag ' + cls, title: `실시간 감시 · 마지막 확인 ${m.last_checked_at || '-'} · ${m.last_message || ''}` }, `실시간: ${m.status}`);
}

async function importOtdr(card, reload) {
  const f = formFields([
    { key: 'file', label: 'OTDR 파일 (.sor)', type: 'file', accept: '.sor', required: true, wide: true },
    card.cores.length ? { key: 'core_id', label: '코어', type: 'select', options: [['', '케이블 전체'], ...card.cores.map(c => [c.id, `#${c.core_no} ${c.color || ''}`])] } : null,
    { key: 'direction', label: '방향', placeholder: 'A→B' }, { key: 'section', label: '측정 구간 (비우면 파일 값)' }, { key: 'measurer', label: '측정자 (비우면 파일 값)' },
  ].filter(Boolean));
  let res = null;
  const ok = await modal('OTDR 파일 가져오기', h('div', null, f.el, h('p', { class: 'small muted' }, 'Telcordia SR-4731(v1·v2) 형식을 해석해 측정일시·파장·이벤트·광섬유 길이·총손실을 측정기록으로 저장하고, 원본 파일은 성적서로 함께 보관합니다.')), {
    buttons: [{ label: '가져오기', primary: true, action: async () => {
      const v = f.values(); if (!v.file?.length) throw new Error('파일을 선택하세요.');
      const fd = new FormData(); fd.append('file', v.file[0]);
      for (const k of ['core_id', 'direction', 'section', 'measurer']) if (v[k]) fd.append(k, v[k]);
      res = await api('POST', `/api/assets/${card.asset.id}/otdr`, fd);
    } }],
  });
  if (ok && res) { toast(`OTDR 기록 저장 · 이벤트 ${res.summary.events}개 · 길이 ${res.summary.fiber_length_km?.toFixed(3) ?? '-'} km · 판정: ${res.auto_result}`); reload(); }
}

async function monitorSetup(card, reload, cur) {
  const m = cur || {};
  const ip = card.details?.ip || '';
  const f = formFields([
    { key: 'method', label: '점검 방식', type: 'select', options: [['tcp', 'TCP 포트 연결'], ['http', 'HTTP 응답'], ['push', '외부 시스템 수신 (NVR·SCADA·NMS)']], value: m.method || 'tcp' },
    { key: 'host', label: '대상 주소 (IP·호스트)', value: m.host || ip },
    { key: 'port', label: '포트', type: 'number', value: m.port || (card.asset.category === 'cctv' ? 554 : 80) },
    { key: 'path', label: 'HTTP 경로', value: m.path || '/' },
    { key: 'interval_sec', label: '점검 주기(초)', type: 'number', value: m.interval_sec || 60 },
    { key: 'fail_threshold', label: '연속 실패 몇 회부터 응답 없음', type: 'number', value: m.fail_threshold || 2 },
    { key: 'push_stale_sec', label: '수신 방식: 보고가 없으면 응답 없음 처리(초)', type: 'number', value: m.push_stale_sec || 300 },
    { key: 'enabled', label: '감시 사용', type: 'checkbox', value: m.enabled !== 0 },
  ]);
  const ok = await modal(`실시간 상태 감시 설정 · ${card.asset.mgmt_no}`, h('div', null, f.el,
    h('p', { class: 'small muted' }, '서버가 대상 주소에 직접 접속해 확인합니다. 클라우드 서버는 현장 내부망(사설 IP)에 접근할 수 없으므로, 내부망 장비는 현장 서버에 설치해 쓰거나 "외부 시스템 수신" 방식으로 상태를 받아야 합니다.')), {
    buttons: [{ label: '저장', primary: true, action: () => { const v = f.values(); return PUT(`/api/assets/${card.asset.id}/monitor`, { ...v, port: v.port ? Number(v.port) : null }); } }],
  });
  if (ok) { toast('감시 설정을 저장했습니다.'); reload(); }
}

const CONN = () => state.meta.CONN_KINDS;

// ---------- 설비 등록·수정 폼 ----------
export function assetFieldDefs(category, isNew) {
  const M = state.meta;
  const cat = M.CATEGORIES[category];
  const defs = [
    { group: '공통 정보' },
    { key: 'mgmt_no', label: '관리번호', required: true, placeholder: `예) ${cat.prefix}-001` },
    { key: 'name', label: '명칭' },
    { key: 'status', label: '상태', type: 'select', options: M.STATUSES },
    { key: 'building', label: '건물' }, { key: 'floor', label: '층' }, { key: 'room', label: '실' }, { key: 'zone', label: '구역' },
    { key: 'location_desc', label: '설치 위치 설명', wide: true },
  ];
  if (cat.group === 'equipment' || category === 'cctv') defs.push({ key: 'manufacturer', label: '제조사' }, { key: 'model', label: '모델' }, { key: 'serial_no', label: '시리얼번호' });
  defs.push({ key: 'install_date', label: '설치일', type: 'date' }, { key: 'contractor', label: '시공업체' }, { key: 'manager', label: '담당자' });
  if (['patch_panel', 'switch', 'nvr'].includes(category)) defs.push({ key: 'parent_id', label: '설치 랙', type: 'select', options: [['', '없음']] });
  if (isNew && cat.ports && !['device'].includes(cat.ports)) {
    const lbl = { circuit: '회로 수 (L-1, L-2 … 자동 생성)', channel: '채널 수', splitter: '출력 포트 수', terminal: category === 'load' ? '단자 수' : '포트 수', passthrough: '포트 수' }[cat.ports];
    defs.push({ key: 'port_count', label: lbl, type: 'number' });
  }
  defs.push({ key: 'notes', label: '비고', type: 'textarea', wide: true });
  const det = M.DETAIL_FIELDS[category] || [];
  if (det.length) {
    defs.push({ group: `${cat.label} 상세` });
    for (const [k, l, type, opts] of det) defs.push({ key: 'd.' + k, label: l, type: type === 'select' ? 'select' : type || 'text', options: opts });
  }
  return defs;
}

export async function openAssetForm(category, existing) {
  const defs = assetFieldDefs(category, !existing);
  const vals = existing ? { ...existing.asset, ...Object.fromEntries(Object.entries(existing.details || {}).map(([k, v]) => ['d.' + k, v])) } : { status: '설계' };
  const f = formFields(defs, vals);
  if (f.inputs.parent_id) {
    const racks = await GET(`/api/sites/${state.site.id}/assets?category=rack`);
    for (const r of racks) f.inputs.parent_id.appendChild(h('option', { value: r.id, selected: String(r.id) === String(vals.parent_id) }, `${r.mgmt_no} ${r.name || ''}`));
  }
  return modal(existing ? `${catLabel(category)} 수정 · ${existing.asset.mgmt_no}` : `${catLabel(category)} 등록`, f.el, {
    size: 'wide',
    buttons: [{
      label: '저장', primary: true, action: async () => {
        const v = f.values();
        const body = { details: {} };
        for (const [k, x] of Object.entries(v)) { if (k.startsWith('d.')) body.details[k.slice(2)] = x; else body[k] = x; }
        if (existing) { body.version = existing.asset.version; await PUT(`/api/assets/${existing.asset.id}`, body); return existing.asset.id; }
        body.category = category;
        const r = await POST(`/api/sites/${state.site.id}/assets`, body);
        return r.id;
      },
    }],
  });
}

// ---------- 연결 끝점 ----------
function endpointsOf(card) {
  const a = card.asset; const cat = state.meta.CATEGORIES[a.category];
  const out = [];
  if (cat.group === 'cable') {
    for (const e of ['A', 'B']) out.push({ ep: { type: 'cable', id: a.id, end: e }, label: `${a.mgmt_no} ${e}단${e === 'A' ? '(시작)' : '(종점)'}`, used: card.ends?.[e]?.text });
  }
  for (const c of card.cores) for (const e of ['A', 'B']) out.push({ ep: { type: 'core', id: c.id, end: e }, label: `#${c.core_no}코어(${c.color || ''}) ${e}단`, used: c[e.toLowerCase()]?.text, disabled: ['불량', '사용 중지'].includes(c.status) && c.status });
  for (const p of card.ports) {
    if (cat.ports === 'passthrough') {
      out.push({ ep: { type: 'port', id: p.id, end: 'rear' }, label: `${p.name} 뒤(고정 배선)`, used: p.rear?.text, disabled: ['불량', '사용 중지'].includes(p.status) && p.status });
      out.push({ ep: { type: 'port', id: p.id, end: 'front' }, label: `${p.name} 앞(패치)`, used: p.front?.text, disabled: ['불량', '사용 중지'].includes(p.status) && p.status });
    } else out.push({ ep: { type: 'port', id: p.id, end: '' }, label: p.name, used: p.peer?.text, disabled: ['불량', '사용 중지'].includes(p.status) && p.status });
  }
  out.push({ ep: { type: 'asset', id: a.id, end: '' }, label: `(설비 자체) ${a.mgmt_no}` });
  return out;
}

function endpointSelect(card, preferFree = true) {
  const sel = h('select', { style: { width: '100%' } });
  let firstFree = null;
  endpointsOf(card).forEach((o, i) => {
    const opt = h('option', { value: i, disabled: !!o.used || !!o.disabled }, `${o.label}${o.used ? ' — 사용 중: ' + o.used : ''}${o.disabled ? ' — ' + o.disabled : ''}`);
    opt._ep = o.ep; sel.appendChild(opt);
    if (firstFree === null && !o.used && !o.disabled) firstFree = i;
  });
  if (preferFree && firstFree !== null) sel.value = firstFree;
  return { el: sel, get: () => sel.selectedOptions[0]?._ep };
}

// 다른 설비 선택 + 끝점 선택
function remotePicker(defaultQuery = '') {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const q = h('input', { type: 'search', placeholder: '관리번호·명칭 검색', value: defaultQuery });
  const assetSel = h('select', { size: 6, style: { height: 'auto', width: '100%' } });
  const epWrap = h('div');
  let ep = null;
  async function search() {
    const rows = await GET(`/api/sites/${state.site.id}/assets?q=${encodeURIComponent(q.value)}`);
    clear(assetSel, ...rows.slice(0, 200).map(r => h('option', { value: r.id }, `${r.mgmt_no} · ${catLabel(r.category)} ${r.name || ''}`)));
  }
  assetSel.addEventListener('change', async () => {
    const c = await GET(`/api/assets/${assetSel.value}`);
    ep = endpointSelect(c);
    clear(epWrap, h('span', { class: 'small muted' }, '연결할 끝점'), ep.el);
  });
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  search();
  box.append(q, assetSel, epWrap);
  return { el: box, get: () => ep?.get() };
}

async function addConnection(card, reload) {
  const local = endpointSelect(card);
  const remote = remotePicker('');
  const cat = state.meta.CATEGORIES[card.asset.category];
  const kindSel = h('select', null, ...Object.entries(CONN()).map(([k, v]) => h('option', { value: k, selected: (cat.medium === 'power' || card.asset.category === 'panel' || card.asset.category === 'load') ? k === 'power' : card.asset.category === 'fiber_cable' ? k === 'splice' : k === 'fixed' }, v)));
  const extra = formFields([
    { key: 'closure_asset_id', label: '접속함 (광접속 시)', type: 'select', options: [['', '없음']] },
    { key: 'tray', label: '트레이' }, { key: 'sleeve', label: '슬리브' },
    { key: 'work_date', label: '작업일', type: 'date', value: today() }, { key: 'worker', label: '작업자', value: state.me.user.name },
    { key: 'note', label: '비고', wide: true },
  ]);
  const closures = await GET(`/api/sites/${state.site.id}/assets?category=closure`);
  for (const c of closures) extra.inputs.closure_asset_id.appendChild(h('option', { value: c.id }, c.mgmt_no + ' ' + (c.name || '')));
  const body = h('div', null,
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('b', null, `이 설비 (${card.asset.mgmt_no})`), local.el),
      h('div', { class: 'field' }, h('b', null, '상대 설비'), remote.el)),
    h('div', { class: 'field', style: { marginTop: '10px' } }, h('span', null, '연결 종류'), kindSel),
    h('div', { style: { marginTop: '8px' } }, extra.el),
    h('p', { class: 'small muted' }, '포트·코어·케이블 끝단은 하나의 연결만 가질 수 있습니다. 사용 중인 항목은 선택할 수 없으며 서버에서도 중복을 검사합니다.'));
  const ok = await modal('연결 추가', body, {
    size: 'wide', buttons: [{
      label: '연결 등록', primary: true, action: async () => {
        const a = local.get(); const b = remote.get();
        if (!a || !b) throw new Error('양쪽 끝점을 선택하세요.');
        await POST(`/api/sites/${state.site.id}/connections`, { kind: kindSel.value, a, b, ...extra.values() });
      },
    }],
  });
  if (ok) { toast('연결을 등록했습니다.'); reload(); }
}

async function endConn(connId, reload) {
  const f = formFields([{ key: 'reason', label: '해제 사유', required: true, wide: true }]);
  const ok = await modal('연결 해제', h('div', null, f.el, h('p', { class: 'small muted' }, '해제된 연결은 삭제되지 않고 이력으로 남습니다.')), { size: 'narrow', buttons: [{ label: '해제', danger: true, action: () => POST(`/api/connections/${connId}/end`, f.values()) }] });
  if (ok) { toast('연결을 해제했습니다.'); reload(); }
}

async function changeConn(conn, card, reload) {
  // 유지할 쪽: 이 설비 쪽 끝점
  const mineIsA = conn.a.asset_id === card.asset.id;
  const keep = mineIsA ? 1 : 2;
  const keptLabel = mineIsA ? conn.a.text : conn.b.text;
  const oldLabel = mineIsA ? conn.b.text : conn.a.text;
  const remote = remotePicker('');
  const f = formFields([{ key: 'reason', label: '변경 사유', required: true, wide: true }, { key: 'work_date', label: '작업일', type: 'date', value: today() }, { key: 'worker', label: '작업자', value: state.me.user.name }]);
  const ok = await modal(`${CONN()[conn.kind]} 변경`, h('div', null,
    h('p', null, `유지: ${keptLabel}`, h('br'), `기존 상대: ${oldLabel} → 새 상대를 선택하세요.`),
    remote.el, h('div', { style: { marginTop: '8px' } }, f.el),
    h('p', { class: 'small muted' }, '기존 연결은 종료 처리되고 변경 전·후가 작업 이력에 남습니다. 패치패널 뒤쪽 고정 배선은 바뀌지 않습니다.')), {
    size: 'wide', buttons: [{ label: '변경', primary: true, action: async () => { const b = remote.get(); if (!b) throw new Error('새 상대 끝점을 선택하세요.'); await POST(`/api/connections/${conn.id}/change`, { keep_seq: keep, new_endpoint: b, ...f.values() }); } }],
  });
  if (ok) { toast('연결을 변경했습니다.'); reload(); }
}

export function traceTree(node) {
  if (!node) return h('div', { class: 'muted' }, '미등록');
  const li = (n) => h('li', null,
    n.asset_id ? h('a', { href: `#/s/${state.site.id}/asset/${n.asset_id}` }, n.text) : n.text,
    n.conn ? h('span', { class: 'kind' }, ` [${CONN()[n.conn.kind] || n.conn.kind}${n.conn.closure ? ' · ' + n.conn.closure : ''}${n.conn.tray ? ' T' + n.conn.tray : ''}${n.conn.sleeve ? ' S' + n.conn.sleeve : ''}]`) : null,
    n.end ? h('span', { class: 'end tag ' + (n.end === '종단' ? 'info' : 'warn') }, n.end) : null,
    n.children?.length ? h('ul', { class: 'tree' }, n.children.map(li)) : null);
  return h('ul', { class: 'tree root' }, li(node));
}

export async function showTrace(type, id, title) {
  const r = await GET(`/api/trace?type=${type}&id=${id}`);
  const body = r.A ? h('div', { class: 'grid2' }, h('div', null, h('h3', null, 'A단 방향'), traceTree(r.A)), h('div', null, h('h3', null, 'B단 방향'), traceTree(r.B))) : traceTree(r.root);
  modal(title, h('div', null, body, h('p', { class: 'small muted' }, '등록된 연결 정보 기준 추적입니다. "미등록 (추적 불가)"는 연결이 등록되지 않은 끝입니다.')), { size: 'wide' });
}

export async function showImpact(assetId, mgmt) {
  const r = await GET(`/api/assets/${assetId}/impact`);
  const medium = m => m.map(x => x === 'power' ? '전원' : '통신').join('·');
  const link = x => h('a', { href: `#/s/${state.site.id}/asset/${x.asset_id}` }, x.text);
  const body = h('div', null,
    h('p', { class: 'small muted' }, '등록된 연결 정보 기준으로 영향받을 수 있는 설비입니다. 실시간 감시 연동이 없으므로 실제 작동 여부를 뜻하지 않습니다.'),
    h('h3', null, `직접 연결 (${r.affected.length})`),
    table([{ label: '설비', get: link }, { label: '종류', get: x => x.kind }, { label: '경로 구분', get: x => medium(x.mediums) }, { label: '연결 지점', get: x => x.via_text }, { label: '단계', get: x => x.distance, cls: 'num' }], r.affected),
    r.indirect?.length ? [h('h3', null, `간접 영향 — 스위치 경유 (${r.indirect.length})`), table([{ label: '설비', get: link }, { label: '종류', get: x => x.kind }, { label: '경유 스위치', get: x => x.via_hub }], r.indirect)] : null,
    h('h3', null, `연결 정보 누락 (${r.unresolved.length})`),
    r.unresolved.length ? h('ul', null, r.unresolved.map(u => h('li', null, u.text, ' ', h('span', { class: 'tag warn' }, '미등록')))) : h('div', { class: 'muted small' }, '없음'));
  modal(`영향 조회 · ${mgmt}`, body, { size: 'wide' });
}

// ---------- 측정 ----------
async function addMeasurement(card, reload) {
  const M = state.meta;
  const types = Object.entries(M.TEST_TYPES).filter(([, v]) => v.cats.includes(card.asset.category) || v.cats.includes('*'));
  const defaultType = types[0][0];
  const defs = [
    { key: 'test_type', label: '시험 종류', type: 'select', options: types.map(([k, v]) => [k, v.label]), value: defaultType, required: true },
    { key: 'measured_at', label: '측정일시', type: 'datetime-local', value: nowLocal(), required: true },
    { key: 'section', label: '측정 구간' },
    card.cores.length ? { key: 'core_id', label: '코어', type: 'select', options: [['', '케이블 전체'], ...card.cores.map(c => [c.id, `#${c.core_no} ${c.color || ''} (${c.status})`])] } : null,
    { key: 'test_voltage', label: '시험전압(V)', type: 'number' },
    { key: 'wavelength', label: '파장(nm)', type: 'number' },
    { key: 'direction', label: '방향', placeholder: '예) A→B' },
    { key: 'unit', label: '단위', placeholder: '예) MΩ, dB' },
    { key: 'instrument', label: '측정기기' }, { key: 'measurer', label: '측정자', value: state.me.user.name },
    { key: 'overall', label: '측정기 종합결과(성적서 기재값)' },
    { key: 'items', label: '시험 항목 (한 줄에 "항목=결과")', type: 'textarea', wide: true, placeholder: 'Wire Map=PASS\nLength=38m' },
    { key: 'raw_note', label: '비고', wide: true },
    { key: 'report', label: '시험성적서·측정 원본 파일', type: 'file', multiple: true, wide: true, help: '지원하지 않는 측정 원본(.sor 등)은 파일로만 보관하며 내용을 해석하지 않습니다.' },
  ].filter(Boolean);
  const f = formFields(defs);
  // 측정 조합별 값 (여러 행)
  const rowsBox = h('div');
  const rows = [];
  const addRow = (comb = '', val = '') => {
    const c = h('input', { type: 'text', value: comb, placeholder: '측정 조합 (예: L1-E)' });
    const v = h('input', { type: 'number', step: 'any', value: val, placeholder: '측정값' });
    const r = h('div', { class: 'btns', style: { marginBottom: '4px' } }, c, v, h('button', { class: 'sm', onclick: () => { r.remove(); rows.splice(rows.indexOf(o), 1); } }, '삭제'));
    const o = { c, v }; rows.push(o); rowsBox.appendChild(r);
  };
  const setDefaults = () => {
    const t = f.inputs.test_type.value;
    if (t === 'insulation') { f.inputs.unit.value ||= 'MΩ'; f.inputs.test_voltage.value ||= '500'; }
    if (t === 'optical_loss' || t === 'otdr') { f.inputs.unit.value ||= 'dB'; f.inputs.wavelength.value ||= '1310'; }
  };
  f.inputs.test_type.addEventListener('change', setDefaults); setDefaults();
  if (card.asset.category === 'power_cable') ['L1-E', 'L2-E', 'L3-E', 'N-E'].forEach(c => addRow(c)); else addRow('');
  const body = h('div', null, f.el, h('h3', null, '측정값'), rowsBox, h('button', { class: 'sm', onclick: () => addRow() }, '+ 측정 조합 추가'),
    h('p', { class: 'small muted' }, '측정기록은 누적 저장되며 과거 결과를 덮어쓰지 않습니다. 판정은 현장에 설정된 시험기준으로만 합니다.'));
  let saved = null;
  const ok = await modal('측정 등록', body, {
    size: 'wide', buttons: [{
      label: '저장', primary: true, action: async () => {
        const v = f.values();
        const items = v.items ? v.items.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, ...r] = l.split('='); return { name: n.trim(), result: r.join('=').trim() }; }) : null;
        const rr = rows.map(o => ({ combination: o.c.value.trim(), value: o.v.value })).filter(o => o.combination || o.value !== '');
        const base = { ...v, items, report: undefined, core_id: v.core_id || null };
        const res = await POST(`/api/assets/${card.asset.id}/measurements`, { ...base, rows: rr.length ? rr : [{}] });
        saved = res;
        if (v.report?.length) {
          for (const r of res.results) await uploadFiles('measurement', r.id, 'report', v.report);
        }
      },
    }],
  });
  if (ok && saved) {
    toast(`측정 ${saved.results.length}건 저장 · 자동 판정: ${[...new Set(saved.results.map(r => r.auto_result))].join(', ')}`);
    reload();
  }
}

async function uploadFiles(ownerType, ownerId, category, files, caption) {
  const fd = new FormData();
  fd.append('owner_type', ownerType); fd.append('owner_id', ownerId); fd.append('category', category);
  if (caption) fd.append('caption', caption);
  for (const f of files) fd.append('files', f);
  return api('POST', '/api/files', fd);
}
export { uploadFiles };

async function reviewMeasurement(m, reload) {
  const f = formFields([{ key: 'status', label: '검토 결과', type: 'select', options: ['승인', '반려', '재시험 필요'], required: true }, { key: 'note', label: '검토 의견', wide: true }]);
  const ok = await modal('측정 검토', h('div', null, h('p', null, `자동 판정: ${m.auto_result} — ${m.auto_reason || ''}`), f.el, h('p', { class: 'small muted' }, '자동 계산 결과와 검토자 승인은 별도로 기록됩니다.')), { size: 'narrow', buttons: [{ label: '저장', primary: true, action: () => POST(`/api/measurements/${m.id}/review`, f.values()) }] });
  if (ok) reload();
}

async function correctMeasurement(m, reload) {
  const f = formFields([
    { key: 'measured_at', label: '측정일시', type: 'datetime-local', value: (m.measured_at || '').replace(' ', 'T').slice(0, 16) },
    { key: 'combination', label: '측정 조합', value: m.combination }, { key: 'value', label: '측정값', type: 'number', value: m.value },
    { key: 'unit', label: '단위', value: m.unit }, { key: 'test_voltage', label: '시험전압(V)', type: 'number', value: m.test_voltage },
    { key: 'wavelength', label: '파장(nm)', type: 'number', value: m.wavelength },
    { key: 'correction_reason', label: '정정 사유', required: true, wide: true },
  ]);
  const ok = await modal('측정기록 정정', h('div', null, h('p', { class: 'small muted' }, '기존 기록은 보존되고 정정 기록이 새로 만들어집니다.'), f.el), { buttons: [{ label: '정정 저장', primary: true, action: () => POST(`/api/measurements/${m.id}/correct`, f.values()) }] });
  if (ok) { toast('정정 기록을 만들었습니다.'); reload(); }
}

// ---------- 작업 이력 ----------
export async function addWorklog(card, reload, preset = {}) {
  const M = state.meta;
  const f = formFields([
    { key: 'work_type', label: '작업 종류', type: 'select', options: M.WORK_TYPES, value: preset.work_type || '점검', required: true },
    { key: 'work_at', label: '작업일시', type: 'datetime-local', value: nowLocal(), required: true },
    { key: 'worker', label: '작업자', value: state.me.user.name }, { key: 'company', label: '업체' },
    { key: 'content', label: '작업 내용', type: 'textarea', wide: true, required: true },
    { key: 'before_value', label: '변경 전 값' }, { key: 'after_value', label: '변경 후 값' },
    { key: 'measurement_id', label: '관련 측정기록', type: 'select', options: [['', '없음'], ...card.measurements.filter(m => !m.superseded_by).map(m => [m.id, `${fmt(m.measured_at)} ${state.meta.TEST_TYPES[m.test_type]?.label} ${m.combination || ''} ${m.value ?? ''}${m.unit || ''}`])] },
    { key: 'photo_before', label: '작업 전 사진', type: 'file', multiple: true, accept: 'image/*' },
    { key: 'photo_after', label: '작업 후 사진', type: 'file', multiple: true, accept: 'image/*' },
    { key: 'submit', label: '바로 검토 요청', type: 'checkbox' },
  ]);
  const ok = await modal('작업 이력 등록', f.el, {
    size: 'wide', buttons: [{
      label: '저장', primary: true, action: async () => {
        const v = f.values();
        const r = await POST(`/api/assets/${card.asset.id}/worklogs`, { ...v, photo_before: undefined, photo_after: undefined });
        if (v.photo_before?.length) await uploadFiles('worklog', r.id, 'photo_before', v.photo_before);
        if (v.photo_after?.length) await uploadFiles('worklog', r.id, 'photo_after', v.photo_after);
      },
    }],
  });
  if (ok) { toast('작업 이력을 저장했습니다.'); reload(); }
}

async function editWorklog(w, reload) {
  const confirmed = w.status === '확정';
  const defs = [
    { key: 'work_type', label: '작업 종류', type: 'select', options: state.meta.WORK_TYPES, value: w.work_type },
    { key: 'work_at', label: '작업일시', type: 'datetime-local', value: (w.work_at || '').replace(' ', 'T').slice(0, 16) },
    { key: 'worker', label: '작업자', value: w.worker }, { key: 'company', label: '업체', value: w.company },
    { key: 'content', label: '작업 내용', type: 'textarea', wide: true, value: w.content },
    { key: 'before_value', label: '변경 전 값', value: w.before_value }, { key: 'after_value', label: '변경 후 값', value: w.after_value },
  ];
  if (confirmed) defs.push({ key: 'correction_reason', label: '정정 사유 (확정된 기록)', required: true, wide: true });
  const f = formFields(defs);
  const ok = await modal(confirmed ? '확정 기록 정정' : '작업 이력 수정', h('div', null, confirmed ? h('p', { class: 'small muted' }, '확정된 기록은 원본을 보존하고 정정 기록을 새로 만듭니다.') : null, f.el), {
    size: 'wide', buttons: [{ label: '저장', primary: true, action: () => PUT(`/api/worklogs/${w.id}`, { ...f.values(), version: w.version }) }],
  });
  if (ok) reload();
}

// ---------- 카드 본체 ----------
export async function renderCard(root, assetId, opts = {}) {
  let card;
  try { card = await GET(`/api/assets/${assetId}`); } catch (e) { clear(root, h('div', { class: 'err' }, e.message)); return; }
  const reload = () => renderCard(root, assetId, { ...opts, tab: current });
  const a = card.asset; const M = state.meta; const cat = M.CATEGORIES[a.category];
  const p = card.perm || {};
  let current = opts.tab || 'info';
  const body = h('div');
  const tabsDef = [['info', '기본정보'], ['conn', '연결'], ['meas', `측정 ${card.measurements.filter(m => !m.superseded_by).length}`], ['log', `이력 ${card.worklogs.filter(w => !w.superseded_by).length}`], ['files', `첨부 ${card.files.length}`], ['draw', `도면 ${card.marks.length}`]];
  const tabs = h('div', { class: 'tabs' }, tabsDef.map(([k, l]) => h('button', { class: k === current ? 'on' : '', onclick: (e) => { current = k; tabs.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.target.classList.add('on'); show(); } }, l)));
  const latest = card.measurements.find(m => !m.superseded_by);
  const head = h('div', { class: 'card-head' },
    h('div', { class: 'title' },
      h('div', { class: 'mgmt' }, a.mgmt_no, ' ', h('span', { class: 'muted small' }, card.category_label)),
      h('div', { class: 'small' }, a.name || '', ' '),
      h('div', { class: 'btns', style: { marginTop: '4px' } }, statusTag(a.status), a.retired ? h('span', { class: 'tag gray' }, a.replaced_by ? '교체됨' : '보관') : null,
        cat.group === 'cable' ? resultTag(latest?.auto_result) : null, liveTag(card.monitor), a.is_demo ? h('span', { class: 'tag warn' }, '시연용') : null)),
    h('div', { class: 'btns' },
      opts.compact ? h('a', { class: 'btn sm', href: `#/s/${a.site_id}/asset/${a.id}` }, '상세 화면') : null,
      h('button', { class: 'sm', onclick: () => download(`/api/pdf/card/${a.id}`) }, 'PDF 이력카드'),
      h('button', { class: 'sm', onclick: () => modal(`QR · ${a.mgmt_no}`, h('div', { style: { textAlign: 'center' } }, h('img', { src: `/api/assets/${a.id}/qr.png`, style: { width: '240px' } }), h('p', { class: 'small muted' }, 'QR에는 무작위 식별값만 들어 있으며, 스캔 후 로그인과 현장 권한 확인을 거칩니다.'), h('button', { onclick: () => download(`/api/sites/${a.site_id}/pdf/qr_labels?ids=${a.id}`) }, '라벨 PDF')), { size: 'narrow' }) }, 'QR'),
      h('button', { class: 'sm', onclick: () => showImpact(a.id, a.mgmt_no) }, '영향 조회')));
  if (card.replacedBy) head.appendChild(h('div', { class: 'demo-flag', style: { width: '100%', margin: 0 } }, '이 장비는 교체되었습니다. 현재 장비: ', h('a', { href: `#/s/${a.site_id}/asset/${card.replacedBy.id}` }, `${card.replacedBy.mgmt_no} (S/N ${card.replacedBy.serial_no || '-'})`)));
  if (card.replaces) head.appendChild(h('div', { class: 'small muted', style: { width: '100%' } }, '교체 전 장비: ', h('a', { href: `#/s/${a.site_id}/asset/${card.replaces.id}` }, `S/N ${card.replaces.serial_no || '-'} 기록 보기`)));
  clear(root, head, tabs, body);
  if (opts.onLoaded) opts.onLoaded(card);

  function show() {
    clear(body);
    if (current === 'info') body.append(...infoTab());
    if (current === 'conn') body.append(...connTab());
    if (current === 'meas') body.append(...measTab());
    if (current === 'log') body.append(...logTab());
    if (current === 'files') body.append(...filesTab());
    if (current === 'draw') body.append(...drawTab());
  }

  function kv(pairs) {
    return h('table', { class: 'kv' }, h('tbody', null, pairs.filter(Boolean).map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v === null || v === undefined || v === '' ? '-' : v)))));
  }

  function infoTab() {
    const d = card.details;
    const btns = h('div', { class: 'btns', style: { margin: '8px 0' } },
      p.can_edit && !a.retired ? h('button', { onclick: async () => { if (await openAssetForm(a.category, card)) { toast('저장했습니다.'); reload(); opts.onChanged?.(); } } }, '수정') : null,
      p.can_edit && !a.retired && cat.group === 'equipment' ? h('button', { onclick: () => replaceAsset() }, '장비 교체') : null,
      p.can_edit && ['admin', 'site_manager'].includes(state.me.user.role) && ['cctv', 'switch', 'nvr'].includes(a.category) ? h('button', { onclick: () => secrets() }, '접속정보(비공개)') : null,
      p.can_edit && ['admin', 'site_manager'].includes(state.me.user.role) && cat.group === 'equipment' ? h('button', { onclick: () => monitorSetup(card, reload, card.monitor) }, '실시간 감시 설정') : null,
      p.can_delete && !a.retired ? h('button', { class: 'danger', onclick: () => archive() }, '삭제(보관)') : null);
    return [
      kv([['관리번호', a.mgmt_no], ['설비 종류', card.category_label], ['명칭', a.name], ['상태', a.status],
        ['위치', [a.building, a.floor, a.room, a.zone].filter(Boolean).join(' / ')], ['설치 위치 설명', a.location_desc],
        card.parent ? ['상위 설비', h('a', { href: `#/s/${a.site_id}/asset/${card.parent.id}` }, card.parent.mgmt_no)] : null,
        ['제조사·모델', [a.manufacturer, a.model].filter(Boolean).join(' / ')], ['시리얼번호', a.serial_no],
        ['설치일', a.install_date], ['시공업체', a.contractor], ['담당자', a.manager],
        ['관련 도면', [...new Set(card.marks.map(m => `${m.drawing_no} Rev.${m.rev_no}`))].join(', ')],
        ['비고', a.notes], ['등록', `${fmt(a.created_at)} ${a.created_by_name || ''}`], ['최종 변경', `${fmt(a.updated_at)} ${a.updated_by_name || ''}`],
        ['실시간 상태', card.monitor ? h('span', null, liveTag(card.monitor), ` 마지막 확인 ${card.monitor.last_checked_at || '-'}`, card.monitor.last_latency_ms != null ? ` · ${card.monitor.last_latency_ms}ms` : '', card.monitor.last_message ? ` · ${card.monitor.last_message}` : '',
          card.monitor.method !== 'push' ? h('button', { class: 'sm', style: { marginLeft: '6px' }, onclick: async () => { try { const r = await POST(`/api/assets/${a.id}/monitor/check`, {}); toast(`점검 결과: ${r.status} · ${r.message}`); reload(); } catch (e) { toast(e.message, true); } } }, '지금 점검') : null)
          : h('span', { class: 'muted' }, '감시 미설정 — 위 "상태"는 등록된 값이며 실제 작동 여부가 아닙니다.')]]),
      (M.DETAIL_FIELDS[a.category] || []).length ? [h('h3', null, '상세 정보'), kv((M.DETAIL_FIELDS[a.category] || []).map(([k, l]) => [l, d[k]]))] : null,
      card.children.length ? [h('h3', null, '하위 설비'), table([{ label: '관리번호', get: c => h('a', { href: `#/s/${a.site_id}/asset/${c.id}` }, c.mgmt_no) }, { label: '종류', get: c => catLabel(c.category) }, { label: '명칭', get: c => c.name }, { label: '상태', get: c => c.status }], card.children)] : null,
      btns,
    ].flat().filter(Boolean);
  }

  async function replaceAsset() {
    const f = formFields([
      { key: 'serial_no', label: '새 장비 시리얼번호', required: true }, { key: 'manufacturer', label: '제조사', value: a.manufacturer }, { key: 'model', label: '모델', value: a.model },
      { key: 'install_date', label: '교체일', type: 'date', value: today() }, { key: 'contractor', label: '시공업체', value: a.contractor }, { key: 'worker', label: '작업자', value: state.me.user.name },
      { key: 'reason', label: '교체 사유', wide: true, required: true },
    ]);
    const r = await modal(`장비 교체 · ${a.mgmt_no}`, h('div', null, h('p', { class: 'small muted' }, `기존 장비(S/N ${a.serial_no || '-'})와 과거 기록은 보존되고, 같은 관리번호로 새 장비가 등록됩니다. 활성 연결과 도면 표시는 새 장비로 옮겨집니다.`), f.el), {
      buttons: [{ label: '교체', primary: true, action: () => POST(`/api/assets/${a.id}/replace`, f.values()) }],
    });
    if (r) { toast('교체했습니다.'); location.hash = `#/s/${a.site_id}/asset/${r.id}`; }
  }

  async function secrets() {
    const s = await GET(`/api/assets/${a.id}/secrets`);
    const f = formFields([{ key: 'login_id', label: '접속 계정', value: s.login_id }, { key: 'password', label: '비밀번호', type: 'password', value: s.password }, { key: 'memo', label: '메모', value: s.memo, wide: true }]);
    await modal('장비 접속정보 (비공개)', h('div', null, h('p', { class: 'small muted' }, '이 정보는 이력 카드, PDF, 엑셀, QR에 포함되지 않습니다. 조회 기록이 감사 로그에 남습니다.'), f.el), { size: 'narrow', buttons: [{ label: '저장', primary: true, action: () => PUT(`/api/assets/${a.id}/secrets`, f.values()) }] });
  }

  async function archive() {
    if (!await confirmBox(`${a.mgmt_no} 을(를) 삭제(보관) 처리할까요?\n연결이 있으면 삭제되지 않습니다. 과거 기록은 유지됩니다.`, '보관 처리')) return;
    try { await DEL(`/api/assets/${a.id}`); toast('보관 처리했습니다.'); reload(); opts.onChanged?.(); } catch (e) { toast(e.message, true); }
  }

  function connTab() {
    const out = [];
    const btn = h('div', { class: 'btns', style: { marginBottom: '8px' } },
      p.can_create && !a.retired ? h('button', { onclick: () => addConnection(card, reload) }, '연결 추가') : null,
      p.can_edit && cat.ports && !['device'].includes(cat.ports) ? h('button', { onclick: async () => { const r = await modal('포트·회로 추가', (fp = formFields([{ key: 'count', label: '추가할 수', type: 'number', required: true }, { key: 'prefix', label: '이름 접두어 (선택)', placeholder: cat.ports === 'circuit' ? 'L-' : 'P' }])).el, { size: 'narrow', buttons: [{ label: '추가', primary: true, action: () => POST(`/api/assets/${a.id}/ports`, fp.values()) }] }); if (r) reload(); } }, '포트·회로 추가') : null,
      p.can_edit && a.category === 'fiber_cable' ? h('button', { onclick: async () => { const r = await modal('코어 생성', (fp = formFields([{ key: 'count', label: '총 코어 수', type: 'number', required: true, value: card.details.core_count }])).el, { size: 'narrow', buttons: [{ label: '생성', primary: true, action: () => POST(`/api/assets/${a.id}/cores`, fp.values()) }] }); if (r) reload(); } }, '코어 생성') : null);
    let fp;
    out.push(btn);
    if (card.ends) {
      out.push(h('table', { class: 'kv' }, h('tbody', null,
        ['A', 'B'].map(e => h('tr', null, h('th', null, `${e}단 ${e === 'A' ? '(시작)' : '(종점)'}`), h('td', null, card.ends[e] ? card.ends[e].text : h('span', { class: 'tag warn' }, a.category === 'fiber_cable' ? '코어별 연결' : '미등록'), card.ends[e] ? h('span', { class: 'muted small' }, ` [${CONN()[card.ends[e].kind]}]`) : null))))));
    }
    if (card.paths?.cable) out.push(h('h3', null, '경로 추적'), traceTree(card.paths.cable));
    if (card.paths?.comm !== undefined) {
      out.push(h('h3', null, '통신 경로'), traceTree(card.paths.comm));
      out.push(h('h3', null, '전원 공급 경로', card.details.power_method === 'PoE' ? h('span', { class: 'muted small' }, ' — PoE: 통신 경로 끝 스위치 포트에서 급전') : null), card.details.power_method === 'PoE' ? h('div', { class: 'small' }, 'PoE 급전 (스위치 포트)') : traceTree(card.paths.power));
      out.push(h('p', { class: 'small muted' }, '등록된 연결 기준이며 실시간 작동 상태가 아닙니다.'));
    }
    if (card.cores.length) {
      out.push(h('h3', null, `코어 (${card.cores.length})`), h('div', { class: 'tablewrap', style: { maxHeight: '360px' } }, table([
        { label: '코어', get: c => '#' + c.core_no }, { label: '색상', get: c => c.color }, { label: '용도', get: c => c.purpose },
        { label: '상태', get: c => h('span', { class: 'tag ' + (c.status === '사용 중' ? 'info' : c.status === '불량' ? 'bad' : 'gray') }, c.status) },
        { label: 'A단', get: c => c.a?.text || '' }, { label: 'B단', get: c => c.b?.text || '' },
        { label: '', get: c => h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => showTrace('core', c.id, `${a.mgmt_no} #${c.core_no} 코어 추적`) }, '추적'), p.can_edit ? h('button', { class: 'sm', onclick: () => editCore(c) }, '수정') : null) },
      ], card.cores)));
    }
    if (card.ports.length) {
      const pass = cat.ports === 'passthrough';
      out.push(h('h3', null, `포트·회로 (${card.ports.length})`), h('div', { class: 'tablewrap', style: { maxHeight: '360px' } }, table([
        { label: '포트', get: x => x.name },
        { label: '상태', get: x => h('span', { class: 'tag ' + (x.status === '사용' ? 'info' : x.status === '불량' ? 'bad' : 'gray') }, x.status) },
        ...(pass ? [{ label: '뒤(고정 배선)', get: x => x.rear?.text || '' }, { label: '앞(패치코드)', get: x => x.front?.text || '' }] : [{ label: '연결', get: x => x.peer?.text || '' }]),
        { label: a.category === 'panel' ? '차단기' : '비고', get: x => x.data.breaker || x.data.note || '' },
        { label: '', get: x => h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => showTrace('port', x.id, `${a.mgmt_no} ${x.name} 추적`) }, '추적'), p.can_edit ? h('button', { class: 'sm', onclick: () => editPort(x) }, '수정') : null) },
      ], card.ports)));
    }
    const active = card.connections.filter(c => c.active), ended = card.connections.filter(c => !c.active);
    out.push(h('h3', null, `연결 관계 (${active.length})`), table([
      { label: '#', get: c => c.id }, { label: '종류', get: c => CONN()[c.kind] },
      { label: '끝점 1', get: c => c.a.text }, { label: '끝점 2', get: c => c.b.text },
      { label: '접속 위치', get: c => [c.closure, c.tray && 'T' + c.tray, c.sleeve && 'S' + c.sleeve, c.location].filter(Boolean).join(' / ') },
      { label: '작업', get: c => [c.work_date, c.worker].filter(Boolean).join(' ') },
      { label: '', get: c => p.can_edit ? h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => changeConn(c, card, reload) }, '변경'), h('button', { class: 'sm danger', onclick: () => endConn(c.id, reload) }, '해제')) : '' },
    ], active, { empty: '등록된 연결이 없습니다.' }));
    if (ended.length) out.push(h('h3', null, `해제·변경 이력 (${ended.length})`), table([
      { label: '#', get: c => c.id }, { label: '종류', get: c => CONN()[c.kind] }, { label: '연결', get: c => `${c.a.text} ↔ ${c.b.text}` },
      { label: '등록', get: c => fmt(c.created_at) }, { label: '해제', get: c => fmt(c.ended_at) }, { label: '사유', get: c => c.end_reason }, { label: '변경 후', get: c => c.replaced_by_connection_id ? '#' + c.replaced_by_connection_id : '' },
    ], ended, { rowClass: () => 'old' }));
    return out;
  }

  async function editPort(x) {
    const f = formFields([{ key: 'name', label: '포트명', value: x.name }, { key: 'status', label: '상태', type: 'select', options: M.PORT_STATUSES, value: x.status }, ...(a.category === 'panel' ? [{ key: 'breaker', label: '차단기 정격', value: x.data.breaker }] : []), { key: 'note', label: '비고', value: x.data.note }]);
    const r = await modal(`포트 수정 · ${x.name}`, f.el, { size: 'narrow', buttons: [{ label: '저장', primary: true, action: () => { const v = f.values(); return PUT(`/api/ports/${x.id}`, { name: v.name, status: v.status, data: { breaker: v.breaker, note: v.note } }); } }] });
    if (r) reload();
  }
  async function editCore(c) {
    const f = formFields([{ key: 'color', label: '색상', value: c.color }, { key: 'purpose', label: '용도', value: c.purpose }, { key: 'status', label: '상태', type: 'select', options: M.CORE_STATUSES, value: c.status }]);
    const r = await modal(`코어 #${c.core_no} 수정`, f.el, { size: 'narrow', buttons: [{ label: '저장', primary: true, action: () => PUT(`/api/cores/${c.id}`, f.values()) }] });
    if (r) reload();
  }

  function measTab() {
    const showOld = h('input', { type: 'checkbox' });
    const wrap = h('div');
    const render = () => clear(wrap, table([
      { label: '측정일시', get: m => h('span', null, fmt(m.measured_at), m.superseded_by ? h('div', { class: 'small' }, '(정정됨)') : null, m.corrects_id ? h('div', { class: 'small muted' }, '정정: ' + (m.correction_reason || '')) : null) },
      { label: '시험', get: m => M.TEST_TYPES[m.test_type]?.label },
      { label: '구간·조합', get: m => [m.section, m.combination, m.core_no ? '#' + m.core_no : ''].filter(Boolean).join(' / ') },
      { label: '조건', get: m => [m.test_voltage && m.test_voltage + 'V', m.wavelength && m.wavelength + 'nm', m.direction].filter(Boolean).join(' ') },
      { label: '측정값', get: m => m.value !== null ? `${m.value} ${m.unit || ''}` : (m.overall || '') + (m.items ? ' ' + m.items.map(i => `${i.name}:${i.result}`).join(', ') : '') },
      { label: '측정자', get: m => [m.measurer, m.instrument].filter(Boolean).join(' / ') },
      { label: '자동 판정', get: m => h('span', { title: m.auto_reason || '' }, resultTag(m.auto_result), h('div', { class: 'small muted' }, m.criteria_snapshot ? `${m.criteria_snapshot.name} v${m.criteria_snapshot.version}` : (m.auto_result === '판정기준 미설정' ? '' : (m.auto_reason || '').slice(0, 60)))) },
      { label: '검토', get: m => h('span', null, reviewTag(m.review_status), m.reviewer_name ? h('div', { class: 'small muted' }, m.reviewer_name) : null) },
      { label: '성적서', get: m => m.file_count ? `${m.file_count}건` : h('span', { class: 'tag warn' }, '없음') },
      { label: '', get: m => m.superseded_by ? (m.source_file_id ? h('button', { class: 'sm', onclick: () => showOtdr(m.source_file_id) }, 'OTDR 보기') : '') : h('div', { class: 'btns' },
        m.source_file_id ? h('button', { class: 'sm', onclick: () => showOtdr(m.source_file_id).catch(e => toast(e.message, true)) }, 'OTDR 보기') : null,
        p.can_review ? h('button', { class: 'sm', onclick: () => reviewMeasurement(m, reload) }, '검토') : null,
        p.can_edit ? h('button', { class: 'sm', onclick: () => correctMeasurement(m, reload) }, '정정') : null,
        p.can_create ? h('label', { class: 'btn sm' }, '성적서', h('input', { type: 'file', multiple: true, class: 'hidden', onchange: async (e) => { try { await uploadFiles('measurement', m.id, 'report', e.target.files); toast('성적서를 올렸습니다.'); reload(); } catch (er) { toast(er.message, true); } } })) : null) },
    ], card.measurements.filter(m => showOld.checked || !m.superseded_by), { rowClass: m => m.superseded_by ? 'old' : '', empty: '측정 기록이 없습니다.' }));
    showOld.addEventListener('change', render); render();
    return [h('div', { class: 'btns', style: { marginBottom: '8px' } }, p.can_create && !a.retired ? h('button', { class: 'primary', onclick: () => addMeasurement(card, reload) }, '측정 등록') : null,
      p.can_create && !a.retired && a.category === 'fiber_cable' ? h('button', { onclick: () => importOtdr(card, reload) }, 'OTDR 파일(.sor) 가져오기') : null, h('label', { class: 'small' }, showOld, ' 정정 전 기록 표시')), h('div', { style: { overflowX: 'auto' } }, wrap)];
  }

  function logTab() {
    return [h('div', { class: 'btns', style: { marginBottom: '8px' } }, p.can_create ? h('button', { class: 'primary', onclick: () => addWorklog(card, reload) }, '작업 이력 등록') : null),
      h('div', { style: { overflowX: 'auto' } }, table([
        { label: '작업일시', get: w => fmt(w.work_at) }, { label: '종류', get: w => w.work_type },
        { label: '내용', get: w => h('span', null, w.content || '', w.corrects_id ? h('div', { class: 'small muted' }, '정정 사유: ' + w.correction_reason) : null) },
        { label: '작업자·업체', get: w => [w.worker, w.company].filter(Boolean).join(' / ') },
        { label: '변경 전 → 후', get: w => (w.before_value || w.after_value) ? `${w.before_value || '-'} → ${w.after_value || '-'}` : '' },
        { label: '사진', get: w => { const n = card.files.filter(f => f.owner_type === 'worklog' && f.owner_id === w.id).length; return n ? n + '매' : ''; } },
        { label: '상태', get: w => w.superseded_by ? h('span', { class: 'tag gray' }, '정정됨') : h('span', null, reviewTag(w.status), w.reviewer_name ? h('div', { class: 'small muted' }, w.reviewer_name) : null) },
        { label: '', get: w => w.superseded_by ? '' : h('div', { class: 'btns' },
          p.can_edit ? h('button', { class: 'sm', onclick: () => editWorklog(w, reload) }, w.status === '확정' ? '정정' : '수정') : null,
          p.can_review && w.status !== '확정' ? h('button', { class: 'sm', onclick: async () => { await POST(`/api/worklogs/${w.id}/review`, { status: '확정' }); reload(); } }, '확정') : null,
          p.can_review && w.status === '검토 요청' ? h('button', { class: 'sm', onclick: async () => { await POST(`/api/worklogs/${w.id}/review`, { status: '반려' }); reload(); } }, '반려') : null) },
      ], card.worklogs, { rowClass: w => w.superseded_by ? 'old' : '', empty: '작업 이력이 없습니다.' }))];
  }

  function filesTab() {
    const imgs = card.files.filter(f => f.mime.startsWith('image/'));
    const docs = card.files.filter(f => !f.mime.startsWith('image/'));
    const up = formFields([{ key: 'category', label: '분류', type: 'select', options: Object.entries(M.FILE_CATEGORIES) }, { key: 'caption', label: '설명' }, { key: 'files', label: '파일', type: 'file', multiple: true }]);
    return [
      p.can_create ? h('div', { class: 'box' }, up.el, h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'primary', onclick: async () => { const v = up.values(); if (!v.files.length) return toast('파일을 선택하세요.', true); try { await uploadFiles('asset', a.id, v.category, v.files, v.caption); toast('올렸습니다.'); reload(); } catch (e) { toast(e.message, true); } } }, '올리기'))) : null,
      h('h3', null, `사진 (${imgs.length})`),
      imgs.length ? h('div', { class: 'thumbs' }, imgs.map(f => h('div', { class: 'thumb' }, h('a', { href: `/api/files/${f.id}?inline=1`, target: '_blank' }, h('img', { src: `/api/files/${f.id}?inline=1`, loading: 'lazy', alt: f.orig_name })), h('div', null, M.FILE_CATEGORIES[f.category], ' · ', fmt(f.created_at), f.caption ? h('div', null, f.caption) : null)))) : h('div', { class: 'muted small' }, '사진이 없습니다.'),
      h('h3', null, `문서 (${docs.length})`),
      table([{ label: '분류', get: f => M.FILE_CATEGORIES[f.category] || f.category }, { label: '파일명', get: f => h('span', null, h('a', { href: `/api/files/${f.id}`, target: '_blank' }, f.orig_name), /\.sor$/i.test(f.orig_name) ? h('button', { class: 'sm', style: { marginLeft: '6px' }, onclick: () => showOtdr(f.id).catch(e => toast(e.message, true)) }, '해석 보기') : null) }, { label: '연결', get: f => ({ asset: '설비', measurement: '측정', worklog: '작업 이력' }[f.owner_type]) }, { label: '크기', get: f => (f.size / 1024).toFixed(0) + ' KB', cls: 'num' }, { label: '등록', get: f => `${fmt(f.created_at)} ${f.created_by_name || ''}` },
        { label: '', get: f => p.can_delete ? h('button', { class: 'sm danger', onclick: async () => { if (await confirmBox('파일을 보관 처리할까요?')) { await DEL(`/api/files/${f.id}`); reload(); } } }, '삭제') : '' }], docs),
    ].filter(Boolean);
  }

  function drawTab() {
    return [
      table([{ label: '도면', get: m => `${m.drawing_no} ${m.title}` }, { label: '개정', get: m => h('span', null, 'Rev.' + m.rev_no, m.is_latest ? h('span', { class: 'tag info', style: { marginLeft: '4px' } }, '최신') : null) }, { label: '페이지', get: m => m.page }, { label: '표시', get: m => ({ point: '점', rect: '영역', polyline: '경로' }[m.shape]) },
        { label: '상태', get: m => m.needs_recheck ? h('span', { class: 'tag warn' }, '위치 재확인 필요') : '' },
        { label: '', get: m => opts.onLocate ? h('button', { class: 'sm', onclick: () => opts.onLocate(m) }, '도면에서 보기') : h('a', { class: 'btn sm', href: `#/s/${a.site_id}/viewer/${m.revision_id}?mark=${m.id}` }, '도면에서 보기') }], card.marks, { empty: '도면에 표시되지 않았습니다. 도면 화면에서 위치를 지정하세요.' }),
    ];
  }
  show();
  return card;
}
