/* 공통 계산 엔진: 길이 산출, 회선 추적, 물량·부속 산출, 설계 검토, 화각 계산
 * 화면(브라우저)과 서버 출력(PDF/Excel)이 같은 결과를 내도록 한 파일로 관리합니다.
 * 원칙: 필요한 입력이 없으면 값을 만들지 않고 '확인 필요'로 표시합니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.CCTVCalc = factory(root.CCTVCatalog);
})(typeof self !== 'undefined' ? self : this, function (CAT) {
  'use strict';
  const RHO_CU = 0.0178; // Ω·mm²/m, 20℃ 연동선 (가정값으로 표시)

  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const round2 = v => v == null ? null : Math.round(v * 100) / 100;
  function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }

  function index(model) {
    const dev = new Map(), prod = new Map(), sheet = new Map(), cab = new Map(), cond = new Map();
    (model.devices || []).forEach(d => dev.set(d.id, d));
    (model.products || []).forEach(p => prod.set(p.id, p));
    (model.sheets || []).forEach(s => sheet.set(s.id, s));
    (model.cables || []).forEach(c => cab.set(c.id, c));
    (model.conduits || []).forEach(c => cond.set(c.id, c));
    return { dev, prod, sheet, cab, cond, settings: (model.project && model.project.settings) || {} };
  }

  function upmOf(sheet) { return sheet && sheet.scale && sheet.scale.upm > 0 ? sheet.scale.upm : null; }

  // 케이블 실제 폴리라인: 연결된 끝점은 장비 위치를 따라감
  function cablePoints(c, ix) {
    const pts = (c.points || []).map(p => [p[0], p[1]]);
    const f = c.from && c.from.dev && ix.dev.get(c.from.dev);
    const t = c.to && c.to.dev && ix.dev.get(c.to.dev);
    if (f && f.sheet_id === c.sheet_id) { if (pts.length) pts[0] = [f.x, f.y]; else pts.push([f.x, f.y]); }
    if (t && t.sheet_id === c.sheet_id) { if (pts.length >= 2) pts[pts.length - 1] = [t.x, t.y]; else pts.push([t.x, t.y]); }
    return pts;
  }

  // 길이 산출: 측정 길이 / 수직 / 인입 / 여장 / 최종 수량 구분
  function cableLength(c, ix) {
    const st = ix.settings;
    const sh = ix.sheet.get(c.sheet_id);
    const upm = upmOf(sh);
    const pts = cablePoints(c, ix);
    const du = polyLen(pts);
    const r = { drawing_units: du, measured_m: null, vertical_m: num(c.vertical_m) || 0, entry_m: num(c.entry_m) || 0, tail_m: 0, slack_m: null, total_m: null, final_m: null, status: 'ok', notes: [] };
    if (c.kind === 'composite') r.tail_m = (num(c.props && c.props.split_tail_from_m) || 0) + (num(c.props && c.props.split_tail_to_m) || 0);
    if (!upm) { r.status = '확인 필요'; r.notes.push('축척 미설정 도면 – 길이 미확정'); return r; }
    if (pts.length < 2) { r.status = '확인 필요'; r.notes.push('경로 없음'); return r; }
    r.measured_m = du / upm;
    const base = r.measured_m + r.vertical_m + r.entry_m + r.tail_m;
    let slack = c.slack && c.slack.mode && c.slack.mode !== 'project' ? c.slack : (st.slack || { mode: 'ratio', value: 0, target: 'all' });
    const target = slack.target || 'all';
    const sBase = target === 'measured' ? r.measured_m : base;
    r.slack_m = slack.mode === 'fixed' ? (num(slack.value) || 0) : sBase * (num(slack.value) || 0) / 100;
    r.slack_desc = slack.mode === 'fixed' ? `고정 ${num(slack.value) || 0}m` : `${num(slack.value) || 0}% (${target === 'measured' ? '도면 측정 길이' : '측정+수직+인입'} 기준)`;
    r.total_m = base + r.slack_m;
    const ru = num(st.round_unit_m) || 1;
    r.final_m = Math.ceil(r.total_m / ru - 1e-9) * ru;
    r.round_unit_m = ru;
    if (!c.product_id) { r.notes.push('케이블 규격 미지정'); }
    return r;
  }

  // 여러 도면에 걸친 케이블(연속 구간)은 root 기준으로 합산
  function rootOf(c, ix) { let k = c, g = 0; while (k.parent_id && ix.cab.get(k.parent_id) && g++ < 50) k = ix.cab.get(k.parent_id); return k; }

  function physicalCables(model, ix) {
    ix = ix || index(model);
    const groups = new Map();
    (model.cables || []).forEach(c => {
      const r = rootOf(c, ix);
      if (!groups.has(r.id)) groups.set(r.id, { root: r, parts: [] });
      groups.get(r.id).parts.push(c);
    });
    const out = [];
    groups.forEach(g => {
      const lens = g.parts.map(p => ({ cable: p, len: cableLength(p, ix) }));
      const unknown = lens.some(l => l.len.final_m == null);
      const totalRaw = unknown ? null : lens.reduce((s, l) => s + l.len.total_m, 0);
      const ru = num(ix.settings.round_unit_m) || 1;
      out.push({
        id: g.root.id, tag: g.root.tag, kind: g.root.kind, product_id: g.root.product_id, status: g.root.status,
        parts: lens, total_m: totalRaw, final_m: totalRaw == null ? null : Math.ceil(totalRaw / ru - 1e-9) * ru,
        check: unknown ? '확인 필요' : 'ok'
      });
    });
    return out;
  }

  // ----- 연결 그래프 -----
  function endsOf(c) {
    const e = [];
    if (c.from && c.from.dev) e.push({ dev: c.from.dev, port: c.from.port || '', side: 'from', part: 'main' });
    if (c.to && c.to.dev) e.push({ dev: c.to.dev, port: c.to.port || '', side: 'to', part: 'main' });
    if (c.kind === 'composite' && c.props) {
      if (c.props.power_from_dev) e.push({ dev: c.props.power_from_dev, port: c.props.power_from_port || '', side: 'from', part: 'power' });
      if (c.props.power_to_dev) e.push({ dev: c.props.power_to_dev, port: c.props.power_to_port || '', side: 'to', part: 'power' });
    }
    return e;
  }
  // 광 코어 사용 수: 코어 배정표(core_assign)가 있으면 '사용' 코어 수, 없으면 직접 입력값
  function coresUsed(c) {
    const a = (c.props && c.props.core_assign) || [];
    if (a.length) return a.filter(x => (x.use || '사용') === '사용').length;
    return num(c.props && c.props.cores_used);
  }
  // 광 코어 접속 검토: 케이블 코어 배정 + 광분배함·접속함의 접속(splice) 목록
  function fiberReview(model, ix, R) {
    (model.cables || []).filter(c => c.kind === 'fiber').forEach(c => {
      const pr = ix.prod.get(c.product_id); const cores = pr ? num(pr.props && pr.props.cores) : null;
      const a = (c.props && c.props.core_assign) || []; const seen = {};
      a.forEach(x => { const k = num(x.core); if (k == null) return; if (cores != null && (k < 1 || k > cores)) R('오류', 'CORE_RANGE', `${c.tag} 코어 ${k}번은 코어 수 ${cores}를 벗어남`, [{ type: 'cable', id: c.id }]); if (seen[k]) R('오류', 'CORE_DUP', `${c.tag} 코어 ${k}번 중복 배정`, [{ type: 'cable', id: c.id }]); seen[k] = 1; });
    });
    (model.devices || []).filter(d => (d.props && d.props.splices || []).length).forEach(d => {
      const used = {};
      d.props.splices.forEach((sp, i) => {
        [['in_cable', 'in_core'], ['out_cable', 'out_core']].forEach(([ck, kk]) => {
          const cab = ix.cab.get(sp[ck]); const core = num(sp[kk]);
          if (!cab) { R('오류', 'SPLICE_CABLE', `${d.tag} 접속 ${i + 1}행: 케이블 미지정 또는 삭제됨`, [{ type: 'device', id: d.id }]); return; }
          if (!(endsOf(cab).some(e => e.dev === d.id))) R('오류', 'SPLICE_NOTCONN', `${d.tag} 접속 ${i + 1}행: ${cab.tag}는 이 장비에 연결되지 않음`, [{ type: 'device', id: d.id }]);
          const pr = ix.prod.get(cab.product_id); const cores = pr ? num(pr.props && pr.props.cores) : null;
          if (core == null || (cores != null && (core < 1 || core > cores))) R('오류', 'SPLICE_CORE', `${d.tag} 접속 ${i + 1}행: ${cab.tag} 코어 번호 오류`, [{ type: 'device', id: d.id }]);
          const key = cab.id + '#' + core; if (used[key]) R('오류', 'SPLICE_DUP', `${d.tag}: ${cab.tag} ${core}번 코어가 두 번 접속됨`, [{ type: 'device', id: d.id }]); used[key] = 1;
          const as = ((cab.props && cab.props.core_assign) || []).find(x => num(x.core) === core);
          if ((cab.props && cab.props.core_assign || []).length && (!as || (as.use || '사용') !== '사용')) R('경고', 'SPLICE_UNASSIGNED', `${d.tag}: ${cab.tag} ${core}번 코어가 배정표에서 '사용'이 아님`, [{ type: 'device', id: d.id }]);
        });
      });
    });
  }
  // 같은 도면 케이블 교차점(접속 아님) – 점프 기호 표시용
  function crossings(model, sheetId, ix) {
    ix = ix || index(model);
    const cabs = (model.cables || []).filter(c => c.sheet_id === sheetId).map(c => ({ c, p: cablePoints(c, ix) }));
    const out = [];
    const inter = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null; return { x: a[0] + t * r[0], y: a[1] + t * r[1], ang: Math.atan2(r[1], r[0]) }; };
    for (let i = 0; i < cabs.length; i++) for (let j = 0; j < i; j++) {
      const A = cabs[i], B = cabs[j];
      for (let a = 1; a < A.p.length; a++) for (let b = 1; b < B.p.length; b++) { const x = inter(A.p[a - 1], A.p[a], B.p[b - 1], B.p[b]); if (x) out.push({ ...x, cable: A.c.id, other: B.c.id }); }
    }
    return out;
  }
  // 매체: 해당 케이블이 운반하는 신호
  function carries(c, part) {
    if (c.kind === 'composite') return part === 'power' ? ['power'] : ['video'];
    return (CAT.CABLE_KINDS[c.kind] || { carries: [] }).carries;
  }
  function buildGraph(model) {
    const adj = new Map(); // devId -> [{cable, part, myEnd, otherEnd}]
    const add = (d, x) => { if (!adj.has(d)) adj.set(d, []); adj.get(d).push(x); };
    (model.cables || []).forEach(c => {
      const e = endsOf(c);
      const parts = c.kind === 'composite' ? ['main', 'power'] : ['main'];
      parts.forEach(part => {
        let a, b;
        if (part === 'main') { a = e.find(x => x.side === 'from' && x.part === 'main'); b = e.find(x => x.side === 'to' && x.part === 'main'); }
        else {
          a = e.find(x => x.side === 'from' && x.part === 'power') || (c.props && c.props.power_from_port ? null : null);
          b = e.find(x => x.side === 'to' && x.part === 'power');
          // 복합케이블 전원부의 카메라측 끝은 영상 끝과 같은 장비 (포트만 다름)
          if (!a && c.from && c.from.dev) a = { dev: c.from.dev, port: (c.props && c.props.power_from_port) || 'DC', side: 'from', part: 'power' };
        }
        if (a) add(a.dev, { cable: c, part, me: a, other: b || null });
        if (b) add(b.dev, { cable: c, part, me: b, other: a || null });
      });
    });
    // 도면 간 연결 참조 쌍
    const refs = new Map();
    (model.devices || []).filter(d => d.type === 'offpage' && d.props && d.props.link_ref).forEach(d => {
      const k = d.props.link_ref; if (!refs.has(k)) refs.set(k, []); refs.get(k).push(d.id);
    });
    return { adj, refs };
  }

  const SINKS_VIDEO = ['dvr', 'hvr', 'encoder', 'monitor'];
  // 영상(동축) 회선 추적: 카메라 → (통과장비) → 녹화기/인코더
  function traceFrom(model, ix, g, startDev, medium, sinkTypes, startPortKinds) {
    const results = [];
    const visit = (devId, enteredPort, path, inline, seen, viaRoot) => {
      let list = (g.adj.get(devId) || []).filter(x => carries(x.cable, x.part).includes(medium) || (medium === 'video' && x.cable.kind === 'utp' && inline.some(i => ix.dev.get(i.dev) && ix.dev.get(i.dev).type === 'balun')));
      // 도면 간 연결 참조를 지나온 경우: 같은 물리 케이블(연속 구간)만 이어서 추적
      if (viaRoot) { const same = list.filter(x => rootOf(x.cable, ix).id === viaRoot); if (same.length) list = same; }
      let any = false;
      for (const x of list) {
        if (path.length === 0 && startPortKinds && x.me.port && !startPortKinds.includes(x.me.port)) continue;
        if (path.length > 0 && x.me.port === enteredPort && x.cable.id === path[path.length - 1].cable.id) continue;
        if (seen.has(x.cable.id + x.part)) continue;
        if (!x.other) { results.push({ path: path.concat([{ cable: x.cable, part: x.part, from: x.me, to: null }]), inline, sink: null, open: true }); any = true; continue; }
        const nd = ix.dev.get(x.other.dev);
        const step = { cable: x.cable, part: x.part, from: x.me, to: x.other };
        const np = path.concat([step]);
        const ns = new Set(seen); ns.add(x.cable.id + x.part);
        if (!nd) { results.push({ path: np, inline, sink: null, open: true }); any = true; continue; }
        if (sinkTypes.includes(nd.type)) { results.push({ path: np, inline, sink: nd, sink_port: x.other.port }); any = true; continue; }
        const T = CAT.DEVICE_TYPES[nd.type] || {};
        if (T.pass && (T.pass.includes(medium) || (nd.type === 'balun'))) {
          if (nd.type === 'offpage') {
            const mates = (g.refs.get(nd.props.link_ref) || []).filter(id => id !== nd.id);
            if (!mates.length) { results.push({ path: np, inline: inline.concat([{ dev: nd.id }]), sink: null, open: true, note: '연결 참조 짝 없음' }); any = true; continue; }
            mates.forEach(m => visit(m, null, np, inline.concat([{ dev: nd.id }, { dev: m }]), ns, rootOf(x.cable, ix).id));
            any = true; continue;
          }
          visit(nd.id, x.other.port, np, inline.concat([{ dev: nd.id, port_in: x.other.port }]), ns);
          any = true; continue;
        }
        results.push({ path: np, inline, sink: nd, sink_port: x.other.port, unexpected: true }); any = true;
      }
      if (!any && path.length) results.push({ path, inline, sink: null, open: true });
    };
    visit(startDev, null, [], [], new Set());
    return results;
  }

  function circuits(model, ix) {
    ix = ix || index(model);
    const g = buildGraph(model);
    const out = [];
    (model.devices || []).filter(d => d.type === 'camera').forEach(cam => {
      const p = cam.props || {};
      if (p.system === '동축' || p.system === '기타') {
        const r = traceFrom(model, ix, g, cam.id, 'video', SINKS_VIDEO, ['VIDEO']);
        const best = r.find(x => x.sink) || r[0];
        out.push({ kind: 'video', camera: cam.id, routes: r, sink: best && best.sink ? best.sink.id : null, sink_port: best && best.sink_port || null, path: best ? best.path : [], inline: best ? best.inline : [] });
      }
      if (p.system === 'IP' || p.system === '기타') {
        const r = traceFrom(model, ix, g, cam.id, 'data', ['switch', 'poe_switch', 'fiber_switch', 'nvr', 'hvr', 'server'], ['LAN']);
        // 광구간(광컨버터) 통과를 위해 fiber 매체도 이어서 추적
        let best = r.find(x => x.sink) || r[0];
        if ((!best || !best.sink) && r.length) {
          // 광컨버터에서 광으로 전환된 경우
          const mc = r.map(x => x.path[x.path.length - 1]).find(s => s && s.to && ix.dev.get(s.to.dev) && ['media_converter', 'sfp'].includes(ix.dev.get(s.to.dev).type));
          if (mc) {
            const r2 = traceFrom(model, ix, g, mc.to.dev, 'fiber', ['switch', 'poe_switch', 'fiber_switch', 'nvr', 'hvr', 'media_converter'], null);
            const b2 = r2.find(x => x.sink);
            if (b2) best = { path: best.path.concat(b2.path), inline: best.inline.concat([{ dev: mc.to.dev }]), sink: b2.sink, sink_port: b2.sink_port };
          }
        }
        out.push({ kind: 'data', camera: cam.id, routes: r, sink: best && best.sink ? best.sink.id : null, sink_port: best && best.sink_port || null, path: best ? best.path : [], inline: best ? best.inline : [] });
      }
      const needsPower = !(p.system === 'IP' && p.poe) && p.power_mode !== 'PoC';
      if (needsPower) {
        const r = traceFrom(model, ix, g, cam.id, 'power', ['psu', 'panel', 'ups'], ['DC', '']);
        const best = r.find(x => x.sink) || r[0];
        out.push({ kind: 'power', camera: cam.id, routes: r, sink: best && best.sink ? best.sink.id : null, sink_port: best && best.sink_port || null, path: best ? best.path : [], inline: best ? best.inline : [] });
      }
    });
    return out;
  }

  // 스위치 간 네트워크 도달성(스위치 → NVR)
  function networkReach(model, ix, fromDev, targetId) {
    const g = buildGraph(model);
    const seen = new Set([fromDev]); const q = [fromDev];
    while (q.length) {
      const d = q.shift(); if (d === targetId) return true;
      (g.adj.get(d) || []).forEach(x => {
        if (!x.other) return; const m = carries(x.cable, x.part);
        if (!(m.includes('data') || m.includes('fiber'))) return;
        const nd = ix.dev.get(x.other.dev); if (!nd || seen.has(nd.id)) return;
        if (nd.type === 'camera') return;
        seen.add(nd.id); q.push(nd.id);
      });
    }
    return false;
  }

  // ----- 화각 -----
  function fovGeometry(cam, upm) {
    const p = cam.props || {};
    const hfov = num(p.hfov), range = num(p.range), dir = num(p.direction) || 0;
    const res = { ok: false, notes: [] };
    if (!upm) { res.notes.push('축척 미설정 – 화각 길이 표시 불가'); return res; }
    if (hfov == null || range == null) { res.notes.push('수평 화각 또는 설계 감시거리 미입력'); return res; }
    res.ok = true; res.dir = dir; res.hfov = hfov; res.r_du = range * upm; res.range_m = range;
    res.ptz = p.form === 'PTZ';
    res.fisheye = p.form === '어안' || hfov >= 360;
    res.basis = '평면상 예상 범위(벽체·수목·차량·높이 차이 미반영)';
    const h = num(p.height), tilt = num(p.tilt), vfov = num(p.vfov);
    if (h != null && tilt != null && vfov != null && h > 0) {
      const toR = a => a * Math.PI / 180;
      const lo = tilt + vfov / 2, hi = tilt - vfov / 2;
      const near = lo >= 90 ? 0 : h / Math.tan(toR(lo));
      const far = hi <= 0 ? null : h / Math.tan(toR(hi));
      res.ground = { near_m: round2(near), far_m: far == null ? null : round2(Math.min(far, range)), far_limited: far == null || far > range, assume: `설치높이 ${h}m, 하향각 ${tilt}°, 수직화각 ${vfov}° 기준 평탄 지면 가정` };
    } else res.notes.push('지면 투영: 설치높이·하향각·수직화각 입력 시 계산');
    const hpx = num(p.h_pixels);
    if (hpx && hfov < 180) {
      const ppm = d => hpx / (2 * d * Math.tan((hfov / 2) * Math.PI / 180));
      res.ppm_at_range = round2(ppm(range));
      res.ppm_basis = `가로 ${hpx}px, 수평화각 ${hfov}°, 거리 ${range}m (계산값)`;
    }
    return res;
  }
  function sectorPolygon(cx, cy, dirDeg, fovDeg, r, rIn, steps) {
    steps = steps || 24; rIn = rIn || 0;
    const pts = []; const a0 = (dirDeg - fovDeg / 2) * Math.PI / 180, a1 = (dirDeg + fovDeg / 2) * Math.PI / 180;
    // 각도: 0°=도면 위쪽(북), 시계방향
    const P = (a, rr) => [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
    for (let i = 0; i <= steps; i++) pts.push(P(a0 + (a1 - a0) * i / steps, r));
    if (rIn > 0) for (let i = steps; i >= 0; i--) pts.push(P(a0 + (a1 - a0) * i / steps, rIn));
    else pts.push([cx, cy]);
    return pts;
  }
  function pointInPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
  // 검토영역 내 감시 커버리지(격자 샘플링)
  function coverage(model, sheetId, area, gridN) {
    const ix = index(model); const sh = ix.sheet.get(sheetId); const upm = upmOf(sh);
    if (!upm || !area || area.length < 3) return null;
    const cams = (model.devices || []).filter(d => d.sheet_id === sheetId && d.type === 'camera');
    const polys = cams.map(c => { const g = fovGeometry(c, upm); if (!g.ok) return null; if (g.fisheye || g.ptz) return { c, circle: g.r_du }; return { c, poly: sectorPolygon(c.x, c.y, g.dir, g.hfov, g.r_du) }; }).filter(Boolean);
    const xs = area.map(p => p[0]), ys = area.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    gridN = gridN || 60; const sx = (x1 - x0) / gridN, sy = (y1 - y0) / gridN;
    let tot = 0, c0 = 0, c1 = 0, c2 = 0; const cells = [];
    for (let i = 0; i < gridN; i++) for (let j = 0; j < gridN; j++) {
      const x = x0 + (i + 0.5) * sx, y = y0 + (j + 0.5) * sy;
      if (!pointInPoly(x, y, area)) continue; tot++;
      let n = 0; polys.forEach(p => { if (p.circle ? Math.hypot(x - p.c.x, y - p.c.y) <= p.circle : pointInPoly(x, y, p.poly)) n++; });
      if (n === 0) c0++; else if (n === 1) c1++; else c2++;
      cells.push([x - sx / 2, y - sy / 2, sx, sy, n]);
    }
    return { total: tot, blind_pct: tot ? round2(c0 / tot * 100) : 0, single_pct: tot ? round2(c1 / tot * 100) : 0, overlap_pct: tot ? round2(c2 / tot * 100) : 0, cells, basis: '평면 2D 부채꼴 기준 격자 샘플링(장애물·높이 미반영)' };
  }

  // ----- 부속자재 산출 -----
  const DEFAULT_RULES = [
    { id: 'r1', cable_kind: 'coax', end: 'device', role: 'bnc', qty: 1, label: '동축 끝단 BNC' },
    { id: 'r2', cable_kind: 'composite', end: 'device', role: 'bnc', qty: 1, label: '복합 영상부 끝단 BNC' },
    { id: 'r3', cable_kind: 'composite', end: 'power_camera', role: 'dc_plug', qty: 1, label: '복합 전원부 카메라측 전원 커넥터' },
    { id: 'r3b', cable_kind: 'composite', end: 'power_device', role: 'terminal', qty: 2, label: '복합 전원부 전원장치측 단자' },
    { id: 'r4', cable_kind: 'utp', end: 'device', role: 'rj45_plug', qty: 1, label: 'UTP 장비측 RJ45 플러그' },
    { id: 'r5', cable_kind: 'utp', end: 'panel', role: 'rj45_jack', qty: 1, label: 'UTP 패치패널측 잭' },
    { id: 'r6', cable_kind: 'stp', end: 'device', role: 'rj45_plug_stp', qty: 1, label: '차폐 RJ45 플러그' },
    { id: 'r7', cable_kind: 'fiber', end: 'fdf', role: 'pigtail', qty: 'cores_used', label: '광분배함측 피그테일(사용 코어)' },
    { id: 'r8', cable_kind: 'fiber', end: 'device', role: 'fiber_conn', qty: 'cores_used', label: '장비측 광커넥터(사용 코어)' },
    { id: 'r9', cable_kind: 'power', end: 'camera', role: 'dc_plug', qty: 1, label: '카메라측 DC 플러그' },
    { id: 'r10', cable_kind: 'power', end: 'device', role: 'terminal', qty: 2, label: '전원 단자(압착단자)' },
    { id: 'r11', cable_kind: 'ground', end: 'device', role: 'lug', qty: 1, label: '접지 압착단자' },
    { id: 'r12', cable_kind: '*', end: 'outdoor', role: 'waterproof', qty: 1, label: '옥외 끝단 방수처리' },
    { id: 'r13', cable_kind: '*', end: 'any', role: 'label', qty: 1, label: '케이블 식별표시' }
  ];

  function endClass(dev, cableKind, part) {
    if (!dev) return null;
    if (dev.type === 'offpage') return 'pass'; // 도면 연속: 부속 미발생
    if (part === 'power') return dev.type === 'camera' ? 'power_camera' : 'power_device';
    if (dev.type === 'patch_panel') return 'panel';
    if (dev.type === 'fdf') return 'fdf';
    if (dev.type === 'camera') return 'camera';
    return 'device';
  }

  function accessories(model, ix) {
    ix = ix || index(model);
    const rules = (ix.settings.accessory_rules && ix.settings.accessory_rules.length) ? ix.settings.accessory_rules : DEFAULT_RULES;
    const items = new Map(); // role -> {role, qty, basis[]}
    const add = (role, q, basis, ref, label) => {
      if (!q) return; if (!items.has(role)) items.set(role, { role, auto: 0, basis: [], refs: [], label });
      const it = items.get(role); it.auto += q; it.basis.push(basis); it.refs.push(ref);
    };
    (model.cables || []).forEach(c => {
      const pr = c.props || {};
      const ends = endsOf(c);
      // 끝단 목록 (연결 안된 끝도 끝단으로 계산하지 않음 → 검토 경고로 처리)
      const consider = [];
      ends.forEach(e => consider.push(e));
      if (c.kind === 'composite' && !ends.some(e => e.part === 'power' && e.side === 'from') && c.from && c.from.dev) consider.push({ dev: c.from.dev, port: pr.power_from_port || 'DC', side: 'from', part: 'power' });
      consider.forEach(e => {
        const d = ix.dev.get(e.dev); const cls = endClass(d, c.kind, e.part);
        if (!cls || cls === 'pass') return;
        const sideKey = e.side + (e.part === 'power' ? '_power' : '');
        const factory = pr.factory_terminated === true || pr['factory_' + sideKey] === true || (d && d.props && d.props.integrated_terminal && e.part === 'main' && pr.use_integrated !== false && false);
        const integrated = pr['integrated_' + sideKey] === true; // 장비 기본 제공품/일체형 단자
        rules.forEach(r => {
          if (r.cable_kind !== '*' && r.cable_kind !== c.kind) return;
          let match = false;
          if (r.end === 'any') match = e.part === 'main';
          else if (r.end === 'outdoor') match = e.part === 'main' && pr['outdoor_' + e.side] === true;
          else if (r.end === 'power') match = e.part === 'power';
          else if (r.end === 'power_camera' || r.end === 'power_device') match = e.part === 'power' && cls === r.end;
          else if (r.end === 'device') match = e.part === 'main' ? (cls === 'device' || cls === 'camera' || (c.kind !== 'utp' && cls === 'panel') || (c.kind !== 'fiber' && cls === 'fdf')) : false;
          else match = e.part === 'main' && cls === r.end;
          if (c.kind === 'power' && r.end === 'device' && cls === 'camera') match = false;
          if (c.kind === 'power' && r.end === 'camera' && cls !== 'camera') match = false;
          if (!match) return;
          if ((factory || integrated) && !['label', 'waterproof'].includes(r.role)) return;
          const q = r.qty === 'cores_used' ? (coresUsed(c) || 0) : (num(r.qty) || 0);
          add(r.role, q, `${c.tag || c.id} ${e.side === 'from' ? '시작' : '종료'}${e.part === 'power' ? '(전원부)' : ''} @${d ? (d.tag || d.type) : '?'}`, { type: 'cable', id: c.id }, r.label);
        });
      });
    });
    const adj = ix.settings.accessory_adjust || {};
    const out = [];
    items.forEach(it => {
      const a = adj[it.role] || {};
      const manual = num(a.delta) || 0;
      out.push({ role: it.role, label: it.label, auto: it.auto, manual, qty: it.auto + manual, basis: it.basis, refs: it.refs, reason: a.reason || '' });
    });
    Object.keys(adj).forEach(role => { if (!items.has(role) && num(adj[role].delta)) out.push({ role, label: adj[role].label || role, auto: 0, manual: num(adj[role].delta), qty: num(adj[role].delta), basis: ['수동 추가'], refs: [], reason: adj[role].reason || '' }); });
    // 역할 → 품목 매핑
    const roleProd = {};
    (model.products || []).filter(p => p.category === 'accessory').forEach(p => { const r = p.props && p.props.role; if (r && !roleProd[r]) roleProd[r] = p; });
    out.forEach(o => { const p = roleProd[o.role]; o.product = p ? { id: p.id, name: p.name, spec: p.spec, unit: p.unit || 'EA' } : null; });
    return out;
  }

  // ----- 관로 -----
  function conduitLength(cd, ix) {
    const sh = ix.sheet.get(cd.sheet_id); const upm = upmOf(sh);
    const du = polyLen(cd.points || []);
    if (!upm) return { measured_m: null, final_m: null, status: '확인 필요', note: '축척 미설정' };
    const m = du / upm + (num(cd.extra_m) || 0) + (num(cd.vertical_m) || 0);
    const ru = num(ix.settings.round_unit_m) || 1;
    return { measured_m: du / upm, extra_m: (num(cd.extra_m) || 0) + (num(cd.vertical_m) || 0), final_m: Math.ceil(m / ru - 1e-9) * ru, status: 'ok' };
  }
  function bends(pts, minDeg) {
    let n = 0; for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let d = Math.abs((b - a) * 180 / Math.PI); if (d > 180) d = 360 - d; if (d >= (minDeg || 30)) n++;
    } return n;
  }
  function conduitReport(model, ix) {
    ix = ix || index(model);
    const lim = num(ix.settings.fill_limit_pct);
    return (model.conduits || []).map(cd => {
      const L = conduitLength(cd, ix);
      const pr = ix.prod.get(cd.product_id);
      const cables = (model.cables || []).filter(c => (c.conduit_ids || []).includes(cd.id));
      const idmm = pr && num(pr.props && pr.props.inner_d_mm);
      const ods = cables.map(c => { const p = ix.prod.get(c.product_id); return { tag: c.tag, od: p ? num(p.props && p.props.od_mm) : null }; });
      let fill = null, fillNote = '';
      const isTray = pr && pr.kind === 'tray';
      if (isTray) {
        const w = num(pr.props && pr.props.width_mm), h = num(pr.props && pr.props.height_mm);
        if (w && h && ods.every(o => o.od)) { fill = ods.reduce((s, o) => s + Math.PI / 4 * o.od * o.od, 0) / (w * h) * 100; fillNote = `Σ(π/4×외경²) ÷ (폭 ${w}×높이 ${h}) ×100`; }
        else fillNote = '트레이 폭·높이 또는 케이블 외경 미입력';
      } else if (idmm && ods.length && ods.every(o => o.od)) {
        fill = ods.reduce((s, o) => s + o.od * o.od, 0) / (idmm * idmm) * 100;
        fillNote = `Σ(외경²) ÷ 내경² ×100 = (${ods.map(o => o.od + '²').join('+')}) ÷ ${idmm}² ×100`;
      } else fillNote = !idmm ? '관 내경 미입력' : (ods.length ? '일부 케이블 외경 미입력' : '수용 케이블 없음');
      const rule = ix.settings.coupling_interval_m ? num(ix.settings.coupling_interval_m) : null;
      const sugg = [];
      if (L.final_m != null && rule) sugg.push({ item: '커플링', qty: Math.max(0, Math.ceil(L.final_m / rule) - 1), basis: `${rule}m 간격 사용자 규칙` });
      const b = bends(cd.points || [], 30); if (b) sugg.push({ item: '밴드(방향 전환)', qty: b, basis: '경로 꺾임 30° 이상 개소' });
      return { id: cd.id, tag: cd.tag, product: pr ? pr.name + ' ' + (pr.spec || '') : '(규격 미지정)', product_id: cd.product_id, method: cd.method, status: cd.status, len: L, cables: cables.map(c => c.tag || c.id), fill_pct: round2(fill), fill_note: fillNote, fill_limit: lim, fill_state: fill == null ? '확인 필요' : (lim == null ? '기준 미설정' : (fill > lim ? '초과' : '적합(입력 기준)')), suggestions: sugg, adjust: cd.fitting_adjust || {} };
    });
  }

  // ----- 전압강하 -----
  function voltageDrop(circuit, model, ix) {
    const cam = ix.dev.get(circuit.camera); const src = circuit.sink && ix.dev.get(circuit.sink);
    if (!cam || !src) return null;
    const V = num(src.props && src.props.voltage); const P = num(cam.props && cam.props.power_w);
    let L = 0, mm2 = null, unknown = false;
    for (const s of circuit.path) {
      const len = cableLength(s.cable, ix); if (len.final_m == null) { unknown = true; break; } L += len.measured_m + len.vertical_m + len.entry_m;
      const pr = ix.prod.get(s.cable.product_id);
      const a = pr && num(s.part === 'power' && s.cable.kind === 'composite' ? pr.props.power_mm2 : pr.props.conductor_mm2);
      if (a == null) { unknown = true; break; } mm2 = mm2 == null ? a : Math.min(mm2, a);
    }
    const missing = [];
    if (V == null) missing.push('공급전압'); if (P == null) missing.push('카메라 소비전력'); if (unknown) missing.push('길이 또는 도체 단면적');
    if (missing.length) return { ok: false, missing };
    const I = P / V; const R = RHO_CU * L / mm2; const vd = 2 * I * R;
    return { ok: true, V, P, I: round2(I), L_m: round2(L), mm2, vd: round2(vd), pct: round2(vd / V * 100), formula: 'e = 2 × I × (ρ × L ÷ A)', assume: `2선식, 동 저항률 ${RHO_CU} Ω·mm²/m(20℃), 역률 1, 여장 제외 경로길이 기준` };
  }

  // 감쇠 계산 (제품 데이터가 있을 때만)
  function attenuation(cable, freq, lenM, ix) {
    const pr = ix.prod.get(cable.product_id); const t = pr && pr.props && pr.props.attenuation;
    if (!t || !t.length || freq == null || lenM == null) return null;
    const pts = t.map(r => [num(r.freq_mhz), num(r.db_per_100m)]).filter(r => r[0] != null && r[1] != null).sort((a, b) => a[0] - b[0]);
    if (!pts.length) return null;
    let db;
    if (freq <= pts[0][0]) db = pts[0][1]; else if (freq >= pts[pts.length - 1][0]) { if (freq > pts[pts.length - 1][0]) return null; db = pts[pts.length - 1][1]; }
    else for (let i = 1; i < pts.length; i++) if (freq <= pts[i][0]) { const [f0, d0] = pts[i - 1], [f1, d1] = pts[i]; db = d0 + (d1 - d0) * (freq - f0) / (f1 - f0); break; }
    return { db_per_100m: round2(db), total_db: round2(db * lenM / 100), freq };
  }

  // ----- 대역폭·저장용량 -----
  function storage(model, ix) {
    ix = ix || index(model);
    const recs = (model.devices || []).filter(d => ['nvr', 'dvr', 'hvr', 'server'].includes(d.type));
    const circ = circuits(model, ix);
    return recs.map(r => {
      const rp = r.props || {};
      const cams = (model.devices || []).filter(d => d.type === 'camera' && ((d.props || {}).nvr_id === r.id || circ.some(c => c.kind === 'video' && c.camera === d.id && c.sink === r.id)));
      const rows = cams.map(c => {
        const p = c.props || {};
        const isCoax = p.system === '동축';
        const br = isCoax ? num((rp.ch_bitrate || {})[circ.find(x => x.camera === c.id && x.kind === 'video') ? circ.find(x => x.camera === c.id && x.kind === 'video').sink_port : ''] || rp.record_bitrate_mbps) : num(p.bitrate_mbps);
        return { cam: c.tag, br, basis: isCoax ? 'DVR 녹화 설정' : '카메라 비트레이트' };
      });
      const missing = rows.filter(x => x.br == null).map(x => x.cam);
      const days = num(rp.record_days), hours = num(rp.record_hours) == null ? 24 : num(rp.record_hours);
      const mode = rp.record_mode || '연속'; const ratio = mode === '이벤트' ? (num(rp.event_ratio_pct)) : 100;
      const sum = rows.reduce((s, x) => s + (x.br || 0), 0);
      let req = null; if (days != null && ratio != null && !missing.length) req = sum * 3600 * hours * days * (ratio / 100) / 8 / 1000; // GB
      const n = num(rp.disk_count), sz = num(rp.disk_tb);
      let usable = null; const raid = rp.raid || '없음';
      if (n && sz) usable = { '없음': n, 'RAID1': n / 2, 'RAID5': n - 1, 'RAID6': n - 2, 'RAID10': n / 2 }[raid] * sz;
      return { id: r.id, tag: r.tag, cams: rows, total_mbps: round2(sum), missing, days, hours, mode, ratio, required_gb: round2(req), required_tb: req == null ? null : round2(req / 1000), raid, raw_tb: n && sz ? n * sz : null, usable_tb: usable == null ? null : round2(usable), formula: 'GB = Σ비트레이트(Mbps) × 3600 × 시간 × 일수 × 녹화비율 ÷ 8 ÷ 1000', assume: `${mode} 녹화${mode === '이벤트' ? ' (이벤트 비율 ' + (ratio == null ? '미입력' : ratio + '%') + ')' : ''}, 1TB=1000GB, 파일시스템 오버헤드 미반영` };
    });
  }
  function bandwidth(model, ix) {
    ix = ix || index(model);
    const circ = circuits(model, ix);
    const sw = {};
    circ.filter(c => c.kind === 'data' && c.sink).forEach(c => { const cam = ix.dev.get(c.camera); (sw[c.sink] = sw[c.sink] || []).push({ tag: cam.tag, mbps: num(cam.props && cam.props.bitrate_mbps) }); });
    const total = (model.devices || []).filter(d => d.type === 'camera' && (d.props || {}).system === 'IP').reduce((s, d) => s + (num(d.props.bitrate_mbps) || 0), 0);
    return { per_switch: Object.keys(sw).map(k => ({ id: k, tag: (ix.dev.get(k) || {}).tag, cams: sw[k], mbps: round2(sw[k].reduce((s, x) => s + (x.mbps || 0), 0)), missing: sw[k].filter(x => x.mbps == null).map(x => x.tag) })), total_mbps: round2(total) };
  }

  // ----- 설계 검토 -----
  function review(model) {
    const ix = index(model); const st = ix.settings;
    const out = [];
    const R = (level, code, msg, refs) => out.push({ level, code, msg, refs: refs || [] });
    const devs = model.devices || [], cabs = model.cables || [];
    // 축척
    (model.sheets || []).forEach(s => { if (!upmOf(s)) R('확인 필요', 'SCALE', `도면 「${s.name}」 축척 미설정 – 거리·물량 미확정`, [{ type: 'sheet', id: s.id }]); });
    // 번호 중복
    const byTag = {}; devs.forEach(d => { if (!d.tag) { R('경고', 'TAG_EMPTY', `${(CAT.DEVICE_TYPES[d.type] || {}).name || d.type} 장비번호 없음`, [{ type: 'device', id: d.id }]); return; } (byTag[d.tag] = byTag[d.tag] || []).push(d); });
    Object.keys(byTag).forEach(t => { if (byTag[t].length > 1) R('오류', 'TAG_DUP', `장비번호 중복: ${t} (${byTag[t].length}개)`, byTag[t].map(d => ({ type: 'device', id: d.id }))); });
    const cTag = {}; cabs.forEach(c => { if (c.tag && !c.parent_id) (cTag[c.tag] = cTag[c.tag] || []).push(c); });
    Object.keys(cTag).forEach(t => { if (cTag[t].length > 1) R('오류', 'CTAG_DUP', `케이블번호 중복: ${t}`, cTag[t].map(c => ({ type: 'cable', id: c.id }))); });
    // IP 중복
    const ips = {}; devs.forEach(d => { const ip = d.props && d.props.ip; if (ip) (ips[ip] = ips[ip] || []).push(d); });
    Object.keys(ips).forEach(ip => { if (ips[ip].length > 1) R('오류', 'IP_DUP', `IP 주소 중복: ${ip} (${ips[ip].map(d => d.tag).join(', ')})`, ips[ip].map(d => ({ type: 'device', id: d.id }))); });
    // 포트 중복 사용 / 포트 존재
    const portUse = {};
    cabs.forEach(c => endsOf(c).forEach(e => {
      const d = ix.dev.get(e.dev); if (!d) { R('오류', 'END_MISSING', `케이블 ${c.tag} 연결 장비가 삭제됨`, [{ type: 'cable', id: c.id }]); return; }
      if (d.type === 'offpage' || CAT.DEVICE_TYPES[d.type].container) return;
      if (!e.port) { R('경고', 'PORT_EMPTY', `케이블 ${c.tag} – ${d.tag} 연결 포트 미지정`, [{ type: 'cable', id: c.id }]); return; }
      const ports = CAT.portsFor(d); const pt = ports.find(p => p.id === e.port);
      if (!pt) R('오류', 'PORT_NONE', `${d.tag}에 포트 ${e.port} 없음 (포트 수 부족 가능)`, [{ type: 'device', id: d.id }, { type: 'cable', id: c.id }]);
      else if (!CAT.cableFitsPort(c.kind === 'composite' ? (e.part === 'power' ? 'power' : 'coax') : c.kind, pt.kind)) R('경고', 'PORT_KIND', `${c.tag}(${CAT.CABLE_KINDS[c.kind].name})이 ${d.tag} ${e.port}(${pt.kind}) 포트에 연결됨`, [{ type: 'cable', id: c.id }]);
      const k = d.id + '|' + e.port; (portUse[k] = portUse[k] || []).push(c);
    }));
    Object.keys(portUse).forEach(k => { if (portUse[k].length > 1) { const d = ix.dev.get(k.split('|')[0]); R('오류', 'PORT_DUP', `포트 중복 연결: ${d.tag} ${k.split('|')[1]} ← ${portUse[k].map(c => c.tag).join(', ')}`, portUse[k].map(c => ({ type: 'cable', id: c.id }))); } });
    // 케이블 사양·미연결
    cabs.forEach(c => {
      if (!c.product_id) R('경고', 'CABLE_SPEC', `케이블 ${c.tag || c.id} 규격 미지정`, [{ type: 'cable', id: c.id }]);
      if (!(c.from && c.from.dev) || !(c.to && c.to.dev)) R('경고', 'CABLE_OPEN', `케이블 ${c.tag || c.id} 미연결 끝단 있음`, [{ type: 'cable', id: c.id }]);
      const pr = ix.prod.get(c.product_id); const L = cableLength(c, ix);
      if (pr && num(pr.props && pr.props.max_length_m) && L.final_m != null) {
        const tot = physicalCables({ ...model, cables: cabs.filter(x => rootOf(x, ix).id === rootOf(c, ix).id) }, ix)[0];
        if (tot && tot.final_m > num(pr.props.max_length_m) && !c.parent_id) R('경고', 'LEN_OVER', `${c.tag} 길이 ${tot.final_m}m > 등록 기준 ${pr.props.max_length_m}m (${pr.props.max_length_basis || '제품 등록값'})`, [{ type: 'cable', id: c.id }]);
      }
      if (c.kind === 'fiber') {
        const cores = pr ? num(pr.props && pr.props.cores) : null; const used = coresUsed(c);
        if (cores == null) R('확인 필요', 'FIBER_CORES', `${c.tag} 광케이블 코어 수 미입력`, [{ type: 'cable', id: c.id }]);
        else if (used != null && used > cores) R('오류', 'FIBER_SHORT', `${c.tag} 사용 코어 ${used} > 코어 수 ${cores}`, [{ type: 'cable', id: c.id }]);
        else if (used != null && cores - used < (num(c.props.cores_spare) || 0)) R('경고', 'FIBER_SPARE', `${c.tag} 예비 코어 부족 (필요 ${c.props.cores_spare}, 여유 ${cores - used})`, [{ type: 'cable', id: c.id }]);
      }
    });
    const circ = circuits(model, ix);
    const sigOf = cam => (cam.props || {}).signal;
    devs.filter(d => d.type === 'camera').forEach(cam => {
      const p = cam.props || {};
      const mine = circ.filter(c => c.camera === cam.id);
      const anyCable = cabs.some(c => endsOf(c).some(e => e.dev === cam.id));
      if (!anyCable) { R('오류', 'CAM_OPEN', `미연결 CCTV: ${cam.tag}`, [{ type: 'device', id: cam.id }]); }
      if (p.system === 'IP') {
        const dc = mine.find(c => c.kind === 'data');
        if (anyCable && (!dc || !dc.sink)) R('오류', 'IP_NOLINK', `${cam.tag} 네트워크(스위치) 연결 누락`, [{ type: 'device', id: cam.id }]);
        if (!p.nvr_id) R('경고', 'NVR_NONE', `${cam.tag} 연결 NVR 미지정`, [{ type: 'device', id: cam.id }]);
        else if (dc && dc.sink && !networkReach(model, ix, dc.sink, p.nvr_id)) R('오류', 'NVR_UNREACH', `${cam.tag} – 지정 NVR까지 네트워크 경로 없음`, [{ type: 'device', id: cam.id }]);
        if (!p.ip) R('확인 필요', 'IP_NONE', `${cam.tag} IP 주소 미입력`, [{ type: 'device', id: cam.id }]);
        if (p.poe && dc && dc.sink) {
          const sw = ix.dev.get(dc.sink); const sp = sw.props || {};
          if (sw.type !== 'poe_switch' && !num(sp.poe_budget_w)) R('오류', 'POE_NOSRC', `${cam.tag} PoE 사용이나 연결 장비 ${sw.tag}가 PoE 공급 장비로 등록되지 않음`, [{ type: 'device', id: cam.id }]);
          else if (num(p.poe_w) == null) R('확인 필요', 'POE_W', `${cam.tag} PoE 요구전력 미입력`, [{ type: 'device', id: cam.id }]);
          else if (num(sp.poe_port_max_w) == null) R('확인 필요', 'POE_PORT', `${sw.tag} 포트당 PoE 최대 공급전력 미입력`, [{ type: 'device', id: sw.id }]);
          else if (num(p.poe_w) > num(sp.poe_port_max_w)) R('오류', 'POE_PORT_OVER', `${cam.tag} PoE ${p.poe_w}W > ${sw.tag} 포트 최대 ${sp.poe_port_max_w}W`, [{ type: 'device', id: cam.id }]);
        }
      }
      if (p.system === '동축') {
        const vc = mine.find(c => c.kind === 'video');
        if (!vc || !vc.sink) { if (anyCable) R('오류', 'VIDEO_OPEN', `${cam.tag} 영상 회선이 녹화장비까지 연결되지 않음`, [{ type: 'device', id: cam.id }]); }
        else {
          const sink = ix.dev.get(vc.sink); const sp = sink.props || {};
          // 신호 호환성: 제품 지원 사양 기준
          const sup = sp.supported_inputs; // [{signal, max_res, max_fps}]
          if (!sigOf(cam)) R('확인 필요', 'SIG_NONE', `${cam.tag} 영상 신호 방식 미입력`, [{ type: 'device', id: cam.id }]);
          else if (!sup || !sup.length) R('확인 필요', 'SIG_SPEC', `${sink.tag} 입력 지원 사양 미등록 – ${cam.tag}(${sigOf(cam)}) 호환 판정 불가`, [{ type: 'device', id: sink.id }, { type: 'device', id: cam.id }]);
          else {
            const s = sup.find(x => x.signal === sigOf(cam));
            if (!s) R('오류', 'SIG_MISMATCH', `신호 불일치: ${cam.tag} ${sigOf(cam)} → ${sink.tag} 지원(${sup.map(x => x.signal).join(', ')})`, [{ type: 'device', id: cam.id }, { type: 'device', id: sink.id }]);
            else {
              const cr = num(p.out_res_mp), cf = num(p.out_fps);
              if (cr != null && num(s.max_res_mp) != null && cr > num(s.max_res_mp)) R('오류', 'RES_OVER', `${cam.tag} 출력 ${cr}MP > ${sink.tag} ${s.signal} 입력 최대 ${s.max_res_mp}MP`, [{ type: 'device', id: cam.id }]);
              if (cf != null && num(s.max_fps) != null && cf > num(s.max_fps)) R('경고', 'FPS_OVER', `${cam.tag} ${cf}fps > ${sink.tag} 지원 ${s.max_fps}fps`, [{ type: 'device', id: cam.id }]);
              if ((cr == null || cf == null)) R('확인 필요', 'RES_NONE', `${cam.tag} 출력 해상도·프레임률 미입력`, [{ type: 'device', id: cam.id }]);
            }
          }
          // 녹화 채널 중복 (영상 입력 포트)
          // 중간 장비 신호 지원
          vc.inline.forEach(i => {
            const d = ix.dev.get(i.dev); if (!d || ['offpage', 'coax_joint', 'junction_box', 'cabinet'].includes(d.type)) return;
            const ss = (d.props && d.props.supported_signals) || [];
            if (!ss.length) R('확인 필요', 'INLINE_SPEC', `${d.tag}(${CAT.DEVICE_TYPES[d.type].name}) 지원 신호 미등록 – ${cam.tag} 회선`, [{ type: 'device', id: d.id }]);
            else if (sigOf(cam) && !ss.includes(sigOf(cam))) R('오류', 'INLINE_SIG', `${d.tag}가 ${sigOf(cam)} 신호를 지원하지 않음 (${cam.tag})`, [{ type: 'device', id: d.id }]);
            if (d.props && d.props.termination_required && !d.props.termination_set) R('확인 필요', 'TERM', `${d.tag} 종단(75Ω) 설정 확인 필요`, [{ type: 'device', id: d.id }]);
          });
          if (sp.termination_required && !sp.termination_set) R('확인 필요', 'TERM', `${sink.tag} 입력 종단 설정 확인 필요`, [{ type: 'device', id: sink.id }]);
          // 임피던스·커넥터
          vc.path.forEach(s => {
            const pr = ix.prod.get(s.cable.product_id); const z = pr && num(pr.props && pr.props.impedance);
            if (s.part === 'power') return;
            if (z == null) R('확인 필요', 'Z_NONE', `${s.cable.tag} 특성 임피던스 미입력`, [{ type: 'cable', id: s.cable.id }]);
            const devZ = [ix.dev.get(s.from.dev), s.to && ix.dev.get(s.to.dev)].filter(Boolean).map(d => ({ d, z: num(d.props && d.props.video_impedance) }));
            devZ.forEach(x => { if (z != null && x.z != null && x.z !== z) R('경고', 'Z_MISMATCH', `임피던스 불일치: ${s.cable.tag} ${z}Ω ↔ ${x.d.tag} ${x.z}Ω`, [{ type: 'cable', id: s.cable.id }]); });
            ['conn_from', 'conn_to'].forEach(k => {
              const cid = s.cable.props && s.cable.props[k]; if (!cid) return; const cp = ix.prod.get(cid); if (!cp) return;
              const od = pr && num(pr.props.od_mm), mn = num(cp.props.od_min_mm), mx = num(cp.props.od_max_mm), cz = num(cp.props.impedance);
              if (od == null || mn == null || mx == null) R('확인 필요', 'CONN_OD', `${s.cable.tag} 커넥터 ${cp.name} 적용 외경 또는 케이블 외경 미입력`, [{ type: 'cable', id: s.cable.id }]);
              else if (od < mn || od > mx) R('오류', 'CONN_OD_MISMATCH', `${s.cable.tag} 외경 ${od}mm – 커넥터 ${cp.name} 적용범위 ${mn}~${mx}mm 벗어남`, [{ type: 'cable', id: s.cable.id }]);
              if (z != null && cz != null && z !== cz) R('경고', 'CONN_Z', `${s.cable.tag} ${z}Ω 케이블에 ${cz}Ω 커넥터`, [{ type: 'cable', id: s.cable.id }]);
            });
          });
          // 거리: 중계기로 구간 분할, 케이블 제품의 신호별 권장거리 기준
          const segs = [[]]; vc.path.forEach(s => { segs[segs.length - 1].push(s); if (s.to && ix.dev.get(s.to.dev) && ix.dev.get(s.to.dev).type === 'coax_repeater') segs.push([]); });
          segs.filter(x => x.length).forEach((seg, si) => {
            let L = 0, unk = false; seg.forEach(s => { const l = cableLength(s.cable, ix); if (l.final_m == null) unk = true; else L += l.final_m; });
            if (unk) { R('확인 필요', 'VLEN', `${cam.tag} 영상 회선 길이 미확정(축척)`, [{ type: 'device', id: cam.id }]); return; }
            const prs = seg.map(s => ix.prod.get(s.cable.product_id)).filter(Boolean);
            let lim = null, src = '';
            prs.forEach(pr => { const rec = (pr.props.recommended || []).find(r => r.signal === sigOf(cam) && (!r.res_mp || num(r.res_mp) >= (num(p.out_res_mp) || 0))); if (rec && (lim == null || num(rec.max_m) < lim)) { lim = num(rec.max_m); src = `${pr.name}: ${rec.source || '근거 미기재'}`; } });
            if (lim == null) R('확인 필요', 'VDIST_NONE', `${cam.tag} 구간${si + 1} ${round2(L)}m – 케이블 제품에 ${sigOf(cam) || '해당 신호'} 권장거리 미등록`, [{ type: 'device', id: cam.id }]);
            else if (L > lim) R('경고', 'VDIST_OVER', `${cam.tag} 구간${si + 1} ${round2(L)}m > 제조사 등록 권장거리 ${lim}m (${src})`, [{ type: 'device', id: cam.id }]);
            const f = num((st.signal_ref_freq || {})[sigOf(cam)]);
            seg.forEach(s => { const l = cableLength(s.cable, ix); const at = attenuation(s.cable, f, l.final_m, ix); if (at) R('확인 필요', 'ATT', `${s.cable.tag} 감쇠 계산값 ${at.total_db}dB @${f}MHz (${at.db_per_100m}dB/100m, 계산값이며 영상 품질 보증 아님)`, [{ type: 'cable', id: s.cable.id }]); });
          });
        }
        // 전원
        if (p.power_mode === 'PoC') {
          const vcs = mine.find(c => c.kind === 'video');
          const ends = vcs && vcs.sink ? [cam, ix.dev.get(vcs.sink)].concat(vcs.inline.map(i => ix.dev.get(i.dev)).filter(d => d && d.type === 'coax_repeater')) : [cam];
          ends.forEach(d => { const v = d.props && d.props.poc_support; if (v === false || v === '미지원') R('오류', 'POC_NO', `${d.tag} 동축 전원전송 미지원`, [{ type: 'device', id: d.id }]); else if (v !== true && v !== '지원') R('확인 필요', 'POC_SPEC', `${d.tag} 동축 전원전송 지원 여부 미확인`, [{ type: 'device', id: d.id }]); });
          if (vcs) vcs.path.forEach(s => { const pr = ix.prod.get(s.cable.product_id); if (!pr || pr.props.poc_ok !== true) R('확인 필요', 'POC_CABLE', `${s.cable.tag} 동축 전원전송 적용 조건 미확인`, [{ type: 'cable', id: s.cable.id }]); });
        }
      }
      if (!(p.system === 'IP' && p.poe) && p.power_mode !== 'PoC') {
        const pc = mine.find(c => c.kind === 'power');
        if (!pc || !pc.sink) R('오류', 'POWER_MISSING', `${cam.tag} 전원 연결 누락`, [{ type: 'device', id: cam.id }]);
        else {
          const vd = voltageDrop(pc, model, ix);
          if (vd && vd.ok) { const lim = num(st.vd_limit_pct); if (lim == null || vd.pct > lim) R(lim != null ? '경고' : '확인 필요', 'VD', `${cam.tag} 전압강하 ${vd.vd}V (${vd.pct}%) – ${vd.formula}, ${vd.assume}${lim != null ? ', 기준 ' + lim + '%' : ', 기준 미설정'}`, [{ type: 'device', id: cam.id }]); }
          else if (vd) R('확인 필요', 'VD_INPUT', `${cam.tag} 전압강하 계산 입력 부족: ${vd.missing.join(', ')}`, [{ type: 'device', id: cam.id }]);
          // 복합 + 별도 전원 중복
          const viaComp = pc.path.some(s => s.cable.kind === 'composite');
          const separate = cabs.some(c => c.kind === 'power' && endsOf(c).some(e => e.dev === cam.id));
          if (viaComp && separate) R('경고', 'COMP_DUP', `${cam.tag} 복합케이블 전원부와 별도 전원케이블이 함께 연결됨 – 중복 물량 확인`, [{ type: 'device', id: cam.id }]);
        }
      }
    });
    // 녹화 채널: DVR 입력 포트 중복은 PORT_DUP으로 검출. NVR 논리 채널 중복/부족
    const nvrUse = {};
    devs.filter(d => d.type === 'camera' && d.props && d.props.nvr_id).forEach(c => { const k = c.props.nvr_id + '|' + (c.props.nvr_channel || ''); (nvrUse[k] = nvrUse[k] || []).push(c); });
    Object.keys(nvrUse).forEach(k => { const [nid, ch] = k.split('|'); if (!ch) { nvrUse[k].forEach(c => R('경고', 'NVR_CH_NONE', `${c.tag} NVR 채널 미지정`, [{ type: 'device', id: c.id }])); return; } if (nvrUse[k].length > 1) R('오류', 'NVR_CH_DUP', `NVR 채널 중복: ${(ix.dev.get(nid) || {}).tag} CH${ch} ← ${nvrUse[k].map(c => c.tag).join(', ')}`, nvrUse[k].map(c => ({ type: 'device', id: c.id }))); });
    devs.filter(d => ['nvr', 'dvr', 'hvr'].includes(d.type)).forEach(r => {
      const ch = num(r.props && r.props.channels);
      const ipN = devs.filter(d => d.type === 'camera' && d.props && d.props.nvr_id === r.id).length;
      const coaxN = circ.filter(c => c.kind === 'video' && c.sink === r.id).length;
      const n = ipN + coaxN;
      if (ch == null) R('확인 필요', 'CH_NONE', `${r.tag} 채널 수 미입력`, [{ type: 'device', id: r.id }]);
      else if (n > ch) R('오류', 'CH_SHORT', `${r.tag} 채널 수 부족: 배정 ${n} > ${ch}`, [{ type: 'device', id: r.id }]);
      devs.filter(d => d.type === 'camera' && d.props && d.props.nvr_id === r.id && num(d.props.nvr_channel) > ch).forEach(c => R('오류', 'CH_RANGE', `${c.tag} 채널 ${c.props.nvr_channel} > ${r.tag} 채널 수 ${ch}`, [{ type: 'device', id: c.id }]));
    });
    // 스위치 포트·PoE 예산
    devs.filter(d => ['switch', 'poe_switch', 'fiber_switch'].includes(d.type)).forEach(sw => {
      const sp = sw.props || {}; const ports = CAT.portsFor(sw).filter(p => p.kind !== 'power');
      const used = Object.keys(portUse).filter(k => k.startsWith(sw.id + '|')).length;
      if (used > ports.length) R('오류', 'SW_PORTS', `${sw.tag} 포트 부족: 사용 ${used} > ${ports.length}`, [{ type: 'device', id: sw.id }]);
      const poeCams = circ.filter(c => c.kind === 'data' && c.sink === sw.id).map(c => ix.dev.get(c.camera)).filter(c => c.props && c.props.poe);
      if (poeCams.length) {
        const b = num(sp.poe_budget_w);
        const tot = poeCams.reduce((s, c) => s + (num(c.props.poe_w) || 0), 0);
        if (b == null) R('확인 필요', 'POE_BUDGET', `${sw.tag} 전체 PoE 예산 미입력`, [{ type: 'device', id: sw.id }]);
        else if (tot > b) R('오류', 'POE_OVER', `${sw.tag} PoE 합계 ${tot}W > 예산 ${b}W`, [{ type: 'device', id: sw.id }]);
      }
    });
    // 전원 공급장치 출력 용량
    devs.filter(d => d.type === 'psu').forEach(ps => {
      const loads = circ.filter(c => c.kind === 'power' && c.sink === ps.id).map(c => ix.dev.get(c.camera));
      const cap = num(ps.props && ps.props.capacity_w); const tot = loads.reduce((s, c) => s + (num(c.props && c.props.power_w) || 0), 0);
      if (loads.length && cap != null && tot > cap) R('오류', 'PSU_OVER', `${ps.tag} 부하 ${tot}W > 정격 ${cap}W`, [{ type: 'device', id: ps.id }]);
      if (loads.length && cap == null) R('확인 필요', 'PSU_CAP', `${ps.tag} 정격 용량 미입력`, [{ type: 'device', id: ps.id }]);
    });
    fiberReview(model, ix, R);
    // 관로 점유율
    conduitReport(model, ix).forEach(r => { if (r.fill_state === '초과') R('경고', 'FILL_OVER', `${r.tag} 점유율 ${r.fill_pct}% > 기준 ${r.fill_limit}%`, [{ type: 'conduit', id: r.id }]); });
    // 기존 동축 재사용 회선
    cabs.filter(c => c.status === '재사용').forEach(c => { if (!c.props || !c.props.test_result) R('확인 필요', 'REUSE_TEST', `${c.tag} 재사용 회선 현장 시험 결과 미첨부`, [{ type: 'cable', id: c.id }]); });
    const order = { '오류': 0, '경고': 1, '확인 필요': 2 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    return out;
  }

  // ----- 물량 집계 -----
  function quantities(model) {
    const ix = index(model);
    const rows = [];
    const zoneOf = sid => { const s = ix.sheet.get(sid); return s ? [s.building, s.floor, s.zone].filter(Boolean).join(' ') || s.name : ''; };
    // 장비
    const dg = {};
    (model.devices || []).filter(d => !['offpage', 'coax_joint'].includes(d.type) || d.type === 'coax_joint').forEach(d => {
      if (d.type === 'offpage') return;
      const pr = ix.prod.get(d.product_id);
      const name = pr ? pr.name : ((d.type === 'custom' && (d.props || {}).custom_label) || (CAT.DEVICE_TYPES[d.type] || {}).name) + ((d.type === 'camera' ? ` (${(d.props || {}).system || ''} ${(d.props || {}).form || ''})` : ''));
      const spec = pr ? (pr.spec || '') : [(d.props || {}).maker, (d.props || {}).model].filter(Boolean).join(' ');
      const k = ['장비', name, spec, d.status || '신설', zoneOf(d.sheet_id)].join('|');
      (dg[k] = dg[k] || { cat: d.type === 'camera' ? 'CCTV' : '장비', name, spec, unit: 'EA', qty: 0, refs: [], zone: zoneOf(d.sheet_id), status: d.status || '신설' });
      dg[k].qty++; dg[k].refs.push({ type: 'device', id: d.id, tag: d.tag });
      // 설치 부속 (폴·브래킷·방수함)
      ['bracket', 'housing'].forEach(f => { if (d.props && d.props[f]) { const kk = ['부속', d.props[f], '', d.status || '신설', zoneOf(d.sheet_id)].join('|'); (dg[kk] = dg[kk] || { cat: '함체·폴·브래킷', name: d.props[f], spec: '', unit: 'EA', qty: 0, refs: [], zone: zoneOf(d.sheet_id), status: d.status || '신설' }); dg[kk].qty++; dg[kk].refs.push({ type: 'device', id: d.id, tag: d.tag }); } });
    });
    Object.values(dg).forEach(r => rows.push({ ...r, basis: `배치 객체 ${r.qty}개 (${r.refs.map(x => x.tag).join(', ')})` }));
    // 케이블 (물리적 케이블 단위, 복합케이블은 복합 길이로 1회 집계)
    const cg = {};
    physicalCables(model, ix).forEach(pc => {
      const pr = ix.prod.get(pc.product_id);
      const name = pr ? pr.name : CAT.CABLE_KINDS[pc.kind].name + ' (규격 미지정)';
      const zone = zoneOf(pc.parts[0].cable.sheet_id);
      const k = ['케이블', name, pr ? pr.spec : '', pc.status || '신설', zone].join('|');
      (cg[k] = cg[k] || { cat: '케이블', name, spec: pr ? pr.spec || '' : '', unit: 'm', qty: 0, refs: [], zone, status: pc.status || '신설', unknown: [], basis_parts: [] });
      if (pc.final_m == null) cg[k].unknown.push(pc.tag); else cg[k].qty += pc.final_m;
      cg[k].refs.push({ type: 'cable', id: pc.id, tag: pc.tag });
      const l0 = pc.parts[0].len;
      cg[k].basis_parts.push(pc.final_m == null ? `${pc.tag}: 확인 필요` : `${pc.tag}: 측정 ${round2(pc.parts.reduce((s, x) => s + (x.len.measured_m || 0), 0))}+수직 ${round2(pc.parts.reduce((s, x) => s + x.len.vertical_m, 0))}+인입 ${round2(pc.parts.reduce((s, x) => s + x.len.entry_m + x.len.tail_m, 0))}+여장 ${round2(pc.parts.reduce((s, x) => s + (x.len.slack_m || 0), 0))} → ${pc.final_m}m${pc.parts.length > 1 ? ` (${pc.parts.length}개 도면 구간)` : ''}`);
    });
    Object.values(cg).forEach(r => rows.push({ ...r, qty: r.unknown.length && !r.qty ? null : round2(r.qty), basis: r.basis_parts.join('; ') + (r.unknown.length ? ` / 미확정: ${r.unknown.join(', ')}` : ''), check: r.unknown.length ? '확인 필요' : '' }));
    // 관로 (공용 구간 1회)
    const kg = {};
    conduitReport(model, ix).forEach(cr => {
      const cd = ix.cond.get(cr.id); const zone = zoneOf(cd.sheet_id);
      const k = ['관로', cr.product, cd.method || '', cd.status || '신설', zone].join('|');
      (kg[k] = kg[k] || { cat: '배관·트레이', name: cr.product, spec: cd.method || '', unit: 'm', qty: 0, refs: [], zone, status: cd.status || '신설', b: [], unknown: [] });
      if (cr.len.final_m == null) kg[k].unknown.push(cr.tag); else kg[k].qty += cr.len.final_m;
      kg[k].refs.push({ type: 'conduit', id: cr.id, tag: cr.tag }); kg[k].b.push(`${cr.tag} ${cr.len.final_m == null ? '확인 필요' : cr.len.final_m + 'm'} (수용 ${cr.cables.length}조)`);
      cr.suggestions.forEach(sg => { const adj = num((cr.adjust || {})[sg.item]); const kk = ['부속(관로)', sg.item, cr.product, cd.status || '신설', zone].join('|'); (kg[kk] = kg[kk] || { cat: '관로 부속', name: sg.item, spec: cr.product, unit: 'EA', qty: 0, refs: [], zone, status: cd.status || '신설', b: [], unknown: [], auto: 0, manual: 0 }); kg[kk].qty += sg.qty + (adj || 0); kg[kk].auto += sg.qty; kg[kk].manual += adj || 0; kg[kk].b.push(`${cr.tag}: ${sg.basis} ${sg.qty}${adj ? ' 보정 ' + adj : ''}`); kg[kk].refs.push({ type: 'conduit', id: cr.id, tag: cr.tag }); });
    });
    Object.values(kg).forEach(r => rows.push({ ...r, qty: round2(r.qty), basis: r.b.join('; ') + (r.unknown.length ? ' / 미확정: ' + r.unknown.join(', ') : ''), check: r.unknown.length ? '확인 필요' : '' }));
    // 부속자재
    accessories(model, ix).forEach(a => rows.push({ cat: '커넥터·부속', name: a.product ? a.product.name : a.label, spec: a.product ? a.product.spec || '' : '(품목 미등록)', unit: a.product ? a.product.unit : 'EA', qty: a.qty, auto: a.auto, manual: a.manual, refs: a.refs, zone: '전체', status: '신설', basis: `자동 ${a.auto}${a.manual ? ` + 보정 ${a.manual}${a.reason ? '(' + a.reason + ')' : ''}` : ''}: ${a.basis.slice(0, 12).join(', ')}${a.basis.length > 12 ? ' 외 ' + (a.basis.length - 12) + '건' : ''}`, role: a.role }));
    // 수동 추가 항목
    ((ix.settings.manual_items) || []).forEach(m => rows.push({ cat: m.cat || '수동 추가', name: m.name, spec: m.spec || '', unit: m.unit || 'EA', qty: num(m.qty), refs: [], zone: m.zone || '', status: m.status || '신설', basis: '수동 추가: ' + (m.reason || ''), manualRow: true }));
    // 단가 (선택)
    const prices = ix.settings.prices || {};
    rows.forEach(r => { const p = prices[r.name + '|' + r.spec]; if (p) { r.mat = num(p.mat); r.lab = num(p.lab); r.exp = num(p.exp); if (r.qty != null) { r.amount = round2(r.qty * ((r.mat || 0) + (r.lab || 0) + (r.exp || 0))); } } });
    return rows;
  }

  // 공종별 집계
  function summaryByCat(rows) {
    const m = {}; rows.forEach(r => { const k = r.cat + '|' + r.name + '|' + r.spec + '|' + r.unit + '|' + r.status; (m[k] = m[k] || { cat: r.cat, name: r.name, spec: r.spec, unit: r.unit, status: r.status, qty: 0, unknown: false }); if (r.qty == null) m[k].unknown = true; else m[k].qty += r.qty; });
    return Object.values(m).map(x => ({ ...x, qty: round2(x.qty) })).sort((a, b) => a.cat.localeCompare(b.cat, 'ko'));
  }

  // 동축 영상 회선표
  function coaxCircuitTable(model) {
    const ix = index(model); const circ = circuits(model, ix); const rv = review(model);
    return circ.filter(c => c.kind === 'video').map(c => {
      const cam = ix.dev.get(c.camera); const sink = c.sink && ix.dev.get(c.sink);
      const segs = c.path.map(s => { const l = cableLength(s.cable, ix); const pr = ix.prod.get(s.cable.product_id); return { tag: s.cable.tag, spec: pr ? pr.name : '미지정', len: l.final_m, kind: s.cable.kind }; });
      const tot = segs.some(s => s.len == null) ? null : round2(segs.reduce((s, x) => s + x.len, 0));
      const inl = c.inline.map(i => ix.dev.get(i.dev)).filter(Boolean).map(d => d.tag);
      const pc = circ.find(x => x.camera === c.camera && x.kind === 'power');
      const pm = (cam.props || {}).power_mode || '별도전원';
      const pdesc = pm === 'PoC' ? '동축 전원전송' : (pc && pc.sink ? `${pc.path.some(s => s.cable.kind === 'composite') ? '복합케이블' : '별도 전원선'} → ${ix.dev.get(pc.sink).tag} ${pc.sink_port || ''}` : '전원 연결 없음');
      const issues = rv.filter(r => r.refs.some(x => x.id === cam.id) || c.path.some(s => r.refs.some(x => x.id === s.cable.id)));
      const lv = issues.some(i => i.level === '오류') ? '오류' : issues.some(i => i.level === '경고') ? '경고' : issues.length ? '확인 필요' : '정상(입력 기준)';
      const conns = c.path.reduce((s, x) => s + ((x.cable.props && x.cable.props.factory_terminated) ? 0 : (x.to ? 2 : 1)), 0);
      return { cam: cam.tag, cam_id: cam.id, signal: (cam.props || {}).signal || '', start: cam.tag, end: sink ? sink.tag : '(미연결)', channel: c.sink_port || '', spec: [...new Set(segs.map(s => s.spec))].join(', '), segs, total: tot, joints: inl.join(', '), connectors: `BNC ${conns}`, power: pdesc, status: lv };
    });
  }

  return { coresUsed, crossings, polyLen, index, upmOf, cablePoints, cableLength, physicalCables, circuits, buildGraph, endsOf, fovGeometry, sectorPolygon, coverage, accessories, DEFAULT_RULES, conduitLength, conduitReport, voltageDrop, attenuation, storage, bandwidth, review, quantities, summaryByCat, coaxCircuitTable, num, round2 };
});
