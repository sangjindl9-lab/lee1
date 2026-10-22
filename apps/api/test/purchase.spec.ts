/** 2단계: 자재·발주서·대표이사 결재·검수 — 실제 PostgreSQL */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { Agent, agentFor, assign, setupWorld, testDb, World } from './helpers';
import { koreanAmount } from '../src/purchase/po-pdf';

let w: World;
let admin: Agent, ceo: Agent, buyer: Agent, site: Agent;
let projectId: string, otherProjectId: string, vendorId: string, materialId: string;

const po = (over: Record<string, unknown> = {}) => ({
  projectId, vendorId, title: '1차 전선 자재', orderDate: '2026-10-22', deliveryDate: '2026-10-30', deliveryPlace: '현장 자재창고',
  lines: [
    { materialId, name: 'F-CV 케이블', spec: '6sq 2C', unit: 'm', qty: '100', unitPrice: '1850' },
    { name: '케이블타이', spec: '300mm', unit: '봉', qty: '3', unitPrice: '4,333' },
    { name: '면세 품목', unit: 'EA', qty: '2', unitPrice: '1000', taxType: 'EXEMPT' },
  ],
  ...over,
});

async function approvedPo(over: Record<string, unknown> = {}) {
  const p = (await buyer.post('/purchase-orders', po(over))).body;
  const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
  const a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
  await ceo.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
  return (await buyer.get(`/purchase-orders/${p.id}`)).body;
}

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  buyer = await agentFor(w, 'a.buyer', w.A.id);
  site = await agentFor(w, 'a.site', w.A.id);
  projectId = (await admin.post('/projects', { name: '발주 테스트 현장', tradeType: 'ELECTRIC', supplyAmount: '500000000', status: 'IN_PROGRESS' })).body.id;
  otherProjectId = (await admin.post('/projects', { name: '배정 안 된 현장', tradeType: 'ELECTRIC', supplyAmount: '1000' })).body.id;
  vendorId = (await admin.post('/vendors', { name: '대한전기자재', bizRegNo: '124-81-00998' })).body.id;
  materialId = (await admin.post('/materials', { name: 'F-CV 케이블', spec: '6sq 2C', unit: 'm', defaultPrice: '1800', tradeType: 'ELECTRIC' })).body.id;
  await assign(w.ids['a.site'].membershipId, projectId);
});
afterAll(async () => {
  await w.app.close();
});

describe('자재마스터', () => {
  it('자재코드 자동 발급, 같은 코드 중복 거부', async () => {
    const m = await admin.post('/materials', { name: '분전반', unit: 'EA', defaultPrice: '480000' });
    expect(m.status).toBe(201);
    expect(m.body.code).toMatch(/^M\d{5}$/);
    const dup = await admin.post('/materials', { code: m.body.code, name: '다른 자재', unit: 'EA' });
    expect(dup.status).toBe(409);
  });

  it('엑셀 대량 등록: 미리보기에서 오류 행을 알려 주고, 오류가 있으면 저장하지 않는다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('자재등록');
    ws.addRow(['자재코드', '자재명', '규격', '제조사', '단위', '품목분류', '공종', '기본단가', '과세구분', '비고']);
    ws.addRow(['', 'HFIX 전선', '2.5sq', 'LS', 'm', '전선', '전기', 350, '과세', '']);
    ws.addRow(['', 'UTP 케이블', 'CAT6', '', 'box', '통신선', '통신', 98000, '', '']);
    ws.addRow(['', '잘못된 공종', '', '', 'EA', '', '토목', 100, '', '']);
    ws.addRow(['', '', '', '', 'EA', '', '', 100, '', '']);
    ws.addRow(['', 'F-CV 케이블', '6sq 2C', '', 'm', '', '', 1, '', '']); // 이미 있음
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const dry = await admin.req('post', '/materials/import?dryRun=true').attach('file', buf, 'm.xlsx');
    expect(dry.status).toBe(200);
    expect(dry.body.summary).toEqual({ insert: 2, update: 0, skip: 1, error: 2 });
    expect(dry.body.results.find((r: any) => r.row === 4).message).toMatch(/공종/);
    const commit = await admin.req('post', '/materials/import?dryRun=false').attach('file', buf, 'm.xlsx');
    expect(commit.status).toBe(400);
    // 오류 행을 고친 파일
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('자재등록');
    [1, 2, 3, 6].forEach((n) => ws2.addRow((ws.getRow(n).values as unknown[]).slice(1)));
    const ok = await admin.req('post', '/materials/import?dryRun=false').attach('file', Buffer.from(await wb2.xlsx.writeBuffer()), 'm.xlsx');
    if (ok.status !== 200) throw new Error(JSON.stringify(ok.body));
    expect(ok.body.summary.insert).toBe(2);
    const list = (await admin.get('/materials?q=UTP')).body;
    expect(list.rows[0]).toMatchObject({ name: 'UTP 케이블', tradeType: 'TELECOM', defaultPrice: '98000.0000' });
  });
});

