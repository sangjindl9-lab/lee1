import { h, clear, state, GET, POST, PUT, api, toast, modal, formFields, fmt, today, resultTag, reviewTag, statusTag, catLabel, perm, table, download, siteUrl } from './ui.js';
import { renderCard, openAssetForm, showTrace, traceTree, liveTag } from './card.js';

const sid = () => state.site.id;
const link = (a, text) => h('a', { href: siteUrl('asset/' + a.id) }, text || a.mgmt_no);

// ---------- 대시보드 ----------
export async function dashboard(body) {
  const d = await GET(`/api/sites/${sid()}/dashboard`);
  const M = state.meta;
  const count = {};
  for (const r of d.byCat) count[r.category] = (count[r.category] || 0) + r.n;
  const statusBy = {};
  for (const r of d.byCat) { statusBy[r.category] ||= {}; statusBy[r.category][r.status] = r.n; }
  const main = ['power_cable', 'fiber_cable', 'lan_cable', 'cctv'];
  clear(body,
    h('div', { class: 'pagehead' }, h('h1', null, d.site.name), h('span', { class: 'muted small' }, [d.site.code, d.site.client, d.site.period].filter(Boolean).join(' · '))),
    h('div', { class: 'stats' },
      ...main.map(c => h('a', { href: siteUrl({ power_cable: 'power', fiber_cable: 'fiber', lan_cable: 'lan', cctv: 'cctv' }[c]) }, h('div', { class: 'n' }, count[c] || 0), h('div', { class: 'l' }, M.CATEGORIES[c].label))),
      h('a', { href: siteUrl('assets') }, h('div', { class: 'n' }, Object.values(count).reduce((s, n) => s + n, 0)), h('div', { class: 'l' }, '전체 설비')),
      h('a', { href: siteUrl('drawings') }, h('div', { class: 'n' }, d.drawings), h('div', { class: 'l' }, '도면')),
      h('a', { href: siteUrl('measurements') }, h('div', { class: 'n' }, d.pendingReview), h('div', { class: 'l' }, '측정 검토 대기'))),
    h('h2', null, '점검 필요 항목'),
    h('div', { class: 'stats' }, Object.entries(M.ISSUE_TYPES).map(([k, l]) => h('a', { href: siteUrl('issues?type=' + k) }, h('div', { class: 'n' + (d.issueCounts[k] && ['failed', 'retest', 'warranty'].includes(k) ? ' bad' : '') }, d.issueCounts[k]), h('div', { class: 'l' }, l)))),
    h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('h2', null, '종류별 상태'), table([
        { label: '설비 종류', get: r => r.label }, ...M.STATUSES.map(s => ({ label: s, get: r => r.st[s] || '', cls: 'num' })),
      ], Object.keys(count).map(c => ({ label: M.CATEGORIES[c].label, st: statusBy[c] })))),
      h('div', { class: 'box' }, h('h2', null, '최근 작업 이력'), table([
        { label: '일시', get: w => fmt(w.work_at) }, { label: '설비', get: w => h('a', { href: siteUrl('asset/' + w.asset_id) }, w.mgmt_no) }, { label: '종류', get: w => w.work_type }, { label: '내용', get: w => (w.content || '').slice(0, 40) }, { label: '상태', get: w => reviewTag(w.status) },
      ], d.recent))));
}

// ---------- 도면 관리 ----------
export async function drawings(body) {
  const list = await GET(`/api/sites/${sid()}/drawings`);
  const reload = () => drawings(body);
  const addBtn = perm('can_create') ? h('button', { class: 'primary', onclick: async () => {
    const f = formFields([
      { key: 'drawing_no', label: '도면번호', required: true }, { key: 'title', label: '도면명', required: true }, { key: 'discipline', label: '공종', placeholder: '전력, 통신, CCTV' },
      { key: 'rev_no', label: '개정번호', required: true, value: 'A' }, { key: 'rev_date', label: '개정일', type: 'date', value: today() }, { key: 'reason', label: '발행·변경 사유', value: '최초 발행' },
      { key: 'display', label: '표시용 도면 (PDF·JPG·PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', wide: true },
      { key: 'source', label: 'DWG/DXF 원본', type: 'file', accept: '.dwg,.dxf', wide: true, help: '표시용 도면 없이 DWG/DXF만 올리면 PDF 표시본을 자동으로 만듭니다(흑백). 변환 결과가 부정확하면 CAD에서 출력한 PDF를 함께 올리세요.' },
    ]);
    const ok = await modal('도면 등록', f.el, { size: 'wide', buttons: [{ label: '등록', primary: true, action: async () => {
      const v = f.values(); const fd = new FormData();
      for (const k of ['drawing_no', 'title', 'discipline', 'rev_no', 'rev_date', 'reason']) fd.append(k, v[k]);
      if (v.display[0]) fd.append('display', v.display[0]); if (v.source[0]) fd.append('source', v.source[0]);
      return api('POST', `/api/sites/${sid()}/drawings`, fd);
    } }] });
    if (ok) { toast(ok.conversion_note ? '도면을 등록했습니다. ' + ok.conversion_note : '도면을 등록했습니다.'); location.hash = siteUrl('viewer/' + ok.revision_id); }
  } }, '도면 등록') : null;
  const rows = [];
  for (const d of list) d.revisions.forEach((r, i) => rows.push({ d, r, latest: i === 0 }));
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '도면 관리'), h('div', { class: 'sp' }), addBtn),
    h('div', { class: 'box flush' }, table([
      { label: '도면번호', get: x => x.latest ? h('b', null, x.d.drawing_no) : x.d.drawing_no }, { label: '도면명', get: x => x.d.title }, { label: '공종', get: x => x.d.discipline },
      { label: '개정', get: x => h('span', null, 'Rev.' + x.r.rev_no, x.latest ? h('span', { class: 'tag info', style: { marginLeft: '4px' } }, '최신') : null) },
      { label: '개정일', get: x => x.r.rev_date }, { label: '변경 사유', get: x => x.r.reason }, { label: '등록자', get: x => x.r.created_by_name },
      { label: '표시용', get: x => x.r.display_name ? h('a', { href: `/api/files/${x.r.display_file_id}?inline=1`, target: '_blank' }, x.r.display_type.toUpperCase()) : h('span', { class: 'tag warn' }, '없음') },
      { label: 'DWG 원본', get: x => x.r.source_name ? h('span', null, h('a', { href: `/api/files/${x.r.source_file_id}` }, x.r.source_name), x.r.conversion_note ? h('div', { class: 'small ' + (x.r.conversion_note.startsWith('자동 변환 실패') ? 'err' : 'muted') }, x.r.conversion_note) : null,
        !x.r.display_file_id && perm('can_edit') ? h('button', { class: 'sm', onclick: async (e) => { e.target.disabled = true; e.target.textContent = '변환 중…'; try { const r = await POST(`/api/revisions/${x.r.id}/convert`, {}); toast(r.note); reload(); } catch (er) { toast(er.message, true); reload(); } } }, '자동 변환') : null) : '' },
      { label: '표시 객체', get: x => h('span', null, x.r.mark_count, x.r.recheck_count ? h('span', { class: 'tag warn', style: { marginLeft: '4px' } }, `재확인 ${x.r.recheck_count}`) : null), cls: 'num' },
      { label: '검토', get: x => h('span', { class: 'tag ' + (x.r.review_status === '검토 완료' ? 'ok' : 'gray') }, x.r.review_status) },
      { label: '', get: x => h('div', { class: 'btns' },
        h('a', { class: 'btn sm', href: siteUrl('viewer/' + x.r.id) }, '열기'),
        x.latest && perm('can_create') ? h('button', { class: 'sm', onclick: () => newRevision(x.d, x.r, reload) }, '개정 등록') : null,
        perm('can_review') && x.r.review_status !== '검토 완료' ? h('button', { class: 'sm', onclick: async () => { await PUT(`/api/revisions/${x.r.id}`, { review_status: '검토 완료' }); reload(); } }, '검토 완료') : null) },
    ], rows, { empty: '등록된 도면이 없습니다.' })));
}

