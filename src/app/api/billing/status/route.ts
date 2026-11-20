import { requireSessionUser } from "@/lib/auth";
import { getEntitlement, listInquiries } from "@/lib/billing";
import prisma from "@/lib/db";
import { ok, handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const entitlement = await getEntitlement(user.id);
    const purchases = await prisma.purchase.findMany({
      where: { OR: [{ userId: user.id }, ...(user.familyId ? [{ familyId: user.familyId }] : [])] },
      orderBy: { purchasedAt: "desc" },
    });
    return ok({
      entitlement,
      purchases: purchases.map((p) => ({
        id: p.id,
        productId: p.productId,
        scope: p.scope,
        status: p.status,
        platform: p.platform,
        purchasedAt: p.purchasedAt.toISOString(),
        restoreCount: p.restoreCount,
      })),
      inquiries: await listInquiries(user.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
