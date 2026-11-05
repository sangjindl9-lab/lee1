// 도면 영역(윤곽) 목록 — AI 가 "어느 그림의 어느 윤곽을 세울지" 고를 수 있게 번호를 붙인다.
//  S = 투상도 외형(실루엣), F = 선으로 나뉜 안쪽 영역(면), C = 원
//  형상은 AI 가 좌표를 지어내지 않고 이 윤곽의 실제 좌표로 만든다 → 정면·측면·상면 모양이 도면과 같아진다.
import zlib from 'node:zlib';
import { encodePng } from './drawimg.js';

const MAX_FACES = 14, MAX_CIRCLES = 10;

/** @returns {regions:[{id,view,kind,pts,bbox,area,diameter?}], byView:{[vid]:[...]}} */
export function listRegions(analysis) {
  const regions = [], byView = {};
  for (const v of analysis.views || []) {
    const list = [];
    v.silhouettes.forEach((s, i) => list.push({ id: `${v.id}S${i + 1}`, view: v.id, kind: 'S', pts: s.pts, bbox: bboxOf(s.pts), area: Math.abs(area(s.pts)) }));
    const silA = list.reduce((t, r) => t + r.area, 0) || 1;
    const faces = (v.faces || []).filter((f) => f.pts?.length >= 3 && f.area >= silA * 0.004).sort((a, b) => b.area - a.area);
    // 외형과 거의 같은 면은 중복이므로 제외
    faces.filter((f) => f.area < silA * 0.97).slice(0, MAX_FACES).forEach((f, i) => list.push({ id: `${v.id}F${i + 1}`, view: v.id, kind: 'F', pts: f.pts, bbox: f.bbox || bboxOf(f.pts), area: f.area, material: f.material }));
    // 조각난 면들이 모여 원을 이루면(십자 보강대·치수선으로 나뉜 렌즈 등) 합친 원형 영역 R 을 따로 제시
    const rf = list.filter((r) => r.kind === 'F').sort((a, b) => b.area - a.area);
    if (rf.length >= 2) {
      const big = rf[0], bc = ctr(big.bbox), R0 = Math.max(big.bbox[1][0] - big.bbox[0][0], big.bbox[1][1] - big.bbox[0][1]) * 1.3;
      let grp = rf.filter((r) => { const c = ctr(r.bbox); return Math.hypot(c[0] - bc[0], c[1] - bc[1]) <= R0; });
      // 원 바깥에 걸친 조각(브래킷 틈 등)은 두 번에 걸쳐 걸러낸다
      for (let it = 0; it < 2 && grp.length >= 2; it++) {
        const hb = bboxOf(convexHull(grp.flatMap((r) => r.pts))), cc = ctr(hb), rad = Math.min(hb[1][0] - hb[0][0], hb[1][1] - hb[0][1]) / 2;
        grp = grp.filter((r) => { const c = ctr(r.bbox); return Math.hypot(c[0] - cc[0], c[1] - cc[1]) <= rad * 0.95 && r.pts.filter((p) => Math.hypot(p[0] - cc[0], p[1] - cc[1]) <= rad * 1.15).length >= r.pts.length * 0.7; });
      }
      if (grp.length >= 2) {
        const hull = convexHull(grp.flatMap((r) => r.pts));
        const hb = bboxOf(hull), hw = hb[1][0] - hb[0][0], hh = hb[1][1] - hb[0][1], ha = Math.abs(area(hull));
        const cover = grp.reduce((t, r) => t + r.area, 0) / ha;
        if (Math.abs(hw - hh) < Math.max(hw, hh) * 0.1 && ha > Math.PI * (hw / 2) * (hh / 2) * 0.88 && ha < Math.PI * (hw / 2) * (hh / 2) * 1.08 && cover > 0.55)
          list.push({ id: `${v.id}R1`, view: v.id, kind: 'R', pts: hull, bbox: hb, area: ha, diameter: (hw + hh) / 2, center: ctr(hb), pieces: grp.map((r) => r.id) });
      }
    }
    (v.circles || []).filter((c) => !c.hidden).sort((a, b) => b.d - a.d).slice(0, MAX_CIRCLES).forEach((c, i) => {
      const pts = Array.from({ length: 40 }, (_, k) => [c.c[0] + (c.d / 2) * Math.cos((k / 40) * Math.PI * 2), c.c[1] + (c.d / 2) * Math.sin((k / 40) * Math.PI * 2)]);
      list.push({ id: `${v.id}C${i + 1}`, view: v.id, kind: 'C', pts, bbox: bboxOf(pts), area: Math.PI * (c.d / 2) ** 2, diameter: c.d, center: c.c });
    });
    byView[v.id] = list; regions.push(...list);
  }
  return { regions, byView };
}

