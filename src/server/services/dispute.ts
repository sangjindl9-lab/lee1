import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { getProvider } from "@/server/payments/provider";
import { newDisputeNo } from "@/lib/ids";
import { loadOrderForActor } from "./access";
import { audit, notify } from "./audit";
import { hasOperatorScope, type Actor } from "./rbac";

/**
 * 분쟁 접수.
 * - 분쟁 상태 변경만으로 외부 PG의 지급이 멈췄다고 가정하지 않는다.
 * - 외부 지급 중지 요청 결과(providerHoldState)를 따로 기록한다.
 */
export async function openDispute(
  actor: Actor,
  input: { orderId: string; category: string; body: string; evidence?: unknown },
) {
  const order = await loadOrderForActor(actor, input.orderId, "VIEW");

  if (order.disputeStatus !== "NONE" && order.disputeStatus !== "DECIDED" && order.disputeStatus !== "WITHDRAWN") {
    throw new DomainError("CONFLICT", "이미 분쟁이 접수되어 처리 중입니다.", 409);
  }
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
    throw new DomainError("PAYMENT_REQUIRED", "결제가 확인된 주문만 분쟁을 접수할 수 있습니다.", 402);
  }

  const provider = getProvider();
  let providerHoldState: "STOP_REQUESTED" | "NOT_REQUESTED" | "NOT_SUPPORTED" = "NOT_REQUESTED";
  let escrowRef = order.escrow?.providerRef ?? null;

  if (order.escrow?.providerRef) {
    const stop = await provider.stopHold(order.escrow.providerRef);
    providerHoldState = stop.ok ? "STOP_REQUESTED" : "NOT_SUPPORTED";
    escrowRef = order.escrow.providerRef;
  } else {
    providerHoldState = "NOT_SUPPORTED";
  }

  const dispute = await prisma.$transaction(async (tx) => {
    const created = await tx.dispute.create({
      data: {
        disputeNo: newDisputeNo(),
        orderId: order.id,
        openedById: actor.id,
        category: input.category,
        body: input.body,
        evidence: (input.evidence ?? undefined) as never,
        status: "OPEN",
        providerHoldState: providerHoldState,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        disputeStatus: "OPEN",
        payoutStatus: order.payoutStatus === "PAID" ? "PAID" : "ON_HOLD",
        escrowStatus: providerHoldState === "STOP_REQUESTED" ? "STOP_REQUESTED" : order.escrowStatus,
        rowVersion: { increment: 1 },
      },
    });
    if (order.escrow) {
      await tx.escrowRecord.update({
        where: { orderId: order.id },
        data: {
          holdState: providerHoldState === "STOP_REQUESTED" ? "STOP_REQUESTED" : order.escrow.holdState,
          note:
            providerHoldState === "STOP_REQUESTED"
              ? "분쟁 접수로 지급 중지를 요청했습니다. (테스트 PG 모의 처리)"
              : "결제 사업자가 지급 중지를 지원하지 않아 플랫폼 내부 정산만 보류합니다.",
        },
      });
    }
    return created;
  });

  await audit({
    actor,
    action: "DISPUTE_OPENED",
    targetType: "Order",
    targetId: order.id,
    after: { disputeNo: dispute.disputeNo, category: input.category, providerHoldState },
  });
  await notify({
    userId: order.seller.userId === actor.id ? order.buyerId : order.seller.userId,
    kind: "DISPUTE_OPENED",
    title: "분쟁이 접수되었습니다",
    body: `사유: ${input.category}`,
    link: `/orders/${order.id}`,
  });

  return dispute;
}

export async function addDisputeEvidence(
  actor: Actor,
  input: { disputeId: string; body: string; files?: unknown },
) {
  const dispute = await prisma.dispute.findUnique({ where: { id: input.disputeId }, include: { order: true } });
  if (!dispute) throw new DomainError("NOT_FOUND", "분쟁 건을 찾을 수 없습니다.", 404);
  await loadOrderForActor(actor, dispute.orderId, "VIEW");
  if (dispute.status === "DECIDED" || dispute.status === "WITHDRAWN") {
    throw new DomainError("STATE_NOT_ALLOWED", "이미 종결된 분쟁에는 자료를 제출할 수 없습니다.", 409);
  }
  const existing = (dispute.evidence ?? []) as unknown[];
  const updated = await prisma.dispute.update({
    where: { id: dispute.id },
    data: {
      evidence: [
        ...existing,
        { by: actor.id, at: new Date().toISOString(), body: input.body, files: input.files ?? [] },
      ] as never,
      status: "EVIDENCE",
    },
  });
  await prisma.order.update({ where: { id: dispute.orderId }, data: { disputeStatus: "EVIDENCE" } });
  await audit({
    actor,
    action: "DISPUTE_EVIDENCE_ADDED",
    targetType: "Dispute",
    targetId: dispute.id,
  });
  return updated;
}

export type DisputeResolution = "REFUND" | "PARTIAL_REFUND" | "RESUME" | "PAYOUT";

/**
 * 관리자 판단 — 근거·처리자·일시를 기록한다.
 * AI는 이 함수를 호출할 수 없다(actor.isAi 차단). AI는 참고 의견만 낼 수 있다.
 */
