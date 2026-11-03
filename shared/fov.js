/* 화각·견적 공통 계산 (화면·PDF·공유 화면 공용) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PropCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#6d4c41', '#3949ab', '#7cb342', '#f4511e', '#5e35b1'];
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  // 방향 0° = 도면 위쪽, 시계 방향
  function sector(cx, cy, dir, fov, r, steps) {
    steps = steps || Math.max(8, Math.round(fov / 4));
    const a0 = (dir - fov / 2) * Math.PI / 180, a1 = (dir + fov / 2) * Math.PI / 180;
    const P = a => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const pts = [[cx, cy]]; for (let i = 0; i <= steps; i++) pts.push(P(a0 + (a1 - a0) * i / steps));
    return pts;
  }
  function arc(cx, cy, dir, fov, r, steps) { return sector(cx, cy, dir, fov, r, steps).slice(1); }
  // 카메라 번호: 도면 순서 → 배치 순서
  function numbered(data) {
    const order = (data.plans || []).map(p => p.id);
    return (data.cams || []).slice().sort((a, b) => (order.indexOf(a.plan) - order.indexOf(b.plan)) || ((a.seq || 0) - (b.seq || 0))).map((c, i) => ({ ...c, no: i + 1, color: c.color || COLORS[i % COLORS.length] }));
  }
  function camInfo(c, products) {
    const p = (products || []).find(x => x.id === c.product_id) || {};
    const d = p.data || {};
    return { product: p, name: p.name || '카메라', model: p.model || '', type: d.type || '', resolution: d.resolution || '', lens: d.lens || '', hfov: num(c.hfov) ?? num(d.hfov), range: num(c.range) ?? num(d.range_m), ir: num(c.ir) ?? num(d.ir_m), features: d.features || '' };
  }
  // 견적: 카메라 제품별 자동 수량 + 수동 품목
  function quote(data, products) {
    const q = data.quote || {}; const lines = [];
    const cams = data.cams || []; const by = {};
    cams.forEach(c => { const k = c.product_id || '_'; by[k] = (by[k] || 0) + 1; });
    Object.entries(by).forEach(([pid, n]) => { const p = (products || []).find(x => x.id === pid); const ov = (q.auto_price || {})[pid]; lines.push({ auto: true, key: pid, name: p ? p.name : 'CCTV 카메라', spec: p ? [p.model, (p.data || {}).resolution].filter(Boolean).join(' / ') : '', unit: '대', qty: n, price: num(ov) ?? num(p && p.data && p.data.price) ?? 0 }); });
    (q.lines || []).forEach(l => lines.push({ ...l, qty: num(l.qty) || 0, price: num(l.price) || 0 }));
    lines.forEach(l => { l.amount = Math.round(l.qty * l.price); });
    const supply = lines.reduce((s, l) => s + l.amount, 0) - (num(q.discount) || 0);
    const vat = q.vat === false ? 0 : Math.round(supply * 0.1);
    return { lines, discount: num(q.discount) || 0, supply, vat, total: supply + vat, vatIncluded: q.vat !== false };
  }
  const won = n => (n == null ? '' : Math.round(n).toLocaleString('ko-KR'));
  return { COLORS, sector, arc, numbered, camInfo, quote, won, num };
});