/** AI 에게 줄 영역 설명 (실제 mm 크기, 그림 픽셀 위치) */
export function describeRegions(analysis, byView, k, toPx) {
  const L = [];
  const roleKo = { front: '정면 추정', top: '평면 추정', side: '측면 추정', aux: '보조' };
  for (const v of analysis.views || []) {
    const sz = (b) => `${((b[1][0] - b[0][0]) * k).toFixed(0)}×${((b[1][1] - b[0][1]) * k).toFixed(0)}`;
    const px = (b) => { const a = toPx(b[0][0], b[1][1]), c = toPx(b[1][0], b[0][1]); return `px(${Math.round(a[0])},${Math.round(a[1])})-(${Math.round(c[0])},${Math.round(c[1])})`; };
    L.push(`[${v.id}] ${v.role ? roleKo[v.role] + (v.group ? ' ' + v.group : '') : '역할 미정'} 외곽 ${sz(v.box)} mm ${px(v.box)}`);
    for (const r of byView[v.id] || []) {
      const d = r.kind === 'C' || r.kind === 'R' ? `Ø${(r.diameter * k).toFixed(1)}` : sz(r.bbox);
      L.push(`  - ${r.id} ${r.kind === 'S' ? '전체 실루엣(이 뷰의 모든 선을 감싼 외형 — 브래킷·요크·바이저까지 포함)' : r.kind === 'F' ? '안쪽 영역' : r.kind === 'R' ? `원형 영역(조각 ${r.pieces.join('+')} 합침)` : '원'} ${d} mm ${px(r.bbox)}`);
    }
  }
  return L.join('\n');
}

// ── 번호를 그린 그림 ───────────────────────────────────────────
const FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'], '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'], V: ['101', '101', '101', '101', '010'], S: ['111', '100', '111', '001', '111'],
  F: ['111', '100', '111', '100', '100'], C: ['111', '100', '100', '100', '111'], R: ['110', '101', '110', '101', '101'],
};
function drawLabel(img, W, H, x, y, text, scale = 3) {
  const w = text.length * 4 * scale + scale, h = 5 * scale + 2 * scale;
  x = Math.max(0, Math.min(W - w, Math.round(x))); y = Math.max(0, Math.min(H - h, Math.round(y)));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img[(y + j) * W + x + i] = 60;   // 어두운 바탕
  let cx = x + scale;
  for (const ch of text) {
    const g = FONT[ch]; if (!g) { cx += 4 * scale; continue; }
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const X = cx + c * scale + dx, Y = y + scale + r * scale + dy; if (X < W && Y < H) img[Y * W + X] = 255; }
    cx += 4 * scale;
  }
}
/** 회색 그림에 뷰 번호·영역 번호를 그려 PNG 로 */
export function annotate(gray, W, H, analysis, byView, toPx) {
  const img = new Uint8Array(gray);
  for (const v of analysis.views || []) {
    const [x, y] = toPx(v.box[0][0], v.box[1][1]);
    drawLabel(img, W, H, x, y - 24, v.id, 4);
    for (const r of byView[v.id] || []) {
      const c = r.kind === 'S' ? [r.bbox[0][0], r.bbox[1][1]] : r.kind === 'R' ? [r.bbox[0][0], r.bbox[0][1]] : [(r.bbox[0][0] + r.bbox[1][0]) / 2, (r.bbox[0][1] + r.bbox[1][1]) / 2];
      const [px, py] = toPx(c[0], c[1]);
      drawLabel(img, W, H, r.kind === 'S' ? px + 2 : px - 10, r.kind === 'S' ? py + 2 : py - 8, r.id.slice(r.id.indexOf(r.kind)), 2);
    }
  }
  return encodePng(img, W, H);
}

/** 프로그램이 만든(필터 0) 회색 PNG 를 다시 픽셀로 */
export function decodeGrayPng(buf) {
  let p = 8; const chunks = [];
  let W = 0, H = 0;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 0) throw new Error('회색 8비트 PNG 만 지원'); }
    else if (type === 'IDAT') chunks.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { if (raw[y * (W + 1)] !== 0) throw new Error('필터 0 만 지원'); out.set(raw.subarray(y * (W + 1) + 1, (y + 1) * (W + 1)), y * W); }
  return { w: W, h: H, data: out };
}

const ctr = (b) => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
function convexHull(pts) {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
function bboxOf(p) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [[x0, y0], [x1, y1]]; }
