// 2D 도면(DXF·DWG·PDF) 공통: 선분 연결 → 닫힌 윤곽 → 외곽/구멍/도곽 판정 → 돌출 3D
import * as THREE from 'three';
import { writeGlb, summarize } from './gltf-writer.js';

const MAX_LOOPS = 3000;

/** 열린 선분을 끝점 일치로 이어 닫힌 고리 생성 (끝점 해시로 O(n)) */
export function chainLoops(segs, tol = 1e-3) {
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map();
  segs.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const used = new Set(); const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const idx = [i]; const chain = [...segs[i].pts]; const mine = new Set([i]);
    let closed = false;
    for (let guard = 0; guard < segs.length; guard++) {
      const end = chain[chain.length - 1];
      if (idx.length > 1 && key(end) === key(chain[0])) { closed = true; break; }
      const next = (ends.get(key(end)) || []).find((j) => !used.has(j) && !mine.has(j));
      if (next == null) break;
      const s = segs[next];
      chain.push(...(key(s.a) === key(end) ? s.pts : [...s.pts].reverse()).slice(1));
      idx.push(next); mine.add(next);
    }
    if (closed) { idx.forEach((k) => used.add(k)); chain.pop(); loops.push({ layer: segs[i].layer, source: 'CHAIN', pts: chain, segs: idx.length }); }
  }
  return { loops, usedSegs: used.size };
}

/**
 * @param loops [{layer, source, pts, circle?}] 닫힌 고리 (원본 단위)
 * @param open  [{layer, a, b, pts}] 열린 선분
 * @param scale 원본 단위 → mm
 * @param page  (선택) 용지 경계 {w,h} — 이를 거의 덮는 고리는 도곽(frame)으로 표시
 * @param tol   선분 끝점 일치 허용오차 (원본 단위)
 */
export function buildProfiles(loops, open, scale, page, tol = 1e-3) {
  const ch = chainLoops(open, tol);
  const all = [...loops, ...ch.loops].filter((l) => l.pts.length >= 3);
  for (const l of all) l.area = Math.abs(area(l.pts));
  all.sort((a, b) => b.area - a.area);
  const kept = all.filter((l) => l.area > 1e-9).slice(0, MAX_LOOPS);
  kept.forEach((l, i) => { l.id = `L${i + 1}`; l.parent = null; l.bb = bbox(l.pts); });
  for (let i = 0; i < kept.length; i++) {
    const p0 = kept[i].pts[0];
    for (let j = i - 1; j >= 0; j--) {
      const o = kept[j];
      if (o.area > kept[i].area && p0[0] >= o.bb[0][0] && p0[0] <= o.bb[1][0] && p0[1] >= o.bb[0][1] && p0[1] <= o.bb[1][1] && inside(p0, o.pts)) { kept[i].parent = o.id; break; }
    }
  }
  const byId = Object.fromEntries(kept.map((l) => [l.id, l]));
  // 도곽(도면 테두리·표제란 틀) 판정: 용지의 85% 이상을 덮는 고리
  const isFrame = (l) => page && (l.bb[1][0] - l.bb[0][0]) >= page.w * 0.85 && (l.bb[1][1] - l.bb[0][1]) >= page.h * 0.85;
  const frames = new Set(kept.filter(isFrame).map((l) => l.id));
  // 도곽 안쪽 고리는 도곽을 부모로 보지 않는다
  for (const l of kept) while (l.parent && frames.has(l.parent)) l.parent = byId[l.parent].parent;
  const depth = (l) => (l.parent ? 1 + depth(byId[l.parent]) : 0);
  const profiles = kept.map((l) => ({
    id: l.id, layer: l.layer, source: l.source,
    role: frames.has(l.id) ? 'frame' : depth(l) % 2 === 0 ? 'outer' : 'hole', parent: l.parent,
    area: +(l.area * scale * scale).toFixed(3), bbox: l.bb.map((p) => p.map((v) => +(v * scale).toFixed(3))),
    ...(l.circle ? { diameter: +(l.circle.r * 2 * scale).toFixed(3) } : roundDia(l, scale)),
    points: simplify(l.pts).map(([x, y]) => [+(x * scale).toFixed(4), +(y * scale).toFixed(4)]),
  }));
  return { profiles, openChains: open.length - ch.usedSegs, truncated: all.length > MAX_LOOPS };
}

