/*
 * 이음과 문서 — 엑셀(xlsx · xlsm) 보기·셀 편집·저장 화면.
 * 읽기/쓰기: ExcelJS, 표시 형식: SSF, 수식 재계산: fast-formula-parser (모두 eum/lib, 처음 열 때 불러온다).
 */
(function () {
  'use strict';
  const { native, toast, remember, el, blobToB64, b64ToBytes } = window.EumShell;
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const CHUNK = 150;            // 한 번에 그리는 행 수
  const EPOCH = Date.UTC(1899, 11, 30);

  const S = { wb: null, ws: null, uri: null, name: '', dirty: false, edit: false, sel: null, undo: [], confirmed: false, tds: new Map(), rendered: 0, rows: 0, cols: 0, covered: null, zoom: 1 };
  let root, grid, table, tbody, fxAddr, fxInput, tabs, titleEl, modeBtn, menu;

  // ── 라이브러리 ────────────────────────────────────────────
  let libs = null;
  function loadLibs() {
    if (libs) return libs;
    const one = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' 불러오기 실패'));
      document.head.append(s);
    });
    libs = Promise.all(['eum/lib/exceljs.min.js', 'eum/lib/ssf.js', 'eum/lib/formula-parser.min.js'].map(one));
    return libs;
  }

  // ── 값·표시 ───────────────────────────────────────────────
  const colName = (c) => { let s = ''; for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
  const serial = (d) => (d.getTime() - EPOCH) / 86400000;
  const isFormula = (cell) => !!cell && cell.type === 6;

  /** 수식·서식에 넘길 원시값 */
  function plain(v) {
    if (v == null) return null;
    if (v instanceof Date) return serial(v);
    if (typeof v !== 'object') return v;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.error) return v.error;
    if ('text' in v) return plain(v.text);
    return null;
  }
  const valueOf = (cell) => (isFormula(cell) ? plain(cell.result) : plain(cell.value));

  function display(cell) {
    if (!cell) return '';
    const raw = isFormula(cell) ? cell.result : cell.value;
    if (raw == null) return '';
    if (raw instanceof Date) return SSF.format(cell.numFmt || 'yyyy-mm-dd', serial(raw));
    if (typeof raw === 'number') {
      try { return SSF.format(cell.numFmt || 'General', raw); } catch { return String(raw); }
    }
    if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
    const p = plain(raw);
    return p == null ? '' : String(p);
  }

  /** 수식 입력줄에 보일 원본 */
  function rawText(cell) {
    if (!cell || cell.value == null) return '';
    if (isFormula(cell)) return '=' + cell.formula;
    const v = cell.value;
    if (v instanceof Date) {
      const iso = v.toISOString();
      return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
    }
    return String(plain(v) ?? '');
  }

  function parseInput(text, cell) {
    const s = text.trim();
    if (s === '') return null;
    if (s[0] === '=' && s.length > 1) return { formula: s.slice(1) };
    if (/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
    if (/^-?\d+(\.\d+)?%$/.test(s)) {
      if (!cell.numFmt || cell.numFmt === 'General') cell.numFmt = '0.0%';
      return Number(s.slice(0, -1)) / 100;
    }
    const d = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    if (d) {
      if (!cell.numFmt || cell.numFmt === 'General') cell.numFmt = 'yyyy-mm-dd';
      return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
    }
    return text;
  }

  // ── 수식 재계산 ───────────────────────────────────────────
  // 값을 고친 뒤 모든 수식을 다시 계산한다. 지원하지 않는 함수는 엑셀이 저장해 둔 값을 그대로 둔다.
  function recalc() {
    const done = new Set();
    const cellAt = (sheet, row, col) => { const ws = S.wb.getWorksheet(sheet); return ws ? ws.findCell(row, col) : null; };
    const evalCell = (cell, sheet) => {
      const key = sheet + '!' + cell.address;
      if (done.has(key)) return;
      done.add(key); // 먼저 표시해 순환 참조에서 멈춘다
      try {
        let r = parser.parse(cell.formula, { sheet, row: cell.row, col: cell.col });
        if (r && typeof r === 'object') r = Array.isArray(r) ? r[0] && r[0][0] : { error: String(r) };
        cell._value.model.result = r;
      } catch { /* 미지원 함수 등 */ }
    };
    const read = (sheet, row, col) => {
      const cell = cellAt(sheet, row, col);
      if (!cell) return null;
      if (isFormula(cell)) evalCell(cell, sheet);
      return valueOf(cell);
    };
    const parser = new FormulaParser({
      onCell: ({ sheet, row, col }) => read(sheet, row, col),
      onRange: (ref) => {
        const ws = S.wb.getWorksheet(ref.sheet);
        const out = [];
        if (!ws) return out;
        const lastRow = Math.min(ref.to.row, ws.rowCount), lastCol = Math.min(ref.to.col, ws.columnCount);
        for (let r = ref.from.row; r <= lastRow; r++) {
          const line = [];
          for (let c = ref.from.col; c <= lastCol; c++) line.push(read(ref.sheet, r, c));
          out.push(line);
        }
        return out;
      },
    });
    for (const ws of S.wb.worksheets) {
      ws.eachRow((row) => row.eachCell((cell) => { if (isFormula(cell)) evalCell(cell, ws.name); }));
    }
  }

  // ── 그리기 ────────────────────────────────────────────────
  const argb = (c) => (c && c.argb ? '#' + c.argb.slice(2) : '');
  const BORDER = { thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid', thick: '3px solid', double: '3px double' };

  function cssFor(cell) {
    const st = cell.style || {};
    let css = '';
    const f = st.font;
    if (f) {
      if (f.bold) css += 'font-weight:700;';
      if (f.italic) css += 'font-style:italic;';
      if (f.underline || f.strike) css += `text-decoration:${f.underline ? 'underline ' : ''}${f.strike ? 'line-through' : ''};`;
      if (f.size) css += `font-size:${f.size}pt;`;
      if (argb(f.color)) css += `color:${argb(f.color)};`;
    }
    const fill = st.fill;
    if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && argb(fill.fgColor)) css += `background:${argb(fill.fgColor)};`;
    const a = st.alignment || {};
    const raw = isFormula(cell) ? cell.result : cell.value;
    const h = a.horizontal && a.horizontal !== 'general' ? a.horizontal : (typeof raw === 'number' || raw instanceof Date ? 'right' : '');
    if (h) css += `text-align:${h === 'centerContinuous' ? 'center' : h};`;
    if (a.vertical) css += `vertical-align:${a.vertical === 'middle' ? 'middle' : a.vertical};`;
    if (a.wrapText) css += 'white-space:pre-wrap;';
    const b = st.border;
    if (b) for (const side of ['top', 'right', 'bottom', 'left']) {
      const d = b[side];
      if (d && d.style) css += `border-${side}:${BORDER[d.style] || '1px solid'} ${argb(d.color) || '#000'};`;
    }
    return css;
  }

  function paint(td, cell) {
    td.textContent = display(cell);
    td.style.cssText = cell ? cssFor(cell) : '';
    // 엑셀처럼, 긴 글자는 오른쪽 칸이 비어 있으면 넘쳐 보이게 한다.
    if (cell && typeof cell.value === 'string' && !cell.isMerged && !(cell.alignment && cell.alignment.wrapText)) {
      const next = S.ws.findCell(cell.row, cell.col + 1);
      if (!next || next.value == null) td.style.overflow = 'visible';
    }
  }

  function appendRows() {
    const ws = S.ws;
    const end = Math.min(S.rows, S.rendered + CHUNK);
    const frag = document.createDocumentFragment();
    for (let r = S.rendered + 1; r <= end; r++) {
      const tr = document.createElement('tr');
      const row = ws.findRow(r);
      if (row && row.hidden) tr.hidden = true;
      if (row && row.height) tr.style.height = Math.round(row.height * 96 / 72) + 'px';
      tr.append(el('th', null, String(r)));
      for (let c = 1; c <= S.cols; c++) {
        if (S.covered.has(r * 16384 + c)) continue;
        const td = document.createElement('td');
        td.dataset.r = r; td.dataset.c = c;
        const span = S.spans.get(r * 16384 + c);
        if (span) { td.rowSpan = span.rows; td.colSpan = span.cols; }
        paint(td, ws.findCell(r, c));
        S.tds.set(r * 16384 + c, td);
        tr.append(td);
      }
      frag.append(tr);
    }
    tbody.append(frag);
    S.rendered = end;
  }

  function showSheet(ws) {
    S.ws = ws; S.sel = null; S.tds = new Map(); S.rendered = 0;
    S.rows = Math.max(ws.rowCount, 30) + 20;
    S.cols = Math.min(Math.max(ws.columnCount, 8) + 3, 256);
    S.covered = new Set(); S.spans = new Map();
    for (const m of Object.values(ws._merges || {})) {
      const { top, left, bottom, right } = m.model;
      S.spans.set(top * 16384 + left, { rows: bottom - top + 1, cols: right - left + 1 });
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) if (r !== top || c !== left) S.covered.add(r * 16384 + c);
    }
    table.textContent = '';
    const cg = document.createElement('colgroup');
    const head = document.createElement('tr');
    const c0 = document.createElement('col'); c0.style.width = '40px'; cg.append(c0);
    head.append(el('th'));
    let width = 40;
    for (let c = 1; c <= S.cols; c++) {
      const col = ws.getColumn(c);
      const w = col.hidden ? 0 : Math.round((col.width || ws.properties.defaultColWidth || 9) * 7.2 + 5);
      const ce = document.createElement('col'); ce.style.width = w + 'px'; cg.append(ce);
      head.append(el('th', null, colName(c)));
      width += w;
    }
    table.style.width = width + 'px';
    const thead = document.createElement('thead'); thead.append(head);
    tbody = document.createElement('tbody');
    table.append(cg, thead, tbody);
    appendRows();
    grid.scrollTo(0, 0);
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.id === String(ws.id));
    setFx();
  }

  function refreshValues() {
    for (const [key, td] of S.tds) {
      const cell = S.ws.findCell(Math.floor(key / 16384), key % 16384);
      if (isFormula(cell)) paint(td, cell);
    }
  }

  // ── 선택·편집 ─────────────────────────────────────────────
  function setFx() {
    const cell = S.sel && S.ws.findCell(S.sel.r, S.sel.c);
    fxAddr.textContent = S.sel ? colName(S.sel.c) + S.sel.r : '';
    fxInput.value = rawText(cell);
  }
  function select(r, c) {
    const old = S.sel && S.tds.get(S.sel.r * 16384 + S.sel.c);
    if (old) old.classList.remove('sel');
    const master = S.ws.findCell(r, c);
    if (master && master.isMerged) { r = master.master.row; c = master.master.col; }
    S.sel = { r, c };
    const td = S.tds.get(r * 16384 + c);
    if (td) { td.classList.add('sel'); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    setFx();
  }
  function setDirty(d) { S.dirty = d; titleEl.textContent = (d ? '● ' : '') + S.name; }

  function apply(ws, r, c, value) {
    ws.getCell(r, c).value = value;
    recalc();
    if (ws !== S.ws) showSheet(ws);
    const td = S.tds.get(r * 16384 + c);
    if (td) paint(td, ws.findCell(r, c));
    refreshValues();
    select(r, c);
    setDirty(true);
  }
  function commit() {
    if (!S.edit || !S.sel) return;
    const { r, c } = S.sel;
    const cell = S.ws.getCell(r, c);
    if (fxInput.value === rawText(cell)) return;
    S.undo.push({ ws: S.ws, r, c, value: cell.value });
    apply(S.ws, r, c, parseInput(fxInput.value, cell));
  }
  function undo() {
    const u = S.undo.pop();
    if (!u) { toast('되돌릴 내용이 없습니다.'); return; }
    apply(u.ws, u.r, u.c, u.value);
  }
  function setEdit(on) {
    S.edit = on;
    root.classList.toggle('eum-sheet-edit', on);
    fxInput.readOnly = !on;
    modeBtn.textContent = on ? '완료' : '편집';
    if (!on) fxInput.blur();
  }

  // ── 열기·저장 ─────────────────────────────────────────────
  async function open(uri, name) {
    root.hidden = false;
    root.classList.add('eum-loading');
    titleEl.textContent = name;
    try {
      await loadLibs();
      const r = await native.read({ uri });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(b64ToBytes(r.data).buffer);
      Object.assign(S, { wb, uri, name, undo: [], confirmed: false });
      tabs.textContent = '';
      const visible = wb.worksheets.filter((w) => w.state !== 'hidden' && w.state !== 'veryHidden');
      if (!visible.length) throw new Error('표시할 시트가 없습니다.');
      for (const ws of visible) {
        const b = el('button', null, ws.name);
        b.dataset.id = ws.id;
        b.onclick = () => { commit(); showSheet(ws); };
        tabs.append(b);
      }
      S.zoom = 1; table.style.zoom = 1;
      setEdit(false);
      setDirty(false);
      showSheet(visible[0]);
      remember(uri, name);
      return true;
    } catch (e) {
      close();
      toast('엑셀 파일을 열지 못했습니다: ' + (e && e.message || e));
      return false;
    } finally {
      root.classList.remove('eum-loading');
    }
  }

  async function write(uri) {
    S.wb.calcProperties.fullCalcOnLoad = true; // 엑셀에서 열 때 수식을 다시 계산하게 한다
    const buf = await S.wb.xlsx.writeBuffer();
    await native.write({ uri, data: await blobToB64(new Blob([buf])) });
  }
  async function saveAs() {
    commit();
    const suggested = S.name.replace(/\.[^.]+$/, '') + '.xlsx';
    try {
      const r = await native.pickSave({ name: suggested, mime: XLSX_MIME });
      if (!r || !r.uri) return;
      await write(r.uri);
      S.uri = r.uri;
      S.name = r.name && /\.xlsx$/i.test(r.name) ? r.name : suggested;
      S.confirmed = true;
      remember(S.uri, S.name);
      setDirty(false);
      toast('저장했습니다.');
    } catch (e) { toast('저장하지 못했습니다: ' + (e && e.message || e)); }
  }
  async function save() {
    commit();
    // 매크로 파일(xlsm)은 매크로를 보존할 수 없으므로 원본을 덮어쓰지 않는다.
    if (!/\.xlsx$/i.test(S.name)) { toast('매크로 파일은 xlsx로 따로 저장합니다.'); return saveAs(); }
    if (!S.confirmed) {
      if (!confirm('원본 파일에 덮어씁니다.\n셀 값·서식·수식은 유지되지만 차트·피벗 표·매크로는 이 앱이 다루지 못해 빠질 수 있습니다.\n\n덮어쓸까요? (취소하면 「다른 이름으로 저장」을 쓰세요)')) return;
      S.confirmed = true;
    }
    try {
      await write(S.uri);
      setDirty(false);
      toast('저장했습니다.');
    } catch (e) { toast('저장하지 못했습니다: ' + (e && e.message || e)); }
  }
  async function share() {
    if (S.dirty) { toast('먼저 저장해 주세요.'); return; }
    try { await native.share({ uri: S.uri, name: S.name }); } catch (e) { toast(String(e && e.message || e)); }
  }
  function close() {
    root.hidden = true;
    Object.assign(S, { wb: null, ws: null, dirty: false, undo: [] });
    if (table) table.textContent = '';
  }

  // ── 화면 만들기 ───────────────────────────────────────────
  function build() {
    root = el('div'); root.id = 'eum-sheet'; root.hidden = true;
    const bar = el('header', 'eum-sbar');
    const back = el('button', 'eum-ic', '‹'); back.title = '홈'; back.onclick = () => { commit(); window.EumShell.showHome(); };
    titleEl = el('span', 'eum-stitle');
    const bUndo = el('button', 'eum-ic eum-sedit', '↶'); bUndo.title = '되돌리기'; bUndo.onclick = undo;
    const bSave = el('button', 'eum-txt eum-sedit', '저장'); bSave.onclick = save;
    modeBtn = el('button', 'eum-txt eum-primary', '편집'); modeBtn.onclick = () => { commit(); setEdit(!S.edit); };
    const more = el('button', 'eum-ic', '⋮'); more.title = '더보기'; more.onclick = () => { menu.hidden = !menu.hidden; };
    bar.append(back, titleEl, bUndo, bSave, modeBtn, more);

    const fx = el('div', 'eum-fx');
    fxAddr = el('span', 'eum-fx-addr');
    fxInput = el('input'); fxInput.type = 'text'; fxInput.readOnly = true; fxInput.autocomplete = 'off';
    fxInput.placeholder = '셀을 누르면 내용이 여기에 보입니다';
    fxInput.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commit();
      if (S.sel && S.sel.r < S.rendered) select(S.sel.r + 1, S.sel.c);
    };
    const ok = el('button', 'eum-fx-ok eum-sedit', '✓'); ok.title = '입력'; ok.onclick = () => { commit(); fxInput.blur(); };
    fx.append(fxAddr, fxInput, ok);

    grid = el('div', 'eum-grid');
    table = el('table');
    grid.append(table);
    grid.onclick = (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      commit();
      select(+td.dataset.r, +td.dataset.c);
    };
    grid.ondblclick = (e) => { if (S.edit && e.target.closest('td')) fxInput.focus(); };
    grid.onscroll = () => {
      if (S.ws && S.rendered < S.rows && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 600) appendRows();
    };
    // 두 손가락 확대/축소
    let d0 = 0, z0 = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    grid.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = S.zoom; } }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      S.zoom = Math.max(0.4, Math.min(3, z0 * dist(e.touches) / d0));
      table.style.zoom = S.zoom;
    }, { passive: false });
    grid.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });

    tabs = el('div', 'eum-tabs');
    const loading = el('div', 'eum-sheet-loading', '엑셀 파일을 여는 중…');

    menu = el('div'); menu.id = 'eum-smenu'; menu.hidden = true;
    const sheet = el('div', 'eum-menu-sheet');
    for (const [label, fn] of [['다른 이름으로 저장', saveAs], ['공유', share]]) {
      const b = el('button', null, label);
      b.onclick = () => { menu.hidden = true; fn(); };
      sheet.append(b);
    }
    menu.append(sheet);
    menu.onclick = (e) => { if (e.target === menu) menu.hidden = true; };

    root.append(bar, fx, grid, tabs, loading, menu);
    document.body.append(root);
  }

  /** 뒤로 가기. 처리했으면 true */
  function back() {
    if (!S.wb || root.hidden) return false;
    if (!menu.hidden) { menu.hidden = true; return true; }
    if (document.activeElement === fxInput) { fxInput.blur(); return true; }
    if (S.edit) { commit(); setEdit(false); return true; }
    window.EumShell.showHome();
    return true;
  }

  build();
  window.EumSheet = {
    open, back, close,
    isOpen: () => !!S.wb,
    name: () => S.name,
    isDirty: () => S.dirty,
    show: () => { root.hidden = false; },
  };
})();
