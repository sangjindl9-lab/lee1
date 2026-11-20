import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { createFeedingRecord } from "@/lib/care";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body.childId) return fail("MISSING_CHILD", "아이를 선택해 주세요.");
    const record = await createFeedingRecord({
      familyId: user.familyId,
      childId: String(body.childId),
      userId: user.id,
      startDate: body.startDate as string | null,
      startTime: body.startTime as string | null,
      amountMl: body.amountMl as string | number | null,
      note: (body.note as string | null) ?? null,
    });
    return ok({ record });
  } catch (error) {
    return handleRouteError(error);
  }
}
