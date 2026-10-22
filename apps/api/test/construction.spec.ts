/** 4단계: 변경계약·기성·수금·하도급·노무·준공정산 — 시나리오 C, 필수 #8·#9·#10 */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { sql } from 'drizzle-orm';
import { Agent, agentFor, setupWorld, testDb, World } from './helpers';

let w: World;
let admin: Agent, ceo: Agent, acct: Agent, site: Agent;
let projectId: string, clientId: string, subVendorId: string, bankId: string;
const acc: Record<string, string> = {};
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

async function approve(ag: Agent, approvalId: string) {
  const a = (await ag.get(`/approvals/${approvalId}`)).body;
  const r = await ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}
async function journalSum(sourceType: string, sourceId: string, code: string) {
  const { db, pool } = testDb();
  const r = (await db.execute(sql`select coalesce(sum(l.debit - l.credit),0)::text s from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.source_type = ${sourceType} and e.source_id = ${sourceId} and a.code = ${code} and e.status <> 'VOID'`)).rows[0] as { s: string };
  await pool.end();
  return Number(r.s);
}
const pl = async () => (await acct.get(`/project-pl/${projectId}`)).body;

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  acct = await agentFor(w, 'a.acct', w.A.id);
  site = await agentFor(w, 'a.site', w.A.id);
  clientId = (await admin.post('/vendors', { name: '서울교육청', bizRegNo: '214-83-00432', vendorType: 'CLIENT' })).body.id;
  subVendorId = (await admin.post('/vendors', { name: '한빛통신기술', bizRegNo: '107-81-63213', vendorType: 'SUBCONTRACTOR' })).body.id;
  const p = await admin.post('/projects', { name: '기성 테스트 학교', tradeType: 'ELECTRIC', supplyAmount: '100000000', status: 'IN_PROGRESS', clientVendorId: clientId, advanceAmount: '20000000', retentionPercent: 5 });
  if (p.status !== 201) throw new Error(JSON.stringify(p.body));
  projectId = p.body.id;
  for (const a of (await acct.get('/accounts')).body) acc[a.code] = a.id;
  bankId = (await acct.post('/bank-accounts', { kind: 'BANK', name: '운영계좌', bankName: '국민은행', accountNo: '123-456-789', openingBalance: '0', openingDate: today })).body.id;
});
afterAll(async () => {
  await w.app.close();
});

describe('변경계약 — 최초계약 보존, 승인 전 미확정', () => {
  let revId: string;
  it('증액 변경계약을 작성해도 결재 전에는 확정 계약금액이 그대로', async () => {
    const r = await admin.post('/contract-revisions', { projectId, revisionDate: today, reason: '설계변경 — 분전반 추가', deltaAmount: '10000000' });
    expect(r.status).toBe(201);
    revId = r.body.id;
    expect(r.body.beforeSupply).toBe('100000000.00');
    expect(r.body.afterSupply).toBe('110000000.00');
    const s = (await pl()).revenue;
    expect(s.contractCurrent).toBe('100000000.00');
    expect(s.contractPending).toBe('10000000.00');
    // 처리 중인 변경계약이 있으면 또 만들 수 없다
    expect((await admin.post('/contract-revisions', { projectId, revisionDate: today, reason: '두 번째', deltaAmount: '1' })).body.code).toBe('OPEN_REVISION');
    // 기성·변경계약이 생긴 현장은 현장 화면에서 계약금액을 못 바꾼다
    const pj = (await admin.get(`/projects/${projectId}`)).body;
    const up = await admin.put(`/projects/${projectId}`, { ...pj, name: pj.name, tradeType: pj.tradeType, supplyAmount: '120000000', vatAmount: null, version: pj.version, progressRate: 0, jointShareRate: null });
    expect(up.body.code).toBe('USE_REVISION');
  });

  it('대표 결재 후 확정 계약금액 = 최초 + 증액, 최초계약은 보존', async () => {
    const r = (await admin.get(`/contract-revisions/${revId}`)).body;
    const s = await admin.post(`/contract-revisions/${revId}/submit`, { version: r.version });
    await approve(ceo, s.body.approvalId);
    const rev = (await pl()).revenue;
    expect(rev.contractOriginal).toBe('100000000.00');
    expect(rev.contractCurrent).toBe('110000000.00');
    expect((await admin.get(`/projects/${projectId}`)).body.supplyAmount).toBe('100000000.00');
  });
});

