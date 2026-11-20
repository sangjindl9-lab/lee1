import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { createUploadSession, getLatestUploadSession, recalcSession, uploadItem } from "@/lib/upload";
import { makeFamily, makeImageBuffer, makeVideoBuffer, photoFile, resetDb } from "./helpers";
import { storedExists } from "@/lib/storage";

const PHOTO_COUNT = 100;
let ctx: Awaited<ReturnType<typeof makeFamily>>;
let sessionId: string;
let itemIds: string[] = [];
const buffers: Buffer[] = [];

describe("1) 다중 업로드 · 부분 실패 재시도 · 중복 방지 · 세션 복원", () => {
  beforeAll(async () => {
    await resetDb();
    ctx = await makeFamily();
    for (let i = 0; i < PHOTO_COUNT; i += 1) buffers.push(await makeImageBuffer(`p${i}`));
    buffers.push(makeVideoBuffer("video-10months"));

    const files = [
      ...Array.from({ length: PHOTO_COUNT }, (_, i) => ({ ...photoFile(i), clientFileId: `photo-${i}`, sizeBytes: buffers[i].byteLength })),
      { clientFileId: "video-1", fileName: "지우_10개월.mp4", mimeType: "video/mp4", sizeBytes: buffers[PHOTO_COUNT].byteLength },
    ];
    const created = await createUploadSession({
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      visibility: "FAMILY",
      files,
    });
    sessionId = created.session.id;
    const items = await prisma.uploadItem.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
    // createdAt 정렬이 같을 수 있으므로 파일명으로 매핑
    const byClientId = new Map(items.map((i) => [i.clientFileId, i.id]));
    itemIds = files.map((f) => byClientId.get(f.clientFileId) as string);
    expect(itemIds).toHaveLength(101);
  });

  it("처음에는 모든 항목이 '대기' 상태다", async () => {
    const items = await prisma.uploadItem.findMany({ where: { sessionId } });
    expect(items.every((i) => i.status === "PENDING")).toBe(true);
    expect(items).toHaveLength(101);
  });

  it("일부(3개) 전송이 실패하면 실패 상태와 사유가 남는다", async () => {
    const failIndexes = [7, 41, 88];
    for (let i = 0; i < 101; i += 1) {
      const result = await uploadItem({
        userId: ctx.dad.id,
        sessionId,
        itemId: itemIds[i],
        fileName: i === PHOTO_COUNT ? "지우_10개월.mp4" : `photo-${i}.jpg`,
        mimeType: i === PHOTO_COUNT ? "video/mp4" : "image/jpeg",
        buffer: buffers[i],
        capturedAt: new Date("2026-04-22T18:05:00+09:00"),
        simulateFailure: failIndexes.includes(i),
      });
      if (failIndexes.includes(i)) {
        expect(result.status).toBe("FAILED");
        expect(result.error).toContain("연결");
      } else {
        expect(result.status).toBe("DONE");
      }
    }
    const failed = await prisma.uploadItem.count({ where: { sessionId, status: "FAILED" } });
    const done = await prisma.uploadItem.count({ where: { sessionId, status: "DONE" } });
    expect(failed).toBe(3);
    expect(done).toBe(98);

    const summary = await recalcSession(sessionId);
    expect(summary.text).toBe("101개 중 98개 완료, 3개 재시도");
  });

  it("앱을 다시 열어도 세션과 처리 결과가 복원된다", async () => {
    const latest = await getLatestUploadSession(ctx.dad.id);
    expect(latest).not.toBeNull();
    expect(latest?.session.id).toBe(sessionId);
    expect(latest?.items).toHaveLength(101);
    expect(latest?.items.filter((i) => i.status === "FAILED")).toHaveLength(3);
    expect(latest?.items.filter((i) => i.status === "DONE")).toHaveLength(98);
    expect(latest?.session.summary?.text).toContain("3개 재시도");
  });

  it("실패한 항목만 다시 올리면 모두 완료되고, 이미 저장된 파일은 중복 등록되지 않는다", async () => {
    const failIndexes = [7, 41, 88];
    const before = await prisma.mediaAsset.count({ where: { albumId: ctx.secondAlbum.id } });
    expect(before).toBe(98);

    for (const i of failIndexes) {
      const result = await uploadItem({
        userId: ctx.dad.id,
        sessionId,
        itemId: itemIds[i],
        fileName: `photo-${i}.jpg`,
        mimeType: "image/jpeg",
        buffer: buffers[i],
        capturedAt: new Date("2026-04-22T18:05:00+09:00"),
      });
      expect(result.status).toBe("DONE");
      expect(result.duplicate).toBe(false);
    }
    const after = await prisma.mediaAsset.count({ where: { albumId: ctx.secondAlbum.id } });
    expect(after).toBe(101);

    // 저장된 항목을 다시 시도해도 새 레코드가 생기지 않는다.
    const again = await uploadItem({
      userId: ctx.dad.id,
      sessionId,
      itemId: itemIds[7],
      fileName: "photo-7.jpg",
      mimeType: "image/jpeg",
      buffer: buffers[7],
    });
    expect(again.status).toBe("DONE");
    expect(await prisma.mediaAsset.count({ where: { albumId: ctx.secondAlbum.id } })).toBe(101);

    const summary = await recalcSession(sessionId);
    expect(summary).toMatchObject({ total: 101, done: 101, failed: 0, pending: 0 });
  });

  it("새 세션에서 같은 파일을 다시 올려도 앨범에는 한 번만 등록된다 (서버 해시 멱등)", async () => {
    const files = [
      ...Array.from({ length: PHOTO_COUNT }, (_, i) => ({ ...photoFile(i), clientFileId: `again-${i}`, sizeBytes: buffers[i].byteLength })),
    ];
    const created = await createUploadSession({
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      childId: ctx.second.id,
      albumId: ctx.secondAlbum.id,
      visibility: "FAMILY",
      files,
    });
    const items = await prisma.uploadItem.findMany({ where: { sessionId: created.session.id } });
    const byClientId = new Map(items.map((i) => [i.clientFileId, i.id]));
    let duplicates = 0;
    for (let i = 0; i < 30; i += 1) {
      const result = await uploadItem({
        userId: ctx.dad.id,
        sessionId: created.session.id,
        itemId: byClientId.get(`again-${i}`) as string,
        fileName: `photo-${i}.jpg`,
        mimeType: "image/jpeg",
        buffer: buffers[i],
        capturedAt: new Date("2026-04-22T18:05:00+09:00"),
      });
      if (result.duplicate) duplicates += 1;
    }
    expect(duplicates).toBe(30);
    expect(await prisma.mediaAsset.count({ where: { albumId: ctx.secondAlbum.id } })).toBe(101);
    const summary = await recalcSession(created.session.id);
    expect(summary.duplicates).toBe(30);
  });

  it("완료 표시는 원본·미리보기 파일과 DB 레코드가 모두 있을 때만 붙는다", async () => {
    const done = await prisma.mediaAsset.findFirst({ where: { albumId: ctx.secondAlbum.id, kind: "IMAGE" } });
    expect(done).not.toBeNull();
    expect(await storedExists(done?.originalPath)).toBe(true);
    expect(await storedExists(done?.previewPath)).toBe(true);
    expect(await storedExists(done?.thumbPath)).toBe(true);
    const item = await prisma.uploadItem.findFirst({ where: { sessionId, status: "DONE", mediaId: done?.id } });
    expect(item).not.toBeNull();
  });

  it("원본과 미리보기 화질 정보가 분리 저장되고 동영상도 구분 표시된다", async () => {
    const video = await prisma.mediaAsset.findFirst({ where: { albumId: ctx.secondAlbum.id, kind: "VIDEO" } });
    expect(video?.originalQuality).toContain("1080p");
    expect(video?.previewQuality).toContain("720p");
    const image = await prisma.mediaAsset.findFirst({ where: { albumId: ctx.secondAlbum.id, kind: "IMAGE" } });
    expect(image?.originalQuality).toContain("원본");
    expect(image?.previewQuality).toContain("미리보기");
  });
});
