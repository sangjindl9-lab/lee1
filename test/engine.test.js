import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, powerToW, parseBreakerText, checkBreaker, classifyNameplateLine } from '../server/engine/units.js';
import { evaluate, VERDICT, currentSingle, currentThree, deviceInput, DEFAULT_ASSUMPTIONS, monthlyKwh, alternatives } from '../server/engine/load.js';
import { kepcoFee, buildQuote, quoteStatus, compareTariff, seasonalBills } from '../server/engine/cost.js';

const site1 = { phase: '1', v_phase: 220, contract_kw: 5, supply_type: 'kepco_direct' };
const panel = (at) => ({ id: 'p1', name: '분전반', main_breaker: { at, af: 100 } });

test('W/kW 변환과 kW/kWh 혼동 방지', () => {
  assert.equal(powerToW(2.5, 'kW'), 2500);
  assert.equal(powerToW(800, 'W'), 800);
  assert.throws(() => powerToW(300, 'kWh'), /전력량/);
  assert.deepEqual(parseQuantity('1,234 kWh'), { value: 1234, unit: 'kWh' });
  assert.deepEqual(parseQuantity('15kW'), { value: 15, unit: 'kW' });
  const r = evaluate({ site: site1, devices: [{ id: 1, name: 'X', power_value: 300, power_unit: 'kWh' }], panels: [panel(50)] });
  assert.equal(r.verdict, VERDICT.HOLD); // kWh는 계산에 쓰지 않음
  assert.ok(r.devices[0].warnings.some((w) => /전력량/.test(w)));
});

test('AF와 AT 오인식 방지, 정격전류·감도전류·차단용량 구분', () => {
  const b = parseBreakerText('ELB 2P 50AF 30AT 30mA 2.5kA 220V');
  assert.equal(b.af, 50); assert.equal(b.at, 30); assert.equal(b.sens_ma, 30); assert.equal(b.ka, 2.5); assert.equal(b.poles, 2);
  const b2 = parseBreakerText('30mA 5kA 20A');
  assert.equal(b2.at, 20); assert.equal(b2.sens_ma, 30); assert.equal(b2.ka, 5);
  assert.ok(checkBreaker({ af: 30, at: 50 }).some((s) => /바뀌어/.test(s)));
  // AF만 있으면 AT로 쓰지 않음 → 주차단기 판정 보류
  const r = evaluate({ site: site1, devices: [{ id: 1, name: '조명', power_value: 500, pf: 1 }], panels: [{ id: 'p', name: 'A', main_breaker: { af: 50 } }] });
  assert.equal(r.main[0].status, 'hold');
});

test('냉방능력을 소비전력으로 쓰지 않음, 모터 출력은 효율 명시 시에만', () => {
  assert.equal(classifyNameplateLine('냉방능력', '7,200W').field, 'cooling_capacity_kw');
  assert.equal(classifyNameplateLine('소비전력', '2,350W').field, 'power');
  const ac = deviceInput({ cooling_capacity_kw: 7.2 }, site1, DEFAULT_ASSUMPTIONS);
  assert.equal(ac.unitW, null); assert.ok(ac.warnings.some((w) => /냉방/.test(w)));
  assert.equal(deviceInput({ motor_output_kw: 2.2 }, site1, DEFAULT_ASSUMPTIONS).unitW, null);
  assert.equal(Math.round(deviceInput({ motor_output_kw: 2.2, efficiency: 0.88 }, site1, DEFAULT_ASSUMPTIONS).unitW), 2500);
  // 이미 전기 입력전력이면 효율로 다시 나누지 않음
  assert.equal(deviceInput({ power_value: 2500, efficiency: 0.8 }, site1, DEFAULT_ASSUMPTIONS).unitW, 2500);
});

test('전류 공식', () => {
  assert.equal(Math.round(currentSingle(2200, 220, 1) * 10) / 10, 10);
  assert.equal(Math.round(currentThree(10000, 380, 0.9) * 10) / 10, 16.9);
});

test('전체 여유는 있지만 특정 분기회로가 부족한 경우', () => {
  const r = evaluate({ site: { ...site1, contract_kw: 20 }, panels: [panel(100)],
    circuits: [{ id: 'c1', panel_id: 'p1', name: '주방', breaker: { at: 20 } }, { id: 'c2', panel_id: 'p1', name: '전등', breaker: { at: 20 } }],
    devices: [{ id: 1, name: '인덕션', power_value: 3400, pf: 1, circuit_id: 'c1' }, { id: 2, name: '전기오븐', power_value: 2000, pf: 1, circuit_id: 'c1', status: 'planned' }] });
  assert.equal(r.contract.status, 'ok');
  assert.equal(r.circuits.find((c) => c.id === 'c1').status, 'over'); // 5400W/220V = 24.5A > 20A
  assert.equal(r.verdict, VERDICT.FACILITY);
  assert.ok(r.flags.includes(VERDICT.EXPERT));
});

