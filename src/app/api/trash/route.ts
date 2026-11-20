import { requireSessionUser } from "@/lib/auth";
import { listTrash } from "@/lib/library";
import { ok, handleRouteError, fail } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.", 400);
    const items = await listTrash(user.familyId);
    return ok({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}
