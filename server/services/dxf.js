'use strict';
/* DXF 해석: dxf-parser로 읽은 엔티티를 화면·출력용 단순 벡터 JSON으로 변환합니다.
 * 지원: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE(근사), SPLINE(제어점 근사), TEXT, MTEXT, POINT, SOLID, INSERT(블록 전개), DIMENSION(블록 전개)
 * 미지원 엔티티는 개수와 함께 경고로 보고합니다(HATCH 채움, IMAGE, 3D 객체 등). */
const fs = require('fs');
const DxfParser = require('dxf-parser');

const ACI = { 1: '#ff0000', 2: '#c8b400', 3: '#00a000', 4: '#00a0a0', 5: '#0000ff', 6: '#c000c0', 7: '#000000', 8: '#808080', 9: '#b0b0b0', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#e0e0e0' };
const UNITS = { 0: '단위 없음', 1: 'inch', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm' };
const UPM = { 1: 39.3701, 2: 3.28084, 4: 1000, 5: 100, 6: 1, 14: 10 };

// 흰 배경에서 보이도록 밝은 색(흰색·노랑 등)은 어둡게 조정
function hexOf(n) {
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (lum > 200) { if (r > 240 && g > 240 && b > 240) r = g = b = 0; else { const k = 150 / lum; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); } }
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function colorOf(e, layers) {
  if (e.color != null && typeof e.color === 'number' && e.colorIndex !== 256 && e.colorIndex !== undefined && e.colorIndex !== 0) return hexOf(e.color);
  const L = layers[e.layer]; if (L && L.color != null) return hexOf(L.color);
  return '#000000';
}
function cleanMtext(s) { return String(s || '').replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/\\~/g, ' '); }

function parseDxfFile(file) {
  let txt = fs.readFileSync(file);
  // 인코딩: UTF-8 우선, 실패 시 CP949 추정 (AutoCAD 2007 이전)
  let s = txt.toString('utf8');
  if (s.includes('�')) { try { s = new TextDecoder('euc-kr').decode(txt); } catch { } }
  const parser = new DxfParser();
  const dxf = parser.parseSync(s);
  return convert(dxf);
}

function convert(dxf) {
  const warn = []; const unsupported = {};
  const layersT = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
  const blocks = dxf.blocks || {};
  const hdr = dxf.header || {};
  const insunits = hdr.$INSUNITS;
  const out = { model: [], paper: [] };
  const xrefs = []; const fonts = new Set();
  Object.values(blocks).forEach(b => { if (b.xrefPath || (b.type & 4)) xrefs.push({ name: b.name, path: b.xrefPath || '' }); });
  const styles = (dxf.tables && dxf.tables.style && dxf.tables.style.styles) || {};
  Object.values(styles).forEach(st => { if (st.fontFile) fonts.add(st.fontFile); if (st.bigFontFile) fonts.add(st.bigFontFile); });

  function emit(list, e, M, layerOverride, depth) {
    const L = (e.layer === '0' && layerOverride) ? layerOverride : (e.layer || '0');
    const c = colorOf(e, layersT);
    const T = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
    const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    switch (e.type) {
      case 'LINE': { const a = T(e.vertices[0].x, e.vertices[0].y), b = T(e.vertices[1].x, e.vertices[1].y); list.push({ t: 'p', L, c, p: [a, b] }); break; }
      case 'LWPOLYLINE': case 'POLYLINE': {
        const v = (e.vertices || []).filter(p => p && p.x != null);
        if (!v.length) break;
        const pts = [];
        for (let i = 0; i < v.length; i++) {
          const a = v[i], b = v[(i + 1) % v.length];
          pts.push(T(a.x, a.y));
          if (a.bulge && (i < v.length - 1 || e.shape)) { // 호 근사
            const th = 4 * Math.atan(a.bulge); const dx = b.x - a.x, dy = b.y - a.y; const ch = Math.hypot(dx, dy); if (!ch) continue;
            const r = ch / (2 * Math.sin(th / 2)); const ach = Math.atan2(dy, dx) + Math.PI / 2 - th / 2;
            const cx = a.x + r * Math.cos(ach), cy = a.y + r * Math.sin(ach); const a0 = Math.atan2(a.y - cy, a.x - cx); const n = 8; const rr = Math.abs(r);
            for (let k = 1; k < n; k++) { const t = a0 + th * k / n; pts.push(T(cx + rr * Math.cos(t), cy + rr * Math.sin(t))); }
          }
        }
        if (e.shape || e.closed) pts.push(pts[0]);
        list.push({ t: 'p', L, c, p: pts }); break;
      }
      case 'CIRCLE': { const ctr = T(e.center.x, e.center.y); list.push({ t: 'c', L, c, x: ctr[0], y: ctr[1], r: e.radius * sc }); break; }
      case 'ARC': {
        const n = 24; const pts = []; let a0 = e.startAngle, a1 = e.endAngle; if (a1 < a0) a1 += Math.PI * 2;
        for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; pts.push(T(e.center.x + e.radius * Math.cos(t), e.center.y + e.radius * Math.sin(t))); }
        list.push({ t: 'p', L, c, p: pts }); break;
      }
      case 'ELLIPSE': {
        const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y; const ra = Math.hypot(mx, my), rb = ra * e.axisRatio, rot = Math.atan2(my, mx);
        let a0 = e.startAngle || 0, a1 = e.endAngle || Math.PI * 2; if (a1 < a0) a1 += Math.PI * 2; const n = 36; const pts = [];
        for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; const x = ra * Math.cos(t), y = rb * Math.sin(t); pts.push(T(e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot))); }
        list.push({ t: 'p', L, c, p: pts }); break;
      }
      case 'SPLINE': {
        // B-스플라인(de Boor) 평가. 매듭·차수 정보가 없으면 맞춤점/제어점 연결로 근사
        const cp = (e.controlPoints || []).map(p => [p.x, p.y]);
        const k = e.degreeOfSplineCurve || 3; const kn = e.knotValues || [];
        const wts = e.weights;
        let pts = null;
        if (cp.length > k && kn.length === cp.length + k + 1) {
          pts = []; const t0 = kn[k], t1 = kn[cp.length]; const N = Math.min(200, cp.length * 12);
          for (let si = 0; si <= N; si++) {
            const t = si === N ? t1 - 1e-9 * (t1 - t0) : t0 + (t1 - t0) * si / N;
            let sI = k; while (sI < cp.length - 1 && kn[sI + 1] <= t) sI++;
            const d = []; for (let j = 0; j <= k; j++) { const c = cp[sI - k + j]; const w = wts ? wts[sI - k + j] : 1; d.push([c[0] * w, c[1] * w, w]); }
            for (let r = 1; r <= k; r++) for (let j = k; j >= r; j--) { const i = sI - k + j; const den = kn[i + k - r + 1] - kn[i]; const a = den ? (t - kn[i]) / den : 0; d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]]; }
            pts.push(T(d[k][0] / d[k][2], d[k][1] / d[k][2]));
          }
        } else {
          const fp = e.fitPoints && e.fitPoints.length ? e.fitPoints.map(p => [p.x, p.y]) : cp;
          if (fp.length >= 3 && e.fitPoints && e.fitPoints.length) {
            // 맞춤점만 있는 스플라인: 맞춤점을 지나는 곡선(Catmull-Rom 보간)으로 표시
            pts = []; const P = [fp[0]].concat(fp, [fp[fp.length - 1]]);
            for (let i = 1; i < P.length - 2; i++) for (let st = 0; st < 10; st++) { const t = st / 10, t2 = t * t, t3 = t2 * t; const f = j => 0.5 * ((2 * P[i][j]) + (-P[i - 1][j] + P[i + 1][j]) * t + (2 * P[i - 1][j] - 5 * P[i][j] + 4 * P[i + 1][j] - P[i + 2][j]) * t2 + (-P[i - 1][j] + 3 * P[i][j] - 3 * P[i + 1][j] + P[i + 2][j]) * t3); pts.push(T(f(0), f(1))); }
            pts.push(T(fp[fp.length - 1][0], fp[fp.length - 1][1]));
          } else if (fp.length) { pts = fp.map(q => T(q[0], q[1])); unsupported['SPLINE(정보 부족, 근사 표시)'] = (unsupported['SPLINE(정보 부족, 근사 표시)'] || 0) + 1; }
        }
        if (pts && pts.length > 1) list.push({ t: 'p', L, c, p: pts });
        break;
      }
      case 'ATTDEF': break; // 블록 속성 정의: AutoCAD도 삽입된 블록에서는 표시하지 않음(값은 ATTRIB로 표시)
      case 'SOLID': case '3DFACE': { const v = (e.points || e.vertices || []).map(p => T(p.x, p.y)); if (v.length >= 3) list.push({ t: 'p', L, c, p: v.concat([v[0]]) }); break; }
      case 'POINT': { const p = T(e.position.x, e.position.y); list.push({ t: 'c', L, c, x: p[0], y: p[1], r: 0.5 * sc }); break; }
      case 'TEXT': case 'MTEXT': case 'ATTRIB': {
        const pos = e.startPoint || e.position; if (!pos) break; const p = T(pos.x, pos.y);
        const rot = (e.rotation || 0) + Math.atan2(M[1], M[0]) * 180 / Math.PI;
        const s = e.type === 'MTEXT' ? cleanMtext(e.text) : String(e.text || '');
        if (s.trim()) list.push({ t: 'tx', L, c, x: p[0], y: p[1], h: (e.textHeight || e.height || 2.5) * sc, rot, s, top: e.type === 'MTEXT' });
        break;
      }
      case 'INSERT': case 'DIMENSION': {
        const bname = e.name || e.block; const b = blocks[bname];
        if (!b) { if (e.type === 'INSERT') { unsupported['INSERT(블록 없음:' + bname + ')'] = (unsupported['INSERT(블록 없음:' + bname + ')'] || 0) + 1; } break; }
        if (b.xrefPath || (b.type & 4)) { unsupported['외부참조(XREF) 미포함'] = (unsupported['외부참조(XREF) 미포함'] || 0) + 1; break; }
        if (depth > 8) { warn.push('블록 중첩 깊이 초과: ' + bname); break; }
        const ip = e.position || { x: 0, y: 0 }; const bp = b.position || { x: 0, y: 0 };
        const sx = e.xScale || 1, sy = e.yScale || 1, r = (e.rotation || 0) * Math.PI / 180;
        const cols = e.columnCount || 1, rows = e.rowCount || 1;
        for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
          const ox = ip.x + ci * (e.columnSpacing || 0), oy = ip.y + ri * (e.rowSpacing || 0);
          // 로컬: p' = R*S*(p - bp) + ip
          const a = Math.cos(r) * sx, b2 = Math.sin(r) * sx, c2 = -Math.sin(r) * sy, d = Math.cos(r) * sy;
          const e2 = ox - (a * bp.x + c2 * bp.y), f = oy - (b2 * bp.x + d * bp.y);
          const N = e.type === 'DIMENSION' ? [1, 0, 0, 1, 0, 0] : [a, b2, c2, d, e2, f];
          const MM = [M[0] * N[0] + M[2] * N[1], M[1] * N[0] + M[3] * N[1], M[0] * N[2] + M[2] * N[3], M[1] * N[2] + M[3] * N[3], M[0] * N[4] + M[2] * N[5] + M[4], M[1] * N[4] + M[3] * N[5] + M[5]];
          (b.entities || []).forEach(be => emit(list, be, MM, L === '0' ? layerOverride : L, depth + 1));
        }
        break;
      }
      default:
        unsupported[e.type] = (unsupported[e.type] || 0) + 1;
    }
  }
  const I = [1, 0, 0, 1, 0, 0];
  (dxf.entities || []).forEach(e => emit(e.inPaperSpace ? out.paper : out.model, e, I, null, 0));
  // 범위 계산 후 Y 반전 → 도면 좌표 (x - minX, maxY - y)
  function finalize(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ext = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    list.forEach(e => { if (e.p) e.p.forEach(p => ext(p[0], p[1])); else if (e.t === 'c') { ext(e.x - e.r, e.y - e.r); ext(e.x + e.r, e.y + e.r); } else ext(e.x, e.y); });
    if (!isFinite(x0)) return { entities: [], width: 0, height: 0, origin: [0, 0] };
    const pad = Math.max(x1 - x0, y1 - y0) * 0.02;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const F = (x, y) => [round(x - x0), round(y1 - y)];
    list.forEach(e => { if (e.p) e.p = e.p.map(p => F(p[0], p[1])); else { const q = F(e.x, e.y); e.x = q[0]; e.y = q[1]; if (e.r) e.r = round(e.r); if (e.h) e.h = round(e.h); } });
    return { entities: list, width: round(x1 - x0), height: round(y1 - y0), origin: [x0, y1] };
  }
  const round = v => Math.round(v * 1000) / 1000;
  const model = finalize(out.model), paper = finalize(out.paper);
  const layers = {};
  Object.values(layersT).forEach(l => { layers[l.name] = { color: l.color != null ? hexOf(l.color) : '#000000', visible: l.visible !== false && !l.frozen }; });
  [...model.entities, ...paper.entities].forEach(e => { if (!layers[e.L]) layers[e.L] = { color: '#000000', visible: true }; });
  const fontWarn = [...fonts].filter(f => /\.shx$/i.test(f) || !/\.(ttf|ttc|otf)$/i.test(f));
  if (fontWarn.length) warn.push(`CAD 글꼴(${fontWarn.slice(0, 6).join(', ')}${fontWarn.length > 6 ? ' 외' : ''})은 서버에 없으므로 Noto Sans KR로 대체 표시합니다. 글자 폭·위치가 원본과 다를 수 있습니다.`);
  if (xrefs.length) warn.push(`외부참조(XREF) ${xrefs.length}개 누락: ${xrefs.map(x => x.name + (x.path ? '(' + x.path + ')' : '')).join(', ')} – 참조 도면을 별도 업로드하거나 CAD에서 바인드 후 다시 업로드하세요.`);
  Object.keys(unsupported).forEach(k => warn.push(`미지원/근사 객체: ${k} ${unsupported[k]}개`));
  if (insunits == null || insunits === 0) warn.push('도면 단위($INSUNITS)가 지정되지 않았습니다. 축척 보정에서 단위를 직접 확인하세요.');
  return {
    units: { code: insunits == null ? null : insunits, name: UNITS[insunits] || (insunits == null ? '미지정' : '기타(' + insunits + ')'), upm: UPM[insunits] || null },
    model, paper, layers, warnings: warn, unsupported, xrefs, fonts: [...fonts],
    stats: { model: model.entities.length, paper: paper.entities.length }
  };
}

module.exports = { parseDxfFile, UPM, UNITS };