async function newRevision(d, latest, reload) {
  const f = formFields([
    { key: 'rev_no', label: '새 개정번호', required: true }, { key: 'rev_date', label: '개정일', type: 'date', value: today() },
    { key: 'reason', label: '변경 사유', required: true, wide: true },
    { key: 'display', label: '표시용 도면 (PDF·이미지)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', wide: true },
    { key: 'source', label: 'DWG/DXF 원본 (선택)', type: 'file', accept: '.dwg,.dxf', wide: true },
    { key: 'copy', label: `Rev.${latest.rev_no} 의 표시 객체 ${latest.mark_count}개를 복사 ('위치 재확인 필요' 상태로)`, type: 'checkbox', value: true },
  ]);
  const ok = await modal(`개정 등록 · ${d.drawing_no}`, h('div', null, f.el, h('p', { class: 'small muted' }, '기존 개정본과 표시 객체는 그대로 보존됩니다. 도면 배치가 달라졌을 수 있으므로 복사된 표시는 하나씩 위치를 확인해야 합니다.')), {
    size: 'wide', buttons: [{ label: '등록', primary: true, action: async () => {
      const v = f.values(); const fd = new FormData();
      for (const k of ['rev_no', 'rev_date', 'reason']) fd.append(k, v[k]);
      if (v.copy) fd.append('copy_from_revision_id', latest.id);
      if (v.display[0]) fd.append('display', v.display[0]); if (v.source[0]) fd.append('source', v.source[0]);
      return api('POST', `/api/drawings/${d.id}/revisions`, fd);
    } }],
  });
  if (ok) { toast(`개정본을 등록했습니다. 복사된 표시 ${ok.copied}개는 위치 재확인이 필요합니다.`); location.hash = siteUrl('viewer/' + ok.revision_id); }
}

// ---------- 설비 목록 (전체 / 종류별) ----------
const LIST_COLS = {
  power_cable: [['panel_name', '분전반'], ['circuit_no', '회로'], [d => [d.cable_type, d.size, d.cores].filter(Boolean).join(' '), '종류·규격'], ['breaker_rating', '차단기'], ['load_desc', '연결 부하'], [d => `${d.design_length ?? '-'} / ${d.actual_length ?? '-'}`, '설계/실제(m)']],
  fiber_cable: [['section_name', '구간'], ['spec', '규격'], ['core_count', '코어'], [d => `${d.from_desc || ''} → ${d.to_desc || ''}`, '시작 → 종점'], [d => `${d.design_length ?? '-'} / ${d.actual_length ?? '-'}`, '설계/실제(m)']],
  lan_cable: [['lan_category', '카테고리'], ['rack', '랙'], ['outlet_no', '정보콘센트'], ['poe', 'PoE'], [d => `${d.design_length ?? '-'} / ${d.actual_length ?? '-'}`, '설계/실제(m)']],
  cctv: [['ip', 'IP'], ['power_method', '전원'], ['direction', '촬영 방향'], ['warranty_end', '보증 종료']],
};

export async function assetList(body, { category, query } = {}) {
  const M = state.meta;
  const q = h('input', { type: 'search', placeholder: '관리번호·회로번호·규격·위치·시리얼·IP·포트 검색', value: query?.get('q') || '' });
  const catSel = h('select', null, h('option', { value: '' }, '종류 전체'), ...Object.entries(M.CATEGORIES).map(([k, v]) => h('option', { value: k, selected: k === (query?.get('cat') || '') }, v.label)));
  const stSel = h('select', null, h('option', { value: '' }, '상태 전체'), ...M.STATUSES.map(s => h('option', { value: s }, s)));
  const retired = h('input', { type: 'checkbox' });
  const wrap = h('div', { class: 'tablewrap' });
  const count = h('span', { class: 'muted small' });
  const title = category ? `${M.CATEGORIES[category].label} 관리` : '전체 설비 목록';
  const newCat = h('select', null, ...Object.entries(M.CATEGORIES).map(([k, v]) => h('option', { value: k }, v.label)));
  const addArea = perm('can_create') ? h('div', { class: 'btns' }, category ? null : newCat, h('button', { class: 'primary', onclick: async () => { const c = category || newCat.value; const id = await openAssetForm(c); if (id) { toast('등록했습니다.'); location.hash = siteUrl('asset/' + id); } } }, category ? `${M.CATEGORIES[category].label} 등록` : '설비 등록')) : null;
  const extraHead = [];
  if (category === 'cctv') extraHead.push(h('a', { class: 'btn', href: siteUrl('issues?type=warranty') }, '보증 만료 예정'), h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/cctv_ledger`) }, 'CCTV 장비대장 PDF'));
  if (category === 'power_cable') extraHead.push(h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/power_list`) }, '전력케이블 목록 PDF'));
  async function load() {
    const params = new URLSearchParams();
    if (q.value) params.set('q', q.value);
    if (category) params.set('category', category); else if (catSel.value) params.set('category', catSel.value);
    if (stSel.value) params.set('status', stSel.value);
    if (retired.checked) params.set('include_retired', '1');
    const rows = await GET(`/api/sites/${sid()}/assets?${params}`);
    const cols = [
      { label: '관리번호', get: a => link(a) },
      category ? null : { label: '종류', get: a => catLabel(a.category) },
      { label: '명칭', get: a => a.name },
      ...(LIST_COLS[category] || []).map(([k, l]) => ({ label: l, get: a => typeof k === 'function' ? k(a.details) : a.details[k] })),
      { label: '위치', get: a => [a.building, a.floor, a.room].filter(Boolean).join(' ') },
      category === 'cctv' || !category ? { label: '시리얼', get: a => a.serial_no } : null,
      { label: '상태', get: a => h('span', null, statusTag(a.status), a.retired ? h('span', { class: 'tag gray', style: { marginLeft: '3px' } }, '보관') : null, a.live_status ? h('div', { style: { marginTop: '2px' } }, liveTag({ status: a.live_status })) : null) },
      M.CATEGORIES[category]?.group === 'cable' || !category ? { label: '최근 측정', get: a => M.CATEGORIES[a.category].group === 'cable' ? resultTag(a.last_result) : '' } : null,
      { label: '도면', get: a => a.mark_count ? h('a', { href: siteUrl(`viewer?asset=${a.id}`), onclick: (e) => { e.preventDefault(); gotoDrawing(a.id); } }, `${a.mark_count}곳`) : h('span', { class: 'tag warn' }, '미연결') },
    ].filter(Boolean);
    clear(wrap, table(cols, rows, { onRow: a => { location.hash = siteUrl('asset/' + a.id); } }));
    count.textContent = `${rows.length}건`;
  }
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  [catSel, stSel, retired].forEach(x => x.addEventListener('change', load));
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, title), count, h('div', { class: 'sp' }), ...extraHead, addArea),
    h('div', { class: 'filters' }, q, category ? null : catSel, stSel, h('label', { class: 'small' }, retired, ' 보관·교체된 설비 포함')), wrap);
  await load();
}

