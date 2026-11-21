import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { guessType, readStored, signedGetUrl } from "@/lib/storage";

/**
 * 사진·동영상 보기. 권한을 확인한 뒤 저장소의 서명 주소로 넘겨(302) 서버가 바이트를 전송하지 않게 한다.
 * (서명 주소는 1시간 단위로 같아서 브라우저 캐시가 재사용된다)
 */
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
    if (size === "original") rel = media.originalPath;
    else if (size === "thumb") rel = media.thumbPath ?? media.previewPath ?? (media.status === "READY" ? media.originalPath : null);
    else rel = media.previewPath ?? media.thumbPath ?? (media.status === "READY" ? media.originalPath : null);
    if (!rel) return processingPlaceholder();

    const contentType = rel === media.originalPath ? media.mimeType || guessType(rel) : guessType(rel);
    const signed = await signedGetUrl(rel, { contentType });
    if (signed) {
      return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "private, max-age=600" } });
    }
    const file = await readStored(rel);
    if (!file) return fail("FILE_MISSING", "저장된 파일을 찾을 수 없습니다.", 404);
    return new Response(new Uint8Array(file), {
      headers: { "Content-Type": contentType, "Content-Length": String(file.byteLength), "Cache-Control": "private, max-age=120" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 아직 처리 중인 항목: 작은 자리표시 그림 */
function processingPlaceholder() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#fdf2f8"/><text x="240" y="250" font-size="28" text-anchor="middle" fill="#db2777" font-family="sans-serif">처리 중…</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
