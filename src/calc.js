const fl = (x) => Math.floor(x + 1e-9);

export const matPrice = (m) => {
  if (!m) return 0;
  if (m.applied > 0) return m.applied;
  const c = [m.p1, m.p2, m.p3].map(Number).filter((v) => v > 0);
  return c.length ? Math.min(...c) : 0;
};

export function unitCost(p, u) {
  let m = 0, l = 0, e = 0;
  const lines = u.items.map((i) => {
    let name = i.name, spec = i.spec || '', unit = i.unit || '', price = Number(i.price) || 0;
    if (i.kind === '자재') {
      const mt = p.mats.find((x) => x.id === i.ref);
      if (mt) { name = mt.name; spec = mt.spec; unit = mt.unit; price = matPrice(mt); }
    } else if (i.kind === '노무') {
      const lb = p.labors.find((x) => x.id === i.ref);
      if (lb) { name = lb.name; spec = ''; unit = '인'; price = Number(lb.wage) || 0; }
    }
    const amt = fl((Number(i.qty) || 0) * price);
    if (i.kind === '자재') m += amt; else if (i.kind === '노무') l += amt; else e += amt;
    return { ...i, name: name || '', spec, unit, price, amt, missing: (i.kind !== '경비') && !name };
  });
  const tool = fl(l * (Number(u.toolRate) || 0) / 100);
  e += tool;
  return { m: fl(m), l: fl(l), e: fl(e), tool, lines, total: fl(m) + fl(l) + fl(e) };
}

export function itemInfo(p, it) {
  if (it.src === 'unit') {
    const u = p.units.find((x) => x.id === it.ref);
    if (!u) return { name: '(삭제된 일위대가)', spec: '', unit: '', m: 0, l: 0, e: 0, link: '' };
    const c = unitCost(p, u);
    return { name: u.name, spec: u.spec, unit: u.unit, m: c.m, l: c.l, e: c.e, link: u.code };
  }
  if (it.src === 'mat') {
    const mt = p.mats.find((x) => x.id === it.ref);
    if (!mt) return { name: '(삭제된 자재)', spec: '', unit: '', m: 0, l: 0, e: 0, link: '' };
    return { name: mt.name, spec: mt.spec, unit: mt.unit, m: matPrice(mt), l: 0, e: 0, link: mt.code || '자재' };
  }
  return { name: it.name, spec: it.spec, unit: it.unit, m: Number(it.m) || 0, l: Number(it.l) || 0, e: Number(it.e) || 0, link: '' };
}

// factor: 단가 조정률(1 = 100%). 단가는 원 미만 절사.
// it.adj = { m, l, e }: 행별 단가 조정률(%, 기본 100). it.fix = { m, l, e }: 임의로 정한 금액(있으면 수량×단가 대신 사용).
export function itemRow(p, it, factor = 1) {
  const inf = itemInfo(p, it);
  const q = Number(it.qty) || 0;
  const adj = it.adj || {}, fix = it.fix || {};
  const part = (k) => {
    const rate = adj[k] == null ? 1 : Number(adj[k]) / 100;
    if (fix[k] != null && fix[k] !== '') {
      const a = fl(Number(fix[k]) * factor);
      return [q ? fl(a / q) : 0, a, true];
    }
    const u = fl(inf[k] * rate * factor);
    return [u, fl(q * u), false];
  };
  const [um, am, fm] = part('m'), [ul, al, flb] = part('l'), [ue, ae, fe] = part('e');
  const adjusted = ['m', 'l', 'e'].some((k) => adj[k] != null && Number(adj[k]) !== 100);
  return { ...inf, qty: q, um, ul, ue, up: um + ul + ue, am, al, ae, amt: am + al + ae, fixed: { m: fm, l: flb, e: fe }, adjusted, adj };
}

