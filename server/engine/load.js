// 부하·전류·회로·상별·계약전력 검토 엔진.
// AI는 값을 추출만 하고, 최종 수치와 판정은 전부 이 모듈이 계산한다.
import { powerToW, checkBreaker } from './units.js';

export const ENGINE_VERSION = 'load-1.0.0';

export const VERDICT = {
  OK: '입력 조건상 여유 있음',
  CONTRACT: '계약전력 증설 검토',
  FACILITY: '배선·차단기·회로 개선 검토',
  BOTH: '계약전력 및 설비 개선 동시 검토',
  HOLD: '정보 부족으로 판단 보류',
  EXPERT: '현장 전문가 확인 필요',
};

export const SCENARIOS = [
  { key: 'cur_normal', label: '현재 일반 사용', include: ['current'], factor: 'normal' },
  { key: 'cur_peak', label: '현재 최대 동시 사용', include: ['current'], factor: 'peak' },
  { key: 'add_normal', label: '추가 기기 설치 후 일반 사용', include: ['current', 'planned'], factor: 'normal' },
  { key: 'add_peak', label: '추가 기기 설치 후 최대 동시 사용', include: ['current', 'planned'], factor: 'peak' },
  { key: 'add_shifted', label: '추가 후 사용 시간대 분산', include: ['current', 'planned'], factor: 'shifted' },
];

const SQRT3 = Math.sqrt(3);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const n = (v) => (isNum(v) ? Number(v) : null);

export const DEFAULT_ASSUMPTIONS = {
  default_pf: 1.0,        // 역률 미입력 기기에 적용(1.0은 전류를 가장 작게 보는 가정 → 결과에 명시)
  margin_pct: 0,          // 기술적 필요용량 여유율(사용자 설정). 운전계수와 별도로 1회만 적용
  caution_ratio: 0.8,     // 차단기 정격 대비 이 비율을 넘으면 '주의'로 표시(사용자 설정 가능한 가정)
};

// 단상 전류 I = P / (V × pf), 평형 삼상 선전류 I = P / (√3 × V_LL × pf)
export function currentSingle(watts, v, pf) { return watts / (v * pf); }
export function currentThree(watts, vll, pf) { return watts / (SQRT3 * vll * pf); }

// 기기 1대 기준 전기 입력전력(W)과 전류(A) 결정
export function deviceInput(d, site, asm) {
  const warnings = [];
  const qty = n(d.qty) ?? 1;
  const phase = String(d.phase || (site.phase === '3' ? '' : '1') || '1');
  const v = n(d.voltage) ?? (phase === '3' ? n(site.v_line) : n(site.v_phase));
  const pfGiven = n(d.pf);
  const pf = pfGiven ?? asm.default_pf;
  if (pfGiven == null) warnings.push(`역률 미입력 → ${asm.default_pf} 가정(실제 전류는 더 클 수 있음)`);
  let w = null; let basis = null;

  if (isNum(d.power_value)) {
    try { w = powerToW(d.power_value, d.power_unit || 'W'); basis = '입력 소비전력'; }
    catch (e) { warnings.push(e.message); }
  } else if (isNum(d.motor_output_kw)) {
    // 기계 출력만 있을 때에만 효율을 명시적으로 적용
    if (isNum(d.efficiency) && Number(d.efficiency) > 0 && Number(d.efficiency) <= 1) {
      w = (Number(d.motor_output_kw) * 1000) / Number(d.efficiency); basis = '모터 출력 ÷ 효율';
    } else warnings.push('모터 출력만 입력됨 — 효율(0~1)을 입력해야 전기 입력전력을 계산할 수 있습니다.');
  } else if (isNum(d.rated_current) && v) {
    w = (phase === '3' ? SQRT3 : 1) * v * Number(d.rated_current) * pf; basis = '정격전류 × 전압 × 역률';
  }
  if (w == null && (isNum(d.cooling_capacity_kw) || isNum(d.heating_capacity_kw))) {
    warnings.push('냉방·난방능력은 전기 소비전력이 아닙니다. 명판의 소비전력(정격입력)을 입력하세요.');
  }
  let a = null;
  if (isNum(d.rated_current)) a = Number(d.rated_current);
  else if (w != null && v) a = phase === '3' ? currentThree(w, v, pf) : currentSingle(w, v, pf);
  if (w == null && a == null) warnings.push('소비전력 또는 정격전류가 없어 계산에서 제외됨');
  if (!v && w != null) warnings.push('전압 미확인 → 전류 계산 불가');
  return { unitW: w, unitA: a, qty, phase, v, pf, basis, warnings };
}

