// 도면 + 카메라·화각 SVG 렌더링 (편집 화면·고객 공유 화면 공용)
const PC = window.PropCalc;
const NS = 'http://www.w3.org/2000/svg';
export const el = (tag, a, parent) => { const e = document.createElementNS(NS, tag); for (const k in a || {}) if (a[k] != null) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
// opts: { imgUrl(plan), selected:Set, unit (화면 1px당 도면 단위), editable }
export function renderPlan(g, plan, data, products, opts) {
  g.innerHTML = ''; const u = opts.unit || 1; const sel = opts.selected || new Set();
  const cams = PC.numbered(data).filter(c => c.plan === plan.id);
  const upm = PC.num(plan.upm); const unscaled = plan.width * 0.12;
  el('rect', { x: 0, y: 0, width: plan.width, height: plan.height, fill: '#fff' }, g);
  if (plan.file_id) el('image', { href: opts.imgUrl(plan), x: 0, y: 0, width: plan.width, height: plan.height, preserveAspectRatio: 'none' }, g);
  el('rect', { x: 0, y: 0, width: plan.width, height: plan.height, fill: 'none', stroke: '#c9ced5', 'vector-effect': 'non-scaling-stroke' }, g);
  const clipId = 'clip-' + plan.id; const defs = el('defs', null, g); const cp = el('clipPath', { id: clipId }, defs); el('rect', { x: 0, y: 0, width: plan.width, height: plan.height }, cp);
  const L = el('g', { 'clip-path': `url(#${clipId})` }, g);
  (data.marks || []).filter(m => m.plan === plan.id && m.type === 'route' && (m.points || []).length > 1).forEach(m => {
    const gg = el('g', { 'data-id': m.id, 'data-kind': 'mark' }, L); const d = 'M' + m.points.map(p => p.join(' ')).join('L');
    el('path', { d, stroke: 'transparent', 'stroke-width': 12 * u, fill: 'none' }, gg);
    el('path', { d, stroke: sel.has(m.id) ? '#ff6a00' : '#7a8594', 'stroke-width': 2.2, 'stroke-dasharray': '7 5', fill: 'none', 'vector-effect': 'non-scaling-stroke' }, gg);
  });
  cams.forEach(c => {
    const I = PC.camInfo(c, products); if (I.hfov == null) return; const r = upm && I.range ? I.range * upm : unscaled;
    const gg = el('g', { 'data-id': c.id, 'data-kind': 'cam', 'pointer-events': opts.editable ? 'visibleFill' : 'none' }, L);
    if (I.hfov >= 360) el('circle', { cx: c.x, cy: c.y, r, fill: c.color, 'fill-opacity': 0.22, stroke: c.color, 'vector-effect': 'non-scaling-stroke' }, gg);
    else el('polygon', { points: PC.sector(c.x, c.y, +c.dir || 0, I.hfov, r).map(p => p.join(',')).join(' '), fill: c.color, 'fill-opacity': sel.has(c.id) ? 0.34 : 0.22, stroke: c.color, 'stroke-opacity': 0.85, 'vector-effect': 'non-scaling-stroke' }, gg);
    if (upm && I.ir && I.ir > (I.range || 0) && c.show_night !== false && I.hfov < 360) el('polyline', { points: PC.arc(c.x, c.y, +c.dir || 0, I.hfov, I.ir * upm).map(p => p.join(',')).join(' '), fill: 'none', stroke: c.color, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' }, gg);
  });
  (data.marks || []).filter(m => m.plan === plan.id && m.type !== 'route').forEach(m => {
    const gg = el('g', { 'data-id': m.id, 'data-kind': 'mark', style: opts.editable ? 'cursor:move' : '' }, g);
    if (m.type === 'text') { const t = el('text', { x: m.x, y: m.y, 'font-size': 15 * u, fill: sel.has(m.id) ? '#ff6a00' : '#333', 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 * u }, gg); t.textContent = m.text || '문자'; return; }
    const lab = m.type === 'nvr' ? '녹화기' : m.type === 'monitor' ? '모니터' : (m.text || '장비'); const w = (lab.length * 13 + 12) * u, hh = 22 * u;
    el('rect', { x: m.x - w / 2, y: m.y - hh / 2, width: w, height: hh, rx: 4 * u, fill: '#263442', stroke: sel.has(m.id) ? '#ff6a00' : 'none', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, gg);
    const t = el('text', { x: m.x, y: m.y + 5 * u, 'font-size': 13 * u, fill: '#fff', 'text-anchor': 'middle', 'font-weight': 700 }, gg); t.textContent = lab;
  });
  cams.forEach(c => {
    const R = 15 * u, a = (+c.dir || 0) * Math.PI / 180; const I = PC.camInfo(c, products);
    const gg = el('g', { 'data-id': c.id, 'data-kind': 'cam', style: opts.editable ? 'cursor:move' : '' }, g);
    if (I.hfov == null || I.hfov < 360) el('polygon', { points: [[c.x + Math.sin(a) * R * 1.75, c.y - Math.cos(a) * R * 1.75], [c.x + Math.sin(a + 0.55) * R * 0.95, c.y - Math.cos(a + 0.55) * R * 0.95], [c.x + Math.sin(a - 0.55) * R * 0.95, c.y - Math.cos(a - 0.55) * R * 0.95]].map(p => p.join(',')).join(' '), fill: c.color }, gg);
    el('circle', { cx: c.x, cy: c.y, r: R, fill: c.color, stroke: sel.has(c.id) ? '#ff6a00' : '#fff', 'stroke-width': sel.has(c.id) ? 4 : 2.5, 'vector-effect': 'non-scaling-stroke' }, gg);
    const t = el('text', { x: c.x, y: c.y + 6 * u, 'font-size': 17 * u, fill: '#fff', 'text-anchor': 'middle', 'font-weight': 800 }, gg); t.textContent = c.no;
    if (c.place) { const lt = el('text', { x: c.x + R + 4 * u, y: c.y - R, 'font-size': 14 * u, fill: c.color, 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 4 * u }, gg); lt.textContent = c.place; }
  });
  return { cams, unscaled: !upm };
}
