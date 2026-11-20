import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { resolveStored } from "@/lib/storage";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const media = await prisma.mediaAsset.findFirst({ where: { id, familyId: user.familyId ?? "__none__" } });
    if (!media) return fail("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
    if (user.role !== "PARENT" && media.visibility !== "FAMILY") {
      return fail("FORBIDDEN", "이 사진을 볼 권한이 없습니다.", 403);
    }

    const size = req.nextUrl.searchParams.get("size") ?? "preview";
    let rel: string | null;
    let contentType: string;
    if (size === "original") {
      rel = media.originalPath;
      contentType = media.mimeType;
    } else if (size === "thumb") {
      rel = media.thumbPath ?? media.previewPath ?? media.originalPath;
      contentType = rel === media.originalPath ? media.mimeType : "image/webp";
    } else {
      rel = media.previewPath ?? media.thumbPath ?? media.originalPath;
      contentType = rel === media.originalPath ? media.mimeType : "image/webp";
    }
    if (!rel) return fail("FILE_MISSING", "파일이 없습니다.", 404);

    const file = await fs.readFile(resolveStored(rel)).catch(() => null);
    if (!file) return fail("FILE_MISSING", "저장된 파일을 찾을 수 없습니다.", 404);
    const ext = rel.slice(rel.lastIndexOf("."));
    if (!contentType || contentType === "application/octet-stream") contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.byteLength),
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
