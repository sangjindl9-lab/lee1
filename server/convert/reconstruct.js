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
 * @param input { scale?: number (PDF 필수), groups?: [{front, top, side, topPos, sidePos}] }
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
    const mapT = T && (g.topPos === 'below' ? ([u, v]) => [(u - fx0) * k, (T.box[1][1] - v) * k] : ([u, v]) => [(u - fx0) * k, (v - T.box[0][1]) * k]);
    const mapS = S && (g.sidePos === 'left' ? ([u, v]) => [(S.box[1][0] - u) * k, (v - fz0) * k] : ([u, v]) => [(u - S.box[0][0]) * k, (v - fz0) * k]);
    const Wd = (F.box[1][0] - F.box[0][0]) * k, H = (F.box[1][1] - F.box[0][1]) * k;
    const D = Math.max(T ? (T.box[1][1] - T.box[0][1]) * k : 0, S ? (S.box[1][0] - S.box[0][0]) * k : 0);
    const m = Math.max(Wd, H, D) * 0.05;
    const comps = (V, map) => V.silhouettes.map((s) => {
      const pts = s.pts.map(map);
      const holes = V.circles.filter((c) => inside(c.c, s.pts)).map((c) => circle(map(c.c), (c.d * k) / 2));
      return { pts, holes, bb: bbox(pts), exact: s.exact };
    });
    const fc = comps(F, mapF), tc = T ? comps(T, mapT) : [], sc = S ? comps(S, mapS) : [];
    // 돌출: 정면 (x,z) → y 방향, 평면 (x,y) → z 방향, 측면 (y,z) → x 방향
    const exF = (c) => cs(W, c).extrude(D + 2 * m).rotate([90, 0, 0]).translate([0, D + m, 0]);
    const exT = (c) => cs(W, c).extrude(H + 2 * m).translate([0, 0, -m]);
    const exS = (c) => cs(W, c).extrude(Wd + 2 * m).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -m, 0, 0, 1]);
    const iou = (a0, a1, b0, b1) => { const i = Math.min(a1, b1) - Math.max(a0, b0); return i > 0 ? i / (Math.max(a1, b1) - Math.min(a0, b0)) : 0; };
    let n = 0;
    for (const f of fc) {
      // 같은 부품의 다른 뷰 실루엣: 폭(x) 또는 높이(z) 구간이 맞는 것, 없으면 겹치는 전체
      let ts = tc.filter((t) => iou(t.bb[0][0], t.bb[1][0], f.bb[0][0], f.bb[1][0]) > 0.7);
      if (!ts.length) ts = tc.filter((t) => iou(t.bb[0][0], t.bb[1][0], f.bb[0][0], f.bb[1][0]) > 0);
      let ss = sc.filter((s) => iou(s.bb[0][1], s.bb[1][1], f.bb[0][1], f.bb[1][1]) > 0.7);
      if (!ss.length) ss = sc.filter((s) => iou(s.bb[0][1], s.bb[1][1], f.bb[0][1], f.bb[1][1]) > 0);
      let solid = exF(f);
      if (ts.length) solid = solid.intersect(W.Manifold.union(ts.map(exT)));
      if (ss.length) solid = solid.intersect(W.Manifold.union(ss.map(exS)));
      if (!ts.length && !ss.length) continue;
      const vol = solid.volume();
      if (!(vol > 1e-6)) continue;
      n++;
      const nm = `${name}_${g.id}${fc.length > 1 ? `_${n}` : ''}`;
      children.push({
        name: nm, meshes: [meshOf(solid, AI_COLOR)], children: [],
        extras: { group: g.id, views: { front: F.id, top: T?.id || null, side: S?.id || null }, estimated: true,
          provenance: { silhouette: 'drawing', correspondence: 'ai', depth: 'ai', holes: f.holes.length ? 'ai' : undefined, scale: analysis.scaleRequired ? 'user' : undefined } },
      });
    }
    report.push({ group: g.id, front: F.id, top: T?.id || null, side: S?.id || null, parts: n, size: [Wd, D, H].map((x) => +x.toFixed(1)) });
  }
  if (!children.length) throw httpErr('투상도 교차 결과 형상이 비었습니다. 투상도 지정(정면·평면·측면)을 확인하세요');
  // 그룹끼리 겹치지 않게 X 방향으로 나란히 배치
  const { glb, parts } = await writeGlb({ name, children: layout(children) }, { unit: 'mm' });
  return {
    glb, parts, method: 'views-reconstruct',
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm' },
    report,
    provenance: {
      geometry: 'estimated', review: 'pending',
      note: '투상도 실루엣을 교차해 만든 AI 추정 형상입니다. 숨은 내부·오목 형상은 반영되지 않습니다. 검토 후 승인하세요.',
      items: [
        { what: '각 투상도 외형 윤곽', source: 'drawing', label: '원본 도면에서 확인된 형상' },
        ...(analysis.scaleRequired ? [{ what: `축척 1:${k}`, source: 'user', label: '사용자 입력으로 확정된 형상' }] : []),
        { what: '투상도 짝짓기·깊이 방향·관통 구멍', source: 'ai', label: 'AI가 추정한 형상' },
        { what: '숨은 내부 형상·오목부·곡면 세부', source: 'unbuildable', label: '생성할 수 없는 형상' },
      ],
      ai: report,
    },
  };
}

function cs(W, c) {
  const contours = [c.pts, ...c.holes];
  return new W.CrossSection(contours, 'EvenOdd');
}
function circle([cx, cy], r, n = 48) { return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]); }

/** Manifold 메시 → 각진 면이 보이도록 삼각형별 정점(평면 법선) */
function meshOf(solid, color) {
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
const httpErr = (msg) => Object.assign(new Error(msg), { status: 400 });
