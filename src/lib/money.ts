/** 금액 계산 — 모든 금액은 원(KRW) 정수이며, 소수점 이하를 만들지 않는다. */

export function formatKrw(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.trunc(amount)).toLocaleString("ko-KR")}원`;
}

/** basis point(1/10000) 기준 금액 계산. 내림 처리. */
export function applyBp(amount: number, rateBp: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rateBp)) return 0;
  return Math.floor((Math.trunc(amount) * Math.trunc(rateBp)) / 10000);
}

export function bpToPercent(rateBp: number): string {
  const pct = rateBp / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

export type SellerType = "BUSINESS" | "INDIVIDUAL";
export type PaymentFeeBearer = "SELLER" | "BUYER";

export interface FeeInput {
  grossAmount: number;
  commissionRateBp: number;
  paymentFeeRateBp?: number;
  paymentFeeBearer?: PaymentFeeBearer;
  sellerType?: SellerType;
  /** 개인 판매자 원천징수율 (기본 3.3% = 330bp) */
  withholdingRateBp?: number;
  /** 프로모션 할인 (수수료에서 차감, bp) */
  discountRateBp?: number;
}

export interface FeeBreakdown {
  grossAmount: number;
  commissionRateBp: number;
  commissionAmount: number;
  commissionVatAmount: number;
  paymentFeeRateBp: number;
  paymentFeeBearer: PaymentFeeBearer;
  paymentFeeAmount: number;
  withholdingTax: number;
  sellerNetAmount: number;
  /** 구매자가 실제로 지불하는 금액 (결제비용 구매자 부담 시 가산) */
  buyerPayableAmount: number;
  platformRevenueAmount: number;
}

/**
 * 결제액 / 플랫폼 수수료 / 결제비용 / 세금 / 실제 지급액을 구분해 계산한다.
 * 정산 담당자가 항목별로 검증할 수 있도록 모든 중간값을 돌려준다.
 */
export function computeFees(input: FeeInput): FeeBreakdown {
  const gross = Math.max(0, Math.trunc(input.grossAmount));
  const effectiveRateBp = Math.max(
    0,
    Math.trunc(input.commissionRateBp) - Math.max(0, Math.trunc(input.discountRateBp ?? 0)),
  );
  const commissionAmount = applyBp(gross, effectiveRateBp);
  const commissionVatAmount = Math.floor(commissionAmount / 10);
  const paymentFeeRateBp = Math.max(0, Math.trunc(input.paymentFeeRateBp ?? 0));
  const bearer: PaymentFeeBearer = input.paymentFeeBearer ?? "SELLER";
  const rawPaymentFee = applyBp(gross, paymentFeeRateBp);
  const paymentFeeAmount = paymentFeeRateBp > 0 ? rawPaymentFee : 0;

  const sellerType: SellerType = input.sellerType ?? "BUSINESS";
  const withholdingRateBp =
    sellerType === "INDIVIDUAL" ? Math.max(0, Math.trunc(input.withholdingRateBp ?? 330)) : 0;
  const withholdingTax = applyBp(gross, withholdingRateBp);

  const sellerBornePaymentFee = bearer === "SELLER" ? paymentFeeAmount : 0;
  const sellerNetAmount = Math.max(
    0,
    gross - commissionAmount - sellerBornePaymentFee - withholdingTax,
  );
  const buyerPayableAmount = gross + (bearer === "BUYER" ? paymentFeeAmount : 0);
  const platformRevenueAmount = commissionAmount + commissionVatAmount + sellerBornePaymentFee;

  return {
    grossAmount: gross,
    commissionRateBp: effectiveRateBp,
    commissionAmount,
    commissionVatAmount,
    paymentFeeRateBp,
    paymentFeeBearer: bearer,
    paymentFeeAmount,
    withholdingTax,
    sellerNetAmount,
    buyerPayableAmount,
    platformRevenueAmount,
  };
}

/** 외부 자동확정 예정일과 플랫폼 검수 기간의 충돌 여부를 검사한다. */
export function assertInspectionWindow(opts: {
  inspectionDays: number;
  autoConfirmAfterDays?: number | null;
  now?: Date;
}): { ok: boolean; reason?: string; inspectionDays: number } {
  const days = Math.max(1, Math.trunc(opts.inspectionDays));
  if (opts.autoConfirmAfterDays == null) return { ok: true, inspectionDays: days };
  if (opts.autoConfirmAfterDays <= days) {
    return {
      ok: false,
      inspectionDays: days,
      reason: `결제사업자 자동확정(${opts.autoConfirmAfterDays}일)이 플랫폼 검수 기간(${days}일)보다 짧아 검수 보호 기간을 확보할 수 없습니다. 해당 상품의 결제를 진행할 수 없습니다.`,
    };
  }
  return { ok: true, inspectionDays: days };
}