test('계약전력만 부족한 경우와 배선(회로)만 부족한 경우', () => {
  const base = { panels: [panel(100)], circuits: [{ id: 'c1', panel_id: 'p1', name: '회로', breaker: { at: 50 } }] };
  const onlyContract = evaluate({ ...base, site: { ...site1, contract_kw: 3 }, devices: [{ id: 1, name: '히터', power_value: 4, power_unit: 'kW', pf: 1, circuit_id: 'c1' }] });
  assert.equal(onlyContract.verdict, VERDICT.CONTRACT);
  assert.equal(onlyContract.contract.addKw, 1);
  assert.equal(onlyContract.contract.officialKw, null); // 반올림값을 공식 계약전력으로 제시하지 않음
  const onlyWire = evaluate({ ...base, site: { ...site1, contract_kw: 20 }, circuits: [{ id: 'c1', panel_id: 'p1', name: '회로', breaker: { at: 15 } }],
    devices: [{ id: 1, name: '히터', power_value: 4, power_unit: 'kW', pf: 1, circuit_id: 'c1' }] });
  assert.equal(onlyWire.verdict, VERDICT.FACILITY);
});

test('분기차단기 합계를 주차단기 용량으로 쓰지 않음', () => {
  const r = evaluate({ site: { ...site1, contract_kw: 20 }, panels: [{ id: 'p1', name: 'A', main_breaker: {} }],
    circuits: [{ id: 'c1', panel_id: 'p1', breaker: { at: 30 } }, { id: 'c2', panel_id: 'p1', breaker: { at: 30 } }],
    devices: [{ id: 1, name: 'a', power_value: 1000, pf: 1, circuit_id: 'c1' }] });
  assert.equal(r.main[0].breakerA, null);
  assert.equal(r.main[0].status, 'hold');
});

test('삼상에 단상 부하 편중, 상 배치 미확인 시 보류', () => {
  const s3 = { phase: '3', v_phase: 220, v_line: 380, contract_kw: 30 };
  const devs = [{ id: 1, name: '냉장', power_value: 6000, pf: 1, conn_phase: 'L1' }, { id: 2, name: '조명', power_value: 1000, pf: 1, conn_phase: 'L2' }, { id: 3, name: '모터', power_value: 3000, pf: 0.85, phase: '3', conn_phase: '3P' }];
  const r = evaluate({ site: s3, devices: devs, panels: [{ id: 'p', name: 'M', main_breaker: { at: 75 } }], standards: { unbalance_limit_pct: 30, unbalance_standard: '테스트 기준' } });
  assert.equal(r.phase.status, 'over');
  assert.ok(r.phase.phaseKw.L1 > r.phase.phaseKw.L3);
  const r2 = evaluate({ site: s3, devices: [...devs, { id: 4, name: '미상', power_value: 500, pf: 1 }], panels: [{ id: 'p', name: 'M', main_breaker: { at: 75 } }] });
  assert.equal(r2.phase.status, 'hold');
  assert.equal(r2.main[0].status, 'hold');
});

test('정상 운전과 모터 기동 구분(일괄 배수 미적용)', () => {
  const r = evaluate({ site: site1, panels: [panel(50)], devices: [{ id: 1, name: '펌프', motor_output_kw: 1.5, efficiency: 0.8, is_motor: true }, { id: 2, name: '컴프', power_value: 1500, pf: 0.9, start_current_a: 40, start_source: '제조사 설명서' }] });
  assert.equal(r.starts.find((s) => s.name === '펌프').status, 'hold');
  assert.equal(r.starts.find((s) => s.name === '컴프').startA, 40);
  assert.equal(r.scenarios.cur_peak.kw, 3.38); // 정상 운전 합계에는 기동전류가 섞이지 않음
});

test('운전계수 1회 적용, 시간대 분산 시나리오', () => {
  const r = evaluate({ site: site1, panels: [panel(50)], devices: [{ id: 1, name: '히터', power_value: 2000, pf: 1, factor_peak: 1, factor_normal: 0.5, factor_shifted: 0 }], assumptions: { margin_pct: 10 } });
  assert.equal(r.scenarios.cur_peak.kw, 2); assert.equal(r.scenarios.cur_normal.kw, 1); assert.equal(r.scenarios.add_shifted.kw, 0);
  assert.equal(r.contract.technicalKw, 2.2);
  const alt = alternatives(r, []);
  assert.equal(alt.list.find((a) => a.key === 'shift').peakCutKw, 2);
  assert.match(alt.note, /배선·차단기 문제가 해결된 것은 아닙니다/);
});

