import type { Purchase } from "@prisma/client";
import prisma from "./db";
import { AD_SLOTS, ADS, PRODUCTS, type AdScope } from "./constants";
export { PRODUCTS };
import { formatKstDateTime, kstDateKey, todayKstKey } from "./date";

export type Platform = "GOOGLE_PLAY" | "APPLE_APP_STORE" | "WEB_MOCK";
export const PLATFORMS: Platform[] = ["GOOGLE_PLAY", "APPLE_APP_STORE", "WEB_MOCK"];

export const PLATFORM_LABEL: Record<string, string> = {
  GOOGLE_PLAY: "Google Play",
  APPLE_APP_STORE: "Apple App Store",
  WEB_MOCK: "웹 데모 결제",
};

export class BillingError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 실제 스토어 연동 여부 — 자격 증명이 없으면 데모(WEB_MOCK)만 동작한다. */
export function storeConfigured(platform: Platform): boolean {
  if (platform === "WEB_MOCK") return true;
  if (platform === "GOOGLE_PLAY") return Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  if (platform === "APPLE_APP_STORE") return Boolean(process.env.APPLE_IAP_SHARED_SECRET);
  return false;
}

export type Entitlement = {
  adFree: boolean;
  scope: AdScope | null;
  coversFamily: boolean;
  productId: string | null;
  productTitle: string | null;
  platform: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  purchaseId: string | null;
  purchaserName: string | null;
  explanation: string;
};

async function userWithFamily(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { family: { include: { members: { select: { id: true, name: true, relation: true, role: true } } } } },
  });
  if (!user) throw new BillingError("USER_NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
  return user;
}

/**
 * 광고 제거 권한 계산.
 * - PERSONAL: 결제한 본인 계정에만 적용
 * - FAMILY: 같은 가족에 초대된 가족 전원(조부모 포함)에게 적용
 */
export async function getEntitlement(userId: string): Promise<Entitlement & { coveredMembers: string[] }> {
  const user = await userWithFamily(userId);
  const familyId = user.familyId;
  const candidates = await prisma.purchase.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ userId }, ...(familyId ? [{ familyId }] : [])],
    },
    orderBy: [{ scope: "desc" }, { activatedAt: "desc" }],
  });
  const usable = candidates.filter((p) => {
    if (p.expiresAt && p.expiresAt.getTime() < Date.now()) return false;
    if (p.scope === "FAMILY") return p.familyId === familyId;
    return p.userId === userId;
  });
  const purchase = usable.find((p) => p.scope === "FAMILY") ?? usable[0] ?? null;
  const product = purchase ? PRODUCTS[purchase.productId] : null;
  const purchaser = purchase
    ? await prisma.user.findUnique({ where: { id: purchase.userId }, select: { name: true } })
    : null;

  return {
    adFree: Boolean(purchase),
    scope: (purchase?.scope as AdScope | undefined) ?? null,
    coversFamily: purchase?.scope === "FAMILY",
    productId: purchase?.productId ?? null,
    productTitle: product?.title ?? null,
    platform: purchase?.platform ?? null,
    activatedAt: purchase?.activatedAt ? formatKstDateTime(purchase.activatedAt) : null,
    expiresAt: purchase?.expiresAt ? formatKstDateTime(purchase.expiresAt) : null,
    purchaseId: purchase?.id ?? null,
    purchaserName: purchaser?.name ?? null,
    explanation: purchase
      ? purchase.scope === "FAMILY"
        ? `${purchaser?.name ?? "가족"} 님이 결제한 '가족 전체' 상품이 적용되어, 이 가족의 모든 구성원에게 광고가 표시되지 않습니다.`
        : `${purchaser?.name ?? "본인"} 님 계정에만 적용됩니다. 다른 가족 구성원에게는 광고가 표시됩니다.`
      : "광고 제거가 적용되어 있지 않습니다.",
    coveredMembers: (user.family?.members ?? []).map((m) => `${m.name}${m.relation ? `(${m.relation})` : ""}`),
  };
}

