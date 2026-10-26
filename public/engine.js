/*
 * 관급자재 구매요청서 자동작성 엔진
 * - 원본 엑셀(양식)을 그대로 열어서 "값 셀"과 "외형도 그림"만 교체한다.
 * - 서식·테두리·병합·인쇄설정·다른 시트는 건드리지 않는다.
 * 브라우저(확장프로그램)와 Node(테스트) 양쪽에서 동작.
 */
(function (root) {
  'use strict';

  // ───────────────────────── 양식 위치 정의 (원본 엑셀 분석 결과) ─────────────────────────
  const LAYOUT = {
    maxItems: 20,              // 내장 양식 품목 줄 수
    compare: {                 // 관급단가 비교표_*
      namePrefix: '관급단가 비교표',
      blockHeight: 13,         // 품목 1개 = 13행
      titleCol: 'C',           // ' □ 품목명 : …'
      firstDataOffset: 4,      // 블록 시작행 + 4 = 1번 업체 행
      rowsPerBlock: 7,         // 업체 7칸
      cols: { co: 'D', loc: 'E', no: 'F', unit: 'G', price: 'H', remark: 'Q' },
      certCols: ['I', 'J', 'K', 'L', 'M', 'N', 'O'],
      certKeys: ['품질보증', 'GS인증', '특허', '여성기업', '소상공인', '우수조달', 'G-PASS'],
      imageCol: 15,            // P열 (0부터)
      printCols: ['C', 'Q'],
    },
    survey: {                  // 단가및인증현황조사(변경)_*
      namePrefix: '단가및인증현황조사',
      firstRow: 6,
      clearRowsTo: 25,         // 6~25행 (품목 20줄)
      title: 'A1',
      cols: { name: 'A', spec: 'B', avg: 'BF' },
      companies: [
        { no: 'H', price: 'I', certCols: ['K', 'L', 'M', 'N', 'O', 'P', 'Q'],
          certKeys: ['품질보증', 'KS', '성능인증', '여성기업', '소상공인', '우수조달', 'G-PASS'] },
        { no: 'R', price: 'S', certCols: ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA'],
          certKeys: ['품질보증', 'KS', '성능인증', '여성기업', '소상공인', 'G-PASS', '장애인기업'] },
        { no: 'AB', price: 'AC', certCols: ['AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK'],
          certKeys: ['품질보증', 'KS', '성능인증', '여성기업', '소상공인', 'G-PASS', '장애인기업'] },
      ],
    },
    status: {                  // 구매내역현황
      name: '구매내역현황',
      firstRow: 10, sectionCell: 'A9',
      cols: { name: 'A', spec: 'B', unit: 'C', qtyTotal: 'E', qtyRound: 'G', designPrice: 'H', qtyNow: 'N' },
      projectCell: 'A3', roundCells: { G6: '{r}수량', J6: '금 회 {r}' },
    },
    request: {                 // 구매요청서
      name: '구매요청서',
      firstRow: 16,
      project: { name: 'E4', type: 'E5', materials: 'E6', period: 'E7', location: 'E8' },
      roundCell: 'N13', sectionCell: 'A15',
    },
  };

  // 쇼핑몰 인증명 → 양식 열 키
  const CERT_MATCH = [
    ['품질보증', /품질보증/],
    ['GS인증', /GS\s*인증/i],
    ['특허', /특허/],
    ['여성기업', /여성기업/],
    ['소상공인', /소상공인/],
    ['우수조달', /우수조달/],
    ['G-PASS', /G-?PASS/i],
    ['KS', /^KS$|KS인증/],
    ['성능인증', /성능인증/],
    ['장애인기업', /장애인기업/],
  ];
  function certKeysOf(labels) {
    const keys = new Set();
    for (const l of labels || []) for (const [k, re] of CERT_MATCH) if (re.test(String(l).trim())) keys.add(k);
    return keys;
  }

  // ───────────────────────── 공통 유틸 ─────────────────────────
  const colNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const colStr = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const splitRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], +m[2]]; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };

  // 공유수식 참조 이동 (dr행, dc열)
  function shiftFormula(f, dr, dc) {
    let out = '', i = 0;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"' || ch === "'") {             // 문자열·시트명은 그대로
        let j = i + 1;
        while (j < f.length) { if (f[j] === ch) { if (f[j + 1] === ch) { j += 2; continue; } break; } j++; }
        out += f.slice(i, j + 1); i = j + 1; continue;
      }
      const m = /^(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?![0-9A-Za-z_(])/.exec(f.slice(i));
      const prev = i > 0 ? f[i - 1] : '';
      if (m && !/[A-Za-z0-9_.]/.test(prev)) {
        const c = m[1] ? m[2] : colStr(colNum(m[2]) + dc);
        const r = m[3] ? m[4] : String(+m[4] + dr);
        out += m[1] + c + m[3] + r; i += m[0].length; continue;
      }
      out += ch; i++;
    }
    return out;
  }

  // ───────────────────────── 시트 XML 편집기 ─────────────────────────
  class Sheet {
    constructor(xml) {
      const a = xml.indexOf('<sheetData'), b = xml.indexOf('</sheetData>');
      if (a < 0) throw new Error('sheetData 없음');
      if (b < 0) { // <sheetData/>
        const e = xml.indexOf('>', a);
        this.head = xml.slice(0, a) + '<sheetData>'; this.tail = '</sheetData>' + xml.slice(e + 1); this.rows = new Map(); return;
      }
      const openEnd = xml.indexOf('>', a) + 1;
      this.head = xml.slice(0, openEnd); this.tail = xml.slice(b);
      const body = xml.slice(openEnd, b);
      this.rows = new Map();
      const rowRe = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g; let m;
      while ((m = rowRe.exec(body))) {
        const raw = m[0], openTag = raw.slice(0, raw.indexOf('>') + 1);
        const r = +attr(openTag, 'r');
        const cells = new Map();
        if (!openTag.endsWith('/>')) {
          const inner = raw.slice(openTag.length, raw.length - 6);
          const cRe = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g; let cm;
          while ((cm = cRe.exec(inner))) { const ref = attr(cm[0], 'r'); cells.set(splitRef(ref)[0], { raw: cm[0] }); }
        }
        this.rows.set(r, { open: openTag.replace(/\/>$/, '>'), cells, dirty: false });
      }
      this.expandShared();
    }
    // 공유수식을 개별 수식으로 풀어 둔다 (셀 하나를 고쳐도 다른 셀 수식이 깨지지 않게)
    expandShared() {
      const masters = new Map();
      for (const [r, row] of this.rows) for (const [c, cell] of row.cells) {
        const fm = /<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(cell.raw);
        if (fm && /t="shared"/.test(fm[1]) && /ref="/.test(fm[1])) masters.set(attr(fm[0], 'si'), { r, c: colNum(c), f: unesc(fm[2]) });
      }
      if (!masters.size) return;
      for (const [r, row] of this.rows) for (const [c, cell] of row.cells) {
        const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cell.raw);
        if (!fm || !/t="shared"/.test(fm[1])) continue;
        const ms = masters.get(attr(fm[0], 'si'));
        if (!ms) continue;
        const nf = shiftFormula(ms.f, r - ms.r, colNum(c) - ms.c);
        cell.raw = cell.raw.replace(fm[0], '<f>' + esc(nf) + '</f>');
        row.dirty = true;
      }
    }
    getRaw(ref) { const [c, r] = splitRef(ref); const row = this.rows.get(r); return row && row.cells.get(c) ? row.cells.get(c).raw : null; }
    getFormula(ref) { const raw = this.getRaw(ref); const m = raw && /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(raw); return m ? unesc(m[1]) : null; }
    _style(ref) { const raw = this.getRaw(ref); return raw ? attr(raw.slice(0, raw.indexOf('>') + 1), 's') : null; }
    _put(ref, inner, type) {
      const [c, r] = splitRef(ref);
      let row = this.rows.get(r);
      if (!row) { row = { open: `<row r="${r}">`, cells: new Map(), dirty: true }; this.rows.set(r, row); }
      const s = this._style(ref);
      const sAttr = s != null ? ` s="${s}"` : '';
      const tAttr = type ? ` t="${type}"` : '';
      row.cells.set(c, { raw: inner == null ? `<c r="${ref}"${sAttr}/>` : `<c r="${ref}"${sAttr}${tAttr}>${inner}</c>` });
      row.dirty = true;
    }
    set(ref, v) {
      if (v === null || v === undefined || v === '') return this._put(ref, null);
      if (typeof v === 'number' && isFinite(v)) return this._put(ref, `<v>${v}</v>`);
      return this._put(ref, `<is><t xml:space="preserve">${esc(v)}</t></is>`, 'inlineStr');
    }
    setFormula(ref, f) { this._put(ref, `<f>${esc(f.replace(/^=/, ''))}</f>`); }
    clear(ref) { if (this.getRaw(ref)) this._put(ref, null); }
    setHidden(r, hide) {
      let row = this.rows.get(r);
      if (!row) { row = { open: `<row r="${r}">`, cells: new Map(), dirty: true }; this.rows.set(r, row); }
      let o = row.open.replace(/\shidden="[^"]*"/, '');
      if (hide) o = o.replace(/>$/, ' hidden="1">');
      row.open = o; row.dirty = true;
    }
    toXml() {
      const rs = [...this.rows.keys()].sort((a, b) => a - b);
      let body = '';
      for (const r of rs) {
        const row = this.rows.get(r);
        const open = row.dirty ? row.open.replace(/\sspans="[^"]*"/, '') : row.open;
        const cs = [...row.cells.keys()].sort((a, b) => colNum(a) - colNum(b));
        body += cs.length ? open + cs.map((c) => row.cells.get(c).raw).join('') + '</row>' : open.replace(/>$/, '/>');
      }
      return this.head + body + this.tail;
    }
  }

  // ───────────────────────── 통합문서 ─────────────────────────
  async function openBook(JSZip, data) {
    const zip = await JSZip.loadAsync(data);
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rels = {};
    for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
    const sheets = [];
    let idx = 0;
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const t = m[0];
      const target = rels[attr(t, 'r:id')];
      sheets.push({ index: idx++, name: unesc(attr(t, 'name')), hidden: !!attr(t, 'state') && attr(t, 'state') !== 'visible', path: 'xl/' + target.replace(/^\/?xl\//, '') });
    }
    return { zip, wbXml, sheets };
  }
  function findSheet(book, pred, label) {
    const s = book.sheets.filter((x) => !x.hidden).find(pred) || book.sheets.find(pred);
    if (!s) throw new Error(`양식에서 "${label}" 시트를 찾지 못했습니다.`);
    return s;
  }

  // ───────────────────────── 그림 교체 (비교표 외형도) ─────────────────────────
  async function drawingOf(zip, sheetPath) {
    const relPath = sheetPath.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    const f = zip.file(relPath); if (!f) return null;
    const x = await f.async('string');
    const m = /<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*>/.exec(x);
    if (!m) return null;
    const target = attr(m[0], 'Target');
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\.\//, '');
    return { path, relPath: path.replace(/drawings\/(drawing\d+\.xml)$/, 'drawings/_rels/$1.rels') };
  }

  function anchorPos(a, px = 'xdr:') {
    const m = new RegExp(`<${px}from><${px}col>(\\d+)</${px}col><${px}colOff>-?\\d+</${px}colOff><${px}row>(\\d+)</${px}row>`).exec(a);
    return m ? { col: +m[1], row: +m[2] } : null;
  }

  // 시트 복제 (조사표 2장 이상일 때) — 그림(인증마크)까지 복제, 맨 뒤에 추가
  async function cloneSheet(book, src, newName, xml) {
    const { zip } = book;
    const nums = Object.keys(zip.files).map((f) => (/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(f) || [])[1]).filter(Boolean).map(Number);
    const n = Math.max(...nums) + 1, path = `xl/worksheets/sheet${n}.xml`;
    zip.file(path, xml);
    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    const srcRel = src.path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    if (zip.file(srcRel)) {
      let rel = await zip.file(srcRel).async('string');
      const dm = /<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"[^>]*\/>/.exec(rel) || /<Relationship\b[^>]*Target="([^"]+)"[^>]*Type="[^"]*\/drawing"[^>]*\/>/.exec(rel);
      if (dm) {
        const t = dm[1], dpath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\.\//, '');
        const dn = Math.max(...Object.keys(zip.files).map((f) => +((/^xl\/drawings\/drawing(\d+)\.xml$/.exec(f) || [])[1] || 0))) + 1;
        const npath = `xl/drawings/drawing${dn}.xml`;
        zip.file(npath, await zip.file(dpath).async('string'));
        const drel = dpath.replace(/drawings\/(drawing\d+\.xml)$/, 'drawings/_rels/$1.rels');
        if (zip.file(drel)) zip.file(npath.replace(/drawings\/(drawing\d+\.xml)$/, 'drawings/_rels/$1.rels'), await zip.file(drel).async('string'));
        rel = rel.replace(t, t.startsWith('/') ? '/' + npath : '../drawings/drawing' + dn + '.xml');
        ct = ct.replace('</Types>', `<Override PartName="/${npath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      }
      zip.file(path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels'), rel);
    }
    zip.file('[Content_Types].xml', ct);
    let wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    let rid = 1; for (const m of wr.matchAll(/Id="rId(\d+)"/g)) rid = Math.max(rid, +m[1] + 1);
    wr = wr.replace('</Relationships>', `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/${path}"/></Relationships>`);
    zip.file('xl/_rels/workbook.xml.rels', wr);
    let wb = book.wbXml;
    let sid = 1; for (const m of wb.matchAll(/sheetId="(\d+)"/g)) sid = Math.max(sid, +m[1] + 1);
    const newIndex = book.sheets.length;
    wb = wb.replace('</sheets>', `<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${esc(newName)}" sheetId="${sid}" r:id="rId${rid}"/></sheets>`);
    const pa = new RegExp(`<definedName name="_xlnm\\.Print_Area" localSheetId="${src.index}"[^>]*>([^<]*)</definedName>`).exec(wb);
    if (pa) {
      const ref = unesc(pa[1]).replace(/^'?[^!]*'?!/, `'${newName.replace(/'/g, "''")}'!`);
      wb = wb.replace('</definedNames>', `<definedName name="_xlnm.Print_Area" localSheetId="${newIndex}">${esc(ref)}</definedName></definedNames>`);
    }
    book.wbXml = wb;
    book.sheets.push({ index: newIndex, name: newName, hidden: false, path });
    return path;
  }

  // ───────────────────────── 메인: 양식 채우기 ─────────────────────────
  /**
   * data = {
   *   project: { name, type, materials, period, location, round, group },
   *   items: [{ name, spec, unit, qtyTotal, qtyRound, qtyNow, designPrice,
   *             companies: [{ co, loc, no, price, certs:[라벨], remark, image:{ bytes:Uint8Array, ext:'jpeg'|'png', w, h } }] }]
   * }
   */
  async function fillWorkbook(JSZip, templateData, data) {
    const warnings = [];
    const book = await openBook(JSZip, templateData);
    const { zip } = book;
    const items = data.items || [];
    const P = data.project || {};
    if (!items.length) throw new Error('품목이 없습니다.');
    if (items.length > LAYOUT.maxItems) throw new Error(`이 양식은 품목 ${LAYOUT.maxItems}개까지 들어갑니다. (현재 ${items.length}개)`);

    const shCmp = findSheet(book, (s) => s.name.startsWith(LAYOUT.compare.namePrefix), '관급단가 비교표');
    const shSur = findSheet(book, (s) => s.name.startsWith(LAYOUT.survey.namePrefix), '단가및인증현황조사');
    const shSta = findSheet(book, (s) => s.name === LAYOUT.status.name, '구매내역현황');
    const shReq = findSheet(book, (s) => s.name === LAYOUT.request.name, '구매요청서');
    const load = async (s) => new Sheet(await zip.file(s.path).async('string'));
    const cmp = await load(shCmp), sur = await load(shSur), sta = await load(shSta), req = await load(shReq);

    const C = LAYOUT.compare, S = LAYOUT.survey, T = LAYOUT.status, R = LAYOUT.request;
    const round = (P.round || '').trim();

    // ── 1) 관급단가 비교표: 품목 블록 채우기
    const imagePlan = []; // {row(0-based), image}
    items.forEach((it, k) => {
      const start = 1 + C.blockHeight * k;
      cmp.set(C.titleCol + start, ` □ 품목명 : ${[it.name, it.spec].filter(Boolean).join(' ')}`);
      for (let j = 0; j < C.rowsPerBlock; j++) {
        const r = start + C.firstDataOffset + j;
        const co = (it.companies || [])[j];
        const put = (col, v) => cmp.set(col + r, v);
        if (co) {
          put(C.cols.co, co.co); put(C.cols.loc, co.loc); put(C.cols.no, toNum(co.no));
          put(C.cols.unit, it.unit || co.unit || ''); put(C.cols.price, toNum(co.price));
          const keys = certKeysOf(co.certs);
          C.certCols.forEach((col, i) => put(col, keys.has(C.certKeys[i]) ? '◎' : null));
          put(C.cols.remark, co.remark || null);
          if (co.image) imagePlan.push({ row: r - 1, image: co.image });
        } else {
          [C.cols.co, C.cols.loc, C.cols.no, C.cols.unit, C.cols.price, C.cols.remark, ...C.certCols].forEach((col) => cmp.clear(col + r));
        }
      }
    });

    // ── 2) 단가및인증현황조사: 1~3번 업체가 같은 품목끼리 묶어 묶음마다 시트 1장 (머리글 업체명이 맞도록)
    const coKey = (c) => (c ? String(c.co).replace(/주식회사|\(주\)|㈜|\s/g, '') : '-');
    const groups = [];
    items.forEach((it, k) => {
      const key = (it.companies || []).slice(0, 3).map(coKey).join('|');
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, idx: [] }; groups.push(g); }
      g.idx.push(k);
    });
    const surOrigXml = await zip.file(shSur.path).async('string');
    const cmpQ = `'${shCmp.name.replace(/'/g, "''")}'`;
    const surSheets = [];   // { sheet, name, path }
    for (let gi = 0; gi < groups.length; gi++) {
      if (gi === 0) { surSheets.push({ sheet: sur, name: shSur.name, path: shSur.path }); continue; }
      const name = `${shSur.name}(${gi + 1})`;
      const path = await cloneSheet(book, shSur, name, surOrigXml);
      surSheets.push({ sheet: new Sheet(surOrigXml.replace(/\stabSelected="1"/, '')), name, path });
    }
    const surRowOf = []; // 품목 k → { name, row }
    groups.forEach((g, gi) => {
      const { sheet: sh, name: shName } = surSheets[gi];
      const k0 = g.idx[0];
      const title = gi === 0 && P.group ? P.group : items[k0].name;
      sh.set(S.title, `관급자재(${title}) 조달단가 및 인증현황 조사표`);
      ['H', 'S', 'AB'].forEach((col, j) => sh.setFormula(col + '3', `${cmpQ}!D${5 + C.blockHeight * k0 + j}`));
      for (let j = 0; j < LAYOUT.maxItems; j++) {
        const r = S.firstRow + j, k = g.idx[j], it = items[k];
        sh.setHidden(r, !it);
        S.companies.forEach((sc, ci) => {
          const co = it && (it.companies || [])[ci];
          const keys = co ? certKeysOf(co.certs) : new Set();
          sc.certCols.forEach((col, i) => { if (keys.has(sc.certKeys[i])) sh.set(col + r, '◎'); else sh.clear(col + r); });
        });
        if (!it) {
          sh.set(S.cols.name + r, null); sh.set(S.cols.spec + r, null);
          S.companies.forEach((sc) => { sh.set(sc.no + r, null); sh.set(sc.price + r, null); });
          continue;
        }
        surRowOf[k] = { name: shName, row: r };
        sh.set(S.cols.name + r, it.name); sh.set(S.cols.spec + r, it.spec);
        sh.setFormula('D' + r, `IF(A${r}="","",${T.name}!N${T.firstRow + k})`);
        const b = 5 + C.blockHeight * k;
        S.companies.forEach((sc, ci) => {
          sh.setFormula(sc.no + r, `IF(${cmpQ}!F${b + ci}="","",${cmpQ}!F${b + ci})`);
          sh.setFormula(sc.price + r, `IF(${cmpQ}!H${b + ci}="","",${cmpQ}!H${b + ci})`);
        });
        // 평균단가: 3개 업체 중 최저가 1곳을 뺀 나머지 평균 (양식 "최저단가 제외" 기준)
        const cs = (it.companies || []).slice(0, 3);
        if (cs.length === 3 && cs.every(Boolean)) {
          const pr = cs.map((c) => toNum(c.price));
          const minIdx = pr.indexOf(Math.min(...pr));
          const pc = S.companies.map((x) => x.price + r);
          const keep = minIdx === 0 ? [pc[1], pc[2]] : minIdx === 1 ? [pc[0], pc[2]] : [pc[0], pc[1]];
          sh.setFormula(S.cols.avg + r, `TRUNC(AVERAGE(${keep.join(',')}),0)`);
        } else {
          sh.setFormula(S.cols.avg + r, `IF(A${r}="","",TRUNC(AVERAGE(${S.companies.map((x) => x.price + r).join(',')}),0))`);
          warnings.push(`${k + 1}번 품목(${it.name} ${it.spec || ''}): 업체가 3곳이 아니라서 평균단가를 선택된 업체 평균으로 계산했습니다.`);
        }
      }
    });
    if (groups.length > 1) warnings.push(`1~3번 업체 구성이 다른 품목이 있어 조사표를 ${groups.length}장으로 나눠 만들었습니다.`);

    // ── 3) 구매내역현황: 명칭·규격·단위·수량·설계단가
    if (P.name) sta.set(T.projectCell, ` □ 공    사    명  :  ${P.name}`);
    if (round) for (const [ref, tpl] of Object.entries(T.roundCells)) sta.set(ref, tpl.replace('{r}', round));
    for (let k = 0; k < LAYOUT.maxItems; k++) {
      const r = T.firstRow + k, it = items[k];
      const cols = T.cols;
      if (it) {
        sta.set(cols.name + r, it.name); sta.set(cols.spec + r, it.spec); sta.set(cols.unit + r, it.unit);
        if (it.qtyTotal !== '' && it.qtyTotal != null) sta.set(cols.qtyTotal + r, toNum(it.qtyTotal));
        if (it.qtyRound !== '' && it.qtyRound != null) sta.set(cols.qtyRound + r, toNum(it.qtyRound));
        if (it.designPrice !== '' && it.designPrice != null) sta.set(cols.designPrice + r, toNum(it.designPrice));
        if (surRowOf[k]) { const q = `'${surRowOf[k].name.replace(/'/g, "''")}'`; sta.setFormula('O' + r, `IF(A${r}="","",${q}!BF${surRowOf[k].row})`); }
        const nowF = sta.getFormula(cols.qtyNow + r);
        if (it.qtyNow !== '' && it.qtyNow != null && !(nowF && /^G\d+$/.test(nowF) && toNum(it.qtyNow) === toNum(it.qtyRound)))
          sta.set(cols.qtyNow + r, toNum(it.qtyNow));
      } else {
        [cols.name, cols.spec, cols.unit, cols.qtyTotal, cols.qtyRound, cols.designPrice, cols.qtyNow].forEach((c) => sta.clear(c + r));
      }
    }

    // ── 4) 구매요청서: 공사개요
    for (const [key, ref] of Object.entries(R.project)) if (P[key]) req.set(ref, P[key]);
    if (round) req.set(R.roundCell, `금회${round}`);
    if (P.type) { req.set(R.sectionCell, P.type); sta.set(T.sectionCell, ' ' + P.type); }
    // 남는 품목 줄은 숨김 (내역현황·조사표) — 구매요청서는 원본처럼 빈 칸 유지
    for (let k = 0; k < LAYOUT.maxItems; k++) {
      sta.setHidden(T.firstRow + k, k >= items.length);
    }

    // ── 5) 외형도 그림 교체
    const dr = await drawingOf(zip, shCmp.path);
    if (imagePlan.length && !dr) warnings.push('비교표 시트에 그림 영역이 없어 외형도를 넣지 못했습니다.');
    if (dr) {
      let dx = await zip.file(dr.path).async('string');
      let rx = zip.file(dr.relPath) ? await zip.file(dr.relPath).async('string')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      // 채우는 블록의 업체행(1~7행) P열 그림 제거
      const targetRows = new Set();
      items.forEach((_, k) => { for (let j = 0; j < C.rowsPerBlock; j++) targetRows.add(C.blockHeight * k + C.firstDataOffset + j); }); // 0-based
      const px = (/<(\w+:)?wsDr\b/.exec(dx) || [])[1] || ''; // 'xdr:' 또는 접두어 없음
      dx = dx.replace(new RegExp(`<${px}(oneCellAnchor|twoCellAnchor|absoluteAnchor)\\b[^>]*>[\\s\\S]*?</${px}\\1>`, 'g'), (a) => {
        const p = anchorPos(a, px);
        return p && p.col === C.imageCol && targetRows.has(p.row) ? '' : a;
      });
      let maxId = 1; for (const m of dx.matchAll(/cNvPr id="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
      let maxRid = 0; for (const m of rx.matchAll(/Id="rId(\d+)"/g)) maxRid = Math.max(maxRid, +m[1]);
      const media = Object.keys(zip.files).filter((f) => f.startsWith('xl/media/'));
      let mediaN = 0; for (const f of media) { const m = /image(\d+)\./.exec(f); if (m) mediaN = Math.max(mediaN, +m[1]); }
      const MAXW = 4600000, MAXH = 1100000, OFF = 40821; // EMU (원본 외형도 크기 기준)
      let anchors = '', relAdd = '';
      for (const { row, image } of imagePlan) {
        const ext = image.ext === 'png' ? 'png' : 'jpeg';
        const file = `image${++mediaN}.${ext}`;
        zip.file('xl/media/' + file, image.bytes);
        const rid = 'rId' + (++maxRid);
        relAdd += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${file}"/>`;
        const sc = Math.min(MAXW / image.w, MAXH / image.h);
        const cx = Math.round(image.w * sc), cy = Math.round(image.h * sc);
        const id = ++maxId;
        anchors += `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${C.imageCol}</xdr:col><xdr:colOff>${OFF}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${OFF}</xdr:rowOff></xdr:from>` +
          `<xdr:to><xdr:col>${C.imageCol}</xdr:col><xdr:colOff>${OFF + cx}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${OFF + cy}</xdr:rowOff></xdr:to>` +
          `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="외형도 ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
      }
      const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
      anchors = anchors.replace(/<xdr:twoCellAnchor editAs="oneCell">/g, `<xdr:twoCellAnchor editAs="oneCell" ${A}>`).replace(/<(\/?)xdr:/g, `<$1${px}`);
      dx = dx.replace(`</${px}wsDr>`, anchors + `</${px}wsDr>`);
      rx = rx.replace('</Relationships>', relAdd + '</Relationships>');
      zip.file(dr.path, dx); zip.file(dr.relPath, rx);
      let ct = await zip.file('[Content_Types].xml').async('string');
      for (const [e, t] of [['png', 'image/png'], ['jpeg', 'image/jpeg']])
        if (!new RegExp(`Extension="${e}"`, 'i').test(ct)) ct = ct.replace('<Types ', '<Types ').replace(/(<Types\b[^>]*>)/, `$1<Default Extension="${e}" ContentType="${t}"/>`);
      zip.file('[Content_Types].xml', ct);
    }

    // ── 6) 인쇄영역(비교표) = 채운 품목 수만큼
    let wb = book.wbXml;
    const lastRow = C.blockHeight * items.length;
    const printRef = `'${shCmp.name.replace(/'/g, "''")}'!$${C.printCols[0]}$1:$${C.printCols[1]}$${lastRow}`;
    const pa = new RegExp(`<definedName name="_xlnm\\.Print_Area" localSheetId="${shCmp.index}"[^>]*>[^<]*</definedName>`);
    if (pa.test(wb)) wb = wb.replace(pa, (m) => m.replace(/>[^<]*</, '>' + esc(printRef) + '<'));
    else warnings.push('비교표 인쇄영역 정의를 찾지 못해 그대로 두었습니다.');
    // 열 때 수식 전체 재계산
    wb = /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, sl) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sl}>`)
      : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    zip.file('xl/workbook.xml', wb);

    // ── 7) 계산체인 제거(엑셀이 다시 만듦) + 시트 저장
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      let ct = await zip.file('[Content_Types].xml').async('string');
      ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
      zip.file('[Content_Types].xml', ct);
      let wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
      wr = wr.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, '');
      zip.file('xl/_rels/workbook.xml.rels', wr);
    }
    zip.file(shCmp.path, cmp.toXml());
    for (const x of surSheets) zip.file(x.path, x.sheet.toXml());
    zip.file(shSta.path, sta.toXml()); zip.file(shReq.path, req.toXml());

    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { bytes: out, warnings, sheets: { compare: shCmp.name, survey: shSur.name } };
  }

  // 양식 파일에 이미 들어있는 공사개요·품목을 읽어 입력칸 기본값으로 사용
  async function readDefaults(JSZip, templateData) {
    const book = await openBook(JSZip, templateData);
    const { zip } = book;
    const ssF = zip.file('xl/sharedStrings.xml');
    const ss = [];
    if (ssF) {
      const x = await ssF.async('string');
      for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(unesc([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    }
    const val = (sheet, ref) => {
      const raw = sheet.getRaw(ref); if (!raw) return '';
      const t = attr(raw.slice(0, raw.indexOf('>') + 1), 't');
      if (t === 'inlineStr') return unesc([...raw.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      const v = /<v>([\s\S]*?)<\/v>/.exec(raw); if (!v) return '';
      if (t === 's') return ss[+v[1]] || '';
      if (t === 'str' || t === 'e') return unesc(v[1]);
      return +v[1];
    };
    const shSta = findSheet(book, (s) => s.name === LAYOUT.status.name, '구매내역현황');
    const shReq = findSheet(book, (s) => s.name === LAYOUT.request.name, '구매요청서');
    const shSur = findSheet(book, (s) => s.name.startsWith(LAYOUT.survey.namePrefix), '단가및인증현황조사');
    const sta = new Sheet(await zip.file(shSta.path).async('string'));
    const req = new Sheet(await zip.file(shReq.path).async('string'));
    const sur = new Sheet(await zip.file(shSur.path).async('string'));
    const project = {};
    for (const [k, ref] of Object.entries(LAYOUT.request.project)) project[k] = String(val(req, ref) || '').trim();
    const rc = String(val(req, LAYOUT.request.roundCell) || '');
    project.round = (/(\d+\s*차)/.exec(rc) || [, ''])[1];
    const shCmp = book.sheets.filter((s) => !s.hidden).find((s) => s.name.startsWith(LAYOUT.compare.namePrefix));
    project.group = shCmp ? shCmp.name.slice(LAYOUT.compare.namePrefix.length).trim()
      : (/\(([^)]+)\)/.exec(String(val(sur, LAYOUT.survey.title) || '')) || [, ''])[1];
    const items = [];
    const T = LAYOUT.status;
    for (let k = 0; k < LAYOUT.maxItems; k++) {
      const r = T.firstRow + k, g = (c) => val(sta, T.cols[c] + r);
      const name = String(g('name') || '').trim();
      if (!name) continue;
      const qtyRound = g('qtyRound');
      items.push({ name, spec: String(g('spec') || '').trim(), unit: String(g('unit') || '').trim(), qtyTotal: g('qtyTotal'),
        qtyRound, qtyNow: g('qtyNow') === '' ? qtyRound : g('qtyNow'), designPrice: g('designPrice') });
    }
    return { project, items, sheets: book.sheets.filter((s) => !s.hidden).map((s) => s.name) };
  }

  function toNum(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[,\s원]/g, '');
    return s !== '' && !isNaN(+s) ? +s : v;
  }

  const api = { fillWorkbook, readDefaults, LAYOUT, certKeysOf, shiftFormula, Sheet, _colNum: colNum, _colStr: colStr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GK_ENGINE = api;
})(typeof self !== 'undefined' ? self : this);
