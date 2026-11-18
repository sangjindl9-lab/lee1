// 금액·세무 원장 로직. 모든 금액은 원(KRW) 단위 정수이며 소수 연산을 하지 않는다.
//
// ※ 세무 처리(수수료 부가세, 원천징수 대상·기준·절사 방식)는 플랫폼의 거래 구조(중개인지, 직접 공급인지)에 따라
//   달라지므로 출시 전에 세무사 검토가 필요하다. 아래는 명세에 적힌 규칙을 그대로 구현한 기본값이다.

export type BusinessType = 'corporation' | 'general_taxpayer' | 'simplified_taxpayer' | 'individual';
export type PgFeeBearer = 'seller' | 'platform';
export type LedgerKind =
  | 'payment_in' | 'refund_out'
  | 'platform_fee_supply' | 'platform_fee_vat'
  | 'pg_fee_seller' | 'pg_fee_platform'
  | 'withholding_income_tax' | 'withholding_local_tax'
  | 'payout_paid';

export interface FeePolicy { id: number; scope: 'default' | 'category' | 'seller'; scopeRef: string; rateBps: number; pgFeeBearer: PgFeeBearer; validFrom: Date | null; validTo: Date | null; active: boolean }

/** 수수료 정책 선택: 판매자별 > 카테고리별 > 기본. 기간이 지정된 정책(할인 기간)은 그 기간에만 적용. 같은 범위에서는 최신 정책 우선 */
export function resolveFeePolicy(policies: FeePolicy[], q: { sellerId: number; category: string; now: Date }): FeePolicy {
  const live = policies
    .filter((p) => p.active && (!p.validFrom || p.validFrom <= q.now) && (!p.validTo || p.validTo > q.now))
    .sort((a, b) => b.id - a.id);
  const pick = live.find((p) => p.scope === 'seller' && p.scopeRef === String(q.sellerId))
    ?? live.find((p) => p.scope === 'category' && p.scopeRef === q.category)
    ?? live.find((p) => p.scope === 'default');
  if (!pick) throw new Error('적용할 수수료 정책이 없습니다');
  return pick; // 주문 생성 시 이 값을 주문에 복사해 고정한다. 이후 정책 변경은 기존 주문에 영향을 주지 않는다
}

export interface SettlementInput {
  amount: number;            // 결제액
  refunded: number;          // 환불 완료 누계
  feeBps: number;            // 주문 시점 수수료율(공급가액 기준)
  pgFeeBps: number;          // 주문 시점 결제 비용률
  pgFeeBearer: PgFeeBearer;
  businessType: BusinessType; // 주문 시점 판매자 사업자 유형
  taxInvoiceIssuable?: boolean; // 간이과세자의 세금계산서 발행 가능 여부
  /** 원천징수 기준. 명세 기본값은 지급액('net'). 세무 검토 결과에 따라 'gross'(수수료 차감 전)로 바꿀 수 있다 */
  withholdingBase?: 'net' | 'gross';
}

export interface Settlement {
  base: number;                // 결제액 − 환불액
  feeSupply: number;           // 플랫폼 수수료 공급가액
  feeVat: number;              // 수수료 부가세(10%)
  pgFee: number;               // 결제 비용
  sellerPgFee: number;         // 판매자 부담 결제 비용
  platformPgFee: number;       // 플랫폼 부담 결제 비용
  withholdingBaseAmount: number;
  withholdingIncomeTax: number; // 소득세 3%
  withholdingLocalTax: number;  // 지방소득세(소득세의 10%)
  net: number;                 // 실제 지급액
  platformNetRevenue: number;  // 플랫폼 순수수료 수익(부가세·원천세는 예수금이므로 제외)
  feeDoc: 'tax_invoice' | 'fee_receipt';       // 플랫폼이 판매자에게 발행할 수수료 증빙
  needsWithholdingStatement: boolean;          // 지급명세서 기초 데이터 생성 대상
  sellerCanIssueTaxInvoice: boolean;           // 판매자가 구매자에게 세금계산서를 발행할 수 있는지(정산 내역에 기록)
}

