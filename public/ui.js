// 공통 화면 도구 (직원 화면·서명 화면이 같이 쓴다)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n == null || n === '' ? '-' : Number(n).toLocaleString('ko-KR') + '원');
const dt = (s) => { if (!s) return '-'; const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }); };
const badge = (st, label) => `<span class="badge b-${esc(st)}">${esc(label || st)}</span>`;

async function api(path, { method = 'GET', body, base = '/api' } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-ieum': '1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((data && data.error) || `오류 (${r.status})`); e.status = r.status; e.data = data; throw e; }
  return data;
}
function toast(msg, bad = false) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 5000 : 2600);
}
async function guard(fn) { try { return await fn(); } catch (e) { toast(e.message, true); throw e; } }

// 대화상자: html 본문, 버튼 [{label, cls, value}] → 누른 버튼 value (닫으면 null). onOpen(dlg) 로 내부 위젯 연결
function dialog(title, html, buttons = [{ label: '확인', cls: 'primary', value: true }], onOpen) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<div class="dh">${esc(title)}</div><div class="db">${html}</div><div class="df">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}<button class="btn ghost" data-i="x">닫기</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { d.remove(); });
    d.querySelectorAll('.df button').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.i === 'x') { d.close(); return resolve(null); }
      const btn = buttons[b.dataset.i];
      if (btn.check) { try { if (await btn.check(d) === false) return; } catch (e) { toast(e.message, true); return; } }
      d.close(); resolve(typeof btn.value === 'function' ? btn.value(d) : btn.value);
    }));
    d.showModal();
    if (onOpen) onOpen(d);
  });
}
const confirmDlg = (title, msg, label = '확인', cls = 'primary') => dialog(title, `<p style="margin:0">${msg}</p>`, [{ label, cls, value: true }]);

function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
// 사진은 올리기 전에 긴 변 2000px 로 줄인다 (원본 비율 유지)
async function shrinkImage(file, max = 2000) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return fileToDataUrl(file);
  const url = await fileToDataUrl(file);
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1 && file.size < 1.5e6) return url;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

// 서명 패드: 그린 영역만 잘라 투명 PNG 로 돌려준다
function signPad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  function fit() { const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; dirty = false; }
  fit();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); try { canvas.setPointerCapture(e.pointerId); } catch { /* 일부 기기 */ } });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; dirty = true; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    empty: () => !dirty,
    png() {
      const { width: w, height: h } = canvas; const d = ctx.getImageData(0, 0, w, h).data;
      let t = h, b = 0, l = w, rr = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (y < t) t = y; if (y > b) b = y; if (x < l) l = x; if (x > rr) rr = x; }
      if (b < t) return null;
      const pad = 8, o = document.createElement('canvas'); o.width = rr - l + pad * 2; o.height = b - t + pad * 2;
      o.getContext('2d').drawImage(canvas, l, t, rr - l + 1, b - t + 1, pad, pad, rr - l + 1, b - t + 1);
      // 너무 크면 줄인다 (서버 300KB 제한)
      if (o.width > 800) { const s = document.createElement('canvas'); const k = 800 / o.width; s.width = 800; s.height = Math.round(o.height * k); s.getContext('2d').drawImage(o, 0, 0, s.width, s.height); return s.toDataURL('image/png'); }
      return o.toDataURL('image/png');
    },
  };
}

// 입력 항목 하나를 그린다
function fieldInput(f, value, name = 'v_' + f.key) {
  const req = f.required ? ' required' : '';
  const v = value ?? '';
  if (f.type === 'textarea') return `<textarea class="inp" name="${name}"${req}>${esc(v)}</textarea>`;
  if (f.type === 'check') return `<label class="chk"><input type="checkbox" name="${name}"${v === true ? ' checked' : ''}> ${esc(f.label)}</label>`;
  const type = { number: 'text', date: 'date', email: 'email', phone: 'tel' }[f.type] || 'text';
  const extra = f.type === 'number' ? ' inputmode="numeric"' : f.type === 'phone' ? ' placeholder="010-0000-0000"' : '';
  return `<input class="inp" type="${type}" name="${name}" value="${esc(v)}"${req}${extra}>`;
}
function fieldBlock(f, value, name) {
  if (f.type === 'check') return `<div class="f" style="margin-bottom:10px">${fieldInput(f, value, name)}${f.required ? ' <span class="small" style="color:var(--bad)">필수</span>' : ''}</div>`;
  return `<label class="f"><span>${esc(f.label)}${f.required ? ' <i>*</i>' : ''}${f.pii ? ' · 개인정보' : ''}</span>${fieldInput(f, value, name)}</label>`;
}
function readFields(root, fields, prefix = 'v_') {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`[name="${prefix}${f.key}"]`); if (!el) continue;
    out[f.key] = f.type === 'check' ? el.checked : el.value.trim();
  }
  return out;
}
// 본문의 {{항목}} 을 값으로 바꿔 보여 준다 (미입력은 밑줄)
function renderBody(body, vals) {
  return esc(body).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vals[k];
    if (v == null || v === '') return '<u style="color:var(--faint)">          </u>';
    if (v === true) return '<b>예(확인함)</b>'; if (v === false) return '아니오';
    return `<b>${esc(typeof v === 'number' ? v.toLocaleString('ko-KR') : v)}</b>`;
  }).replace(/^##\s*(.*)$/gm, '<strong style="display:block;margin-top:10px">$1</strong>');
}
