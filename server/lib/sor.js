// OTDR 측정 원본(.sor, Telcordia SR-4731 v1·v2) 해석
// 지원 블록: Map, GenParams, SupParams, FxdParams, KeyEvents, DataPts, Cksum. 그 외 제조사 고유 블록은 이름만 표시.
const SOL = 299792.458 / 1e6; // 빛의 속도 km/µs

class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.p); this.p += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  str() { const e = this.b.indexOf(0, this.p); if (e < 0) throw new Error('문자열 끝을 찾을 수 없음'); const s = this.b.slice(this.p, e).toString('latin1'); this.p = e + 1; return s.trim(); }
  fixed(n) { const s = this.b.slice(this.p, this.p + n).toString('latin1'); this.p += n; return s; }
}

function crc16(buf) {
  let crc = 0xffff;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function parseSor(buf) {
  if (buf.length < 20) throw new Error('파일이 너무 작습니다.');
  const r = new Reader(buf);
  let format = 1;
  if (buf.slice(0, 4).toString('latin1') === 'Map\0') { format = 2; r.p = 4; }
  const mapVersion = r.u16();
  const mapSize = r.u32();
  const nBlocks = r.u16();
  if (nBlocks < 2 || nBlocks > 64 || mapSize > buf.length) throw new Error('SOR 형식이 아닙니다 (Map 블록 오류).');
  const blocks = [];
  let offset = mapSize;
  for (let i = 0; i < nBlocks - 1; i++) {
    const name = r.str(); const version = r.u16(); const size = r.u32();
    blocks.push({ name, version, size, offset });
    offset += size;
  }
  const out = { format: `SR-4731 v${format}`, map_version: (mapVersion / 100).toFixed(2), blocks: blocks.map(b => b.name), warnings: [] };
  const body = (name) => {
    const b = blocks.find(x => x.name === name);
    if (!b) return null;
    if (b.offset + b.size > buf.length) { out.warnings.push(`${name} 블록이 파일 범위를 벗어남`); return null; }
    const rr = new Reader(buf, b.offset);
    if (format === 2) { const n = rr.str(); if (n !== name) out.warnings.push(`${name} 블록 머리 불일치(${n})`); }
    return rr;
  };

  let g = body('GenParams');
  if (g) {
    const gp = { language: g.fixed(2), cable_id: g.str(), fiber_id: g.str() };
    if (format === 2) gp.fiber_type = g.u16();
    gp.wavelength_nm = g.u16();
    gp.location_a = g.str(); gp.location_b = g.str(); gp.cable_code = g.str(); gp.build_condition = g.fixed(2);
    gp.user_offset = g.i32();
    if (format === 2) gp.user_offset_distance = g.i32();
    gp.operator = g.str(); gp.comments = g.str();
    out.gen = gp;
  }
  const s = body('SupParams');
  if (s) out.sup = { supplier: s.str(), otdr: s.str(), otdr_sn: s.str(), module: s.str(), module_sn: s.str(), software: s.str(), other: s.str() };

  const f = body('FxdParams');
  let fx = null;
  if (f) {
    fx = { datetime: new Date(f.u32() * 1000).toISOString(), unit: f.fixed(2), wavelength_nm: f.u16() / 10, acquisition_offset: f.i32() };
    if (format === 2) fx.acquisition_offset_distance = f.i32();
    const n = f.u16(); fx.pulse_entries = n;
    fx.pulse_width_ns = []; for (let i = 0; i < n; i++) fx.pulse_width_ns.push(f.u16());
    fx.sample_spacing_us = []; for (let i = 0; i < n; i++) fx.sample_spacing_us.push(f.u32() * 1e-8);
    fx.num_points = []; for (let i = 0; i < n; i++) fx.num_points.push(f.u32());
    fx.index = f.u32() / 100000;
    fx.backscatter_db = -f.u16() / 10;
    fx.num_averages = f.u32();
    if (format === 2) fx.averaging_time_s = f.u16() / 10;
    fx.range_raw = f.u32();
    if (format === 2) fx.acquisition_range_distance = f.i32();
    fx.front_panel_offset = f.i32();
    fx.noise_floor = f.u16(); fx.noise_floor_scale = f.i16();
    fx.power_offset = f.u16();
    fx.loss_threshold_db = f.u16() / 1000; fx.refl_threshold_db = -f.u16() / 1000; fx.eot_threshold_db = f.u16() / 1000;
    // km per 데이터 점 (pyOTDR 와 같은 계산)
    fx.resolution_m = fx.sample_spacing_us[0] * SOL * 1e3 / fx.index * 1000 / 1000 * 1000 / 1000;
    fx.resolution_m = fx.sample_spacing_us[0] * 299792458e-6 / fx.index;
    fx.range_km = fx.resolution_m * fx.num_points[0] / 1000;
    out.fxd = fx;
  }

  const k = body('KeyEvents');
  if (k && fx) {
    const ne = k.u16();
    const factor = 1e-4 * SOL * 1e3 / fx.index; // 시간(0.1ns 단위) → km
    const events = [];
    for (let i = 0; i < ne; i++) {
      const ev = { no: k.u16() };
      ev.distance_km = k.u32() * 1e-4 * 299792.458e-6 / fx.index;
      ev.slope_db_km = k.i16() / 1000;
      ev.splice_loss_db = k.i16() / 1000;
      ev.refl_loss_db = k.i32() / 1000;
      ev.code = k.fixed(8);
      if (format === 2) { k.u32(); k.u32(); k.u32(); k.u32(); k.u32(); }
      ev.comment = k.str();
      const c0 = ev.code[0], c1 = ev.code[1];
      ev.type = (c1 === 'E' ? '광섬유 끝' : c0 === '1' ? '반사' : c0 === '2' ? '반사(포화)' : c0 === '0' ? '비반사(손실)' : '기타') + (c1 === 'M' ? ' · 수동' : c1 === 'A' ? ' · 추가' : '');
      events.push(ev);
    }
    void factor;
    const sum = { total_loss_db: k.i32() / 1000 };
    if (format === 2) { sum.fiber_start = k.i32(); sum.fiber_length_raw = k.u32(); }
    else { sum.loss_start = k.i32(); sum.loss_finish = k.u32(); }
    sum.orl_db = k.u16() / 1000;
    out.events = events; out.summary = sum;
    const end = events.find(e => e.code[1] === 'E') || events[events.length - 1];
    if (end) out.fiber_length_km = end.distance_km;
  }

  const d = body('DataPts');
  if (d && fx) {
    const n = d.u32(); const traces = d.u16(); const n2 = d.u32(); const scale = d.u16() / 1000;
    if (n2 > (buf.length - d.p) / 2) throw new Error('DataPts 데이터 수가 파일 크기와 맞지 않습니다.');
    const raw = new Array(n2);
    for (let i = 0; i < n2; i++) raw[i] = d.u16();
    let max = 0; for (const v of raw) if (v > max) max = v;
    const step = fx.resolution_m / 1000;
    // dB 값 = (최대값 - 원시값) × 배율 / 1000 (pyOTDR 와 같은 표시 기준)
    out.trace = { points: n2, traces, scale, step_km: step, y: raw.map(v => Number(((max - v) * scale / 1000).toFixed(3))) };
    void n;
  }

  const c = blocks.find(b => b.name === 'Cksum');
  if (c) {
    const stored = buf.readUInt16LE(buf.length - 2);
    const ours = crc16(buf.slice(0, buf.length - 2));
    out.checksum = { stored, calculated: ours, match: stored === ours };
    if (stored !== ours) out.warnings.push('체크섬 불일치 — 파일 손상 가능성이 있거나 측정기가 다른 방식으로 계산한 파일입니다 (값은 참고용으로 확인).');
  }
  for (const b of blocks) if (!['GenParams', 'SupParams', 'FxdParams', 'KeyEvents', 'DataPts', 'Cksum', 'LnkParams'].includes(b.name)) out.warnings.push(`해석하지 않은 제조사 블록: ${b.name}`);
  return out;
}

// 화면용 축소 트레이스 (최대 n점, 구간별 최소·최대 보존)
function downsample(trace, n = 1500) {
  if (!trace) return null;
  const y = trace.y; const len = y.length;
  if (len <= n) return y.map((v, i) => [Number((i * trace.step_km).toFixed(4)), v]);
  const out = []; const bucket = len / (n / 2);
  for (let b = 0; b < n / 2; b++) {
    const s = Math.floor(b * bucket), e = Math.min(len, Math.floor((b + 1) * bucket));
    let mi = s, ma = s;
    for (let i = s; i < e; i++) { if (y[i] < y[mi]) mi = i; if (y[i] > y[ma]) ma = i; }
    for (const i of mi < ma ? [mi, ma] : [ma, mi]) out.push([Number((i * trace.step_km).toFixed(4)), y[i]]);
  }
  return out;
}

module.exports = { parseSor, downsample, crc16 };
