import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { putFile, safeDisplayName } from "@/server/storage/vault";
import { scanDeliveryFile } from "@/server/security/scan";
import { audit } from "./audit";
import type { Actor } from "./rbac";

export const CATEGORIES = [
  "ERP·그룹웨어",
  "건설·전기·통신",
  "회계·견적·발주·재고",
  "문서·PDF·엑셀 자동화",
  "쇼핑몰·예약·고객관리",
  "AI 도구",
  "모바일 앱",
  "교육·콘텐츠",
  "개발 도구·플러그인",
] as const;

export interface ProductInput {
  type: "SOLUTION" | "SOURCE";
  title: string;
  summary: string;
  category: string;
  problem: string;
  features: string[];
  includes: string[];
  excludes: string[];
  platforms: string[];
  licenseType: "PERIOD" | "PERPETUAL";
  licenseMonths?: number | null;
  seats?: number | null;
  sourceIncluded: boolean;
  installSupport: boolean;
  customization: boolean;
  thirdPartyDeps?: string;
  externalCostNote?: string;
  inspectionDays: number;
  deliveryNote?: string;
  refundPolicy?: string;
  priceKrw: number;
}

function assertSeller(actor: Actor) {
  if (!actor.sellerProfileId) {
    throw new DomainError("FORBIDDEN", "판매자 등록 후 상품을 등록할 수 있습니다.", 403);
  }
  if (actor.sellerStatus !== "ACTIVE") {
    throw new DomainError("FORBIDDEN", "판매자 심사가 완료된 뒤 상품을 등록할 수 있습니다.", 403);
  }
}

export async function createProduct(actor: Actor, input: ProductInput) {
  assertSeller(actor);
  if (input.priceKrw <= 0) throw new DomainError("VALIDATION", "가격을 입력해 주세요.");
  if (input.inspectionDays < 1) throw new DomainError("VALIDATION", "검수 기간은 1일 이상이어야 합니다.");
  if (input.type === "SOURCE" && !input.sourceIncluded) {
    throw new DomainError("VALIDATION", "소스코드 상품은 소스 제공 범위를 명시해야 합니다.");
  }

  const product = await prisma.product.create({
    data: {
      sellerId: actor.sellerProfileId!,
      type: input.type,
      title: input.title,
      summary: input.summary,
      category: input.category,
      problem: input.problem,
      features: input.features.filter(Boolean),
      includes: input.includes.filter(Boolean),
      excludes: input.excludes.filter(Boolean),
      platforms: input.platforms.filter(Boolean),
      licenseType: input.licenseType,
      licenseMonths: input.licenseType === "PERIOD" ? (input.licenseMonths ?? 12) : null,
      seats: input.seats ?? null,
      sourceIncluded: input.sourceIncluded,
      installSupport: input.installSupport,
      customization: input.customization,
      thirdPartyDeps: input.thirdPartyDeps,
      externalCostNote: input.externalCostNote,
      inspectionDays: input.inspectionDays,
      deliveryNote: input.deliveryNote,
      refundPolicy: input.refundPolicy,
      priceKrw: input.priceKrw,
      status: "DRAFT",
    },
  });
  await audit({
    actor,
    action: "PRODUCT_CREATED",
    targetType: "Product",
    targetId: product.id,
    after: { title: product.title, price: product.priceKrw },
  });
  return product;
}

/** 납품 파일 등록 — 저장 전 검사하고, 검사 결과를 파일 메타데이터와 함께 남긴다. */
export async function addProductFile(
  actor: Actor,
  input: { productId: string; fileName: string; buffer: Buffer; mimeType?: string },
) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { files: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!product) throw new DomainError("NOT_FOUND", "상품을 찾을 수 없습니다.", 404);
  if (product.sellerId !== actor.sellerProfileId) {
    throw new DomainError("FORBIDDEN", "본인 상품에만 납품물을 등록할 수 있습니다.", 403);
  }

  const displayName = safeDisplayName(input.fileName);
  const scan = scanDeliveryFile({ fileName: displayName, buffer: input.buffer, mimeType: input.mimeType });

  const stored = await putFile(input.buffer, displayName);
  const nextVersion = (product.files[0]?.version ?? 0) + 1;

  const file = await prisma.$transaction(async (tx) => {
    await tx.productFile.updateMany({
      where: { productId: product.id, isCurrent: true },
      data: { isCurrent: false },
    });
    return tx.productFile.create({
      data: {
        productId: product.id,
        version: nextVersion,
        fileName: displayName,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        mimeType: input.mimeType ?? null,
        scanStatus: scan.status,
        scanFindings: { findings: scan.findings, notes: scan.notes } as never,
        uploadedById: actor.id,
        isCurrent: true,
      },
    });
  });

  await audit({
    actor,
    action: "PRODUCT_FILE_ADDED",
    targetType: "Product",
    targetId: product.id,
    after: { fileName: displayName, sha256: stored.sha256, scanStatus: scan.status },
  });

  return { file, scan };
}

export async function submitProductForReview(actor: Actor, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { files: true } });
  if (!product) throw new DomainError("NOT_FOUND", "상품을 찾을 수 없습니다.", 404);
  if (product.sellerId !== actor.sellerProfileId) throw new DomainError("FORBIDDEN", "권한이 없습니다.", 403);
  if (product.files.length === 0) {
    throw new DomainError("VALIDATION", "판매 전에 실제 납품 파일을 1개 이상 등록해야 합니다.");
  }
  const pending = product.files.filter((f) => f.scanStatus === "PENDING" || f.scanStatus === "SCANNING");
  if (pending.length > 0) {
    throw new DomainError("VALIDATION", "파일 검사가 끝난 뒤 심사를 요청할 수 있습니다.");
  }
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { status: "PENDING_REVIEW" },
  });
  await audit({ actor, action: "PRODUCT_SUBMITTED", targetType: "Product", targetId: product.id });
  return updated;
}