test('측정기간이 짧으면 대표값 아님 표시', () => {
  const r = evaluate({ site: site1, panels: [panel(50)], devices: [{ id: 1, name: 'a', power_value: 1000, pf: 1 }], measurements: [{ peak_kw: 4.5, period_days: 3 }] });
  assert.equal(r.contract.basis, '실측 최대 + 추가 예정기기');
  assert.ok(r.contract.measured.notes.some((n) => /짧아/.test(n)));
});

test('아파트 세대·재판매 사용자 경로', () => {
  const r = evaluate({ site: { ...site1, supply_type: 'building_managed' }, panels: [panel(50)], devices: [{ id: 1, name: 'a', power_value: 1000, pf: 1 }] });
  assert.equal(r.path.kind, 'building');
  assert.ok(r.path.steps[0].includes('관리주체'));
});

test('허용전류 기준 미등록이면 판정 보류, 등록되면 보호협조 판정', () => {
  const c = { id: 'c1', panel_id: 'p1', name: '에어컨', breaker: { at: 30 }, wire: { material: 'Cu', insulation: 'HFIX', size_mm2: 2.5, install_method: 'B1', length_m: 20 } };
  const devs = [{ id: 1, name: '에어컨', power_value: 3000, pf: 1, circuit_id: 'c1' }];
  const r = evaluate({ site: site1, panels: [panel(50)], circuits: [c], devices: devs });
  assert.equal(r.circuits[0].wire.status, 'hold');
  const r2 = evaluate({ site: site1, panels: [panel(50)], circuits: [c], devices: devs,
    standards: { ampacity: [{ material: 'Cu', insulation: 'HFIX', size_mm2: 2.5, method: 'B1', ampacity_a: 24, standard: '테스트표', version: 't1' }] } });
  assert.equal(r2.circuits[0].wire.status, 'over'); // In 30A > Iz 24A
  assert.ok(r2.circuits[0].vdrop.pct > 0);
});

test('한전 납부금: 단가 미등록·적용일 만료는 0원이 아니라 확인 필요', () => {
  const none = kepcoFee({ app_type: 'increase', kw_before: 5, kw_after: 10, apply_date: '2026-12-01', use_existing: true }, []);
  assert.equal(none.subtotal, null); assert.equal(none.items[0].status, 'unresolved');
  const expired = kepcoFee({ app_type: 'increase', kw_before: 5, kw_after: 10, apply_date: '2026-12-01', use_existing: true },
    [{ item: 'basic', unit: 'per_kw', unit_price: 1000, valid_from: '2020-01-01', valid_to: '2025-12-31' }]);
  assert.match(expired.items[0].reason, /만료/);
  const ok = kepcoFee({ app_type: 'increase', kw_before: 5, kw_after: 10, apply_date: '2026-12-01', use_existing: true },
    [{ item: 'basic', unit: 'per_kw', unit_price: 1000, taxable: true, valid_from: '2026-01-01', version: 'test' }]);
  assert.equal(ok.items[0].total, 5500);
});

test('공사비: 단가 미등록 시 정보 부족, 범위는 수량·단가 범위에서', () => {
  const q = buildQuote([{ code: 'MCB', name: '차단기 교체', unit: '개', qty_min: 1, qty_max: 2 }, { code: 'X', name: '미등록', qty_min: 1 }],
    [{ code: 'MCB', material: 10000, labor: 20000, expense: 0, source: 'A', valid_to: '2099-12-31' }, { code: 'MCB', material: 12000, labor: 20000, expense: 0, source: 'B' }]);
  assert.deepEqual(q.totals.supply, [30000, 64000]);
  assert.equal(quoteStatus({ quote: q }), '정보 부족');
  const exp = buildQuote([{ code: 'MCB', name: 'a', qty_min: 1 }], [{ code: 'MCB', material: 1, valid_to: '2020-01-01' }]);
  assert.match(exp.unresolved[0], /만료/);
});

test('요금: 규칙 미등록 보류, 절감 확인 시에만 회수기간', () => {
  assert.equal(compareTariff({ rule: null }).status, 'hold');
  const rule = { basic_per_kw: 100, energy_per_kwh: 10, version: 't' };
  const up = compareTariff({ rule, appliedKwNow: 5, appliedKwAfter: 10, kwhNow: 100, kwhAfter: 200, investCost: 1000 });
  assert.equal(up.paybackMonths, null);
  const down = compareTariff({ rule, appliedKwNow: 5, kwhNow: 200, kwhAfter: 100, investCost: 1000 });
  assert.equal(down.paybackMonths, 1);
  const s = seasonalBills([{ confirmed: true, period_end: '2026-07-31', usage_kwh: 500 }]);
  assert.match(s.note, /최대수요전력 표시가 없어/);
  assert.ok(monthlyKwh([{ power_value: 1000, hours_per_day: 1, days_per_week: 7 }], site1) > 30);
});