describe('발주서 작성 — 서버 금액 계산', () => {
  it('품목별 공급가액(원 미만 절사)·과세 품목만 부가세, 합계는 서버가 계산', async () => {
    const r = await buyer.post('/purchase-orders', po({ supplyAmount: '1', totalAmount: '1' }));
    expect(r.status).toBe(201);
    // 100×1850=185,000 (세액 18,500) + 3×4,333=12,999 (세액 1,299) + 면세 2,000
    expect(r.body).toMatchObject({ supplyAmount: '199999.00', vatAmount: '19799.00', totalAmount: '219798.00', status: 'DRAFT' });
    expect(r.body.code).toMatch(/^PO\d{2}-\d{4}$/);
    const d = (await buyer.get(`/purchase-orders/${r.body.id}`)).body;
    expect(d.lines.find((l: any) => l.taxType === 'EXEMPT').vatAmount).toBe('0.00');
  });

  it('현장소장은 배정된 현장에만 발주할 수 있다', async () => {
    expect((await site.post('/purchase-orders', po())).status).toBe(201);
    const bad = await site.post('/purchase-orders', po({ projectId: otherProjectId }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_PROJECT');
  });

  it('다른 회사 거래처·현장으로는 발주할 수 없다', async () => {
    const b = await agentFor(w, 'b.admin', w.B.id);
    const bp = (await b.post('/projects', { name: 'B현장', tradeType: 'TELECOM', supplyAmount: '1' })).body.id;
    expect((await buyer.post('/purchase-orders', po({ projectId: bp }))).status).toBe(400);
  });

  it('수량 0·음수 단가·품목 없음은 거부', async () => {
    expect((await buyer.post('/purchase-orders', po({ lines: [] }))).status).toBe(400);
    expect((await buyer.post('/purchase-orders', po({ lines: [{ name: 'x', unit: 'EA', qty: '0', unitPrice: '1' }] }))).status).toBe(400);
    expect((await buyer.post('/purchase-orders', po({ lines: [{ name: 'x', unit: 'EA', qty: '1', unitPrice: '-1' }] }))).status).toBe(400);
  });
});

describe('대표이사 결재', () => {
  it('상신하면 결재선이 담당 → 대표이사 승인으로 만들어지고, 결재 중에는 수정할 수 없다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    expect(s.status).toBe(200);
    const a = (await buyer.get(`/approvals/${s.body.approvalId}`)).body;
    expect(a.steps.map((x: any) => [x.title, x.roleKey, x.state])).toEqual([['담당', null, 'APPROVED'], ['승인', 'CEO', 'WAITING']]);
    expect(a.steps[1].approverNames).toContain('a.ceo');
    const locked = await buyer.put(`/purchase-orders/${p.id}`, { ...po(), version: p.version + 1 });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('PO_LOCKED');
  });

  it('대표이사가 아니면 승인할 수 없다 (최고관리자도 불가)', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    const a = (await buyer.get(`/approvals/${s.body.approvalId}`)).body;
    for (const ag of [buyer, admin]) {
      const r = await ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('NOT_APPROVER');
    }
  });

  it('대표이사 승인 → 발주서 승인, 결재함에서 사라지고, 거래처별 단가가 갱신된다', async () => {
    const todoBefore = (await ceo.get('/approvals?box=todo')).body.length;
    const d = await approvedPo();
    expect(d.status).toBe('APPROVED');
    expect(d.approval.steps[1]).toMatchObject({ state: 'APPROVED', actedByName: 'a.ceo' });
    expect((await ceo.get('/approvals?box=todo')).body.length).toBe(todoBefore);
    const m = (await buyer.get(`/materials?vendorId=${vendorId}&q=F-CV`)).body.rows[0];
    expect(m.vendorPrice.unitPrice).toBe('1850.0000');
  });

  it('반려는 사유 필수, 반려 후 수정해 다시 상신하면 새 결재가 만들어진다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    const a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
    expect((await ceo.post(`/approvals/${a.id}/act`, { action: 'reject', version: a.version })).status).toBe(400);
    expect((await ceo.post(`/approvals/${a.id}/act`, { action: 'reject', comment: '단가 재협의 필요', version: a.version })).status).toBe(200);
    let d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    expect(d.status).toBe('REJECTED');
    const upd = await buyer.put(`/purchase-orders/${p.id}`, { ...po({ lines: [{ name: '케이블', unit: 'm', qty: '100', unitPrice: '1700' }] }), version: d.version });
    expect(upd.status).toBe(200);
    const s2 = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: upd.body.version });
    expect(s2.status).toBe(200);
    d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    expect(d.approvalHistory).toHaveLength(2);
    expect(d.approvalHistory[1].steps[1].comment).toBe('단가 재협의 필요');
  });

  it('보류 후 승인할 수 있고, 기안자는 아무도 처리하지 않은 결재만 회수할 수 있다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    let a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
    expect((await ceo.post(`/approvals/${a.id}/act`, { action: 'hold', comment: '현장 확인 후', version: a.version })).status).toBe(200);
    expect((await buyer.post(`/approvals/${a.id}/cancel`)).status).toBe(409); // 보류됨 = 결재자가 손댐
    a = (await ceo.get(`/approvals/${a.id}`)).body;
    expect((await ceo.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version })).status).toBe(200);

    const p2 = (await buyer.post('/purchase-orders', po())).body;
    const s2 = await buyer.post(`/purchase-orders/${p2.id}/submit`, { version: p2.version });
    expect((await ceo.post(`/approvals/${s2.body.approvalId}/cancel`)).status).toBe(403); // 기안자만
    expect((await buyer.post(`/approvals/${s2.body.approvalId}/cancel`)).status).toBe(200);
    expect((await buyer.get(`/purchase-orders/${p2.id}`)).body.status).toBe('DRAFT');
  });

  it('[필수10] 대표이사 두 명이 동시에 승인을 눌러도 한 번만 처리된다', async () => {
    const roles = (await admin.get('/roles')).body;
    const ceoRole = roles.find((r: any) => r.key === 'CEO');
    await admin.post('/users', { loginId: 'a.ceo2', name: '공동대표', roleIds: [ceoRole.id], tempPassword: 'Ceo2!pass2026' });
    const c2 = new Agent(w.app);
    await c2.login('a.ceo2', 'Ceo2!pass2026');
    c2.companyId = w.A.id;
    await c2.post('/auth/password', { currentPassword: 'Ceo2!pass2026', newPassword: 'Ceo2!changed26' });

    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    const a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
    const results = await Promise.all([ceo, c2, ceo, c2].map((ag) => ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const { pool, db } = testDb();
    const logs = await db.execute(sql`select count(*)::int as n from audit_log where resource_id = ${p.id} and action = 'APPROVAL_APPROVE'`);
    expect(logs.rows[0].n).toBe(1);
    await pool.end();
  });

  it('결재선은 마지막이 대표이사여야 하고, 대표이사가 없는 회사는 상신할 수 없다', async () => {
    const bad = await admin.put('/approvals/lines', { docType: 'PURCHASE_ORDER', lines: [{ minAmount: '0', steps: [{ title: '승인', roleKey: 'ACCOUNTING_MANAGER' }] }] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('FINAL_REQUIRED');
    const ok = await admin.put('/approvals/lines', { docType: 'PURCHASE_ORDER', lines: [{ minAmount: '0', steps: [{ title: '승인', roleKey: 'CEO' }] }, { minAmount: '10000000', steps: [{ title: '검토', roleKey: 'ACCOUNTING_MANAGER' }, { title: '승인', roleKey: 'CEO' }] }] });
    expect(ok.status).toBe(200);
    // 천만 원 이상은 회계관리자 검토 → 대표이사
    const big = (await buyer.post('/purchase-orders', po({ lines: [{ name: '수배전반', unit: '식', qty: '1', unitPrice: '20000000' }] }))).body;
    const s = await buyer.post(`/purchase-orders/${big.id}/submit`, { version: big.version });
    const a = (await buyer.get(`/approvals/${s.body.approvalId}`)).body;
    expect(a.steps.map((x: any) => x.title)).toEqual(['담당', '검토', '승인']);
    expect((await ceo.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version })).status).toBe(403); // 검토 먼저
    await admin.put('/approvals/lines', { docType: 'PURCHASE_ORDER', lines: [{ minAmount: '0', steps: [{ title: '승인', roleKey: 'CEO' }] }] });

    const b = await agentFor(w, 'b.admin', w.B.id);
    const bp = (await b.post('/projects', { name: 'B 현장', tradeType: 'TELECOM', supplyAmount: '1' })).body.id;
    const bv = (await b.post('/vendors', { name: 'B 업체' })).body.id;
    const bpo = (await b.post('/purchase-orders', po({ projectId: bp, vendorId: bv, lines: [{ name: 'x', unit: 'EA', qty: '1', unitPrice: '1000' }] }))).body;
    const r = await b.post(`/purchase-orders/${bpo.id}/submit`, { version: bpo.version });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NO_APPROVER');
  });

  it('결재 기록은 DB에서 삭제할 수 없고, 처리된 단계는 바꿀 수 없다', async () => {
    const { pool, db } = testDb();
    await expect(db.execute(sql`delete from approval`)).rejects.toThrow();
    await expect(db.execute(sql`update approval_step set acted_by_name = '조작' where state = 'APPROVED' and step_no = 1`)).rejects.toThrow();
    await pool.end();
  });
});

