// DXF 분석(단위·레이어·객체·치수·닫힌 윤곽) 및 사용자 두께 입력 기반 돌출(Extrude) 3D 생성.
// 정확도 원칙: 도면에 두께 정보가 없으므로 두께는 반드시 사용자가 입력해야 하며, 임의로 정하지 않는다.
import DxfParser from 'dxf-parser';
import * as THREE from 'three';
import { writeGlb, summarize } from './gltf-writer.js';

const UNITS = { 0: ['미지정', 1], 1: ['inch', 25.4], 2: ['feet', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };
const TOL = 1e-3;

export function analyzeDxf(buf) {
  let dxf;
  try { dxf = new DxfParser().parseSync(buf.toString('utf8')); } catch (e) { throw new Error('DXF 를 해석하지 못했습니다: ' + e.message); }
  const code = dxf.header?.$INSUNITS ?? 0;
  const [unitName, scale] = UNITS[code] || ['기타', 1];
  const ents = dxf.entities || [];
  const counts = {};
  for (const e of ents) counts[e.type] = (counts[e.type] || 0) + 1;

  const loops = [];
  const open = [];
  for (const e of ents) {
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length > 1) {
      const pts = polyPoints(e.vertices, e.shape || e.closed);
      if (e.shape || e.closed) loops.push({ layer: e.layer, source: e.type, pts });
      else open.push({ layer: e.layer, a: pts[0], b: pts[pts.length - 1], pts });
    } else if (e.type === 'CIRCLE') {
      loops.push({ layer: e.layer, source: 'CIRCLE', pts: arcPts(e.center, e.radius, 0, Math.PI * 2, 64), circle: { r: e.radius, c: [e.center.x, e.center.y] } });
    } else if (e.type === 'LINE') {
      const a = [e.vertices[0].x, e.vertices[0].y], b = [e.vertices[1].x, e.vertices[1].y];
      open.push({ layer: e.layer, a, b, pts: [a, b] });
    } else if (e.type === 'ARC') {
      let s = e.startAngle, en = e.endAngle; if (en < s) en += Math.PI * 2;
      const pts = arcPts(e.center, e.radius, s, en, Math.max(8, Math.ceil((en - s) / (Math.PI / 24))));
      open.push({ layer: e.layer, a: pts[0], b: pts[pts.length - 1], pts });
    }
  }
  loops.push(...chainLoops(open));
  // 면적순 정렬 후 포함관계로 외곽/구멍 판정
  for (const l of loops) { l.area = Math.abs(area(l.pts)); }
  loops.sort((a, b) => b.area - a.area);
  loops.forEach((l, i) => { l.id = `L${i + 1}`; l.parent = null; });
  for (let i = 0; i < loops.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (loops[j].area > loops[i].area && inside(loops[i].pts[0], loops[j].pts)) { loops[i].parent = loops[j].id; break; }
    }
  }
  const byId = Object.fromEntries(loops.map((l) => [l.id, l]));
  const depth = (l) => (l.parent ? 1 + depth(byId[l.parent]) : 0);
  const profiles = loops.map((l) => {
    const bb = bbox(l.pts);
    return {
      id: l.id, layer: l.layer, source: l.source, role: depth(l) % 2 === 0 ? 'outer' : 'hole', parent: l.parent,
      area: +(l.area * scale * scale).toFixed(3), bbox: bb.map((p) => p.map((v) => +(v * scale).toFixed(3))),
      ...(l.circle ? { diameter: +(l.circle.r * 2 * scale).toFixed(3) } : {}),
      points: simplify(l.pts).map(([x, y]) => [+(x * scale).toFixed(4), +(y * scale).toFixed(4)]),
    };
  });
  const dims = ents.filter((e) => e.type === 'DIMENSION').map((e) => {
    const v = dimValue(e);
    return { layer: e.layer, kind: DIMKIND[(e.dimensionType ?? 0) & 7] || '기타', value: v != null ? +(v * scale).toFixed(3) : null, text: e.text || null };
  });
  const texts = ents.filter((e) => e.type === 'TEXT' || e.type === 'MTEXT').map((e) => (e.text || '').replace(/\\P/g, ' ')).filter(Boolean);
  const outer = profiles.filter((p) => p.role === 'outer');
  const geomSize = outer.length ? [outer[0].bbox[1][0] - outer[0].bbox[0][0], outer[0].bbox[1][1] - outer[0].bbox[0][1]] : null;
  // 치수 검증: 각 치수값이 최대 외곽의 가로/세로와 일치하는지 확인
  const dimCheck = dims.filter((d) => d.value != null).map((d) => {
    const match = geomSize?.find((g) => Math.abs(g - d.value) < 0.01);
    return { ...d, matchesOutline: match != null };
  });
  return {
    format: 'DXF', is3D: false, version: dxf.header?.$ACADVER || null,
    unit: unitName, unitCode: code, unitScaleToMm: scale,
    coordinateSystem: 'WCS 2D (XY 평면)', scaleNote: '모형공간 1:1 기준. 도면 축척(배치) 인식은 미지원',
    layers: Object.keys(dxf.tables?.layer?.layers || {}),
    entityCounts: counts, profiles, dimensions: dimCheck, texts,
    openChains: open.length - loops.filter((l) => l.source === 'CHAIN').reduce((s, l) => s + l.segs, 0),
    convertible: outer.length > 0,
    needsUserInput: ['thickness'],
    warnings: [
      ...(code === 0 ? ['도면 단위가 지정되지 않아 mm 로 간주합니다. 확인이 필요합니다.'] : []),
      '2D 도면에는 두께(깊이) 정보가 없으므로 두께를 직접 입력해야 3D 생성이 됩니다.',
    ],
  };
}

