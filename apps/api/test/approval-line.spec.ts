/** 결재선 — 중간 결재자(사람 지정) 추가, 상신 때 결재선 직접 지정 */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { Agent, agentFor, setupWorld, World } from './helpers';

let w: World;
let admin: Agent, ceo: Agent, buyer: Agent, acct: Agent, site: Agent;
let projectId: string, vendorId: string;
const uid = (login: string) => w.ids[login].userId;
const po = () => ({ projectId, vendorId, title: '결재선 시험', orderDate: '2026-10-22', lines: [{ name: '전선', unit: 'm', qty: '10', unitPrice: '1000' }] });

async function act(ag: Agent, approvalId: string, action = 'approve') {
  const a = (await ag.get(`/approvals/${approvalId}`)).body;
  return ag.post(`/approvals/${approvalId}/act`, { action, version: a.version, comment: action === 'reject' ? '다시' : undefined });
}

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  buyer = await agentFor(w, 'a.buyer', w.A.id);
  acct = await agentFor(w, 'a.acct', w.A.id);
  site = await agentFor(w, 'a.site', w.A.id);
  projectId = (await admin.post('/projects', { name: '결재선 현장', tradeType: 'ELECTRIC', supplyAmount: '100000000', status: 'IN_PROGRESS' })).body.id;
  vendorId = (await admin.post('/vendors', { name: '결재선상사', bizRegNo: '124-81-00998' })).body.id;
});
afterAll(async () => {
  await w.app.close();
});

describe('회사 결재선에 사람을 지정한 중간 단계', () => {
  it('발주서: 담당 → 검토(김회계 지정) → 대표이사', async () => {
    const r = await admin.put('/approvals/lines', { docType: 'PURCHASE_ORDER', lines: [{ minAmount: '0', steps: [{ title: '검토', userId: uid('a.acct') }, { title: '승인', roleKey: 'CEO' }] }] });
    expect(r.status).toBe(200);
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    expect(s.status).toBe(200);
    const a = (await buyer.get(`/approvals/${s.body.approvalId}`)).body;
    expect(a.steps.map((x: { title: string }) => x.title)).toEqual(['담당', '검토', '승인']);
    expect(a.steps[1].approverUserId).toBe(uid('a.acct'));
    // 대표이사도 검토 단계는 대신할 수 없다
    expect((await act(ceo, a.id)).body.code).toBe('NOT_APPROVER');
    // 지정된 사람 결재함에 보인다
    expect((await acct.get('/approvals?box=todo')).body.some((x: { id: string }) => x.id === a.id)).toBe(true);
    expect((await act(acct, a.id)).status).toBe(200);
    expect((await act(ceo, a.id)).body.final).toBe(true);
    expect((await buyer.get(`/purchase-orders/${p.id}`)).body.status).toBe('APPROVED');
  });

  it('발주서 결재선의 마지막은 대표이사여야 한다', async () => {
    const r = await admin.put('/approvals/lines', { docType: 'PURCHASE_ORDER', lines: [{ minAmount: '0', steps: [{ title: '승인', userId: uid('a.acct') }] }] });
    expect(r.body.code).toBe('FINAL_REQUIRED');
  });
});

describe('상신할 때 이번 문서만 결재선 지정', () => {
  it('중간에 현장소장 검토를 끼워 넣을 수 있다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version, approvalLine: [{ title: '현장', userId: uid('a.site') }, { title: '검토', userId: uid('a.acct') }, { title: '승인', roleKey: 'CEO' }] });
    expect(s.status).toBe(200);
    const a = (await buyer.get(`/approvals/${s.body.approvalId}`)).body;
    expect(a.steps.map((x: { title: string }) => x.title)).toEqual(['담당', '현장', '검토', '승인']);
    expect((await act(acct, a.id)).body.code).toBe('NOT_APPROVER'); // 순서대로
    expect((await act(site, a.id)).status).toBe(200);
    expect((await act(acct, a.id)).status).toBe(200);
    expect((await act(ceo, a.id)).body.final).toBe(true);
  });

  it('마지막 결재자는 바꿀 수 없고, 본인·중복 지정은 막는다', async () => {
    const p = (await buyer.post('/purchase-orders', po())).body;
    const bad1 = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version, approvalLine: [{ title: '승인', userId: uid('a.acct') }] });
    expect(bad1.body.code).toBe('FINAL_FIXED');
    const bad2 = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version, approvalLine: [{ title: '검토', userId: uid('a.buyer') }, { title: '승인', roleKey: 'CEO' }] });
    expect(bad2.body.code).toBe('SELF_APPROVER');
    const bad3 = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version, approvalLine: [{ title: '검토', userId: uid('a.acct') }, { title: '재검토', userId: uid('a.acct') }, { title: '승인', roleKey: 'CEO' }] });
    expect(bad3.body.code).toBe('DUP_APPROVER');
    const other = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version, approvalLine: [{ title: '검토', userId: w.ids['b.admin'].userId }, { title: '승인', roleKey: 'CEO' }] });
    expect(other.body.code).toBe('BAD_APPROVER');
    // 실패한 상신은 문서를 바꾸지 않는다
    expect((await buyer.get(`/purchase-orders/${p.id}`)).body.status).toBe('DRAFT');
  });

  it('결재자 후보 목록 — 이 회사 사용자만', async () => {
    const people = (await buyer.get('/approvals/candidates')).body as { id: string; name: string }[];
    expect(people.some((x) => x.id === uid('a.site'))).toBe(true);
  });
});
