import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement, resolveFeePolicy, paymentEntry, refundEntry, payoutEntries, summarize, availableForPayout, taxRecords, payoutKey } from '../src/domain/ledger.ts';
import type { FeePolicy, Settlement } from '../src/domain/ledger.ts';

const base = { amount: 1_000_000, refunded: 0, feeBps: 1000, pgFeeBps: 330, pgFeeBearer: 'seller' as const };
const identity = (s: Settlement) => s.feeSupply + s.feeVat + s.sellerPgFee + s.withholdingIncomeTax + s.withholdingLocalTax + s.net;

test('법인·일반과세자: 수수료 세금계산서(공급가액 + 부가세 10%), 원천징수 없음', () => {
  for (const businessType of ['corporation', 'general_taxpayer'] as const) {
    const s = computeSettlement({ ...base, businessType });
    assert.equal(s.feeSupply, 100_000); assert.equal(s.feeVat, 10_000); assert.equal(s.sellerPgFee, 33_000);
    assert.equal(s.withholdingIncomeTax, 0); assert.equal(s.net, 857_000);
    assert.equal(s.feeDoc, 'tax_invoice'); assert.equal(s.sellerCanIssueTaxInvoice, true); assert.equal(identity(s), s.base);
  }
});

test('간이과세자: 세금계산서 발행 가능 여부를 구분해 기록', () => {
  assert.equal(computeSettlement({ ...base, businessType: 'simplified_taxpayer', taxInvoiceIssuable: false }).sellerCanIssueTaxInvoice, false);
  const s = computeSettlement({ ...base, businessType: 'simplified_taxpayer', taxInvoiceIssuable: true });
  assert.equal(s.sellerCanIssueTaxInvoice, true); assert.equal(s.net, 857_000); assert.equal(s.needsWithholdingStatement, false);
});

test('개인: 지급액 기준 3.3% 원천징수(소득세 3% + 지방소득세 0.3%), 10원 미만 절사', () => {
  const s = computeSettlement({ ...base, businessType: 'individual' });
  assert.equal(s.withholdingBaseAmount, 857_000);
  assert.equal(s.withholdingIncomeTax, 25_710); assert.equal(s.withholdingLocalTax, 2_570);
  assert.equal(s.net, 828_720); assert.equal(s.feeDoc, 'fee_receipt'); assert.equal(s.needsWithholdingStatement, true);
  assert.equal(identity(s), s.base);
  const odd = computeSettlement({ ...base, amount: 123_457, businessType: 'individual' });
  assert.equal(odd.withholdingIncomeTax % 10, 0); assert.equal(odd.withholdingLocalTax % 10, 0); assert.equal(identity(odd), odd.base);
  const gross = computeSettlement({ ...base, businessType: 'individual', withholdingBase: 'gross' });
  assert.equal(gross.withholdingIncomeTax, 30_000); assert.equal(gross.withholdingLocalTax, 3_000);
});

test('결제 비용 부담 주체, 부분·전액 환불, 플랫폼 순수익', () => {
  const p = computeSettlement({ ...base, pgFeeBearer: 'platform', businessType: 'corporation' });
  assert.equal(p.sellerPgFee, 0); assert.equal(p.net, 890_000); assert.equal(p.platformNetRevenue, 100_000 - 33_000);
  const part = computeSettlement({ ...base, refunded: 300_000, businessType: 'corporation' });
  assert.equal(part.base, 700_000); assert.equal(part.feeSupply, 70_000); assert.equal(part.feeVat, 7_000); assert.equal(identity(part), 700_000);
  const full = computeSettlement({ ...base, refunded: 1_000_000, businessType: 'individual' });
  assert.deepEqual([full.base, full.feeSupply, full.net, full.withholdingIncomeTax], [0, 0, 0, 0]);
  assert.throws(() => computeSettlement({ ...base, refunded: 1_000_001, businessType: 'corporation' }));
  assert.throws(() => computeSettlement({ ...base, amount: 1000.5, businessType: 'corporation' }));
});

