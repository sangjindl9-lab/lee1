// 2D 도면(DXF·DWG·PDF) 공통: 선분 연결 → 닫힌 윤곽 → 외곽/구멍/도곽 판정 → 돌출 3D
import * as THREE from 'three';
import { writeGlb, summarize } from './gltf-writer.js';
import { detectViews } from './views.js';

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
  return { loops, usedSegs: used.size, used };
}

/**
 * @param loops [{layer, source, pts, circle?}] 닫힌 고리 (원본 단위)
 * @param open  [{layer, a, b, pts}] 열린 선분
 * @param scale 원본 단위 → mm
 * @param page  (선택) 용지 경계 {w,h} — 이를 거의 덮는 고리는 도곽(frame)으로 표시
 * @param tol   선분 끝점 일치 허용오차 (원본 단위)
 */
export function buildProfiles(loops, open, scale, page, tol = 1e-3, hints = []) {
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
  // 용지 정보가 없는 CAD(DXF·DWG): 다른 모든 형상을 크게 둘러싸는 가장 큰 직사각형을 도곽으로 본다
  if (!page && kept.length > 1) {
    const L = kept[0], bbA = (L.bb[1][0] - L.bb[0][0]) * (L.bb[1][1] - L.bb[0][1]);
    const rest = kept.slice(1).filter((l) => l.bb[0][0] >= L.bb[0][0] && l.bb[1][0] <= L.bb[1][0] && l.bb[0][1] >= L.bb[0][1] && l.bb[1][1] <= L.bb[1][1]);
    if (L.area / bbA > 0.98 && rest.length === kept.length - 1) {
      const u = [[Math.min(...rest.map((l) => l.bb[0][0])), Math.min(...rest.map((l) => l.bb[0][1]))], [Math.max(...rest.map((l) => l.bb[1][0])), Math.max(...rest.map((l) => l.bb[1][1]))]];
      if ((u[1][0] - u[0][0]) * (u[1][1] - u[0][1]) < bbA * 0.5) frames.add(L.id);
    }
  }
  // 상세도·투상도 여러 개를 감싼 사각 틀: 직사각형이면서, 자식 중 자기 자식을 가진 고리가 2개 이상
  const kids = new Map();
  for (const l of kept) if (l.parent) kids.set(l.parent, [...(kids.get(l.parent) || []), l]);
  const allBox = kept.length ? [[Math.min(...kept.map((l) => l.bb[0][0])), Math.min(...kept.map((l) => l.bb[0][1]))], [Math.max(...kept.map((l) => l.bb[1][0])), Math.max(...kept.map((l) => l.bb[1][1]))]] : null;
  const allA = allBox ? (allBox[1][0] - allBox[0][0]) * (allBox[1][1] - allBox[0][1]) : 0;
  for (const l of kept) {
    if (frames.has(l.id) || l.pts.length > 8) continue;
    if ((l.bb[1][0] - l.bb[0][0]) * (l.bb[1][1] - l.bb[0][1]) < allA * 0.1) continue;
    const bbA = (l.bb[1][0] - l.bb[0][0]) * (l.bb[1][1] - l.bb[0][1]);
    const nested = (kids.get(l.id) || []).filter((c) => kids.has(c.id)).length;
    if (l.area / bbA > 0.98 && nested >= 2) frames.add(l.id);
  }
  // 도곽 안쪽 고리는 도곽을 부모로 보지 않는다
  for (const l of kept) while (l.parent && frames.has(l.parent)) l.parent = byId[l.parent].parent;
  // 굵은 선을 얇은 사각형으로 그린 것(폭 0.6mm 미만, 길쭉함)은 형상이 아닌 '선'으로 분류
  const isLine = (l) => { const w = (l.bb[1][0] - l.bb[0][0]) * scale, h = (l.bb[1][1] - l.bb[0][1]) * scale; const lo = Math.min(w, h), hi = Math.max(w, h); return (lo < 0.6 && hi > 8 * lo) || (lo < 1.5 && hi > 25 * lo); };
  const lines = new Set(kept.filter((l) => !frames.has(l.id) && isLine(l)).map((l) => l.id));
  for (const l of kept) while (l.parent && lines.has(l.parent)) l.parent = byId[l.parent].parent;
  const depth = (l) => (l.parent ? 1 + depth(byId[l.parent]) : 0);
  const profiles = kept.map((l) => ({
    id: l.id, layer: l.layer, source: l.source,
    role: frames.has(l.id) ? 'frame' : lines.has(l.id) ? 'line' : depth(l) % 2 === 0 ? 'outer' : 'hole', parent: l.parent,
    area: +(l.area * scale * scale).toFixed(3), bbox: l.bb.map((p) => p.map((v) => +(v * scale).toFixed(3))),
    ...(l.circle ? { diameter: +(l.circle.r * 2 * scale).toFixed(3) } : roundDia(l, scale)),
    points: simplify(l.pts).map(([x, y]) => [+(x * scale).toFixed(4), +(y * scale).toFixed(4)]),
  }));
  const segs = open.filter((_, i) => !ch.used.has(i)).slice(0, 60000).map((s) => s.pts.map(([x, y]) => [x * scale, y * scale]));
  const { views, groups } = detectViews(profiles, segs, hints);
  return { profiles, openChains: open.length - ch.usedSegs, truncated: all.length > MAX_LOOPS, views, groups };
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
  const outers = analysis.profiles.filter((p) => (p.role === 'outer' || p.role === 'frame') && sel.has(p.id));
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

export { arcPts, area, inside, bbox } from './profiles-geom.js';
import { area, inside, bbox, simplify } from './profiles-geom.js';
