import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { uploadItem } from "@/lib/upload";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; itemId: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { sessionId, itemId } = await params;
    const simulateFailure = req.headers.get("x-simulate-fail") === "1";

    let buffer: Buffer;
    let fileName = "";
    let mimeType = "";
    let capturedAt: Date | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return fail("NO_FILE", "파일이 없습니다.");
      buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      mimeType = file.type;
      const captured = form.get("capturedAt");
      if (typeof captured === "string" && captured) {
        const d = new Date(captured);
        if (!Number.isNaN(d.getTime())) capturedAt = d;
      }
    } else {
      buffer = Buffer.from(await req.arrayBuffer());
      fileName = req.headers.get("x-file-name") ?? "";
      mimeType = req.headers.get("x-file-type") ?? "application/octet-stream";
      const captured = req.headers.get("x-captured-at");
      if (captured) {
        const d = new Date(captured);
        if (!Number.isNaN(d.getTime())) capturedAt = d;
      }
    }

    const result = await uploadItem({
      userId: user.id,
      sessionId,
      itemId,
      fileName,
      mimeType,
      buffer,
      capturedAt,
      simulateFailure,
    });
    if (result.status === "FAILED") {
      return fail("UPLOAD_FAILED", result.error ?? "업로드에 실패했습니다.", 502, { item: result });
    }
    return ok({ item: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
