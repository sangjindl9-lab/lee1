import { api, toast, h, modal, formGrid, download } from './ui.js';
const CAT = window.CCTVCatalog;
const CATS = [['cable', '케이블'], ['conduit', '배관·트레이'], ['accessory', '커넥터·부속'], ['device', '장비 제품']];
const ROLES = [['bnc', 'BNC 커넥터'], ['bnc_joint', '동축 중간 연결기'], ['video_adapter', '영상 변환 어댑터'], ['dc_plug', '전원 커넥터'], ['terminal', '전원 단자'], ['rj45_plug', 'RJ45 플러그'], ['rj45_plug_stp', '차폐 RJ45'], ['rj45_jack', 'RJ45 잭'], ['pigtail', '광 피그테일'], ['fiber_conn', '광커넥터'], ['patch_cord', '광 패치코드'], ['lug', '접지 단자'], ['waterproof', '방수 처리'], ['label', '식별표시'], ['custom', '사용자 정의']];

export function productFields(p) {
  const pr = p.props = p.props || {};
  const P = (k, label, type, extra) => ({ label, type, get: () => pr[k], set: (o, v) => { pr[k] = v; }, ...(extra || {}) });
  const base = [{ k: 'category', label: '분류', type: 'select', options: CATS }, { k: 'name', label: '품명' }, { k: 'spec', label: '규격명' }, { k: 'unit', label: '단위' }, { k: 'maker', label: '제조사' }, { k: 'model', label: '모델' }];
  if (p.category === 'cable') return base.concat([{ k: 'kind', label: '케이블 종류', type: 'select', options: Object.entries(CAT.CABLE_KINDS).map(([k, v]) => [k, v.name]) },
    { section: '공통 사양 (제조사 사양서 기준)' }, P('od_mm', '외경(mm)', 'number'), P('jacket', '외피·사용 환경'), P('shield', '차폐 구조'), P('conductor', '도체 재질·규격'), P('conductor_mm2', '도체 단면적(㎟)', 'number'), P('cores', '심선/코어 수', 'number'),
    P('max_length_m', '최대 길이 기준(m)', 'number'), P('max_length_basis', '길이 기준 근거'),
    ...(['coax', 'composite'].includes(p.kind) ? [{ section: '동축 사양' }, P('impedance', '특성 임피던스(Ω)', 'number'), P('poc_ok', '동축 전원전송 적용 확인', 'check'),
      { html: tableEditor('주파수별 감쇠 (사양서 값)', pr, 'attenuation', [['freq_mhz', '주파수(MHz)', 'number'], ['db_per_100m', 'dB/100m', 'number']]) },
      { html: tableEditor('신호별 제조사 권장거리 (근거 필수)', pr, 'recommended', [['signal', '신호', 'select', CAT.SIGNALS], ['res_mp', '해상도(MP, 선택)', 'number'], ['max_m', '권장거리(m)', 'number'], ['source', '근거 자료']]) },
      P('connectors', '양단 커넥터 종류')] : []),
    ...(p.kind === 'composite' ? [{ section: '복합케이블 구성' }, P('video_spec', '영상부 규격'), P('power_cores', '전원부 심선 수', 'number'), P('power_mm2', '전원부 도체(㎟)', 'number')] : []),
    ...(p.kind === 'fiber' ? [{ section: '광 사양' }, P('mode', '모드', 'select', { options: ['', 'SM', 'MM'] }), P('env', '실내·옥외')] : []),
    ...(['utp', 'stp'].includes(p.kind) ? [P('category', '등급'), P('pairs', '페어 수', 'number')] : []),
    P('note', '비고', 'textarea')]);
  if (p.category === 'conduit') return base.concat([{ k: 'kind', label: '종류', type: 'select', options: [['pipe', '관'], ['tray', '트레이']] }, P('inner_d_mm', '내경(mm)', 'number'), P('width_mm', '트레이 폭(mm)', 'number'), P('height_mm', '트레이 높이(mm)', 'number'), P('note', '비고', 'textarea')]);
  if (p.category === 'accessory') return base.concat([P('role', '산출 역할', 'select', { options: ROLES }), P('impedance', '임피던스(Ω)', 'number'), P('od_min_mm', '적용 외경 최소(mm)', 'number'), P('od_max_mm', '적용 외경 최대(mm)', 'number'), P('supported_signals', '지원 신호(쉼표)'), P('note', '비고', 'textarea')]);
  return base.concat([{ k: 'kind', label: '장비 유형', type: 'select', options: Object.entries(CAT.DEVICE_TYPES).map(([k, v]) => [k, v.name]) }, P('power_w', '소비전력(W)', 'number'), P('poe_w', 'PoE 요구전력(W)', 'number'), P('h_pixels', '가로 화소(px)', 'number'), P('hfov', '수평화각(°)', 'number'), P('vfov', '수직화각(°)', 'number'), P('signal', '영상 신호', 'select', { options: [''].concat(CAT.SIGNALS) }), P('channels', '채널 수', 'number'), P('ports', '포트 수', 'number'), P('poe_budget_w', 'PoE 예산(W)', 'number'), P('poe_port_max_w', '포트당 PoE(W)', 'number'), P('note', '비고(사양서 근거)', 'textarea')]);
}
export function tableEditor(title, obj, key, cols) {
  const wrap = h('div', { style: { margin: '4px 0' } });
  const draw = () => {
    wrap.innerHTML = ''; const rows = obj[key] = obj[key] || [];
    wrap.appendChild(h('div', { class: 'small', style: { fontWeight: 600 } }, title));
    const t = h('table', { class: 'grid' }, h('tr', null, cols.map(c => h('th', null, c[1])), h('th', null, '')));
    rows.forEach((r, i) => t.appendChild(h('tr', null, cols.map(c => h('td', null, c[2] === 'select' ? h('select', { onchange: e => { r[c[0]] = e.target.value; wrap.dispatchEvent(new Event('change', { bubbles: true })); } }, [''].concat(c[3]).map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(r[c[0]] ?? '') === String(v) }, l); })) : h('input', { value: r[c[0]] ?? '', type: c[2] || 'text', step: 'any', style: { width: '100%' }, onchange: e => { r[c[0]] = c[2] === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value; wrap.dispatchEvent(new Event('change', { bubbles: true })); } }))), h('td', null, h('button', { onclick: () => { rows.splice(i, 1); draw(); wrap.dispatchEvent(new Event('change', { bubbles: true })); } }, '삭제')))));
    wrap.appendChild(t); wrap.appendChild(h('button', { onclick: () => { rows.push({}); draw(); } }, '+ 행 추가'));
  };
  draw(); return wrap;
}
export async function editProduct(p0) {
  const p = JSON.parse(JSON.stringify(p0)); const box = h('div', { style: { width: '560px' } });
  const draw = () => { box.innerHTML = ''; box.appendChild(formGrid(productFields(p), p, f => { if (f.k === 'category' || f.k === 'kind') draw(); })); };
  draw();
  return modal(p.id ? '품목 수정' : '품목 등록', box, [{ label: '취소' }, { label: '저장', primary: true, action: () => api('/api/products', { body: p }) }]);
}
export async function productManager(me, onChange) {
  let list = await api('/api/products'); let cat = 'cable';
  const body = h('div', { style: { width: '900px' } });
  const draw = () => {
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } }, CATS.map(([k, v]) => h('button', { class: cat === k ? 'on' : '', onclick: () => { cat = k; draw(); } }, v)), h('span', { class: 'grow' }),
      h('button', { onclick: () => download('/api/products/template.xlsx') }, '엑셀 양식(현재 품목)'),
      h('label', null, h('button', { onclick: e => e.target.nextSibling.click() }, '엑셀 업로드'), h('input', { type: 'file', accept: '.xlsx', class: 'hidden', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); try { const r = await api('/api/products/import', { body: fd }); toast(`신규 ${r.created} · 수정 ${r.updated}${r.errors.length ? ' · 오류 ' + r.errors.length + '건: ' + r.errors.slice(0, 3).join(' / ') : ''}`, !!r.errors.length); list = await api('/api/products'); draw(); onChange && onChange(list); } catch (er) { toast(er.message, true); } } })),
      h('button', { class: 'primary', onclick: async () => { const r = await editProduct({ category: cat, unit: cat === 'cable' || cat === 'conduit' ? 'm' : 'EA', kind: cat === 'cable' ? 'coax' : cat === 'conduit' ? 'pipe' : '', props: {} }); if (r) { list = await api('/api/products'); draw(); onChange && onChange(list); } } }, '+ 품목 추가')));
    const t = h('table', { class: 'grid' }, h('tr', null, ['종류', '품명', '규격', '단위', '제조사·모델', '주요 사양', '범위', ''].map(x => h('th', null, x))));
    list.filter(p => p.category === cat).forEach(p => {
      const x = p.props || {};
      const sum = [x.impedance && x.impedance + 'Ω', x.od_mm && '외경 ' + x.od_mm, x.inner_d_mm && '내경 ' + x.inner_d_mm, x.cores && x.cores + 'C', x.conductor_mm2 && x.conductor_mm2 + '㎟', x.role, (x.recommended || []).length && '권장거리 ' + x.recommended.length + '건', (x.attenuation || []).length && '감쇠 ' + x.attenuation.length + '점'].filter(Boolean).join(', ');
      t.appendChild(h('tr', null, h('td', null, cat === 'cable' ? CAT.CABLE_KINDS[p.kind] ? CAT.CABLE_KINDS[p.kind].name : p.kind : p.kind || ''), h('td', null, p.name), h('td', null, p.spec || ''), h('td', null, p.unit || ''), h('td', null, [p.maker, p.model].filter(Boolean).join(' ')), h('td', { class: 'small' }, sum || h('span', { class: 'warn' }, '사양 미입력')), h('td', { class: 'small muted' }, p.company_id ? '회사' : '공용'),
        h('td', null, h('button', { onclick: async () => { const r = await editProduct(p); if (r) { list = await api('/api/products'); draw(); onChange && onChange(list); } } }, '수정'), me.user.role === 'admin' ? h('button', { class: 'danger', onclick: async () => { try { await api('/api/products/' + p.id, { method: 'DELETE' }); list = await api('/api/products'); draw(); } catch (e) { toast(e.message, true); } } }, '삭제') : null)));
    });
    body.appendChild(t);
    body.appendChild(h('p', { class: 'small muted' }, '※ 같은 규격명이라도 제품별 성능이 다를 수 있으므로 임피던스·외경·감쇠·권장거리는 해당 제품의 제조사 사양서 값과 근거를 입력하세요. 값이 없으면 설계 검토에서 "확인 필요"로 표시됩니다.'));
  };
  draw();
  await modal('품목 관리', body, null, { noFocus: true });
  return list;
}
