/** 2단계-B: 복식부기·지급결의·실행예산·현장 손익·월마감 — 실제 PostgreSQL */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { sql } from 'drizzle-orm';
import { Agent, agentFor, assign, setupWorld, testDb, World } from './helpers';

let w: World;
let admin: Agent, ceo: Agent, acct: Agent, buyer: Agent, site: Agent, tax: Agent;
let projectId: string, otherProjectId: string, vendorId: string;
const acc: Record<string, string> = {};
const cc: Record<string, string> = {};
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

async function approve(ag: Agent, approvalId: string) {
  const a = (await ag.get(`/approvals/${approvalId}`)).body;
  const r = await ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

async function receivedPo(supplyQty = '100', price = '10000', over: Record<string, unknown> = {}) {
  const p = (await buyer.post('/purchase-orders', { projectId, vendorId, title: '전선 자재', orderDate: today, lines: [{ name: 'F-CV', unit: 'm', qty: supplyQty, unitPrice: price }], ...over })).body;
  const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
  await approve(ceo, s.body.approvalId);
  const d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
  const r = await buyer.post(`/purchase-orders/${p.id}/receipts`, { receiptDate: today, lines: [{ poLineId: d.lines[0].id, qty: supplyQty }] });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { po: d, receipt: r.body };
}

/** 지급결의 작성 → 상신 → 회계관리자 검토 → 대표이사 승인 */
async function approvedRequest(body: Record<string, unknown>) {
  const r = await acct.post('/payment-requests', body);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  const s = await acct.post(`/payment-requests/${r.body.id}/submit`, { version: r.body.version });
  await approve(acct, s.body.approvalId);
  await approve(ceo, s.body.approvalId);
  return (await acct.get(`/payment-requests/${r.body.id}`)).body;
}

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  acct = await agentFor(w, 'a.acct', w.A.id);
  buyer = await agentFor(w, 'a.buyer', w.A.id);
  site = await agentFor(w, 'a.site', w.A.id);
  tax = await agentFor(w, 'a.tax', w.A.id);
  projectId = (await admin.post('/projects', { name: '원가 테스트 현장', tradeType: 'ELECTRIC', supplyAmount: '100000000', status: 'IN_PROGRESS' })).body.id;
  otherProjectId = (await admin.post('/projects', { name: '다른 현장', tradeType: 'TELECOM', supplyAmount: '1000000', status: 'IN_PROGRESS' })).body.id;
  vendorId = (await admin.post('/vendors', { name: '대한전기자재', bizRegNo: '124-81-00998' })).body.id;
  await assign(w.ids['a.site'].membershipId, projectId);
  for (const a of (await acct.get('/accounts')).body) acc[a.code] = a.id;
  for (const c of (await acct.get('/cost-codes')).body) cc[c.code] = c.id;
});
afterAll(async () => {
  await w.app.close();
});

describe('회계 기본값', () => {
  it('회사마다 계정과목·원가항목 12종·자동분개 규칙이 준비된다', async () => {
    expect(acc['101'] && acc['103'] && acc['251'] && acc['404'] && acc['501']).toBeTruthy();
    expect(Object.keys(cc)).toEqual(expect.arrayContaining(['C01', 'C02', 'C04', 'C11']));
    const rules = (await acct.get('/posting-rules')).body;
    expect(rules.every((r: any) => r.accountId)).toBe(true);
  });
});

