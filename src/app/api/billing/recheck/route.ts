import { requireSessionUser } from "@/lib/auth";
import { recheckBilling } from "@/lib/billing";
import { handleRouteError, ok } from "@/lib/api";

export async function POST() {
  try {
    const user = await requireSessionUser();
    return ok({ ...(await recheckBilling(user.id)) });
  } catch (error) {
    return handleRouteError(error);
  }
}
