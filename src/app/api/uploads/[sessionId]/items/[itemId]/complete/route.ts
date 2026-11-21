import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { completeDirectUpload } from "@/lib/upload";
import { fail, handleRouteError, ok } from "@/lib/api";

/** 저장소 직접 업로드가 끝났음을 알리면 크기를 확인하고 미리보기 처리를 건다 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ sessionId: string; itemId: string }> }) {
  try {
    const user = await requireSessionUser();
    const { sessionId, itemId } = await params;
    const item = await completeDirectUpload({ userId: user.id, sessionId, itemId });
    if (item.status === "FAILED") return fail("UPLOAD_INCOMPLETE", item.error ?? "업로드를 확인하지 못했습니다.", 409, { item });
    return ok({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}
