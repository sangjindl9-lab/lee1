import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { getFile, storageKeyIsValid } from "@/server/storage/vault";
import { loadOrderForActor } from "./access";
import { audit } from "./audit";
import type { Actor } from "./rbac";

export const DOWNLOAD_TTL_MINUTES = 10;
export const DOWNLOAD_MAX_USES = 3;

export interface DownloadTicket {
  token: string;
  url: string;
  fileName: string;
  expiresAt: Date;
  remainingUses: number;
}

async function assertDownloadAllowed(order: {
  id: string;
  paymentStatus: string;
  refundStatus: string;
  escrowStatus: string;
  deliveryStatus: string;
}) {
  if (order.refundStatus === "COMPLETED" || order.refundStatus === "PARTIALLY_COMPLETED") {
    throw new DomainError(
      "STATE_NOT_ALLOWED",
      "환불이 완료된 주문입니다. 추가 다운로드가 차단되며, 이미 내려받은 파일은 회수되지 않습니다.",
      409,
    );
  }
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
    throw new DomainError(
      "PAYMENT_REQUIRED",
      "결제가 확인되지 않은 주문의 납품물에는 접근할 수 없습니다.",
      402,
    );
  }
  if (order.refundStatus === "PROCESSING" || order.refundStatus === "APPROVED") {
    throw new DomainError("STATE_NOT_ALLOWED", "환불 처리 중에는 추가 다운로드가 일시 중지됩니다.", 409);
  }
  if (order.escrowStatus === "STOPPED") {
    throw new DomainError("STATE_NOT_ALLOWED", "대금 지급 중지 상태에서는 추가 다운로드가 제한됩니다.", 409);
  }
  if (order.deliveryStatus === "WITHDRAWN") {
    throw new DomainError("STATE_NOT_ALLOWED", "납품이 철회된 주문입니다.", 409);
  }
}

/**
 * 다운로드 티켓 발급.
 * 다운로드와 구매확정·검수완료는 별개다. 다운로드 사실만으로 검수 완료를 표시하지 않는다.
 */
export async function issueDownload(
  actor: Actor,
  input: { orderId: string; orderFileId: string; ip?: string; userAgent?: string },
): Promise<DownloadTicket> {
  const order = await loadOrderForActor(actor, input.orderId, "DOWNLOAD");
  await assertDownloadAllowed(order);

  const file = order.files.find((f) => f.id === input.orderFileId);
  if (!file) throw new DomainError("NOT_FOUND", "해당 주문의 납품물이 아닙니다.", 404);
  if (file.sizeBytes <= 0) {
    throw new DomainError("FILE_INTEGRITY", "빈 파일입니다. 판매자에게 재납품을 요청해 주세요.", 409);
  }

  // 저장소에서 실제로 열 수 있는지, 해시가 주문 시점 스냅샷과 같은지 확인한다.
  let buffer: Buffer;
  try {
    buffer = await getFile(file.storageKey);
  } catch {
    throw new DomainError(
      "FILE_INTEGRITY",
      "납품물 저장소에서 파일을 읽지 못했습니다. 결제는 유지되며, 판매자·운영자가 복구하면 같은 주문에서 다시 받을 수 있습니다.",
      409,
    );
  }
  if (sha256Hex(buffer) !== file.sha256) {
    await prisma.downloadEvent.create({
      data: {
        orderId: order.id,
        orderFileId: file.id,
        userId: actor.id,
        ip: input.ip ?? actor.ip,
        userAgent: input.userAgent,
        allowed: false,
        reason: "HASH_MISMATCH",
      },
    });
    throw new DomainError(
      "FILE_INTEGRITY",
      "파일 해시가 주문 시점과 다릅니다. 파일이 교체되었을 수 있어 다운로드를 차단했습니다.",
      409,
    );
  }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MINUTES * 60 * 1000);
  await prisma.downloadGrant.create({
    data: {
      orderId: order.id,
      orderFileId: file.id,
      userId: actor.id,
      tokenHash: sha256Hex(token),
      expiresAt,
      maxUses: DOWNLOAD_MAX_USES,
    },
  });

  await audit({
    actor,
    action: "DOWNLOAD_TICKET_ISSUED",
    targetType: "Order",
    targetId: order.id,
    after: { file: file.fileName, expiresAt },
  });

  return {
    token,
    url: `/api/downloads/${token}`,
    fileName: file.fileName,
    expiresAt,
    remainingUses: DOWNLOAD_MAX_USES,
  };
}

/** 만료되는 서명 다운로드 URL의 실제 처리. */
export async function redeemDownload(
  token: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ fileName: string; buffer: Buffer }> {
  const grant = await prisma.downloadGrant.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { order: { include: { files: true } } },
  });
  if (!grant) throw new DomainError("FORBIDDEN", "유효하지 않은 다운로드 링크입니다.", 403);
  if (grant.revokedAt) throw new DomainError("FORBIDDEN", "회수된 다운로드 링크입니다.", 403);
  if (grant.expiresAt.getTime() < Date.now()) {
    throw new DomainError("FORBIDDEN", "다운로드 링크가 만료되었습니다. 다시 발급받아 주세요.", 403);
  }
  if (grant.usedCount >= grant.maxUses) {
    throw new DomainError("FORBIDDEN", "다운로드 가능 횟수를 초과했습니다. 다시 발급받아 주세요.", 403);
  }

  await assertDownloadAllowed(grant.order);

  const file = grant.order.files.find((f) => f.id === grant.orderFileId);
  if (!file) throw new DomainError("NOT_FOUND", "납품물을 찾을 수 없습니다.", 404);

  const buffer = await getFile(file.storageKey);
  if (sha256Hex(buffer) !== file.sha256) {
    await prisma.downloadEvent.create({
      data: {
        orderId: grant.orderId,
        orderFileId: file.id,
        userId: grant.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        allowed: false,
        reason: "HASH_MISMATCH",
      },
    });
    throw new DomainError("FILE_INTEGRITY", "파일 무결성 검사에 실패했습니다.", 409);
  }

  await prisma.$transaction([
    prisma.downloadGrant.update({
      where: { id: grant.id },
      data: { usedCount: { increment: 1 } },
    }),
    prisma.downloadEvent.create({
      data: {
        orderId: grant.orderId,
        orderFileId: file.id,
        userId: grant.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        allowed: true,
        reason: "OK",
      },
    }),
  ]);

  return { fileName: file.fileName, buffer };
}

/** 환불·분쟁 시 기존 다운로드 링크를 모두 회수한다. */
export async function revokeGrants(orderId: string, reason: string) {
  const res = await prisma.downloadGrant.updateMany({
    where: { orderId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({
    actor: null,
    action: "DOWNLOAD_GRANTS_REVOKED",
    targetType: "Order",
    targetId: orderId,
    after: { revoked: res.count, reason },
  });
  return res.count;
}
