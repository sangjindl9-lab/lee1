import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getEntitlement, purchase, restorePurchases, type Platform } from "@/lib/billing";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== "PARENT") return fail("FORBIDDEN", "광고 제거 결제는 부모 계정에서만 진행할 수 있습니다.", 403);
    const body = (await req.json().catch(() => ({}))) as { productId?: string; platform?: string; purchaseToken?: string };
    if (!body.productId) return fail("MISSING_PRODUCT", "상품을 선택해 주세요.");
    const platform = (body.platform ?? "WEB_MOCK") as Platform;
    const { purchase: record, alreadyOwned } = await purchase({
      userId: user.id,
      productId: body.productId,
      platform,
      purchaseToken: body.purchaseToken,
    });
    return ok({
      purchase: {
        id: record.id,
        productId: record.productId,
        scope: record.scope,
        status: record.status,
        platform: record.platform,
        purchasedAt: record.purchasedAt.toISOString(),
        activatedAt: record.activatedAt?.toISOString() ?? null,
      },
      alreadyOwned,
      entitlement: await getEntitlement(user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(req: NextRequest) {
  // 구매 복원
  try {
    const user = await requireSessionUser();
    const body = (await req.json().catch(() => ({}))) as { platform?: string };
    const result = await restorePurchases(user.id, body.platform as Platform | undefined);
    return ok({ ...result, restoredFrom: body.platform ?? "ALL" });
  } catch (error) {
    return handleRouteError(error);
  }
}
