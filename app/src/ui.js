// 작은 화면 부품: 토스트, 아래 메뉴, 입력 대화상자.
export const $ = (id) => document.getElementById(id);
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** 아래에서 올라오는 메뉴. items: [{ label, icon, danger, onClick }] 또는 '-'(구분선) */
export function menu(items, title) {
  return new Promise((resolve) => {
    const back = el('div', 'backdrop');
    const sheet = el('div', 'sheet');
    if (title) sheet.appendChild(el('div', 'sheet-title', title));
    for (const it of items) {
      if (it === '-') { sheet.appendChild(el('div', 'sheet-sep')); continue; }
      const b = el('button', 'sheet-item' + (it.danger ? ' danger' : ''));
      if (it.icon) { const ic = el('span', 'sheet-icon'); ic.innerHTML = it.icon; b.appendChild(ic); }
      b.appendChild(el('span', null, it.label));
      b.onclick = () => { close(); resolve(it); if (it.onClick) it.onClick(); };
      sheet.appendChild(b);
    }
    const cancel = el('button', 'sheet-item sheet-cancel', '취소');
    cancel.onclick = () => { close(); resolve(null); };
    sheet.appendChild(cancel);
    back.appendChild(sheet);
    back.onclick = (e) => { if (e.target === back) { close(); resolve(null); } };
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    function close() { back.classList.remove('show'); setTimeout(() => back.remove(), 180); }
  });
}

/**
 * 입력 대화상자. fields: [{ name, label, value, type: 'text'|'textarea'|'number'|'select'|'color', options, placeholder }]
 * 확인하면 { name: value } 를, 취소하면 null 을 돌려준다.
 */
export function ask(title, fields, okLabel = '확인') {
  return new Promise((resolve) => {
    const back = el('div', 'backdrop center');
    const box = el('div', 'dialog');
    box.appendChild(el('div', 'dialog-title', title));
    const inputs = {};
    let first = null;
    for (const f of fields) {
      const row = el('label', 'dialog-row');
      if (f.label) row.appendChild(el('span', 'dialog-label', f.label));
      let inp;
      if (f.type === 'textarea') { inp = el('textarea'); inp.rows = 3; }
      else if (f.type === 'select') {
        inp = el('select');
        for (const o of f.options) {
          const opt = el('option', null, typeof o === 'string' ? o : o.label);
          opt.value = typeof o === 'string' ? o : o.value;
          inp.appendChild(opt);
        }
      } else { inp = el('input'); inp.type = f.type || 'text'; if (f.step) inp.step = f.step; }
      if (f.value != null) inp.value = f.value;
      if (f.placeholder) inp.placeholder = f.placeholder;
      inputs[f.name] = inp;
      row.appendChild(inp);
      box.appendChild(row);
      first = first || inp;
    }
    const btns = el('div', 'dialog-btns');
    const c = el('button', 'btn', '취소');
    const ok = el('button', 'btn primary', okLabel);
    c.onclick = () => { back.remove(); resolve(null); };
    ok.onclick = () => {
      const out = {};
      for (const k in inputs) out[k] = inputs[k].type === 'number' ? Number(inputs[k].value) : inputs[k].value;
      back.remove();
      resolve(out);
    };
    btns.append(c, ok);
    box.appendChild(btns);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') ok.click(); });
    back.appendChild(box);
    document.body.appendChild(back);
    requestAnimationFrame(() => { back.classList.add('show'); if (first) first.focus(); });
  });
}

export async function confirmBox(msg, okLabel = '확인') {
  return (await ask(msg, [], okLabel)) != null;
}

/** 길이 표시: mm 단위 값을 보기 좋게 */
export function fmtLen(mm) {
  if (!isFinite(mm)) return '-';
  if (Math.abs(mm) >= 1000) return (mm / 1000).toFixed(2) + ' m';
  return mm.toFixed(mm < 10 ? 2 : 1) + ' mm';
}
export function fmtArea(mm2) {
  if (!isFinite(mm2)) return '-';
  if (Math.abs(mm2) >= 1e6) return (mm2 / 1e6).toFixed(2) + ' ㎡';
  return mm2.toFixed(0) + ' ㎟';
}
