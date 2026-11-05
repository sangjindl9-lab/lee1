// 투상도 결합 3D 초안: 정면·평면(저면)·측면 실루엣을 각 투상 방향으로 돌출해 교차(Visual Hull).
// 결과는 'AI 추정 형상'(규칙 기반 자동 추정)으로 표시하고 검토·승인을 거친다.
//  - 실루엣 윤곽 자체는 도면에서 확인된 선
//  - 투상도 짝짓기, 깊이 방향 위치, 관통 구멍 판단은 추정
//  - 숨은 내부 형상·오목한 부분(투상에서 가려지는 것)은 복원되지 않는다
import manifoldInit from 'manifold-3d';
import { writeGlb, summarize } from './gltf-writer.js';
import { inside, bbox } from './profiles-geom.js';

let mfP;
const mf = async () => { if (!mfP) mfP = manifoldInit().then((w) => { w.setup(); return w; }); return mfP; };
const AI_COLOR = [0.62, 0.52, 0.95];

/**
 * @param analysis 2D 도면 분석 결과 (views, groups 포함)
 * @param input { scale?: number (PDF 필수), groups?: [{front, top, side, topPos, sidePos}], mode?: 'parts'(부품별 분할, 기본) | 'outline'(외형 한 덩어리) }
 */
export async function reconstructViews(analysis, input, name) {
  let k = 1;
  if (analysis.scaleRequired) {
    k = Number(input?.scale);
    if (!(k > 0)) throw httpErr('PDF 도면은 축척(1:N 의 N)을 입력해야 실제 치수로 만들 수 있습니다');
  }
  const views = Object.fromEntries((analysis.views || []).map((v) => [v.id, v]));
  const groups = (input?.groups?.length ? input.groups : analysis.groups) || [];
  const usable = groups.filter((g) => views[g.front] && (views[g.top] || views[g.side]));
  if (!usable.length) throw httpErr('짝이 맞는 투상도(정면 + 평면/측면)를 찾지 못했습니다. 화면에서 투상도를 지정하세요');
  const W = await mf();
  const children = [];
  const report = [];
  for (const g of usable) {
    const F = views[g.front], T = views[g.top] || null, S = views[g.side] || null;
    const fx0 = F.box[0][0], fz0 = F.box[0][1];
    // 투상선 공유 좌표 (3각법: 각 뷰에서 정면도에 가까운 쪽이 물체의 앞면)
    const mapF = ([u, v]) => [(u - fx0) * k, (v - fz0) * k];
    // 실제 도면은 투상선 정렬이 어긋나게 그려지기도 한다(측면도를 조금 내려 그림 등).
    // 크기가 거의 같은데(4% 이내) 위치만 어긋났으면 정면도에 맞춰 옮긴다. 크기가 다르면(일부만 보이는 뷰) 투상선 위치를 그대로 쓴다.
    const same = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 0.04;
    const tx = T && same(T.box[1][0] - T.box[0][0], F.box[1][0] - F.box[0][0]) ? T.box[0][0] - fx0 : 0;
    const sz = S && same(S.box[1][1] - S.box[0][1], F.box[1][1] - F.box[0][1]) ? S.box[0][1] - fz0 : 0;
    const mapT = T && (g.topPos === 'below' ? ([u, v]) => [(u - fx0 - tx) * k, (T.box[1][1] - v) * k] : ([u, v]) => [(u - fx0 - tx) * k, (v - T.box[0][1]) * k]);
    const mapS = S && (g.sidePos === 'left' ? ([u, v]) => [(S.box[1][0] - u) * k, (v - fz0 - sz) * k] : ([u, v]) => [(u - S.box[0][0]) * k, (v - fz0 - sz) * k]);
    const Wd = (F.box[1][0] - F.box[0][0]) * k, H = (F.box[1][1] - F.box[0][1]) * k;
    const D = Math.max(T ? (T.box[1][1] - T.box[0][1]) * k : 0, S ? (S.box[1][0] - S.box[0][0]) * k : 0);
    const m = Math.max(Wd, H, D) * 0.05;
    const big = Math.max(Wd, H, D);
    const exF = (pts, holes = []) => new W.CrossSection([pts, ...holes], 'EvenOdd').extrude(D + 2 * m).rotate([90, 0, 0]).translate([0, D + m, 0]);
    const exT = (pts, holes = []) => new W.CrossSection([pts, ...holes], 'EvenOdd').extrude(H + 2 * m).translate([0, 0, -m]);
    const exS = (pts, holes = []) => new W.CrossSection([pts, ...holes], 'EvenOdd').extrude(Wd + 2 * m).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -m, 0, 0, 1]);
    // 뷰의 실루엣(원형 윤곽은 관통 구멍 추정) — 대응 영역을 못 찾았을 때 쓰는 전체 외형
    const iou0 = (a0, a1, b0, b1) => { const i = Math.min(a1, b1) - Math.max(a0, b0); return i > 0 ? i / (Math.max(a1, b1) - Math.min(a0, b0)) : 0; };
    let fuRef = [];
    const silOf = (V, map, ex, axis) => V ? W.Manifold.union(V.silhouettes.map((s) => ex(s.pts.map(map),
      V.circles.filter((c) => !c.hidden && inside(c.c, s.pts)).map((c) => ({ p: map(c.c), r: (c.d * k) / 2 }))
        .filter((c) => !fuRef.some((u) => iou0(u.bb[0][axis], u.bb[1][axis], c.p[axis === 0 ? 0 : 1] - c.r, c.p[axis === 0 ? 0 : 1] + c.r) >= 0.8))
        .map((c) => circle(c.p, c.r)).concat((V.holePolys || []).filter((h) => inside(h[0], s.pts)).map((h) => h.map(map)))))) : null;
    // 부품 단위(정면도): 닫힌 윤곽이 있으면 윤곽 단위, 없으면 선으로 나뉜 영역 단위
    const outline = input?.mode === 'outline';
    const unitsOf = (V, map, isFront = false) => {
      const faces = outline ? [] : (V.faces || []).filter((f) => f.material);
      const byLoop = new Map((V.loops || []).map((l) => [l.id, l]));
      const units = [];
      const seen = new Set();
      const silA = V.silhouettes.reduce((t, s) => t + Math.abs(area2(s.pts)), 0);
      for (const f of faces) {
        if (f.owner && byLoop.has(f.owner)) { if (!seen.has(f.owner)) { seen.add(f.owner); units.push({ key: f.owner, pts: byLoop.get(f.owner).pts.map(map), layer: byLoop.get(f.owner).layer }); } continue; }
        // 낱개 선으로 나뉜 칸: 충분히 크거나(외형의 2% 이상) 핀처럼 가늘고 긴 것만 부품 — 작은 칸은 감싸는 부품에 흡수
        const w = f.bbox[1][0] - f.bbox[0][0], h = f.bbox[1][1] - f.bbox[0][1];
        const slim = Math.max(w, h) >= Math.min(w, h) * 3 && Math.max(w, h) > Math.sqrt(silA) * 0.15;
        if (f.area >= silA * 0.02 || slim) units.push({ key: 'f' + units.length, pts: f.pts.map(map) });
      }
      if (!units.length) for (const s of V.silhouettes) units.push({ key: 's' + units.length, pts: s.pts.map(map) });
      // 스캔·이미지 도면: 선으로 나뉜 면 정보가 없으므로, 평면·측면도의 안쪽 구멍(원·장공)을 영역으로 넣어 holesIn 이 구멍으로 판단하게 한다
      if (V.raster && !isFront) {
        for (const c of V.circles || []) units.push({ key: 'h' + units.length, pts: circle(map(c.c), (c.d * k) / 2) });
        for (const h of V.holePolys || []) units.push({ key: 'h' + units.length, pts: h.map(map) });
      }
      for (const u of units) u.bb = bbox(u.pts);
      return units;
    };
    const fu = unitsOf(F, mapF, true), tu = T ? unitsOf(T, mapT) : [], su = S ? unitsOf(S, mapS) : [];
    fuRef = fu;
    const silT = silOf(T, mapT, exT, 0), silS = silOf(S, mapS, exS, 1);
    const inBox = (a, b) => a[0][0] >= b[0][0] && a[1][0] <= b[1][0] && a[0][1] >= b[0][1] && a[1][1] <= b[1][1];
    const frontHas = (lo, hi, axis) => fu.some((u) => iou0(u.bb[0][axis], u.bb[1][axis], lo, hi) >= 0.8);
    // 평면도의 안쪽 영역: 정면도에 같은 폭의 부품이 없으면 구멍 (있으면 스프루처럼 별도 부품)
    const holesIn = (list, outer, axis) => list.filter((h) => h !== outer && inBox(h.bb, outer.bb) && (h.bb[1][0] - h.bb[0][0]) * (h.bb[1][1] - h.bb[0][1]) < (outer.bb[1][0] - outer.bb[0][0]) * (outer.bb[1][1] - outer.bb[0][1]) * 0.5
      && !frontHas(h.bb[0][axis === 'x' ? 0 : 1], h.bb[1][axis === 'x' ? 0 : 1], axis === 'x' ? 0 : 1)).map((h) => h.pts);
    // 구간 일치도
    const iou = (a0, a1, b0, b1) => { const i = Math.min(a1, b1) - Math.max(a0, b0); return i > 0 ? i / (Math.max(a1, b1) - Math.min(a0, b0)) : 0; };
    const contain = (a0, a1, b0, b1) => { const i = Math.min(a1, b1) - Math.max(a0, b0); return i > 0 ? i / Math.min(a1 - a0, b1 - b0) : 0; };
    const cells = [];
    let pins = 0;
    for (const [ui, u] of fu.entries()) {
      const [[x0, z0], [x1, z1]] = u.bb;
      const w = x1 - x0, h = z1 - z0;
      const sM = S ? su.filter((s) => iou(s.bb[0][1], s.bb[1][1], z0, z1) >= 0.8) : [];
      const tM = T ? tu.filter((t) => iou(t.bb[0][0], t.bb[1][0], x0, x1) >= 0.8) : [];
      const unresolved = !outline && ((S && !sM.length) || (T && !tM.length));
      // 핀·볼트·부시: 가늘고 작은데 다른 뷰에 대응 영역이 없으면 원기둥으로 추정 (위치는 평면도 원 → 없으면 깊이 중앙)
      const slender = Math.min(w, h) < big * 0.1 && Math.max(w, h) >= Math.min(w, h) * 3 && (h >= w || w < Wd * 0.4);
      if (unresolved && slender) {
        const vertical = h >= w, dia = vertical ? w : h;
        let yc = D / 2;
        const cx = vertical ? (x0 + x1) / 2 : null;
        const hint = T && vertical && T.circles.map((c) => ({ p: mapT(c.c), d: c.d * k })).find((c) => Math.abs(c.p[0] - cx) < dia * 0.6 && Math.abs(c.d - dia) < dia * 0.4);
        if (hint) yc = hint.p[1];
        const cyl = vertical
          ? W.Manifold.cylinder(h, dia / 2, dia / 2, 32).translate([cx, yc, z0])
          : W.Manifold.cylinder(w, dia / 2, dia / 2, 32).rotate([0, 90, 0]).translate([x0, yc, (z0 + z1) / 2]);
        cells.push({ unit: ui, s: 'pin', t: 'pin', solid: cyl, pin: true, hint: !!hint });
        pins++;
        continue;
      }
      // 대응 영역이 없으면: 이 구간을 포함하는 영역 → 그것도 없으면 전체 실루엣
      const sList = S ? (sM.length ? sM.map((s, i) => ({ id: 's' + su.indexOf(s), solid: exS(s.pts, holesIn(su, s, 'z')) }))
        : [{ id: 'S*', solid: (() => { const c = su.filter((s) => contain(s.bb[0][1], s.bb[1][1], z0, z1) >= 0.8); return c.length ? W.Manifold.union(c.map((s) => exS(s.pts, holesIn(su, s, 'z')))) : silS; })() }]) : [{ id: '-', solid: null }];
      const tList = T ? (tM.length ? tM.map((t) => ({ id: 't' + tu.indexOf(t), solid: exT(t.pts, holesIn(tu, t, 'x')) }))
        : [{ id: 'T*', solid: silT }]) : [{ id: '-', solid: null }];
      const ef = exF(u.pts);
      for (const sv of sList) for (const tv of tList) {
        let solid = ef;
        if (sv.solid) solid = solid.intersect(sv.solid);
        if (tv.solid) solid = solid.intersect(tv.solid);
        if (!S && !T) continue;
        const vol = solid.volume();
        const bb = solid.boundingBox();
        const thin = Math.min(...[0, 1, 2].map((i) => bb.max[i] - bb.min[i]));
        if (vol > Wd * H * D * 2e-5 && thin > big * 0.004) cells.push({ unit: ui, s: sv.id, t: tv.id, solid, layer: u.layer });
      }
    }
    // 병합: 같은 측면·평면 영역을 쓰고, 정면도에서 맞닿거나 포함 관계인 부품끼리 (예: 외함 테두리 + 문 앞면)
    const touch = (a, b) => { const A = fu[a].bb, B = fu[b].bb, e = big * 0.004; return A[0][0] <= B[1][0] + e && B[0][0] <= A[1][0] + e && A[0][1] <= B[1][1] + e && B[0][1] <= A[1][1] + e; };
    const par = cells.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
      const A = cells[a], B = cells[b];
      if (A.pin || B.pin || A.s !== B.s || A.t !== B.t || A.unit === B.unit) continue;
      if (touch(A.unit, B.unit) && overlapSolid(A.solid, B.solid)) par[find(a)] = find(b);
    }
    const merged = new Map();
    cells.forEach((c, i) => { const r = find(i); merged.set(r, [...(merged.get(r) || []), c]); });
    let n = 0;
    for (const list of merged.values()) {
      const solid = list.length > 1 ? W.Manifold.union(list.map((c) => c.solid)) : list[0].solid;
      n++;
      const pin = list[0].pin;
      children.push({
        name: `${name}_${g.id}_${pin ? '핀' : 'P'}${n}`, meshes: [meshOf(solid, AI_COLOR)], children: [],
        extras: { group: g.id, views: { front: F.id, top: T?.id || null, side: S?.id || null }, estimated: true, ...(list[0].layer ? { layer: list[0].layer } : {}),
          provenance: { silhouette: 'drawing', correspondence: 'ai', depth: pin ? (list[0].hint ? 'drawing-hint' : 'ai') : 'ai', shape: pin ? 'ai-cylinder' : undefined, scale: analysis.scaleRequired ? (input?.sources?.scale || 'user') : undefined } },
      });
    }
    report.push({ group: g.id, front: F.id, top: T?.id || null, side: S?.id || null, parts: n, pins, size: [Wd, D, H].map((x) => +x.toFixed(1)) });
  }
  if (!children.length) throw httpErr('투상도 교차 결과 형상이 비었습니다. 투상도 지정(정면·평면·측면)을 확인하세요');
  // 그룹끼리 겹치지 않게 X 방향으로 나란히 배치
  const { glb, parts } = await writeGlb({ name, children: layout(children) }, { unit: 'mm' });
  return {
    glb, parts, method: 'views-reconstruct',
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm' },
    report,
    provenance: {
      geometry: 'estimated', review: 'pending', reference: true,
      note: '참고용 AI 3D 시각화 — 투상도 실루엣을 교차해 만든 추정 형상입니다. 숨은 내부·오목 형상은 반영되지 않습니다. 검토 후 승인하세요.',
      items: [
        { what: '각 투상도 외형 윤곽', source: 'drawing', label: '원본 도면에서 확인된 형상' },
        ...(analysis.scaleRequired ? [scaleItem(k, input?.sources?.scale)] : []),
        ...(analysis.raster ? [{ what: '스캔·이미지에서 따낸 외형 (픽셀 정밀도)', source: 'ai', label: 'AI가 추정한 형상' }] : []),
        { what: '투상도 짝짓기·깊이 방향·관통 구멍', source: 'ai', label: 'AI가 추정한 형상' },
        { what: '숨은 내부 형상·오목부·곡면 세부', source: 'unbuildable', label: '생성할 수 없는 형상' },
      ],
      ai: report,
    },
  };
}