/** 데모 스토어 결제. 실제 연동 시 이 함수가 영수증 검증 결과를 받아 레코드를 만든다. */
export async function purchase(input: {
  userId: string;
  productId: string;
  platform: Platform;
  purchaseToken?: string;
}) {
  const product = PRODUCTS[input.productId];
  if (!product) throw new BillingError("UNKNOWN_PRODUCT", "존재하지 않는 상품입니다.", 404);
  if (!storeConfigured(input.platform)) {
    throw new BillingError(
      "STORE_NOT_CONFIGURED",
      `${PLATFORM_LABEL[input.platform]} 결제는 스토어 계정 연동 후 사용할 수 있습니다. 지금은 '웹 데모 결제'로 전체 흐름을 확인하세요.`,
      409,
    );
  }
  const user = await userWithFamily(input.userId);
  if (!user.familyId) throw new BillingError("NO_FAMILY", "가족 그룹에 속해 있지 않습니다.", 400);

  const token =
    input.purchaseToken?.trim() ||
    `${input.platform.toLowerCase()}-${input.productId}-${user.familyId}-${input.platform === "WEB_MOCK" ? Date.now().toString(36) : "token"}`;

  const existing = await prisma.purchase.findUnique({ where: { purchaseToken: token } });
  if (existing) {
    const activated = await prisma.purchase.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", activatedAt: existing.activatedAt ?? new Date() },
    });
    return { purchase: activated, alreadyOwned: true };
  }

  const record = await prisma.purchase.create({
    data: {
      userId: user.id,
      familyId: user.familyId,
      platform: input.platform,
      productId: product.id,
      purchaseToken: token,
      scope: product.scope,
      status: "ACTIVE",
      purchasedAt: new Date(),
      activatedAt: new Date(),
      rawReceipt: JSON.stringify({ mock: input.platform === "WEB_MOCK", productId: product.id, scope: product.scope }),
    },
  });
  return { purchase: record, alreadyOwned: false };
}

export function serializePurchase(p: Purchase) {
  const product = PRODUCTS[p.productId];
  return {
    id: p.id,
    productId: p.productId,
    productTitle: product?.title ?? p.productId,
    scope: p.scope,
    status: p.status,
    platform: p.platform,
    platformLabel: PLATFORM_LABEL[p.platform] ?? p.platform,
    purchasedAt: formatKstDateTime(p.purchasedAt),
    activatedAt: p.activatedAt ? formatKstDateTime(p.activatedAt) : null,
    expiresAt: p.expiresAt ? formatKstDateTime(p.expiresAt) : null,
    restoreCount: p.restoreCount,
  };
}

/**
 * 구매 복원 — 휴대폰 변경·재설치 후 계정으로 구매 이력을 다시 확인한다.
 * 실제 스토어 연동 시 store adapter 가 계정의 구매 내역을 조회해 이 목록을 채운다.
 */
export async function restorePurchases(userId: string, platform?: Platform) {
  const purchases = await prisma.purchase.findMany({
    where: { userId, ...(platform ? { platform } : {}) },
    orderBy: { purchasedAt: "desc" },
  });
  if (purchases.length === 0) {
    return { restored: 0, purchases: [], entitlement: await getEntitlement(userId) };
  }
  const restored: Purchase[] = [];
  for (const p of purchases) {
    restored.push(
      await prisma.purchase.update({
        where: { id: p.id },
        data: {
          status: "ACTIVE",
          activatedAt: p.activatedAt ?? new Date(),
          restoreCount: { increment: 1 },
        },
      }),
    );
  }
  const entitlement = await getEntitlement(userId);
  return { restored: restored.length, purchases: restored.map(serializePurchase), entitlement };
}

/**
 * 결제 상태 재확인 — 결제 레코드와 실제 적용 상태를 다시 계산하고,
 * 어긋난 부분(만료·철회·미적용)을 알려준다.
 */