// 목록 → 도면 위치로 이동
export async function gotoDrawing(assetId) {
  const card = await GET(`/api/assets/${assetId}`);
  const m = card.marks.find(x => x.is_latest) || card.marks[0];
  if (!m) return toast('도면에 표시되지 않은 설비입니다.', true);
  location.hash = siteUrl(`viewer/${m.revision_id}?mark=${m.id}`);
}

// ---------- 광케이블 ----------
export async function fiber(body, query) {
  const cables = await GET(`/api/sites/${sid()}/assets?category=fiber_cable`);
  const sel = h('div', { class: 'box' });
  let current = Number(query.get('id')) || cables[0]?.id;
  const listBox = h('div', { class: 'tablewrap', style: { maxHeight: '300px' } });
  const renderList = () => clear(listBox, table([
    { label: '관리번호', get: a => a.mgmt_no }, { label: '구간', get: a => a.details.section_name }, { label: '규격', get: a => a.details.spec }, { label: '코어', get: a => a.details.core_count, cls: 'num' },
    { label: '시작 → 종점', get: a => `${a.details.from_desc || ''} → ${a.details.to_desc || ''}` }, { label: '상태', get: a => statusTag(a.status) }, { label: '최근 측정', get: a => resultTag(a.last_result) },
  ], cables, { onRow: (a) => { current = a.id; renderList(); show(); }, rowClass: a => a.id === current ? 'sel' : '' }));
  async function show() { if (current) await renderCard(sel, current, { tab: 'conn' }); else clear(sel, h('div', { class: 'muted' }, '광케이블을 등록하세요.')); }
  // 코어 접속 등록 (케이블 간)
  const spliceBtn = perm('can_create') ? h('button', { onclick: () => spliceForm(cables) }, '코어 접속 등록') : null;
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '광케이블·코어·접속 관리'), h('div', { class: 'sp' }),
    spliceBtn, h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/fiber_splice`) }, '광코어 접속표 PDF'),
    perm('can_create') ? h('button', { class: 'primary', onclick: async () => { const id = await openAssetForm('fiber_cable'); if (id) location.hash = siteUrl('fiber?id=' + id); } }, '광케이블 등록') : null),
    h('p', { class: 'small muted' }, '케이블을 선택하면 코어별 상태·양단 연결·접속함 정보가 아래에 표시됩니다. 코어 행의 "추적"으로 접속함을 거쳐 최종 종단까지 확인합니다. 분기는 광분배기 장비와 포트로 등록합니다.'),
    listBox, sel);
  renderList(); await show();
}

async function spliceForm(cables) {
  const cardsCache = {};
  const getCores = async (id) => (cardsCache[id] ||= (await GET(`/api/assets/${id}`)).cores);
  const mk = (label) => {
    const cab = h('select', null, h('option', { value: '' }, '케이블 선택'), ...cables.map(c => h('option', { value: c.id }, `${c.mgmt_no} ${c.details.section_name || ''}`)));
    const core = h('select', null);
    const end = h('select', null, h('option', { value: 'B' }, 'B단(종점 측)'), h('option', { value: 'A' }, 'A단(시작 측)'));
    cab.addEventListener('change', async () => { const cs = await getCores(cab.value); clear(core, ...cs.map(c => h('option', { value: c.id, disabled: ['불량', '사용 중지'].includes(c.status) }, `#${c.core_no} ${c.color || ''} · ${c.status}${c.a ? ' · A:' + c.a.text : ''}${c.b ? ' · B:' + c.b.text : ''}`))); });
    return { el: h('div', { class: 'field' }, h('b', null, label), cab, core, end), get: () => ({ type: 'core', id: Number(core.value), end: end.value }) };
  };
  const a = mk('코어 1'), b = mk('코어 2');
  const closures = await GET(`/api/sites/${sid()}/assets?category=closure`);
  const f = formFields([
    { key: 'closure_asset_id', label: '접속함', type: 'select', options: [['', '선택'], ...closures.map(c => [c.id, c.mgmt_no + ' ' + (c.name || '')])], required: true },
    { key: 'tray', label: '트레이' }, { key: 'sleeve', label: '슬리브' }, { key: 'work_date', label: '접속일', type: 'date', value: today() },
    { key: 'worker', label: '작업자', value: state.me.user.name }, { key: 'note', label: '작업 내용' },
  ]);
  const ok = await modal('광코어 접속 등록', h('div', null, h('div', { class: 'grid2' }, a.el, b.el), h('div', { style: { marginTop: '10px' } }, f.el), h('p', { class: 'small muted' }, '같은 코어 끝단에 이미 접속이 있으면 저장되지 않습니다.')), {
    size: 'wide', buttons: [{ label: '저장', primary: true, action: () => { const ea = a.get(), eb = b.get(); if (!ea.id || !eb.id) throw new Error('양쪽 코어를 선택하세요.'); return POST(`/api/sites/${sid()}/connections`, { kind: 'splice', a: ea, b: eb, ...f.values() }); } }],
  });
  if (ok) { toast('접속을 등록했습니다.'); location.reload(); }
}

