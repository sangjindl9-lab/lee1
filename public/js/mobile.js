// 모바일 QR 화면: 이력 확인 · 사진 촬영 등록 · 작업 이력 · 측정값 입력
// 저장은 모두 단말 대기열(IndexedDB)을 거쳐 전송합니다. 통신이 끊겨도 저장 내용이 남고 연결되면 자동 전송됩니다.
import { h, clear, state, GET, toast, formFields, fmt, nowLocal, resultTag, statusTag } from './ui.js';
import { renderCard } from './card.js';
import * as off from './offline.js';

export async function mobileAsset(main, id) {
  let card, offline = false, savedAt = null;
  try {
    card = await GET(`/api/assets/${id}`);
    off.saveCard(card);
  } catch (e) {
    if (e.status !== 0) { clear(main, h('div', { class: 'box err' }, e.message)); return; }
    const c = await off.loadCard(id).catch(() => null);
    if (!c) { clear(main, h('div', { class: 'box err' }, '통신이 연결되지 않았고, 이 단말에 저장된 이력 카드도 없습니다. 연결된 곳에서 한 번 열어 두면 오프라인에서도 볼 수 있습니다.')); return; }
    card = c.card; offline = true; savedAt = c.saved_at;
  }
  state.site = state.me.sites.find(s => s.id === card.asset.site_id) || state.site;
  const a = card.asset; const p = card.perm || {};
  const M = state.meta;
  const latest = card.measurements.filter(m => !m.superseded_by).slice(0, 3);
  const section = h('div');
  const queueBox = h('div');

  const btn = (label, fn, primary) => h('button', { class: 'big' + (primary ? ' primary' : ''), onclick: fn }, label);
  clear(main,
    offline ? h('div', { class: 'demo-flag' }, `오프라인 — ${savedAt.replace('T', ' ').slice(0, 16)}에 이 단말에 저장한 내용입니다. 입력한 기록은 단말에 보관했다가 연결되면 자동 전송합니다.`) : null,
    a.is_demo ? h('div', { class: 'demo-flag' }, '시연용 데이터') : null,
    queueBox,
    h('div', { class: 'box' },
      h('div', { class: 'small muted' }, state.site?.name),
      h('div', { style: { fontSize: '20px', fontWeight: 700 } }, a.mgmt_no), h('div', null, card.category_label, a.name ? ' · ' + a.name : ''),
      h('div', { class: 'btns', style: { marginTop: '6px' } }, statusTag(a.status), card.marks.length ? null : h('span', { class: 'tag warn' }, '도면 미연결')),
      h('div', { class: 'small', style: { marginTop: '6px' } }, [a.building, a.floor, a.room, a.location_desc].filter(Boolean).join(' / ')),
      card.ends ? h('div', { class: 'small', style: { marginTop: '6px' } }, `A단: ${card.ends.A?.text || '미등록'}`, h('br'), `B단: ${card.ends.B?.text || '미등록'}`) : null),
    h('div', { class: 'box' }, h('b', null, '최근 측정'),
      latest.length ? latest.map(m => h('div', { class: 'small', style: { marginTop: '4px' } }, `${fmt(m.measured_at)} ${M.TEST_TYPES[m.test_type]?.label} ${m.combination || ''} ${m.value ?? ''}${m.unit || ''} `, resultTag(m.auto_result))) : h('div', { class: 'small muted' }, '측정 기록 없음')),
    p.can_create ? h('div', { style: { display: 'grid', gap: '8px', marginBottom: '12px' } },
      btn('사진 촬영·등록', () => photoSection(), true), btn('작업 이력 등록', () => worklogSection()), M.CATEGORIES[a.category].group === 'cable' ? btn('측정값 입력', () => measureSection()) : null)
      : h('div', { class: 'box small muted' }, '조회 권한만 있습니다.'),
    section,
    offline ? null : h('div', { class: 'box' }, h('b', null, '전체 이력 카드'), h('div', { id: 'mcard', style: { marginTop: '8px' } })));
  if (!offline) renderCard(main.querySelector('#mcard'), id, { compact: false });

  // ---- 전송 대기 목록 ----
  async function renderQueue() {
    if (!queueBox.isConnected) { stop(); return; }
    const q = await off.listQueue().catch(() => []);
    if (!q.length) { clear(queueBox, off.lastSent ? h('div', { class: 'box small', style: { color: 'var(--ok)' } }, `전송 완료: ${off.lastSent.label}${off.lastSent.result ? ' · 자동 판정 ' + off.lastSent.result : ''}`) : null); return; }
    clear(queueBox, h('div', { class: 'box' },
      h('b', null, `전송 대기 ${q.length}건`), h('span', { class: 'small muted' }, navigator.onLine ? ' — 전송 중이거나 다시 시도합니다' : ' — 통신 연결 후 자동 전송'),
      ...q.map(j => h('div', { class: 'upload-item' },
        j.files?.[0] ? h('img', { src: URL.createObjectURL(j.files[0].blob) }) : null,
        h('div', { style: { flex: 1 } }, h('div', { class: 'small' }, j.label), h('div', { class: 'small ' + (j.status === '실패' ? 'err' : 'muted') }, `${j.status}${j.error ? ' · ' + j.error : ''}${j.files?.length ? ` · 사진 ${j.files.filter(f => f.sent).length}/${j.files.length}` : ''}`)),
        j.status === '실패' ? h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => off.retry(j.id) }, '재시도'), h('button', { class: 'sm danger', onclick: () => { if (confirm('이 기록을 단말에서 삭제할까요? 서버로 전송되지 않습니다.')) off.removeJob(j.id); } }, '삭제'))
          : h('button', { class: 'sm', onclick: () => off.flush() }, '지금 전송'))),
      h('p', { class: 'small muted' }, '대기 중인 기록은 앱을 닫아도 이 단말에 남아 있다가, 다음에 접속하면 이어서 전송됩니다.')));
  }
  const stop = off.onChange(renderQueue);
  renderQueue(); off.flush();

  const fileItems = (files, category) => [...files].map(f => ({ name: f.name || 'photo.jpg', type: f.type, blob: f, category, sent: false }));
  const preview = (list, files) => { for (const f of files) list.appendChild(h('div', { class: 'upload-item' }, h('img', { src: URL.createObjectURL(f) }), h('div', { class: 'small' }, f.name))); };
  const done = (msg) => { toast(msg); clear(section); };

  function photoSection() {
    const cat = h('select', null, h('option', { value: 'photo' }, '일반 사진'), h('option', { value: 'photo_before' }, '작업 전'), h('option', { value: 'photo_after' }, '작업 후'));
    const chosen = []; const list = h('div');
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, onchange: (e) => { chosen.push(...e.target.files); preview(list, e.target.files); e.target.value = ''; } });
    clear(section, h('div', { class: 'box' }, h('h2', null, '사진 등록'), h('div', { class: 'field' }, '분류', cat),
      h('button', { class: 'big', style: { marginTop: '8px' }, onclick: () => input.click() }, '카메라·앨범에서 선택'), h('span', { class: 'hidden' }, input), list,
      h('button', { class: 'big primary', style: { marginTop: '8px' }, onclick: async () => {
        if (!chosen.length) return toast('사진을 선택하세요.', true);
        await off.enqueue({ type: 'photo', asset_id: a.id, label: `${a.mgmt_no} 사진 ${chosen.length}장`, files: fileItems(chosen, cat.value) });
        done('단말에 저장했습니다. 전송 상태는 위 목록에서 확인하세요.');
      } }, '저장')));
  }

  function worklogSection() {
    const f = formFields([
      { key: 'work_type', label: '작업 종류', type: 'select', options: M.WORK_TYPES, value: '점검' },
      { key: 'work_at', label: '작업일시', type: 'datetime-local', value: nowLocal() },
      { key: 'worker', label: '작업자', value: state.me.user.name }, { key: 'company', label: '업체' },
      { key: 'content', label: '작업 내용', type: 'textarea', wide: true },
      { key: 'before_value', label: '변경 전' }, { key: 'after_value', label: '변경 후' },
    ]);
    const photos = { photo_before: [], photo_after: [] };
    const pick = (cat, label) => { const list = h('div'); const i = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'hidden', onchange: (e) => { photos[cat].push(...e.target.files); preview(list, e.target.files); e.target.value = ''; } }); return h('div', null, h('button', { class: 'big', onclick: () => i.click() }, label), i, list); };
    const err = h('div', { class: 'err' });
    clear(section, h('div', { class: 'box' }, h('h2', null, '작업 이력 등록'), f.el, h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } }, pick('photo_before', '작업 전 사진'), pick('photo_after', '작업 후 사진')), err,
      h('button', { class: 'big primary', style: { marginTop: '8px' }, onclick: async () => {
        err.textContent = '';
        try {
          const v = f.values(); if (!v.content) throw new Error('작업 내용을 입력하세요.');
          await off.enqueue({ type: 'worklog', asset_id: a.id, label: `${a.mgmt_no} ${v.work_type} 이력`, payload: { ...v, submit: true }, files: [...fileItems(photos.photo_before, 'photo_before'), ...fileItems(photos.photo_after, 'photo_after')] });
          done('단말에 저장했습니다. 전송 상태는 위 목록에서 확인하세요.');
        } catch (er) { err.textContent = er.message; }
      } }, '저장')));
  }

  function measureSection() {
    const types = Object.entries(M.TEST_TYPES).filter(([, v]) => v.cats.includes(a.category));
    const f = formFields([
      { key: 'test_type', label: '시험 종류', type: 'select', options: types.map(([k, v]) => [k, v.label]) },
      { key: 'measured_at', label: '측정일시', type: 'datetime-local', value: nowLocal() },
      card.cores.length ? { key: 'core_id', label: '코어', type: 'select', options: [['', '전체'], ...card.cores.map(c => [c.id, `#${c.core_no} ${c.color || ''}`])] } : null,
      { key: 'combination', label: '측정 조합', placeholder: a.category === 'power_cable' ? 'L1-E' : '' },
      { key: 'test_voltage', label: '시험전압(V)', type: 'number', value: a.category === 'power_cable' ? 500 : '' },
      { key: 'wavelength', label: '파장(nm)', type: 'number', value: a.category === 'fiber_cable' ? 1310 : '' },
      { key: 'value', label: '측정값', type: 'number' }, { key: 'unit', label: '단위', value: a.category === 'power_cable' ? 'MΩ' : a.category === 'fiber_cable' ? 'dB' : '' },
      { key: 'instrument', label: '측정기기' }, { key: 'measurer', label: '측정자', value: state.me.user.name },
    ].filter(Boolean));
    const err = h('div', { class: 'err' });
    clear(section, h('div', { class: 'box' }, h('h2', null, '측정값 입력'), f.el, err,
      h('button', { class: 'big primary', style: { marginTop: '8px' }, onclick: async () => {
        err.textContent = '';
        try { const v = f.values(); await off.enqueue({ type: 'measurement', asset_id: a.id, label: `${a.mgmt_no} 측정 ${v.combination || ''} ${v.value}${v.unit}`, payload: { ...v, core_id: v.core_id || null } }); done('단말에 저장했습니다. 전송되면 자동 판정 결과가 표시됩니다.'); }
        catch (e) { err.textContent = e.message; }
      } }, '저장')));
  }
}
