// 투상도 자동 인식 (규칙 기반 자동 추정 — 외부 AI 사용 안 함)
//  1) 도면 요소를 근접도로 묶어 뷰 후보를 찾고
//  2) 각 뷰의 선을 격자에 그려 바깥에서 채운 뒤 외형(실루엣)을 추출 (선이 닫히지 않은 CAD 도면도 처리)
//  3) 정렬 관계(같은 폭·같은 높이)로 정면·평면·측면 그룹을 추정
//  결과는 사용자가 화면에서 고칠 수 있다.
import { area as polyArea, bbox as polyBox } from './profiles-geom.js';

export function detectViews(profiles, segs, hints = []) {
  const els = [];
  for (const p of profiles) if (p.role !== 'frame') els.push({ bb: p.bbox, p, pts: p.points, closed: true });
  for (const s of segs) els.push({ bb: polyBox(s), pts: s, closed: false });
  if (!els.length) return { views: [], groups: [] };
  const ext = union(els.map((e) => e.bb));
  const diag = Math.hypot(ext[1][0] - ext[0][0], ext[1][1] - ext[0][1]) || 1;
  const frame = profiles.find((p) => p.role === 'frame');
  // 1) 근접 묶음
  const g = diag * 0.012;
  const parent = els.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grid = new Map();
  const cell = (x) => Math.floor(x / g);
  els.forEach((e, i) => {
    const [[x0, y0], [x1, y1]] = e.bb;
    if ((!e.p || e.p.role === 'line') && Math.max(x1 - x0, y1 - y0) > diag * 0.25) { e.skip = true; return; }
    for (let cx = cell(x0 - g / 2); cx <= cell(x1 + g / 2); cx++) for (let cy = cell(y0 - g / 2); cy <= cell(y1 + g / 2); cy++) {
      const k = cx + ',' + cy;
      const lst = grid.get(k);
      if (lst) for (const j of lst) if (overlap(e.bb, els[j].bb, g / 2)) parent[find(i)] = find(j);
      if (lst) lst.push(i); else grid.set(k, [i]);
    }
  });
  // 칸막이(패널 구분선·도곽 선): 긴 선과 '선' 분류 윤곽의 중심선
  const blockers = [];
  for (const e of els) {
    const [[x0, y0], [x1, y1]] = e.bb;
    if (Math.max(x1 - x0, y1 - y0) < diag * 0.2) continue;
    if (!e.p) { for (let i = 0; i < e.pts.length - 1; i++) blockers.push([e.pts[i], e.pts[i + 1]]); }
    else if (e.p.role === 'line') blockers.push(x1 - x0 > y1 - y0 ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]] : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]]);
  }
  for (const p of profiles) if (p.role === 'frame') for (let i = 0; i < p.points.length; i++) blockers.push([p.points[i], p.points[(i + 1) % p.points.length]]);
  const clusters = new Map();
  els.forEach((e, i) => { if (e.skip) return; const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(e); });

  // 2) 실루엣 추출
  const minArea = (diag * 0.02) ** 2;
  const views = [];
  for (const list of clusters.values()) {
    const cbox = union(list.map((e) => e.bb));
    if ((cbox[1][0] - cbox[0][0]) * (cbox[1][1] - cbox[0][1]) < minArea) continue;
    const { sil, faces, adj } = rasterView(list, cbox);
    if (!sil.length) continue;
    const big = Math.max(...sil.map((s) => s.area));
    if (big < minArea * 0.5) continue;
    const parts = sil.filter((s) => s.area >= big * 0.02);
    const box = union(parts.map((s) => s.bbox));
    // 같은 뷰 안의 원(구멍 후보): 실루엣 안쪽에 있는 원형 윤곽
    const circles = list.filter((e) => e.p?.diameter && e.p.role !== 'line').map((e) => ({
      c: [(e.p.bbox[0][0] + e.p.bbox[1][0]) / 2, (e.p.bbox[0][1] + e.p.bbox[1][1]) / 2], d: e.p.diameter }))
      .filter((c) => c.d < Math.max(box[1][0] - box[0][0], box[1][1] - box[0][1]) * 0.9);
    // 숨은선 원(핀·볼트 위치 힌트) — 구멍으로 쓰지 않고 위치 추정에만 사용
    for (const h of hints) if (h.c[0] >= box[0][0] && h.c[0] <= box[1][0] && h.c[1] >= box[0][1] && h.c[1] <= box[1][1]) circles.push({ c: h.c, d: h.d, hidden: true });
    const touchesFrame = frame && [0, 1].some((k) => Math.abs(cbox[0][k] - frame.bbox[0][k]) < diag * 0.01 || Math.abs(cbox[1][k] - frame.bbox[1][k]) < diag * 0.01);
    const silA = parts.reduce((t, s) => t + s.area, 0);
    const keep = faces.map((f, i) => (f.area >= silA * 0.002 ? i : -1)).filter((i) => i >= 0);
    const remap = new Map(keep.map((i, n) => [i, n]));
    views.push({ box, cbox, silhouettes: parts.map(({ pts, exact }) => ({ pts, exact })), circles, border: !!touchesFrame,
      faces: keep.map((i) => { const f = faces[i]; return { pts: f.pts, bbox: f.bbox, area: f.area, exact: f.exact, material: f.material, owner: f.owner }; }),
      loops: loopsOf(list, faces, keep),
      adj: adj.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a), remap.get(b)]) });
  }
  views.sort((a, b) => boxArea(b.box) - boxArea(a.box));
  views.forEach((v, i) => { v.id = `V${i + 1}`; });

  // 3) 정렬 관계 → 그룹
  const tol = Math.max(diag * 0.006, 0.3);
  const groups = groupViews(views.filter((v) => !v.border), tol, blockers);
  return { views, groups };
}

