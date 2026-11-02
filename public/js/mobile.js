// 모바일 QR 화면: 이력 확인 · 사진 촬영 등록 · 작업 이력 · 측정값 입력
import { h, clear, state, GET, POST, api, toast, formFields, fmt, nowLocal, resultTag, reviewTag, statusTag, catLabel } from './ui.js';
import { renderCard } from './card.js';

export async function mobileAsset(main, id) {
  let card;
  try { card = await GET(`/api/assets/${id}`); } catch (e) { clear(main, h('div', { class: 'box err' }, e.message)); return; }
  state.site = state.me.sites.find(s => s.id === card.asset.site_id);
  const a = card.asset; const p = card.perm || {};
  const M = state.meta;
  const latest = card.measurements.filter(m => !m.superseded_by).slice(0, 3);
  const section = h('div');

  const btn = (label, fn, primary) => h('button', { class: 'big' + (primary ? ' primary' : ''), onclick: fn }, label);
  clear(main,
    a.is_demo ? h('div', { class: 'demo-flag' }, '시연용 데이터') : null,
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
    h('div', { class: 'box' }, h('b', null, '전체 이력 카드'), h('div', { id: 'mcard', style: { marginTop: '8px' } })));
  renderCard(main.querySelector('#mcard'), id, { compact: false });

  // 업로드 대기열: 실패 시 표시하고 재시도
  function uploader(ownerType, ownerIdFn, category) {
    const list = h('div');
    const items = [];
    async function send(it) {
      it.st.textContent = '올리는 중…'; it.st.className = 'st small'; it.retry.classList.add('hidden');
      try {
        const fd = new FormData();
        fd.append('owner_type', ownerType); fd.append('owner_id', await ownerIdFn()); fd.append('category', it.cat()); fd.append('files', it.file);
        await api('POST', '/api/files', fd);
        it.st.textContent = '저장됨'; it.done = true; it.st.className = 'st small'; it.st.style.color = 'var(--ok)';
      } catch (e) {
        it.st.textContent = '저장 실패: ' + e.message; it.st.className = 'st small err'; it.retry.classList.remove('hidden');
      }
    }
    function add(files) {
      for (const file of files) {
        const it = { file, cat: category, st: h('span', { class: 'st small' }, '대기'), retry: h('button', { class: 'sm hidden' }, '재시도') };
        it.retry.onclick = () => send(it);
        const url = URL.createObjectURL(file);
        list.appendChild(h('div', { class: 'upload-item' }, h('img', { src: url }), h('div', { style: { flex: 1 } }, h('div', { class: 'small' }, file.name), it.st), it.retry));
        items.push(it);
      }
    }
    return { list, add, items, sendAll: async () => { for (const it of items) if (!it.done) await send(it); return items.every(i => i.done); } };
  }

  function photoSection() {
    const cat = h('select', null, h('option', { value: 'photo' }, '일반 사진'), h('option', { value: 'photo_before' }, '작업 전'), h('option', { value: 'photo_after' }, '작업 후'));
    const up = uploader('asset', () => a.id, () => cat.value);
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, onchange: (e) => { up.add(e.target.files); e.target.value = ''; } });
    clear(section, h('div', { class: 'box' }, h('h2', null, '사진 등록'), h('div', { class: 'field' }, '분류', cat),
      h('button', { class: 'big', style: { marginTop: '8px' }, onclick: () => input.click() }, '카메라·앨범에서 선택'), h('span', { class: 'hidden' }, input), up.list,
      h('button', { class: 'big primary', style: { marginTop: '8px' }, onclick: async () => { if (!up.items.length) return toast('사진을 선택하세요.', true); const ok = await up.sendAll(); toast(ok ? '모든 사진을 저장했습니다.' : '일부 사진 저장에 실패했습니다. 재시도하세요.', !ok); } }, '저장')));
  }

  function worklogSection() {
    const f = formFields([
      { key: 'work_type', label: '작업 종류', type: 'select', options: M.WORK_TYPES, value: '점검' },
      { key: 'work_at', label: '작업일시', type: 'datetime-local', value: nowLocal() },
      { key: 'worker', label: '작업자', value: state.me.user.name }, { key: 'company', label: '업체' },
      { key: 'content', label: '작업 내용', type: 'textarea', wide: true },
      { key: 'before_value', label: '변경 전' }, { key: 'after_value', label: '변경 후' },
    ]);
    let wlId = null;
    const before = uploader('worklog', () => wlId, () => 'photo_before');
    const after = uploader('worklog', () => wlId, () => 'photo_after');
    const pick = (u, label) => { const i = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'hidden', onchange: (e) => { u.add(e.target.files); e.target.value = ''; } }); return h('div', null, h('button', { class: 'big', onclick: () => i.click() }, label), i, u.list); };
    const err = h('div', { class: 'err' });
    clear(section, h('div', { class: 'box' }, h('h2', null, '작업 이력 등록'), f.el, h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } }, pick(before, '작업 전 사진'), pick(after, '작업 후 사진')), err,
      h('button', { class: 'big primary', style: { marginTop: '8px' }, onclick: async (e) => {
        err.textContent = ''; e.target.disabled = true;
        try {
          const v = f.values(); if (!v.content) throw new Error('작업 내용을 입력하세요.');
          if (!wlId) wlId = (await POST(`/api/assets/${a.id}/worklogs`, { ...v, submit: true })).id;
          const ok = (await before.sendAll()) & (await after.sendAll());
          if (ok) { toast('작업 이력을 저장했습니다.'); mobileAsset(main, id); }
          else err.textContent = '이력은 저장되었지만 일부 사진 저장에 실패했습니다. 각 사진의 재시도를 누르세요.';
        } catch (er) { err.textContent = '저장 실패: ' + er.message + ' — 다시 시도하세요.'; } finally { e.target.disabled = false; }
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
        try { const r = await POST(`/api/assets/${a.id}/measurements`, { ...f.values(), core_id: f.values().core_id || null }); toast(`저장 · 자동 판정: ${r.results[0].auto_result}`); mobileAsset(main, id); }
        catch (e) { err.textContent = '저장 실패: ' + e.message + ' — 입력값은 그대로 있으니 다시 저장하세요.'; }
      } }, '저장')));
  }
}