test('무작위 금액에서도 항상 정수이고 합계가 맞는다', () => {
  let seed = 42; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const types = ['corporation', 'general_taxpayer', 'simplified_taxpayer', 'individual'] as const;
  for (let k = 0; k < 5000; k++) {
    const amount = 1000 + rnd(500_000_000); const refunded = rnd(3) === 0 ? rnd(amount + 1) : 0;
    const s = computeSettlement({ amount, refunded, feeBps: rnd(3001), pgFeeBps: rnd(401), pgFeeBearer: rnd(2) ? 'seller' : 'platform', businessType: types[rnd(4)], withholdingBase: rnd(2) ? 'net' : 'gross' });
    for (const v of Object.values(s)) if (typeof v === 'number') assert.ok(Number.isInteger(v) && v >= 0 || v === s.platformNetRevenue, JSON.stringify(s));
    assert.equal(identity(s), s.base);
  }
});

test('수수료 정책 우선순위와 할인 기간, 주문 시점 고정', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  const mk = (id: number, scope: FeePolicy['scope'], scopeRef: string, rateBps: number, validFrom: string | null = null, validTo: string | null = null): FeePolicy =>
    ({ id, scope, scopeRef, rateBps, pgFeeBearer: 'seller', active: true, validFrom: validFrom ? new Date(validFrom) : null, validTo: validTo ? new Date(validTo) : null });
  const policies = [mk(1, 'default', '', 1000), mk(2, 'category', 'ai-tools', 800), mk(3, 'seller', '77', 500),
    mk(4, 'default', '', 300, '2026-12-01', '2026-12-31'), mk(5, 'category', 'erp', 0, '2026-01-01', '2026-06-30')];
  assert.equal(resolveFeePolicy(policies, { sellerId: 1, category: 'etc', now }).rateBps, 1000);
  assert.equal(resolveFeePolicy(policies, { sellerId: 1, category: 'ai-tools', now }).rateBps, 800);
  assert.equal(resolveFeePolicy(policies, { sellerId: 77, category: 'ai-tools', now }).rateBps, 500);
  assert.equal(resolveFeePolicy(policies, { sellerId: 1, category: 'erp', now }).rateBps, 1000); // 지난 할인은 적용 안 됨
  assert.equal(resolveFeePolicy(policies, { sellerId: 1, category: 'etc', now: new Date('2026-12-10') }).rateBps, 300); // 할인 기간
  assert.throws(() => resolveFeePolicy([], { sellerId: 1, category: 'x', now }));
});

test('원장: 결제 → 부분 환불 → 지급까지 남는 돈이 0, 총 거래액과 순수익 구분', () => {
  const entries = [paymentEntry(10, 1_000_000), refundEntry(10, 5, 300_000)];
  assert.equal(availableForPayout(entries), 700_000);
  assert.equal(summarize(entries).undistributed, 700_000); // 아직 보관 중
  const s = computeSettlement({ ...base, refunded: 300_000, pgFeeBearer: 'platform', businessType: 'individual' });
  entries.push(...payoutEntries(10, 1, s));
  const sum = summarize(entries);
  assert.equal(sum.undistributed, 0); assert.equal(sum.gmv, 700_000);
  assert.equal(sum.platformNetRevenue, s.feeSupply - s.platformPgFee); assert.ok(sum.platformNetRevenue < sum.gmv);
  assert.equal(availableForPayout(entries), 0); // 이미 지급됨
  assert.equal(new Set(entries.map((e) => e.ref)).size, entries.length);
  assert.equal(payoutKey(10, 1), payoutKey(10, 1));
});

test('세무 기초 데이터: 사업자는 세금계산서, 개인은 지급명세서 자료', () => {
  const paidAt = new Date('2026-11-30T16:00:00Z'); // 한국 시간 12월 1일
  const corp = taxRecords(computeSettlement({ ...base, businessType: 'corporation' }), paidAt);
  assert.deepEqual(corp, [{ docType: 'tax_invoice', period: '2026-12', supplyAmount: 100_000, vatAmount: 10_000, grossPayment: 0, incomeTax: 0, localTax: 0 }]);
  const ind = taxRecords(computeSettlement({ ...base, businessType: 'individual' }), paidAt);
  assert.deepEqual(ind.map((r) => r.docType), ['fee_receipt', 'withholding_statement']);
  assert.deepEqual([ind[1].grossPayment, ind[1].incomeTax, ind[1].localTax], [857_000, 25_710, 2_570]);
});
