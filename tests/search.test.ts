import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { createMedia } from "@/lib/media";
import { parseNaturalQuery, searchMedia, type SearchChild } from "@/lib/search";
import { attachTags, listTags } from "@/lib/library";
import { makeFamily, makeImageBuffer, makeVideoBuffer, resetDb } from "./helpers";

let ctx: Awaited<ReturnType<typeof makeFamily>>;
let children: SearchChild[];

async function addMedia(opts: {
  childId: string;
  albumId: string;
  fileName: string;
  capturedAt: string;
  kind?: "IMAGE" | "VIDEO";
  favorite?: boolean;
  tags?: string[];
}) {
  const buffer = opts.kind === "VIDEO" ? makeVideoBuffer(opts.fileName) : await makeImageBuffer(opts.fileName);
  const { media } = await createMedia({
    familyId: ctx.family.id,
    childId: opts.childId,
    albumId: opts.albumId,
    ownerId: ctx.dad.id,
    fileName: opts.fileName,
    mimeType: opts.kind === "VIDEO" ? "video/mp4" : "image/jpeg",
    buffer,
    capturedAt: new Date(opts.capturedAt),
    visibility: "FAMILY",
    favorite: opts.favorite,
  });
  if (opts.tags?.length) await attachTags(media.id, ctx.family.id, opts.tags);
  return media;
}

describe("5) 생후 개월 수 · 태그 · 미디어 조합 검색", () => {
  beforeAll(async () => {
    await resetDb();
    ctx = await makeFamily();
    children = (await prisma.child.findMany({ where: { familyId: ctx.family.id }, orderBy: { sortOrder: "asc" } })) as SearchChild[];

    // 둘째 지우: 생후 10개월 시점 동영상 포함
    await addMedia({
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      fileName: "지우_10개월_첫걸음.mp4",
      capturedAt: "2026-04-22T18:05:00+09:00",
      kind: "VIDEO",
      tags: ["첫걸음"],
      favorite: true,
    });
    await addMedia({
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      fileName: "지우_10개월_웃는모습.jpg",
      capturedAt: "2026-04-25T10:00:00+09:00",
      tags: ["첫걸음"],
    });
    await addMedia({
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      fileName: "지우_11개월_공원.mp4",
      capturedAt: "2026-05-25T11:00:00+09:00",
      kind: "VIDEO",
      tags: ["가족여행"],
    });
    // 첫째 서준: 백일 사진
    await addMedia({
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      fileName: "서준_백일.jpg",
      capturedAt: "2023-06-10T15:00:00+09:00",
      tags: ["백일"],
    });
    await addMedia({
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      fileName: "서준_생일.jpg",
      capturedAt: "2024-03-02T18:00:00+09:00",
      tags: ["생일"],
      favorite: true,
    });
  });

  it("자연어 '둘째 생후 10개월 때 찍은 동영상'을 조건으로 해석한다", () => {
    const parsed = parseNaturalQuery("둘째 생후 10개월 때 찍은 동영상", children, ["첫걸음", "백일"]);
    expect(parsed.childId).toBe(ctx.second.id);
    expect(parsed.ageMonths).toBe(10);
    expect(parsed.kind).toBe("VIDEO");
  });

  it("생후 10개월 + 동영상 조건이 정확히 하나만 찾는다", async () => {
    const result = await searchMedia(ctx.family.id, { childId: ctx.second.id, ageMonths: 10, kind: "VIDEO" });
    expect(result.total).toBe(1);
    const [item] = result.items;
    expect(item.fileName).toBe("지우_10개월_첫걸음.mp4");
    expect(item.ageMonths).toBe(10);
    expect(item.kind).toBe("VIDEO");
    expect(item.childName).toBe("지우");
  });

  it("생후 개월 수는 촬영일 기준으로 자동 계산된다", async () => {
    const result = await searchMedia(ctx.family.id, { childId: ctx.second.id, ageMonths: 10 });
    expect(result.total).toBe(2);
    expect(result.items.every((i) => i.ageMonths === 10)).toBe(true);
    // 10개월 구간을 벗어난 11개월 영상은 제외
    const eleven = await searchMedia(ctx.family.id, { childId: ctx.second.id, ageMonths: 11 });
    expect(eleven.total).toBe(1);
    expect(eleven.items[0].fileName).toContain("11개월");
  });

  it("연도·월 조합으로 찾는다", async () => {
    const april = await searchMedia(ctx.family.id, { year: 2026, month: 4 });
    expect(april.total).toBe(2);
    expect(april.items.every((i) => i.capturedAtLabel.startsWith("2026-04"))).toBe(true);
  });

  it("태그로 찾고, 태그별 모아보기 집계가 나온다", async () => {
    const result = await searchMedia(ctx.family.id, { tags: ["백일"] });
    expect(result.total).toBe(1);
    expect(result.items[0].fileName).toBe("서준_백일.jpg");
    const tags = await listTags(ctx.family.id);
    expect(tags.find((t) => t.name === "첫걸음")?.count).toBe(2);
    expect(tags.find((t) => t.name === "백일")?.count).toBe(1);
  });

  it("즐겨찾기·아이·미디어 종류를 조합한다", async () => {
    const favoriteVideos = await searchMedia(ctx.family.id, { favorite: true, kind: "VIDEO" });
    expect(favoriteVideos.total).toBe(1);
    expect(favoriteVideos.items[0].fileName).toContain("10개월");
    const firstChildFavorites = await searchMedia(ctx.family.id, { childId: ctx.first.id, favorite: true });
    expect(firstChildFavorites.total).toBe(1);
  });

  it("조건이 맞지 않으면 0건을 돌려준다", async () => {
    const none = await searchMedia(ctx.family.id, { childId: ctx.first.id, ageMonths: 30, kind: "VIDEO" });
    expect(none.total).toBe(0);
  });
});