describe('[필수6] 복식부기 차변·대변 일치', () => {
  it('차대가 맞지 않는 전표는 서버에서 거부', async () => {
    const r = await acct.post('/journal-entries', { entryDate: today, description: '불일치', lines: [{ accountId: acc['812'], debit: '10000' }, { accountId: acc['101'], credit: '9000' }] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('JOURNAL_UNBALANCED');
  });

  it('한 줄에 차변·대변을 함께 넣거나 한 줄짜리 전표는 거부', async () => {
    expect((await acct.post('/journal-entries', { entryDate: today, description: 'x', lines: [{ accountId: acc['812'], debit: '1', credit: '1' }, { accountId: acc['101'], credit: '0' }] })).status).toBe(400);
    expect((await acct.post('/journal-entries', { entryDate: today, description: 'x', lines: [{ accountId: acc['812'], debit: '1' }] })).status).toBe(400);
  });

  it('DB 를 직접 고쳐도 차대가 맞지 않으면 저장되지 않는다 (지연 제약 트리거)', async () => {
    const ok = await acct.post('/journal-entries', { entryDate: today, description: '여비', lines: [{ accountId: acc['812'], debit: '50000' }, { accountId: acc['101'], credit: '50000' }] });
    expect(ok.status).toBe(201);
    const { pool, db } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`update journal_line set debit = 60000 where entry_id = ${ok.body.id} and line_no = 1`);
    } catch (e) {
      err = e;
    }
    await pool.end();
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/차변 합계/);
  });

  it('현장 필수 계정(공사원가)은 현장 없이 쓸 수 없다', async () => {
    const r = await acct.post('/journal-entries', { entryDate: today, description: '자재', lines: [{ accountId: acc['501'], debit: '1000' }, { accountId: acc['101'], credit: '1000' }] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NEEDS_PROJECT');
  });
});

describe('[필수7] 전표 승인·취소·역분개', () => {
  it('승인된 전표는 수정 불가, 역분개하면 원전표는 역분개됨·반대 전표가 생기고 잔액이 0으로 돌아온다', async () => {
    const e = (await acct.post('/journal-entries', { entryDate: today, description: '소모품 구입', lines: [{ accountId: acc['830'], debit: '33000' }, { accountId: acc['101'], credit: '33000' }] })).body;
    const ap = await acct.post('/journal-entries/approve', { ids: [e.id] });
    expect(ap.body.approved).toBe(1);
    const upd = await acct.put(`/journal-entries/${e.id}`, { version: e.version + 1, entryDate: today, description: '변경', lines: [{ accountId: acc['830'], debit: '1' }, { accountId: acc['101'], credit: '1' }] });
    if (upd.status !== 409) throw new Error(JSON.stringify(upd.body));
    // DB 직접 수정도 차단
    const { pool, db } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`update journal_line set memo = 'x' where entry_id = ${e.id}`);
    } catch (x) {
      err = x;
    }
    let err2: any = null;
    try {
      await db.execute(sql`delete from journal_entry where id = ${e.id}`);
    } catch (x) {
      err2 = x;
    }
    await pool.end();
    expect(String(err?.cause?.message)).toMatch(/승인된 전표/);
    expect(String(err2?.cause?.message)).toMatch(/삭제할 수 없습니다/);

    const before = (await acct.get(`/ledger/account?accountId=${acc['830']}&from=${today}&to=${today}`)).body.closing;
    const rv = await acct.post(`/journal-entries/${e.id}/reverse`, { reason: '잘못 입력' });
    expect(rv.status).toBe(200);
    const orig = (await acct.get(`/journal-entries/${e.id}`)).body;
    expect(orig.status).toBe('REVERSED');
    expect(orig.reversedBy.code).toBe(rv.body.reversalCode);
    const rev = (await acct.get(`/journal-entries/${rv.body.reversalId}`)).body;
    expect(rev.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([['830', '0.00', '33000.00'], ['101', '33000.00', '0.00']]);
    const after = (await acct.get(`/ledger/account?accountId=${acc['830']}&from=${today}&to=${today}`)).body.closing;
    expect(Number(before) - Number(after)).toBe(33000);
    // 두 번 역분개 불가
    expect((await acct.post(`/journal-entries/${e.id}/reverse`, { reason: '다시 취소' })).status).toBe(409);
  });

  it('외부 세무담당자는 승인된 전표만 본다', async () => {
    const d = (await acct.post('/journal-entries', { entryDate: today, description: '미승인 전표', lines: [{ accountId: acc['814'], debit: '1000' }, { accountId: acc['101'], credit: '1000' }] })).body;
    const list = (await tax.get('/journal-entries?size=500')).body;
    expect(list.rows.some((r: any) => r.id === d.id)).toBe(false);
    expect(list.rows.every((r: any) => ['APPROVED', 'REVERSED'].includes(r.status))).toBe(true);
    expect((await tax.get(`/journal-entries/${d.id}`)).status).toBe(404);
    expect((await tax.post('/journal-entries/approve', { ids: [d.id] })).status).toBe(403);
    await acct.post(`/journal-entries/${d.id}/void`, { reason: '테스트 정리' });
  });
});