/**
 * 정렬 관계로 그룹 추정 (3각법 기준: 정면도 위=평면도, 아래=저면도, 오른쪽=우측면도, 왼쪽=좌측면도).
 * 두 뷰 사이를 칸막이 선이 가로지르면 짝이 아니다.
 */
export function groupViews(views, tol, blockers = []) {
  const iou = (a0, a1, b0, b1) => { const i = Math.min(a1, b1) - Math.max(a0, b0); const u = Math.max(a1, b1) - Math.min(a0, b0); return i > 0 ? i / u : 0; };
  const ctr = (v) => [(v.box[0][0] + v.box[1][0]) / 2, (v.box[0][1] + v.box[1][1]) / 2];
  const blocked = (a, b) => blockers.some(([p, q]) => segX(ctr(a), ctr(b), p, q));
  const exact = (a0, a1, b0, b1) => Math.abs(a0 - b0) < tol && Math.abs(a1 - b1) < tol;
  // 정렬 점수: 1=양 끝 일치, 구간 겹침 비율 0.65 이상도 후보
  const hS = (a, b) => (a.box[1][0] < b.box[0][0] || b.box[1][0] < a.box[0][0]) && !blocked(a, b)
    ? (exact(a.box[0][1], a.box[1][1], b.box[0][1], b.box[1][1]) ? 1 : iou(a.box[0][1], a.box[1][1], b.box[0][1], b.box[1][1])) : 0;
  const vS = (a, b) => (a.box[1][1] < b.box[0][1] || b.box[1][1] < a.box[0][1]) && !blocked(a, b)
    ? (exact(a.box[0][0], a.box[1][0], b.box[0][0], b.box[1][0]) ? 1 : iou(a.box[0][0], a.box[1][0], b.box[0][0], b.box[1][0])) : 0;
  const MIN = 0.65;
  const free = new Set(views);
  const groups = [];
  const partners = (v) => [...free].filter((w) => w !== v && (hS(v, w) >= MIN || vS(v, w) >= MIN));
  while (free.size) {
    const front = [...free].sort((a, b) => partners(b).length - partners(a).length || boxArea(b.box) - boxArea(a.box))[0];
    if (!partners(front).length) break;
    const dist = (w) => Math.hypot(ctr(w)[0] - ctr(front)[0], ctr(w)[1] - ctr(front)[1]);
    const pick = (list, sc) => list.filter((w) => sc(front, w) >= MIN).sort((a, b) => sc(front, b) - sc(front, a) || dist(a) - dist(b))[0];
    const above = pick([...free].filter((w) => w.box[0][1] > front.box[1][1]), vS);
    const below = pick([...free].filter((w) => w.box[1][1] < front.box[0][1]), vS);
    const right = pick([...free].filter((w) => w.box[0][0] > front.box[1][0]), hS);
    const left = pick([...free].filter((w) => w.box[1][0] < front.box[0][0]), hS);
    const top = above || below, side = right || left;
    const group = { id: `G${groups.length + 1}`, projection: 'third', front: front.id,
      top: top?.id || null, topPos: top ? (top === above ? 'above' : 'below') : null,
      side: side?.id || null, sidePos: side ? (side === right ? 'right' : 'left') : null };
    for (const [v, r] of [[front, 'front'], [top, 'top'], [side, 'side']]) if (v) { free.delete(v); v.group = group.id; v.role = r; }
    // 반대편 보조 뷰(저면도·좌측면도)는 같은 그룹 참고용
    for (const v of [above && below ? below : null, right && left ? left : null]) if (v && free.has(v)) { free.delete(v); v.group = group.id; v.role = 'aux'; }
    groups.push(group);
  }
  return groups;
}

