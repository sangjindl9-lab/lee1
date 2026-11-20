import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import prisma from "@/lib/db";
import { getMediaOrThrow, listComments, moveToTrash, toggleFavorite, updateVisibility } from "@/lib/library";
import { toMediaDTO, type MediaWithRelations } from "@/lib/serialize";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const media = await getMediaOrThrow(id, user.familyId ?? "__none__", user.role);
    return ok({ media: toMediaDTO(media), comments: await listComments(id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as { favorite?: boolean; visibility?: string };
    let media;
    if (typeof body.favorite === "boolean") {
      media = await toggleFavorite(id, user.familyId, body.favorite);
    }
    if (body.visibility) {
      if (user.role !== "PARENT") return fail("FORBIDDEN", "공개 범위는 부모만 바꿀 수 있습니다.", 403);
      media = await updateVisibility(id, user.familyId, body.visibility);
    }
    if (!media) {
      const current = await prisma.mediaAsset.findFirst({ where: { id, familyId: user.familyId }, include: { tags: { include: { tag: true } }, child: true, _count: { select: { likes: true, comments: true } } } });
      if (!current) return fail("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
      media = toMediaDTO(current as MediaWithRelations);
    }
    return ok({ media });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 삭제 = 휴지통으로 이동 (원래 아이·앨범·촬영일·공개 범위는 보존) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (user.role !== "PARENT") return fail("FORBIDDEN", "삭제는 부모만 할 수 있습니다.", 403);
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const result = await moveToTrash(id, { userId: user.id, familyId: user.familyId });
    return ok({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