describe('검수 → 자동분개, 검수 취소 → 무효/역분개', () => {
  it('검수 확정 시 (공사원가-재료비 / 외상매입금) 공급가액으로 자동분개가 미승인 상태로 생기고, 취소하면 무효가 된다', async () => {
    const { po, receipt } = await receivedPo('10', '5000');
    const list = (await acct.get(`/journal-entries?sourceType=RECEIPT&q=${receipt.code}`)).body;
    expect(list.rows).toHaveLength(1);
    const e = (await acct.get(`/journal-entries/${list.rows[0].id}`)).body;
    expect(e.status).toBe('DRAFT');
    expect(e.lines.map((l: any) => [l.accountCode, l.debit, l.credit, l.projectName])).toEqual([['501', '50000.00', '0.00', '원가 테스트 현장'], ['251', '0.00', '50000.00', '원가 테스트 현장']]);
    expect(e.sourceHref).toBe(`/purchase-orders/${po.id}`);
    // 자동분개는 전표 화면에서 직접 고치거나 역분개할 수 없다
    expect((await acct.post(`/journal-entries/${e.id}/void`, { reason: 'x1' })).status).toBe(409);
    await buyer.post(`/purchase-orders/receipts/${receipt.id}/cancel`, { reason: '반품' });
    expect((await acct.get(`/journal-entries/${e.id}`)).body.status).toBe('VOID');
  });

  it('승인된 자동분개는 검수 취소 시 역분개된다', async () => {
    const { receipt } = await receivedPo('2', '30000');
    const e = (await acct.get(`/journal-entries?sourceType=RECEIPT&q=${receipt.code}`)).body.rows[0];
    await acct.post('/journal-entries/approve', { ids: [e.id] });
    expect((await acct.post(`/journal-entries/${e.id}/reverse`, { reason: '직접' })).body.code).toBe('AUTO_JOURNAL');
    await buyer.post(`/purchase-orders/receipts/${receipt.id}/cancel`, { reason: '오입력' });
    const after = (await acct.get(`/journal-entries/${e.id}`)).body;
    expect(after.status).toBe('REVERSED');
    expect(after.reversedBy).toBeTruthy();
  });
});

