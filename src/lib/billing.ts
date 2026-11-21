/**
 * 문의 · 요금제 상태 요약. (예전 '광고 제거' 데모 결제는 Play 정기결제 요금제로 대체되었다 → plans.ts, play-billing.ts)
 */
import prisma from "./db";
import { formatKstDateTime, kstDateKey } from "./date";
import { planOf } from "./plans";
import { BillingError } from "./play-billing";

export { BillingError };

export type Entitlement = {
  adFree: boolean;
  planId: string;
  planName: string;
  expiresAt: string | null;
};

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { family: true } });
  const plan = planOf(user?.family?.plan);
  return {
    adFree: !plan.ads,
    planId: plan.id,
    planName: plan.name,
    expiresAt: user?.family?.planExpiresAt ? formatKstDateTime(user.family.planExpiresAt) : null,
  };
}

/** 광고는 아직 붙이지 않았다 (실제 광고 SDK 연동 전까지 아무것도 표시하지 않음). */
export async function nextAd(userId: string, _slot?: string) {
  const entitlement = await getEntitlement(userId);
  return { show: false, reason: entitlement.adFree ? ("AD_FREE" as const) : ("NO_ADS" as const), ad: null, entitlement };
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
