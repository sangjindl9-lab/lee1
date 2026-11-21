import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { prepareDirectUpload } from "@/lib/upload";
import { handleRouteError, ok } from "@/lib/api";

/** 저장소 직접 업로드 준비 — 중복이면 바로 완료, 아니면 서명 PUT 주소 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string; itemId: string }> }) {
  try {
    const user = await requireSessionUser();
    const { sessionId, itemId } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      contentHash?: string;
      sizeBytes?: number;
      mimeType?: string;
      fileName?: string;
      capturedAt?: string;
    };
    const captured = body.capturedAt ? new Date(body.capturedAt) : null;
    const result = await prepareDirectUpload({
      userId: user.id,
      sessionId,
      itemId,
      contentHash: String(body.contentHash ?? "").toLowerCase(),
      sizeBytes: Number(body.sizeBytes ?? 0),
      mimeType: body.mimeType ?? "",
      fileName: body.fileName ?? "",
      capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured : null,
    });
    return ok({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
