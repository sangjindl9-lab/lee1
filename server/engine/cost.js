// 한전 납부금·전기공사비·전기요금 계산. 등록된(출처·적용일 있는) 단가만 사용한다.
// 단가가 없거나 적용일이 지났으면 금액을 0원으로 만들지 않고 '확인 필요'로 남긴다.

export const COST_VERSION = 'cost-1.0.0';
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const won = (v) => Math.round(v);

export function validOn(row, date) {
  const d = date || new Date().toISOString().slice(0, 10);
  if (row.valid_from && d < row.valid_from) return false;
  if (row.valid_to && d > row.valid_to) return false;
  return true;
}

// 한전 시설부담금 예상. rates: [{item, name, app_types, voltage_class, method, unit, unit_price, free_qty, taxable, valid_from, valid_to, source_url, version}]
export function kepcoFee(req, rates, vatRate = 0.1) {
  const date = req.apply_date || new Date().toISOString().slice(0, 10);
  const items = [];
  const match = (item) => rates.filter((r) => r.item === item &&
    (!r.app_types || !r.app_types.length || r.app_types.includes(req.app_type)) &&
    (!r.voltage_class || r.voltage_class === req.voltage_class) &&
    (!r.method || r.method === req.method));

  const need = [{ item: 'basic', label: '기본시설부담금' }];
  if (!req.use_existing) need.push({ item: 'distance', label: '거리시설부담금' });

  for (const nd of need) {
    const cands = match(nd.item);
    const valid = cands.filter((r) => validOn(r, date));
    if (!cands.length) { items.push({ label: nd.label, status: 'unresolved', reason: '등록된 요율 없음 — 한전 확인 필요' }); continue; }
    if (!valid.length) { items.push({ label: nd.label, status: 'unresolved', reason: `신청 예정일(${date})에 유효한 요율 없음(적용기간 만료) — 한전 확인 필요` }); continue; }
    for (const r of valid) {
      let qty = null; let reason = null;
      if (r.unit === 'per_kw') {
        const inc = isNum(req.kw_after) && isNum(req.kw_before) ? Number(req.kw_after) - Number(req.kw_before) : isNum(req.kw_after) && req.app_type === 'new' ? Number(req.kw_after) : null;
        qty = inc != null ? Math.max(0, inc - (Number(r.free_qty) || 0)) : null; if (qty == null) reason = '기존·변경 계약전력 입력 필요';
      } else if (r.unit === 'per_m') {
        qty = isNum(req.distance_m) ? Math.max(0, Number(req.distance_m) - (Number(r.free_qty) || 0)) : null; if (qty == null) reason = '거리 조건 입력 필요';
      } else if (r.unit === 'fixed') qty = 1;
      if (qty == null) { items.push({ label: r.name || nd.label, status: 'unresolved', reason }); continue; }
      const amount = qty * Number(r.unit_price);
      const tax = r.taxable ? amount * vatRate : 0;
      items.push({ label: r.name || nd.label, status: 'estimated', qty, unit: r.unit, unit_price: Number(r.unit_price), amount: won(amount), tax: won(tax), total: won(amount + tax),
        version: r.version, valid_from: r.valid_from, valid_to: r.valid_to, source_url: r.source_url, conditions: r.conditions || null });
    }
  }
  if (req.special_negotiation) items.push({ label: '별도 협의 항목', status: 'unresolved', reason: '한전 별도 협의 대상 — 금액 미확정' });
  const est = items.filter((i) => i.status === 'estimated');
  return { version: COST_VERSION, date, items, subtotal: est.length ? est.reduce((s, i) => s + i.total, 0) : null,
    unresolved: items.filter((i) => i.status === 'unresolved').length, state: '한전 최종 산정 전 예상금액' };
}

