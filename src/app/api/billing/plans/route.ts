import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { handleRouteError, ok } from "@/lib/api";
import { PAID_PLANS, PLANS, formatBytes } from "@/lib/plans";
import { getEffectiveUsage } from "@/lib/entitlement";
import { getRetentionNotice } from "@/lib/retention";
import { playConfigured } from "@/lib/play-billing";

/** 요금제 목록 + 우리 가족 사용량 + 현재 구독 */
export async function GET() {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return ok({ plans: [], usage: null });
    const usage = await getEffectiveUsage(user.familyId);
    const current = await prisma.subscription.findFirst({
      where: { familyId: user.familyId, state: { in: ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_ON_HOLD"] } },
      orderBy: { expiresAt: "desc" },
    });
    const retention = await getRetentionNotice(user.familyId);
    return ok({
      retention: retention ? { until: retention.until.toISOString(), over: retention.overLabel, daysLeft: retention.daysLeft } : null,
      billingReady: playConfigured(),
      familyId: user.familyId,
      userId: user.id,
      canPurchase: user.role === "PARENT",
      plans: (["FREE", ...PAID_PLANS] as const).map((id) => {
        const p = PLANS[id];
        return { id: p.id, name: p.name, quota: formatBytes(p.quotaBytes), productId: p.productId, prices: p.prices, perks: p.perks };
      }),
      usage: {
        planId: usage.plan.id,
        used: formatBytes(usage.usedBytes),
        quota: formatBytes(usage.quotaBytes),
        percent: usage.percent,
        expiresAt: usage.planExpiresAt,
      },
      subscription: current
        ? {
            productId: current.productId,
            basePlanId: current.basePlanId,
            state: current.state,
            autoRenewing: current.autoRenewing,
            expiresAt: current.expiresAt?.toISOString() ?? null,
            // 업·다운그레이드할 때 기기에서 기존 구독을 지정하는 데 쓴다 (같은 가족 부모에게만)
            purchaseToken: user.role === "PARENT" && current.userId === user.id ? current.purchaseToken : null,
            mine: current.userId === user.id,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
