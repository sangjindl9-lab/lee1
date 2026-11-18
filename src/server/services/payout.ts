import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatKrw } from "@/lib/money";
import { loadOrderForActor } from "./access";
import { audit, notify } from "./audit";
import { orderLedgerBalance, postLedger } from "./ledger";
import { hasOperatorScope, type Actor } from "./rbac";
import { getProvider } from "@/server/payments/provider";

/**
 * 판매자 지급 요청.
 * - 지급 요청 접수(REQUESTED)와 지급 완료(PAID)를 구분한다.
 * - 응답이 불명확하면(UNKNOWN) 재요청하지 않고 '조회 후 확정' 절차를 따른다.
 * - 환불 처리와 동시에 실행되어도 주문 행 잠금으로 한쪽만 진행된다.
 */
export async function requestPayout(
  actor: Actor,
  input: { orderId: string; simulateTimeout?: boolean; simulateFailure?: boolean },
) {
  const order = await loadOrderForActor(actor, input.orderId, "SETTLEMENT");
  const isSellerSide = order.seller.userId === actor.id;
  if (!isSellerSide && !hasOperatorScope(actor, "SETTLEMENT")) {
    throw new DomainError("FORBIDDEN", "판매자 또는 정산 담당자만 지급을 요청할 수 있습니다.", 403);
  }

  const amount = Math.max(0, order.sellerNetAmount - order.refundedAmount);

  const payout = await prisma.$transaction(async (tx) => {
    // 주문 행을 잠가 환불 처리와의 경쟁을 직렬화한다.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const fresh = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { payout: true, refunds: true },
    });
    if (!fresh) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

    if (fresh.paymentStatus !== "PAID" && fresh.paymentStatus !== "PARTIALLY_REFUNDED") {
      throw new DomainError("PAYMENT_REQUIRED", "결제가 확인되지 않아 정산할 수 없습니다.", 402);
    }
    if (fresh.deliveryStatus !== "DELIVERED") {
      throw new DomainError("STATE_NOT_ALLOWED", "납품이 완료되지 않아 정산할 수 없습니다.", 409);
    }
    if (fresh.inspectionStatus !== "APPROVED" && fresh.inspectionStatus !== "AUTO_CONFIRMED") {
      throw new DomainError("STATE_NOT_ALLOWED", "검수가 승인되지 않아 정산할 수 없습니다.", 409);
    }
    if (fresh.disputeStatus === "OPEN" || fresh.disputeStatus === "EVIDENCE" || fresh.disputeStatus === "NEGOTIATION") {
      throw new DomainError("STATE_NOT_ALLOWED", "분쟁이 진행 중인 거래는 지급할 수 없습니다.", 409);
    }
    if (
      ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "RECOVERY_REQUIRED", "UNSUPPORTED"].includes(
        fresh.refundStatus,
      )
    ) {
      throw new DomainError("STATE_NOT_ALLOWED", "환불이 진행 중이거나 완료된 거래는 지급할 수 없습니다.", 409);
    }
    if (fresh.payout) {
      throw new DomainError(
        "CONFLICT",
        "이미 지급 요청이 접수된 거래입니다. 중복 지급을 막기 위해 새 요청을 받지 않습니다. 진행 상태를 조회해 주세요.",
        409,
      );
    }
    if (amount <= 0) throw new DomainError("VALIDATION", "지급할 금액이 없습니다.");

    const balance = await orderLedgerBalance(tx, input.orderId);
    if (balance.available < amount) {
      throw new DomainError(
        "CONFLICT",
        `지급 가능한 잔액(${formatKrw(balance.available)})보다 요청 금액(${formatKrw(amount)})이 큽니다.`,
        409,
      );
    }

    const created = await tx.payout.create({
      data: {
        orderId: input.orderId,
        sellerId: fresh.sellerId,
        amount,
        withholdingTax: fresh.withholdingTax,
        status: "REQUESTED",
        idempotencyKey: `payout-req:${input.orderId}`,
        attempts: 1,
      },
    });

    await postLedger(tx, {
      orderId: input.orderId,
      sellerId: fresh.sellerId,
      type: "PAYOUT_OUT",
      amount,
      idempotencyKey: `payout:${input.orderId}`,
      memo: "판매자 지급 요청",
    });

    await tx.order.update({
      where: { id: input.orderId },
      data: { payoutStatus: "REQUESTED", rowVersion: { increment: 1 } },
    });

    return created;
  });

  await audit({
    actor,
    action: "PAYOUT_REQUESTED",
    targetType: "Order",
    targetId: input.orderId,
    after: { payoutId: payout.id, amount },
  });

  const provider = getProvider();
  const result = await provider.requestPayout({
    sellerId: order.sellerId,
    orderNo: order.orderNo,
    amount,
    idempotencyKey: `payout-req:${input.orderId}`,
    simulateTimeout: input.simulateTimeout,
    simulateFailure: input.simulateFailure,
  });

  if (result.status === "PAID") {
    await markPayoutPaid(payout.id, result.ref, actor);
    return { payoutId: payout.id, status: "PAID" as const, amount, message: result.message };
  }
  if (result.status === "UNKNOWN" || result.status === "PROCESSING") {
    await prisma.$transaction([
      prisma.payout.update({
        where: { id: payout.id },
        data: { status: "PROCESSING", providerRef: result.ref, lastError: result.message },
      }),
      prisma.order.update({ where: { id: input.orderId }, data: { payoutStatus: "PROCESSING" } }),
    ]);
    return {
      payoutId: payout.id,
      status: "PROCESSING" as const,
      amount,
      message:
        "지급 요청에 대한 응답이 확인되지 않았습니다. 중복 지급을 막기 위해 재요청하지 않고, 사업자 조회로 결과를 확정합니다.",
    };
  }

  // 실패: 원장 차감을 되돌린다.
  await prisma.$transaction(async (tx) => {
    await tx.payout.update({
      where: { id: payout.id },
      data: { status: "FAILED", lastError: result.message },
    });
    await postLedger(tx, {
      orderId: input.orderId,
      sellerId: order.sellerId,
      type: "ADJUSTMENT",
      amount,
      idempotencyKey: `payout-reversal:${payout.id}`,
      memo: "지급 실패로 인한 원장 차감 취소",
    });
    await tx.order.update({
      where: { id: input.orderId },
      data: { payoutStatus: "FAILED", rowVersion: { increment: 1 } },
    });
  });
  await audit({
    actor,
    action: "PAYOUT_FAILED",
    targetType: "Order",
    targetId: input.orderId,
    after: { payoutId: payout.id, message: result.message },
  });
  throw new DomainError("PROVIDER_UNAVAILABLE", `지급이 처리되지 않았습니다: ${result.message}`, 502);
}

