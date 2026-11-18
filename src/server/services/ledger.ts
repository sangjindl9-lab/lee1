import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { LedgerType, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 거래 원장 — 모든 자금 이동은 idempotencyKey 로 한 번만 기록된다.
 * 같은 키로 다시 기록을 시도하면 중복 지급이 되지 않도록 조용히 무시한다.
 */
export async function postLedger(
  db: Db,
  input: {
    orderId?: string | null;
    sellerId?: string | null;
    type: LedgerType;
    amount: number;
    idempotencyKey: string;
    memo?: string;
  },
): Promise<{ created: boolean }> {
  if (input.amount < 0) throw new DomainError("VALIDATION", "원장 금액은 0 이상이어야 합니다.");
  const existing = await db.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { created: false };
  try {
    await db.ledgerEntry.create({
      data: {
        orderId: input.orderId ?? null,
        sellerId: input.sellerId ?? null,
        type: input.type,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        memo: input.memo,
      },
    });
    return { created: true };
  } catch (e) {
    // 동시 요청에서 unique 충돌이 나면 이미 기록된 것으로 본다.
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { created: false };
    }
    throw e;
  }
}

export async function orderLedgerBalance(db: Db, orderId: string) {
  const rows = await db.ledgerEntry.groupBy({
    by: ["type"],
    where: { orderId },
    _sum: { amount: true },
  });
  const get = (t: LedgerType) => rows.find((r) => r.type === t)?._sum.amount ?? 0;
  const paidIn = get("PAYMENT_IN");
  const paidOut = get("PAYOUT_OUT");
  const refundedOut = get("REFUND_OUT");
  const withholding = get("WITHHOLDING_TAX");
  const commission = get("COMMISSION");
  const paymentFee = get("PAYMENT_FEE");
  return {
    paidIn,
    paidOut,
    refundedOut,
    withholding,
    commission,
    paymentFee,
    /** 판매자에게 실제로 지급/환불될 수 있는 잔액 */
    available: paidIn - paidOut - refundedOut,
  };
}

/** 주문 결제 완료 시 원장에 매출/수수료를 기록한다. */
export async function recordPaymentLedger(order: {
  id: string;
  sellerId: string;
  grossAmount: number;
  commissionAmount: number;
  paymentFeeAmount: number;
  withholdingTax: number;
}) {
  await prisma.$transaction(async (tx) => {
    await postLedger(tx, {
      orderId: order.id,
      sellerId: order.sellerId,
      type: "PAYMENT_IN",
      amount: order.grossAmount,
      idempotencyKey: `payment-in:${order.id}`,
      memo: "결제 승인 금액",
    });
    await postLedger(tx, {
      orderId: order.id,
      sellerId: order.sellerId,
      type: "COMMISSION",
      amount: order.commissionAmount,
      idempotencyKey: `commission:${order.id}`,
      memo: "플랫폼 수수료",
    });
    if (order.paymentFeeAmount > 0) {
      await postLedger(tx, {
        orderId: order.id,
        sellerId: order.sellerId,
        type: "PAYMENT_FEE",
        amount: order.paymentFeeAmount,
        idempotencyKey: `payment-fee:${order.id}`,
        memo: "결제 비용",
      });
    }
    if (order.withholdingTax > 0) {
      await postLedger(tx, {
        orderId: order.id,
        sellerId: order.sellerId,
        type: "WITHHOLDING_TAX",
        amount: order.withholdingTax,
        idempotencyKey: `withholding:${order.id}`,
        memo: "개인 판매자 원천징수 3.3%",
      });
    }
  });
}
