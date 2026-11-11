/*
 * 이음과 문서 — 엑셀(xlsx · xlsm) 보기·셀 편집·저장 화면.
 * 읽기/쓰기: ExcelJS, 표시 형식: SSF, 수식 재계산: fast-formula-parser (모두 eum/lib, 처음 열 때 불러온다).
 */
(function () {
  'use strict';
  const { native, toast, remember, el, blobToB64, b64ToBytes, progressBox } = window.EumShell;
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const CHUNK = 150;            // 한 번에 그리는 행 수
  const EPOCH = Date.UTC(1899, 11, 30);

  const S = { wb: null, ws: null, uri: null, name: '', dirty: false, edit: false, sel: null, undo: [], confirmed: false, tds: new Map(), rendered: 0, rows: 0, cols: 0, covered: null, zoom: 1, shapes: [], keep: null };
  let root, grid, wrap, table, tbody, fxAddr, fxInput, tabs, titleEl, modeBtn, menu, loading, layer;

  // ── 라이브러리 ────────────────────────────────────────────
  let libs = null;
  function loadLibs() {
    if (libs) return libs;
    const one = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' 불러오기 실패'));
      document.head.append(s);
    });
    libs = Promise.all(['eum/lib/exceljs.min.js', 'eum/lib/ssf.js', 'eum/lib/formula-parser.min.js', 'eum/lib/jszip.min.js'].map(one));
    return libs;
  }

  // ── 이름 정의·외부 연결 보존 ───────────────────────────────
  // 옛 내역서에는 이름 정의가 수천 개 들어 있는 경우가 있고, ExcelJS 는 이를 읽다가 메모리를 다 써 앱이 죽는다.
  // 그래서 열 때는 workbook.xml 에서 <definedNames>·<externalReferences> 를 떼어 두고, 저장할 때 원본 그대로 다시 붙인다.
  const NAMES_RE = /<definedNames>[\s\S]*?<\/definedNames>/;
  const EXTREF_RE = /<externalReferences>[\s\S]*?<\/externalReferences>/;
  const WB_XML = 'xl/workbook.xml', WB_RELS = 'xl/_rels/workbook.xml.rels', CTYPES = '[Content_Types].xml';

  const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  /** <x:workbook xmlns:x=…> 처럼 접두어를 붙여 쓴 XML 을 ExcelJS 가 읽는 기본 네임스페이스 형태로 바꾼다. 바뀐 게 없으면 null */
  function unprefix(xml) {
    const m = xml.match(new RegExp(`xmlns:([A-Za-z_]\\w*)="${MAIN_NS}"`));
    if (!m || xml.includes(`xmlns="${MAIN_NS}"`)) return null;
    const p = m[1];
    return xml.replace(m[0], `xmlns="${MAIN_NS}"`).replace(new RegExp(`<(/?)${p}:`, 'g'), '<$1');
  }

  /** workbook.xml 의 <sheet> 이름을 순서대로 */
  // (원본과 ExcelJS 가 &amp;·&apos; 등을 다르게 이스케이프할 수 있어 풀어서 비교한다)
  const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (m, k, d) => d ? String.fromCharCode(+d) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k]);
  const sheetNames = (xml) => [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => unescapeXml(m[1]));

  /** 시트 이름 → 시트 부품 경로 (workbook.xml 과 그 rels 로) */
  async function sheetPaths(zip, xml) {
    const rels = await zip.file(WB_RELS).async('string');
    const target = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && t) target[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    }
    const out = {};
    for (const m of xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)) out[unescapeXml(m[1])] = target[m[2]];
    return out;
  }
  const relsOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');
  const DRAW_DIRS = ['xl/drawings/', 'xl/charts/', 'xl/media/', 'xl/embeddings/'];

  /** 떼어 낸 부분을 S.keep 에 두고, 가벼워진 파일 바이트를 돌려준다 */
  async function detach(bytes) {
    S.keep = null;
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file(WB_XML)) throw new Error('지원하지 않는 엑셀 파일 구조입니다.');
    let xml = await zip.file(WB_XML).async('string');
    // 일부 생성 도구가 만든 파일(접두어 네임스페이스)은 그대로 읽으면 "reading 'sheets'" 오류가 난다
    // 같은 도구는 시트 관계(rels)의 Target 도 "/xl/…" 절대 경로로 쓰는데, ExcelJS 는 "../…" 상대 경로만 알아본다.
    // workbook.xml 이 접두어형일 때만 나머지 xml 도 검사한다(큰 시트 xml 을 괜히 문자열로 읽지 않게).
    const prefixed = unprefix(xml);
    let fixed = prefixed != null;
    if (fixed) xml = prefixed;
    for (const p of Object.keys(zip.files)) {
      if (zip.files[p].dir || p === WB_XML || !p.startsWith('xl/') || p.startsWith('xl/externalLinks/')) continue;
      let u = null;
      if (p.startsWith('xl/worksheets/_rels/')) {
        const s = await zip.file(p).async('string');
        if (s.includes('Target="/xl/')) u = s.replace(/Target="\/xl\//g, 'Target="../');
      } else if (prefixed != null && p.endsWith('.xml')) u = unprefix(await zip.file(p).async('string'));
      if (u == null) continue;
      fixed = true;
      zip.file(p, u);
    }
    // 그림·도형·차트: ExcelJS 는 이해하지 못해 저장할 때 버리므로, 시트에서 떼어 두고 저장할 때 원본 그대로 붙인다.
    const drawings = {};
    for (const [name, part] of Object.entries(await sheetPaths(zip, xml))) {
      const relsFile = zip.file(relsOf(part));
      if (!relsFile) continue;
      const rels = await relsFile.async('string');
      const rel = (rels.match(/<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*\/>/) || [])[0];
      if (!rel) continue;
      const id = rel.match(/\bId="([^"]+)"/)[1], t = rel.match(/\bTarget="([^"]+)"/)[1];
      const path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\.\//, '');
      if (!zip.file(path)) continue;
      const drels = zip.file(relsOf(path));
      drawings[name] = { path, xml: await zip.file(path).async('string'), rels: drels ? await drels.async('string') : '' };
      zip.file(relsOf(part), rels.replace(rel, ''));
      zip.file(part, (await zip.file(part).async('string')).replace(new RegExp(`<drawing\\b[^>]*r:id="${id}"[^>]*/>`), ''));
      fixed = true;
    }
    const names = (xml.match(NAMES_RE) || [''])[0], extRefs = (xml.match(EXTREF_RE) || [''])[0];
    const keep = { names, extRefs, drawings, sheetNames: sheetNames(xml), parts: {}, rels: '', types: '' };
    const hasDraw = Object.keys(drawings).length > 0;
    if (extRefs || hasDraw) {
      keep.rels = await zip.file(WB_RELS).async('string');
      keep.types = await zip.file(CTYPES).async('string');
      for (const p of Object.keys(zip.files)) {
        if (zip.files[p].dir) continue;
        if (p.startsWith('xl/externalLinks/') || (hasDraw && DRAW_DIRS.some((d) => p.startsWith(d)))) keep.parts[p] = await zip.file(p).async('uint8array');
      }
      // 그림(media)을 남겨 두면 ExcelJS 가 자기 식으로 다시 써서 겹치므로 통째로 뺀다
      for (const p of Object.keys(keep.parts)) if (!p.startsWith('xl/externalLinks/')) zip.remove(p);
    }
    if (names || extRefs || hasDraw) S.keep = keep;
    if (!fixed && !names && !extRefs) return bytes;
    zip.file(WB_XML, xml.replace(NAMES_RE, '').replace(EXTREF_RE, ''));
    return zip.generateAsync({ type: 'uint8array' });
  }

  /** ExcelJS 가 쓴 파일에 떼어 둔 이름 정의·외부 연결·그림을 되돌린다 */
  async function reattach(buf) {
    const keep = S.keep;
    if (!keep) return buf;
    const zip = await JSZip.loadAsync(buf);
    let xml = (await zip.file(WB_XML).async('string')).replace(NAMES_RE, '').replace(EXTREF_RE, '');
    let extRefs = keep.extRefs;
    let types = await zip.file(CTYPES).async('string'), addT = '';
    for (const [p, data] of Object.entries(keep.parts)) zip.file(p, data);
    if (extRefs) {
      // 외부 연결 부품과 관계(rels)·콘텐츠 형식을 되살린다. 관계 ID 는 ExcelJS 가 쓴 것과 겹치지 않게 새로 붙인다.
      const relRe = /<Relationship\b[^>]*Target="[^"]*externalLinks\/[^"]*"[^>]*\/>/g;
      let rels = await zip.file(WB_RELS).async('string'), add = '', n = 0;
      for (const rel of keep.rels.match(relRe) || []) {
        const oldId = (rel.match(/\bId="([^"]+)"/) || [])[1];
        const newId = 'rIdExt' + (++n);
        add += rel.replace(/\bId="[^"]+"/, `Id="${newId}"`);
        extRefs = extRefs.replace(new RegExp(`r:id="${oldId}"`, 'g'), `r:id="${newId}"`);
      }
      zip.file(WB_RELS, rels.replace('</Relationships>', add + '</Relationships>'));
    }
    const paths = await sheetPaths(zip, xml);
    for (const [name, d] of Object.entries(keep.drawings)) {
      const part = paths[name];
      if (!part) continue;
      zip.file(d.path, d.xml);
      if (d.rels) zip.file(relsOf(d.path), d.rels);
      const relsPath = relsOf(part), relsFile = zip.file(relsPath);
      const rels = relsFile ? await relsFile.async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      const target = '../' + d.path.replace(/^xl\//, '');
      zip.file(relsPath, rels.replace('</Relationships>', `<Relationship Id="rIdDrw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${target}"/></Relationships>`));
      // 스키마 순서: … pageSetup → headerFooter → drawing → legacyDrawing → tableParts → extLst
      let sx = await zip.file(part).async('string');
      const at = sx.search(/<legacyDrawing\b|<legacyDrawingHF\b|<picture\b|<oleObjects\b|<controls\b|<webPublishItems\b|<tableParts\b|<extLst\b|<\/worksheet>/);
      sx = sx.slice(0, at) + '<drawing r:id="rIdDrw"/>' + sx.slice(at);
      if (!sx.includes('xmlns:r=')) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
      zip.file(part, sx);
    }
    // 콘텐츠 형식: 되살린 부품의 Override 와 그림 확장자 Default 를 원본에서 가져온다
    for (const ov of keep.types.match(/<Override\b[^>]*PartName="\/xl\/(externalLinks|drawings|charts|media|embeddings)\/[^"]*"[^>]*\/>/g) || []) if (!types.includes(ov)) addT += ov;
    for (const df of keep.types.match(/<Default\b[^>]*\/>/g) || []) {
      const ext = (df.match(/Extension="([^"]+)"/) || [])[1];
      if (ext && !new RegExp(`Extension="${ext}"`, 'i').test(types)) addT += df;
    }
    if (addT) zip.file(CTYPES, types.replace('</Types>', addT + '</Types>'));
    // ExcelJS 는 차트시트·매크로시트를 버리므로 시트 순서가 바뀌면 localSheetId(시트 인덱스)를 이름 기준으로 다시 매긴다
    let names = keep.names;
    const now = sheetNames(xml);
    if (now.join('\n') !== keep.sheetNames.join('\n')) {
      names = names.replace(/<definedName\b[^>]*?\blocalSheetId="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/definedName>)/g, (m, i) => {
        const j = now.indexOf(keep.sheetNames[i]);
        return j < 0 ? '' : m.replace(`localSheetId="${i}"`, `localSheetId="${j}"`);
      });
    }
    // 스키마 순서: sheets → externalReferences → definedNames → calcPr
    const at = xml.search(/<calcPr\b|<\/workbook>/);
    xml = xml.slice(0, at) + extRefs + names + xml.slice(at);
    zip.file(WB_XML, xml);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
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

  // ── 그림·도형 표시 ────────────────────────────────────────
  // 떼어 둔 drawing XML 의 앵커(시작 셀 + EMU 오프셋 + 크기)를 읽어 격자 위에 겹쳐 놓는다. 글 상자·사각형·그림은
  // 모양대로, 차트는 자리만 표시한다. 편집은 지원하지 않는다(저장 때 원본 그대로 보존).
  const PX = 9525; // 1px = 9525 EMU
  // 생성 도구에 따라 xdr:·a: 접두어를 쓰기도, 기본 네임스페이스로 쓰기도 하므로 네임스페이스로 찾는다
  const NS = { xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' };
  const q = (node, tag) => { const [ns, name] = tag.split(':'); return node.getElementsByTagNameNS(NS[ns], name)[0]; };
  const all = (node, tag) => { const [ns, name] = tag.split(':'); return [...node.getElementsByTagNameNS(NS[ns], name)]; };
  const color = (node) => { const c = node && q(node, 'a:srgbClr'); return c ? '#' + c.getAttribute('val') : ''; };

  function loadShapes(sheetName) {
    layer.textContent = '';
    S.shapes = [];
    const d = S.keep && S.keep.drawings[sheetName];
    if (!d) return;
    const doc = new DOMParser().parseFromString(d.xml, 'text/xml');
    const media = {};
    for (const m of d.rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && t) media[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\.\//, '');
    }
    for (const a of doc.documentElement.children) {
      if (!/Anchor$/.test(a.localName)) continue;
      const from = q(a, 'xdr:from');
      if (!from) continue;
      const body = [...a.children].find((n) => ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(n.localName));
      if (!body || body.localName === 'cxnSp') continue;
      const xfrm = q(body, 'a:xfrm'), ext = (xfrm && q(xfrm, 'a:ext')) || q(a, 'xdr:ext');
      const box = el('div', 'eum-shape');
      let w = ext ? +ext.getAttribute('cx') / PX : 0, h = ext ? +ext.getAttribute('cy') / PX : 0;
      if (body.localName === 'pic') {
        const blip = q(body, 'a:blip'), path = blip && media[blip.getAttributeNS(NS.r, 'embed')];
        const bytes = path && S.keep.parts[path];
        if (bytes) { const img = el('img'); img.src = URL.createObjectURL(new Blob([bytes])); box.append(img); }
      } else if (body.localName === 'graphicFrame') {
        box.classList.add('eum-shape-chart');
        box.textContent = '차트 (이 앱에서는 표시만 생략되고 저장 시 보존됩니다)';
      } else {
        const sp = q(body, 'xdr:spPr');
        const fill = sp && [...sp.children].find((n) => n.localName === 'solidFill' || n.localName === 'noFill');
        const ln = sp && q(sp, 'a:ln');
        box.style.background = fill && fill.localName === 'solidFill' ? color(fill) : (body.localName === 'sp' ? '#fff' : '');
        if (ln && !q(ln, 'a:noFill')) box.style.border = `${Math.max(1, Math.round((+ln.getAttribute('w') || 9525) / 12700))}px solid ${color(ln) || '#000'}`;
        const geom = q(sp || body, 'a:prstGeom'), prst = geom && geom.getAttribute('prst');
        if (prst === 'roundRect') box.style.borderRadius = '8px';
        if (prst === 'ellipse') box.style.borderRadius = '50%';
        const bp = q(body, 'a:bodyPr'), anchor = bp && bp.getAttribute('anchor');
        box.style.justifyContent = anchor === 't' ? 'flex-start' : anchor === 'b' ? 'flex-end' : 'center';
        for (const para of all(body, 'a:p')) {
          const line = el('div');
          const pPr = q(para, 'a:pPr'), algn = pPr && pPr.getAttribute('algn');
          line.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left';
          for (const run of all(para, 'a:r')) {
            const t = q(run, 'a:t'), rPr = q(run, 'a:rPr'), span = el('span', null, t ? t.textContent : '');
            if (rPr) {
              if (rPr.getAttribute('b') === '1') span.style.fontWeight = '700';
              if (rPr.getAttribute('i') === '1') span.style.fontStyle = 'italic';
              if (rPr.getAttribute('sz')) span.style.fontSize = (+rPr.getAttribute('sz') / 100) + 'pt';
              if (color(rPr)) span.style.color = color(rPr);
            }
            line.append(span);
          }
          box.append(line);
        }
      }
      S.shapes.push({ r: +q(from, 'xdr:row').textContent + 1, c: +q(from, 'xdr:col').textContent + 1,
        dx: +q(from, 'xdr:colOff').textContent / PX, dy: +q(from, 'xdr:rowOff').textContent / PX, w, h, box, placed: false });
    }
  }

  /** 시작 행이 화면에 그려진 도형을 제자리에 놓는다 (appendRows 뒤마다) */
  function placeShapes() {
    const cols = table.querySelectorAll('colgroup col');
    for (const sh of S.shapes) {
      const tr = tbody.rows[sh.r - 1];
      if (sh.placed || !tr) continue;
      let left = 0;
      for (let i = 0; i < sh.c && i < cols.length; i++) left += parseFloat(cols[i].style.width) || 0;
      sh.box.style.left = (left + sh.dx) + 'px';
      sh.box.style.top = (tr.offsetTop + sh.dy) + 'px';
      sh.box.style.width = sh.w + 'px';
      sh.box.style.height = sh.h + 'px';
      layer.append(sh.box);
      sh.placed = true;
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
    placeShapes();
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
    loadShapes(ws.name);
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
      await loading.set(5, '준비하는 중');
      await loadLibs();
      await loading.set(15, '파일을 읽는 중');
      const r = await native.read({ uri });
      await loading.set(35, '파일을 검사하는 중');
      const bytes = await detach(b64ToBytes(r.data));
      await loading.set(50, '시트를 읽는 중');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes.buffer);
      await loading.set(85, '화면을 그리는 중');
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
      S.zoom = 1; wrap.style.zoom = 1;
      setEdit(false);
      setDirty(false);
      showSheet(visible[0]);
      await loading.set(100, '완료');
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
    const buf = await reattach(await S.wb.xlsx.writeBuffer());
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
      if (!confirm('원본 파일에 덮어씁니다.\n셀 값·서식·수식은 유지되지만 차트·그림·도형·피벗 표·매크로는 이 앱이 다루지 못해 빠질 수 있습니다.\n\n덮어쓸까요? (취소하면 「다른 이름으로 저장」을 쓰세요)')) return;
      S.confirmed = true;
    }
    try {
      await write(S.uri);
      setDirty(false);
      toast('저장했습니다.');
    } catch (e) {
      toast('원본 위치에는 저장할 수 없어 저장할 곳을 선택합니다.');
      await saveAs();
    }
  }
  async function share() {
    if (S.dirty) { toast('먼저 저장해 주세요.'); return; }
    try { await native.share({ uri: S.uri, name: S.name }); } catch (e) { toast(String(e && e.message || e)); }
  }
  function close() {
    root.hidden = true;
    Object.assign(S, { wb: null, ws: null, dirty: false, undo: [] });
    if (table) table.textContent = '';
    if (layer) layer.textContent = '';
    S.shapes = [];
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
    wrap = el('div', 'eum-sheet-wrap');
    table = el('table');
    layer = el('div', 'eum-shapes');
    wrap.append(table, layer);
    grid.append(wrap);
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
      wrap.style.zoom = S.zoom;
    }, { passive: false });
    grid.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });

    tabs = el('div', 'eum-tabs');
    loading = progressBox('eum-sheet-loading');

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
    commit();
    return false;
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
