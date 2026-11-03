'use strict';
/* DXF 내보내기 (AutoCAD R12 ASCII). 신규 설계 객체의 좌표·레이어·심볼(BLOCK/INSERT)·문자를 포함합니다.
 * 좌표: CAD 배경 도면은 원본 CAD 좌표로 복원, 이미지/PDF 도면은 축척 설정 시 m 단위(Y축 위쪽)로 변환 */
const fs = require('fs');
const path = require('path');
const CAT = require('../../shared/catalog');
const C = require('../../shared/calc');
const SYM = require('../../shared/symbols');

const ACI = { '#d62728': 1, '#1f77b4': 5, '#9467bd': 6, '#8c564b': 30, '#ff7f0e': 30, '#2ca02c': 3, '#e377c2': 6, '#17becf': 4, '#7f7f7f': 8, '#ffbf00': 2, '#000000': 7, '#555555': 8, '#888888': 8 };
const LT = { '': 'CONTINUOUS', '8 3': 'DASHED', '2 2': 'DOT', '10 3 2 3': 'DASHDOT', '4 2 1 2 1 2': 'DIVIDE', '14 4': 'HIDDEN', '6 2': 'DASHED', '2 2 8 2': 'DASHDOT', '3 3': 'HIDDEN' };
function esc(s) { return String(s || '').replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')); }

function exportDxf(model, sid, opts) {
  model = { ...model, devices: model.devices.map(d => SYM.attach(d, (model.project && model.project.settings) || {})) };
  const s = model.sheets.find(x => x.id === sid); const ix = C.index(model);
  const upm = C.upmOf(s);
  const W = s.bg.width, H = s.bg.height, rot = s.rotation || 0;
  // 표시좌표 → 배경 원좌표 (회전 역변환)
  const inv = p => { const [x, y] = p; switch (rot) { case 90: return [y, H - x]; case 180: return [W - x, H - y]; case 270: return [W - y, x]; default: return [x, y]; } };
  let T, units, unitNote;
  if (s.bg.kind === 'cad') { const o = s.bg.origin || [0, 0]; T = p => { const q = inv(p); return [q[0] + o[0], o[1] - q[1]]; }; units = (s.bg.cad_units && s.bg.cad_units.code) || 0; unitNote = 'CAD 원본 좌표'; }
  else if (upm) { T = p => [p[0] / upm, -p[1] / upm]; units = 6; unitNote = 'm 단위 (도면 좌상단 원점, Y축 위쪽)'; }
  else { T = p => [p[0], -p[1]]; units = 0; unitNote = '축척 미설정 – 이미지 픽셀 단위'; }
  const scl = s.bg.kind === 'cad' ? 1 : (upm ? 1 / upm : 1);
  const L = [];
  const r = v => Math.round(v * 10000) / 10000;
  const g = (c, v) => L.push(String(c), String(v));
  const layers = ((model.project.settings || {}).layers || CAT.LAYERS);
  // HEADER
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, units); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_949'); g(0, 'ENDSEC');
  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 6);
  [['CONTINUOUS', []], ['DASHED', [6, -2]], ['DOT', [0.5, -1]], ['DASHDOT', [6, -2, 0.5, -2]], ['DIVIDE', [4, -1.5, 0.5, -1.5, 0.5, -1.5]], ['HIDDEN', [3, -1.5]]].forEach(([n, pat]) => { g(0, 'LTYPE'); g(2, n); g(70, 0); g(3, n); g(72, 65); g(73, pat.length); g(40, pat.reduce((a, b) => a + Math.abs(b), 0)); pat.forEach(v => g(49, v)); });
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length + 2);
  const lname = k => 'CCTV-' + k;
  layers.forEach(l => { g(0, 'LAYER'); g(2, lname(l.key)); g(70, 0); g(62, ACI[l.color] || 7); g(6, LT[l.dash || ''] || 'CONTINUOUS'); });
  g(0, 'LAYER'); g(2, 'CCTV-LABEL'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  // BLOCKS: 장비 심볼
  g(0, 'SECTION'); g(2, 'BLOCKS');
  const blocks = new Map();
  model.devices.filter(d => d.sheet_id === sid).forEach(d => { const k = 'SYM_' + d.type.toUpperCase() + (d.type === 'camera' ? '_' + ({ '고정형': 'FIX', '돔형': 'DOME', '불릿형': 'BUL', 'PTZ': 'PTZ', '어안': 'FISH' }[(d.props || {}).form] || 'FIX') + '_' + ((d.props || {}).system === 'IP' ? 'IP' : 'AN') : '') + (d._symdef ? '_' + String(d._symdef.id).slice(0, 8) : ''); if (!blocks.has(k)) blocks.set(k, d); d._blk = k; });
  blocks.forEach((d, k) => {
    g(0, 'BLOCK'); g(8, '0'); g(2, k); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, k);
    SYM.prims({ ...d, props: { ...d.props, direction: 0 } }).prims.forEach(p => {
      if (p.t === 'rect') poly([[p.x, -p.y], [p.x + p.w, -p.y], [p.x + p.w, -(p.y + p.h)], [p.x, -(p.y + p.h)]], true, '0');
      else if (p.t === 'circle') { g(0, 'CIRCLE'); g(8, '0'); g(10, p.x); g(20, -p.y); g(30, 0); g(40, p.r); }
      else if (p.t === 'poly') poly(p.p.map(q => [q[0], -q[1]]), p.close, '0');
      else if (p.t === 'text') { g(0, 'TEXT'); g(8, '0'); g(10, p.x); g(20, -p.y); g(30, 0); g(40, p.size); g(1, esc(p.s)); g(72, 1); g(73, 2); g(11, p.x); g(21, -p.y); g(31, 0); }
    });
    g(0, 'ENDBLK'); g(8, '0');
  });
  g(0, 'ENDSEC');
  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES');
  function poly(pts, closed, layer, lt) { g(0, 'POLYLINE'); g(8, layer); if (lt) g(6, lt); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0); pts.forEach(p => { g(0, 'VERTEX'); g(8, layer); g(10, r(p[0])); g(20, r(p[1])); g(30, 0); }); g(0, 'SEQEND'); g(8, layer); }
  function text(p, h, s0, layer, rotDeg) { g(0, 'TEXT'); g(8, layer); g(10, r(p[0])); g(20, r(p[1])); g(30, 0); g(40, r(h)); g(1, esc(s0)); if (rotDeg) g(50, r(rotDeg)); }
  const [SW, SH] = rot % 180 ? [H, W] : [W, H];
  const symDU = +(s.sym_size || Math.max(SW, SH) / 70); const labDU = +(s.label_size || symDU * 0.42);
  // 배경 포함(선택, CAD 배경만)
  if (opts.includeBg && s.bg.kind === 'cad') {
    const f = opts.getFile(s.bg.file_id); const dx = JSON.parse(fs.readFileSync(path.join(f.dir, 'dxf.json'), 'utf8'))[s.bg.space || 'model'];
    const bgT = p => { const o = s.bg.origin || [0, 0]; return [p[0] + o[0], o[1] - p[1]]; };
    dx.entities.forEach(e => { const ly = 'BG-' + String(e.L).replace(/[^A-Za-z0-9_\-]/g, '_'); if (e.t === 'p') poly(e.p.map(bgT), false, ly); else if (e.t === 'c') { const q = bgT([e.x, e.y]); g(0, 'CIRCLE'); g(8, ly); g(10, r(q[0])); g(20, r(q[1])); g(30, 0); g(40, e.r); } else if (e.t === 'tx') text(bgT([e.x, e.y]), e.h, e.s, ly, e.rot); });
  }
  model.conduits.filter(c => c.sheet_id === sid).forEach(cd => { if ((cd.points || []).length < 2) return; poly(cd.points.map(T), false, lname('RACEWAY')); const m = cd.points[Math.floor(cd.points.length / 2)]; text(T(m), labDU * scl, cd.tag || '', 'CCTV-LABEL'); });
  model.cables.filter(c => c.sheet_id === sid).forEach(c => {
    const KD = CAT.CABLE_KINDS[c.kind]; const pts = C.cablePoints(c, ix); if (pts.length < 2) return;
    const ly = c.status === '철거' ? lname('DEMO') : lname(KD.layer);
    poly(pts.map(T), false, ly, LT[KD.dash] || 'CONTINUOUS');
    const pr = ix.prod.get(c.product_id); const len = C.cableLength(c, ix);
    let bi = 1, bl = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > bl) { bl = l; bi = i; } }
    const a = T(pts[bi - 1]), b = T(pts[bi]); let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    text([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + labDU * scl * 0.4], labDU * 0.85 * scl, `${c.tag || ''} ${pr ? pr.spec || pr.name : ''} ${len.final_m != null ? len.final_m + 'm' : ''}`, 'CCTV-LABEL', ang);
  });
  model.devices.filter(d => d.sheet_id === sid).forEach(d => {
    const T0 = CAT.DEVICE_TYPES[d.type]; const S = SYM.prims(d); const p = T([d.x, d.y]);
    const sz = symDU * (+(d.props || {}).sym_scale || 1) * scl;
    const rr = S.rotate ? -(+((d.props || {}).direction) || 0) : 0;
    g(0, 'INSERT'); g(8, d.status === '철거' ? lname('DEMO') : lname(d.layer || T0.layer)); g(2, d._blk); g(10, r(p[0])); g(20, r(p[1])); g(30, 0); g(41, r(sz)); g(42, r(sz)); g(43, r(sz)); if (rr) g(50, rr - (rot ? 0 : 0));
    text([p[0] + sz * 0.55, p[1] + sz * 0.55], labDU * scl, d.tag || '', 'CCTV-LABEL');
  });
  model.annotations.filter(a => a.sheet_id === sid).forEach(a => { const P = (a.points || []).map(T); if (!P.length) return; if (a.type === 'text') text(P[0], labDU * (+a.size || 1) * scl, a.text, lname('TEXT')); else { poly(P, a.type === 'area', lname('TEXT')); if (a.text) text(P[P.length - 1], labDU * scl, a.text, lname('TEXT')); } });
  // 좌표 기준 안내 문자
  text(T([0, 0]), labDU * scl * 0.8, `CCTV 설계 내보내기: ${unitNote}${opts.includeBg ? '' : ' / 원본 배경 미포함(원본 파일은 별도 보관)'}`, 'CCTV-LABEL');
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}
module.exports = { exportDxf };
