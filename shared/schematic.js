/* 계통도 자동 배치·배선 경로. 배치도와 같은 장비·케이블 데이터를 사용하며, 수동으로 옮긴 위치(device.sch.manual)는 유지합니다.
 * 열(column): 카메라=0, 녹화장비=마지막, 그 사이 장비는 카메라로부터의 연결 거리(전원선 제외)로 결정
 * 행(row): 연결된 왼쪽 장비들의 평균 높이에 맞춰 정렬(교차 최소화)
 * 배선: 열 사이 통로(lane)에 세로선을 배정하고, 여러 열을 건너는 선은 다른 장비 상자를 피하는 빈 높이로 우회 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./calc.js'));
  else root.CCTVSchematic = factory(root.CCTVCatalog, root.CCTVCalc);
})(typeof self !== 'undefined' ? self : this, function (CAT, C) {
  'use strict';
  const NW = 150, NH = 56, CW = 270, RH = 78;
  const REC = ['nvr', 'dvr', 'hvr', 'server', 'monitor'];
  const PWR = ['psu', 'panel', 'ups', 'power_spd'];
  function groupKey(d, ix, by) {
    const s = ix.sheet.get(d.sheet_id) || {};
    if (by === 'box' && d.props && d.props.container_id) { const b = ix.dev.get(d.props.container_id); if (b) return '함체 ' + b.tag; }
    if (by === 'sheet') return s.name || '';
    if (by === 'floor') return [s.building, s.floor].filter(Boolean).join(' ') || s.name || '';
    return [s.building, s.floor, s.zone].filter(Boolean).join(' ') || s.name || '';
  }
  function layout(model, opts) {
    opts = opts || {}; const by = opts.groupBy || 'zone';
    const ix = C.index(model);
    const skip = ['pull_box', 'manhole', 'handhole', 'cabinet', 'rack', 'pole', 'bracket'];
    const used = new Set(); (model.cables || []).forEach(c => C.endsOf(c).forEach(e => used.add(e.dev)));
    const devs = (model.devices || []).filter(d => (!skip.includes(d.type) || opts.includeAll) && (used.has(d.id) || ['camera'].concat(REC).includes(d.type)));
    const byId = new Map(devs.map(d => [d.id, d]));
    // 인접(전원/비전원 구분)
    const nb = new Map(), nbData = new Map(); devs.forEach(d => { nb.set(d.id, new Set()); nbData.set(d.id, new Set()); });
    (model.cables || []).forEach(c => {
      const e = C.endsOf(c);
      const link = (a, b, power) => { if (!byId.has(a) || !byId.has(b) || a === b) return; nb.get(a).add(b); nb.get(b).add(a); if (!power) { nbData.get(a).add(b); nbData.get(b).add(a); } };
      const m = e.filter(x => x.part === 'main'); if (m.length === 2) link(m[0].dev, m[1].dev, c.kind === 'power' || c.kind === 'ground');
      const p = e.filter(x => x.part === 'power'); if (p.length === 2) link(p[0].dev, p[1].dev, true);
    });
    // 카메라로부터 거리(BFS, 녹화장비에서 멈춤)
    const dist = new Map(); const q = [];
    devs.filter(d => d.type === 'camera').forEach(d => { dist.set(d.id, 0); q.push(d.id); });
    while (q.length) { const id = q.shift(); const d0 = byId.get(id); if (REC.includes(d0.type)) continue; nbData.get(id).forEach(n => { if (!dist.has(n)) { dist.set(n, dist.get(id) + 1); q.push(n); } }); }
    let maxMid = 0; devs.forEach(d => { if (d.type !== 'camera' && !REC.includes(d.type) && dist.has(d.id)) maxMid = Math.max(maxMid, dist.get(d.id)); });
    const recCol = Math.max(maxMid + 1, 2);
    const colOf = d => {
      if (d.type === 'camera') return 0;
      if (REC.includes(d.type)) return d.type === 'monitor' ? recCol + 1 : recCol;
      if (dist.has(d.id)) return Math.min(dist.get(d.id), recCol - 1);
      if (PWR.includes(d.type)) return recCol - 1;
      return Math.min(Math.max(1, (CAT.DEVICE_TYPES[d.type] || {}).role || 1), recCol - 1);
    };
    const nodes = devs.map(d => ({ id: d.id, dev: d, col: colOf(d), group: groupKey(d, ix, by), w: NW, h: NH }));
    const nm = new Map(nodes.map(n => [n.id, n]));
    const cols = {}; nodes.forEach(n => (cols[n.col] = cols[n.col] || []).push(n));
    const keys = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const tag = n => n.dev.tag || '';
    // 0열: 그룹 → 연결 대상(오른쪽 장비) → 번호 순
    const firstRight = n => { const r = [...nb.get(n.id)].map(i => nm.get(i)).filter(x => x && x.col > n.col).map(tag).sort()[0] || ''; return r; };
    (cols[0] || []).sort((a, b) => a.group.localeCompare(b.group, 'ko') || firstRight(a).localeCompare(firstRight(b), 'ko', { numeric: true }) || tag(a).localeCompare(tag(b), 'ko', { numeric: true }));
    let y = 40, last = null; (cols[0] || []).forEach(n => { if (last !== null && n.group !== last) y += 26; last = n.group; n.y = y; y += RH; });
    keys.filter(k => k > 0).forEach(k => {
      const list = cols[k];
      list.forEach(n => { const ys = [...nb.get(n.id)].map(i => nm.get(i)).filter(x => x && x.y != null && x.col < k).map(x => x.y); const ya = [...nb.get(n.id)].map(i => nm.get(i)).filter(x => x && x.y != null).map(x => x.y); const s = ys.length ? ys : ya; n.ideal = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 1e6; });
      list.sort((a, b) => a.ideal - b.ideal || tag(a).localeCompare(tag(b), 'ko', { numeric: true }));
      let prev = -1e9; list.forEach(n => { n.y = Math.max(n.ideal === 1e6 ? prev + RH : n.ideal, prev + RH, 40); prev = n.y; });
    });
    nodes.forEach(n => { n.x = 40 + n.col * CW; if (n.dev.sch && n.dev.sch.manual) { n.x = n.dev.sch.x; n.y = n.dev.sch.y; n.manual = true; } });
    // ----- 배선 -----
    const boxes = nodes.map(n => ({ x0: n.x - 4, x1: n.x + n.w + 4, y0: n.y - 4, y1: n.y + n.h + 4, id: n.id }));
    const hHits = (y, xa, xb, ignore) => boxes.filter(b => !ignore.includes(b.id) && y > b.y0 && y < b.y1 && Math.max(xa, xb) > b.x0 && Math.min(xa, xb) < b.x1);
    const vHits = (x, ya, yb, ignore) => boxes.filter(b => !ignore.includes(b.id) && x > b.x0 && x < b.x1 && Math.max(ya, yb) > b.y0 && Math.min(ya, yb) < b.y1);
    const laneUse = {}; const lane = (xFrom) => { const k = Math.round(xFrom); laneUse[k] = (laneUse[k] || 0) + 1; return xFrom + 10 + ((laneUse[k] - 1) % 18) * 6; };
    const portSlot = {}; const slot = (n, side) => { const k = n.id + side; portSlot[k] = (portSlot[k] || 0) + 1; return n.y + 12 + ((portSlot[k] - 1) * 9) % (n.h - 16); };
    const freeY = (y0, xa, xb, ignore) => { if (!hHits(y0, xa, xb, ignore).length) return y0; for (let d = 6; d < 2000; d += 6) for (const yy of [y0 + d, y0 - d]) if (yy > 10 && !hHits(yy, xa, xb, ignore).length) return yy; return y0; };
    const edges = [];
    const mk = (c, part, a, b, label) => {
      const A0 = nm.get(a.dev), B0 = nm.get(b.dev); if (!A0 || !B0) return;
      const swap = A0.x > B0.x; const A = swap ? B0 : A0, B = swap ? A0 : B0, pa = swap ? b : a, pb = swap ? a : b;
      const ign = [A.id, B.id]; let route;
      const y1 = slot(A, 'R'), y2 = slot(B, A.x === B.x ? 'R' : 'L');
      if (A.x === B.x) { const xv = lane(A.x + A.w); route = [[A.x + A.w, y1], [xv, y1], [xv, y2], [B.x + B.w, y2]]; }
      else {
        const xv1 = lane(A.x + A.w); const xEnd = B.x;
        if (!hHits(y2, xv1, xEnd, ign).length && !vHits(xv1, y1, y2, ign).length) route = [[A.x + A.w, y1], [xv1, y1], [xv1, y2], [xEnd, y2]];
        else {
          const xv2 = lane(B.x - 70) ; const yl = freeY(y1, xv1, xv2, ign);
          route = [[A.x + A.w, y1], [xv1, y1], [xv1, yl], [xv2, yl], [xv2, y2], [xEnd, y2]];
        }
      }
      edges.push({ cable: c, kind: c.kind, part, a: pa, b: pb, label, route });
    };
    (model.cables || []).forEach(c => {
      const L = C.cableLength(c, ix); const pr = ix.prod.get(c.product_id);
      const lab = `${c.tag || ''} ${pr ? pr.spec || pr.name : '(규격 미지정)'}${L.final_m != null ? ' ' + L.final_m + 'm' : ''}`;
      const e = C.endsOf(c);
      const m = e.filter(x => x.part === 'main'); const p = e.filter(x => x.part === 'power');
      if (m.length === 2) mk(c, c.kind === 'composite' ? 'video' : (c.kind === 'power' ? 'power' : 'data'), m[0], m[1], lab);
      if (c.kind === 'composite') {
        const a = p.find(x => x.side === 'from') || (c.from && c.from.dev ? { dev: c.from.dev, port: (c.props && c.props.power_from_port) || 'DC' } : null);
        const b = p.find(x => x.side === 'to');
        if (a && b) mk(c, 'power', a, b, (c.tag || '') + ' (전원부)');
      }
    });
    const groups = {}; nodes.forEach(n => { const k = n.col + '|' + n.group; const g = groups[k] = groups[k] || { label: n.group, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; g.x0 = Math.min(g.x0, n.x - 10); g.y0 = Math.min(g.y0, n.y - 20); g.x1 = Math.max(g.x1, n.x + n.w + 10); g.y1 = Math.max(g.y1, n.y + n.h + 8); });
    const allX = nodes.map(n => n.x + n.w).concat(edges.flatMap(e => e.route.map(p => p[0]))), allY = nodes.map(n => n.y + n.h).concat(edges.flatMap(e => e.route.map(p => p[1])));
    const W = Math.max(...allX, 400) + 60, H = Math.max(...allY, 300) + 60;
    return { nodes, edges, groups: Object.values(groups).filter(g => g.label), width: W, height: H, columns: keys };
  }
  function nodeLabel(d) {
    const p = d.props || {}; const T = (CAT.DEVICE_TYPES[d.type] || {}).name;
    const sub = d.type === 'camera' ? `${p.system || ''} ${p.form || ''}${p.system === 'IP' ? (p.ip ? ' ' + p.ip : '') + (p.nvr_channel ? ' / NVR CH' + p.nvr_channel : '') : (p.signal ? ' ' + p.signal : '')}` : `${d.type === 'custom' && p.custom_label ? p.custom_label : T}${p.channels ? ' ' + p.channels + 'CH' : ''}${p.ports ? ' ' + p.ports + 'P' : ''}`;
    return { title: d.tag || T, sub: sub.trim(), model: [p.maker, p.model].filter(Boolean).join(' ') };
  }
  return { layout, nodeLabel, NW, NH };
});