// ---------- LAN·랙·포트 ----------
export async function lan(body, query) {
  const racks = await GET(`/api/sites/${sid()}/assets?category=rack`);
  const others = await GET(`/api/sites/${sid()}/assets?category=patch_panel,switch,outlet`);
  let rackId = Number(query.get('rack')) || racks[0]?.id;
  const rackSel = h('select', { onchange: (e) => { rackId = Number(e.target.value); showRack(); } }, racks.map(r => h('option', { value: r.id, selected: r.id === rackId }, `${r.mgmt_no} ${r.name || ''}`)));
  const rackBox = h('div');
  const detail = h('div', { class: 'box' }, h('div', { class: 'muted small' }, '포트를 클릭하면 연결 정보를 표시합니다.'));
  async function showRack() {
    if (!rackId) { clear(rackBox, h('div', { class: 'box muted' }, '등록된 랙이 없습니다.')); return; }
    const units = await GET(`/api/assets/${rackId}/rack`);
    clear(rackBox, units.length ? units.map(u => h('div', { class: 'box' },
      h('div', { class: 'pagehead', style: { marginBottom: '6px' } }, h('b', null, `${u.asset.mgmt_no} `), h('span', { class: 'muted small' }, `${u.category_label} · ${u.asset.name || ''} · ${u.ports.length}포트`), h('div', { class: 'sp' }), h('a', { class: 'btn sm', href: siteUrl('asset/' + u.asset.id) }, '이력 카드')),
      h('div', { class: 'ports' }, u.ports.map(p => {
        const used = p.status === '사용';
        const cls = p.status === '불량' ? 'bad' : p.status === '사용 중지' ? 'stop' : used ? 'used' : 'spare';
        const sub = u.asset.category === 'patch_panel' ? [p.rear ? '뒤●' : '뒤○', p.front ? '앞●' : '앞○'].join(' ') : (p.peer ? '●' : '');
        return h('div', { class: 'port ' + cls, title: `${p.name} ${p.status}`, onclick: (e) => { rackBox.querySelectorAll('.port.sel').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); portDetail(u, p); } }, h('b', null, p.name.replace(/^P/, '')), sub);
      })))) : h('div', { class: 'box muted' }, '이 랙에 등록된 패치패널·스위치가 없습니다. 장비 등록 시 "설치 랙"을 지정하세요.'));
  }
  async function portDetail(u, p) {
    const pass = u.asset.category === 'patch_panel';
    let far = null;
    if (pass && p.rear?.type === 'cable') {
      const c = await GET(`/api/assets/${p.rear.id}`);
      far = c.ends[p.rear.end === 'A' ? 'B' : 'A'];
    }
    clear(detail, h('h2', null, `${u.asset.mgmt_no} ${p.name}`),
      h('table', { class: 'kv' }, h('tbody', null,
        h('tr', null, h('th', null, '상태'), h('td', null, p.status)),
        pass ? [h('tr', null, h('th', null, '뒤 · 고정 배선'), h('td', null, p.rear ? p.rear.text : '없음', far ? ` → ${far.text}` : '')), h('tr', null, h('th', null, '앞 · 패치코드'), h('td', null, p.front ? p.front.text : '없음'))]
          : h('tr', null, h('th', null, '연결'), h('td', null, p.peer ? p.peer.text : '없음')))),
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'sm', onclick: () => showTrace('port', p.id, `${u.asset.mgmt_no} ${p.name} 추적`) }, '경로 추적'),
        h('a', { class: 'btn sm', href: siteUrl('asset/' + u.asset.id) }, '포트 수정·연결 변경은 이력 카드에서')),
      h('p', { class: 'small muted' }, '패치코드 변경 시 고정 배선은 유지되고 변경 전후 연결이 이력으로 남습니다.'));
  }
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, 'LAN·랙·포트 관리'), h('div', { class: 'sp' }),
    h('a', { class: 'btn', href: siteUrl('assets?cat=lan_cable') }, 'LAN케이블 목록'),
    h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/lan_ports`) }, 'LAN 포트 배선표 PDF'),
    perm('can_create') ? h('button', { class: 'primary', onclick: async () => { const id = await openAssetForm('lan_cable'); if (id) location.hash = siteUrl('asset/' + id); } }, 'LAN케이블 등록') : null),
    h('div', { class: 'filters' }, h('span', null, '랙'), rackSel, h('div', { class: 'legend' }, h('span', { class: 'l-used' }, '사용'), h('span', null, '예비'), h('span', { class: 'l-bad' }, '불량'), h('span', { class: 'l-stop' }, '사용 중지'), ' ● 연결 있음 ○ 없음')),
    h('div', { class: 'grid2', style: { gridTemplateColumns: '2fr 1fr' } }, rackBox, detail),
    h('h2', null, '랙 외 장비 (정보콘센트 등)'),
    h('div', { class: 'box flush' }, table([{ label: '관리번호', get: a => link(a) }, { label: '종류', get: a => catLabel(a.category) }, { label: '명칭', get: a => a.name }, { label: '위치', get: a => [a.building, a.floor, a.room].filter(Boolean).join(' ') }],
      others.filter(o => !o.parent_id))));
  await showRack();
}

// ---------- 측정·성적서 ----------
export async function measurements(body) {
  const M = state.meta;
  const tt = h('select', null, h('option', { value: '' }, '시험 전체'), ...Object.entries(M.TEST_TYPES).map(([k, v]) => h('option', { value: k }, v.label)));
  const res = h('select', null, h('option', { value: '' }, '판정 전체'), ...['적합', '부적합', '판정기준 미설정', '판정 불가'].map(x => h('option', { value: x }, x)));
  const rv = h('select', null, h('option', { value: '' }, '검토 전체'), ...['검토 대기', '승인', '반려', '재시험 필요'].map(x => h('option', { value: x }, x)));
  const all = h('input', { type: 'checkbox' });
  const wrap = h('div', { class: 'tablewrap' });
  async function load() {
    const rows = (await GET(`/api/sites/${sid()}/measurements?${new URLSearchParams({ ...(tt.value ? { test_type: tt.value } : {}), ...(all.checked ? { all: 1 } : {}) })}`))
      .filter(m => (!res.value || m.auto_result === res.value) && (!rv.value || m.review_status === rv.value));
    clear(wrap, table([
      { label: '관리번호', get: m => h('a', { href: siteUrl('asset/' + m.asset_id) }, m.mgmt_no) }, { label: '시험', get: m => M.TEST_TYPES[m.test_type]?.label },
      { label: '측정일시', get: m => fmt(m.measured_at) }, { label: '구간·조합', get: m => [m.section, m.combination, m.core_no ? '#' + m.core_no : ''].filter(Boolean).join(' / ') },
      { label: '조건', get: m => [m.test_voltage && m.test_voltage + 'V', m.wavelength && m.wavelength + 'nm', m.direction].filter(Boolean).join(' ') },
      { label: '측정값', get: m => m.value !== null ? `${m.value} ${m.unit || ''}` : m.overall }, { label: '측정자', get: m => m.measurer },
      { label: '자동 판정', get: m => h('span', { title: m.auto_reason || '' }, resultTag(m.auto_result)) }, { label: '검토', get: m => reviewTag(m.review_status) },
      { label: '성적서', get: m => m.file_count ? m.file_count + '건' : h('span', { class: 'tag warn' }, '없음') },
      { label: '기록', get: m => m.superseded_by ? '정정됨' : m.corrects_id ? '정정본' : '' },
    ], rows, { rowClass: m => m.superseded_by ? 'old' : '' }));
  }
  [tt, res, rv, all].forEach(x => x.addEventListener('change', load));
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '측정·성적서 관리'), h('div', { class: 'sp' }),
    h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/measurements`) }, '측정 결과 목록 PDF'),
    h('button', { onclick: () => download(`/api/sites/${sid()}/excel/export?type=measurements`) }, '엑셀 내보내기')),
    h('p', { class: 'small muted' }, '측정 등록·검토·정정은 각 설비의 이력 카드 > 측정 탭에서 합니다. 판정은 "사용자·권한·시험기준" 화면에 등록된 현장 기준으로만 계산합니다.'),
    h('div', { class: 'filters' }, tt, res, rv, h('label', { class: 'small' }, all, ' 정정 전 기록 포함')), wrap);
  await load();
}

