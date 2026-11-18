import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import type { Actor } from "@/server/services/rbac";
import { loadActor } from "@/server/services/rbac";
import { addProductFile, createProduct } from "@/server/services/catalog";
import { createOrder } from "@/server/services/orders";
import { startPayment } from "@/server/services/checkout";
import { approveSandboxPayment } from "@/server/payments/webhooks";
import { deliverOrder } from "@/server/services/delivery";
import { startInspection, submitInspection, DEFAULT_CHECKLIST } from "@/server/services/inspection";

let seq = 0;

export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function makeUser(options?: {
  email?: string;
  name?: string;
  roles?: Array<
    | "MEMBER"
    | "SELLER"
    | "ENTERPRISE_ADMIN"
    | "ENTERPRISE_BUYER"
    | "ENTERPRISE_REVIEWER"
    | "OPERATOR_REVIEW"
    | "OPERATOR_SUPPORT"
    | "OPERATOR_SETTLEMENT"
    | "SUPER_ADMIN"
  >;
  seller?: { type: "BUSINESS" | "INDIVIDUAL"; status?: "PENDING" | "ACTIVE" | "SUSPENDED" | "WITHDRAWN" };
  companyId?: string | null;
  companyRole?: "ADMIN" | "BUYER" | "REVIEWER";
  approvalLimitKrw?: number;
}): Promise<Actor> {
  seq += 1;
  const email = options?.email ?? `user${seq}@devvault.test`;
  const roles = options?.roles ?? ["MEMBER"];
  const user = await prisma.user.create({
    data: {
      email,
      name: options?.name ?? `사용자${seq}`,
      passwordHash: await hashPassword("password123!"),
      roles: { create: roles.map((role) => ({ role, companyId: options?.companyId ?? null })) },
      ...(options?.seller
        ? {
            sellerProfile: {
              create: {
                sellerType: options.seller.type,
                displayName: `판매자${seq}`,
                status: options.seller.status ?? "ACTIVE",
                bizName: options.seller.type === "BUSINESS" ? `주식회사 판매자${seq}` : null,
                bizRegNo: options.seller.type === "BUSINESS" ? "123-45-67890" : null,
                taxEmail: options.seller.type === "BUSINESS" ? `tax${seq}@devvault.test` : null,
              },
            },
          }
        : {}),
    },
  });

  if (options?.companyId && options.companyRole) {
    await prisma.companyMember.create({
      data: {
        companyId: options.companyId,
        userId: user.id,
        role: options.companyRole,
        approvalLimitKrw: options.approvalLimitKrw ?? null,
      },
    });
  }

  return loadActor(user.id, "127.0.0.1");
}

export async function makeCompany(name = "테스트기업") {
  return prisma.company.create({ data: { name, bizRegNo: "111-22-33333" } });
}

export async function makeProduct(
  seller: Actor,
  options?: {
    title?: string;
    priceKrw?: number;
    type?: "SOLUTION" | "SOURCE";
    inspectionDays?: number;
    content?: string;
    fileName?: string;
  },
) {
  const product = await createProduct(seller, {
    type: options?.type ?? "SOURCE",
    title: options?.title ?? "테스트 ERP 소스 패키지",
    summary: "테스트용 소스 패키지입니다.",
    category: "ERP·그룹웨어",
    problem: "중소 제조사의 생산·재고 관리를 자동화합니다.",
    features: ["재고 관리", "발주 자동화"],
    includes: ["소스코드", "설치 문서"],
    excludes: ["서버 운영 대행"],
    platforms: ["PC", "WEB"],
    licenseType: "PERPETUAL",
    sourceIncluded: true,
    installSupport: true,
    customization: true,
    thirdPartyDeps: "PostgreSQL 16 (무료)",
    externalCostNote: undefined,
    inspectionDays: options?.inspectionDays ?? 7,
    deliveryNote: "결제 확인 후 즉시 다운로드",
    refundPolicy: "다운로드 시작 시 청약철회 제한",
    priceKrw: options?.priceKrw ?? 3_000_000,
  });

  await addProductFile(seller, {
    productId: product.id,
    fileName: options?.fileName ?? "erp-source.txt",
    buffer: Buffer.from(options?.content ?? "console.log('devvault test bundle');\n", "utf8"),
  });

  return prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE", publishedAt: new Date() },
  });
}

export async function makeOrder(buyer: Actor, productId: string) {
  return createOrder(buyer, { productId });
}

export async function payOrder(buyer: Actor, orderId: string, method = "CARD") {
  const started = await startPayment(buyer, {
    orderId,
    method,
    consentToWithdrawalLimit: true,
    ip: "10.0.0.1",
    userAgent: "vitest",
  });
  const result = await approveSandboxPayment(started.paymentId);
  return { started, result };
}

/** 결제 → 납품 → 검수 승인까지 (정산 가능 상태) */
export async function completeOrder(input: {
  buyer: Actor;
  seller: Actor;
  orderId: string;
  method?: string;
}) {
  await payOrder(input.buyer, input.orderId, input.method ?? "CARD");
  await deliverOrder(input.seller, { orderId: input.orderId, note: "테스트 납품" });
  await startInspection(input.buyer, input.orderId);
  await submitInspection(input.buyer, {
    orderId: input.orderId,
    decision: "APPROVED",
    checklist: DEFAULT_CHECKLIST.map((c) => ({ key: c.key, label: c.label, checked: true })),
    note: "이상 없음",
  });
}

export async function makeOrderWithProduct(
  seller: Actor,
  buyer: Actor,
  opts?: { priceKrw?: number; inspectionDays?: number; method?: string },
) {
  const product = await makeProduct(seller, { priceKrw: opts?.priceKrw, inspectionDays: opts?.inspectionDays });
  const order = await makeOrder(buyer, product.id);
  return { product, order };
}

export async function expectDomainError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    const { isDomainError } = await import("@/lib/errors");
    if (!isDomainError(e)) throw e;
    if (e.code !== code) {
      throw new Error(`기대한 오류 코드는 ${code} 이지만 ${e.code} 가 발생했습니다: ${e.message}`);
    }
    return e;
  }
  throw new Error(`오류가 발생해야 하는데 정상 처리되었습니다. (기대 코드: ${code})`);
}
