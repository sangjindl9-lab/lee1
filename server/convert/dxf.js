// DXF 분석: 단위·레이어·객체 수·치수·주석·닫힌 윤곽(블록 INSERT 전개 포함). 3D 는 profiles.extrude2d (두께 필수 입력).
import DxfParser from 'dxf-parser';
import { buildProfiles, checkDims, extrude2d, arcPts } from './profiles.js';

const UNITS = { 0: ['미지정', 1], 1: ['inch', 25.4], 2: ['feet', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };
const DIMKIND = { 0: '선형', 1: '평행', 2: '각도', 3: '지름', 4: '반지름', 5: '각도(3점)', 6: '좌표' };

/** UTF-8 이 아니면 CP949(EUC-KR) 로 해석 (국내 CAD 도면) */
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
}

export function analyzeDxf(buf, format = 'DXF') {
  let dxf;
  try { dxf = new DxfParser().parseSync(decode(buf)); } catch (e) { throw new Error(`${format} 를 해석하지 못했습니다: ` + e.message); }
  const code = dxf.header?.$INSUNITS ?? 0;
  const [unitName, scale] = UNITS[code] || ['기타', 1];
  const ents = dxf.entities || [];
  const counts = {};
  for (const e of ents) counts[e.type] = (counts[e.type] || 0) + 1;

  const loops = [], open = [], dims = [], texts = [];
  let skipped = 0;
  const I = (x, y) => [x, y];
  const visit = (e, T, depth, layerOverride) => {
    const layer = e.layer === '0' && layerOverride ? layerOverride : e.layer;
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length > 1) {
      const closed = e.shape || e.closed;
      const pts = polyPoints(e.vertices, closed).map(([x, y]) => T(x, y));
      if (closed) loops.push({ layer, source: e.type, pts }); else open.push({ layer, a: pts[0], b: pts[pts.length - 1], pts });
    } else if (e.type === 'CIRCLE') {
      const pts = arcPts(e.center, e.radius, 0, Math.PI * 2, 64).map(([x, y]) => T(x, y));
      const sc = Math.hypot(...[T(1, 0), T(0, 0)].reduce((a, b) => [a[0] - b[0], a[1] - b[1]]));
      loops.push({ layer, source: 'CIRCLE', pts, circle: { r: e.radius * sc } });
    } else if (e.type === 'LINE') {
      const a = T(e.vertices[0].x, e.vertices[0].y), b = T(e.vertices[1].x, e.vertices[1].y);
      open.push({ layer, a, b, pts: [a, b] });
    } else if (e.type === 'ARC') {
      let s = e.startAngle, en = e.endAngle; if (en < s) en += Math.PI * 2;
      const pts = arcPts(e.center, e.radius, s, en, Math.max(8, Math.ceil((en - s) / (Math.PI / 24)))).map(([x, y]) => T(x, y));
      open.push({ layer, a: pts[0], b: pts[pts.length - 1], pts });
    } else if (e.type === 'DIMENSION' && depth === 0) {
      const v = dimValue(e);
      dims.push({ layer, kind: DIMKIND[(e.dimensionType ?? 0) & 7] || '기타', value: v != null ? +(v * scale).toFixed(3) : null, text: e.text || null });
    } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) {
      texts.push(e.text.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, ''));
    } else if (e.type === 'INSERT' && depth < 4) {
      const blk = dxf.blocks?.[e.name];
      if (!blk?.entities) return;
      const sx = e.xScale ?? 1, sy = e.yScale ?? 1, r = ((e.rotation || 0) * Math.PI) / 180;
      const bx = blk.position?.x || 0, by = blk.position?.y || 0, px = e.position?.x || 0, py = e.position?.y || 0;
      const cos = Math.cos(r), sin = Math.sin(r);
      const T2 = (x, y) => { const u = (x - bx) * sx, v = (y - by) * sy; return T(px + u * cos - v * sin, py + u * sin + v * cos); };
      for (const be of blk.entities) visit(be, T2, depth + 1, layer);
    } else if (!['POINT', 'ATTDEF', 'ATTRIB', 'VIEWPORT'].includes(e.type)) skipped++;
  };
  for (const e of ents) visit(e, I, 0);

  const { profiles, openChains, truncated, views, groups } = buildProfiles(loops, open, scale);
  return {
    format, is3D: false, version: dxf.header?.$ACADVER || null,
    unit: unitName, unitCode: code, unitScaleToMm: scale,
    coordinateSystem: 'WCS 2D (XY 평면)', scaleNote: '모형공간 1:1 기준. 도면 축척(배치) 인식은 미지원',
    layers: Object.keys(dxf.tables?.layer?.layers || {}),
    entityCounts: counts, profiles, views, groups, dimensions: checkDims(dims.filter((d) => d.value != null), profiles), texts: texts.slice(0, 200),
    openChains, convertible: profiles.some((p) => p.role === 'outer'),
    needsUserInput: ['thickness'],
    warnings: [
      ...(code === 0 ? ['도면 단위가 지정되지 않아 mm 로 간주합니다. 확인이 필요합니다.'] : []),
      ...(skipped ? [`해석하지 않은 객체 ${skipped}개 (해치·스플라인·이미지 등)`] : []),
      ...(truncated ? ['닫힌 윤곽이 너무 많아 큰 순서로 3000개만 표시합니다.'] : []),
      '2D 도면에는 두께(깊이) 정보가 없으므로 두께를 직접 입력해야 3D 생성이 됩니다.',
    ],
  };
}

export const extrudeDxf = extrude2d;

function dimValue(e) {
  if (e.actualMeasurement != null) return e.actualMeasurement;
  const n = parseFloat(String(e.text || '').replace(/[^0-9.\-]/g, ''));
  if (e.text && e.text !== '<>' && Number.isFinite(n)) return n;
  const a = e.linearOrAngularPoint1, b = e.linearOrAngularPoint2, k = (e.dimensionType ?? 0) & 7;
  if (!a || !b) return null;
  if (k === 0) { const t = ((e.angle || 0) * Math.PI) / 180; return Math.abs((b.x - a.x) * Math.cos(t) + (b.y - a.y) * Math.sin(t)); }
  if (k === 1) return Math.hypot(b.x - a.x, b.y - a.y);
  return null;
}
function polyPoints(vs, closed) {
  const out = [];
  const n = vs.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = vs[i], b = vs[(i + 1) % n];
    out.push([a.x, a.y]);
    if (a.bulge) out.push(...bulgePts(a, b, a.bulge));
  }
  if (!closed) out.push([vs[n - 1].x, vs[n - 1].y]);
  return out;
}
function bulgePts(a, b, bulge) {
  const th = 4 * Math.atan(bulge);
  const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy);
  const r = c / (2 * Math.sin(th / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const h = r * Math.cos(th / 2);
  const cx = mx - (h * dy) / c * Math.sign(bulge) * Math.sign(r), cy = my + (h * dx) / c * Math.sign(bulge) * Math.sign(r);
  const s = Math.atan2(a.y - cy, a.x - cx);
  const seg = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 24)));
  const pts = [];
  for (let i = 1; i < seg; i++) { const ang = s + (th * i) / seg; pts.push([cx + Math.abs(r) * Math.cos(ang), cy + Math.abs(r) * Math.sin(ang)]); }
  return pts;
}