/** 축척 근거 표시: user(사용자 입력) · drawing(도면 표기에서 읽음) · ai(치수 숫자와 비교해 추정) · default(근거 없음, 1:1 가정) */
export function scaleItem(k, src = 'user') {
  if (src === 'drawing') return { what: `축척 1:${k} (도면 표기에서 읽음)`, source: 'drawing', label: '원본 도면에서 확인된 형상' };
  if (src === 'ai') return { what: `축척 1:${k} (도면 치수 숫자와 비교해 추정)`, source: 'ai', label: 'AI가 추정한 형상' };
  if (src === 'default') return { what: `축척 1:${k} (근거 없음 — 기본값)`, source: 'ai', label: 'AI가 추정한 형상' };
  return { what: `축척 1:${k}`, source: 'user', label: '사용자 입력으로 확정된 형상' };
}

/** 두 형상이 실제로 겹치거나 맞닿는지 (경계상자 기준) */
function overlapSolid(a, b) {
  const A = a.boundingBox(), B = b.boundingBox(), e = 0.5;
  return [0, 1, 2].every((i) => A.min[i] <= B.max[i] + e && B.min[i] <= A.max[i] + e);
}

function cs(W, c) {
  const contours = [c.pts, ...c.holes];
  return new W.CrossSection(contours, 'EvenOdd');
}
function circle([cx, cy], r, n = 48) { return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]); }