// 합계 금액을 재료비·노무비·경비 비율대로 나눈다. 끝수는 가장 큰 항목에 붙인다.
export function splitTotal(r, total) {
  const cur = { m: r.am, l: r.al, e: r.ae };
  const sum = cur.m + cur.l + cur.e;
  if (sum <= 0) return { m: total, l: 0, e: 0 };
  const out = { m: fl(total * cur.m / sum), l: fl(total * cur.l / sum), e: fl(total * cur.e / sum) };
  const big = ['m', 'l', 'e'].sort((a, b) => cur[b] - cur[a])[0];
  out[big] += total - (out.m + out.l + out.e);
  return out;
}

export function sectionTotals(p, factor = 1) {
  return p.sections.map((s) => {
    const rows = s.items.map((it) => itemRow(p, it, factor));
    const t = rows.reduce((a, r) => ({ m: a.m + r.am, l: a.l + r.al, e: a.e + r.ae }), { m: 0, l: 0, e: 0 });
    return { section: s, rows, ...t, sum: t.m + t.l + t.e };
  });
}

export function costSheet(p, { factor = 1, profitAdd = 0, roundUnit } = {}) {
  const secs = sectionTotals(p, factor);
  const DM = secs.reduce((a, s) => a + s.m, 0);
  const DL = secs.reduce((a, s) => a + s.l, 0);
  const ME = secs.reduce((a, s) => a + s.e, 0);
  const R = Object.fromEntries(p.rates.map((r) => [r.key, r]));
  const rnd = p.rateRound === 'round' ? (x) => Math.round(x + 1e-9) : fl;
  const v = (k, base) => (R[k] && R[k].on ? rnd(base * (Number(R[k].rate) || 0) / 100) : 0);
  const lb = (k, d) => R[k]?.label || d;

  const IM = v('indirectMat', DM);
  const scrap = Number(p.scrap) || 0;
  const M = DM + IM - scrap;
  const IL = v('indirectLabor', DL);
  const L = DL + IL;
  const sanjae = v('sanjae', L);
  const goyong = v('goyong', L);
  const health = v('health', DL);
  const pension = v('pension', DL);
  const care = v('care', health);
  const retire = v('retire', DL);
  const safety = v('safety', M + DL);
  const env = v('env', M + DL + ME);
  const etc = v('etc', M + L);
  const subGuar = v('subGuar', M + DL + ME);
  const machGuar = v('machGuar', ME);
  const E = ME + sanjae + goyong + health + pension + care + retire + safety + env + etc + subGuar + machGuar;
  const net = M + L + E;
  const gm = v('gm', net);
  const profit = v('profit', L + E + gm) + profitAdd;
  const damage = v('damage', net + gm + profit);
  const total = net + gm + profit + damage;
  const vat = v('vat', total);
  const raw = total + vat;
  const ru = Number(roundUnit ?? p.roundUnit) || 1;
  const grand = fl(raw / ru) * ru;

  const rr = (k) => (R[k] ? Number(R[k].rate) : 0);
  const on = (k) => R[k]?.on;
  const rows = [
    { g: '재료비', label: '직접재료비', amt: DM },
    on('indirectMat') && { g: '재료비', label: lb('indirectMat', '간접재료비'), amt: IM, note: `직접재료비 × ${rr('indirectMat')}%` },
    scrap ? { g: '재료비', label: '작업설·부산물 (△)', amt: -scrap } : null,
    { g: '재료비', label: '소계', amt: M, sub: true },
    { g: '노무비', label: '직접노무비', amt: DL },
    on('indirectLabor') && { g: '노무비', label: '간접노무비', amt: IL, note: `직접노무비 × ${rr('indirectLabor')}%` },
    { g: '노무비', label: '소계', amt: L, sub: true },
    { g: '경비', label: '기계경비 등 직접경비', amt: ME },
    on('sanjae') && { g: '경비', label: '산재보험료', amt: sanjae, note: `노무비 × ${rr('sanjae')}%` },
    on('goyong') && { g: '경비', label: '고용보험료', amt: goyong, note: `노무비 × ${rr('goyong')}%` },
    on('health') && { g: '경비', label: '국민건강보험료', amt: health, note: `직접노무비 × ${rr('health')}%` },
    on('pension') && { g: '경비', label: '국민연금보험료', amt: pension, note: `직접노무비 × ${rr('pension')}%` },
    on('care') && { g: '경비', label: '노인장기요양보험료', amt: care, note: `건강보험료 × ${rr('care')}%` },
    on('retire') && { g: '경비', label: '퇴직공제부금비', amt: retire, note: `직접노무비 × ${rr('retire')}%` },
    on('safety') && { g: '경비', label: '산업안전보건관리비', amt: safety, note: `(재료비+직접노무비) × ${rr('safety')}%` },
    on('env') && { g: '경비', label: '환경보전비', amt: env, note: `(재료비+직접노무비+기계경비) × ${rr('env')}%` },
    on('etc') && { g: '경비', label: '기타경비', amt: etc, note: `(재료비+노무비) × ${rr('etc')}%` },
    on('subGuar') && { g: '경비', label: '하도급대금지급보증서발급수수료', amt: subGuar, note: `(재료비+직접노무비+기계경비) × ${rr('subGuar')}%` },
    on('machGuar') && { g: '경비', label: '건설기계대여대금지급보증서발급수수료', amt: machGuar, note: `기계경비 × ${rr('machGuar')}%` },
    { g: '경비', label: '소계', amt: E, sub: true },
    { g: '순공사원가', label: '순공사원가', amt: net, sum: true, note: '재료비+노무비+경비' },
    on('gm') && { g: '일반관리비', label: '일반관리비', amt: gm, note: `순공사원가 × ${rr('gm')}%` },
    on('profit') && { g: '이윤', label: '이윤', amt: profit, note: `(노무비+경비+일반관리비) × ${rr('profit')}%${profitAdd ? ` ＋ 단수조정 ${profitAdd.toLocaleString()}` : ''}` },
    on('damage') && { g: '보험료', label: '공사손해보험료', amt: damage, note: `총원가 × ${rr('damage')}%` },
    { g: '총원가', label: '총공사원가', amt: total, sum: true },
    on('vat') && { g: '부가세', label: '부가가치세', amt: vat, note: `총공사원가 × ${rr('vat')}%` },
    ru > 1 && raw !== grand ? { g: '절사', label: `단수정리 (${ru.toLocaleString()}원 미만)`, amt: grand - raw } : null,
    { g: '도급액', label: '총 공사금액', amt: grand, sum: true, grand: true },
  ].filter(Boolean);

  return { secs, DM, DL, ME, M, L, E, net, gm, profit, total, vat, raw, grand, rows };
}

