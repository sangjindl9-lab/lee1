import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { computeFees, type FeeBreakdown } from "@/lib/money";
import { resolveFeePolicy, sellerWithholdingRateBp } from "./fee-policy";
import { POLICY_VERSIONS } from "@/lib/brand";
import type { Actor } from "./rbac";
import { assertPurchaseAllowed, companyOrderContext } from "./rbac";

export interface OrderSnapshot {
  version: 1;
  capturedAt: string;
  product: {
    id: string;
    type: string;
    title: string;
    summary: string;
    category: string;
    licenseType: string;
    licenseMonths: number | null;
    seats: number | null;
    platforms: string[];
    sourceIncluded: boolean;
    installSupport: boolean;
    thirdPartyDeps: string | null;
    externalCostNote: string | null;
    priceKrw: number;
    inspectionDays: number;
    refundPolicy: string | null;
    deliveryNote: string | null;
    seller: { id: string; displayName: string; sellerType: string; userId: string };
  };
  files: Array<{
    productFileId: string;
    fileName: string;
    version: number;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
  }>;
  fee: {
    policyId: string | null;
    commissionRateBp: number;
    paymentFeeRateBp: number;
    paymentFeeBearer: string;
    discountRateBp: number;
    sellerType: string;
    withholdingRateBp: number;
    breakdown: FeeBreakdown;
    note: string;
  };
  terms: {
    withdrawalConsentVersion: string;
    inspectionDays: number;
    escrowScope: string;
  };
}

/**
 * 주문 생성 — 상품·파일·권리조건·수수료를 주문 시점 값으로 고정한다.
 * 판매자가 이후 상품을 수정하거나 파일을 교체해도 기존 주문의 납품물은 바뀌지 않는다.
 */
