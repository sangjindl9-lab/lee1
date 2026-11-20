import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { createUploadSession, serializeItem } from "@/lib/upload";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as {
      childId?: string;
      albumId?: string;
      visibility?: string;
      files?: Array<{ clientFileId?: string; fileName?: string; mimeType?: string; sizeBytes?: number }>;
    };
    if (!body.childId || !body.albumId) return fail("MISSING_TARGET", "아이와 앨범을 선택해 주세요.");
    const files = (body.files ?? []).map((f, index) => ({
      clientFileId: f.clientFileId ?? `idx-${index}`,
      fileName: f.fileName ?? `file-${index}`,
      mimeType: f.mimeType ?? "application/octet-stream",
      sizeBytes: Number(f.sizeBytes ?? 0),
    }));
    const { session, items } = await createUploadSession({
      userId: user.id,
      familyId: user.familyId,
      childId: body.childId,
      albumId: body.albumId,
      visibility: body.visibility ?? "FAMILY",
      files,
    });
    return ok({
      session: {
        id: session.id,
        childId: session.childId,
        albumId: session.albumId,
        visibility: session.visibility,
        totalFiles: session.totalFiles,
        createdAt: session.createdAt.toISOString(),
      },
      items: items.map(serializeItem),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
