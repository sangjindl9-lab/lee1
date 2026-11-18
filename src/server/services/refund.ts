import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatKrw } from "@/lib/money";
import { getProvider } from "@/server/payments/provider";
import { loadOrderForActor } from "./access";
import { audit, notify } from "./audit";
import { postLedger } from "./ledger";
import { revokeGrants } from "./downloads";
import { hasOperatorScope, type Actor } from "./rbac";

/**
 * 환불 요청 접수 — 요청과 완료는 별개다.
 * 이 단계에서는 어떤 금액도 실제로 돌려주지 않는다.
 */
export async function requestRefund(
  actor: Actor,
  input: { orderId: string; amount?: number; reason: string },
) {
  const order = await loadOrderForActor(actor, input.orderId, "VIEW");
  const isBuyerSide =
    order.buyerId === actor.id ||
    (!!order.buyerCompanyId && actor.companyId === order.buyerCompanyId);
  if (!isBuyerSide) throw new DomainError("FORBIDDEN", "구매자만 환불을 요청할 수 있습니다.", 403);

  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
    throw new DomainError("PAYMENT_REQUIRED", "결제가 확인된 주문만 환불을 요청할 수 있습니다.", 402);
  }
  if (["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "RECOVERY_REQUIRED"].includes(order.refundStatus)) {
    throw new DomainError("CONFLICT", "이미 환불이 접수되었거나 진행 중입니다.", 409);
  }

  const remaining = order.grossAmount - order.refundedAmount;
  const amount = Math.min(input.amount ?? remaining, remaining);
  if (amount <= 0) throw new DomainError("VALIDATION", "환불 금액이 올바르지 않습니다.");

  const refund = await prisma.$transaction(async (tx) => {
    const created = await tx.refundRecord.create({
      data: {
        orderId: order.id,
        amount,
        reason: input.reason,
        status: "REQUESTED",
        partialSupported: true,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { refundStatus: "REQUESTED", rowVersion: { increment: 1 } },
    });
    return created;
  });

  await audit({
    actor,
    action: "REFUND_REQUESTED",
    targetType: "Order",
    targetId: order.id,
    after: { refundId: refund.id, amount, reason: input.reason },
  });
  await notify({
    userId: order.seller.userId,
    kind: "REFUND_REQUESTED",
    title: "환불 요청이 접수되었습니다",
    body: `${formatKrw(amount)} · ${input.reason}`,
    link: `/orders/${order.id}`,
  });

  return { refundId: refund.id, status: "REQUESTED" as const, amount };
}

/**
 * 환불 처리(운영자) — 실제 결제 취소 성공을 확인한 뒤에만 COMPLETED 로 바꾼다.
 * 이미 정산이 끝난 거래는 일반 보류 절차로 되돌리지 않고 사후 환수 검토로 분리한다.
 */
export async function processRefund(
  refundId: string,
  actor: Actor,
  options: { approve: boolean; note?: string },
) {
  if (!hasOperatorScope(actor, "SETTLEMENT")) {
    throw new DomainError("FORBIDDEN", "환불 처리는 정산 담당자만 수행할 수 있습니다.", 403);
  }
  if (actor.isAi) {
    throw new DomainError("FORBIDDEN", "환불의 최종 처리는 AI가 단독으로 결정할 수 없습니다.", 403);
  }

  const refund = await prisma.refundRecord.findUnique({
    where: { id: refundId },
    include: { order: { include: { payments: { orderBy: { createdAt: "desc" }, take: 1 }, seller: true } } },
  });
  if (!refund) throw new DomainError("NOT_FOUND", "환불 요청을 찾을 수 없습니다.", 404);
  if (refund.status === "COMPLETED" || refund.status === "PARTIALLY_COMPLETED") {
    throw new DomainError("CONFLICT", "이미 완료된 환불입니다.", 409);
  }
  const order = refund.order;

  if (!options.approve) {
    await prisma.$transaction([
      prisma.refundRecord.update({
        where: { id: refund.id },
        data: { status: "REJECTED", failureReason: options.note ?? "운영자 반려" },
      }),
      prisma.order.update({ where: { id: order.id }, data: { refundStatus: "REJECTED" } }),
    ]);
    await audit({
      actor,
      action: "REFUND_REJECTED",
      targetType: "Order",
      targetId: order.id,
      after: { refundId, note: options.note },
    });
    return { status: "REJECTED" as const, message: "환불 요청을 반려했습니다." };
  }

  // 주문 행 잠금: 지급 처리와의 경쟁을 막는다.
  const guard = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const fresh = await tx.order.findUnique({
      where: { id: order.id },
      include: { payout: true },
    });
    if (!fresh) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

    if (fresh.payout && fresh.payout.status === "PAID") {
      await tx.refundRecord.update({
        where: { id: refund.id },
        data: {
          status: "RECOVERY_REQUIRED",
          failureReason: "이미 정산이 완료된 거래입니다. 사후 환수 절차가 필요합니다.",
        },
      });
      await tx.order.update({ where: { id: order.id }, data: { refundStatus: "RECOVERY_REQUIRED" } });
      return { kind: "RECOVERY" as const };
    }
    if (fresh.payout && (fresh.payout.status === "REQUESTED" || fresh.payout.status === "PROCESSING")) {
      throw new DomainError(
        "CONFLICT",
        "판매자 지급이 진행 중입니다. 지급 결과를 먼저 확정한 뒤 환불을 처리해 주세요.",
        409,
      );
    }
    if (fresh.paymentStatus !== "PAID" && fresh.paymentStatus !== "PARTIALLY_REFUNDED") {
      throw new DomainError("PAYMENT_REQUIRED", "실제 결제가 확인되지 않아 환불할 수 없습니다.", 402);
    }

    await tx.refundRecord.update({ where: { id: refund.id }, data: { status: "PROCESSING" } });
    await tx.order.update({ where: { id: order.id }, data: { refundStatus: "PROCESSING" } });
    return { kind: "PROCEED" as const };
  });

  if (guard.kind === "RECOVERY") {
    await audit({
      actor,
      action: "REFUND_POST_SETTLEMENT_RECOVERY",
      targetType: "Order",
      targetId: order.id,
      after: { refundId },
    });
    await notify({
      userId: order.seller.userId,
      kind: "POST_SETTLEMENT_RECOVERY",
      title: "사후 환수 검토가 필요합니다",
      body: "이미 정산이 완료된 거래의 환불 요청입니다. 정산 담당자가 별도 환수 절차를 진행합니다.",
      link: `/orders/${order.id}`,
    });
    return {
      status: "RECOVERY_REQUIRED" as const,
      message:
        "이미 정산이 완료된 거래입니다. 일반 환불 절차가 아닌 사후 환수 절차로 접수되었으며, 별도 회수 검토가 필요합니다.",
    };
  }

  const provider = getProvider();
  const payment = order.payments[0];
  if (!payment) throw new DomainError("PAYMENT_STATE_MISMATCH", "결제 내역이 없습니다.", 409);

  const result = await provider.refundPayment({
    txId: payment.providerTxId,
    orderNo: order.orderNo,
    amount: refund.amount,
    fullAmount: payment.amount,
    method: payment.method,
    idempotencyKey: `refund:${refund.id}`,
  });

  if (result.status === "UNSUPPORTED") {
    await prisma.$transaction([
      prisma.refundRecord.update({
        where: { id: refund.id },
        data: { status: "UNSUPPORTED", failureReason: result.message, partialSupported: false },
      }),
      prisma.order.update({ where: { id: order.id }, data: { refundStatus: "UNSUPPORTED" } }),
    ]);
    await audit({
      actor,
      action: "REFUND_UNSUPPORTED",
      targetType: "Order",
      targetId: order.id,
      after: { message: result.message },
    });
    return { status: "UNSUPPORTED" as const, message: result.message };
  }

  if (result.status === "FAILED") {
    await prisma.$transaction([
      prisma.refundRecord.update({
        where: { id: refund.id },
        data: { status: "FAILED", failureReason: result.message },
      }),
      prisma.order.update({ where: { id: order.id }, data: { refundStatus: "FAILED" } }),
    ]);
    throw new DomainError("PROVIDER_UNAVAILABLE", `환불이 실패했습니다: ${result.message}`, 502);
  }

  const isFull = refund.amount >= payment.amount;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.refundRecord.update({
      where: { id: refund.id },
      data: { status: "COMPLETED", completedAt: now, providerRefundId: result.refundId, partialSupported: true },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        refundStatus: isFull ? "COMPLETED" : "PARTIALLY_COMPLETED",
        paymentStatus: isFull ? "REFUNDED" : "PARTIALLY_REFUNDED",
        refundedAmount: { increment: refund.amount },
        payoutStatus: "NOT_ELIGIBLE",
        rowVersion: { increment: 1 },
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: isFull ? "REFUNDED" : "PARTIALLY_REFUNDED",
        cancelledAmount: { increment: refund.amount },
      },
    });
    await postLedger(tx, {
      orderId: order.id,
      sellerId: order.sellerId,
      type: "REFUND_OUT",
      amount: refund.amount,
      idempotencyKey: `refund-ledger:${refund.id}`,
      memo: "구매자 환불",
    });
  });

  await revokeGrants(order.id, "환불 완료로 다운로드 링크 회수");

  await audit({
    actor,
    action: "REFUND_COMPLETED",
    targetType: "Order",
    targetId: order.id,
    after: { refundId, amount: refund.amount, provider: result.refundId },
  });
  await notify({
    userId: order.buyerId,
    kind: "REFUND_COMPLETED",
    title: "환불이 완료되었습니다",
    body: `${formatKrw(refund.amount)} 환불 · 이미 다운로드한 파일은 회수되지 않으므로 이용을 중단해 주세요.`,
    link: `/orders/${order.id}`,
  });
  await notify({
    userId: order.seller.userId,
    kind: "REFUND_COMPLETED",
    title: "환불이 처리되었습니다",
    body: formatKrw(refund.amount),
    link: `/orders/${order.id}`,
  });

  return {
    status: (isFull ? "COMPLETED" : "PARTIALLY_COMPLETED") as "COMPLETED" | "PARTIALLY_COMPLETED",
    message: result.message,
    limitationNote:
      "이미 구매자가 내려받은 파일은 플랫폼이 원격으로 삭제하거나 회수할 수 없습니다. 추가 다운로드만 차단됩니다.",
  };
}