// 운전계수: 시나리오마다 한 번만 곱한다. 기본값은 사용자에게 그대로 보여준다.
export function factorsOf(d) {
  const peak = isNum(d.factor_peak) ? Number(d.factor_peak) : (d.simultaneous === false || d.simultaneous === 0 ? 0 : 1);
  const normal = isNum(d.factor_normal) ? Number(d.factor_normal) : peak;
  const shifted = isNum(d.factor_shifted) ? Number(d.factor_shifted) : normal;
  return { peak, normal, shifted, defaulted: !isNum(d.factor_peak) || !isNum(d.factor_normal) };
}

function breakerIn(b) {
  if (!b) return { value: null, why: '차단기 정보 없음' };
  if (b.adjustable) return isNum(b.set_current) ? { value: Number(b.set_current) } : { value: null, why: '조정형 차단기 설정값 미확인' };
  if (isNum(b.at)) return { value: Number(b.at) };
  if (isNum(b.af)) return { value: null, why: 'AF(프레임)만 확인 — AT 미확인' };
  return { value: null, why: '정격전류 미확인' };
}

// 허용전류: 등록된 기준표에서 조건이 정확히 일치하는 항목만 사용
function findAmpacity(wire, standards) {
  const rows = (standards && standards.ampacity) || [];
  return rows.find((r) => r.material === wire.material && r.insulation === wire.insulation &&
    Number(r.size_mm2) === Number(wire.size_mm2) && r.method === wire.install_method &&
    (r.ambient_c == null || Number(r.ambient_c) === Number(wire.ambient_c)) &&
    (r.grouping == null || Number(r.grouping) === Number(wire.grouping)));
}

const RHO = { Cu: 0.0178, Al: 0.0282 }; // Ω·mm²/m (20℃ 도체 고유저항, 리액턴스 무시한 근사)

