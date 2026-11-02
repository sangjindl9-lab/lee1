// DWG/DXF → SVG → PDF 표시본 자동 생성
// - DWG: libredwg-web (LibreDWG WebAssembly, GPL-3.0) 로 읽어 SVG 생성
// - DXF: dxf-parser 로 읽고 이 파일의 렌더러로 SVG 생성
// 색상은 흑백 출력 기준(검정 선)으로 변환합니다. 해석하지 못한 객체 수는 결과에 기록합니다.
const path = require('path');

let libPromise = null;
async function libredwg() {
  if (!libPromise) {
    libPromise = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      const wasmDir = path.join(__dirname, '..', '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm') + '/';
      const lib = await mod.LibreDwg.create(wasmDir);
      return { lib, FileType: mod.Dwg_File_Type };
    })().catch(e => { libPromise = null; throw e; });
  }
  return libPromise;
}

// ---------- DWG ----------
async function dwgToSvg(buf) {
  const { lib, FileType } = await libredwg();
  const raw = lib.dwg_read_data(new Uint8Array(buf), FileType.DWG);
  if (!raw) throw new Error('DWG 파일을 읽을 수 없습니다 (지원하지 않는 버전이거나 손상된 파일).');
  let db;
  try { db = lib.convert(raw); } finally { try { lib.dwg_free(raw); } catch {} }
  const all = db.entities || [];
  const warnings = [];
  // 표(ACAD_TABLE) 셀 정보가 일부 비어 있으면 SVG 변환이 실패하므로 빈 셀로 채움
  const fixTable = (e) => {
    if (e?.type !== 'ACAD_TABLE') return;
    const total = (e.rowCount || 0) * (e.columnCount || 0);
    e.cells = Array.isArray(e.cells) ? e.cells : [];
    while (e.cells.length < total) e.cells.push({});
    e.rowHeightArr = Array.from({ length: e.rowCount || 0 }, (_, i) => e.rowHeightArr?.[i] ?? 0);
    e.columnWidthArr = Array.from({ length: e.columnCount || 0 }, (_, i) => e.columnWidthArr?.[i] ?? 0);
  };
  all.forEach(fixTable);
  // 무한 작도선(XLINE·RAY)은 도면 범위를 무한히 넓히므로 표시에서 제외
  const infinite = all.filter(e => e.type === 'XLINE' || e.type === 'RAY');
  if (infinite.length) { db.entities = all.filter(e => !infinite.includes(e)); warnings.push(`무한 작도선(XLINE·RAY) ${infinite.length}개 제외`); }
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) (b.entities || []).forEach(fixTable);
  const trySvg = (ents) => { try { return lib.dwg_to_svg({ ...db, entities: ents }); } catch { return null; } };
  let svg = trySvg(db.entities);
  let skipped = [];
  if (!svg) {
    // 실패 객체 찾기: 구간을 나눠 그려지지 않는 객체만 제외
    const good = [];
    const walk = (list) => {
      if (!list.length) return;
      if (trySvg(list)) { good.push(...list); return; }
      if (list.length === 1) { skipped.push(list[0]); return; }
      const mid = Math.floor(list.length / 2);
      walk(list.slice(0, mid)); walk(list.slice(mid));
    };
    walk(db.entities);
    svg = trySvg(good);
    if (!svg) throw new Error('DWG를 SVG로 변환하지 못했습니다.');
  }
  if (skipped.length) {
    const types = {}; for (const e of skipped) types[e.type] = (types[e.type] || 0) + 1;
    warnings.push(`표시하지 못한 객체 ${skipped.length}개: ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  return { svg, engine: 'LibreDWG(WebAssembly)', entities: all.length, skipped: skipped.length, warnings };
}

// ---------- DXF ----------
const uni = s => String(s ?? '').replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const esc = s => uni(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = v => (Number.isFinite(v) ? Number(v.toFixed(6)) : 0);

function mtextPlain(t) {
  return String(t || '')
    .replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\[~]/g, ' ')
    .replace(/[{}]/g, '').replace(/\\\\/g, '\\');
}

function dxfToSvg(text) {
  const DxfParser = require('dxf-parser');
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('DXF 파일을 읽을 수 없습니다.');
  const blocks = dxf.blocks || {};
  const counts = { drawn: 0, skipped: {} };
  const skip = t => { counts.skipped[t] = (counts.skipped[t] || 0) + 1; };
  const layers = dxf.tables?.layer?.layers || {};
  const hidden = l => layers[l] && (layers[l].visible === false || layers[l].frozen);

  function polyPath(vs, closed) {
    if (!vs?.length) return '';
    let d = `M${n(vs[0].x)} ${n(vs[0].y)}`;
    const seg = (a, b) => {
      if (a.bulge) {
        const theta = 4 * Math.atan(a.bulge);
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
        d += ` A${n(r)} ${n(r)} 0 ${Math.abs(theta) > Math.PI ? 1 : 0} ${a.bulge > 0 ? 1 : 0} ${n(b.x)} ${n(b.y)}`;
      } else d += ` L${n(b.x)} ${n(b.y)}`;
    };
    for (let i = 0; i < vs.length - 1; i++) seg(vs[i], vs[i + 1]);
    if (closed && vs.length > 2) { seg(vs[vs.length - 1], vs[0]); d += ' Z'; }
    return d;
  }

  function textEl(x, y, h, rot, str) {
    const lines = String(str).split('\n');
    const size = h || 2.5;
    return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot || 0)}) scale(1 -1)"><text class="t" font-size="${n(size)}">${lines.map((l, i) => `<tspan x="0" dy="${i ? n(size * 1.4) : 0}">${esc(l)}</tspan>`).join('')}</text></g>`;
  }

  function ent(e, depth) {
    if (hidden(e.layer)) return '';
    switch (e.type) {
      case 'LINE': counts.drawn++; return `<line x1="${n(e.vertices[0].x)}" y1="${n(e.vertices[0].y)}" x2="${n(e.vertices[1].x)}" y2="${n(e.vertices[1].y)}"/>`;
      case 'LWPOLYLINE': case 'POLYLINE': counts.drawn++; return `<path d="${polyPath(e.vertices, e.shape || e.closed)}"/>`;
      case 'CIRCLE': counts.drawn++; return `<circle cx="${n(e.center.x)}" cy="${n(e.center.y)}" r="${n(e.radius)}"/>`;
      case 'ARC': {
        counts.drawn++;
        const s = e.startAngle, en = e.endAngle; let sweep = en - s; if (sweep <= 0) sweep += Math.PI * 2;
        const p = a => [e.center.x + e.radius * Math.cos(a), e.center.y + e.radius * Math.sin(a)];
        const [x1, y1] = p(s), [x2, y2] = p(en);
        return `<path d="M${n(x1)} ${n(y1)} A${n(e.radius)} ${n(e.radius)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n(x2)} ${n(y2)}"/>`;
      }
      case 'ELLIPSE': {
        counts.drawn++;
        const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y; const a = Math.hypot(mx, my), b = a * e.axisRatio; const rot = Math.atan2(my, mx);
        let s = e.startAngle ?? 0, en = e.endAngle ?? Math.PI * 2; if (en <= s) en += Math.PI * 2;
        const pts = []; for (let i = 0; i <= 64; i++) { const t = s + (en - s) * i / 64; const x = a * Math.cos(t), y = b * Math.sin(t); pts.push({ x: e.center.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.center.y + x * Math.sin(rot) + y * Math.cos(rot) }); }
        return `<path d="${polyPath(pts, false)}"/>`;
      }
      case 'SPLINE': {
        const pts = e.fitPoints?.length ? e.fitPoints : e.controlPoints;
        if (!pts?.length) { skip('SPLINE'); return ''; }
        counts.drawn++; return `<path d="${polyPath(pts, e.closed)}"/>`;
      }
      case 'TEXT': counts.drawn++; return textEl(e.startPoint?.x ?? e.position?.x, e.startPoint?.y ?? e.position?.y, e.textHeight, e.rotation, e.text);
      case 'MTEXT': counts.drawn++; return textEl(e.position.x, e.position.y - (e.height || 2.5), e.height, e.rotation, mtextPlain(e.text));
      case 'ATTRIB': counts.drawn++; return textEl(e.startPoint?.x, e.startPoint?.y, e.textHeight, e.rotation, e.text);
      case 'POINT': counts.drawn++; return `<circle cx="${n(e.position.x)}" cy="${n(e.position.y)}" r="0.5"/>`;
      case 'SOLID': case '3DFACE': { counts.drawn++; const pts = (e.points || e.vertices || []); return `<path d="${polyPath(e.type === 'SOLID' && pts.length === 4 ? [pts[0], pts[1], pts[3], pts[2]] : pts, true)}"/>`; }
      case 'INSERT': case 'DIMENSION': {
        const blk = blocks[e.name || e.block];
        if (!blk || depth > 8) { skip(e.type); return ''; }
        const p = e.position || { x: 0, y: 0 };
        const tr = e.type === 'DIMENSION' ? '' : `translate(${n(p.x)} ${n(p.y)}) rotate(${n(e.rotation || 0)}) scale(${n(e.xScale || 1)} ${n(e.yScale || 1)}) translate(${n(-(blk.position?.x || 0))} ${n(-(blk.position?.y || 0))})`;
        return `<g transform="${tr}">${(blk.entities || []).map(x => ent(x, depth + 1)).join('')}</g>`;
      }
      default: skip(e.type); return '';
    }
  }
  const body = (dxf.entities || []).map(e => ent(e, 0)).join('\n');
  const warnings = Object.keys(counts.skipped).length ? [`표시하지 못한 객체: ${Object.entries(counts.skipped).map(([k, v]) => `${k} ${v}`).join(', ')}`] : [];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g id="cad" transform="scale(1 -1)">${body}</g></svg>`;
  return { svg, engine: 'dxf-parser', entities: (dxf.entities || []).length, skipped: Object.values(counts.skipped).reduce((a, b) => a + b, 0), warnings };
}

// DXF 문자 인코딩: UTF-8 이 아니면 한글 Windows(CP949)로 해석
function decodeDxf(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('euc-kr').decode(buf); }
}

// ---------- SVG → PDF ----------
async function svgToPdf(svg) {
  const { chromium } = require('playwright');
  const config = require('../config');
  const b = await chromium.launch(config.chromiumPath ? { executablePath: config.chromiumPath } : {});
  try {
    const page = await b.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#fff} svg{display:block}
      svg *{stroke:#000 !important; stroke-width:0.6px !important; vector-effect:non-scaling-stroke}
      svg text, svg .t{fill:#000 !important; stroke:none !important; font-family:'Noto Sans CJK KR',sans-serif}
      svg path, svg circle, svg ellipse, svg polygon, svg rect{fill-opacity:0.15}
      svg [fill="none"]{fill:none}
    </style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
    // <use> 참조를 실제 요소로 펼침 (흑백 스타일이 블록 내부에도 적용되도록)
    await page.evaluate(() => {
      for (let round = 0; round < 10; round++) {
        const uses = [...document.querySelectorAll('svg use')];
        if (!uses.length) break;
        for (const u of uses) {
          const ref = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, '');
          const src = ref && document.getElementById(ref);
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const x = Number(u.getAttribute('x') || 0), y = Number(u.getAttribute('y') || 0);
          g.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${x} ${y})`);
          for (const a of ['stroke', 'fill']) if (u.getAttribute(a)) g.setAttribute(a, u.getAttribute(a));
          if (src) { const c = src.cloneNode(true); c.removeAttribute('id'); g.appendChild(c); }
          u.replaceWith(g);
        }
      }
      document.querySelectorAll('svg defs').forEach(d => d.remove());
    });
    // 실제 그려진 범위로 보기 영역 재계산
    const box = await page.evaluate(() => {
      const s = document.querySelector('svg');
      const bb = s.getBBox(); // 루트 기준(변환 적용 후) 범위
      return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    });
    if (!(box.w > 0 && box.h > 0)) throw new Error('도면에서 그릴 수 있는 객체를 찾지 못했습니다.');
    const pad = Math.max(box.w, box.h) * 0.02;
    const vb = [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2];
    // 용지: 긴 변 420mm(A3 가로 기준), 짧은 변은 비율대로 (최소 120mm)
    const landscape = vb[2] >= vb[3];
    const longMm = 420; const shortMm = Math.max(120, Math.round(longMm * Math.min(vb[2], vb[3]) / Math.max(vb[2], vb[3])));
    const wMm = landscape ? longMm : shortMm, hMm = landscape ? shortMm : longMm;
    await page.evaluate(({ vb, wMm, hMm }) => {
      const s = document.querySelector('svg');
      s.setAttribute('viewBox', vb.join(' ')); s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      s.setAttribute('width', wMm + 'mm'); s.setAttribute('height', hMm + 'mm');
      s.removeAttribute('style');
    }, { vb, wMm, hMm });
    const pdf = await page.pdf({ width: wMm + 'mm', height: hMm + 'mm', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, pageRanges: '1' });
    return { pdf, widthMm: wMm, heightMm: hMm };
  } finally { await b.close(); }
}

async function convertCad(buf, ext) {
  const t0 = Date.now();
  const r = ext === '.dwg' ? await dwgToSvg(buf) : dxfToSvg(decodeDxf(buf));
  const p = await svgToPdf(r.svg);
  return { ...r, pdf: p.pdf, ms: Date.now() - t0, note: `${ext.slice(1).toUpperCase()} 자동 변환 (${r.engine}) · 객체 ${r.entities}개${r.skipped ? ` 중 ${r.skipped}개 미표시` : ''}${r.warnings.length ? ' · ' + r.warnings.join(' / ') : ''}` };
}

module.exports = { convertCad, dwgToSvg, dxfToSvg };
