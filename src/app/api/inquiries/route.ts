import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { createInquiry, listInquiries } from "@/lib/billing";
import { handleRouteError, ok } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireSessionUser();
    return ok({ inquiries: await listInquiries(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = (await req.json().catch(() => ({}))) as { message?: string; category?: string; purchaseId?: string | null };
    const inquiry = await createInquiry({
      userId: user.id,
      message: body.message ?? "",
      category: body.category,
      purchaseId: body.purchaseId ?? null,
    });
    return ok({ inquiry });
  } catch (error) {
    return handleRouteError(error);
  }
}
