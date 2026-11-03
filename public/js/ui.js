// 공통 UI 도우미: API 호출, 알림, 모달, 폼
export async function api(url, opt = {}) {
  const o = { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opt.body instanceof FormData) o.body = opt.body;
  else if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
  let r;
  try { r = await fetch(url, o); } catch (e) { const er = new Error('서버에 연결할 수 없습니다. 네트워크 상태를 확인하세요.'); er.network = true; throw er; }
  if (opt.raw) { if (!r.ok) { let m = '요청 실패'; try { m = (await r.json()).error; } catch { } const er = new Error(m); er.status = r.status; throw er; } return r; }
  let data = null; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) data = await r.json();
  if (!r.ok) { const er = new Error((data && data.error) || `요청 실패 (${r.status})`); er.status = r.status; er.data = data; if (r.status === 401 && !opt.noAuthRedirect) window.dispatchEvent(new Event('need-login')); throw er; }
  return data;
}
export function toast(msg, err) { const t = document.getElementById('toast'); const d = document.createElement('div'); if (err) d.className = 'e'; d.textContent = msg; t.appendChild(d); setTimeout(() => d.remove(), err ? 7000 : 3500); }
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v == null || v === false) return; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else e.setAttribute(k, v === true ? '' : v); });
  kids.flat().forEach(k => { if (k == null || k === false) return; e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k); });
  return e;
}
export function modal(title, body, buttons, opts = {}) {
  return new Promise(res => {
    const bg = h('div', { class: 'modal-bg' });
    const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); res(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    const m = h('div', { class: 'modal', style: opts.width ? { width: opts.width } : null },
      h('div', { class: 'mh' }, title, h('span', { class: 'grow' }), h('button', { onclick: () => close(null) }, '닫기')),
      h('div', { class: 'mb' }, body),
      buttons && buttons.length ? h('div', { class: 'mf' }, buttons.map(b => h('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: async () => { if (b.action) { try { const v = await b.action(); if (v === false) return; close(v === undefined ? b.value : v); } catch (e) { toast(e.message, true); } } else close(b.value); } }, b.label))) : null);
    bg.appendChild(m); document.body.appendChild(bg); document.addEventListener('keydown', onKey);
    const f = m.querySelector('input,select,textarea'); if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
    if (opts.onOpen) opts.onOpen(m, close);
  });
}
export const confirmBox = (msg, okLabel) => modal('확인', h('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '520px' } }, msg), [{ label: '취소', value: false }, { label: okLabel || '확인', value: true, primary: true }]);
// 필드 정의 배열 → 폼. fields: [{k,label,type,options,step,full,help}]
export function formGrid(fields, obj, onChange) {
  const g = h('div', { class: 'form' });
  fields.forEach(f => {
    if (f.section) { g.appendChild(h('h4', null, f.section)); return; }
    if (f.html) { g.appendChild(h('div', { class: 'full' }, f.html)); return; }
    const get = () => f.get ? f.get(obj) : obj[f.k];
    let inp; const v = get();
    if (f.type === 'select') { inp = h('select', null, (f.options || []).map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val, selected: String(v ?? '') === String(val) }, lab); })); }
    else if (f.type === 'check') inp = h('input', { type: 'checkbox', checked: !!v });
    else if (f.type === 'textarea') inp = h('textarea', { rows: f.rows || 2 }, v ?? '');
    else inp = h('input', { type: f.type || 'text', value: v ?? '', step: f.step || 'any', placeholder: f.ph || '' });
    if (f.readonly) inp.disabled = true;
    inp.addEventListener('change', () => {
      let val = f.type === 'check' ? inp.checked : inp.value;
      if (f.type === 'number') val = inp.value === '' ? null : +inp.value;
      if (f.set) f.set(obj, val); else obj[f.k] = val;
      onChange && onChange(f, val);
    });
    if (f.full) { g.appendChild(h('label', { class: 'full' }, f.label)); g.appendChild(h('div', { class: 'full' }, inp)); }
    else { g.appendChild(h('label', { title: f.help || '' }, f.label)); g.appendChild(inp); }
  });
  return g;
}
export function download(url, body, filename) {
  return api(url, { raw: true, method: body ? 'POST' : 'GET', body }).then(async r => {
    const b = await r.blob(); const cd = r.headers.get('content-disposition') || ''; const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const a = h('a', { href: URL.createObjectURL(b), download: filename || (m ? decodeURIComponent(m[1]) : 'download') }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return b;
  });
}
export async function waitJob(id, onProgress) {
  // 서버 변환 작업 상태 확인 (대기·진행·완료·실패)
  for (let i = 0; i < 1800; i++) {
    const j = await api('/api/jobs/' + id);
    onProgress && onProgress(j);
    if (j.status === '완료') return j;
    if (j.status === '실패') throw new Error(j.message || '작업 실패');
    await new Promise(r => setTimeout(r, i < 10 ? 400 : 1200));
  }
  throw new Error('작업 시간이 초과되었습니다.');
}
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