describe('시나리오 C: 공사 기성 → 세금계산서 → 수금 → 미수금 감소 → 현장 손익', () => {
  let claimId: string;
  it('선급금 수령 (매출 아님, 공사선수금)', async () => {
    const r = await acct.post('/collections', { kind: 'ADVANCE', projectId, collectDate: today, amount: '20000000', bankAccountId: bankId });
    expect(r.status).toBe(201);
    expect(await journalSum('COLLECTION', r.body.id, '259')).toBe(-20000000);
    const rev = (await pl()).revenue;
    expect(rev.recognized).toBe('0.00');
    expect(rev.advanceBalance).toBe('20000000.00');
  });

  it('기성 작성: 전회·금회·누적·기성률·선급금 공제·유보금 자동 계산', async () => {
    const prep = (await admin.get(`/progress-claims/prepare?projectId=${projectId}`)).body;
    expect(prep.contract.current).toBe('110000000.00');
    expect(prep.advanceBalance).toBe('20000000.00');
    const r = await admin.post('/progress-claims', {
      projectId, vendorId: clientId, claimDate: today, dueDate: today, advanceDeduction: '6000000', retentionRate: '0.05',
      lines: [{ name: '간선 설비', contractAmount: '60000000', thisAmount: '20000000' }, { name: '분전반', contractAmount: '50000000', thisAmount: '10000000' }],
    });
    expect(r.status).toBe(201);
    claimId = r.body.id;
    expect(r.body.claimNo).toBe(1);
    expect(r.body.thisSupply).toBe('30000000.00');
    expect(r.body.vatAmount).toBe('3000000.00');
    expect(r.body.retentionAmount).toBe('1500000.00');
    expect(r.body.receivableAmount).toBe('25500000.00'); // 3000만 + 300만 − 600만 − 150만
    expect(r.body.progressRate).toBe('0.2727');
  });

  it('계약금액·공종 계약금액·선급금 잔액을 넘는 기성은 거부', async () => {
    expect((await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '90000000' })).body.code).toBe('OVER_CONTRACT');
    expect((await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, lines: [{ name: '분전반', contractAmount: '50000000', thisAmount: '45000000' }] })).body.code).toBe('LINE_OVER');
    expect((await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '1000000', advanceDeduction: '15000000' })).body.code).toBe('ADVANCE_OVER');
  });

  it('[필수9] 승인 전에는 매출 0, 승인하면 매출 인식 (수금과 무관)', async () => {
    expect((await pl()).revenue.recognized).toBe('0.00');
    const c = (await admin.get(`/progress-claims/${claimId}`)).body;
    const s = await admin.post(`/progress-claims/${claimId}/submit`, { version: c.version });
    await approve(ceo, s.body.approvalId);
    const rev = (await pl()).revenue;
    expect(rev.recognized).toBe('30000000.00');
    expect(rev.collected).toBe('0.00');
    expect(rev.receivable).toBe('25500000.00');
    expect(await journalSum('CLAIM', claimId, '404')).toBe(-30000000);
    expect(await journalSum('CLAIM', claimId, '108')).toBe(22500000);
    expect(await journalSum('CLAIM', claimId, '259')).toBe(6000000);
    expect(await journalSum('CLAIM', claimId, '109')).toBe(1500000);
  });

  it('기성청구서 PDF 출력', async () => {
    const res = await admin.req('get', `/progress-claims/${claimId}/pdf`).buffer(true).parse((r, cb) => {
      const ch: Buffer[] = [];
      r.on('data', (c: Buffer) => ch.push(c));
      r.on('end', () => cb(null, Buffer.concat(ch)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('기성으로 매출 세금계산서 → 결재 → 발행(테스트) → 기성 상태 "계산서 발행"', async () => {
    const t = await acct.post(`/progress-claims/${claimId}/tax-invoice`);
    expect(t.status).toBe(200);
    expect((await acct.post(`/progress-claims/${claimId}/tax-invoice`)).status).toBe(409);
    const inv = (await acct.get(`/tax-invoices/${t.body.id}`)).body;
    expect(inv.supplyAmount).toBe('30000000.00');
    expect(inv.claimId).toBe(claimId);
    const s = await acct.post(`/tax-invoices/${t.body.id}/submit`, { version: inv.version });
    await approve(acct, s.body.approvalId);
    const ready = (await acct.get(`/tax-invoices/${t.body.id}`)).body;
    const issued = await acct.post(`/tax-invoices/${t.body.id}/issue`, { version: ready.version });
    expect(issued.body.ntsStatus).toBe('NOT_SENT');
    expect((await admin.get(`/progress-claims/${claimId}`)).body.status).toBe('INVOICED');
    // 매출 인식은 기성 승인 때 한 번만 (계산서 발행으로 매출이 두 번 잡히지 않는다)
    expect((await pl()).revenue.recognized).toBe('30000000.00');
  });

  it('수금 매칭: 일부 수금 → 미수금 감소, 남은 금액 초과 수금 거부, 완납 → 수금 완료', async () => {
    const a = await acct.post('/collections', { kind: 'CLAIM', claimId, collectDate: today, amount: '15000000', bankAccountId: bankId });
    expect(a.status).toBe(201);
    let c = (await admin.get(`/progress-claims/${claimId}`)).body;
    expect(c.status).toBe('PARTIAL');
    expect(c.outstanding).toBe('10500000.00');
    expect((await pl()).revenue.receivable).toBe('10500000.00');
    expect((await acct.post('/collections', { kind: 'CLAIM', claimId, collectDate: today, amount: '10500001' })).body.code).toBe('OVER_COLLECT');
    await acct.post('/collections', { kind: 'CLAIM', claimId, collectDate: today, amount: '10500000', bankAccountId: bankId });
    c = (await admin.get(`/progress-claims/${claimId}`)).body;
    expect(c.status).toBe('COLLECTED');
    const rev = (await pl()).revenue;
    expect(rev.collected).toBe('25500000.00');
    expect(rev.receivable).toBe('0.00');
    expect(rev.recognized).toBe('30000000.00'); // 수금해도 매출은 그대로
  });

  it('[필수10] 같은 기성에 동시에 수금을 넣어도 청구액을 넘지 않는다', async () => {
    const c2 = await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '10000000' });
    const s = await admin.post(`/progress-claims/${c2.body.id}/submit`, { version: c2.body.version });
    await approve(ceo, s.body.approvalId);
    const res = await Promise.all([1, 2, 3].map(() => acct.post('/collections', { kind: 'CLAIM', claimId: c2.body.id, collectDate: today, amount: '11000000' })));
    expect(res.filter((r) => r.status === 201).length).toBe(1);
    const d = (await admin.get(`/progress-claims/${c2.body.id}`)).body;
    expect(d.collected).toBe('11000000.00');
    expect(d.status).toBe('COLLECTED');
  });

  it('[필수10] 같은 기성 결재를 두 사람이 동시에 승인해도 매출 분개는 한 번', async () => {
    const c3 = await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '5000000' });
    const s = await admin.post(`/progress-claims/${c3.body.id}/submit`, { version: c3.body.version });
    const a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
    const res = await Promise.all([ceo, ceo].map((ag) => ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version })));
    expect(res.filter((r) => r.status === 200).length).toBe(1);
    expect(await journalSum('CLAIM', c3.body.id, '404')).toBe(-5000000);
  });

  it('수금 취소는 역분개하고 기성 상태를 되돌린다', async () => {
    const list = (await acct.get(`/collections?projectId=${projectId}`)).body;
    const last = list.find((x: any) => x.kind === 'CLAIM' && x.amount === '10500000.00');
    const r = await acct.post(`/collections/${last.id}/cancel`, { reason: '이중 입력' });
    expect(r.status).toBe(200);
    expect((await admin.get(`/progress-claims/${claimId}`)).body.status).toBe('PARTIAL');
    expect(await journalSum('COLLECTION', last.id, '108')).toBe(0);
    const rec = (await acct.get('/collections/receivables')).body.find((x: any) => x.project_id === projectId);
    expect(rec.outstanding).toBe('16000000.00'); // 1회 남은 1050만 + 3회 미수 550만
  });
});