describe('[필수5] 지급결의 — 승인 없이 지급 불가, 중복 지급 차단', () => {
  let receiptId: string;
  let reqId: string;

  it('검수 내역을 골라 자재대금 지급결의를 만든다 — 금액은 검수 금액 그대로 (화면 값 무시)', async () => {
    const { receipt } = await receivedPo('100', '10000'); // 공급 1,000,000 세액 100,000
    receiptId = receipt.id;
    const avail = (await acct.get(`/payment-requests/sources?type=RECEIPT&vendorId=${vendorId}`)).body;
    expect(avail.some((x: any) => x.id === receiptId)).toBe(true);
    const r = await acct.post('/payment-requests', { kind: 'PURCHASE', title: '10월 자재대금', requestDate: today, vendorId, lines: [{ sourceType: 'RECEIPT', sourceId: receiptId, supplyAmount: '1', vatAmount: '1' }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ supplyAmount: '1000000.00', vatAmount: '100000.00', totalAmount: '1100000.00', projectId, status: 'DRAFT' });
    reqId = r.body.id;
  });

  it('같은 검수를 다른 결의에 또 넣을 수 없다', async () => {
    const r = await acct.post('/payment-requests', { kind: 'PURCHASE', title: '중복', requestDate: today, vendorId, lines: [{ sourceType: 'RECEIPT', sourceId: receiptId }] });
    expect(r.status).toBe(409);
  });

  it('작성중·결재중에는 지급할 수 없다 (서버)', async () => {
    const d = (await acct.get(`/payment-requests/${reqId}`)).body;
    const r1 = await acct.post(`/payment-requests/${reqId}/pay`, { version: d.version, payDate: today });
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('NOT_APPROVED');
    const s = await acct.post(`/payment-requests/${reqId}/submit`, { version: d.version });
    const d2 = (await acct.get(`/payment-requests/${reqId}`)).body;
    expect(d2.status).toBe('PENDING');
    expect((await acct.post(`/payment-requests/${reqId}/pay`, { version: d2.version, payDate: today })).body.code).toBe('NOT_APPROVED');
    // 회계관리자 검토만으로는 아직 승인 아님
    await approve(acct, s.body.approvalId);
    expect((await acct.get(`/payment-requests/${reqId}`)).body.status).toBe('PENDING');
  });

  it('DB 에 직접 지급을 넣어도 승인되지 않은 결의는 거부된다 (트리거)', async () => {
    const { pool, db } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`insert into payment (company_id, code, request_id, pay_date, amount) values (${w.A.id}, 'X', ${reqId}, ${today}, 1100000)`);
    } catch (e) {
      err = e;
    }
    await pool.end();
    expect(String(err?.cause?.message)).toMatch(/결재 승인된 지급결의만/);
  });

  it('대표이사 승인 후 지급 — 동시에 두 번 눌러도 한 번만 지급된다', async () => {
    const d = (await acct.get(`/payment-requests/${reqId}`)).body;
    await approve(ceo, d.approvalId);
    const d2 = (await acct.get(`/payment-requests/${reqId}`)).body;
    expect(d2.status).toBe('APPROVED');
    const [a, b] = await Promise.all([
      acct.post(`/payment-requests/${reqId}/pay`, { version: d2.version, payDate: today }),
      acct.post(`/payment-requests/${reqId}/pay`, { version: d2.version, payDate: today }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const d3 = (await acct.get(`/payment-requests/${reqId}`)).body;
    expect(d3.status).toBe('PAID');
    expect(d3.payments.filter((p: any) => p.status === 'CONFIRMED')).toHaveLength(1);
    // 지급 분개: 외상매입금 / 보통예금
    const pj = d3.journals.find((j: any) => j.source_type === 'PAYMENT');
    const e = (await acct.get(`/journal-entries/${pj.id}`)).body;
    expect(e.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([['251', '1100000.00', '0.00'], ['103', '0.00', '1100000.00']]);
  });

  it('지급된 결의에 포함된 검수는 취소할 수 없다', async () => {
    const r = await buyer.post(`/purchase-orders/receipts/${receiptId}/cancel`, { reason: '반품' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('RECEIPT_IN_PAYMENT');
  });

  it('지급 취소 시 역분개되고 다시 지급대기로 돌아간다', async () => {
    const r = await acct.post(`/payment-requests/${reqId}/cancel-payment`, { reason: '이체 실패' });
    expect(r.status).toBe(200);
    const d = (await acct.get(`/payment-requests/${reqId}`)).body;
    expect(d.status).toBe('APPROVED');
    expect(d.payments[0].status).toBe('CANCELLED');
    // 다시 지급 가능
    expect((await acct.post(`/payment-requests/${reqId}/pay`, { version: d.version, payDate: today })).status).toBe(200);
  });

  it('경비 결의: 승인 시 (비용·부가세대급금 / 미지급금), 지급 시 (미지급금 / 예금)', async () => {
    const d = await approvedRequest({ kind: 'EXPENSE', title: '현장 안전용품', requestDate: today, projectId, vendorId, lines: [{ description: '안전모·조끼', costCodeId: cc['C09'], supplyAmount: '200000', vatAmount: '20000' }] });
    expect(d.status).toBe('APPROVED');
    const accrual = (await acct.get(`/journal-entries/${d.journals[0].id}`)).body;
    expect(accrual.lines.map((l: any) => [l.accountCode, l.debit, l.credit])).toEqual([['509', '200000.00', '0.00'], ['135', '20000.00', '0.00'], ['253', '0.00', '220000.00']]);
    const pay = await acct.post(`/payment-requests/${d.id}/pay`, { version: d.version, payDate: today });
    expect(pay.status).toBe(200);
  });

  it('현장소장은 자기 현장 결의만 본다', async () => {
    const mine = (await site.get('/payment-requests')).body;
    expect(mine.rows.every((r: any) => r.projectId === projectId)).toBe(true);
    const other = await approvedRequest({ kind: 'EXPENSE', title: '다른 현장 경비', requestDate: today, projectId: otherProjectId, payeeName: '홍길동', lines: [{ description: '식대', accountId: acc['507'], supplyAmount: '50000', vatAmount: '0' }] });
    expect((await site.get(`/payment-requests/${other.id}`)).status).toBe(404);
  });
});

describe('[필수8] 실행예산·현장별 손익 정확성', () => {
  let p2: string;
  it('실행예산은 결재 승인 후에만 반영된다', async () => {
    p2 = (await admin.post('/projects', { name: '손익 검증 현장', tradeType: 'ELECTRIC', supplyAmount: '50000000', status: 'IN_PROGRESS' })).body.id;
    const r = await admin.post(`/budgets/${p2}/revisions`, { title: '최초 실행예산', reason: '착공 전 편성', lines: [{ costCodeId: cc['C01'], afterAmount: '20000000' }, { costCodeId: cc['C02'], afterAmount: '10000000' }, { costCodeId: cc['C09'], afterAmount: '300000' }] });
    expect(r.status).toBe(201);
    expect(r.body.totalAfter).toBe('30300000.00');
    let s = (await admin.get(`/budgets/${p2}`)).body;
    expect(s.totals.planned).toBe('0.00');
    const sub = await admin.post(`/budget-revisions/${r.body.id}/submit`, { version: r.body.version });
    await approve(ceo, sub.body.approvalId);
    s = (await admin.get(`/budgets/${p2}`)).body;
    expect(s.totals.planned).toBe('30300000.00');
    expect(s.project.executionBudget).toBe('30300000.00');
  });

  it('발주확정·발생원가·지급액이 원가항목별로 정확히 집계된다', async () => {
    // 재료비: 발주 12,000,000 승인 → 그중 8,000,000 검수
    const p = (await buyer.post('/purchase-orders', { projectId: p2, vendorId, title: '간선', orderDate: today, lines: [{ name: '케이블', unit: 'm', qty: '1200', unitPrice: '10000' }] })).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    await approve(ceo, s.body.approvalId);
    const d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    const gr = (await buyer.post(`/purchase-orders/${p.id}/receipts`, { receiptDate: today, lines: [{ poLineId: d.lines[0].id, qty: '800' }] })).body;
    // 안전관리비: 경비 결의 350,000 (예산 300,000 초과)
    const exp = await approvedRequest({ kind: 'EXPENSE', title: '안전시설', requestDate: today, projectId: p2, vendorId, lines: [{ description: '안전난간', costCodeId: cc['C09'], supplyAmount: '350000', vatAmount: '35000' }] });
    await acct.post(`/payment-requests/${exp.id}/pay`, { version: exp.version, payDate: today });
    // 재료비 중 검수 8,000,000 지급
    const pr = await approvedRequest({ kind: 'PURCHASE', title: '간선 대금', requestDate: today, vendorId, lines: [{ sourceType: 'RECEIPT', sourceId: gr.id }] });
    await acct.post(`/payment-requests/${pr.id}/pay`, { version: pr.version, payDate: today });

    const sum = (await admin.get(`/budgets/${p2}`)).body;
    const row = (code: string) => sum.rows.find((r: any) => r.code === code);
    expect(row('C01')).toMatchObject({ planned: '20000000.00', committed: '12000000.00', actual: '8000000.00', paid: '8000000.00', remaining: '8000000.00', level: 'OK' });
    expect(row('C09')).toMatchObject({ planned: '300000.00', committed: '350000.00', actual: '350000.00', paid: '350000.00', remaining: '-50000.00', level: 'OVER' });
    expect(row('C02')).toMatchObject({ planned: '10000000.00', committed: '0.00', actual: '0.00' });
    expect(sum.totals).toMatchObject({ planned: '30300000.00', actual: '8350000.00', paid: '8350000.00' });
    // 예상 준공원가 = Σ max(계획, 확정, 발생) = 20,000,000 + 10,000,000 + 350,000
    expect(sum.forecast.estimatedCost).toBe('30350000.00');
    expect(sum.forecast.estimatedProfit).toBe('19650000.00');
    // 다른 현장 원가가 섞이지 않는다
    const other = (await admin.get(`/budgets/${otherProjectId}`)).body;
    expect(other.totals.actual).toBe('0.00');
  });

  it('[시나리오 D] 예산 초과는 경고 목록에 뜨고, 담당자 확인 후 증액 결재로 해소된다', async () => {
    const ov = (await admin.get('/budgets/overview')).body;
    const alert = ov.alerts.find((a: any) => a.projectId === p2 && a.costCodeName === '안전관리비');
    expect(alert).toMatchObject({ level: 'OVER', planned: '300000.00', used: '350000.00' });
    expect(alert.ackedBy).toBeNull();
    await site.post(`/budgets/${p2}/alerts/${cc['C09']}/ack`, { level: 'OVER', note: '추가 안전시설' }).then((r) => expect(r.status).toBe(404)); // 배정 안 된 현장
    expect((await admin.post(`/budgets/${p2}/alerts/${cc['C09']}/ack`, { level: 'OVER', note: '추가 안전시설 반영 필요' })).status).toBe(200);
    expect((await admin.get('/budgets/overview')).body.alerts.find((a: any) => a.projectId === p2).ackedBy).toBe('a.admin');
    const r = (await admin.post(`/budgets/${p2}/revisions`, { title: '안전관리비 증액', reason: '안전난간 추가', lines: [{ costCodeId: cc['C09'], afterAmount: '500000' }] })).body;
    const s = await admin.post(`/budget-revisions/${r.id}/submit`, { version: r.version });
    await approve(ceo, s.body.approvalId);
    const after = (await admin.get(`/budgets/${p2}`)).body;
    expect(after.rows.find((x: any) => x.code === 'C09')).toMatchObject({ planned: '500000.00', level: 'OK', usedRate: '0.7000' });
    expect(after.totals.planned).toBe('30500000.00');
  });
});

describe('장부·재무제표', () => {
  it('미승인 전표를 모두 승인하면 시산표·재무상태표 차대가 맞고, 손익계산서 공사원가에 반영된다', async () => {
    const drafts = (await acct.get('/journal-entries?status=DRAFT&size=500')).body.rows.map((r: any) => r.id);
    if (drafts.length) await acct.post('/journal-entries/approve', { ids: drafts });
    const tb = (await acct.get(`/ledger/trial-balance?to=${today}`)).body;
    expect(tb.balanced).toBe(true);
    expect(tb.unapprovedDrafts).toBe(0);
    const bs = (await acct.get(`/ledger/balance-sheet?to=${today}`)).body;
    expect(bs.balanced).toBe(true);
    const is = (await acct.get(`/ledger/income-statement?from=${today.slice(0, 4)}-01-01&to=${today}`)).body;
    const cost = is.sections.find((s: any) => s.key === 'CONSTRUCTION_COST');
    expect(Number(cost.total)).toBeGreaterThan(8000000);
    // 당기순이익이 재무상태표 자본에 그대로 들어간다
    expect(bs.equity.rows.find((r: any) => r.id === 'NET').amount).toBe(is.netIncome);
    const cs = (await acct.get(`/ledger/cost-statement?from=${today.slice(0, 4)}-01-01&to=${today}`)).body;
    expect(cs.grandTotal).toBe(cost.total);
  });

  it('거래처별 채권·채무: 외상매입금 = 검수 공급가액 − 지급액 (세금계산서 수취 전 부가세 선지급분은 차감)', async () => {
    const v = (await acct.get(`/ledger/vendors?to=${today}`)).body;
    const row = v.rows.find((r: any) => r.vendorId === vendorId);
    const { pool, db } = testDb();
    const [x] = (await db.execute(sql`select
      (select coalesce(sum(gr.supply_amount),0) from goods_receipt gr join purchase_order po on po.id = gr.po_id where po.vendor_id = ${vendorId} and gr.status = 'CONFIRMED') -
      (select coalesce(sum(p.amount),0) from payment p join payment_request r on r.id = p.request_id where r.vendor_id = ${vendorId} and r.kind = 'PURCHASE' and p.status = 'CONFIRMED') as ap`)).rows as { ap: string }[];
    await pool.end();
    expect(row.accounts.find((a: any) => a.code === '251').balance).toBe(Number(x.ap).toFixed(2));
  });
});

describe('[시나리오 E] 월마감', () => {
  it('미승인 전표가 있으면 마감할 수 없고, 승인 후 마감하면 그 달에는 기록할 수 없다', async () => {
    const d = (await acct.post('/journal-entries', { entryDate: today, description: '통신비', lines: [{ accountId: acc['814'], debit: '44000' }, { accountId: acc['103'], credit: '44000' }] })).body;
    const checks = (await acct.get(`/closing/${thisMonth}/checks`)).body;
    expect(checks.find((c: any) => c.key === 'drafts').state).toBe('block');
    expect(checks.find((c: any) => c.key === 'balance').state).toBe('ok');
    const blocked = await acct.post(`/closing/${thisMonth}/close`, {});
    expect(blocked.status).toBe(409);
    await acct.post('/journal-entries/approve', { ids: [d.id] });
    const drafts = (await acct.get('/journal-entries?status=DRAFT&size=500')).body.rows.map((r: any) => r.id);
    if (drafts.length) await acct.post('/journal-entries/approve', { ids: drafts });
    const ok = await acct.post(`/closing/${thisMonth}/close`, { note: '테스트 마감' });
    expect(ok.status).toBe(200);
    // 마감 후 같은 달 전표·검수 불가
    const late = await acct.post('/journal-entries', { entryDate: today, description: '늦은 전표', lines: [{ accountId: acc['814'], debit: '1' }, { accountId: acc['103'], credit: '1' }] });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PERIOD_CLOSED');
    // DB 직접 기록도 차단
    const { pool, db } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`insert into journal_entry (company_id, code, entry_date, description) values (${w.A.id}, 'HACK', ${today}, 'x')`);
    } catch (e) {
      err = e;
    }
    await pool.end();
    expect(String(err?.cause?.message)).toMatch(/마감된 기간/);
    // 권한 없는 사람은 마감 해제 불가
    expect((await buyer.post(`/closing/${thisMonth}/reopen`, { reason: '해제' })).status).toBe(403);
    expect((await acct.post(`/closing/${thisMonth}/reopen`, { reason: '추가 전표 입력' })).status).toBe(200);
    expect((await acct.post('/journal-entries', { entryDate: today, description: '해제 후 전표', lines: [{ accountId: acc['814'], debit: '1000' }, { accountId: acc['103'], credit: '1000' }] })).status).toBe(201);
  });
});
