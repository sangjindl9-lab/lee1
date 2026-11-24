import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError, ok } from "@/lib/api";
import { verifyAndApply, type VerifySource } from "@/lib/play-billing";
import { getEffectiveUsage } from "@/lib/entitlement";

/**
 * 앱에서 결제가 끝났거나(source=app) 기존 구매를 다시 확인할 때(source=restore) 구매 토큰을 보낸다.
 * Google 에 확인한 뒤 이 가족의 구독일 때만 반영한다. 몇 번을 보내도 결과가 같다.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족에 속해 있지 않습니다.", 400);
    const body = (await req.json().catch(() => ({}))) as { purchaseToken?: string; source?: string };
    const token = (body.purchaseToken ?? "").trim();
    if (!token || token.length > 4096) return fail("BAD_TOKEN", "구매 정보가 올바르지 않습니다.");
    const source: VerifySource = body.source === "restore" ? "restore" : "app";
    const r = await verifyAndApply({ purchaseToken: token, userId: user.id, familyId: user.familyId, source });
    const usage = await getEffectiveUsage(user.familyId);
    return ok({
      subscription: { productId: r.sub.productId, state: r.sub.state, expiresAt: r.sub.expiresAt?.toISOString() ?? null },
      planId: usage.plan.id,
      planName: usage.plan.name,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