describe('하도급 — 계약·변경·기성·지급·정산', () => {
  let scId: string, scClaimId: string;
  it('계약 작성 → 대표 결재 → 진행, 발주확정(외주비)에 반영', async () => {
    const r = await admin.post('/subcontracts', { projectId, vendorId: subVendorId, title: '통신 배관·배선 공사', contractDate: today, amount: '20000000', retentionRate: '0.05' });
    expect(r.status).toBe(201);
    scId = r.body.id;
    const s = await admin.post(`/subcontracts/${scId}/submit`, { version: r.body.version });
    await approve(ceo, s.body.approvalId);
    const d = (await admin.get(`/subcontracts/${scId}`)).body;
    expect(d.status).toBe('ACTIVE');
    const c04 = (await pl()).rows.find((x: any) => x.code === 'C04');
    expect(c04.committed).toBe('20000000.00');
    expect(c04.actual).toBe('0.00');
  });

  it('변경계약 이력: 최초금액 보존, 현재금액 변경', async () => {
    const d = (await admin.get(`/subcontracts/${scId}`)).body;
    const r = await admin.post(`/subcontracts/${scId}/revise`, { revisionDate: today, deltaAmount: '2000000', reason: '물량 증가', version: d.version });
    expect(r.status).toBe(200);
    expect(r.body.originalAmount).toBe('20000000.00');
    expect(r.body.currentAmount).toBe('22000000.00');
  });

  it('하도급 기성 승인 → 원가 발생 (외주비/외상매입금·유보금), 계약 초과 기성 거부', async () => {
    expect((await admin.post(`/subcontracts/${scId}/claims`, { claimDate: today, thisAmount: '23000000' })).body.code).toBe('OVER_CONTRACT');
    const c = await admin.post(`/subcontracts/${scId}/claims`, { claimDate: today, thisAmount: '22000000' });
    expect(c.status).toBe(201);
    scClaimId = c.body.id;
    expect(c.body.retentionAmount).toBe('1100000.00');
    expect(c.body.payableAmount).toBe('23100000.00'); // 2200만 + 220만 − 110만
    const s = await admin.post(`/subcontracts/claims/${scClaimId}/submit`, { version: c.body.version });
    await approve(acct, s.body.approvalId);
    await approve(ceo, s.body.approvalId);
    expect(await journalSum('SUB_CLAIM', scClaimId, '504')).toBe(22000000);
    expect(await journalSum('SUB_CLAIM', scClaimId, '264')).toBe(-1100000);
    expect(await journalSum('SUB_CLAIM', scClaimId, '251')).toBe(-23100000);
    expect((await pl()).rows.find((x: any) => x.code === 'C04').actual).toBe('22000000.00');
  });

  it('지급결의(원천: 하도급 기성)는 유보금을 뺀 금액, 두 번 넣을 수 없음', async () => {
    const r = await acct.post('/payment-requests', { kind: 'SUBCONTRACT', title: '통신 외주 1회 기성', requestDate: today, vendorId: subVendorId, lines: [{ sourceType: 'SUB_CLAIM', sourceId: scClaimId }] });
    expect(r.status).toBe(201);
    expect(r.body.totalAmount).toBe('23100000.00');
    expect((await acct.post('/payment-requests', { kind: 'SUBCONTRACT', title: 'x', requestDate: today, vendorId: subVendorId, lines: [{ sourceType: 'SUB_CLAIM', sourceId: scClaimId }] })).status).toBe(409);
  });

  it('정산 완료 → 유보금 지급결의 가능', async () => {
    const r = await admin.post(`/subcontracts/${scId}/complete`);
    expect(r.body.status).toBe('COMPLETED');
    const src = (await acct.get(`/payment-requests/sources?type=SUB_RETENTION&vendorId=${subVendorId}`)).body;
    expect(src[0].retention).toBe('1100000.00');
    const p = await acct.post('/payment-requests', { kind: 'SUBCONTRACT', title: '유보금', requestDate: today, vendorId: subVendorId, lines: [{ sourceType: 'SUB_RETENTION', sourceId: scId }] });
    if (p.status !== 201) throw new Error(JSON.stringify(p.body));
    expect(p.body.totalAmount).toBe('1100000.00');
  });
});

