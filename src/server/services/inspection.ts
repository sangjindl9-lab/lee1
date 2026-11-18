import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { loadOrderForActor } from "./access";
import { audit, notify } from "./audit";
import type { Actor } from "./rbac";

export const DEFAULT_CHECKLIST = [
  { key: "filesExist", label: "계약상 파일이 모두 존재하는가" },
  { key: "installable", label: "설명서대로 설치할 수 있는가" },
  { key: "featuresWork", label: "약속한 기능이 작동하는가" },
  { key: "environmentOk", label: "합의한 환경에서 실행 가능한가" },
  { key: "sourceIncluded", label: "제공하기로 한 소스가 포함되어 있는가" },
  { key: "docsIncluded", label: "필요한 문서가 있는가" },
  { key: "noUndeclaredCost", label: "고지하지 않은 유료 의존성이 없는가" },
] as const;

export interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
  note?: string;
}

export async function startInspection(actor: Actor, orderId: string) {
  const order = await loadOrderForActor(actor, orderId, "INSPECT");
  if (order.paymentStatus !== "PAID") {
    throw new DomainError("PAYMENT_REQUIRED", "결제가 확인되지 않아 검수를 시작할 수 없습니다.", 402);
  }
  if (order.deliveryStatus !== "DELIVERED") {
    throw new DomainError(
      "STATE_NOT_ALLOWED",
      "납품이 완료되지 않아 검수를 시작할 수 없습니다. 납품물이 도착한 뒤 검수를 시작해 주세요.",
      409,
    );
  }
  if (order.files.length === 0 && order.type !== "CUSTOM_STAGE") {
    throw new DomainError("FILES_UNSAFE", "접근 가능한 납품물이 없어 검수를 시작할 수 없습니다.", 409);
  }
  if (order.inspectionStatus === "APPROVED" || order.inspectionStatus === "AUTO_CONFIRMED") {
    throw new DomainError("CONFLICT", "이미 검수가 완료된 주문입니다.", 409);
  }

  const endsAt =
    order.inspectionEndsAt ?? new Date(Date.now() + order.inspectionDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      inspectionStatus: "IN_PROGRESS",
      inspectionStartedAt: order.inspectionStartedAt ?? new Date(),
      inspectionEndsAt: endsAt,
      rowVersion: { increment: 1 },
    },
  });
  await audit({ actor, action: "INSPECTION_STARTED", targetType: "Order", targetId: order.id });
  return updated;
}

/**
 * 검수 결과 제출.
 * - 승인(APPROVED) → 정산 가능(ELIGIBLE)
 * - 수정 요청(REVISION_REQUESTED) → 정산 불가
 * 문제 제기는 분쟁 절차로 전환한다.
 */
