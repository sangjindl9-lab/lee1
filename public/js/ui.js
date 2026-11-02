// 공통 화면 도구
export const state = { me: null, meta: null, site: null, sites: [] };

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el, ...children) => { el.innerHTML = ''; append(el, children); return el; };

export class ApiError extends Error { constructor(status, msg, body) { super(msg); this.status = status; this.body = body; } }

export async function api(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, init); } catch (e) { throw new ApiError(0, '서버에 연결할 수 없습니다. 통신 상태를 확인하세요.'); }
  if (res.status === 401 && !opts.noRedirect) { location.hash = '#/login?next=' + encodeURIComponent(location.hash.slice(1)); throw new ApiError(401, '로그인이 필요합니다.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error || `요청 실패 (${res.status})`, data);
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b) => api('POST', u, b);
export const PUT = (u, b) => api('PUT', u, b);
export const DEL = (u) => api('DELETE', u);

export function toast(msg, bad) {
  const t = h('div', { class: bad ? 'bad' : '' }, msg);
  document.getElementById('toast').appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3000);
}

export function modal(title, body, { buttons = [], size = '' } = {}) {
  return new Promise(resolve => {
    const err = h('div', { class: 'err' });
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    const foot = h('div', { class: 'modal-f' }, err, h('div', { style: { flex: 1 } }),
      ...buttons.map(b => h('button', {
        class: b.primary ? 'primary' : b.danger ? 'danger' : '',
        onclick: async (ev) => {
          if (!b.action) return close(b.value ?? null);
          ev.target.disabled = true; err.textContent = '';
          try { const v = await b.action(); if (v !== false) close(v ?? true); } catch (e) { err.textContent = e.message; } finally { ev.target.disabled = false; }
        },
      }, b.label)),
      h('button', { onclick: () => close(null) }, '닫기'));
    const bg = h('div', { class: 'modal-bg', onmousedown: (e) => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal ' + size }, h('div', { class: 'modal-h' }, h('h2', null, title)), h('div', { class: 'modal-b' }, body), foot));
    document.body.appendChild(bg);
    const first = bg.querySelector('input:not([type=hidden]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmBox(msg, label = '확인') {
  return modal('확인', h('div', { style: { whiteSpace: 'pre-wrap' } }, msg), { size: 'narrow', buttons: [{ label, primary: true, value: true }] });
}

export async function promptBox(title, fields) {
  const f = formFields(fields);
  return modal(title, f.el, { size: 'narrow', buttons: [{ label: '확인', primary: true, action: () => f.values() }] });
}

// 필드 정의: {key, label, type, options, value, required, wide, step, placeholder}
export function formFields(defs, values = {}) {
  const inputs = {};
  const el = h('div', { class: 'form' });
  for (const d of defs) {
    if (d.group) { el.appendChild(h('div', { class: 'group-title' }, d.group)); continue; }
    let input;
    const v = values[d.key] ?? d.value ?? '';
    if (d.type === 'select') {
      input = h('select', { name: d.key }, ...(d.options || []).map(o => {
        const [val, lab] = Array.isArray(o) ? o : [o, o === '' ? '선택' : o];
        return h('option', { value: val, selected: String(val) === String(v) }, lab);
      }));
    } else if (d.type === 'textarea') input = h('textarea', { name: d.key, placeholder: d.placeholder || '' }, v);
    else if (d.type === 'checkbox') input = h('input', { type: 'checkbox', name: d.key, checked: !!v });
    else if (d.type === 'file') input = h('input', { type: 'file', name: d.key, multiple: d.multiple, accept: d.accept, capture: d.capture });
    else input = h('input', { type: d.type || 'text', name: d.key, value: v, step: d.step || (d.type === 'number' ? 'any' : null), placeholder: d.placeholder || '' });
    if (d.readonly) input.disabled = true;
    inputs[d.key] = input;
    const lab = h('label', { class: d.wide ? 'wide' : '' }, h('span', { class: d.required ? 'req' : '' }, d.label), input);
    if (d.type === 'checkbox') { lab.style.flexDirection = 'row'; lab.style.alignItems = 'center'; lab.style.gap = '6px'; lab.insertBefore(input, lab.firstChild); }
    if (d.help) lab.appendChild(h('span', { class: 'muted small' }, d.help));
    el.appendChild(lab);
  }
  return {
    el, inputs,
    values() {
      const out = {};
      for (const d of defs) {
        if (d.group) continue;
        const i = inputs[d.key];
        if (d.type === 'checkbox') out[d.key] = i.checked;
        else if (d.type === 'file') out[d.key] = i.files;
        else out[d.key] = i.value.trim();
        if (d.required && !out[d.key]) throw new Error(`${d.label}을(를) 입력하세요.`);
      }
      return out;
    },
  };
}

export const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function resultTag(r) {
  if (!r) return h('span', { class: 'muted small' }, '미측정');
  const cls = r === '적합' ? 'ok' : r === '부적합' ? 'bad' : 'warn';
  return h('span', { class: 'tag ' + cls }, r);
}
export function reviewTag(r) {
  const cls = { '승인': 'ok', '확정': 'ok', '반려': 'bad', '재시험 필요': 'bad', '검토 요청': 'info', '검토 대기': 'gray', '작성': 'gray' }[r] || 'gray';
  return h('span', { class: 'tag ' + cls }, r);
}
export function statusTag(s) {
  const cls = { '사용 중': 'info', '시험 완료': 'ok', '시공 완료': 'ok', '철거': 'gray', '설계': 'gray', '시공 중': 'warn' }[s] || 'gray';
  return h('span', { class: 'tag ' + cls }, s);
}
export const catLabel = (c) => state.meta?.CATEGORIES[c]?.label || c;
export const perm = (k) => !!state.site?.perm?.[k];

// 표 생성: cols [{label, get(row)->node|string, cls}]
export function table(cols, rows, { onRow, rowClass, empty = '자료가 없습니다.' } = {}) {
  const tbody = h('tbody');
  if (!rows.length) tbody.appendChild(h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, empty)));
  for (const r of rows) {
    const tr = h('tr', { class: [onRow ? 'clickable' : '', rowClass ? rowClass(r) : ''].join(' ') }, ...cols.map(c => {
      const v = c.get(r);
      return h('td', { class: c.cls || '' }, v === null || v === undefined || v === '' ? '' : v);
    }));
    if (onRow) tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,input,select')) onRow(r, tr); });
    tbody.appendChild(tr);
  }
  return h('table', { class: 't' }, h('thead', null, h('tr', null, ...cols.map(c => h('th', null, c.label)))), tbody);
}

export function download(url) {
  const a = h('a', { href: url, target: '_blank', rel: 'noopener' });
  document.body.appendChild(a); a.click(); a.remove();
}

export function siteUrl(path) { return `#/s/${state.site.id}/${path}`; }