// ---------- 작업·보수 이력 ----------
export async function worklogs(body) {
  const M = state.meta;
  const wt = h('select', null, h('option', { value: '' }, '작업 종류 전체'), ...M.WORK_TYPES.map(x => h('option', { value: x }, x)));
  const from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
  const wrap = h('div', { class: 'tablewrap' });
  const qs = () => new URLSearchParams(Object.fromEntries([['work_type', wt.value], ['from', from.value], ['to', to.value]].filter(([, v]) => v)));
  async function load() {
    const rows = await GET(`/api/sites/${sid()}/worklogs?${qs()}`);
    clear(wrap, table([
      { label: '작업일시', get: w => fmt(w.work_at) }, { label: '관리번호', get: w => h('a', { href: siteUrl('asset/' + w.asset_id) }, w.mgmt_no) }, { label: '설비', get: w => catLabel(w.category) },
      { label: '종류', get: w => w.work_type }, { label: '내용', get: w => w.content }, { label: '작업자·업체', get: w => [w.worker, w.company].filter(Boolean).join(' / ') },
      { label: '변경 전 → 후', get: w => (w.before_value || w.after_value) ? `${w.before_value || '-'} → ${w.after_value || '-'}` : '' },
      { label: '사진', get: w => w.file_count ? w.file_count + '매' : '' }, { label: '상태', get: w => reviewTag(w.status) },
    ], rows));
  }
  [wt, from, to].forEach(x => x.addEventListener('change', load));
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '작업·보수 이력'), h('div', { class: 'sp' }),
    h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/worklogs?${qs()}`) }, '보수 이력대장 PDF'),
    h('button', { onclick: () => download(`/api/sites/${sid()}/pdf/photos?${new URLSearchParams(Object.fromEntries([['from', from.value], ['to', to.value]].filter(([, v]) => v)))}`) }, '사진대장 PDF')),
    h('p', { class: 'small muted' }, '이력 등록은 설비 이력 카드 또는 모바일 QR 화면에서 합니다. 확정된 기록은 정정 사유와 함께 정정 기록으로만 수정됩니다.'),
    h('div', { class: 'filters' }, wt, h('span', { class: 'small' }, '기간'), from, '~', to), wrap);
  await load();
}

// ---------- 누락·부적합·만료 ----------
export async function issues(body, query) {
  const M = state.meta;
  let type = query.get('type') || 'unmeasured';
  const tabs = h('div', { class: 'tabs' });
  const wrap = h('div', { class: 'box flush' });
  async function load() {
    clear(tabs, ...Object.entries(M.ISSUE_TYPES).map(([k, l]) => h('button', { class: k === type ? 'on' : '', onclick: () => { type = k; load(); } }, l)));
    const rows = await GET(`/api/sites/${sid()}/issues?type=${type}`);
    clear(wrap, table([
      { label: '관리번호', get: r => h('a', { href: siteUrl('asset/' + r.id) }, r.mgmt_no) }, { label: '종류', get: r => catLabel(r.category) }, { label: '명칭', get: r => r.name },
      { label: '상태', get: r => statusTag(r.status) }, { label: '내용', get: r => r.note || (r.measurement_id ? `${fmt(r.measured_at)} ${M.TEST_TYPES[r.test_type]?.label} 측정 성적서 없음` : M.ISSUE_TYPES[type]) },
      { label: '', get: r => type === 'no_drawing' ? h('a', { class: 'btn sm', href: siteUrl('viewer?asset=' + r.id) }, '도면에서 지정') : type === 'recheck' ? h('button', { class: 'sm', onclick: () => gotoDrawing(r.id) }, '도면 열기') : '' },
    ], rows, { empty: '해당 항목이 없습니다.' }));
  }
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '누락·부적합·만료 예정')), tabs, wrap,
    h('p', { class: 'small muted' }, '부적합은 같은 시험·조합의 최근 기록 기준입니다. 보증 만료 예정은 오늘부터 90일 이내(이미 만료 포함)입니다.'));
  await load();
}

// ---------- 출력·엑셀 ----------
export async function outputs(body) {
  const M = state.meta;
  const reports = [['power_list', '전력케이블 목록', '가로'], ['fiber_splice', '광코어 접속표', '가로'], ['lan_ports', 'LAN 포트 배선표', '가로'], ['cctv_ledger', 'CCTV 장비대장', '가로'], ['measurements', '시험·측정 결과 목록', '가로'], ['worklogs', '보수 이력대장', '가로'], ['photos', '작업 전후 사진대장 (2×2)', '세로'], ['qr_labels', 'QR 라벨 (전체 설비)', '세로']];
  const tcat = h('select', null, ...[['power_cable', '전력케이블'], ['fiber_cable', '광케이블'], ['lan_cable', 'LAN케이블'], ['cctv', 'CCTV'], ['equipment', '장비 (분전반·랙·스위치 등)'], ['fiber_splice', '광코어 접속'], ['measurement', '측정기록']].map(([k, l]) => h('option', { value: k }, l)));
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const preview = h('div');
  async function doPreview() {
    if (!file.files[0]) return toast('엑셀 파일을 선택하세요.', true);
    const fd = new FormData(); fd.append('category', tcat.value); fd.append('file', file.files[0]);
    try {
      const r = await api('POST', `/api/sites/${sid()}/excel/preview`, fd);
      const mode = h('select', null, h('option', { value: 'valid_only' }, '정상 행만 저장 (오류 행 제외)'), h('option', { value: 'all_or_nothing' }, '오류가 하나라도 있으면 저장하지 않음'));
      const dup = h('select', { class: ['fiber_splice', 'measurement'].includes(tcat.value) ? 'hidden' : '' }, h('option', { value: 'skip' }, '이미 있는 관리번호: 건너뜀'), h('option', { value: 'update' }, '이미 있는 관리번호: 값 갱신'), h('option', { value: 'error' }, '이미 있는 관리번호: 오류로 처리'));
      const out = h('div');
      clear(preview, h('div', { class: 'box' },
        h('div', { class: 'pagehead' }, h('b', null, `미리보기 · 전체 ${r.total}행`), h('span', { class: r.error_count ? 'tag bad' : 'tag ok' }, `오류 ${r.error_count}행`), h('span', { class: 'tag info' }, `기존 관리번호 ${r.dup_count}행`)),
        h('div', { class: 'tablewrap', style: { maxHeight: '340px' } }, table([{ label: '행', get: x => x.row, cls: 'num' }, { label: '관리번호', get: x => x.mgmt_no }, { label: '명칭', get: x => x.name }, { label: '기존', get: x => x.exists ? '있음' : '' }, { label: '검사 결과', get: x => x.errors.length ? h('span', { class: 'err' }, x.errors.join(' / ')) : h('span', { class: 'tag ok' }, '정상') }], r.rows, { rowClass: x => x.errors.length ? 'sel' : '' })),
        h('div', { class: 'filters', style: { marginTop: '10px' } }, mode, dup, h('button', { class: 'primary', onclick: async () => { try { const c = await POST(`/api/import/${r.job_id}/commit`, { mode: mode.value, dup: dup.value }); clear(out, h('div', { class: c.saved ? 'tag ok' : 'tag warn' }, c.message || `저장 완료: 신규 ${c.created} · 갱신 ${c.updated} · 중복 건너뜀 ${c.skipped_dup} · 오류 제외 ${c.skipped_error}`)); } catch (e) { clear(out, h('div', { class: 'err' }, e.message)); } } }, '검증 후 저장')),
        h('p', { class: 'small muted' }, '저장은 하나의 처리 단위(트랜잭션)로 실행됩니다. 저장 중 예상치 못한 오류가 나면 전체가 취소되어 일부만 저장되지 않습니다.'), out));
    } catch (e) { clear(preview, h('div', { class: 'box err' }, e.message)); }
  }
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '출력·엑셀 관리')),
    h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('h2', null, 'PDF 출력'), table([{ label: '문서', get: r => r[1] }, { label: '용지', get: r => `A4 ${r[2]}` }, { label: '', get: r => h('button', { class: 'sm', onclick: () => download(`/api/sites/${sid()}/pdf/${r[0]}`) }, 'PDF 열기') }], reports),
        h('p', { class: 'small muted' }, '개별 회로·케이블·장비 이력 카드는 각 설비 화면의 "PDF 이력카드"로 출력합니다. 장비 비밀번호는 어떤 출력물에도 포함되지 않습니다.')),
      h('div', { class: 'box' }, h('h2', null, '엑셀 내보내기'),
        h('div', { class: 'btns' }, h('button', { onclick: () => download(`/api/sites/${sid()}/excel/export`) }, '전체 설비 목록'), h('button', { onclick: () => download(`/api/sites/${sid()}/excel/export?type=measurements`) }, '측정기록')),
        h('h2', { style: { marginTop: '16px' } }, '엑셀 일괄 등록'),
        h('div', { class: 'filters' }, tcat, h('button', { onclick: () => download(`/api/sites/${sid()}/excel/template/${tcat.value}`) }, '등록 양식 받기')),
        perm('can_create') ? h('div', { class: 'filters' }, file, h('button', { class: 'primary', onclick: doPreview }, '업로드 미리보기')) : h('p', { class: 'muted small' }, '등록 권한이 없습니다.'))),
    preview);
}

// ---------- 설정: 사용자·권한·시험기준·현장 ----------
export async function settings(body) {
  const M = state.meta;
  const isAdmin = state.me.user.role === 'admin';
  const tabs = h('div', { class: 'tabs' });
  const box = h('div');
  let cur = isAdmin ? 'users' : 'criteria';
  const defs = [isAdmin && ['users', '사용자·권한'], isAdmin && ['sites', '현장'], state.site.id && ['criteria', '시험 판정기준'], isAdmin && ['audit', '감사 로그']].filter(Boolean);
  const render = async () => {
    clear(tabs, ...defs.map(([k, l]) => h('button', { class: k === cur ? 'on' : '', onclick: () => { cur = k; render(); } }, l)));
    clear(box);
    if (cur === 'users') await usersTab(box);
    if (cur === 'sites') await sitesTab(box);
    if (cur === 'criteria') await criteriaTab(box);
    if (cur === 'audit') await auditTab(box);
  };
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '사용자·권한·시험기준 설정')), tabs, box);
  await render();

  async function usersTab(el) {
    const users = await GET('/api/users');
    const sites = (await GET('/api/me')).sites;
    const roleL = { admin: '관리자', site_manager: '현장관리자', worker: '작업자', viewer: '조회자' };
    const reload = () => usersTab(clear(el));
    el.append(h('div', { class: 'btns', style: { marginBottom: '8px' } }, h('button', { class: 'primary', onclick: async () => {
      const f = formFields([{ key: 'username', label: '아이디', required: true }, { key: 'name', label: '이름', required: true }, { key: 'password', label: '초기 비밀번호 (8자 이상)', type: 'password', required: true }, { key: 'role', label: '역할', type: 'select', options: Object.entries(roleL) }, { key: 'phone', label: '연락처' }]);
      if (await modal('사용자 추가', f.el, { buttons: [{ label: '추가', primary: true, action: () => POST('/api/users', f.values()) }] })) reload();
    } }, '사용자 추가')),
      h('div', { class: 'box flush' }, table([
        { label: '아이디', get: u => u.username }, { label: '이름', get: u => u.name }, { label: '역할', get: u => roleL[u.role] }, { label: '사용', get: u => u.active ? '사용' : h('span', { class: 'tag gray' }, '중지') },
        { label: '현장 권한', get: u => u.role === 'admin' ? '전체 현장' : u.sites.map(m => { const s = sites.find(x => x.id === m.site_id); return `${s?.name || m.site_id} [${['조회', m.can_create && '등록', m.can_edit && '수정', m.can_delete && '삭제', m.can_review && '검토'].filter(Boolean).join('·')}]`; }).join(', ') || h('span', { class: 'tag warn' }, '없음') },
        { label: '', get: u => h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => editUser(u) }, '수정'), u.role !== 'admin' ? h('button', { class: 'sm', onclick: () => editPerm(u) }, '현장 권한') : null) },
      ], users)),
      h('p', { class: 'small muted' }, '조회자는 현장 권한 설정과 관계없이 조회만 가능합니다. 현장 권한은 화면뿐 아니라 API와 첨부파일 다운로드에도 적용됩니다.'));
    async function editUser(u) {
      const f = formFields([{ key: 'name', label: '이름', value: u.name }, { key: 'role', label: '역할', type: 'select', options: Object.entries(roleL), value: u.role }, { key: 'phone', label: '연락처', value: u.phone }, { key: 'active', label: '사용', type: 'checkbox', value: !!u.active }, { key: 'password', label: '새 비밀번호 (변경 시만)', type: 'password' }]);
      if (await modal(`사용자 수정 · ${u.username}`, f.el, { buttons: [{ label: '저장', primary: true, action: () => { const v = f.values(); if (!v.password) delete v.password; return PUT(`/api/users/${u.id}`, v); } }] })) reload();
    }
    async function editPerm(u) {
      const rows = sites.map(s => {
        const m = u.sites.find(x => x.site_id === s.id) || {};
        const cb = (k, v) => h('input', { type: 'checkbox', 'data-k': k, checked: !!v });
        return { s, el: h('tr', null, h('td', null, s.name), h('td', null, cb('view', !!u.sites.find(x => x.site_id === s.id))), h('td', null, cb('can_create', m.can_create)), h('td', null, cb('can_edit', m.can_edit)), h('td', null, cb('can_delete', m.can_delete)), h('td', null, cb('can_review', m.can_review))) };
      });
      const t = h('table', { class: 't' }, h('thead', null, h('tr', null, ...['현장', '접근(조회)', '등록', '수정', '삭제', '검토'].map(x => h('th', null, x)))), h('tbody', null, rows.map(r => r.el)));
      if (await modal(`현장 권한 · ${u.name}`, t, { buttons: [{ label: '저장', primary: true, action: () => {
        const list = rows.filter(r => r.el.querySelector('[data-k=view]').checked).map(r => { const g = k => r.el.querySelector(`[data-k=${k}]`).checked; return { site_id: r.s.id, can_create: g('can_create'), can_edit: g('can_edit'), can_delete: g('can_delete'), can_review: g('can_review') }; });
        return PUT(`/api/users/${u.id}/sites`, { sites: list });
      } }] })) reload();
    }
  }

  async function sitesTab(el) {
    const sites = (await GET('/api/me')).sites;
    el.append(h('div', { class: 'btns', style: { marginBottom: '8px' } }, h('button', { class: 'primary', onclick: async () => {
      const f = formFields([{ key: 'code', label: '현장코드', required: true }, { key: 'name', label: '현장명', required: true }, { key: 'client', label: '발주처' }, { key: 'period', label: '공사기간' }, { key: 'address', label: '주소', wide: true }]);
      if (await modal('현장 등록', f.el, { buttons: [{ label: '등록', primary: true, action: () => POST('/api/sites', f.values()) }] })) { state.me = await GET('/api/me'); toast('현장을 등록했습니다.'); settings(body); }
    } }, '현장 등록')),
      h('div', { class: 'box flush' }, table([{ label: '코드', get: s => s.code }, { label: '현장명', get: s => s.name }, { label: '발주처', get: s => s.client }, { label: '기간', get: s => s.period }, { label: '구분', get: s => s.is_demo ? h('span', { class: 'tag warn' }, '시연용') : '실제' }], sites)));
  }

  async function criteriaTab(el) {
    const list = await GET(`/api/sites/${sid()}/criteria`);
    const canSet = ['admin', 'site_manager'].includes(state.me.user.role) && perm('can_edit');
    const reload = () => criteriaTab(clear(el));
    const form = (c = {}) => {
      const cond = c.conditions ? JSON.parse(c.conditions) : {};
      return formFields([
        { key: 'test_type', label: '시험 종류', type: 'select', options: Object.entries(M.TEST_TYPES).map(([k, v]) => [k, v.label]), value: c.test_type, required: true },
        { key: 'target_category', label: '적용 대상', type: 'select', options: [['*', '전체'], ['power_cable', '전력케이블'], ['fiber_cable', '광케이블'], ['lan_cable', 'LAN케이블']], value: c.target_category },
        { key: 'name', label: '기준명', required: true, value: c.name },
        { key: 'comparator', label: '비교 조건', type: 'select', options: [['>=', '이상 (≥)'], ['>', '초과 (>)'], ['<=', '이하 (≤)'], ['<', '미만 (<)'], ['=', '같음 (=)']], value: c.comparator },
        { key: 'value', label: '기준값', type: 'number', required: true, value: c.value }, { key: 'unit', label: '단위', required: true, value: c.unit, placeholder: 'MΩ, dB …' },
        { key: 'cond_test_voltage', label: '필수 조건: 시험전압(V)', type: 'number', value: cond.test_voltage }, { key: 'cond_wavelength', label: '필수 조건: 파장(nm)', type: 'number', value: cond.wavelength },
        { key: 'basis_doc', label: '근거 문서', wide: true, value: c.basis_doc, required: true, placeholder: '설계도서·시방서·감리 승인 문서 등' },
        { key: 'effective_date', label: '적용일', type: 'date', value: c.effective_date || today(), required: true },
      ]);
    };
    el.append(
      h('p', { class: 'small muted' }, '판정기준은 시스템이 임의로 정하지 않습니다. 근거 문서에 따라 현장별로 등록하세요. 기준이 없으면 "판정기준 미설정", 단위나 필수 조건이 맞지 않으면 "판정 불가"로 표시됩니다. 기준을 수정하면 새 버전이 만들어지고, 과거 측정은 당시 적용된 기준 버전을 유지합니다.'),
      canSet ? h('div', { class: 'btns', style: { marginBottom: '8px' } }, h('button', { class: 'primary', onclick: async () => { const f = form(); if (await modal('시험기준 등록', f.el, { size: 'wide', buttons: [{ label: '등록', primary: true, action: () => POST(`/api/sites/${sid()}/criteria`, f.values()) }] })) reload(); } }, '기준 등록')) : null,
      h('div', { class: 'box flush' }, table([
        { label: '기준명', get: c => c.name }, { label: '버전', get: c => 'v' + c.version }, { label: '시험', get: c => M.TEST_TYPES[c.test_type]?.label }, { label: '대상', get: c => c.target_category === '*' ? '전체' : catLabel(c.target_category) },
        { label: '조건', get: c => `${c.comparator} ${c.value} ${c.unit}` }, { label: '필수 조건', get: c => Object.entries(JSON.parse(c.conditions)).map(([k, v]) => `${k === 'test_voltage' ? '시험전압' : '파장'} ${v}`).join(', ') },
        { label: '근거', get: c => c.basis_doc }, { label: '적용일', get: c => c.effective_date }, { label: '상태', get: c => c.active ? h('span', { class: 'tag ok' }, '적용 중') : h('span', { class: 'tag gray' }, '이전 버전') },
        { label: '', get: c => canSet && c.active ? h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: async () => { const f = form(c); if (await modal('기준 수정 (새 버전 생성)', f.el, { size: 'wide', buttons: [{ label: '새 버전 저장', primary: true, action: () => PUT(`/api/criteria/${c.id}`, f.values()) }] })) reload(); } }, '수정'), h('button', { class: 'sm', onclick: async () => { await PUT(`/api/criteria/${c.id}`, { deactivate: true }); reload(); } }, '중지')) : '' },
      ], list, { rowClass: c => c.active ? '' : 'old', empty: '등록된 기준이 없습니다. 모든 측정은 "판정기준 미설정"으로 표시됩니다.' })));
  }

  async function auditTab(el) {
    const rows = await GET(`/api/audit?site_id=${sid() || ''}`);
    el.append(h('p', { class: 'small muted' }, '감사 로그는 데이터베이스 수준에서 수정·삭제가 차단되어 있습니다. 최근 500건.'),
      h('div', { class: 'tablewrap' }, table([{ label: '일시', get: r => r.at }, { label: '사용자', get: r => r.user_name }, { label: '현장', get: r => r.site_name }, { label: '작업', get: r => r.action }, { label: '대상', get: r => `${r.entity} #${r.entity_id ?? ''}` }, { label: '내용', get: r => h('span', { class: 'small' }, (r.detail || '').slice(0, 200)) }], rows)));
  }
}

