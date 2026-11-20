import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { restorePurchases, type Platform } from "@/lib/billing";
import { handleRouteError, ok } from "@/lib/api";

/** 구매 복원 — 휴대폰 변경·재설치 후 계정으로 구매 이력을 다시 적용 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = (await req.json().catch(() => ({}))) as { platform?: string };
    const result = await restorePurchases(user.id, body.platform as Platform | undefined);
    return ok({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
