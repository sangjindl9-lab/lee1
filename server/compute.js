// 장소 데이터 묶음 → 계산 엔진 실행 → 결과(보고서 스냅샷)
import { all, get, J, getSetting } from './db.js';
import { evaluate, alternatives, monthlyKwh, ENGINE_VERSION } from './engine/load.js';
import { kepcoFee, buildQuote, quoteStatus, compareTariff, seasonalBills, validOn, COST_VERSION } from './engine/cost.js';

const rows = (sql, ...p) => all(sql, ...p).map((r) => ({ ...J(r.data), id: r.id, _created: r.created_at, ...(r.panel_id ? { panel_id: r.panel_id } : {}), ...(r.file_id ? { file_id: r.file_id } : {}) }));

export function loadStandards() {
  const st = { ampacity: [] };
  for (const r of all('SELECT * FROM standards')) {
    const d = J(r.data);
    if (r.kind === 'ampacity') st.ampacity.push(d);
    else if (r.kind === 'limit' && d.key) { st[d.key] = d.value; st[d.key.replace('_limit_pct', '_standard')] = `${d.standard || ''} ${d.version || ''}`.trim(); }
  }
  return st;
}

export function siteBundle(siteId) {
  const s = get('SELECT * FROM sites WHERE id=?', siteId);
  const info = J(s.info);
  const site = { ...info, id: s.id, name: s.name, address: s.address };
  const devices = rows('SELECT * FROM devices WHERE site_id=? ORDER BY id', siteId);
  const panels = rows('SELECT * FROM panels WHERE site_id=? ORDER BY id', siteId);
  const circuits = rows('SELECT * FROM circuits WHERE site_id=? ORDER BY id', siteId);
  const measurements = rows('SELECT * FROM measurements WHERE site_id=? ORDER BY id', siteId);
  const bills = all('SELECT * FROM bills WHERE site_id=? ORDER BY id', siteId).map((b) => ({ ...J(b.data), id: b.id, confirmed: !!b.confirmed, file_id: b.file_id }));
  const ex = all("SELECT findings FROM extractions WHERE site_id=? AND status='done'", siteId);
  const suspicious = ex.reduce((n, e) => n + J(e.findings, []).length, 0);
  return { s, site, assumptions: J(s.assumptions), devices, panels, circuits, measurements, bills, suspicious };
}

export function compute(siteId, { companyId } = {}) {
  const b = siteBundle(siteId);
  const standards = loadStandards();
  const result = evaluate({ site: b.site, assumptions: b.assumptions, devices: b.devices, panels: b.panels, circuits: b.circuits,
    measurements: b.measurements, bills: b.bills, standards, suspicious: b.suspicious });
  const alt = alternatives(result, b.devices);
  const vat = Number(getSetting('vat_rate', 0.1));

  const qrow = get('SELECT * FROM quotes WHERE site_id=? AND (company_id IS ? OR ? IS NULL) ORDER BY updated_at DESC LIMIT 1', siteId, companyId ?? b.s.company_id ?? null, companyId ?? b.s.company_id ?? null);
  const qItems = qrow ? J(qrow.items, []) : [];
  const kreq = qrow ? J(qrow.kepco_req) : {};
  const treq = qrow ? J(qrow.tariff_req) : {};
  const cid = qrow?.company_id ?? companyId ?? b.s.company_id ?? null;
  const prices = all('SELECT * FROM unit_prices WHERE company_id IS NULL OR company_id=?', cid).map((r) => ({ ...J(r.data), id: r.id, company_id: r.company_id }));
  const quote = buildQuote(qItems, prices, { vat_rate: vat, region: kreq.region });
  quote.status = quoteStatus({ quote, surveyed: b.measurements.length > 0, confirmed: !!qrow?.confirmed });

  let kepco = null;
  if (b.site.supply_type === 'building_managed') kepco = { state: '건물 관리주체 경로 — 한전 납부금 대신 관리주체 배정용량·분담금 확인 필요', items: [], subtotal: null, unresolved: 1 };
  else if (kreq.app_type) {
    const rates = all('SELECT * FROM rates_kepco').map((r) => ({ ...J(r.data), id: r.id }));
    kepco = kepcoFee({ kw_before: b.site.contract_kw, ...kreq }, rates, vat);
  }

  const tariffs = all('SELECT * FROM rates_tariff').map((r) => J(r.data));
  const rule = tariffs.find((t) => t.contract_kind && t.contract_kind === b.site.contract_kind && validOn(t)) || null;
  const kwhNow = monthlyKwh(b.devices, b.site, result.assumptions, ['current']);
  const kwhAfter = monthlyKwh(b.devices, b.site, result.assumptions, ['current', 'planned']);
  const appliedNow = treq.applied_kw_now ?? b.site.contract_kw ?? null;
  const tariff = { ...compareTariff({ rule, appliedKwNow: appliedNow, appliedKwAfter: treq.applied_kw_after ?? appliedNow, kwhNow, kwhAfter, investCost: quote.totals?.total?.[0] }),
    kwhNow, kwhAfter, appliedAssumed: treq.applied_kw_now == null ? '요금적용전력 미입력 → 계약전력과 같다고 가정(고지서로 확인 필요)' : null };
  const seasonal = seasonalBills(b.bills);

  return { computed_at: new Date().toISOString(), versions: { engine: ENGINE_VERSION, cost: COST_VERSION, tariff: rule?.version || null },
    bundle: { site: b.site, assumptions: result.assumptions, devices: b.devices, panels: b.panels, circuits: b.circuits, measurements: b.measurements, bills: b.bills },
    result, alternatives: alt, quote, quoteRow: qrow ? { id: qrow.id, items: qItems, kepco_req: kreq, tariff_req: treq, confirmed: !!qrow.confirmed, company_id: qrow.company_id } : null,
    kepco, tariff, seasonal, standards };
}