function segX(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * 묶음 안의 선·윤곽을 격자에 그려
 *  - 외형(실루엣): 바깥에서 채워 닿지 않는 영역 (치수선 등 가는 선은 열림 연산으로 제거)
 *  - 영역(face): 실루엣 안에서 선으로 나뉜 칸 = 부품 후보 (판 층·문·핀 등)
 *  - 인접: 선 하나를 사이에 둔 영역 쌍
 * 분해된 해칭(같은 기울기의 평행선 다수)은 선으로 보지 않는다.
 */
function rasterView(list, box) {
  const W0 = box[1][0] - box[0][0], H0 = box[1][1] - box[0][1];
  const c = Math.max(W0, H0) / 600;
  const pad = 5;
  const nx = Math.ceil(W0 / c) + pad * 2, ny = Math.ceil(H0 / c) + pad * 2, N = nx * ny;
  const X = (x) => Math.round((x - box[0][0]) / c) + pad, Y = (y) => Math.round((y - box[0][1]) / c) + pad;
  // 해칭 판별: 축에 평행하지 않은 같은 각도 선분이 8개 이상이고, 일정 간격으로 반복되며, 선 길이가 간격보다 긴 경우
  const ang = (a, b) => { let t = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; t = ((t % 180) + 180) % 180; return t; };
  const buckets = new Map();
  for (const e of list) if (!e.closed && e.pts.length === 2) {
    const t = ang(e.pts[0], e.pts[1]);
    if (Math.min(t, 180 - t) < 3 || Math.abs(t - 90) < 3) continue;
    const k = Math.round(t); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(e.pts);
  }
  const hatch = new Set();
  for (const [k, segs] of buckets) {
    if (segs.length < 8) continue;
    const r = (k * Math.PI) / 180, sn = Math.sin(r), cs = Math.cos(r);
    const offs = [...new Set(segs.map(([p, q]) => Math.round(((p[0] + q[0]) / 2 * sn - (p[1] + q[1]) / 2 * cs) / (c * 0.5))))].sort((x, y) => x - y).map((v) => v * c * 0.5);
    const gaps = offs.slice(1).map((v, i) => v - offs[i]).filter((g) => g > c);
    if (gaps.length < 6) continue;
    const med = [...gaps].sort((x, y) => x - y)[gaps.length >> 1];
    const regular = gaps.filter((g) => Math.abs(g - med) < med * 0.25).length / gaps.length;
    const avgLen = segs.reduce((t, [p, q]) => t + Math.hypot(q[0] - p[0], q[1] - p[1]), 0) / segs.length;
    if (regular >= 0.6 && avgLen >= med * 1.5) hatch.add(k);
  }
  const m = new Uint8Array(N);
  const plot = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (c * 0.5)));
    for (let i = 0; i <= n; i++) {
      const x = X(a[0] + ((b[0] - a[0]) * i) / n), y = Y(a[1] + ((b[1] - a[1]) * i) / n);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[(y + dy) * nx + x + dx] = 1;
    }
  };
  for (const e of list) {
    const p = e.pts;
    if (!e.closed && p.length === 2 && hatch.has(Math.round(ang(p[0], p[1])))) continue;
    for (let i = 0; i < p.length - 1; i++) plot(p[i], p[i + 1]);
    if (e.closed && p.length > 2) plot(p[p.length - 1], p[0]);
  }
  const flood = (seedOk, pass) => {
    const out = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
    const push = (i) => { if (pass(i) && !out[i]) { out[i] = 1; q[t++] = i; } };
    seedOk(push);
    while (h < t) { const i = q[h++], x = i % nx; if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1); if (i >= nx) push(i - nx); if (i < N - nx) push(i + nx); }
    return out;
  };
  const outside = flood((push) => { for (let x = 0; x < nx; x++) { push(x); push(N - nx + x); } for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); } }, (i) => !m[i]);
  let fill = new Uint8Array(N);
  for (let i = 0; i < N; i++) fill[i] = outside[i] ? 0 : 1;
  fill = dilate(erode(fill, nx, ny, 3), nx, ny, 3);
  const toWorld = (ring) => ring.map(([x, y]) => [box[0][0] + (x - pad) * c, box[0][1] + (y - pad) * c]);
  const closed = list.filter((e) => e.closed && e.p && e.p.role !== 'line');
  const snap = (pts, a) => {
    const bb = polyBox(pts);
    for (const e of closed) {
      const eb = e.p.bbox;
      if ([0, 1].every((k) => Math.abs(eb[0][k] - bb[0][k]) < c * 2.5 && Math.abs(eb[1][k] - bb[1][k]) < c * 2.5) && Math.abs(Math.abs(polyArea(e.pts)) - a) < a * 0.03) return e.pts;
    }
    return null;
  };
  const components = (mask, minCells) => {
    const lab = new Int32Array(N).fill(-1); const comps = [];
    for (let s = 0; s < N; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      const id = comps.length, cells = [s]; lab[s] = id;
      for (let h = 0; h < cells.length; h++) {
        const i = cells[h], x = i % nx;
        for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, i >= nx ? i - nx : -1, i < N - nx ? i + nx : -1]) if (j >= 0 && mask[j] && lab[j] < 0) { lab[j] = id; cells.push(j); }
      }
      comps.push(cells);
    }
    return { lab, comps: comps.map((cells, id) => ({ id, cells })).filter((cc) => cc.cells.length >= minCells) };
  };
  const ringOf = (cells) => {
    const mask = new Uint8Array(N); for (const i of cells) mask[i] = 1;
    const ring = traceOuter(mask, nx, ny);
    if (!ring) return null;
    let pts = rdp(toWorld(ring), c * 0.9);
    const a = Math.abs(polyArea(pts));
    const ex = snap(pts, a);
    if (ex) pts = ex;
    return { pts, exact: !!ex, area: Math.abs(polyArea(pts)), bbox: polyBox(pts) };
  };
  // 실루엣
  const sc = components(fill, 40);
  const sil = sc.comps.map((cc) => ringOf(cc.cells)).filter(Boolean);
  // 영역: 실루엣 안쪽에서 선이 아닌 칸
  const inner = new Uint8Array(N);
  for (let i = 0; i < N; i++) inner[i] = !outside[i] && !m[i] ? 1 : 0;
  const fc = components(inner, 30);
  const faces = [];
  const idOf = new Map();
  for (const cc of fc.comps) {
    // 선 두께만큼 넓혀 경계를 선 중심에 맞춤
    const set = new Set(cc.cells);
    for (const i of cc.cells) for (const j of [i - 1, i + 1, i - nx, i + nx, i - nx - 1, i - nx + 1, i + nx - 1, i + nx + 1]) if (m[j]) set.add(j);
    const r = ringOf([...set]);
    if (!r) continue;
    // 재질 판정: 그려진 닫힌 윤곽 안에 있는 영역이면 부품, 부품 윤곽 사이에 생긴 빈 공간이면 공극 후보
    const ctr = cc.cells[(cc.cells.length / 2) | 0];
    const pt = [box[0][0] + ((ctr % nx) - pad) * c, box[0][1] + (((ctr / nx) | 0) - pad) * c];
    // 이 영역을 감싸는 가장 작은 닫힌 윤곽 = 소속 부품
    let own = null;
    for (const e of closed) if (insidePoly(pt, e.pts) && (!own || Math.abs(polyArea(e.pts)) < Math.abs(polyArea(own.pts)))) own = e;
    // 외곽(바깥)에 닿는 영역은 항상 부품 — 빈 공간(공극)은 부품들 사이에 갇힌 영역뿐
    let touches = false;
    for (const i of cc.cells) { for (const j of [i - 3, i + 3, i - 3 * nx, i + 3 * nx]) if (outside[j]) { touches = true; break; } if (touches) break; }
    r.material = !!own || touches;
    r.owner = own ? own.p.id : null;
    idOf.set(cc.id, faces.length);
    faces.push(r);
  }
  // 닫힌 윤곽이 거의 없는 선 도면(낱개 선분)은 모든 영역을 부품 후보로
  const covered = closed.reduce((t, e) => t + Math.abs(polyArea(e.pts)), 0);
  const silA = sil.reduce((t, x) => t + x.area, 0);
  if (covered < silA * 0.5) for (const f of faces) f.material = true;
  // 인접: 선 칸 주변 5×5 안에 서로 다른 영역
  const adj = new Set();
  for (let i = 0; i < N; i++) {
    if (!m[i] || outside[i]) continue;
    const seen = new Set();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const l = fc.lab[i + dy * nx + dx]; if (l >= 0 && idOf.has(l)) seen.add(idOf.get(l)); }
    if (seen.size > 1) { const a = [...seen]; for (let x = 0; x < a.length; x++) for (let y = x + 1; y < a.length; y++) adj.add(Math.min(a[x], a[y]) + ',' + Math.max(a[x], a[y])); }
  }
  return { sil: sil.filter(Boolean), faces, adj: [...adj].map((k) => k.split(',').map(Number)) };
}

