import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { hasOperatorScope, isOperator, type Actor } from "./rbac";

export type OrderPurpose = "VIEW" | "DOWNLOAD" | "INSPECT" | "SELLER_ACTION" | "SETTLEMENT";

export interface OrderAccessRecord {
  id: string;
  buyerId: string;
  buyerCompanyId: string | null;
  sellerId: string;
  sellerUserId?: string | null;
}

/**
 * 주문 접근 권한을 한 곳에서 판정한다.
 * 구매자·기업 구성원·판매자·운영자를 구분하고, 목적별로 더 좁게 제한한다.
 */
export function canAccessOrder(actor: Actor, order: OrderAccessRecord, purpose: OrderPurpose): boolean {
  const isBuyerSide =
    order.buyerId === actor.id ||
    (!!order.buyerCompanyId && actor.companyId === order.buyerCompanyId);
  const isSellerSide =
    (!!actor.sellerProfileId && order.sellerId === actor.sellerProfileId) ||
    (!!order.sellerUserId && order.sellerUserId === actor.id);

  if (purpose === "SETTLEMENT") {
    if (isSellerSide) return true;
    if (isBuyerSide && actor.companyRole === "ADMIN") return true;
    return hasOperatorScope(actor, "SETTLEMENT");
  }

  if (purpose === "SELLER_ACTION") return isSellerSide || hasOperatorScope(actor, "REVIEW");

  if (purpose === "INSPECT") {
    if (isBuyerSide) return true;
    if (isSellerSide) return true; // 판매자는 확인용으로 결과를 볼 수 있다.
    return isOperator(actor);
  }

  if (purpose === "DOWNLOAD") {
    if (isBuyerSide) return true;
    return isOperator(actor); // 운영자는 분쟁 검토 목적으로만 접근(감사 로그 기록)
  }

  if (isBuyerSide || isSellerSide) return true;
  return isOperator(actor);
}

export async function loadOrderForActor(actor: Actor, orderId: string, purpose: OrderPurpose) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      product: true,
      seller: { include: { user: true } },
      buyer: true,
      files: true,
      payments: true,
      escrow: true,
      deliveries: { orderBy: { deliveredAt: "desc" } },
      inspections: { orderBy: { decidedAt: "desc" } },
      disputes: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { requestedAt: "desc" } },
      payout: true,
      ledger: true,
      grants: true,
      consents: true,
    },
  });
  if (!order) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const allowed = canAccessOrder(
    actor,
    {
      id: order.id,
      buyerId: order.buyerId,
      buyerCompanyId: order.buyerCompanyId,
      sellerId: order.sellerId,
      sellerUserId: order.seller.userId,
    },
    purpose,
  );

  if (!allowed) {
    throw new DomainError(
      "FORBIDDEN",
      purpose === "SETTLEMENT"
        ? "정산 정보는 거래 당사자와 정산 담당자만 열람할 수 있습니다."
        : "이 주문에 접근할 권한이 없습니다.",
      403,
    );
  }
  return order;
}
