import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { toggleLike } from "@/lib/library";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const result = await toggleLike(id, user.id, user.familyId, user.role);
    return ok({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
