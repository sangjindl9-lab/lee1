import { prisma } from "@/lib/db";
import { getProvider } from "@/server/payments/provider";

/**
 * 대사(Reconciliation) — 플랫폼 내부 상태와 결제 사업자 상태를 비교한다.
 * 불일치는 자동으로 고치지 않고 목록으로 남겨 운영자가 확인하게 한다.
 */
export async function runReconciliation(note?: string) {
  const provider = getProvider();
  const run = await prisma.reconciliationRun.create({ data: { note: note ?? "정기 대사" } });

  const issues: Array<{ orderId?: string; field: string; internal: string; external: string; kind: string }> = [];
  let checked = 0;

  const payments = await prisma.payment.findMany({
    where: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "AUTHORIZED", "CANCELLED"] } },
    include: { order: true },
  });

  for (const payment of payments) {
    checked += 1;
    const external = await provider.getPayment(payment.providerTxId);
    if (!external) {
      issues.push({
        orderId: payment.orderId,
        field: "payment.existence",
        internal: payment.status,
        external: "NOT_FOUND",
        kind: "MISSING_EXTERNAL",
      });
      continue;
    }
    if (external.status !== payment.status && !(external.status === "PAID" && payment.status === "PARTIALLY_REFUNDED")) {
      issues.push({
        orderId: payment.orderId,
        field: "payment.status",
        internal: payment.status,
        external: external.status,
        kind: "STATUS_MISMATCH",
      });
    }
    if (external.amount !== payment.amount) {
      issues.push({
        orderId: payment.orderId,
        field: "payment.amount",
        internal: String(payment.amount),
        external: String(external.amount),
        kind: "AMOUNT_MISMATCH",
      });
    }
  }

  // 원장 합계와 주문 금액 비교
  const orders = await prisma.order.findMany({
    where: { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    include: { ledger: true, payout: true },
  });
  for (const order of orders) {
    checked += 1;
    const paidIn = order.ledger.filter((l) => l.type === "PAYMENT_IN").reduce((s, l) => s + l.amount, 0);
    if (paidIn !== order.grossAmount) {
      issues.push({
        orderId: order.id,
        field: "ledger.payment_in",
        internal: String(paidIn),
        external: String(order.grossAmount),
        kind: "LEDGER_MISMATCH",
      });
    }
    if (order.payout && order.payout.status === "PAID") {
      const externalPayout = order.payout.providerRef ? await provider.getPayout(order.payout.providerRef) : null;
      if (externalPayout && externalPayout.status !== "PAID") {
        issues.push({
          orderId: order.id,
          field: "payout.status",
          internal: order.payout.status,
          external: externalPayout.status,
          kind: "STATUS_MISMATCH",
        });
      }
    }
  }

  if (issues.length > 0) {
    await prisma.reconciliationIssue.createMany({
      data: issues.map((i) => ({
        runId: run.id,
        orderId: i.orderId,
        field: i.field,
        internal: i.internal,
        external: i.external,
        kind: i.kind,
      })),
    });
  }

  return prisma.reconciliationRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), checked, mismatchCount: issues.length },
    include: { issues: true },
  });
}

export interface SettlementSummary {
  grossTotal: number;
  commissionTotal: number;
  payoutTotal: number;
  refundTotal: number;
  platformRevenue: number;
}

/** 통계 — 총 거래액과 플랫폼 수수료 수익을 구분한다. */
export async function settlementSummary(): Promise<SettlementSummary> {
  const [orders, payouts, refunds] = await Promise.all([
    prisma.order.findMany({
      where: { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      select: { grossAmount: true, commissionAmount: true, vatAmount: true },
    }),
    prisma.payout.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.refundRecord.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true } }),
  ]);
  const grossTotal = orders.reduce((s, o) => s + o.grossAmount, 0);
  const commissionTotal = orders.reduce((s, o) => s + o.commissionAmount, 0);
  const vatTotal = orders.reduce((s, o) => s + o.vatAmount, 0);
  return {
    grossTotal,
    commissionTotal,
    payoutTotal: payouts._sum.amount ?? 0,
    refundTotal: refunds._sum.amount ?? 0,
    platformRevenue: commissionTotal + vatTotal,
  };
}
