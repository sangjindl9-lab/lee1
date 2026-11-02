// OTDR(.sor) 해석 결과 표시: 요약 · 트레이스 그래프 · 이벤트표
import { h, GET, modal, table } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt !== undefined) e.textContent = txt; return e; };

function chart(xy, events) {
  const W = 900, H = 320, L = 48, R = 12, T = 12, B = 34;
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const xmax = Math.max(...xs) || 1;
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const X = x => L + (x / xmax) * (W - L - R);
  const Y = y => T + ((ymax - y) / ((ymax - ymin) || 1)) * (H - T - B); // 위쪽이 높은 레벨
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: 'background:#fff;border:1px solid #d4d7db' });
  for (let i = 0; i <= 5; i++) {
    const x = xmax * i / 5, y = ymax - (ymax - ymin) * i / 5;
    svg.append(sv('line', { x1: X(x), x2: X(x), y1: T, y2: H - B, stroke: '#eee' }), sv('text', { x: X(x), y: H - B + 14, 'font-size': 11, 'text-anchor': 'middle', fill: '#555' }, x.toFixed(1)));
    svg.append(sv('line', { x1: L, x2: W - R, y1: Y(y), y2: Y(y), stroke: '#eee' }), sv('text', { x: L - 4, y: Y(y) + 4, 'font-size': 11, 'text-anchor': 'end', fill: '#555' }, y.toFixed(1)));
  }
  svg.append(sv('text', { x: (W + L) / 2, y: H - 4, 'font-size': 11, 'text-anchor': 'middle', fill: '#333' }, '거리 (km)'));
  svg.append(sv('text', { x: 12, y: T + 10, 'font-size': 11, fill: '#333' }, 'dB'));
  for (const e of events || []) {
    if (e.distance_km > xmax) continue;
    svg.append(sv('line', { x1: X(e.distance_km), x2: X(e.distance_km), y1: T, y2: H - B, stroke: e.code?.[1] === 'E' ? '#b3261e' : '#1d4f91', 'stroke-dasharray': '3 3' }));
    svg.append(sv('text', { x: X(e.distance_km) + 3, y: T + 12, 'font-size': 11, fill: '#1d4f91' }, '#' + e.no));
  }
  svg.append(sv('polyline', { points: xy.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' '), fill: 'none', stroke: '#222', 'stroke-width': 1 }));
  return svg;
}

export async function showOtdr(fileId) {
  const d = await GET(`/api/files/${fileId}/sor`);
  const fx = d.fxd || {}, gen = d.gen || {}, sup = d.sup || {};
  const kv = (rows) => h('table', { class: 'kv' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v ?? '-')))));
  const body = h('div', null,
    d.warnings?.length ? h('div', { class: 'demo-flag' }, d.warnings.join(' · ')) : null,
    h('div', { class: 'grid2' },
      kv([['파일', d.file.name], ['형식', d.format], ['측정일시', (fx.datetime || '').replace('T', ' ').slice(0, 16)], ['파장', fx.wavelength_nm ? fx.wavelength_nm + ' nm' : null], ['펄스폭', fx.pulse_width_ns?.join(', ') + ' ns'], ['굴절률(IOR)', fx.index], ['측정 범위', fx.range_km ? fx.range_km.toFixed(2) + ' km' : null]]),
      kv([['광섬유 길이', d.fiber_length_km != null ? d.fiber_length_km.toFixed(3) + ' km' : null], ['총손실', d.summary?.total_loss_db ? d.summary.total_loss_db + ' dB' : '기록 없음'], ['ORL', d.summary?.orl_db ? d.summary.orl_db + ' dB' : '-'], ['케이블 ID', gen.cable_id], ['구간', [gen.location_a, gen.location_b].filter(Boolean).join(' → ')], ['측정기', [sup.supplier, sup.otdr, sup.otdr_sn].filter(Boolean).join(' ')], ['체크섬', d.checksum ? (d.checksum.match ? '일치' : '불일치') : '-']])),
    h('h3', null, '트레이스'),
    d.trace ? chart(d.trace.xy, d.events) : h('div', { class: 'muted' }, '트레이스 데이터 없음'),
    h('h3', null, `이벤트 (${d.events?.length || 0})`),
    table([{ label: '#', get: e => e.no }, { label: '거리 (km)', get: e => e.distance_km.toFixed(3), cls: 'num' }, { label: '종류', get: e => e.type }, { label: '접속손실 (dB)', get: e => e.splice_loss_db, cls: 'num' }, { label: '반사 (dB)', get: e => e.refl_loss_db, cls: 'num' }, { label: '기울기 (dB/km)', get: e => e.slope_db_km, cls: 'num' }, { label: '코드', get: e => e.code }], d.events || []),
    h('p', { class: 'small muted' }, '측정기 파일에 기록된 값을 그대로 표시합니다. 제조사 고유 블록은 해석하지 않습니다. 합격 여부는 현장 시험기준으로만 판정합니다.'));
  modal('OTDR 측정 결과', body, { size: 'wide' });
}
