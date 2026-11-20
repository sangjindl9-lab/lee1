import { NextRequest } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { recalcSession, serializeItem } from "@/lib/upload";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireSessionUser();
    const { sessionId } = await params;
    const session = await prisma.uploadSession.findFirst({ where: { id: sessionId, userId: user.id } });
    if (!session) return fail("SESSION_NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404);
    const items = await prisma.uploadItem.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
    const summary = await recalcSession(sessionId);
    return ok({
      session: {
        id: session.id,
        childId: session.childId,
        albumId: session.albumId,
        visibility: session.visibility,
        status: session.status,
        totalFiles: session.totalFiles,
      },
      items: items.map(serializeItem),
      summary,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
