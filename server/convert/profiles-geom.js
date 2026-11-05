// 2D 기하 유틸
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
export function simplify(p) { return p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 1e-6); }