/** 응답이 불명확한 지급 건의 결과를 사업자 조회로 확정한다. (재요청 금지) */
export async function resolvePayout(payoutId: string, actor?: Actor) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { order: { include: { seller: true } } },
  });
  if (!payout) throw new DomainError("NOT_FOUND", "지급 건을 찾을 수 없습니다.", 404);
  if (payout.status === "PAID" || payout.status === "FAILED") {
    return { status: payout.status, message: "이미 확정된 지급 건입니다." };
  }
  const provider = getProvider();
  const ref = payout.providerRef ?? `payout-req:${payout.orderId}`;
  const result = await provider.getPayout(ref);

  if (result.status === "PAID") {
    await markPayoutPaid(payout.id, result.ref, actor);
    return { status: "PAID" as const, message: "사업자 조회 결과 지급이 완료된 것으로 확인되었습니다." };
  }
  if (result.status === "FAILED") {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { status: "FAILED", lastError: result.message } });
      await postLedger(tx, {
        orderId: payout.orderId,
        sellerId: payout.sellerId,
        type: "ADJUSTMENT",
        amount: payout.amount,
        idempotencyKey: `payout-reversal:${payout.id}`,
        memo: "지급 실패 확정으로 원장 차감 취소",
      });
      if (payout.orderId) {
        await tx.order.update({ where: { id: payout.orderId }, data: { payoutStatus: "FAILED" } });
      }
    });
    return { status: "FAILED" as const, message: "사업자 조회 결과 지급이 실패했습니다. 원장 차감을 되돌렸습니다." };
  }
  return { status: "PROCESSING" as const, message: "아직 처리 중입니다. 잠시 후 다시 조회해 주세요." };
}

async function markPayoutPaid(payoutId: string, ref: string | null, actor?: Actor) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.payout.update({
      where: { id: payoutId },
      data: { status: "PAID", paidAt: now, providerRef: ref ?? payout.providerRef },
    }),
    ...(payout.orderId
      ? [
          prisma.order.update({
            where: { id: payout.orderId },
            data: { payoutStatus: "PAID", settledAt: now, rowVersion: { increment: 1 } },
          }),
        ]
      : []),
  ]);
  await audit({
    actor: actor ?? null,
    action: "PAYOUT_PAID",
    targetType: "Payout",
    targetId: payoutId,
    after: { amount: payout.amount, ref },
  });
}

/** 판매자에게 보여줄 예상 정산액 미리보기. */
export async function previewSettlement(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
  const balance = await orderLedgerBalance(prisma, orderId);
  return {
    gross: order.grossAmount,
    commission: order.commissionAmount,
    paymentFee: order.paymentFeeAmount,
    withholdingTax: order.withholdingTax,
    refunded: order.refundedAmount,
    net: order.sellerNetAmount,
    available: balance.available,
  };
}
