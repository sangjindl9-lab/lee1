import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { sha256Hex } from "@/lib/crypto";
import { getFile } from "@/server/storage/vault";
import { loadOrderForActor } from "./access";
import { audit, notify } from "./audit";
import type { Actor } from "./rbac";

/**
 * 납품 처리.
 * 납품물이 실제로 열리지 않으면 검수 기간을 시작하지 않고 INCOMPLETE 로 남긴다.
 * (검수 기간은 구매자가 '검수 시작'을 눌러야 시작된다)
 */
export async function deliverOrder(
  actor: Actor,
  input: { orderId: string; note?: string },
) {
  const order = await loadOrderForActor(actor, input.orderId, "SELLER_ACTION");

  if (order.type !== "CUSTOM_STAGE" && order.paymentStatus !== "PAID") {
    throw new DomainError("PAYMENT_REQUIRED", "결제가 확인된 뒤에 납품할 수 있습니다.", 402);
  }
  if (order.files.length === 0 && order.type === "CUSTOM_STAGE") {
    // 맞춤 개발 단계는 산출물이 메시지·외부 링크로 전달될 수 있어 파일 없이도 납품 처리한다.
    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.create({
        data: {
          orderId: order.id,
          attempt: order.deliveries.length + 1,
          fileIds: [] as never,
          note: input.note ?? "단계 산출물 납품(파일 미첨부)",
          status: "DELIVERED",
          deliveredById: actor.id,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          deliveryStatus: "DELIVERED",
          inspectionStartedAt: now,
          inspectionEndsAt: new Date(now.getTime() + order.inspectionDays * 86400000),
          rowVersion: { increment: 1 },
        },
      });
      return delivery;
    });
    await notify({
      userId: order.buyerId,
      kind: "DELIVERED",
      title: "단계 산출물이 납품되었습니다",
      body: input.note ?? undefined,
      link: `/orders/${order.id}`,
    });
    return created;
  }
  if (order.files.length === 0) {
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveryStatus: "INCOMPLETE", rowVersion: { increment: 1 } },
    });
    throw new DomainError(
      "FILES_UNSAFE",
      "납품할 파일이 없습니다. 사전 납품물을 먼저 등록해 주세요.",
      409,
    );
  }

  const problems: string[] = [];
  for (const file of order.files) {
    if (file.sizeBytes <= 0) {
      problems.push(`${file.fileName}: 빈 파일`);
      continue;
    }
    try {
      const buffer = await getFile(file.storageKey);
      if (buffer.length === 0) problems.push(`${file.fileName}: 빈 파일`);
      else if (sha256Hex(buffer) !== file.sha256) problems.push(`${file.fileName}: 해시 불일치`);
    } catch {
      problems.push(`${file.fileName}: 저장소에서 읽을 수 없음`);
    }
  }

  if (problems.length > 0) {
    await prisma.$transaction([
      prisma.delivery.create({
        data: {
          orderId: order.id,
          attempt: order.deliveries.length + 1,
          fileIds: [] as never,
          note: input.note ?? null,
          status: "INCOMPLETE",
          deliveredById: actor.id,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { deliveryStatus: "INCOMPLETE", rowVersion: { increment: 1 } },
      }),
    ]);
    await notify({
      userId: order.buyerId,
      kind: "DELIVERY_INCOMPLETE",
      title: "납품물 확인이 필요합니다",
      body: `누락되거나 손상된 파일이 있습니다: ${problems.join(", ")}`,
      link: `/orders/${order.id}`,
    });
    throw new DomainError(
      "FILES_UNSAFE",
      `누락 또는 손상된 파일이 있어 납품을 완료할 수 없습니다: ${problems.join(", ")}`,
      409,
    );
  }

  const now = new Date();
  const inspectionEndsAt = new Date(now.getTime() + order.inspectionDays * 24 * 60 * 60 * 1000);

  const delivery = await prisma.$transaction(async (tx) => {
    const created = await tx.delivery.create({
      data: {
        orderId: order.id,
        attempt: order.deliveries.length + 1,
        fileIds: order.files.map((f) => f.id) as never,
        note: input.note ?? null,
        status: "DELIVERED",
        deliveredById: actor.id,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        deliveryStatus: "DELIVERED",
        inspectionStartedAt: now,
        inspectionEndsAt,
        rowVersion: { increment: 1 },
      },
    });
    return created;
  });

  await audit({
    actor,
    action: "ORDER_DELIVERED",
    targetType: "Order",
    targetId: order.id,
    after: { files: order.files.length, inspectionEndsAt },
  });
  await notify({
    userId: order.buyerId,
    kind: "DELIVERED",
    title: "납품물이 도착했습니다",
    body: `${order.orderNo} 주문의 검수 기한은 ${inspectionEndsAt.toLocaleDateString("ko-KR")}까지입니다.`,
    link: `/orders/${order.id}`,
  });

  return delivery;
}