const MAX = 1_000_000_000_000; // 1조 원. 정수 곱셈이 2^53 을 넘지 않도록 하는 상한
const floor10 = (n: number) => Math.floor(n / 10) * 10; // 세액 10원 미만 절사

function assertMoney(n: number, name: string) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX) throw new Error(`${name} 금액이 올바르지 않습니다: ${n}`);
}

export function computeSettlement(i: SettlementInput): Settlement {
  assertMoney(i.amount, '결제'); assertMoney(i.refunded, '환불');
  if (i.refunded > i.amount) throw new Error('환불액이 결제액보다 큽니다');
  if (!Number.isInteger(i.feeBps) || i.feeBps < 0 || i.feeBps > 5000) throw new Error('수수료율이 올바르지 않습니다');
  if (!Number.isInteger(i.pgFeeBps) || i.pgFeeBps < 0 || i.pgFeeBps > 1000) throw new Error('결제 비용률이 올바르지 않습니다');

  const base = i.amount - i.refunded;
  const feeSupply = Math.floor((base * i.feeBps) / 10000);
  const feeVat = Math.floor(feeSupply / 10);
  // 결제 비용은 남은 결제액 기준으로 계산한다(취소분의 결제 비용 환급 여부는 사업자 계약으로 확인해야 함)
  const pgFee = Math.floor((base * i.pgFeeBps) / 10000);
  const afterFee = base - feeSupply - feeVat;
  const sellerPgFee = i.pgFeeBearer === 'seller' ? Math.min(pgFee, Math.max(0, afterFee)) : 0;
  const platformPgFee = pgFee - sellerPgFee;
  const beforeTax = afterFee - sellerPgFee;

  let withholdingBaseAmount = 0, withholdingIncomeTax = 0, withholdingLocalTax = 0;
  if (i.businessType === 'individual') {
    withholdingBaseAmount = (i.withholdingBase ?? 'net') === 'gross' ? base : beforeTax;
    withholdingIncomeTax = floor10(Math.floor((withholdingBaseAmount * 3) / 100));
    withholdingLocalTax = floor10(Math.floor(withholdingIncomeTax / 10));
    if (withholdingIncomeTax + withholdingLocalTax > beforeTax) { withholdingIncomeTax = 0; withholdingLocalTax = 0; }
  }
  const net = beforeTax - withholdingIncomeTax - withholdingLocalTax;
  if (net < 0) throw new Error('수수료 합계가 정산 기준 금액을 넘습니다');

  return {
    base, feeSupply, feeVat, pgFee, sellerPgFee, platformPgFee,
    withholdingBaseAmount, withholdingIncomeTax, withholdingLocalTax, net,
    platformNetRevenue: feeSupply - platformPgFee,
    feeDoc: i.businessType === 'individual' ? 'fee_receipt' : 'tax_invoice',
    needsWithholdingStatement: i.businessType === 'individual' && withholdingIncomeTax > 0,
    sellerCanIssueTaxInvoice: i.businessType === 'corporation' || i.businessType === 'general_taxpayer'
      || (i.businessType === 'simplified_taxpayer' && !!i.taxInvoiceIssuable),
  };
}

// ── 원장 ────────────────────────────────────────────────────────
export interface LedgerEntry { orderId: number; kind: LedgerKind; amount: number; ref: string; memo: string }

// ref 는 DB에서 UNIQUE 이므로 같은 이벤트를 두 번 처리해도 원장에 두 번 적히지 않는다(멱등성)
export const paymentEntry = (orderId: number, amount: number): LedgerEntry =>
  ({ orderId, kind: 'payment_in', amount, ref: `pay:${orderId}`, memo: '결제 확인' });
export const refundEntry = (orderId: number, refundId: number, amount: number): LedgerEntry =>
  ({ orderId, kind: 'refund_out', amount, ref: `refund:${refundId}`, memo: '결제 취소 확인' });