/** 영역을 하나 이상 소유한 닫힌 윤곽 (부품 단위) */
function loopsOf(list, faces, keep) {
  const ids = new Set(keep.map((i) => faces[i].owner).filter(Boolean));
  return list.filter((e) => e.closed && e.p && ids.has(e.p.id)).map((e) => ({ id: e.p.id, pts: e.pts, bbox: e.p.bbox, layer: e.p.layer }));
}

function insidePoly([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function erode(a, nx, ny, r) { let b = a; for (let k = 0; k < r; k++) { const o = new Uint8Array(b.length); for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; o[i] = b[i] && b[i - 1] && b[i + 1] && b[i - nx] && b[i + nx] ? 1 : 0; } b = o; } return b; }
export function dilate(a, nx, ny, r) { let b = a; for (let k = 0; k < r; k++) { const o = new Uint8Array(b.length); for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; o[i] = b[i] || b[i - 1] || b[i + 1] || b[i - nx] || b[i + nx] ? 1 : 0; } b = o; } return b; }

/** 마칭 스퀘어로 성분 경계를 따라 가장 긴 고리(외곽) 반환 — 격자 꼭짓점 좌표 */
export function traceOuter(mask, nx, ny) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < nx && y < ny ? mask[y * nx + x] : 0);
  const edges = new Map(); // 시작점 → 끝점 (칸 경계 위 방향성 선분, 채운 영역이 왼쪽)
  const add = (a, b) => edges.set(a[0] + ',' + a[1], b);
  for (let y = -1; y < ny; y++) for (let x = -1; x < nx; x++) {
    if (at(x, y) && !at(x, y - 1)) add([x + 1, y], [x, y]);       // 아래 경계
    if (at(x, y) && !at(x, y + 1)) add([x, y + 1], [x + 1, y + 1]); // 위 경계
    if (at(x, y) && !at(x - 1, y)) add([x, y], [x, y + 1]);       // 왼쪽 경계
    if (at(x, y) && !at(x + 1, y)) add([x + 1, y + 1], [x + 1, y]); // 오른쪽 경계
  }
  let best = null;
  const used = new Set();
  for (const k of edges.keys()) {
    if (used.has(k)) continue;
    const ring = []; let cur = k;
    while (!used.has(cur) && edges.has(cur)) { used.add(cur); const [x, y] = cur.split(',').map(Number); ring.push([x, y]); const n = edges.get(cur); cur = n[0] + ',' + n[1]; }
    if (ring.length > 2 && (!best || Math.abs(polyArea(ring)) > Math.abs(polyArea(best)))) best = ring;
  }
  return best;
}