// ---------- 실시간 상태 ----------
export async function live(body) {
  const canSet = ['admin', 'site_manager'].includes(state.me.user.role) && perm('can_edit');
  const wrap = h('div'); const evWrap = h('div'); const stamp = h('span', { class: 'muted small' });
  let timer;
  async function load() {
    if (!wrap.isConnected && timer) { clearInterval(timer); return; }
    const d = await GET(`/api/sites/${sid()}/monitors`);
    const cnt = s => d.monitors.filter(m => m.status === s).length;
    stamp.textContent = `서버 시각 ${d.server_time} 기준 · 15초마다 새로 고침`;
    clear(wrap,
      h('div', { class: 'stats' }, ...[['정상', ''], ['이상', ' bad'], ['응답 없음', ' bad'], ['확인 전', ''], ['중지', '']].map(([s, c]) => h('div', null, h('div', { class: 'n' + (cnt(s) ? c : '') }, cnt(s)), h('div', { class: 'l' }, s)))),
      h('div', { class: 'box flush' }, table([
        { label: '관리번호', get: m => h('a', { href: siteUrl('asset/' + m.asset_id) }, m.mgmt_no) }, { label: '설비', get: m => `${catLabel(m.category)} ${m.name || ''}` },
        { label: '실시간 상태', get: m => liveTag(m) }, { label: '등록 상태', get: m => statusTag(m.asset_status) },
        { label: '방식', get: m => ({ tcp: `TCP ${m.host}:${m.port}`, http: `HTTP ${m.host}${m.port && m.port !== 80 ? ':' + m.port : ''}${m.path || ''}`, push: '외부 시스템 수신' })[m.method] },
        { label: '마지막 확인', get: m => m.last_checked_at || '-' }, { label: '응답', get: m => m.last_latency_ms != null ? m.last_latency_ms + 'ms' : '', cls: 'num' },
        { label: '마지막 정상', get: m => m.last_ok_at || '-' }, { label: '내용', get: m => m.last_message || '' },
      ], d.monitors, { empty: '감시 중인 설비가 없습니다. 설비 이력 카드 > 기본정보 > "실시간 감시 설정"에서 추가하세요.' })));
    clear(evWrap, table([{ label: '시각', get: e => e.at }, { label: '설비', get: e => e.mgmt_no }, { label: '변경', get: e => `${e.from_status || '-'} → ${e.to_status}` }, { label: '출처', get: e => e.source === 'push' ? '외부 수신' : '서버 점검' }, { label: '내용', get: e => e.message || '' }], d.events, { empty: '상태 변화 기록이 없습니다.' }));
  }
  const tokBox = h('div');
  async function tokens() {
    if (!canSet) return;
    const list = await GET(`/api/sites/${sid()}/tokens`);
    clear(tokBox, h('div', { class: 'btns', style: { marginBottom: '6px' } }, h('button', { onclick: async () => {
      const f = formFields([{ key: 'name', label: '토큰 이름 (예: NVR-1 상태 전송)', required: true, wide: true }]);
      const r = await modal('수신 토큰 발급', f.el, { size: 'narrow', buttons: [{ label: '발급', primary: true, action: () => POST(`/api/sites/${sid()}/tokens`, f.values()) }] });
      if (r) { await modal('토큰 (한 번만 표시)', h('div', null, h('input', { type: 'text', value: r.token, style: { width: '100%' }, readonly: true }), h('p', { class: 'small muted' }, '지금 복사해 두세요. 서버에는 암호화된 값만 저장되어 다시 볼 수 없습니다.')), { size: 'narrow' }); tokens(); }
    } }, '수신 토큰 발급')),
      table([{ label: '이름', get: t => t.name }, { label: '앞자리', get: t => t.prefix + '…' }, { label: '마지막 사용', get: t => t.last_used_at || '-' }, { label: '상태', get: t => t.revoked ? h('span', { class: 'tag gray' }, '폐기') : h('span', { class: 'tag ok' }, '사용') },
        { label: '', get: t => t.revoked ? '' : h('button', { class: 'sm danger', onclick: async () => { await api('DELETE', `/api/tokens/${t.id}`); tokens(); } }, '폐기') }], list, { empty: '발급한 토큰이 없습니다.' }),
      h('pre', { class: 'small', style: { background: '#f6f7f8', border: '1px solid #d4d7db', padding: '8px', overflow: 'auto' } },
`POST ${location.origin}/api/ingest/status
Authorization: Bearer <토큰>
Content-Type: application/json

{ "items": [ { "asset": "CCTV-01", "status": "정상", "message": "녹화 중" },
             { "asset": "CCTV-02", "status": "down", "message": "영상 손실" } ] }
status 값: 정상/ok/up · 이상/alarm/fault · 응답 없음/down/offline`));
  }
  clear(body, h('div', { class: 'pagehead' }, h('h1', null, '실시간 상태'), stamp),
    h('p', { class: 'small muted' }, '"실시간 상태"는 서버 점검 또는 외부 시스템 보고로 확인한 결과이고, "등록 상태"는 사람이 입력한 시공·사용 상태입니다. 확인 시각이 오래된 값은 현재 상태가 아닐 수 있습니다. 클라우드 서버는 현장 내부망 장비에 직접 접속할 수 없으므로, 내부망 장비는 현장 서버 설치 또는 외부 시스템 수신 방식을 사용하세요.'),
    wrap, h('h2', null, '상태 변화 기록'), h('div', { class: 'box flush' }, evWrap),
    canSet ? [h('h2', { style: { marginTop: '14px' } }, '외부 시스템 수신 (NVR·SCADA·NMS 연동)'), h('div', { class: 'box' }, tokBox)] : null);
  await load(); await tokens();
  timer = setInterval(load, 15000);
}