/** Manifold 메시 → 각진 면이 보이도록 삼각형별 정점(평면 법선) */
export function meshOf(solid, color) {
  const mesh = solid.getMesh();
  const P = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts;
  const pos = new Float32Array(T.length * 3), nor = new Float32Array(T.length * 3);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * np, b = T[t + 1] * np, c = T[t + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      const s = T[t + k] * np, o = (t + k) * 3;
      pos[o] = P[s]; pos[o + 1] = P[s + 1]; pos[o + 2] = P[s + 2];
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    }
  }
  return { positions: pos, normals: nor, color, metallic: 0.3, roughness: 0.55 };
}

function layout(children) {
  const byGroup = new Map();
  for (const c of children) { const g = c.extras.group; byGroup.set(g, [...(byGroup.get(g) || []), c]); }
  let x = 0;
  for (const list of byGroup.values()) {
    let min = Infinity, max = -Infinity;
    for (const c of list) for (const m of c.meshes) for (let i = 0; i < m.positions.length; i += 3) { min = Math.min(min, m.positions[i]); max = Math.max(max, m.positions[i]); }
    const dx = x - min;
    for (const c of list) for (const m of c.meshes) for (let i = 0; i < m.positions.length; i += 3) m.positions[i] += dx;
    x += (max - min) * 1.25;
  }
  return children;
}
const area2 = (p) => p.reduce((t, a, i) => { const b = p[(i + 1) % p.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const httpErr = (msg) => Object.assign(new Error(msg), { status: 400 });