// 목표금액(부가세 포함)에 맞추는 단가 조정률을 찾고, 남는 차액은 이윤에서 맞춘다.
export function fitToTarget(p, target) {
  const base = costSheet(p, { roundUnit: 1 }).grand;
  if (!(target > 0) || !(base > 0)) return { factor: 1, profitAdd: 0 };
  let lo = 0, hi = Math.max(2, (target / base) * 1.5);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (costSheet(p, { factor: mid, roundUnit: 1 }).grand <= target) lo = mid; else hi = mid;
  }
  const factor = lo;
  const vatRate = p.rates.find((r) => r.key === 'vat');
  const k = vatRate && vatRate.on ? 1 + Number(vatRate.rate) / 100 : 1;
  let profitAdd = Math.floor((target - costSheet(p, { factor, roundUnit: 1 }).grand) / k);
  for (let i = 0; i < 6; i++) {
    const g = costSheet(p, { factor, profitAdd, roundUnit: 1 }).grand;
    if (g === target) break;
    profitAdd += g < target ? 1 : -1;
  }
  return { factor, profitAdd };
}

export const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');

export function hangulAmount(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (!n) return '영';
  const d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const s = ['', '십', '백', '천'];
  const big = ['', '만', '억', '조'];
  let out = '', g = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk) {
      let c = '', x = chunk, i = 0;
      while (x > 0) { const k = x % 10; if (k) c = d[k] + s[i] + c; x = Math.floor(x / 10); i++; }
      out = c + big[g] + out;
    }
    n = Math.floor(n / 10000); g++;
  }
  return out;
}