export function rdp(pts, eps) {
  if (pts.length < 4) return pts;
  // 닫힌 고리: 가장 먼 두 점으로 나눠 각각 단순화
  let far = 0, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const seg = (a) => {
    if (a.length < 3) return a;
    const [p, q] = [a[0], a[a.length - 1]];
    let md = 0, mi = 0;
    for (let i = 1; i < a.length - 1; i++) {
      const d = Math.abs((q[0] - p[0]) * (p[1] - a[i][1]) - (p[0] - a[i][0]) * (q[1] - p[1])) / (Math.hypot(q[0] - p[0], q[1] - p[1]) || 1);
      if (d > md) { md = d; mi = i; }
    }
    return md > eps ? [...seg(a.slice(0, mi + 1)).slice(0, -1), ...seg(a.slice(mi))] : [p, q];
  };
  const A = seg(pts.slice(0, far + 1)), B = seg([...pts.slice(far), pts[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

const boxArea = (b) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
const overlap = (a, b, m) => a[0][0] - m <= b[1][0] && b[0][0] - m <= a[1][0] && a[0][1] - m <= b[1][1] && b[0][1] - m <= a[1][1];
export const union = (bs) => [[Math.min(...bs.map((b) => b[0][0])), Math.min(...bs.map((b) => b[0][1]))], [Math.max(...bs.map((b) => b[1][0])), Math.max(...bs.map((b) => b[1][1]))]];