export async function createOrder(
  actor: Actor,
  input: { productId: string; licenseMonths?: number | null },
) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: {
      seller: { include: { user: true } },
      files: { where: { isCurrent: true } },
    },
  });
  if (!product) throw new DomainError("NOT_FOUND", "상품을 찾을 수 없습니다.", 404);
  if (product.status !== "ACTIVE") {
    throw new DomainError("STATE_NOT_ALLOWED", "현재 판매 중인 상품이 아닙니다.", 409);
  }
  if (product.seller.status !== "ACTIVE") {
    throw new DomainError("STATE_NOT_ALLOWED", "판매자 심사가 완료되지 않았거나 판매가 중지된 상품입니다.", 409);
  }
  if (product.files.length === 0) {
    throw new DomainError(
      "FILES_UNSAFE",
      "사전 납품물이 등록되지 않은 상품은 결제할 수 없습니다. 판매자에게 납품물 등록을 요청해 주세요.",
      409,
    );
  }
  const unscanned = product.files.filter(
    (f) => f.scanStatus !== "PASSED" && f.scanStatus !== "ISSUE_FOUND",
  );
  if (unscanned.length > 0) {
    throw new DomainError("FILES_UNSAFE", "파일 검사가 완료되지 않은 상품은 결제할 수 없습니다.", 409);
  }
  const blockedFiles = product.files.filter((f) => f.scanStatus === "ISSUE_FOUND");
  if (blockedFiles.length > 0) {
    throw new DomainError(
      "FILES_UNSAFE",
      "안전 검사에서 문제가 발견된 납품물이 있어 결제할 수 없습니다. 판매자에게 수정을 요청해 주세요.",
      409,
    );
  }
  if (product.files.some((f) => f.sizeBytes <= 0)) {
    throw new DomainError("FILES_UNSAFE", "빈 파일이 포함된 상품은 판매할 수 없습니다.", 409);
  }

  assertPurchaseAllowed(actor, product.priceKrw);
  const { companyId } = companyOrderContext(actor);

  const ordered = product.files.slice().sort((a, b) => a.fileName.localeCompare(b.fileName));
  const policy = await resolveFeePolicy({ sellerId: product.sellerId, category: product.category });
  const breakdown = computeFees({
    grossAmount: product.priceKrw,
    commissionRateBp: policy.commissionRateBp,
    paymentFeeRateBp: policy.paymentFeeRateBp,
    paymentFeeBearer: policy.paymentFeeBearer,
    sellerType: product.seller.sellerType,
    withholdingRateBp: sellerWithholdingRateBp(product.seller.sellerType),
    discountRateBp: policy.discountRateBp,
  });

  const snapshot: OrderSnapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    product: {
      id: product.id,
      type: product.type,
      title: product.title,
      summary: product.summary,
      category: product.category,
      licenseType: product.licenseType,
      licenseMonths: product.licenseMonths,
      seats: product.seats,
      platforms: product.platforms,
      sourceIncluded: product.sourceIncluded,
      installSupport: product.installSupport,
      thirdPartyDeps: product.thirdPartyDeps,
      externalCostNote: product.externalCostNote,
      priceKrw: product.priceKrw,
      inspectionDays: product.inspectionDays,
      refundPolicy: product.refundPolicy,
      deliveryNote: product.deliveryNote,
      seller: {
        id: product.seller.id,
        displayName: product.seller.displayName,
        sellerType: product.seller.sellerType,
        userId: product.seller.userId,
      },
    },
    files: ordered.map((f) => ({
      productFileId: f.id,
      fileName: f.fileName,
      version: f.version,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
      storageKey: f.storageKey,
    })),
    fee: {
      policyId: policy.policyId,
      commissionRateBp: policy.commissionRateBp,
      paymentFeeRateBp: policy.paymentFeeRateBp,
      paymentFeeBearer: policy.paymentFeeBearer,
      discountRateBp: policy.discountRateBp,
      sellerType: product.seller.sellerType,
      withholdingRateBp: sellerWithholdingRateBp(product.seller.sellerType),
      breakdown,
      note: policy.note,
    },
    terms: {
      withdrawalConsentVersion: POLICY_VERSIONS.withdrawalConsent,
      inspectionDays: product.inspectionDays,
      escrowScope: "platform_internal_hold",
    },
  };

  const order = await prisma.order.create({
    data: {
      orderNo: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      buyerId: actor.id,
      buyerCompanyId: companyId,
      sellerId: product.sellerId,
      productId: product.id,
      type: product.type === "SOURCE" ? "SOURCE" : "LICENSE",
      grossAmount: breakdown.buyerPayableAmount,
      commissionRateBp: breakdown.commissionRateBp,
      commissionAmount: breakdown.commissionAmount,
      paymentFeeAmount: breakdown.paymentFeeAmount,
      vatAmount: breakdown.commissionVatAmount,
      withholdingTax: breakdown.withholdingTax,
      sellerNetAmount: breakdown.sellerNetAmount,
      snapshot: snapshot as never,
      inspectionDays: product.inspectionDays,
      files: {
        create: snapshot.files.map((f) => ({
          productFileId: f.productFileId,
          fileName: f.fileName,
          version: f.version,
          sizeBytes: f.sizeBytes,
          sha256: f.sha256,
          storageKey: f.storageKey,
        })),
      },
      escrow: {
        create: {
          provider: "mockpg",
          holdState: "NOT_REQUESTED",
          note: "결제 완료 후 대금 보호 상태를 확인합니다.",
        },
      },
    },
  });

  // 주문번호 확정 + 거래별 작업실(메시지 스레드) 생성
  const { newOrderNo } = await import("@/lib/ids");
  const finalized = await prisma.order.update({
    where: { id: order.id },
    data: { orderNo: newOrderNo() },
    include: { files: true, seller: true },
  });
  await prisma.messageThread.create({
    data: {
      orderId: finalized.id,
      subject: `${snapshot.product.title} 거래`,
      buyerId: actor.id,
      sellerId: product.seller.userId,
    },
  });
  return finalized;
}

export { computeFees };
