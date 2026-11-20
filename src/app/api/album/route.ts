import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listAlbumMedia } from "@/lib/library";
import { ok, handleRouteError, fail, parseBool } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.", 400);
    const params = req.nextUrl.searchParams;
    const items = await listAlbumMedia({
      familyId: user.familyId,
      childId: params.get("childId") ?? undefined,
      albumId: params.get("albumId") ?? undefined,
      includeDeleted: parseBool(params.get("includeDeleted")),
    });
    return ok({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}
