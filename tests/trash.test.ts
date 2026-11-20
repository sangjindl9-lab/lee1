import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { createMedia } from "@/lib/media";
import { listAlbumMedia, listTrash, moveToTrash, restoreFromTrash } from "@/lib/library";
import { makeFamily, makeImageBuffer, resetDb } from "./helpers";
import { storedExists } from "@/lib/storage";
import { kstDateKey } from "@/lib/date";

let ctx: Awaited<ReturnType<typeof makeFamily>>;
let mediaId = "";
let otherChildMediaId = "";
const capturedAt = new Date("2024-03-15T19:10:00+09:00");

describe("2) 휴지통 이동 · 복구 시 원래 아이/앨범/촬영일/공개범위 유지", () => {
  beforeAll(async () => {
    await resetDb();
    ctx = await makeFamily();
    const a = await createMedia({
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      ownerId: ctx.dad.id,
      fileName: "첫걸음.jpg",
      mimeType: "image/jpeg",
      buffer: await makeImageBuffer("first-step"),
      capturedAt,
      visibility: "PARENTS_ONLY",
      favorite: true,
    });
    mediaId = a.media.id;
    const b = await createMedia({
      familyId: ctx.family.id,
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      ownerId: ctx.dad.id,
      fileName: "지우.jpg",
      mimeType: "image/jpeg",
      buffer: await makeImageBuffer("second"),
      capturedAt: new Date("2026-01-01T10:00:00+09:00"),
      visibility: "FAMILY",
    });
    otherChildMediaId = b.media.id;
  });

  it("삭제하면 휴지통으로 이동하고 파일은 남아 있다", async () => {
    const result = await moveToTrash(mediaId, { userId: ctx.dad.id, familyId: ctx.family.id });
    expect(result.alreadyInTrash).toBe(false);
    const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    expect(media?.deletedAt).not.toBeNull();
    expect(await storedExists(media?.originalPath)).toBe(true);
    expect((await listAlbumMedia({ familyId: ctx.family.id, childId: ctx.first.id })).some((m) => m.id === mediaId)).toBe(false);
    expect((await listTrash(ctx.family.id)).some((m) => m.id === mediaId)).toBe(true);
  });

  it("다른 아이를 지정해 복구를 요청해도 원래 아이 앨범으로만 복구된다", async () => {
    const result = await restoreFromTrash(mediaId, {
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      requestedChildId: ctx.second.id,
      requestedAlbumId: ctx.secondAlbum.id,
    });
    expect(result.restoredTo.childId).toBe(ctx.first.id);
    expect(result.restoredTo.albumId).toBe(ctx.firstAlbum.id);
    expect(result.media.childId).toBe(ctx.first.id);
    expect(result.media.albumId).toBe(ctx.firstAlbum.id);
    expect(result.ignoredRequest.childId).toBe(ctx.second.id);
    expect(result.ignoredRequest.albumId).toBe(ctx.secondAlbum.id);
  });

  it("복구 후에도 촬영일·공개범위·즐겨찾기가 그대로 유지된다", async () => {
    const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    expect(media?.deletedAt).toBeNull();
    expect(kstDateKey(media!.capturedAt)).toBe("2024-03-15");
    expect(media?.capturedAt.toISOString()).toBe(capturedAt.toISOString());
    expect(media?.visibility).toBe("PARENTS_ONLY");
    expect(media?.favorite).toBe(true);
    expect(await storedExists(media?.originalPath)).toBe(true);
    expect(await storedExists(media?.previewPath)).toBe(true);
  });

  it("복구된 항목은 원래 아이 앨범에만 나타나고 다른 아이 앨범에는 없다", async () => {
    const firstAlbum = await listAlbumMedia({ familyId: ctx.family.id, childId: ctx.first.id });
    const secondAlbum = await listAlbumMedia({ familyId: ctx.family.id, childId: ctx.second.id });
    expect(firstAlbum.some((m) => m.id === mediaId)).toBe(true);
    expect(secondAlbum.some((m) => m.id === mediaId)).toBe(false);
    expect(secondAlbum.some((m) => m.id === otherChildMediaId)).toBe(true);
  });

  it("부모만 공개 항목은 조부모 계정 조회에서 제외된다", async () => {
    const asGrandma = await listAlbumMedia({ familyId: ctx.family.id, childId: ctx.first.id, viewerRole: "GRANDPARENT" });
    expect(asGrandma.some((m) => m.id === mediaId)).toBe(false);
    const asParent = await listAlbumMedia({ familyId: ctx.family.id, childId: ctx.first.id, viewerRole: "PARENT" });
    expect(asParent.some((m) => m.id === mediaId)).toBe(true);
  });

  it("휴지통이 아닌 항목은 복구할 수 없다", async () => {
    await expect(
      restoreFromTrash(mediaId, { userId: ctx.dad.id, familyId: ctx.family.id }),
    ).rejects.toMatchObject({ code: "NOT_IN_TRASH" });
  });
});