export async function decideDispute(
  disputeId: string,
  actor: Actor,
  input: { resolution: DisputeResolution; reason: string; refundAmount?: number },
) {
  if (!hasOperatorScope(actor, "REVIEW") && !hasOperatorScope(actor, "SUPPORT")) {
    throw new DomainError("FORBIDDEN", "분쟁 판단은 심사·고객지원 담당자만 수행할 수 있습니다.", 403);
  }
  if (actor.isAi) {
    throw new DomainError(
      "FORBIDDEN",
      "분쟁의 최종 판단은 AI가 단독으로 내릴 수 없습니다. 담당자가 근거를 검토해 결정해야 합니다.",
      403,
    );
  }
  if (!input.reason || input.reason.trim().length < 10) {
    throw new DomainError("VALIDATION", "판단 근거를 10자 이상 기록해야 합니다.");
  }

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { order: { include: { seller: true } } },
  });
  if (!dispute) throw new DomainError("NOT_FOUND", "분쟁 건을 찾을 수 없습니다.", 404);
  if (dispute.status === "DECIDED" || dispute.status === "WITHDRAWN") {
    throw new DomainError("CONFLICT", "이미 종결된 분쟁입니다.", 409);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status: "DECIDED",
        resolution: input.resolution,
        decisionReason: input.reason,
        decidedById: actor.id,
        decidedAt: now,
      },
    });
    await tx.order.update({
      where: { id: dispute.orderId },
      data: {
        disputeStatus: "DECIDED",
        escrowStatus:
          input.resolution === "PAYOUT"
            ? "RELEASED"
            : input.resolution === "RESUME"
              ? "HELD"
              : dispute.order.escrowStatus,
        payoutStatus:
          input.resolution === "PAYOUT"
            ? "ELIGIBLE"
            : input.resolution === "RESUME"
              ? "NOT_ELIGIBLE"
              : "ON_HOLD",
        rowVersion: { increment: 1 },
      },
    });
  });

  if (input.resolution === "REFUND" || input.resolution === "PARTIAL_REFUND") {
    const { requestRefund } = await import("./refund");
    // 운영자 판단에 따른 환불 접수 (구매자 대신 접수)
    const buyerActor = await prisma.order.findUnique({ where: { id: dispute.orderId }, select: { buyerId: true } });
    if (buyerActor) {
      await prisma.refundRecord.create({
        data: {
          orderId: dispute.orderId,
          amount: input.refundAmount ?? dispute.order.grossAmount - dispute.order.refundedAmount,
          reason: `분쟁 판결(${dispute.disputeNo}): ${input.reason}`,
          status: "APPROVED",
        },
      });
      await prisma.order.update({
        where: { id: dispute.orderId },
        data: { refundStatus: "APPROVED" },
      });
      // requestRefund는 구매자 행위이므로 직접 기록하고, 실제 취소는 processRefund에서 수행한다.
      void requestRefund;
    }
  }

  await audit({
    actor,
    action: "DISPUTE_DECIDED",
    targetType: "Dispute",
    targetId: dispute.id,
    after: { resolution: input.resolution, reason: input.reason },
  });
  await notify({
    userId: dispute.order.buyerId,
    kind: "DISPUTE_DECIDED",
    title: "분쟁 판단이 완료되었습니다",
    body: `${input.resolution} · ${input.reason}`,
    link: `/orders/${dispute.orderId}`,
  });
  await notify({
    userId: dispute.order.seller.userId,
    kind: "DISPUTE_DECIDED",
    title: "분쟁 판단이 완료되었습니다",
    body: `${input.resolution} · ${input.reason}`,
    link: `/orders/${dispute.orderId}`,
  });

  return { disputeId: dispute.id, resolution: input.resolution, decidedAt: now };
}

/**
 * AI 참고 의견 — 최종 판단이 아니다.
 * 반환값은 화면에 '참고'로만 표시하고, 어떤 상태도 바꾸지 않는다.
 */
export function suggestDisputeDecision(input: {
  category: string;
  buyerStatement: string;
  sellerStatement: string;
  deliveredFileCount: number;
  inspectionApproved: boolean;
}): { suggestion: string; isFinal: false; disclaimer: string } {
  const parts: string[] = [];
  if (input.deliveredFileCount === 0) parts.push("납품물이 확인되지 않아 미납품 가능성이 있습니다.");
  if (input.inspectionApproved) parts.push("검수 승인 이력이 있어 단순 변심 환불 요구는 제한될 수 있습니다.");
  if (input.category.includes("SOURCE") || input.category.includes("FILE")) {
    parts.push("소스·파일 관련 주장은 해시·다운로드 이력으로 사실관계를 확인해야 합니다.");
  }
  if (parts.length === 0) parts.push("양측 자료를 비교해 계약 조건 충족 여부를 확인해야 합니다.");
  return {
    suggestion: parts.join(" "),
    isFinal: false,
    disclaimer:
      "이 문장은 AI 참고 의견이며 최종 판단이 아닙니다. 환불·권리 분쟁의 결정은 담당자가 근거를 검토해 내려야 합니다.",
  };
}
