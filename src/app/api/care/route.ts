import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { careSummary, listCareRecords } from "@/lib/care";
import { fail, handleRouteError, ok, parseNumber } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const p = req.nextUrl.searchParams;
    const childId = p.get("childId") ?? undefined;
    const days = parseNumber(p.get("days"), 14);
    const records = await listCareRecords({ familyId: user.familyId, childId, days });
    const summary = await careSummary(user.familyId, childId);
    return ok({ records, summary, today: new Date().toISOString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
