import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { readStored, signedGetUrl } from "@/lib/storage";

/** 보관본(유료: 원본, 무료: 고화질 압축본) 단일 다운로드 — 저장소 서명 주소로 넘긴다 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const media = await prisma.mediaAsset.findFirst({ where: { id, familyId: user.familyId ?? "__none__" } });
    if (!media) return fail("MEDIA_NOT_FOUND", "사진을 찾을 수 없습니다.", 404);
    if (user.role !== "PARENT" && media.visibility !== "FAMILY") {
      return fail("FORBIDDEN", "이 사진을 내려받을 권한이 없습니다.", 403);
    }
    const safeName = media.fileName.replace(/[\\/:*?"<>|]/g, "_");
    const signed = await signedGetUrl(media.originalPath, { downloadName: safeName, contentType: media.mimeType });
    if (signed) return NextResponse.redirect(signed, 302);
    const file = await readStored(media.originalPath);
    if (!file) return fail("FILE_MISSING", "원본 파일을 찾을 수 없습니다.", 404);
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