/** @param analysis analyzeDxf 결과, @param input {thickness:number, profiles?:string[], perProfile?:Record<string,number>} */
export async function extrudeDxf(analysis, input, name) {
  const t = Number(input?.thickness);
  if (!(t > 0)) { const e = new Error('두께(mm)를 입력해야 3D 모델을 생성할 수 있습니다'); e.status = 400; throw e; }
  const sel = new Set(input.profiles?.length ? input.profiles : analysis.profiles.filter((p) => p.role === 'outer').map((p) => p.id));
  const outers = analysis.profiles.filter((p) => p.role === 'outer' && sel.has(p.id));
  if (!outers.length) { const e = new Error('돌출할 닫힌 외곽 윤곽이 없습니다'); e.status = 400; throw e; }
  const children = outers.map((o, i) => {
    const shape = new THREE.Shape(o.points.map(([x, y]) => new THREE.Vector2(x, y)));
    const holes = analysis.profiles.filter((h) => h.role === 'hole' && h.parent === o.id);
    for (const h of holes) shape.holes.push(new THREE.Path(h.points.map(([x, y]) => new THREE.Vector2(x, y))));
    const depth = Number(input.perProfile?.[o.id]) > 0 ? Number(input.perProfile[o.id]) : t;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
    g.computeVertexNormals();
    return {
      name: outers.length === 1 ? name : `${name}_${i + 1}`,
      meshes: [{ positions: g.attributes.position.array, normals: g.attributes.normal.array, color: [0.55, 0.58, 0.62], metallic: 0.7, roughness: 0.35 }],
      extras: { profileId: o.id, holes: holes.map((h) => h.id), thickness: depth, provenance: { outline: 'drawing', thickness: 'user' } },
      children: [],
    };
  });
  const { glb, parts } = await writeGlb({ name, children }, { unit: 'mm' });
  return {
    glb, parts, method: 'dxf-extrude',
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm' },
    provenance: {
      geometry: 'mixed',
      items: [
        { what: '외곽·구멍 윤곽 (XY)', source: 'drawing', label: '원본 도면에서 확인된 형상' },
        { what: `두께 ${t} mm (Z)`, source: 'user', label: '사용자 입력으로 확정된 형상' },
        ...(analysis.openChains > 0 ? [{ what: `열린 선분 ${analysis.openChains}개`, source: 'unbuildable', label: '생성할 수 없는 형상 (닫히지 않음)' }] : []),
      ],
      ai: [],
    },
  };
}

const DIMKIND = { 0: '선형', 1: '평행', 2: '각도', 3: '지름', 4: '반지름', 5: '각도(3점)', 6: '좌표' };
// 치수값: 측정값(코드 42) → 숫자 문자 재정의 → 정의점으로 계산 순
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

// ── 기하 유틸 ──────────────────────────────────────────────────
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
function arcPts(c, r, s, e, n) {
  const pts = [];
  const full = Math.abs(e - s - Math.PI * 2) < 1e-9;
  for (let i = 0; i < (full ? n : n + 1); i++) { const a = s + ((e - s) * i) / n; pts.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); }
  return pts;
}
function chainLoops(segs) {
  const used = new Set(); const loops = [];
  const eq = (p, q) => Math.abs(p[0] - q[0]) < TOL && Math.abs(p[1] - q[1]) < TOL;
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const chain = [...segs[i].pts]; const idx = [i]; let closed = false;
    for (let guard = 0; guard < segs.length && !closed; guard++) {
      const end = chain[chain.length - 1];
      let found = false;
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j) || idx.includes(j)) continue;
        if (eq(segs[j].a, end)) { chain.push(...segs[j].pts.slice(1)); idx.push(j); found = true; break; }
        if (eq(segs[j].b, end)) { chain.push(...[...segs[j].pts].reverse().slice(1)); idx.push(j); found = true; break; }
      }
      if (eq(chain[chain.length - 1], chain[0]) && idx.length > 1) closed = true;
      if (!found) break;
    }
    if (closed) { idx.forEach((k) => used.add(k)); chain.pop(); loops.push({ layer: segs[i].layer, source: 'CHAIN', pts: chain, segs: idx.length }); }
  }
  return loops;
}
const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function bbox(p) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
function simplify(p) { return p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 1e-6); }