export async function submitInspection(
  actor: Actor,
  input: {
    orderId: string;
    checklist: ChecklistItem[];
    decision: "APPROVED" | "REVISION_REQUESTED" | "DISPUTED";
    note?: string;
  },
) {
  const order = await loadOrderForActor(actor, input.orderId, "INSPECT");
  const isBuyerSide =
    order.buyerId === actor.id ||
    (!!order.buyerCompanyId && actor.companyId === order.buyerCompanyId);
  if (!isBuyerSide) {
    throw new DomainError("FORBIDDEN", "검수 결과는 구매자 측에서만 제출할 수 있습니다.", 403);
  }
  if (order.paymentStatus !== "PAID") {
    throw new DomainError("PAYMENT_REQUIRED", "결제가 확인되지 않아 검수할 수 없습니다.", 402);
  }
  if (order.deliveryStatus !== "DELIVERED") {
    throw new DomainError("STATE_NOT_ALLOWED", "납품 전에는 검수 결과를 제출할 수 없습니다.", 409);
  }
  if (order.inspectionStatus === "APPROVED" || order.inspectionStatus === "AUTO_CONFIRMED") {
    throw new DomainError("CONFLICT", "이미 검수가 완료된 주문입니다.", 409);
  }

  const requiredKeys = DEFAULT_CHECKLIST.map((c) => c.key);
  const submitted = new Map(input.checklist.map((c) => [c.key, c]));
  const missing = requiredKeys.filter((k) => !submitted.has(k));
  if (missing.length > 0) {
    throw new DomainError("VALIDATION", `검수 체크리스트가 누락되었습니다: ${missing.join(", ")}`);
  }
  if (input.decision === "APPROVED") {
    const unchecked = input.checklist.filter((c) => !c.checked);
    if (unchecked.length > 0) {
      throw new DomainError(
        "VALIDATION",
        `승인 전 모든 검수 항목을 확인해야 합니다: ${unchecked.map((c) => c.label).join(", ")}`,
      );
    }
  }

  const statusMap = {
    APPROVED: "APPROVED",
    REVISION_REQUESTED: "REVISION_REQUESTED",
    DISPUTED: "IN_PROGRESS",
  } as const;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.inspectionRecord.create({
      data: {
        orderId: order.id,
        checklist: input.checklist as never,
        result: statusMap[input.decision],
        note: input.note ?? null,
        decidedById: actor.id,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        inspectionStatus: statusMap[input.decision],
        confirmedAt: input.decision === "APPROVED" ? now : null,
        payoutStatus:
          input.decision === "APPROVED"
            ? "ELIGIBLE"
            : input.decision === "REVISION_REQUESTED"
              ? "NOT_ELIGIBLE"
              : "ON_HOLD",
        rowVersion: { increment: 1 },
      },
    });
  });

  if (input.decision === "DISPUTED") {
    const { openDispute } = await import("./dispute");
    await openDispute(actor, {
      orderId: order.id,
      category: "INSPECTION_ISSUE",
      body: input.note ?? "검수 중 문제가 제기되었습니다.",
    });
  }

  await audit({
    actor,
    action: `INSPECTION_${input.decision}`,
    targetType: "Order",
    targetId: order.id,
    after: { checklist: input.checklist, note: input.note },
  });
  await notify({
    userId: order.seller.userId,
    kind: "INSPECTION_RESULT",
    title:
      input.decision === "APPROVED"
        ? "검수가 승인되었습니다"
        : input.decision === "REVISION_REQUESTED"
          ? "수정 요청이 도착했습니다"
          : "검수 중 문제가 제기되었습니다",
    body: input.note ?? undefined,
    link: `/orders/${order.id}`,
  });

  return { decision: input.decision };
}

/** 검수 기한이 지나고 분쟁이 없으면 자동확정한다(외부 자동확정 일정과 충돌하지 않을 때만). */
export async function autoConfirmIfDue(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
  if (order.deliveryStatus !== "DELIVERED") return { confirmed: false, reason: "미납품" };
  if (order.disputeStatus !== "NONE") return { confirmed: false, reason: "분쟁 진행 중" };
  if (order.refundStatus !== "NONE") return { confirmed: false, reason: "환불 진행 중" };
  if (order.inspectionStatus === "APPROVED" || order.inspectionStatus === "AUTO_CONFIRMED") {
    return { confirmed: false, reason: "이미 확정" };
  }
  if (!order.inspectionEndsAt || order.inspectionEndsAt.getTime() > Date.now()) {
    return { confirmed: false, reason: "검수 기한 미도래" };
  }
  if (order.autoConfirmAt && order.autoConfirmAt.getTime() < order.inspectionEndsAt.getTime()) {
    return { confirmed: false, reason: "외부 자동확정 일정이 검수 기한보다 짧음" };
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: {
        inspectionStatus: "AUTO_CONFIRMED",
        confirmedAt: new Date(),
        payoutStatus: "ELIGIBLE",
        rowVersion: { increment: 1 },
      },
    }),
    prisma.inspectionRecord.create({
      data: {
        orderId: order.id,
        checklist: [] as never,
        result: "AUTO_CONFIRMED",
        note: "검수 기한 경과로 자동확정(운영 정책)",
      },
    }),
  ]);
  await audit({
    actor: null,
    action: "INSPECTION_AUTO_CONFIRMED",
    targetType: "Order",
    targetId: order.id,
  });
  return { confirmed: true };
}
