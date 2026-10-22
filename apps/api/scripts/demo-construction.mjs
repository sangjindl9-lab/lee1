/**
 * 시연용 4단계 데이터 — 강서초 현장: 변경계약(승인), 선급금 수령, 1회 기성(승인·계산서·일부 수금), 2회 기성(결재 대기),
 * 하도급(한빛통신) 계약·기성, 작업자 4명과 작업일보(확정·미확정)
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api/v1';
const PW = process.env.DEMO_PASSWORD ?? 'Demo!2026erp';

async function session(loginId) {
  const cookies = {};
  const call = async (method, path, body) => {
    const headers = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookies.erp_csrf ?? '');
    if (call.companyId) headers['x-company-id'] = call.companyId;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      cookies[k] = v;
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  await call('POST', '/auth/login', { loginId, password: PW });
  const me = await call('GET', '/auth/me');
  call.companyId = me.companies.find((c) => c.code === 'SS').id;
  return call;
}

const admin = await session('admin');
const ceo = await session('ceo');
const acct = await session('acct');
const kst = (d = 0) => new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10);
const today = kst();
const approveAll = async (approvalId) => {
  for (const who of [acct, ceo, admin]) {
    const a = await who('GET', `/approvals/${approvalId}`);
    if (a.status !== 'PENDING') return;
    await who('POST', `/approvals/${a.id}/act`, { action: 'approve', version: a.version }).catch(() => undefined);
  }
};

const projects = (await admin('GET', '/projects?size=50')).rows;
const gs = projects.find((p) => p.name.includes('강서초'));
const vendors = (await admin('GET', '/vendors?size=50')).rows;
const V = (n) => vendors.find((v) => v.name.includes(n));
const edu = V('강서교육'), sub = V('한빛통신');
const bank = (await acct('GET', '/bank-accounts')).find?.((b) => b.kind === 'BANK') ?? (await acct('GET', '/bank-accounts')).rows?.find((b) => b.kind === 'BANK');

// 현장에 발주처·선급금·유보율 지정
const pd = await admin('GET', `/projects/${gs.id}`);
await admin('PUT', `/projects/${gs.id}`, { ...pd, vatAmount: null, progressRate: Number(pd.progressPercent), jointShareRate: null, clientVendorId: edu.id, clientName: edu.name, advanceAmount: String(Math.floor(Number(pd.supplyAmount) * 0.2)), retentionPercent: 3, version: pd.version });

// 1) 변경계약 (설계변경 증액) — 승인
const supply = Number(pd.supplyAmount);
const rev = await admin('POST', '/contract-revisions', { projectId: gs.id, revisionDate: kst(-20), reason: '설계변경 — 급식실 분전반 2면 추가, 간선 경로 변경', deltaAmount: String(Math.floor(supply * 0.06 / 10000) * 10000), budgetLines: [] });
const rs = await admin('POST', `/contract-revisions/${rev.id}/submit`, { version: rev.version });
await approveAll(rs.approvalId);

// 2) 선급금 수령
const adv = Math.floor(supply * 0.2);
await acct('POST', '/collections', { kind: 'ADVANCE', projectId: gs.id, vendorId: edu.id, collectDate: kst(-40), amount: String(adv), bankAccountId: bank?.id ?? null, memo: '선급금 (계약금액의 20%)' });

// 3) 1회 기성 — 승인 → 세금계산서(가상 발행) → 일부 수금
const lines1 = [
  { name: '수변전 설비', contractAmount: String(Math.floor(supply * 0.35)), thisAmount: String(Math.floor(supply * 0.12)) },
  { name: '간선·동력 설비', contractAmount: String(Math.floor(supply * 0.3)), thisAmount: String(Math.floor(supply * 0.1)) },
  { name: '전등·전열 설비', contractAmount: String(Math.floor(supply * 0.25)), thisAmount: String(Math.floor(supply * 0.06)) },
];
const this1 = lines1.reduce((a, l) => a + Number(l.thisAmount), 0);
const c1 = await admin('POST', '/progress-claims', { projectId: gs.id, vendorId: edu.id, claimDate: kst(-15), dueDate: kst(-1), periodFrom: kst(-45), periodTo: kst(-16), advanceDeduction: String(Math.floor(adv * this1 / supply)), retentionRate: '0.03', lines: lines1 });
const s1 = await admin('POST', `/progress-claims/${c1.id}/submit`, { version: c1.version });
await approveAll(s1.approvalId);
const inv = await acct('POST', `/progress-claims/${c1.id}/tax-invoice`);
const invd = await acct('GET', `/tax-invoices/${inv.id}`);
const isub = await acct('POST', `/tax-invoices/${inv.id}/submit`, { version: invd.version });
await approveAll(isub.approvalId);
const ready = await acct('GET', `/tax-invoices/${inv.id}`);
await acct('POST', `/tax-invoices/${inv.id}/issue`, { version: ready.version });
const c1d = await admin('GET', `/progress-claims/${c1.id}`);
await acct('POST', '/collections', { kind: 'CLAIM', claimId: c1.id, collectDate: kst(-3), amount: String(Math.floor(Number(c1d.receivableAmount) * 0.6)), bankAccountId: bank?.id ?? null, memo: '1회 기성 1차 입금' });

// 4) 2회 기성 — 대표 결재 대기
const c2 = await admin('POST', '/progress-claims', { projectId: gs.id, vendorId: edu.id, claimDate: today, dueDate: kst(30), periodFrom: kst(-15), periodTo: today, retentionRate: '0.03', advanceDeduction: String(Math.floor(adv * supply * 0.15 / supply)), lines: lines1.map((l) => ({ ...l, thisAmount: String(Math.floor(Number(l.thisAmount) * 0.8)) })) });
await admin('POST', `/progress-claims/${c2.id}/submit`, { version: c2.version });

// 5) 하도급 — 정보통신 배관·배선 (진행), 1회 기성 승인
if (sub) {
  const sc = await admin('POST', '/subcontracts', { projectId: gs.id, vendorId: sub.id, title: '정보통신 배관·배선 공사', contractDate: kst(-35), startDate: kst(-30), endDate: kst(60), amount: String(Math.floor(supply * 0.12 / 10000) * 10000), retentionRate: '0.05', guaranteeType: '계약이행보증', guaranteeNo: 'SG-2026-104233', guaranteeAmount: String(Math.floor(supply * 0.012)), guaranteeExpiry: kst(120), scope: '본관·별관 통신 배관, UTP Cat.6 배선, 단자함 설치' });
  const ss = await admin('POST', `/subcontracts/${sc.id}/submit`, { version: sc.version });
  await approveAll(ss.approvalId);
  const scl = await admin('POST', `/subcontracts/${sc.id}/claims`, { claimDate: kst(-5), thisAmount: String(Math.floor(supply * 0.12 * 0.4 / 1000) * 1000), memo: '배관 완료분' });
  const sss = await admin('POST', `/subcontracts/claims/${scl.id}/submit`, { version: scl.version });
  await approveAll(sss.approvalId);
}

// 6) 작업자·작업일보
const workers = [];
for (const w of [{ name: '김전공', trade: '내선전공', dailyWage: '285000', bankName: '농협', bankAccount: '302-1234-5678-91' }, { name: '이배선', trade: '내선전공', dailyWage: '285000' }, { name: '박통신', trade: '통신내선공', dailyWage: '262000' }, { name: '최인부', trade: '보통인부', dailyWage: '172000' }]) {
  workers.push((await admin('POST', '/labor/workers', w)).id);
}
for (let d = 6; d >= 1; d--) {
  const date = kst(-d);
  const dow = new Date(date).getUTCDay();
  if (dow === 0) continue;
  await admin('POST', '/labor/records', { projectId: gs.id, workDate: date, entries: workers.map((id, i) => ({ workerId: id, manDays: i === 3 && d % 2 ? '0.5' : '1', overtimeHours: d === 2 && i < 2 ? '2' : '0', workType: i === 2 ? '통신 입선' : '분전반 결선' })) }).catch(() => undefined);
}
const recs = (await acct('GET', `/labor/records?projectId=${gs.id}&from=${kst(-7)}&to=${kst(-3)}`)).rows.filter((r) => r.status === 'RECORDED').map((r) => r.id);
if (recs.length) await acct('POST', '/labor/records/confirm', { ids: recs });
console.log('시연용 공사관리: 변경계약 1, 기성 2(1회 일부 수금), 하도급 1, 작업자 4·작업일보');