export async function recheckBilling(userId: string) {
  const user = await userWithFamily(userId);
  const purchases = await prisma.purchase.findMany({
    where: { OR: [{ userId }, ...(user.familyId ? [{ familyId: user.familyId }] : [])] },
    orderBy: { purchasedAt: "desc" },
  });
  const now = Date.now();
  const expired: string[] = [];
  for (const p of purchases) {
    if (p.status === "ACTIVE" && p.expiresAt && p.expiresAt.getTime() < now) {
      await prisma.purchase.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
      expired.push(p.id);
    }
  }
  const entitlement = await getEntitlement(userId);
  const activePurchases = purchases.filter((p) => p.status === "ACTIVE");
  const issues: string[] = [];
  if (activePurchases.length > 0 && !entitlement.adFree) {
    issues.push("결제 기록은 있지만 광고 제거가 적용되지 않았습니다. 구매 복원을 실행해 주세요.");
  }
  if (expired.length > 0) issues.push(`만료된 구매 ${expired.length}건이 정리되었습니다.`);
  const adImpressionsToday = await prisma.adImpression.count({
    where: { userId, impressionDate: todayKstKey() },
  });
  return {
    checkedAt: formatKstDateTime(new Date()),
    entitlement,
    purchases: purchases.map(serializePurchase),
    adImpressionsToday,
    storeConnected: {
      GOOGLE_PLAY: storeConfigured("GOOGLE_PLAY"),
      APPLE_APP_STORE: storeConfigured("APPLE_APP_STORE"),
    },
    issues,
    verified: issues.length === 0,
  };
}

/**
 * 하루 1회 광고 노출. 업로드 재시도·앱 재실행으로 다시 호출해도
 * 서버의 일일 노출 이력 때문에 같은 날 두 번 나오지 않는다.
 */
export async function nextAd(userId: string, slot: string = AD_SLOTS.DASHBOARD) {
  const entitlement = await getEntitlement(userId);
  if (entitlement.adFree) {
    return { show: false, reason: "AD_FREE" as const, ad: null, entitlement };
  }
  const date = todayKstKey();
  const existing = await prisma.adImpression.findUnique({
    where: { userId_slot_impressionDate: { userId, slot, impressionDate: date } },
  });
  if (existing) {
    return {
      show: false,
      reason: "DAILY_LIMIT_REACHED" as const,
      ad: null,
      entitlement,
      shownAt: formatKstDateTime(existing.createdAt),
      note: "오늘 이 슬롯의 광고는 이미 한 번 표시되었습니다.",
    };
  }
  const ad = Object.values(ADS)[0];
  try {
    await prisma.adImpression.create({ data: { userId, slot, impressionDate: date, adId: ad.id } });
  } catch {
    return {
      show: false,
      reason: "DAILY_LIMIT_REACHED" as const,
      ad: null,
      entitlement,
      note: "오늘 이 슬롯의 광고는 이미 한 번 표시되었습니다.",
    };
  }
  return { show: true, reason: "SHOWN" as const, ad, entitlement, impressionDate: date };
}

export async function createInquiry(input: {
  userId: string;
  message: string;
  category?: string;
  purchaseId?: string | null;
}) {
  const message = input.message.trim();
  if (message.length < 5) throw new BillingError("MESSAGE_TOO_SHORT", "문의 내용을 5자 이상 입력해 주세요.");
  if (message.length > 2000) throw new BillingError("MESSAGE_TOO_LONG", "문의는 2000자까지 쓸 수 있습니다.");
  const inquiry = await prisma.inquiry.create({
    data: {
      userId: input.userId,
      category: input.category ?? "AD_REMOVAL",
      message,
      purchaseId: input.purchaseId ?? null,
    },
    include: { user: { select: { name: true, email: true } } },
  });
  return {
    id: inquiry.id,
    category: inquiry.category,
    message: inquiry.message,
    status: inquiry.status,
    createdAt: formatKstDateTime(inquiry.createdAt),
    createdAtKst: kstDateKey(inquiry.createdAt),
  };
}

export async function listInquiries(userId: string) {
  const rows = await prisma.inquiry.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    message: r.message,
    status: r.status,
    createdAt: formatKstDateTime(r.createdAt),
  }));
}