export function evaluate(input) {
  const site = input.site || {};
  const asm = { ...DEFAULT_ASSUMPTIONS, ...(input.assumptions || {}) };
  const devices = input.devices || [];
  const panels = input.panels || [];
  const circuits = input.circuits || [];
  const standards = input.standards || {};
  const missing = []; const notes = [];
  const sitePhase = site.phase === '3' ? '3' : site.phase === '1' ? '1' : null;
  if (!sitePhase) missing.push('공급 방식(단상/삼상)');
  if (!isNum(site.v_phase) && !isNum(site.v_line)) missing.push('공급전압');

  const circuitById = new Map(circuits.map((c) => [String(c.id), c]));
  const devs = devices.map((d) => {
    const inp = deviceInput(d, site, asm);
    const f = factorsOf(d);
    const c = d.circuit_id != null ? circuitById.get(String(d.circuit_id)) : null;
    const conn = d.conn_phase || (c && c.phase) || (inp.phase === '3' ? '3P' : (sitePhase === '1' ? 'L1' : null));
    if (sitePhase === '1' && inp.phase === '3') inp.warnings.push('단상 공급 장소에 삼상 기기 — 공급방식 변경 검토 필요');
    return { d, inp, f, conn, circuit: c || null };
  });

  const scenarios = {};
  for (const sc of SCENARIOS) {
    let totalW = 0; let excluded = 0;
    const phaseW = { L1: 0, L2: 0, L3: 0 }; const phaseA = { L1: 0, L2: 0, L3: 0 };
    let unassignedW = 0; let totalA1 = 0;
    const perCircuit = {};
    for (const x of devs) {
      if (!sc.include.includes(x.d.status || 'current')) continue;
      const k = x.f[sc.factor];
      if (x.inp.unitW == null && x.inp.unitA == null) { excluded++; continue; }
      const w = (x.inp.unitW ?? 0) * x.inp.qty * k;
      const a = (x.inp.unitA ?? 0) * x.inp.qty * k;
      totalW += w; totalA1 += a;
      const cid = x.circuit ? String(x.circuit.id) : '__none';
      perCircuit[cid] = perCircuit[cid] || { w: 0, a: 0, devices: [] };
      perCircuit[cid].w += w; perCircuit[cid].a += a; perCircuit[cid].devices.push(x.d.name);
      if (x.conn === '3P') { for (const p of ['L1', 'L2', 'L3']) { phaseW[p] += w / 3; phaseA[p] += a; } }
      else if (['L1', 'L2', 'L3'].includes(x.conn)) { phaseW[x.conn] += w; phaseA[x.conn] += a; }
      else unassignedW += w;
    }
    scenarios[sc.key] = { label: sc.label, kw: r2(totalW / 1000), excluded, phaseW, phaseA, unassignedW, perCircuit, totalA1 };
  }

  // ---- 주차단기(설비 수용능력) 검토: 분기차단기 합계를 쓰지 않는다
  const peak = scenarios.add_peak;
  const mainChecks = panels.map((p) => {
    const bi = breakerIn(p.main_breaker);
    const issues = checkBreaker(p.main_breaker || {});
    let loadA = null; let status = 'hold'; let msg = bi.why;
    if (sitePhase === '3') {
      if (peak.unassignedW > 0) msg = '상 배치 미확인 부하가 있어 상별 최대전류 판정 보류';
      else loadA = Math.max(peak.phaseA.L1, peak.phaseA.L2, peak.phaseA.L3);
    } else if (sitePhase === '1') loadA = peak.totalA1;
    // 분전반이 여러 개면 해당 분전반 회로에 연결된 기기만 합산
    if (panels.length > 1) {
      const ids = circuits.filter((c) => String(c.panel_id) === String(p.id)).map((c) => String(c.id));
      loadA = ids.reduce((s, id) => s + (peak.perCircuit[id]?.a || 0), 0);
      if (sitePhase === '3') msg = (msg ? msg + ' / ' : '') + '분전반별 상전류는 회로 상 배치 기준 근사';
    }
    if (bi.value != null && loadA != null) {
      const ratio = loadA / bi.value;
      status = ratio > 1 ? 'over' : ratio > asm.caution_ratio ? 'caution' : 'ok';
      msg = `예상 ${r1(loadA)}A / 정격 ${bi.value}A (${Math.round(ratio * 100)}%)`;
    }
    return { panel: p.name, breakerA: bi.value, loadA: r1(loadA), status, msg, issues };
  });

  // ---- 분기회로 검토
  const circuitChecks = circuits.map((c) => {
    const pc = peak.perCircuit[String(c.id)] || { w: 0, a: 0, devices: [] };
    const bi = breakerIn(c.breaker);
    const res = { id: c.id, name: c.name, panel_id: c.panel_id, phase: c.phase || null, devices: pc.devices,
      kw: r2(pc.w / 1000), loadA: r1(pc.a), breakerA: bi.value, status: 'hold', msg: bi.why || '', wire: null, vdrop: null,
      issues: checkBreaker(c.breaker || {}), mismatch: c.label_mismatch || null };
    if (bi.value != null) {
      const ratio = pc.a / bi.value;
      res.status = ratio > 1 ? 'over' : ratio > asm.caution_ratio ? 'caution' : 'ok';
      res.msg = `예상 ${r1(pc.a)}A / 차단기 ${bi.value}A (${Math.round(ratio * 100)}%)`;
    }
    const w = c.wire || {};
    if (isNum(w.size_mm2) && w.material) {
      const row = findAmpacity(w, standards);
      if (row) {
        const iz = Number(row.ampacity_a);
        const ok = pc.a <= (bi.value ?? Infinity) && (bi.value == null || bi.value <= iz);
        res.wire = { iz, standard: row.standard, version: row.version, status: bi.value == null ? 'hold' : ok ? 'ok' : 'over',
          msg: bi.value == null ? '차단기 정격 미확인으로 보호협조 판정 보류' : `Ib ${r1(pc.a)}A ≤ In ${bi.value}A ≤ Iz ${iz}A ${ok ? '충족' : '불충족'}` };
      } else res.wire = { status: 'hold', msg: '등록된 허용전류 기준 중 조건(재질·절연·굵기·포설·온도·집합)이 일치하는 항목 없음 — 판정 보류' };
      if (isNum(w.length_m) && RHO[w.material]) {
        const v = (c.phase === '3P') ? n(site.v_line) : n(site.v_phase);
        if (v) {
          const k = c.phase === '3P' ? SQRT3 : 2;
          const dv = (k * Number(w.length_m) * pc.a * RHO[w.material]) / Number(w.size_mm2);
          const pct = (dv / v) * 100;
          const lim = n(standards.vdrop_limit_pct);
          res.vdrop = { volts: r2(dv), pct: r2(pct), limit: lim, standard: standards.vdrop_standard || null,
            status: lim == null ? 'info' : pct > lim ? 'over' : 'ok', note: '도체저항 근사(리액턴스·온도 미반영)' };
        }
      }
    } else res.wire = { status: 'hold', msg: '전선 굵기·재질 미확인(사진으로 확정하지 않음) — 케이블 표기 또는 전문가 확인 필요' };
    return res;
  });
  const unassigned = peak.perCircuit.__none?.devices || [];

  // ---- 상별 부하(삼상)
  let phaseCheck = null;
  if (sitePhase === '3') {
    const pw = peak.phaseW;
    if (peak.unassignedW > 0) phaseCheck = { status: 'hold', msg: '상 배치가 확인되지 않은 부하가 있어 불균형 판정 보류', phaseKw: kwOf(pw) };
    else {
      const vals = [pw.L1, pw.L2, pw.L3]; const avg = (vals[0] + vals[1] + vals[2]) / 3;
      const ratio = avg > 0 ? ((Math.max(...vals) - Math.min(...vals)) / avg) * 100 : 0;
      const lim = n(standards.unbalance_limit_pct);
      phaseCheck = { status: lim == null ? 'info' : ratio > lim ? 'over' : 'ok', unbalancePct: r1(ratio), limit: lim,
        standard: standards.unbalance_standard || null, phaseKw: kwOf(pw), phaseA: { L1: r1(peak.phaseA.L1), L2: r1(peak.phaseA.L2), L3: r1(peak.phaseA.L3) },
        msg: lim == null ? '불평형 기준 미등록 — 수치만 표시' : `설비 불평형률 ${r1(ratio)}% (기준 ${lim}%)` };
    }
  }

  // ---- 기동전류: 정상 운전과 별도. 제조사 기동 특성이 있는 기기만 계산
  const starts = devs.filter((x) => x.d.is_motor || isNum(x.d.start_current_a) || isNum(x.d.motor_output_kw)).map((x) => {
    if (!isNum(x.d.start_current_a)) return { name: x.d.name, status: 'hold', msg: '기동전류(제조사 기동 특성) 미입력 — 일괄 배수를 적용하지 않음' };
    const bi = x.circuit ? breakerIn(x.circuit.breaker) : { value: null };
    return { name: x.d.name, startA: Number(x.d.start_current_a), source: x.d.start_source || '출처 미기재', breakerA: bi.value,
      status: 'info', msg: '차단기 순시·단시한 동작 특성과 비교 필요(현장·제조사 자료 확인)' };
  });

  // ---- 계약전력 vs 예상 사용전력 vs 실측
  const contractKw = n(site.contract_kw);
  const plannedAddKw = (scenarios.add_peak.kw ?? 0) - (scenarios.cur_peak.kw ?? 0);
  const meas = (input.measurements || []).filter((m) => isNum(m.peak_kw));
  const measBest = meas.sort((a, b) => b.peak_kw - a.peak_kw)[0] || null;
  const measNotes = [];
  if (measBest) {
    if (!isNum(measBest.period_days) || Number(measBest.period_days) < 30) measNotes.push('측정기간이 짧아 연중 최대부하를 대표하지 않을 수 있음');
    if (!measBest.peak_season) measNotes.push('냉난방 성수기 측정이 아니면 연중 최대부하보다 낮을 수 있음');
  }
  const billMax = (input.bills || []).filter((b) => b.confirmed && isNum(b.max_demand_kw)).map((b) => Number(b.max_demand_kw));
  const candidates = [{ src: '기기 입력 계산(추가 후 최대 동시)', kw: scenarios.add_peak.kw }];
  if (measBest) candidates.push({ src: '실측 최대 + 추가 예정기기', kw: r2(Number(measBest.peak_kw) + plannedAddKw) });
  if (billMax.length) candidates.push({ src: '고지서 최대수요전력 + 추가 예정기기', kw: r2(Math.max(...billMax) + plannedAddKw) });
  const basisMax = candidates.reduce((a, b) => ((b.kw ?? -1) > (a.kw ?? -1) ? b : a));
  const technicalKw = basisMax.kw != null ? r2(basisMax.kw * (1 + asm.margin_pct / 100)) : null;
  const usable = devs.filter((x) => x.inp.unitW != null).length;
  if (!usable) missing.push('계산 가능한 기기(소비전력 또는 정격전류)');
  if (contractKw == null) missing.push('계약전력');

  let contractStatus = 'hold'; let addKw = null;
  if (contractKw != null && technicalKw != null) {
    contractStatus = technicalKw > contractKw ? 'short' : 'ok';
    addKw = technicalKw > contractKw ? r2(technicalKw - contractKw) : 0;
  }
  const rulesKnown = !!(input.contractRules && input.contractRules.length);

  // ---- 판정 종합
  const facilityShort = mainChecks.some((m) => m.status === 'over') || circuitChecks.some((c) => c.status === 'over' || c.wire?.status === 'over' || c.vdrop?.status === 'over')
    || phaseCheck?.status === 'over';
  const facilityHold = !panels.length || mainChecks.some((m) => m.status === 'hold') || circuitChecks.some((c) => c.status === 'hold');
  const contractShort = contractStatus === 'short';
  let verdict;
  if (!usable || (contractKw == null && !panels.length)) verdict = VERDICT.HOLD;
  else if (contractShort && facilityShort) verdict = VERDICT.BOTH;
  else if (contractShort) verdict = VERDICT.CONTRACT;
  else if (facilityShort) verdict = VERDICT.FACILITY;
  else if (contractStatus === 'hold' || facilityHold) verdict = VERDICT.HOLD;
  else verdict = VERDICT.OK;
  const expert = facilityShort || (input.suspicious || 0) > 0 || circuitChecks.some((c) => c.status === 'over' && c.wire?.status === 'hold');
  const flags = expert ? [VERDICT.EXPERT] : [];

  // 건물 관리비 납부(재판매) 사용자는 한전 신청이 아니라 관리주체 배정용량 확인 경로
  const path = site.supply_type === 'building_managed'
    ? { kind: 'building', steps: ['건물 관리주체에 세대·호실 배정용량(계약전력 상당) 확인', '건물 수전설비 여유 여부는 관리주체·전기안전관리자 확인', '증설은 관리주체 승인 후 진행(한전 직접 신청 대상 아닐 수 있음)'] }
    : site.supply_type === 'kepco_direct'
      ? { kind: 'kepco', steps: ['한전 고객번호·계약종별 확인', '계약전력 증설(또는 공급방식 변경) 신청은 한전 접수 후 산정', '내부 간선·분전반 개선은 전기공사업체 별도 검토'] }
      : { kind: 'unknown', steps: ['한전 직접 계약인지, 건물 관리비로 납부하는지 먼저 확인'] };

  if (sitePhase === '1' && devs.some((x) => x.inp.phase === '3')) notes.push('삼상 기기 사용에는 단상→삼상 공급방식 변경 검토가 필요합니다.');

  return {
    engine: ENGINE_VERSION, assumptions: asm, verdict, flags, missing, notes, path,
    scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, s]) => [k, { label: s.label, kw: s.kw, excluded: s.excluded, phaseKw: kwOf(s.phaseW), unassignedKw: r2(s.unassignedW / 1000) }])),
    contract: { contractKw, technicalKw, basis: basisMax.src, candidates, addKw, status: contractStatus, plannedAddKw: r2(plannedAddKw),
      measured: measBest ? { peak_kw: Number(measBest.peak_kw), period_days: measBest.period_days ?? null, at: measBest.measured_at ?? null, notes: measNotes } : null,
      billMaxKw: billMax.length ? Math.max(...billMax) : null,
      officialKw: null, officialNote: rulesKnown ? '등록된 약관 규칙 적용 필요' : '적용 가능한 한전 계약전력 결정 규칙 미확인 — 기술적 검토값까지만 제시합니다.' },
    main: mainChecks, circuits: circuitChecks, unassigned, phase: phaseCheck, starts,
    devices: devs.map((x) => ({ id: x.d.id, name: x.d.name, status: x.d.status || 'current', unitW: r1(x.inp.unitW), unitA: r2(x.inp.unitA), qty: x.inp.qty,
      basis: x.inp.basis, factors: x.f, conn: x.conn, warnings: x.inp.warnings })),
  };
}
function kwOf(pw) { return { L1: r2(pw.L1 / 1000), L2: r2(pw.L2 / 1000), L3: r2(pw.L3 / 1000) }; }