describe('노무비 — 개인정보 보호, 작업일보, 확정·지급', () => {
  let workerId: string;
  it('주민번호·계좌는 가린 값만, 원문 열람은 권한자·사유·감사로그', async () => {
    const r = await admin.post('/labor/workers', { name: '김전공', trade: '전공', residentNo: '800101-1234567', bankName: '농협', bankAccount: '302-1234-5678-91', dailyWage: '250000' });
    expect(r.status).toBe(201);
    workerId = r.body.id;
    const list = (await site.get('/labor/workers')).body;
    const wk = list.find((x: any) => x.id === workerId);
    expect(wk.residentNoMask).toBe('800101-1******');
    expect(JSON.stringify(list)).not.toContain('1234567');
    expect(JSON.stringify(list)).not.toContain('302-1234-5678-91');
    expect((await site.post(`/labor/workers/${workerId}/reveal`, { field: 'residentNo', reason: '신고' })).status).toBe(403);
    const rv = await acct.post(`/labor/workers/${workerId}/reveal`, { field: 'residentNo', reason: '근로내용확인신고' });
    expect(rv.body.value).toBe('8001011234567');
    const { db, pool } = testDb();
    const raw = (await db.execute(sql`select resident_no_enc from labor_worker where id = ${workerId}`)).rows[0] as { resident_no_enc: string };
    await pool.end();
    expect(raw.resident_no_enc).not.toContain('8001011234567');
  });

  it('작업일보: 노무비 = 일당×공수 + 일당/8×연장×1.5, 같은 날 중복 기록 거부', async () => {
    const r = await admin.post('/labor/records', { projectId, workDate: today, entries: [{ workerId, manDays: '1', overtimeHours: '2' }] });
    expect(r.status).toBe(201);
    const recs = (await admin.get(`/labor/records?projectId=${projectId}`)).body;
    expect(recs.rows[0].amount).toBe('343750.00'); // 250000 + 31250×2×1.5
    expect((await admin.post('/labor/records', { projectId, workDate: today, entries: [{ workerId, manDays: '0.5' }] })).status).toBe(409);
  });

  it('확정 → (직접노무비 / 미지급비용) 분개, 지급결의 원천 노무비', async () => {
    const recs = (await admin.get(`/labor/records?projectId=${projectId}`)).body.rows;
    const c = await acct.post('/labor/records/confirm', { ids: recs.map((r: any) => r.id) });
    expect(c.status).toBe(200);
    expect((await pl()).rows.find((x: any) => x.code === 'C02').actual).toBe('343750.00');
    const pr = await acct.post('/payment-requests', { kind: 'LABOR', title: '일용 노무비', requestDate: today, projectId, payeeName: '김전공', lines: [{ sourceType: 'LABOR', sourceId: recs[0].id }] });
    expect(pr.status).toBe(201);
    expect((await acct.post(`/labor/records/${recs[0].id}/unconfirm`, { reason: '수정' })).body.code).toBe('IN_PAYMENT');
  });
});