/** 지급 완료가 확인된 시점에 한 번에 기록하는 정산 분개 */
export function payoutEntries(orderId: number, attempt: number, s: Settlement): LedgerEntry[] {
  const e = (kind: LedgerKind, amount: number, memo: string): LedgerEntry => ({ orderId, kind, amount, ref: `payout:${orderId}:${attempt}:${kind}`, memo });
  return [
    e('platform_fee_supply', s.feeSupply, '플랫폼 수수료(공급가액)'),
    e('platform_fee_vat', s.feeVat, '수수료 부가세'),
    e('pg_fee_seller', s.sellerPgFee, '결제 비용(판매자 부담)'),
    e('pg_fee_platform', s.platformPgFee, '결제 비용(플랫폼 부담)'),
    e('withholding_income_tax', s.withholdingIncomeTax, '원천징수 소득세'),
    e('withholding_local_tax', s.withholdingLocalTax, '원천징수 지방소득세'),
    e('payout_paid', s.net, '판매자 지급 완료'),
  ].filter((x) => x.amount > 0 || x.kind === 'payout_paid');
}

/** 멱등성 키. 같은 지급·환불은 몇 번을 재시도해도 같은 키를 쓴다. 지급은 사업자가 '실패'로 확정한 뒤에만 attempt 를 올린다 */
export const payoutKey = (orderId: number, attempt: number) => `payout-${orderId}-${attempt}`;
export const refundKey = (refundId: number) => `refund-${refundId}`;

export interface LedgerSummary {
  paid: number; refunded: number; gmv: number;
  feeSupply: number; feeVat: number; pgFeeSeller: number; pgFeePlatform: number;
  withholding: number; paidOut: number;
  /** 아직 판매자에게 나가지 않은 금액(보관 중). 정산이 끝난 주문은 0 이어야 한다 */
  undistributed: number;
  platformNetRevenue: number;
}

export function summarize(entries: LedgerEntry[]): LedgerSummary {
  const sum = (...k: LedgerKind[]) => entries.filter((e) => k.includes(e.kind)).reduce((a, e) => a + e.amount, 0);
  const paid = sum('payment_in'), refunded = sum('refund_out');
  const feeSupply = sum('platform_fee_supply'), feeVat = sum('platform_fee_vat');
  const pgFeeSeller = sum('pg_fee_seller'), pgFeePlatform = sum('pg_fee_platform');
  const withholding = sum('withholding_income_tax', 'withholding_local_tax'), paidOut = sum('payout_paid');
  return {
    paid, refunded, gmv: paid - refunded, feeSupply, feeVat, pgFeeSeller, pgFeePlatform, withholding, paidOut,
    undistributed: paid - refunded - feeSupply - feeVat - pgFeeSeller - withholding - paidOut,
    platformNetRevenue: feeSupply - pgFeePlatform, // 총 거래액(gmv)과 구분되는 플랫폼 순수수료 수익
  };
}

/** 지급 가능 금액: 같은 돈이 환불과 지급에 두 번 쓰이지 않았는지 원장으로 다시 확인한다 */
export function availableForPayout(entries: LedgerEntry[]): number {
  const s = summarize(entries);
  return s.paidOut > 0 ? 0 : s.gmv;
}

/** 세무·증빙 기초 데이터(tax_records 행) */
export interface TaxRecord { docType: 'tax_invoice' | 'fee_receipt' | 'withholding_statement'; period: string; supplyAmount: number; vatAmount: number; grossPayment: number; incomeTax: number; localTax: number }
export function taxRecords(s: Settlement, paidAt: Date): TaxRecord[] {
  const kst = new Date(paidAt.getTime() + 9 * 3600 * 1000);
  const period = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`; // 한국 시간 기준 귀속 연월
  const out: TaxRecord[] = [];
  if (s.feeSupply > 0) out.push({ docType: s.feeDoc, period, supplyAmount: s.feeSupply, vatAmount: s.feeVat, grossPayment: 0, incomeTax: 0, localTax: 0 });
  if (s.needsWithholdingStatement) out.push({ docType: 'withholding_statement', period, supplyAmount: 0, vatAmount: 0, grossPayment: s.withholdingBaseAmount, incomeTax: s.withholdingIncomeTax, localTax: s.withholdingLocalTax });
  return out;
}
