// LibreDWG JSON(dwgread -O json) → dxf-parser 와 같은 모양의 도면 객체.
// dwg2dxf 가 특정 DWG 에서 비정상 종료(세그폴트)할 때의 대체 경로. JSON 읽기는 같은 엔진이라도 더 안정적이다.
const H = (ref) => (Array.isArray(ref) ? ref[ref.length - 1] : 0);
const P = (a) => ({ x: a?.[0] ?? a?.x ?? 0, y: a?.[1] ?? a?.y ?? 0 });

export function dwgJsonToDxf(json) {
  const objs = json.OBJECTS || [];
  const byH = new Map();
  for (const o of objs) if (o.handle) byH.set(H(o.handle), o);
  const layers = {}, layerLT = {}, ltypes = new Map();
  for (const o of objs) if (o.object === 'LTYPE') ltypes.set(H(o.handle), o.name);
  for (const o of objs) if (o.object === 'LAYER') { layers[o.name] = {}; const lt = ltypes.get(H(o.ltype)); if (lt) layerLT[o.name] = lt; }
  const layerName = (e) => byH.get(H(e.layer))?.name || '0';
  const bh = new Map();
  for (const o of objs) if (o.object === 'BLOCK_HEADER') bh.set(H(o.handle), o);
  const model = [...bh.values()].find((b) => /^\*model_space$/i.test(b.name || ''));
  const paper = new Set([...bh.values()].filter((b) => /^\*paper_space/i.test(b.name || '')).map((b) => H(b.handle)));
  const entities = [], blocks = {};
  for (const b of bh.values()) if (b !== model && !paper.has(H(b.handle))) blocks[b.name] = { name: b.name, position: P(b.base_pt), entities: [] };
  let skipped = 0;
  for (const o of objs) {
    if (!o.entity) continue;
    const e = conv(o, { layerName, byH, ltypes });
    if (!e) { skipped++; continue; }
    const owner = H(o.ownerhandle);
    const ob = bh.get(owner);
    if (!ob || ob === model) { if (!paper.has(owner)) entities.push(e); }
    else if (blocks[ob.name]) blocks[ob.name].entities.push(e);
  }
  const ver = json.HEADER?.ACADVER || json.FILEHEADER?.version || null;
  return { header: { $INSUNITS: json.HEADER?.INSUNITS ?? 0, $ACADVER: ver }, tables: { layer: { layers } }, entities, blocks, layerLT, skipped };
}

function conv(o, { layerName, byH, ltypes }) {
  const base = { layer: layerName(o), ...(o.ltype_flags === 3 && ltypes.get(H(o.ltype)) ? { lineType: ltypes.get(H(o.ltype)) } : {}) };
  switch (o.entity) {
    case 'LINE': return { ...base, type: 'LINE', vertices: [P(o.start), P(o.end)] };
    case 'CIRCLE': return { ...base, type: 'CIRCLE', center: P(o.center), radius: o.radius };
    case 'ARC': return { ...base, type: 'ARC', center: P(o.center), radius: o.radius, startAngle: o.start_angle, endAngle: o.end_angle };
    case 'LWPOLYLINE': {
      const b = o.bulges || [];
      return { ...base, type: 'LWPOLYLINE', shape: !!(o.flag & 512) || !!(o.flag & 1), vertices: (o.points || []).map((p, i) => ({ x: p[0], y: p[1], ...(b[i] ? { bulge: b[i] } : {}) })) };
    }
    case 'ELLIPSE': {
      const c = P(o.center), mx = o.sm_axis?.[0] || 0, my = o.sm_axis?.[1] || 0, r = o.axis_ratio || 1;
      let s = o.start_angle || 0, en = o.end_angle ?? Math.PI * 2; if (en <= s) en += Math.PI * 2;
      const full = Math.abs(en - s - Math.PI * 2) < 1e-6;
      const n = Math.max(12, Math.ceil(((en - s) / (Math.PI * 2)) * 72));
      const vs = [];
      for (let i = 0; i <= (full ? n - 1 : n); i++) {
        const t = s + ((en - s) * i) / n;
        vs.push({ x: c.x + mx * Math.cos(t) - my * r * Math.sin(t), y: c.y + my * Math.cos(t) + mx * r * Math.sin(t) });
      }
      return { ...base, type: 'LWPOLYLINE', shape: full, vertices: vs };
    }
    case 'SPLINE': {
      const pts = splinePts(o);
      if (pts.length < 2) return null;
      const closed = !!o.closed_b || (pts.length > 2 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1e-6);
      return { ...base, type: 'LWPOLYLINE', shape: closed, vertices: closed ? pts.slice(0, -1) : pts };
    }
    case 'TEXT': return o.text_value ? { ...base, type: 'TEXT', text: o.text_value, startPoint: P(o.ins_pt) } : null;
    case 'MTEXT': return o.text ? { ...base, type: 'MTEXT', text: o.text, position: P(o.ins_pt) } : null;
    case 'INSERT': case 'MINSERT': {
      const b = byH.get(H(o.block_header));
      if (!b?.name) return null;
      return { ...base, type: 'INSERT', name: b.name, position: P(o.ins_pt), xScale: o.scale?.[0] ?? 1, yScale: o.scale?.[1] ?? 1, rotation: ((o.rotation || 0) * 180) / Math.PI };
    }
    default:
      if (o.entity?.startsWith('DIMENSION_')) {
        const kind = { DIMENSION_LINEAR: 0, DIMENSION_ALIGNED: 1, DIMENSION_ANG2LN: 2, DIMENSION_DIAMETER: 3, DIMENSION_RADIUS: 4, DIMENSION_ANG3PT: 5, DIMENSION_ORDINATE: 6 }[o.entity] ?? 0;
        return { ...base, type: 'DIMENSION', dimensionType: kind, actualMeasurement: o.act_measurement, text: o.user_text || null, ...(o.text_midpt ? { middleOfText: P(o.text_midpt) } : {}) };
      }
      return null;
  }
}

/** B-스플라인(드 부어) → 점 목록. 제어점이 없으면 맞춤점(fit_pts) 사용 */
function splinePts(o) {
  const C = (o.ctrl_pts || []).map((p) => ({ x: p.x, y: p.y, w: p.w ?? 1 }));
  const p = o.degree || 3, U = o.knots || [];
  if (C.length < 2 || U.length !== C.length + p + 1) return (o.fit_pts || []).map(P);
  const lo = U[p], hi = U[C.length];
  const n = Math.min(240, Math.max(8, C.length * 6));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    let k = p; while (k < C.length - 1 && t >= U[k + 1]) k++;
    const d = []; for (let j = 0; j <= p; j++) { const q = C[k - p + j]; d.push([q.x * q.w, q.y * q.w, q.w]); }
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const i0 = k - p + j, den = U[i0 + p - r + 1] - U[i0];
      const a = den ? (t - U[i0]) / den : 0;
      d[j] = [0, 1, 2].map((m) => (1 - a) * d[j - 1][m] + a * d[j][m]);
    }
    out.push({ x: d[p][0] / d[p][2], y: d[p][1] / d[p][2] });
  }
  return out;
}