describe('[필수2] 납품·검수 — 부분납품과 잔량', () => {
  it('결재 전 발주서는 검수할 수 없다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const r = await buyer.post(`/purchase-orders/${p.id}/receipts`, { receiptDate: '2026-10-25', lines: [] });
    expect(r.status).toBe(400); // 품목 없음 검증이 먼저
    const d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    const r2 = await buyer.post(`/purchase-orders/${p.id}/receipts`, { receiptDate: '2026-10-25', lines: [{ poLineId: d.lines[0].id, qty: '1' }] });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('NOT_RECEIVABLE');
  });

  it('40m 부분입고 → 잔량 60m, 초과 70m 거부, 60m 입고 시 해당 품목 완료', async () => {
    const d = await approvedPo({ lines: [{ materialId, name: 'F-CV', unit: 'm', qty: '100', unitPrice: '1850' }, { name: '타이', unit: '봉', qty: '3', unitPrice: '4333' }] });
    const [cable, tie] = d.lines;
    let r = await site.post(`/purchase-orders/${d.id}/receipts`, { receiptDate: '2026-10-25', lines: [{ poLineId: cable.id, qty: '40' }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ poStatus: 'PARTIAL', supplyAmount: '74000.00', vatAmount: '7400.00' });
    let cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect(cur.lines[0].remainingQty).toBe('60.0000');
    r = await site.post(`/purchase-orders/${d.id}/receipts`, { receiptDate: '2026-10-26', lines: [{ poLineId: cable.id, qty: '70' }] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('OVER_RECEIPT');
    r = await site.post(`/purchase-orders/${d.id}/receipts`, { receiptDate: '2026-10-26', lines: [{ poLineId: cable.id, qty: '60' }, { poLineId: tie.id, qty: '3' }] });
    expect(r.body.poStatus).toBe('RECEIVED');
    cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect(cur.receipts).toHaveLength(2);
    expect(cur.lines.every((l: any) => l.remainingQty === '0.0000')).toBe(true);

    // 검수 취소(반품) → 잔량 복원, 부분입고로
    const second = cur.receipts[0];
    expect((await buyer.post(`/purchase-orders/receipts/${second.id}/cancel`, { reason: '규격 불량 반품' })).body.poStatus).toBe('PARTIAL');
    cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect(cur.lines[0].remainingQty).toBe('60.0000');
    expect((await buyer.post(`/purchase-orders/receipts/${second.id}/cancel`, { reason: '두 번 취소' })).status).toBe(409);
  });

  it('[필수10] 남은 60m를 두 사람이 동시에 60m씩 검수해도 한 건만 성공', async () => {
    const d = await approvedPo({ lines: [{ name: '전선', unit: 'm', qty: '60', unitPrice: '1000' }] });
    const res = await Promise.all([site, buyer].map((ag) => ag.post(`/purchase-orders/${d.id}/receipts`, { receiptDate: '2026-10-25', lines: [{ poLineId: d.lines[0].id, qty: '60' }] })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(1); // 초과 검수 또는 이미 입고완료
    const cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect(cur.lines[0].receivedQty).toBe('60.0000');
  });

  it('부분입고 잔량 종결, 입고가 있으면 변경 재결재·취소 불가', async () => {
    const d = await approvedPo({ lines: [{ name: '전선', unit: 'm', qty: '10', unitPrice: '1000' }] });
    await site.post(`/purchase-orders/${d.id}/receipts`, { receiptDate: '2026-10-25', lines: [{ poLineId: d.lines[0].id, qty: '4' }] });
    let cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect((await buyer.post(`/purchase-orders/${d.id}/reopen`, { version: cur.version, reason: '수량 변경' })).body.code).toBe('HAS_RECEIPTS');
    expect((await buyer.post(`/purchase-orders/${d.id}/close`, { version: cur.version, reason: '잔량 불필요' })).status).toBe(200);
    cur = (await buyer.get(`/purchase-orders/${d.id}`)).body;
    expect(cur.status).toBe('CLOSED');
  });

  it('승인 후 변경은 작성중으로 되돌리고 개정번호를 올려 다시 대표 결재를 받는다', async () => {
    const d = await approvedPo();
    const r = await buyer.post(`/purchase-orders/${d.id}/reopen`, { version: d.version, reason: '납품기한 변경' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'DRAFT', revision: 1 });
  });
});

describe('발주서 PDF', () => {
  it('한글 금액 표기', () => {
    expect(koreanAmount('219798')).toBe('이십일만구천칠백구십팔');
    expect(koreanAmount('100000000')).toBe('일억');
    expect(koreanAmount('135802467')).toBe('일억삼천오백팔십만이천사백육십칠');
    expect(koreanAmount('10000')).toBe('일만');
  });

  it('승인된 발주서와 결재 전 발주서 모두 PDF가 만들어지고 출력 기록이 남는다', async () => {
    const lines = Array.from({ length: 45 }, (_, i) => ({ name: `품목 ${i + 1} 긴 이름 테스트용 전선관 및 부속자재`, spec: 'HI-PVC 28C', unit: 'EA', qty: String(i + 1), unitPrice: '1250' }));
    const d = await approvedPo({ lines });
    const res = await ceo.req('get', `/purchase-orders/${d.id}/pdf`).buffer(true).parse((r, cb) => {
      const c: Buffer[] = [];
      r.on('data', (x: Buffer) => c.push(x));
      r.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2); // 45개 품목은 2쪽 이상
    const draft = (await buyer.post('/purchase-orders', po())).body;
    expect((await buyer.req('get', `/purchase-orders/${draft.id}/pdf`)).status).toBe(200);
    const { pool, db } = testDb();
    const logs = await db.execute(sql`select count(*)::int as n from audit_log where action = 'EXPORT' and resource = 'purchase_order' and resource_id = ${d.id}`);
    expect(logs.rows[0].n).toBe(1);
    await pool.end();
  });
});

describe('대시보드 연결', () => {
  it('미승인 발주서 수와 내 결재 대기가 대시보드에 집계된다', async () => {
    const dash = (await ceo.get('/dashboard')).body;
    expect(dash.purchase.pending).toBeGreaterThan(0);
    expect(Number(dash.purchase.confirmed)).toBeGreaterThan(0);
    expect(dash.approvals.todo).toBeGreaterThan(0);
    expect(dash.approvals.todo).toBeLessThanOrEqual(dash.purchase.pending);
  });
});
