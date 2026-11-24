import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError, ok } from "@/lib/api";
import { cancelPurchaseIntent, createPurchaseIntent } from "@/lib/play-billing";

/** 결제 버튼을 누르면 먼저 부른다: 가족 단위 결제 잠금·이미 보유한 구독 확인·서버 발급 구매 식별자 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족에 속해 있지 않습니다.", 400);
    const body = (await req.json().catch(() => ({}))) as { productId?: string; basePlanId?: string };
    const r = await createPurchaseIntent({
      familyId: user.familyId,
      userId: user.id,
      role: user.role,
      productId: String(body.productId ?? ""),
      basePlanId: String(body.basePlanId ?? ""),
    });
    return ok({ ...r });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 결제창을 닫았거나 실패했을 때 잠금을 푼다 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (id) await cancelPurchaseIntent({ intentId: id, userId: user.id });
    return ok({});
  } catch (error) {
    return handleRouteError(error);
  }
}
