import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { resolveStored } from "@/lib/storage";

/** 원본 화질 단일 다운로드 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const media = await prisma.mediaAsset.findFirst({ where: { id, familyId: user.familyId ?? "__none__" } });
    if (!media) return fail("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
    if (user.role !== "PARENT" && media.visibility !== "FAMILY") {
      return fail("FORBIDDEN", "이 사진을 내려받을 권한이 없습니다.", 403);
    }
    const file = await fs.readFile(resolveStored(media.originalPath)).catch(() => null);
    if (!file) return fail("FILE_MISSING", "원본 파일을 찾을 수 없습니다.", 404);
    const safeName = media.fileName.replace(/[\\/:*?"<>|]/g, "_");
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": media.mimeType || "application/octet-stream",
        "Content-Length": String(file.byteLength),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