/** 치수값이 가장 큰 외곽의 가로/세로와 일치하는지 */
export function checkDims(dims, profiles) {
  const outer = profiles.find((p) => p.role === 'outer');
  const g = outer ? [outer.bbox[1][0] - outer.bbox[0][0], outer.bbox[1][1] - outer.bbox[0][1]] : [];
  return dims.map((d) => ({ ...d, matchesOutline: d.value != null && g.some((x) => Math.abs(x - d.value) < Math.max(0.01, d.value * 0.002)) }));
}

/**
 * 돌출 3D 생성. input: {thickness(필수), scale?(PDF 필수, 1:N 의 N), profiles?, perProfile?}
 * 정확도 원칙: 두께·축척은 도면에 없으므로 반드시 사용자 입력.
 */
export async function extrude2d(analysis, input, name) {
  const t = Number(input?.thickness);
  if (!(t > 0)) throw httpErr('두께(mm)를 입력해야 3D 모델을 생성할 수 있습니다');
  let k = 1;
  if (analysis.scaleRequired) {
    k = Number(input?.scale);
    if (!(k > 0)) throw httpErr('PDF 도면은 축척(1:N 의 N)을 입력해야 실제 치수로 만들 수 있습니다');
  }
  const sel = new Set(input.profiles?.length ? input.profiles : analysis.profiles.filter((p) => p.role === 'outer').map((p) => p.id));
  const outers = analysis.profiles.filter((p) => p.role !== 'hole' && sel.has(p.id));
  if (!outers.length) throw httpErr('돌출할 닫힌 외곽 윤곽을 선택하세요');
  const S = (pts) => pts.map(([x, y]) => new THREE.Vector2(x * k, y * k));
  const children = outers.map((o, i) => {
    const shape = new THREE.Shape(S(o.points));
    const holes = analysis.profiles.filter((h) => h.role === 'hole' && h.parent === o.id);
    for (const h of holes) shape.holes.push(new THREE.Path(S(h.points)));
    const depth = Number(input.perProfile?.[o.id]) > 0 ? Number(input.perProfile[o.id]) : t;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
    g.computeVertexNormals();
    return {
      name: outers.length === 1 ? name : `${name}_${i + 1}`,
      meshes: [{ positions: g.attributes.position.array, normals: g.attributes.normal.array, color: [0.55, 0.58, 0.62], metallic: 0.7, roughness: 0.35 }],
      extras: { profileId: o.id, holes: holes.map((h) => h.id), thickness: depth, ...(analysis.scaleRequired ? { scale: k } : {}),
        provenance: { outline: 'drawing', thickness: 'user', ...(analysis.scaleRequired ? { scale: 'user' } : {}) } },
      children: [],
    };
  });
  const { glb, parts } = await writeGlb({ name, children }, { unit: 'mm' });
  return {
    glb, parts, method: `${analysis.format.toLowerCase()}-extrude`,
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm' },
    provenance: {
      geometry: 'mixed',
      items: [
        { what: `외곽·구멍 윤곽 (XY)${analysis.format !== 'DXF' ? ` — ${analysis.format}` : ''}`, source: 'drawing', label: '원본 도면에서 확인된 형상' },
        ...(analysis.scaleRequired ? [{ what: `축척 1:${k}`, source: 'user', label: '사용자 입력으로 확정된 형상' }] : []),
        { what: `두께 ${t} mm (Z)`, source: 'user', label: '사용자 입력으로 확정된 형상' },
        ...(analysis.openChains > 0 ? [{ what: `열린 선분 ${analysis.openChains}개`, source: 'unbuildable', label: '생성할 수 없는 형상 (닫히지 않음)' }] : []),
      ],
      ai: [],
    },
  };
}
// 원 판별(원 객체가 아닌 경로로 그려진 구멍): 가로≈세로, 면적≈πr²
function roundDia(l, scale) {
  const w = l.bb[1][0] - l.bb[0][0], h = l.bb[1][1] - l.bb[0][1];
  if (l.pts.length < 12 || Math.abs(w - h) > 0.02 * w) return {};
  const ratio = l.area / (Math.PI * (w / 2) ** 2);
  return ratio > 0.97 && ratio < 1.01 ? { diameter: +(((w + h) / 2) * scale).toFixed(3) } : {};
}
const httpErr = (m) => Object.assign(new Error(m), { status: 400 });

export function arcPts(c, r, s, e, n) {
  const pts = [];
  const full = Math.abs(e - s - Math.PI * 2) < 1e-9;
  for (let i = 0; i < (full ? n : n + 1); i++) { const a = s + ((e - s) * i) / n; pts.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); }
  return pts;
}
export const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
export function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [[x0, y0], [x1, y1]];
}
function simplify(p) { return p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 1e-6); }
