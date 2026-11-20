import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { endSleepRecord } from "@/lib/care";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const record = await endSleepRecord({
      recordId: id,
      familyId: user.familyId,
      endDate: body.endDate as string | null,
      endTime: body.endTime as string | null,
    });
    return ok({ record });
  } catch (error) {
    return handleRouteError(error);
  }
}
