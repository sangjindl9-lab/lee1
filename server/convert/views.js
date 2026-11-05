// 투상도 자동 인식 (규칙 기반 자동 추정 — 외부 AI 사용 안 함)
//  1) 도면 요소를 근접도로 묶어 뷰 후보를 찾고
//  2) 각 뷰의 선을 격자에 그려 바깥에서 채운 뒤 외형(실루엣)을 추출 (선이 닫히지 않은 CAD 도면도 처리)
//  3) 정렬 관계(같은 폭·같은 높이)로 정면·평면·측면 그룹을 추정
//  결과는 사용자가 화면에서 고칠 수 있다.
import { area as polyArea, bbox as polyBox } from './profiles-geom.js';

export function detectViews(profiles, segs) {
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
    const sil = silhouettes(list, cbox);
    if (!sil.length) continue;
    const big = Math.max(...sil.map((s) => s.area));
    if (big < minArea * 0.5) continue;
    const parts = sil.filter((s) => s.area >= big * 0.02);
    const box = union(parts.map((s) => s.bbox));
    // 같은 뷰 안의 원(구멍 후보): 실루엣 안쪽에 있는 원형 윤곽
    const circles = list.filter((e) => e.p?.diameter && e.p.role !== 'line').map((e) => ({
      c: [(e.p.bbox[0][0] + e.p.bbox[1][0]) / 2, (e.p.bbox[0][1] + e.p.bbox[1][1]) / 2], d: e.p.diameter }))
      .filter((c) => c.d < Math.max(box[1][0] - box[0][0], box[1][1] - box[0][1]) * 0.9);
    const touchesFrame = frame && [0, 1].some((k) => Math.abs(cbox[0][k] - frame.bbox[0][k]) < diag * 0.01 || Math.abs(cbox[1][k] - frame.bbox[1][k]) < diag * 0.01);
    views.push({ box, cbox, silhouettes: parts.map(({ pts, exact }) => ({ pts, exact })), circles, border: !!touchesFrame });
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

/** 묶음 안의 선·윤곽을 격자에 그려 외형 다각형(들)을 구한다 */
function silhouettes(list, box) {
  const W0 = box[1][0] - box[0][0], H0 = box[1][1] - box[0][1];
  const c = Math.max(W0, H0) / 500;            // 격자 한 칸 크기
  const pad = 4;
  const nx = Math.ceil(W0 / c) + pad * 2, ny = Math.ceil(H0 / c) + pad * 2;
  const m = new Uint8Array(nx * ny);
  const X = (x) => Math.round((x - box[0][0]) / c) + pad, Y = (y) => Math.round((y - box[0][1]) / c) + pad;
  const plot = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (c * 0.5)));
    for (let i = 0; i <= n; i++) {
      const x = X(a[0] + ((b[0] - a[0]) * i) / n), y = Y(a[1] + ((b[1] - a[1]) * i) / n);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m[(y + dy) * nx + x + dx] = 1; // 1칸 두께 = 작은 틈 메움
    }
  };
  for (const e of list) {
    const p = e.pts;
    for (let i = 0; i < p.length - 1; i++) plot(p[i], p[i + 1]);
    if (e.closed && p.length > 2) plot(p[p.length - 1], p[0]);
  }
  // 바깥 채우기
  const out = new Uint8Array(nx * ny);
  const q = new Int32Array(nx * ny); let h = 0, t = 0;
  const push = (i) => { if (!m[i] && !out[i]) { out[i] = 1; q[t++] = i; } };
  for (let x = 0; x < nx; x++) { push(x); push((ny - 1) * nx + x); }
  for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); }
  while (h < t) { const i = q[h++], x = i % nx, y = (i / nx) | 0; if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1); if (y > 0) push(i - nx); if (y < ny - 1) push(i + nx); }
  let fill = new Uint8Array(nx * ny);
  for (let i = 0; i < fill.length; i++) fill[i] = out[i] ? 0 : 1;
  // 열림 연산(침식 3칸 → 팽창 3칸): 치수선·지시선 같은 가는 선 제거
  fill = dilate(erode(fill, nx, ny, 3), nx, ny, 3);
  // 연결 성분별 외곽 추적
  const res = [];
  const seen = new Uint8Array(nx * ny);
  for (let s = 0; s < fill.length; s++) {
    if (!fill[s] || seen[s]) continue;
    const comp = []; let hh = 0; comp.push(s); seen[s] = 1;
    while (hh < comp.length) {
      const i = comp[hh++], x = i % nx, y = (i / nx) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]) if (j >= 0 && fill[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
    }
    if (comp.length < 40) continue;
    const mask = new Uint8Array(nx * ny); for (const i of comp) mask[i] = 1;
    const ring = traceOuter(mask, nx, ny);
    if (!ring) continue;
    let pts = rdp(ring.map(([x, y]) => [box[0][0] + (x - pad) * c, box[0][1] + (y - pad) * c]), c * 0.9);
    const a = Math.abs(polyArea(pts));
    // 닫힌 윤곽이 실루엣과 거의 같으면 그 정확한 좌표를 사용
    const bb = polyBox(pts);
    let exact = false;
    for (const e of list) {
      if (!e.closed || !e.p || e.p.role === 'line') continue;
      const eb = e.p.bbox;
      if ([0, 1].every((k) => Math.abs(eb[0][k] - bb[0][k]) < c * 2.5 && Math.abs(eb[1][k] - bb[1][k]) < c * 2.5) && Math.abs(Math.abs(polyArea(e.pts)) - a) < a * 0.03) { pts = e.pts; exact = true; break; }
    }
    res.push({ pts, exact, area: Math.abs(polyArea(pts)), bbox: polyBox(pts) });
  }
  return res;
}

function erode(a, nx, ny, r) { let b = a; for (let k = 0; k < r; k++) { const o = new Uint8Array(b.length); for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; o[i] = b[i] && b[i - 1] && b[i + 1] && b[i - nx] && b[i + nx] ? 1 : 0; } b = o; } return b; }
function dilate(a, nx, ny, r) { let b = a; for (let k = 0; k < r; k++) { const o = new Uint8Array(b.length); for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; o[i] = b[i] || b[i - 1] || b[i + 1] || b[i - nx] || b[i + nx] ? 1 : 0; } b = o; } return b; }

/** 마칭 스퀘어로 성분 경계를 따라 가장 긴 고리(외곽) 반환 — 격자 꼭짓점 좌표 */
function traceOuter(mask, nx, ny) {
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

function rdp(pts, eps) {
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
