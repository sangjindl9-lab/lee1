import { NextRequest } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { csvEscape, zipResponse, type ZipEntry } from "@/lib/zip";
import { resolveStored } from "@/lib/storage";
import { kstDateKey } from "@/lib/date";

/**
 * 선택한 사진·영상 또는 기간 앨범을 원본 화질로 ZIP 다운로드.
 * - mediaIds=id1,id2
 * - childId=..&from=2026-04-01&to=2026-04-30
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const p = req.nextUrl.searchParams;
    const mediaIds = (p.get("mediaIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const childId = p.get("childId");
    const from = p.get("from");
    const to = p.get("to");

    if (!mediaIds.length && !childId) return fail("NO_TARGET", "다운로드할 사진을 선택하거나 아이를 지정해 주세요.");

    const where = {
      familyId: user.familyId,
      deletedAt: null,
      ...(user.role === "PARENT" ? {} : { visibility: "FAMILY" }),
      ...(mediaIds.length ? { id: { in: mediaIds } } : {}),
      ...(childId ? { childId } : {}),
      ...(from || to
        ? {
            capturedAt: {
              ...(from ? { gte: new Date(`${from}T00:00:00+09:00`) } : {}),
              ...(to ? { lt: new Date(`${to}T23:59:59+09:00`) } : {}),
            },
          }
        : {}),
    };

    const media = await prisma.mediaAsset.findMany({
      where,
      include: { child: true, tags: { include: { tag: true } } },
      orderBy: [{ capturedAt: "asc" }],
    });
    if (!media.length) return fail("EMPTY_SELECTION", "조건에 맞는 사진이 없습니다.", 404);

    const entries: ZipEntry[] = media.map((m) => {
      const ext = m.fileName.includes(".") ? m.fileName.slice(m.fileName.lastIndexOf(".")) : "";
      const base = m.fileName.replace(/\.[^.]+$/, "");
      const name = `${m.child?.name ?? "아이"}/${kstDateKey(m.capturedAt)}_${base}${ext}`;
      return { path: resolveStored(m.originalPath), name };
    });

    const header = ["파일명", "아이", "촬영일", "구분", "공개범위", "태그", "해시(SHA-256)"].join(",");
    const rows = media.map((m) =>
      [
        m.fileName,
        m.child?.name ?? "",
        `${kstDateKey(m.capturedAt)} ${new Date(m.capturedAt.getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16)}`,
        m.kind === "VIDEO" ? "동영상" : "사진",
        m.visibility,
        m.tags.map((t) => t.tag.name).join(" "),
        m.contentHash,
      ]
        .map(csvEscape)
        .join(","),
    );
    const manifest = `\uFEFF${header}\n${rows.join("\n")}\n`;

    const label = childId ? media[0]?.child?.name ?? "앨범" : "선택";
    const name = `${label}_원본_${kstDateKey(new Date())}.zip`;
    return zipResponse(entries, manifest, name);
  } catch (error) {
    return handleRouteError(error);
  }
}
