import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError, ok } from "@/lib/api";
import { verifyAndApply } from "@/lib/play-billing";
import { getUsage } from "@/lib/plans";

/** 앱에서 결제가 끝나면 구매 토큰을 보내 Google 에 확인한 뒤 가족 요금제에 반영한다 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족에 속해 있지 않습니다.", 400);
    const body = (await req.json().catch(() => ({}))) as { purchaseToken?: string };
    const token = (body.purchaseToken ?? "").trim();
    if (!token || token.length > 4096) return fail("BAD_TOKEN", "구매 정보가 올바르지 않습니다.");
    const sub = await verifyAndApply({ purchaseToken: token, userId: user.id, familyId: user.familyId });
    const usage = await getUsage(user.familyId);
    return ok({ subscription: { productId: sub.productId, state: sub.state, expiresAt: sub.expiresAt?.toISOString() ?? null }, planId: usage.plan.id, planName: usage.plan.name });
  } catch (error) {
    return handleRouteError(error);
  }
}