describe('준공정산', () => {
  it('결재 중인 문서가 있으면 정산 불가, 미결 사항은 확인 체크가 있어야 정산', async () => {
    const c = await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '1000000' });
    await admin.post(`/progress-claims/${c.body.id}/submit`, { version: c.body.version });
    const pv = (await acct.get(`/projects/${projectId}/settlement`)).body;
    expect(pv.canSettle).toBe(false);
    expect((await acct.post(`/projects/${projectId}/settlement`, { acknowledge: true })).body.code).toBe('BLOCKED');
    const a = (await admin.get(`/progress-claims/${c.body.id}`)).body;
    await admin.post(`/approvals/${a.approval.id}/cancel`);
    await admin.post(`/progress-claims/${c.body.id}/cancel`, { reason: '정산 전 정리' });
    expect((await acct.post(`/projects/${projectId}/settlement`, {})).body.code).toBe('NEED_ACK');
    const ok = await acct.post(`/projects/${projectId}/settlement`, { acknowledge: true, memo: '유보금 미수 확인' });
    expect(ok.status).toBe(200);
    expect(ok.body.finalContract).toBe('110000000.00');
    expect((await admin.get(`/projects/${projectId}`)).body.status).toBe('SETTLED');
  });

  it('정산된 현장에는 기성·하도급·노무를 더 넣을 수 없고, 사유와 함께 다시 열 수 있다', async () => {
    expect((await admin.post('/progress-claims', { projectId, vendorId: clientId, claimDate: today, thisSupply: '1000' })).body.code).toBe('SETTLED');
    expect((await admin.post('/contract-revisions', { projectId, revisionDate: today, reason: '추가', deltaAmount: '1000' })).body.code).toBe('SETTLED');
    const r = await acct.post(`/projects/${projectId}/settlement/reopen`, { reason: '하자보수비 추가 반영' });
    expect(r.status).toBe(200);
    expect((await admin.get(`/projects/${projectId}`)).body.status).toBe('COMPLETED');
  });
});

describe('[필수8] 현장별 손익 정확성 (4단계 반영)', () => {
  it('매출(기성 승인) − 발생원가 = 현재 손익, 다른 현장과 섞이지 않는다', async () => {
    const s = await pl();
    const recognized = Number(s.revenue.recognized);
    const actual = Number(s.totals.actual);
    expect(recognized).toBe(30000000 + 10000000 + 5000000);
    expect(actual).toBe(22000000 + 343750);
    expect(Number(s.forecast.currentProfit)).toBe(recognized - actual);
    const other = (await admin.post('/projects', { name: '다른 현장', tradeType: 'TELECOM', supplyAmount: '5000000', status: 'IN_PROGRESS' })).body.id;
    const o = (await acct.get(`/project-pl/${other}`)).body;
    expect(o.revenue.recognized).toBe('0.00');
    expect(o.totals.actual).toBe('0.00');
  });
});