// 월 사용량 추정(kWh): 기기 입력값 기반. 순간전력(kW)과 별개 개념
export function monthlyKwh(devices, site, asm = DEFAULT_ASSUMPTIONS, statuses = ['current']) {
  let kwh = 0;
  for (const d of devices) {
    if (!statuses.includes(d.status || 'current')) continue;
    const inp = deviceInput(d, site, asm);
    if (inp.unitW == null || !isNum(d.hours_per_day)) continue;
    const days = isNum(d.days_per_week) ? Number(d.days_per_week) : 7;
    kwh += (inp.unitW * inp.qty / 1000) * Number(d.hours_per_day) * days * (52 / 12);
  }
  return r1(kwh);
}

// 증설 없이 해결 가능한 대안 비교
export function alternatives(result, devices) {
  const sc = result.scenarios; const list = [];
  const shiftCut = sc.add_peak.kw != null && sc.add_shifted.kw != null ? r2(sc.add_peak.kw - sc.add_shifted.kw) : null;
  list.push({ key: 'shift', name: '전열기기 동시 사용시간 분산', peakCutKw: shiftCut, cost: '추가 공사비 없음(운영 변경)',
    burden: '사용 시간 제약', check: shiftCut ? '분산 시간대 운전계수를 실제 운영대로 입력했는지 확인' : '기기별 "시간대 분산" 운전계수를 입력하면 감소량이 계산됩니다.' });
  const evs = devices.filter((d) => d.category === 'ev');
  const evCut = evs.reduce((s, d) => {
    const lim = n(d.ev_limit_kw); const w = d.power_unit === 'kW' ? n(d.power_value) : (n(d.power_value) ?? 0) / 1000;
    return lim != null && w != null && w > lim ? s + (w - lim) * (n(d.qty) ?? 1) : s;
  }, 0);
  list.push({ key: 'ev', name: '전기차 충전시간 이동·최대 충전출력 제한', peakCutKw: evs.length ? r2(evCut) : null, cost: '충전기 설정 또는 부하관리 장치(견적 필요)',
    burden: '충전 시간 증가', check: evs.length ? '충전기 출력 제한 기능 지원 여부 확인' : '전기차 충전기 미등록' });
  list.push({ key: 'split', name: '분기회로 분리·전용회로 신설', peakCutKw: 0, cost: '공사비 견적 필요', burden: '공사 중 정전',
    check: '전체 피크는 줄지 않음 — 특정 회로 과부하 해소 목적. 간선·분전반 여유 확인 필요' });
  list.push({ key: 'phase', name: '확인된 조건에 따른 상별 부하 재배치', peakCutKw: 0, cost: '공사비 견적 필요', burden: '공사 중 정전',
    check: result.phase?.status === 'hold' ? '상 배치가 확인되어야 검토 가능' : '상 불평형 해소 목적(총 전력은 동일)' });
  list.push({ key: 'start', name: '모터 기동시간 분산', peakCutKw: 0, cost: '제어 변경(견적 필요)', burden: '운전 순서 제약', check: '정상 운전 피크는 동일 — 기동 시 순간 전류만 감소' });
  list.push({ key: 'eff', name: '고효율 기기 교체', peakCutKw: null, cost: '기기 구입비', burden: '초기 투자', check: '교체 후 기기의 명판 소비전력을 입력하면 비교 가능' });
  list.push({ key: 'monitor', name: '피크전력 모니터링', peakCutKw: null, cost: '계측기 설치(견적 필요)', burden: '없음', check: '현재 계측기 연동 기능 없음 — 실측값은 수동 입력' });
  return { list, note: '계약전력 여유를 확보해도 배선·차단기 문제가 해결된 것은 아닙니다. 회로·차단기 판정은 별도로 확인하세요.' };
}
