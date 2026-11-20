import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { nextAd } from "@/lib/billing";
import { AD_SLOTS } from "@/lib/constants";
import { ok, handleRouteError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const slot = req.nextUrl.searchParams.get("slot") ?? AD_SLOTS.DASHBOARD;
    const result = await nextAd(user.id, slot);
    return ok({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
