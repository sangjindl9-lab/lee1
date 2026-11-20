import { NextRequest } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { parseNaturalQuery, searchMedia, type SearchChild } from "@/lib/search";
import { fail, handleRouteError, ok, parseBool, parseNumber } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const p = req.nextUrl.searchParams;
    const children = (await prisma.child.findMany({
      where: { familyId: user.familyId },
      orderBy: { sortOrder: "asc" },
    })) as SearchChild[];
    const knownTags = (await prisma.tag.findMany({ where: { familyId: user.familyId } })).map((t) => t.name);

    const q = p.get("q")?.trim() ?? "";
    const parsed = q ? parseNaturalQuery(q, children, knownTags) : { tags: [] as string[] };

    const kindParam = p.get("kind");
    const kind = kindParam === "VIDEO" || kindParam === "IMAGE" ? kindParam : parsed.kind ?? null;
    const tagParams = p.get("tags");
    const tags = tagParams ? tagParams.split(",").map((t) => t.trim()).filter(Boolean) : parsed.tags ?? [];

    const filters = {
      childId: p.get("childId") ?? parsed.childId ?? null,
      childName: parsed.childName ?? null,
      ageMonths: parseNumber(p.get("ageMonths"), parsed.ageMonths ?? undefined) ?? null,
      year: parseNumber(p.get("year"), parsed.year ?? undefined) ?? null,
      month: parseNumber(p.get("month"), parsed.month ?? undefined) ?? null,
      kind,
      favorite: parseBool(p.get("favorite")) ?? parsed.favorite ?? null,
      tags,
      q: q || null,
    };

    const result = await searchMedia(user.familyId, filters, user.role);
    return ok({ ...result, parsedFromQuery: parsed });
  } catch (error) {
    return handleRouteError(error);
  }
}
