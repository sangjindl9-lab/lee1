import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { restoreFromTrash } from "@/lib/library";
import { fail, handleRouteError, ok } from "@/lib/api";

/**
 * 휴지통 복구. 요청 본문의 childId/albumId 는 참고용일 뿐이며,
 * 복구 위치는 항상 DB 에 저장된 원래 값으로 정해진다. (다른 아이 앨범 오복구 방지)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (user.role !== "PARENT") return fail("FORBIDDEN", "복구는 부모만 할 수 있습니다.", 403);
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as { childId?: string; albumId?: string };
    const result = await restoreFromTrash(id, {
      userId: user.id,
      familyId: user.familyId,
      requestedChildId: body.childId ?? null,
      requestedAlbumId: body.albumId ?? null,
    });
    return ok({
      ...result,
      note:
        result.ignoredRequest.childId || result.ignoredRequest.albumId
          ? "요청한 아이/앨범이 원래 위치와 달라 무시하고 원래 아이의 앨범으로 복구했습니다."
          : "원래 아이·앨범·촬영일·공개 범위 그대로 복구했습니다.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