export async function reviewProduct(
  actor: Actor,
  input: { productId: string; decision: "ACTIVE" | "BLOCKED" | "SUSPENDED"; note: string },
) {
  const product = await prisma.product.findUnique({ where: { id: input.productId }, include: { files: true } });
  if (!product) throw new DomainError("NOT_FOUND", "상품을 찾을 수 없습니다.", 404);

  if (input.decision === "ACTIVE") {
    const bad = product.files.filter((f) => f.scanStatus === "ISSUE_FOUND" || f.sizeBytes === 0);
    if (product.files.length === 0 || bad.length > 0) {
      throw new DomainError(
        "FILES_UNSAFE",
        "납품물이 없거나 검사에서 문제가 발견된 상품은 판매 승인할 수 없습니다.",
        409,
      );
    }
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      status: input.decision,
      adminReviewNote: input.note,
      publishedAt: input.decision === "ACTIVE" ? new Date() : product.publishedAt,
    },
  });
  await audit({
    actor,
    action: `PRODUCT_${input.decision}`,
    targetType: "Product",
    targetId: product.id,
    after: { note: input.note },
  });
  return updated;
}

export interface ProductFilters {
  type?: "SOLUTION" | "SOURCE";
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  platform?: string;
  sourceIncluded?: boolean;
  installSupport?: boolean;
  customization?: boolean;
  noExternalCost?: boolean;
  minRating?: number;
  sort?: "recent" | "price_asc" | "price_desc" | "rating";
}

export async function searchProducts(filters: ProductFilters) {
  const where: Record<string, unknown> = { status: "ACTIVE" };
  if (filters.type) where.type = filters.type;
  if (filters.category) where.category = filters.category;
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { summary: { contains: filters.q, mode: "insensitive" } },
      { features: { has: filters.q } },
    ];
  }
  if (filters.minPrice != null || filters.maxPrice != null) {
    where.priceKrw = {
      ...(filters.minPrice != null ? { gte: filters.minPrice } : {}),
      ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {}),
    };
  }
  if (filters.platform) where.platforms = { has: filters.platform };
  if (filters.sourceIncluded) where.sourceIncluded = true;
  if (filters.installSupport) where.installSupport = true;
  if (filters.customization) where.customization = true;
  if (filters.noExternalCost) where.OR = [...((where.OR as unknown[]) ?? []), { externalCostNote: null }];
  if (filters.minRating) where.ratingAvg = { gte: filters.minRating };

  const orderBy =
    filters.sort === "price_asc"
      ? { priceKrw: "asc" as const }
      : filters.sort === "price_desc"
        ? { priceKrw: "desc" as const }
        : filters.sort === "rating"
          ? { ratingAvg: "desc" as const }
          : { createdAt: "desc" as const };

  return prisma.product.findMany({
    where: where as never,
    include: { seller: true },
    orderBy,
    take: 60,
  });
}

export async function toggleFavorite(actor: Actor, productId: string) {
  const existing = await prisma.favorite.findUnique({
    where: { userId_productId: { userId: actor.id, productId } },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }
  await prisma.favorite.create({ data: { userId: actor.id, productId } });
  return { favorited: true };
}

export async function askQuestion(actor: Actor, input: { productId: string; body: string }) {
  const product = await prisma.product.findUnique({ where: { id: input.productId }, include: { seller: true } });
  if (!product) throw new DomainError("NOT_FOUND", "상품을 찾을 수 없습니다.", 404);
  const q = await prisma.productQuestion.create({
    data: { productId: input.productId, userId: actor.id, body: input.body },
  });
  await prisma.notification.create({
    data: {
      userId: product.seller.userId,
      kind: "QUESTION",
      title: "구매 전 문의가 도착했습니다",
      body: input.body.slice(0, 60),
      link: `/products/${product.id}`,
    },
  });
  return q;
}

export async function answerQuestion(actor: Actor, input: { questionId: string; answer: string }) {
  const q = await prisma.productQuestion.findUnique({
    where: { id: input.questionId },
    include: { product: true },
  });
  if (!q) throw new DomainError("NOT_FOUND", "문의를 찾을 수 없습니다.", 404);
  if (q.product.sellerId !== actor.sellerProfileId) {
    throw new DomainError("FORBIDDEN", "본인 상품의 문의만 답변할 수 있습니다.", 403);
  }
  return prisma.productQuestion.update({
    where: { id: q.id },
    data: { answer: input.answer, answeredAt: new Date() },
  });
}

/** 실제 구매자만 후기를 쓸 수 있다. */
export async function writeReview(
  actor: Actor,
  input: { orderId: string; rating: number; body: string },
) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, include: { product: true } });
  if (!order) throw new DomainError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);
  if (order.buyerId !== actor.id) throw new DomainError("FORBIDDEN", "구매자만 후기를 작성할 수 있습니다.", 403);
  if (order.paymentStatus !== "PAID") throw new DomainError("STATE_NOT_ALLOWED", "결제 완료 후 작성할 수 있습니다.", 409);
  if (!order.productId) throw new DomainError("VALIDATION", "상품 후기가 아닙니다.");
  if (input.rating < 1 || input.rating > 5) throw new DomainError("VALIDATION", "평점은 1~5점입니다.");

  const review = await prisma.review.create({
    data: {
      orderId: order.id,
      productId: order.productId,
      buyerId: actor.id,
      rating: input.rating,
      body: input.body,
    },
  });
  const agg = await prisma.review.aggregate({
    where: { productId: order.productId },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.product.update({
    where: { id: order.productId },
    data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count },
  });
  return review;
}