// 전기공사비 견적. items: [{code,name,unit,qty_min,qty_max}], prices: [{code, material, labor, expense, region, base_date, source, valid_to}]
export function buildQuote(items, prices, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const vat = isNum(opts.vat_rate) ? Number(opts.vat_rate) : 0.1;
  const lines = items.map((it) => {
    const all = prices.filter((p) => p.code === it.code && (!opts.region || !p.region || p.region === opts.region));
    const ps = all.filter((p) => validOn({ valid_to: p.valid_to }, date));
    if (!ps.length) return { ...it, status: 'unresolved', reason: all.length ? '단가 적용기간 만료' : '단가 미등록' };
    const unit = (p) => Number(p.material || 0) + Number(p.labor || 0) + Number(p.expense || 0);
    const lo = ps.reduce((a, b) => (unit(b) < unit(a) ? b : a)); const hi = ps.reduce((a, b) => (unit(b) > unit(a) ? b : a));
    const qmin = Number(it.qty_min ?? it.qty ?? 0); const qmax = Number(it.qty_max ?? it.qty_min ?? it.qty ?? 0);
    const part = (p, q) => ({ material: won(q * Number(p.material || 0)), labor: won(q * Number(p.labor || 0)), expense: won(q * Number(p.expense || 0)) });
    const min = part(lo, qmin); const max = part(hi, qmax);
    return { ...it, status: 'priced', qty_min: qmin, qty_max: qmax, min, max,
      min_total: min.material + min.labor + min.expense, max_total: max.material + max.labor + max.expense,
      price_basis: [...new Set([lo, hi])].map((p) => ({ source: p.source, region: p.region, base_date: p.base_date })) };
  });
  const priced = lines.filter((l) => l.status === 'priced');
  const sum = (k) => priced.reduce((s, l) => s + l[k], 0);
  const sumPart = (side, k) => priced.reduce((s, l) => s + l[side][k], 0);
  const supplyMin = sum('min_total'); const supplyMax = sum('max_total');
  return { version: COST_VERSION, date, lines,
    totals: priced.length ? {
      material: [sumPart('min', 'material'), sumPart('max', 'material')], labor: [sumPart('min', 'labor'), sumPart('max', 'labor')],
      expense: [sumPart('min', 'expense'), sumPart('max', 'expense')], supply: [supplyMin, supplyMax],
      vat: [won(supplyMin * vat), won(supplyMax * vat)], total: [won(supplyMin * (1 + vat)), won(supplyMax * (1 + vat))] } : null,
    unresolved: lines.filter((l) => l.status === 'unresolved').map((l) => `${l.name}: ${l.reason}`) };
}

export function quoteStatus({ quote, surveyed, confirmed }) {
  if (!quote.lines.length || quote.unresolved.length) return '정보 부족';
  if (confirmed) return '업체 확정 견적';
  if (surveyed) return '현장 조사 반영 견적';
  return '가정 기반 개략 견적';
}

// 월 전기요금(검증된 요금 규칙이 등록된 경우에만). appliedKw는 요금적용전력(계약전력과 다를 수 있음)
export function monthlyBill(rule, appliedKw, kwh) {
  if (!rule) return null;
  if (!isNum(appliedKw) || !isNum(kwh)) return null;
  const basic = Number(rule.basic_per_kw) * Number(appliedKw);
  const energy = Number(rule.energy_per_kwh) * Number(kwh);
  return { basic: won(basic), energy: won(energy), subtotal: won(basic + energy), rule_version: rule.version, note: '부가세·기후환경요금·연료비조정 등 미포함 항목은 고지서와 차이가 날 수 있음' };
}

export function compareTariff({ rule, appliedKwNow, appliedKwAfter, kwhNow, kwhAfter, investCost }) {
  if (!rule) return { status: 'hold', msg: '해당 계약종별의 검증된 요금 규칙이 등록되지 않아 요금 비교를 보류합니다.' };
  const now = monthlyBill(rule, appliedKwNow, kwhNow); const after = monthlyBill(rule, appliedKwAfter ?? appliedKwNow, kwhAfter);
  if (!now || !after) return { status: 'hold', msg: '요금적용전력 또는 사용량 정보가 부족합니다.' };
  const diff = after.subtotal - now.subtotal;
  const payback = diff < 0 && isNum(investCost) ? Math.round((Number(investCost) / -diff) * 10) / 10 : null;
  return { status: 'ok', now, after, monthlyDiff: diff, paybackMonths: payback, note: payback == null ? '절감액이 확인되지 않으면 투자비 회수기간을 계산하지 않습니다.' : null };
}

// 고지서 12개월 계절 비교. kWh는 사용량이며 kW(순간/최대수요)로 쓰지 않는다
export function seasonalBills(bills) {
  const season = (m) => ([6, 7, 8].includes(m) ? '여름' : [11, 12, 1, 2].includes(m) ? '겨울' : '봄·가을');
  const ok = bills.filter((b) => b.confirmed && b.period_end);
  const groups = {};
  for (const b of ok) {
    const m = Number(String(b.period_end).slice(5, 7)); const s = season(m);
    groups[s] = groups[s] || { months: 0, kwh: 0, charge: 0, maxDemand: null };
    groups[s].months++; groups[s].kwh += Number(b.usage_kwh || 0); groups[s].charge += Number(b.total_charge || 0);
    if (isNum(b.max_demand_kw)) groups[s].maxDemand = Math.max(groups[s].maxDemand ?? 0, Number(b.max_demand_kw));
  }
  const hasDemand = ok.some((b) => isNum(b.max_demand_kw));
  return { count: ok.length, groups, note: hasDemand ? null : '고지서에 최대수요전력 표시가 없어 월 사용량만 비교합니다. 월 kWh로 순간 최대전력을 추정하지 않습니다.' };
}
