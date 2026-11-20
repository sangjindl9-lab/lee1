import type { Prisma } from "@prisma/client";
import prisma from "./db";
import { addMonthsKst, ageMonthsAt, kstDateKey } from "./date";
import { toMediaDTO, type MediaWithRelations } from "./serialize";

export type SearchFilters = {
  childId?: string | null;
  childName?: string | null;
  ageMonths?: number | null;
  year?: number | null;
  month?: number | null;
  kind?: "IMAGE" | "VIDEO" | null;
  favorite?: boolean | null;
  tags?: string[];
  q?: string | null;
};

export type SearchChild = { id: string; name: string; nickname: string; birthDate: Date };

const monthPad = (n: number) => String(n).padStart(2, "0");

/** "둘째 생후 10개월 때 찍은 동영상" 같은 자연어를 조건으로 바꾼다. */
export function parseNaturalQuery(
  raw: string,
  children: SearchChild[],
  knownTags: string[] = [],
): SearchFilters {
  const filters: SearchFilters = { tags: [] };
  let text = ` ${raw} `;

  for (const child of children) {
    const keys = [child.name, child.nickname].filter(Boolean);
    if (keys.some((k) => text.includes(k))) {
      filters.childId = child.id;
      filters.childName = child.nickname || child.name;
      break;
    }
  }

  const age = /생후\s*(\d{1,3})\s*개월/.exec(text);
  if (age) {
    filters.ageMonths = Number(age[1]);
    text = text.replace(age[0], " ");
  }

  const year = /(\d{4})\s*년/.exec(text);
  if (year) {
    filters.year = Number(year[1]);
    text = text.replace(year[0], " ");
  }

  const month = /(\d{1,2})\s*월/.exec(text);
  if (month) {
    const m = Number(month[1]);
    if (m >= 1 && m <= 12) {
      filters.month = m;
      text = text.replace(month[0], " ");
    }
  }

  if (/동영상|영상|비디오|video/i.test(text)) filters.kind = "VIDEO";
  else if (/사진|이미지|photo|image/i.test(text)) filters.kind = "IMAGE";

  if (/즐겨찾기|최애|favorite/i.test(text)) filters.favorite = true;

  const tags = new Set<string>();
  for (const m of text.matchAll(/#([^\s#]+)/g)) tags.add(m[1]);
  for (const tag of knownTags) {
    if (text.includes(tag)) tags.add(tag);
  }
  if (tags.size) filters.tags = [...tags];

  filters.q = raw.trim();
  return filters;
}

export type SearchResult = {
  filters: SearchFilters;
  applied: string[];
  total: number;
  items: ReturnType<typeof toMediaDTO>[];
};

/**
 * 조건 조합 검색. 생후 개월 수는 아이 생년월일과 촬영일로 계산한 구간으로 조회한 뒤
 * 애플리케이션에서 한 번 더 확인한다.
 */
export async function searchMedia(familyId: string, filters: SearchFilters, viewerRole = "PARENT"): Promise<SearchResult> {
  const children = (await prisma.child.findMany({ where: { familyId }, orderBy: { sortOrder: "asc" } })) as SearchChild[];
  const targetChildren = filters.childId ? children.filter((c) => c.id === filters.childId) : children;

  const where: Prisma.MediaAssetWhereInput = {
    familyId,
    deletedAt: null,
    ...(viewerRole === "PARENT" ? {} : { visibility: "FAMILY" }),
    ...(filters.childId ? { childId: filters.childId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.favorite ? { favorite: true } : {}),
  };

  if (filters.tags?.length) {
    where.AND = filters.tags.map((name) => ({ tags: { some: { tag: { name } } } }));
  }

  const ranges: Prisma.MediaAssetWhereInput[] = [];
  if (filters.ageMonths != null) {
    for (const child of targetChildren) {
      ranges.push({
        childId: child.id,
        capturedAt: {
          gte: addMonthsKst(child.birthDate, filters.ageMonths),
          lt: addMonthsKst(child.birthDate, filters.ageMonths + 1),
        },
      });
    }
  }

  if (filters.year || filters.month) {
    const year = filters.year ?? new Date().getFullYear();
    const month = filters.month;
    if (month) {
      const start = new Date(`${year}-${monthPad(month)}-01T00:00:00+09:00`);
      const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
      const end = new Date(`${next.y}-${monthPad(next.m)}-01T00:00:00+09:00`);
      ranges.push({ capturedAt: { gte: start, lt: end } });
    } else {
      ranges.push({
        capturedAt: { gte: new Date(`${year}-01-01T00:00:00+09:00`), lt: new Date(`${year + 1}-01-01T00:00:00+09:00`) },
      });
    }
  }

  if (ranges.length) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: ranges }];
  }

  const rows = (await prisma.mediaAsset.findMany({
    where,
    include: {
      tags: { include: { tag: true } },
      child: { select: { id: true, name: true, nickname: true, birthDate: true } },
      _count: { select: { likes: true, comments: true } },
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  })) as MediaWithRelations[];

  const filtered =
    filters.ageMonths != null
      ? rows.filter((row) => row.child && ageMonthsAt(row.child.birthDate, row.capturedAt) === filters.ageMonths)
      : rows;
  // 연/월 조건도 KST 기준으로 한 번 더 확인 (경계값 오차 방지)
  const finalRows = filtered.filter((row) => {
    if (!filters.year && !filters.month) return true;
    const key = kstDateKey(row.capturedAt);
    const [y, m] = key.split("-").map(Number);
    if (filters.year && y !== filters.year) return false;
    if (filters.month && m !== filters.month) return false;
    return true;
  });

  const applied: string[] = [];
  if (filters.childName) applied.push(`${filters.childName}`);
  if (filters.ageMonths != null) applied.push(`생후 ${filters.ageMonths}개월`);
  if (filters.year) applied.push(`${filters.year}년`);
  if (filters.month) applied.push(`${filters.month}월`);
  if (filters.kind) applied.push(filters.kind === "VIDEO" ? "동영상" : "사진");
  if (filters.favorite) applied.push("즐겨찾기");
  for (const tag of filters.tags ?? []) applied.push(`#${tag}`);

  return {
    filters,
    applied,
    total: finalRows.length,
    items: finalRows.map((r) => toMediaDTO(r)),
  };
}
