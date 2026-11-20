import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getEntitlement, PLATFORMS, PRODUCTS, storeConfigured } from "@/lib/billing";
import { ok, handleRouteError } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const entitlement = await getEntitlement(user.id);
    return ok({
      products: Object.values(PRODUCTS),
      platforms: PLATFORMS.map((p) => ({ id: p, configured: storeConfigured(p) })),
      entitlement,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
