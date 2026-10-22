/** 3단계: 세금계산서 수집·대사·발행, 외부 연동 재시도, 문서 스캔 — 실제 PostgreSQL */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { Agent, agentFor, setupWorld, testDb, World } from './helpers';
import { IntegrationsService } from '../src/integrations/integrations';
import { CollectedInvoice, CollectResult, ProviderError } from '../src/integrations/types';

let w: World;
let admin: Agent, ceo: Agent, acct: Agent, buyer: Agent, tax: Agent;
let projectId: string, vendorId: string, clientId: string;
const acc: Record<string, string> = {};
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const OUR = '1018117536';
const VENDOR_BIZ = '1248100998';

async function approve(ag: Agent, approvalId: string) {
  const a = (await ag.get(`/approvals/${approvalId}`)).body;
  const r = await ag.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

async function receivedPo(qty: string, price: string, lines?: { name: string; spec?: string; unit: string; qty: string; unitPrice: string }[]) {
  const p = (await buyer.post('/purchase-orders', { projectId, vendorId, title: '전선 자재', orderDate: today, lines: lines ?? [{ name: 'F-CV 4sq', unit: 'm', qty, unitPrice: price }] })).body;
  if (!p.id) throw new Error(JSON.stringify(p));
  const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
  await approve(ceo, s.body.approvalId);
  const d = (await buyer.get(`/purchase-orders/${p.id}`)).body;
  const r = await buyer.post(`/purchase-orders/${p.id}/receipts`, { receiptDate: today, lines: d.lines.map((l: any) => ({ poLineId: l.id, qty: l.qty })) });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { po: d, receipt: r.body };
}

/** 홈택스 '전자세금계산서 목록' 형식의 엑셀 */
async function hometaxXlsx(rows: { approvalNo: string; date: string; supplierBiz: string; supplierName: string; buyerBiz: string; supply: number; vat: number; item: string }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('세금계산서');
  ws.addRow(['전자세금계산서 목록 (매입)']);
  ws.addRow([]);
  ws.addRow(['작성일자', '승인번호', '발급일자', '전송일자', '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '합계금액', '공급가액', '세액', '전자세금계산서분류', '전자세금계산서종류', '발급유형', '비고', '영수/청구 구분', '공급자 이메일', '공급받는자 이메일1', '공급받는자 이메일2', '품목일자', '품목명', '품목규격', '품목수량', '품목단가', '품목공급가액', '품목세액', '품목비고']);
  for (const r of rows) {
    ws.addRow([r.date, r.approvalNo, r.date, r.date, r.supplierBiz.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3'), '', r.supplierName, '홍길동', '서울', r.buyerBiz.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3'), '', '에스에스전력', '김대표', '서울', r.supply + r.vat, r.supply, r.vat, '세금계산서', '일반', '전자발급', '', '청구', 'a@b.kr', 'c@d.kr', '', r.date, r.item, '', '1', String(r.supply), r.supply, r.vat, '']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function invoice(approvalNo: string, supply: number, over: Partial<CollectedInvoice> = {}): CollectedInvoice {
  return {
    approvalNo, writeDate: today, docKind: 'TAX', purpose: 'CHARGE', supplier: { bizNo: VENDOR_BIZ, name: '대한전기자재' }, buyer: { bizNo: OUR, name: '에스에스전력' },
    supplyAmount: String(supply), vatAmount: String(supply / 10), totalAmount: String(supply * 1.1), lines: [{ name: '자재', supplyAmount: String(supply), vatAmount: String(supply / 10) }], ...over,
  };
}

async function waitJob(ag: Agent, jobId: string, until: string[] = ['SUCCESS', 'FAILED', 'WAITING_AUTH']) {
  for (let i = 0; i < 100; i++) {
    const j = (await ag.get(`/tax-invoices/collect/${jobId}`)).body;
    if (until.includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('job timeout');
}

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  acct = await agentFor(w, 'a.acct', w.A.id);
  buyer = await agentFor(w, 'a.buyer', w.A.id);
  tax = await agentFor(w, 'a.tax', w.A.id);
  projectId = (await admin.post('/projects', { name: '세금계산서 테스트 현장', tradeType: 'ELECTRIC', supplyAmount: '500000000', status: 'IN_PROGRESS' })).body.id;
  vendorId = (await admin.post('/vendors', { name: '대한전기자재', bizRegNo: '124-81-00998' })).body.id;
  clientId = (await admin.post('/vendors', { name: '서울교육청', bizRegNo: '214-83-00432', vendorType: 'CLIENT' })).body.id;
  for (const a of (await acct.get('/accounts')).body) acc[a.code] = a.id;
});
afterAll(async () => {
  IntegrationsService.overrides = {};
  await w.app.close();
});

describe('[필수3] 홈택스 수집 중복 방지', () => {
  it('같은 엑셀을 두 번 올려도 승인번호가 같은 계산서는 한 번만 들어간다', async () => {
    const buf = await hometaxXlsx([
      { approvalNo: '20261020-41000011-00000001', date: today, supplierBiz: VENDOR_BIZ, supplierName: '대한전기자재', buyerBiz: OUR, supply: 1000000, vat: 100000, item: '전선' },
      { approvalNo: '20261020-41000011-00000002', date: today, supplierBiz: '2208162517', supplierName: '미등록상사', buyerBiz: OUR, supply: 300000, vat: 30000, item: '공구' },
      { approvalNo: '20261020-41000011-00000003', date: today, supplierBiz: VENDOR_BIZ, supplierName: '대한전기자재', buyerBiz: '2148839612', supply: 5000, vat: 500, item: '다른 회사 것' },
    ]);
    const dry = await acct.req('post', '/tax-invoices/import?direction=PURCHASE&dryRun=true').attach('file', buf, 'hometax.xlsx');
    expect(dry.status).toBe(200);
    expect(dry.body.summary.total).toBe(3);
    const first = await acct.req('post', '/tax-invoices/import?direction=PURCHASE&dryRun=false').attach('file', buf, 'hometax.xlsx');
    expect(first.body.inserted).toBe(2);
    expect(first.body.foreign).toBe(1); // 공급받는자가 우리 회사가 아닌 계산서는 제외
    const again = await acct.req('post', '/tax-invoices/import?direction=PURCHASE&dryRun=false').attach('file', buf, 'hometax.xlsx');
    expect(again.body.inserted).toBe(0);
    expect(again.body.duplicates).toBe(2);
    const dry2 = await acct.req('post', '/tax-invoices/import?direction=PURCHASE&dryRun=true').attach('file', buf, 'hometax.xlsx');
    expect(dry2.body.rows.filter((r: any) => r.duplicate).length).toBe(2);
    // 사업자번호로 거래처 자동 연결
    const list = (await acct.get('/tax-invoices?direction=PURCHASE')).body;
    expect(list.rows.find((r: any) => r.approvalNo.endsWith('0001')).vendorId).toBe(vendorId);
    expect(list.rows.find((r: any) => r.approvalNo.endsWith('0002')).vendorId).toBeNull();
  });

  it('홈택스(CODEF) 수집도 엑셀로 이미 들어온 계산서는 건너뛴다 + 간편인증 이어하기', async () => {
    let calls = 0;
    IntegrationsService.overrides.HOMETAX = {
      CODEF: {
        name: 'CODEF',
        test: async () => 'ok',
        collect: async (): Promise<CollectResult> => {
          calls++;
          return { kind: 'NEED_AUTH', method: 'simpleAuth', twoWayInfo: { jobIndex: 0, threadIndex: 0, jti: 'x', twoWayTimestamp: 1 }, message: '휴대폰에서 인증을 완료하세요', partial: [invoice('20261020-41000011-00000001', 1000000)] };
        },
        continueAuth: async (_pc: unknown, _req: unknown, info: Record<string, unknown>, answer: Record<string, string>): Promise<CollectResult> => {
          expect(info.jti).toBe('x');
          expect(answer.simpleAuth).toBe('1');
          return { kind: 'DONE', invoices: [invoice('20261021-41000011-00000009', 2000000)] };
        },
      },
    };
    const save = await admin.put('/integrations/HOMETAX', { provider: 'CODEF', mode: 'TEST', enabled: true, settings: { loginType: '5' }, secrets: { clientId: 'id', clientSecret: 'sec', publicKey: 'pk' } });
    expect(save.status).toBe(200);
    const start = await acct.post('/tax-invoices/collect', { direction: 'PURCHASE', from: today, to: today, login: { userName: '김대표', loginIdentity: '19700101', phoneNo: '01012345678' } });
    expect(start.status).toBe(202);
    const waiting = await waitJob(tax, start.body.jobId);
    expect(waiting.status).toBe('WAITING_AUTH');
    expect(waiting.result.method).toBe('simpleAuth');
    expect(JSON.stringify(waiting)).not.toContain('19700101'); // 로그인 정보는 작업 기록에 남지 않는다
    await acct.post(`/tax-invoices/collect/${start.body.jobId}/continue`, { answer: { simpleAuth: '1' } });
    const done = await waitJob(tax, start.body.jobId, ['SUCCESS', 'FAILED']);
    expect(done.status).toBe('SUCCESS');
    expect(done.result.inserted).toBe(1);
    expect(done.result.duplicates).toBe(1);
    expect(calls).toBe(1);
    const retry = await acct.post(`/tax-invoices/collect/${start.body.jobId}/continue`, { answer: {} });
    expect(retry.status).toBe(404);
  });

  it('DB 고유 인덱스: 같은 승인번호를 직접 넣어도 거부', async () => {
    const { db, pool } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`insert into tax_invoice (company_id, direction, status, code, approval_no, write_date, supply_amount, vat_amount, total_amount, dedupe_key, source)
        values (${w.A.id}, 'PURCHASE', 'COLLECTED', 'TI-X', '20261020-41000011-00000001', ${today}, 1, 0, 1, 'NTS:202610204100001100000001', 'MANUAL')`);
    } catch (e) {
      err = e;
    }
    await pool.end();
    expect(err).toBeTruthy();
  });
});

describe('[필수4] 발주·검수·세금계산서 금액 차이 감지', () => {
  let invId: string;
  let receiptId: string;
  it('검수 100만원에 계산서 105만원 → 차이 5만원 표시, 원인 없이 처리 불가', async () => {
    const { receipt } = await receivedPo('100', '10000');
    receiptId = receipt.id;
    const inv = await acct.post('/tax-invoices', { direction: 'PURCHASE', approvalNo: '20261022-41000011-00000100', writeDate: today, vendorId, lines: [{ name: 'F-CV 4sq 외 운반비', supplyAmount: '1050000', vatAmount: '105000' }] });
    expect(inv.status).toBe(201);
    invId = inv.body.id;
    const cands = (await acct.get(`/tax-invoices/${invId}/candidates`)).body;
    expect(cands.some((c: any) => c.id === receiptId)).toBe(true);
    const m = await acct.post(`/tax-invoices/${invId}/match`, { version: inv.body.version, links: [{ receiptId }] });
    expect(m.status).toBe(200);
    expect(m.body.matchedSupply).toBe('1000000.00');
    expect(m.body.matchDiff).toBe('50000.00');
    const list = (await acct.get('/tax-invoices?direction=PURCHASE&mismatch=1')).body;
    expect(list.rows.some((r: any) => r.id === invId)).toBe(true);
    const bad = await acct.post(`/tax-invoices/${invId}/post`, { version: m.body.version });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('DIFF_NOTE_REQUIRED');
    const recon = (await acct.get(`/tax-invoices/reconcile?vendorId=${vendorId}&onlyDiff=1`)).body;
    expect(recon.some((r: any) => r.issues.includes('계산서 금액이 검수 금액과 다름'))).toBe(true);
  });

  it('원인을 적으면 처리: 세액은 부가세대급금, 차액은 원가 조정 — 외상매입금 합계가 계산서 합계와 같다', async () => {
    const cur = (await acct.get(`/tax-invoices/${invId}`)).body;
    const ok = await acct.post(`/tax-invoices/${invId}/post`, { version: cur.version, matchNote: '운반비 별도 청구' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('POSTED');
    const d = (await acct.get(`/tax-invoices/${invId}`)).body;
    expect(d.journals.length).toBe(1);
    const je = (await acct.get(`/journal-entries/${d.journals[0].id}`)).body;
    const debit = (code: string) => je.lines.filter((l: any) => l.accountId === acc[code]).reduce((a: number, l: any) => a + Number(l.debit) - Number(l.credit), 0);
    expect(debit('135')).toBe(105000);
    expect(-debit('251')).toBe(155000); // 세액 10.5만 + 차액 5만 (공급가 100만은 검수 때 이미)
    // 지급하기 전에는 미지급 — 세금계산서 수취 ≠ 지급완료
    expect(d.paymentRequests.length).toBe(0);
    // 검수에 연결된 계산서는 '세금계산서' 원천으로 지급결의 불가 (이중 지급 방지)
    const pr = await acct.post('/payment-requests', { kind: 'PURCHASE', title: 'x', requestDate: today, vendorId, lines: [{ sourceType: 'TAX_INVOICE', sourceId: invId }] });
    expect(pr.status).toBe(400);
  });

  it('처리된 계산서의 검수는 다른 계산서에 또 연결할 수 없다 (남은 금액 없음)', async () => {
    const inv2 = (await acct.post('/tax-invoices', { direction: 'PURCHASE', approvalNo: '20261022-41000011-00000101', writeDate: today, vendorId, lines: [{ name: '중복', supplyAmount: '1000000', vatAmount: '100000' }] })).body;
    const r = await acct.post(`/tax-invoices/${inv2.id}/match`, { version: inv2.version, links: [{ receiptId }] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NO_REMAINING');
  });

  it('자동 대사: 검수 두 건의 합계가 계산서와 같으면 둘 다 연결', async () => {
    const a = await receivedPo('10', '30000');
    const b = await receivedPo('10', '20000');
    const inv = (await acct.post('/tax-invoices', { direction: 'PURCHASE', approvalNo: '20261022-41000011-00000102', writeDate: today, vendorId, lines: [{ name: '월합계', supplyAmount: '500000', vatAmount: '50000' }] })).body;
    const r = await acct.post(`/tax-invoices/${inv.id}/auto-match`, { version: inv.version });
    expect(r.status).toBe(200);
    expect(r.body.exact).toBe(true);
    expect(r.body.invoice.matchDiff).toBe('0.00');
    const d = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    expect(d.matches.map((m: any) => m.sourceId).sort()).toEqual([a.receipt.id, b.receipt.id].sort());
  });

  it('경비성 계산서(검수 없음)는 비용 계정을 골라 처리하고, 세금계산서 원천으로 지급결의', async () => {
    const list = (await acct.get('/tax-invoices?direction=PURCHASE&status=COLLECTED')).body;
    const unknown = list.rows.find((r: any) => r.approvalNo?.endsWith('0002'));
    expect((await acct.post(`/tax-invoices/${unknown.id}/post`, { version: unknown.version, accountId: acc['830'] ?? acc['812'] })).body.code).toBe('NEED_VENDOR');
    const withVendor = await acct.post(`/tax-invoices/${unknown.id}/vendor`, { create: true });
    expect(withVendor.status).toBe(200);
    expect(withVendor.body.vendorId).toBeTruthy();
    const posted = await acct.post(`/tax-invoices/${unknown.id}/post`, { version: withVendor.body.version, accountId: acc['812'] });
    expect(posted.status).toBe(200);
    const pr = await acct.post('/payment-requests', { kind: 'EXPENSE', title: '공구 대금', requestDate: today, vendorId: withVendor.body.vendorId, lines: [{ sourceType: 'TAX_INVOICE', sourceId: unknown.id }] });
    expect(pr.status).toBe(201);
    expect(pr.body.totalAmount).toBe('330000.00');
    // 결의에 들어간 계산서는 처리 취소 불가
    const un = await acct.post(`/tax-invoices/${unknown.id}/unpost`, { reason: '잘못 처리' });
    expect(un.status).toBe(409);
  });
});

describe('외부 세무담당자 열람 범위', () => {
  it('처리(분개)가 끝난 계산서만 보이고, 수집·처리는 할 수 없다', async () => {
    const rows = (await tax.get('/tax-invoices?direction=PURCHASE&size=200')).body.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.status === 'POSTED')).toBe(true);
    expect((await tax.post('/tax-invoices/collect', { direction: 'PURCHASE', from: today, to: today })).status).toBe(403);
  });
});

describe('[필수12] 외부 API 실패와 재시도', () => {
  it('일시 오류는 자동 재시도 후 성공, 기록에 시도 횟수가 남는다', async () => {
    let n = 0;
    IntegrationsService.overrides.HOMETAX = {
      CODEF: {
        name: 'CODEF', test: async () => 'ok', continueAuth: async () => ({ kind: 'DONE', invoices: [] }),
        collect: async (): Promise<CollectResult> => {
          n++;
          if (n < 2) throw new ProviderError('CODEF 서버 응답 지연 (503)', 'HTTP_503', true);
          return { kind: 'DONE', invoices: [] };
        },
      },
    };
    const s = await acct.post('/tax-invoices/collect', { direction: 'SALES', from: today, to: today });
    const j = await waitJob(tax, s.body.jobId, ['SUCCESS', 'FAILED']);
    expect(j.status).toBe('SUCCESS');
    expect(j.attempts).toBe(2);
  });

  it('계속 실패하면 실패로 기록하고, 재시도하면 안 되는 오류(인증 실패)는 한 번만 시도', async () => {
    let n = 0;
    IntegrationsService.overrides.HOMETAX = {
      CODEF: {
        name: 'CODEF', test: async () => 'ok', continueAuth: async () => ({ kind: 'DONE', invoices: [] }),
        collect: async (): Promise<CollectResult> => {
          n++;
          throw new ProviderError('홈택스 비밀번호가 틀렸습니다', 'CF-12100', false);
        },
      },
    };
    const s = await acct.post('/tax-invoices/collect', { direction: 'PURCHASE', from: today, to: today });
    const j = await waitJob(tax, s.body.jobId, ['SUCCESS', 'FAILED']);
    expect(j.status).toBe('FAILED');
    expect(j.errorCode).toBe('CF-12100');
    expect(n).toBe(1);
    const jobs = (await admin.get('/integrations/jobs?kind=HOMETAX')).body;
    expect(jobs.length).toBeGreaterThan(2);
  });

  it('발행 연동사가 네트워크 오류로 계속 실패하면 계산서는 발행실패 상태로 남고 장부에 반영되지 않는다', async () => {
    let n = 0;
    IntegrationsService.overrides.TAX_ISSUE = {
      SANDBOX: {
        name: 'SANDBOX', isLegal: () => false, test: async () => 'ok', status: async () => ({ approvalNo: null, ntsStatus: 'NOT_SENT' }), cancel: async () => undefined,
        issue: async () => {
          n++;
          throw new ProviderError('연결 시간 초과', 'NETWORK', true);
        },
      },
    };
    const inv = (await acct.post('/tax-invoices', { direction: 'SALES', writeDate: today, vendorId: clientId, projectId, lines: [{ name: '전기공사 1회 기성', supplyAmount: '10000000', vatAmount: '1000000' }] })).body;
    const sub = await acct.post(`/tax-invoices/${inv.id}/submit`, { version: inv.version });
    await approve(acct, sub.body.approvalId);
    const ready = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    expect(ready.status).toBe('READY');
    const r = await acct.post(`/tax-invoices/${inv.id}/issue`, { version: ready.version });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ISSUE_FAILED');
    expect(n).toBe(3);
    const after = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    expect(after.status).toBe('FAILED');
    expect(after.journals.length).toBe(0);
    IntegrationsService.overrides.TAX_ISSUE = {};
  });
});

describe('[필수15] 테스트 모드 발행은 실제 발행으로 표시되지 않는다', () => {
  it('가상 발행: 발행 상태지만 국세청 미전송·가상 표시, 승인번호·분개 없음', async () => {
    const inv = (await acct.post('/tax-invoices', { direction: 'SALES', writeDate: today, vendorId: clientId, projectId, lines: [{ name: '정보통신공사', supplyAmount: '2000000', vatAmount: '200000' }] })).body;
    // 결재 전 발행 불가
    expect((await acct.post(`/tax-invoices/${inv.id}/issue`, { version: inv.version })).status).toBe(409);
    const sub = await acct.post(`/tax-invoices/${inv.id}/submit`, { version: inv.version });
    await approve(acct, sub.body.approvalId);
    const ready = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    const r = await acct.post(`/tax-invoices/${inv.id}/issue`, { version: ready.version });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ISSUED');
    expect(r.body.providerMode).toBe('TEST');
    expect(r.body.ntsStatus).toBe('NOT_SENT');
    expect(r.body.isTestIssue).toBe(true);
    expect(r.body.approvalNo).toBeNull();
    const d = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    expect(d.journals.length).toBe(0);
    // 상태를 새로 조회해도 테스트 발행은 전송완료가 되지 않는다
    const ref = await acct.post(`/tax-invoices/${inv.id}/refresh`);
    expect(ref.body.ntsStatus).toBe('NOT_SENT');
    // DB 를 직접 고쳐도 '테스트 + 국세청 전송완료' 는 저장되지 않는다
    const { db, pool } = testDb();
    let err: any = null;
    try {
      await db.execute(sql`update tax_invoice set nts_status = 'SENT' where id = ${inv.id}`);
    } catch (e) {
      err = e;
    }
    await pool.end();
    expect(err).toBeTruthy();
    // 가상 발행은 취소 가능
    expect((await acct.post(`/tax-invoices/${inv.id}/cancel`, { reason: '시험 발행 정리' })).body.status).toBe('CANCELLED');
  });

  it('가상 발행은 운영 모드로 저장할 수 없다', async () => {
    const r = await admin.put('/integrations/TAX_ISSUE', { provider: 'SANDBOX', mode: 'LIVE', enabled: true });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TEST_ONLY');
  });

  it('운영 모드(실제 효력) 발행은 공급받는자 상호를 입력해야 보내고, 매출·매출세액을 분개한다', async () => {
    IntegrationsService.overrides.TAX_ISSUE = {
      POPBILL: {
        name: 'POPBILL', isLegal: (m: string) => m === 'LIVE', test: async () => 'ok', cancel: async () => undefined,
        status: async () => ({ approvalNo: '20261022-10000000-12345678', ntsStatus: 'SENT' }),
        issue: async () => ({ approvalNo: '20261022-10000000-12345678', providerKey: 'TI26-x', ntsStatus: 'WAITING' }),
      },
    };
    expect((await admin.put('/integrations/TAX_ISSUE', { provider: 'POPBILL', mode: 'LIVE', enabled: true, settings: { linkId: 'L', corpNum: OUR }, secrets: { secretKey: 'S' } })).status).toBe(200);
    const inv = (await acct.post('/tax-invoices', { direction: 'SALES', writeDate: today, vendorId: clientId, projectId, lines: [{ name: '전기공사', supplyAmount: '3000000', vatAmount: '300000' }] })).body;
    const sub = await acct.post(`/tax-invoices/${inv.id}/submit`, { version: inv.version });
    await approve(acct, sub.body.approvalId);
    const ready = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    const noConfirm = await acct.post(`/tax-invoices/${inv.id}/issue`, { version: ready.version });
    expect(noConfirm.body.code).toBe('CONFIRM_REQUIRED');
    const r = await acct.post(`/tax-invoices/${inv.id}/issue`, { version: ready.version, confirm: '서울교육청' });
    expect(r.status).toBe(200);
    expect(r.body.providerMode).toBe('LIVE');
    expect(r.body.isTestIssue).toBe(false);
    const d = (await acct.get(`/tax-invoices/${inv.id}`)).body;
    expect(d.journals.length).toBe(1);
    const ref = await acct.post(`/tax-invoices/${inv.id}/refresh`);
    expect(ref.body.ntsStatus).toBe('SENT');
    expect((await acct.post(`/tax-invoices/${inv.id}/cancel`, { reason: '취소 시도' })).body.code).toBe('NTS_SENT');
    IntegrationsService.overrides.TAX_ISSUE = {};
    await admin.put('/integrations/TAX_ISSUE', { provider: 'SANDBOX', mode: 'TEST', enabled: true });
  });
});

describe('[필수13] 문서 인식 결과는 사람이 확인한 뒤에만 등록 + 시나리오 B (20품목 발주서 PDF)', () => {
  let pdf: Buffer;
  let docId: string;
  it('우리가 보낸 20품목 발주서 PDF를 올리면 내장 인식기로 품목 20개와 금액을 읽는다', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ name: `케이블트레이 부속 ${i + 1}호`, spec: `${100 + i * 10}x50`, unit: 'EA', qty: String(i + 1), unitPrice: String(1000 * (i + 3)) }));
    const p = (await buyer.post('/purchase-orders', { projectId, vendorId, title: '트레이 부속 20종', orderDate: today, lines })).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    await approve(ceo, s.body.approvalId);
    const res = await buyer.req('get', `/purchase-orders/${p.id}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    pdf = res.body as Buffer;
    const before = (await buyer.get('/purchase-orders?size=200')).body.total;
    const up = await buyer.req('post', '/documents').field('docType', 'ISSUED_PO').field('projectId', projectId).attach('file', pdf, '발주서_트레이.pdf');
    expect(up.status).toBe(201);
    docId = up.body.id;
    expect(up.body.status).toBe('EXTRACTED');
    const ex = up.body.extracted;
    expect(ex.lines.length).toBe(20);
    expect(ex.lines[0].name).toBe('케이블트레이 부속 1호');
    expect(ex.lines[19].qty).toBe('20');
    const expected = lines.reduce((a, l) => a + Number(l.qty) * Number(l.unitPrice), 0);
    expect(Number(ex.supplyAmount)).toBe(expected);
    expect(up.body.vendorId).toBe(vendorId); // 우리 회사 번호를 빼고 거래처 사업자번호로 찾음
    // 인식만으로는 아무 문서도 생기지 않는다
    expect((await buyer.get('/purchase-orders?size=200')).body.total).toBe(before);
  });

  it('같은 파일은 다시 올릴 수 없다', async () => {
    const r = await buyer.req('post', '/documents').field('docType', 'ISSUED_PO').attach('file', pdf, '다시.pdf');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_FILE');
  });

  it('사람이 고친 값으로 발주서 초안 등록 — 인식 원본은 그대로 보존', async () => {
    const d = (await buyer.get(`/documents/${docId}`)).body;
    const fixed = { ...d.extracted, lines: d.extracted.lines.map((l: any, i: number) => (i === 0 ? { ...l, name: '케이블트레이 부속 1호(수정)' } : l)) };
    expect((await buyer.put(`/documents/${docId}/review`, { vendorId, projectId, data: fixed })).status).toBe(200);
    const reg = await buyer.post(`/documents/${docId}/register`, {
      target: 'PURCHASE_ORDER',
      payload: { projectId, vendorId, title: '스캔 발주', orderDate: today, lines: fixed.lines.map((l: any) => ({ name: l.name, spec: l.spec, unit: l.unit || 'EA', qty: l.qty, unitPrice: l.unitPrice })) },
    });
    expect(reg.status).toBe(200);
    expect(reg.body.registeredType).toBe('PURCHASE_ORDER');
    const po = (await buyer.get(`/purchase-orders/${reg.body.registeredId}`)).body;
    expect(po.status).toBe('DRAFT'); // 초안 — 대표 결재를 거쳐야 확정
    expect(po.lines.length).toBe(20);
    const after = (await buyer.get(`/documents/${docId}`)).body;
    expect(after.status).toBe('REGISTERED');
    expect(after.extracted.lines[0].name).toBe('케이블트레이 부속 1호');
    expect(after.reviewed.lines[0].name).toBe('케이블트레이 부속 1호(수정)');
    expect((await buyer.post(`/documents/${docId}/register`, { target: 'PROJECT_FILE', payload: { projectId } })).status).toBe(409);
  });

  it('사진처럼 글자가 없는 파일은 내장 인식기가 실패로 남기고, 반려할 수 있다', async () => {
    const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6364F8FF3F0005FE02FEA7D6A4E40000000049454E44AE426082', 'hex');
    const up = await buyer.req('post', '/documents').field('docType', 'STATEMENT').attach('file', png, '사진.png');
    expect(up.status).toBe(201);
    expect(up.body.status).toBe('FAILED');
    const rj = await buyer.post(`/documents/${up.body.id}/reject`, { reason: '사진 흐림' });
    expect(rj.body.status).toBe('REJECTED');
  });

  it('스캔 문서를 매입 세금계산서로 등록 — 처리 전(미처리) 상태로만 생긴다', async () => {
    const up = await acct.req('post', '/documents').field('docType', 'TAX_INVOICE').field('extract', '0').attach('file', Buffer.from('%PDF-1.4\n%scan-tax\n'), '종이계산서.pdf');
    expect(up.status).toBe(201);
    const reg = await acct.post(`/documents/${up.body.id}/register`, { target: 'TAX_INVOICE', payload: { direction: 'PURCHASE', writeDate: today, vendorId, lines: [{ name: '종이 계산서 품목', supplyAmount: '70000', vatAmount: '7000' }] } });
    expect(reg.status).toBe(200);
    const ti = (await acct.get(`/tax-invoices/${reg.body.registeredId}`)).body;
    expect(ti.status).toBe('COLLECTED');
    expect(ti.source).toBe('OCR');
    expect(ti.journals.length).toBe(0);
  });
});