// 결과 첫 화면의 질문별 답
export function answers(c) {
  const r = c.result; const V = r.verdict;
  const facility = r.circuits.some((x) => x.status === 'over' || x.wire?.status === 'over') || r.main.some((m) => m.status === 'over') || r.phase?.status === 'over';
  return [
    { q: '새 기기를 현재 조건에서 사용할 수 있는가?', a: V === '입력 조건상 여유 있음' ? '입력된 조건에서는 여유가 있습니다(현장 확인 전 검토값).' : V === '정보 부족으로 판단 보류' ? '정보가 부족해 판단을 보류합니다.' : '현재 조건 그대로는 검토가 필요합니다.' },
    { q: '계약전력 증설 검토가 필요한가?', a: r.contract.status === 'short' ? `예 — 기술적 검토값 ${r.contract.technicalKw}kW > 계약 ${r.contract.contractKw}kW (추가 ${r.contract.addKw}kW 검토)` : r.contract.status === 'ok' ? '입력 조건상 계약전력 범위 이내입니다.' : '계약전력 또는 부하 정보가 없어 보류' },
    { q: '내부 설비 개선 검토가 필요한가?', a: facility ? '예 — 회로·차단기·상 부하 항목을 확인하세요.' : r.main.length ? '입력된 범위에서 초과 항목은 없습니다(보류 항목 확인).' : '분전반 정보가 없어 보류' },
    { q: '어느 정보가 부족한가?', a: r.missing.length ? r.missing.join(', ') : '필수 항목은 입력됨(보류 항목은 상세 참고)' },
    { q: '예상 비용은 얼마이며 무엇이 제외되어 있는가?', a: costLine(c) },
    { q: '다음으로 무엇을 확인해야 하는가?', a: r.path.steps[0] },
  ];
}
function costLine(c) {
  const parts = [];
  if (c.quote.totals) parts.push(`내부 공사비 ${c.quote.totals.total[0].toLocaleString()}~${c.quote.totals.total[1].toLocaleString()}원(${c.quote.status})`);
  else parts.push('내부 공사비: 단가·항목 미등록');
  if (c.kepco?.subtotal != null) parts.push(`한전 예상 ${c.kepco.subtotal.toLocaleString()}원(미확정 ${c.kepco.unresolved}건)`);
  else parts.push('한전 납부금: 한전 확인 필요');
  if (c.quote.unresolved.length) parts.push(`제외: ${c.quote.unresolved.length}개 항목 단가 없음`);
  return parts.join(' · ');
}
