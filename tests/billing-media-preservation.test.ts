/**
 * 구독 만료 시 사진 보존: 50GB(28GB 사용) → 무료 3GB 전환 전후로
 * 사진 기록 수·파일 체크섬·사용량·앨범·육아기록이 그대로인지, 원본을 다시 압축하지 않는지,
 * 신규 업로드만 막히고 열람·다운로드는 되는지, 재구독하면 그대로 복원되는지 확인한다.
 * (실제 28GB 파일은 만들지 않는다: 작은 실제 파일 + 기록상 크기 약 102MB 씩 280건 = 28GB)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import prisma from "@/lib/db";
import { __setPlayApiForTests, createPurchaseIntent, refreshFamilyEntitlement, verifyAndApply } from "@/lib/play-billing";
import { getEffectivePlan, getEffectiveUsage, reserveQuota } from "@/lib/entitlement";
import { createMedia, newObjectBase, processUploadedMedia } from "@/lib/media";
import { readStored, writeStored } from "@/lib/storage";
import { visibilityWhere } from "@/lib/library";
import { createUploadSession, uploadItem } from "@/lib/upload";
import { makeFamily, makeImageBuffer, resetDb } from "./helpers";
import { sha256Of } from "./real-storage";
import { DAY, fromNow, GB, MB, MIN, MockPlay } from "./mock-play";

let play: MockPlay;
let ctx: Awaited<ReturnType<typeof makeFamily>>;
const SYNTHETIC = 280;
/** 280건 × 약 102.4MB = 정확히 28GB */
const PER_ROW = Math.ceil((28 * GB) / SYNTHETIC);

type Snapshot = {
  mediaCount: number;
  albumCount: number;
  careCount: number;
  childCount: number;
  usedBytes: bigint;
  files: Record<string, string | null>;
  rows: Record<string, string>;
};

async function snapshot(excludeIds: string[] = []): Promise<Snapshot> {
  const media = await prisma.mediaAsset.findMany({ where: { familyId: ctx.family.id, id: { notIn: excludeIds } }, orderBy: { id: "asc" } });
  const files: Record<string, string | null> = {};
  const rows: Record<string, string> = {};
  for (const m of media) {
    for (const rel of [m.originalPath, m.previewPath, m.thumbPath]) if (rel) files[rel] = await sha256Of(rel);
    rows[m.id] = JSON.stringify([m.originalPath, m.mimeType, m.width, m.height, m.storedBytes, m.compressed, m.status, m.deletedAt]);
  }
  const fam = await prisma.family.findUniqueOrThrow({ where: { id: ctx.family.id } });
  return {
    mediaCount: await prisma.mediaAsset.count({ where: { familyId: ctx.family.id, id: { notIn: excludeIds } } }),
    albumCount: await prisma.album.count({ where: { familyId: ctx.family.id } }),
    careCount: await prisma.careRecord.count({ where: { familyId: ctx.family.id } }),
    childCount: await prisma.child.count({ where: { familyId: ctx.family.id } }),
    usedBytes: fam.usedBytes,
    files,
    rows,
  };
}

let pendingId = "";
let pendingOriginalSha = "";
let before: Snapshot;

beforeAll(async () => {
  play = new MockPlay();
  __setPlayApiForTests(play);
  await resetDb();
  ctx = await makeFamily();

  // 1) 50GB 구독
  const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
  play.put("keep-tok", { productId: "family_50", expiry: fromNow(30 * MIN), accountId: intent.intentId, profileId: ctx.dad.id });
  await verifyAndApply({ purchaseToken: "keep-tok", familyId: ctx.family.id, userId: ctx.dad.id });

  // 2) 실제로 처리된 사진 5장 (원본 그대로 보관)
  for (let i = 0; i < 5; i += 1) {
    await createMedia({
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      ownerId: ctx.dad.id,
      fileName: `real-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await makeImageBuffer(`keep${i}`),
      capturedAt: new Date(),
      visibility: "FAMILY",
    });
  }

  // 3) 28GB 에 해당하는 기록 (작은 실제 파일, 기록상 100MB)
  for (let i = 0; i < SYNTHETIC; i += 1) {
    const base = newObjectBase(ctx.family.id);
    const rel = `${base}.jpg`;
    await writeStored(rel, Buffer.from(`synthetic-original-${i}-`.repeat(8)), "image/jpeg");
    await prisma.mediaAsset.create({
      data: {
        familyId: ctx.family.id,
        childId: i % 2 ? ctx.first.id : ctx.second.id,
        albumId: i % 2 ? ctx.firstAlbum.id : ctx.secondAlbum.id,
        ownerId: ctx.dad.id,
        kind: "IMAGE",
        fileName: `big-${i}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: PER_ROW,
        storedBytes: PER_ROW,
        originalPath: rel,
        contentHash: `synthetic-${i}`,
        dedupeKey: `${ctx.firstAlbum.id}:synthetic-${i}`,
        capturedAt: new Date(Date.now() - i * DAY),
        status: "READY",
      },
    });
  }
  await prisma.family.update({ where: { id: ctx.family.id }, data: { usedBytes: { increment: BigInt(SYNTHETIC * PER_ROW) } } });

  // 4) 육아 기록
  for (let i = 0; i < 3; i += 1) {
    await prisma.careRecord.create({
      data: { familyId: ctx.family.id, childId: ctx.first.id, type: "SLEEP", startAt: new Date(Date.now() - (i + 1) * DAY), durationMinutes: 60, createdById: ctx.dad.id },
    });
  }

  // 5) 유료일 때 올렸지만 아직 처리 전인 큰 사진 (만료 뒤에 처리됨)
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg({ quality: 98 })
    .toBuffer();
  const pBase = newObjectBase(ctx.family.id);
  const pRel = `${pBase}.jpg`;
  await writeStored(pRel, big, "image/jpeg");
  const pending = await prisma.mediaAsset.create({
    data: {
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      ownerId: ctx.dad.id,
      kind: "IMAGE",
      fileName: "pending-4000x3000.jpg",
      mimeType: "image/jpeg",
      sizeBytes: big.byteLength,
      storedBytes: big.byteLength,
      originalPath: pRel,
      contentHash: "pending-big",
      dedupeKey: `${ctx.firstAlbum.id}:pending-big`,
      capturedAt: new Date(),
      status: "PROCESSING",
    },
  });
  await prisma.family.update({ where: { id: ctx.family.id }, data: { usedBytes: { increment: BigInt(big.byteLength) } } });
  pendingId = pending.id;
  pendingOriginalSha = (await sha256Of(pRel)) as string;

  before = await snapshot();
});

afterAll(() => __setPlayApiForTests(null));

describe("50GB(28GB 사용) → 무료 전환", () => {
  it("전환 전: 50GB 요금제, 28GB 이상 사용", async () => {
    const u = await getEffectiveUsage(ctx.family.id);
    expect(u.plan.id).toBe("FAMILY_50");
    expect(u.usedBytes).toBeGreaterThanOrEqual(28 * GB);
    expect(before.mediaCount).toBe(5 + SYNTHETIC + 1);
    expect(Object.values(before.files).every(Boolean)).toBe(true);
  });

  it("만료되어 무료가 되어도 사진 기록 수·파일 체크섬·사용량·앨범·육아기록이 전부 그대로", async () => {
    play.update("keep-tok", { state: "SUBSCRIPTION_STATE_EXPIRED", expiry: fromNow(-MIN) });
    await prisma.subscription.update({ where: { purchaseToken: "keep-tok" }, data: { expiresAt: fromNow(-MIN) } });
    await prisma.family.update({ where: { id: ctx.family.id }, data: { planExpiresAt: fromNow(-MIN) } });
    const r = await refreshFamilyEntitlement(ctx.family.id);
    expect(r.plan).toBe("FREE");
    expect((await getEffectivePlan(ctx.family.id)).plan.id).toBe("FREE");

    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it("유료 때 올린 사진은 만료 뒤에 처리돼도 원본을 압축하지 않는다 (작업에 실린 '올린 시점' 요금제)", async () => {
    await processUploadedMedia(pendingId, { keepOriginals: true });
    const m = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: pendingId } });
    expect(m.status).toBe("READY");
    expect(m.compressed).toBe(false);
    expect(m.width).toBe(4000);
    expect(await sha256Of(m.originalPath)).toBe(pendingOriginalSha);
    // 이미 처리된 항목을 다시 처리하라고 해도(작업 재시도) 아무것도 바뀌지 않는다
    const shaAfter = await sha256Of(m.originalPath);
    await processUploadedMedia(pendingId, { keepOriginals: false });
    const again = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: pendingId } });
    expect(again.originalPath).toBe(m.originalPath);
    expect(await sha256Of(again.originalPath)).toBe(shaAfter);
  });

  it("3GB 를 넘었으니 신규 업로드만 막힌다", async () => {
    await expect(reserveQuota(ctx.family.id, MB)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const buf = await makeImageBuffer("blocked");
    const { session, items } = await createUploadSession({
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      visibility: "FAMILY",
      files: [{ clientFileId: "x", fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: buf.byteLength }],
    }).catch((e) => {
      expect(e.code).toBe("QUOTA_EXCEEDED");
      return { session: null, items: [] };
    });
    if (session) {
      const r = await uploadItem({ userId: ctx.dad.id, sessionId: session.id, itemId: items[0].id, fileName: "x.jpg", mimeType: "image/jpeg", buffer: buf });
      expect(r.status).toBe("FAILED");
    }
    expect(await prisma.mediaAsset.count({ where: { familyId: ctx.family.id } })).toBe(before.mediaCount);
  });

  it("기존 사진 열람·다운로드·가족 공유는 그대로", async () => {
    const media = await prisma.mediaAsset.findMany({ where: { familyId: ctx.family.id }, take: 50 });
    for (const m of media) expect(await readStored(m.originalPath)).not.toBeNull();
    // 조부모(가족 공유) 화면에서 보이는 사진 수도 그대로
    const shared = await prisma.mediaAsset.count({ where: { familyId: ctx.family.id, deletedAt: null, ...visibilityWhere("GRANDPARENT") } });
    expect(shared).toBe(before.mediaCount);
    // 구독 이력이 있으므로 기간 전체 ZIP 내려받기도 막지 않는다
    expect(await prisma.subscription.count({ where: { familyId: ctx.family.id } })).toBeGreaterThan(0);
  });

  it("재구독하면 기존 데이터 그대로 50GB 권한이 돌아온다", async () => {
    const pre = await snapshot([pendingId]);
    const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    expect(intent.action).toBe("PURCHASE");
    play.put("again-tok", { productId: "family_50", expiry: fromNow(30 * DAY), accountId: intent.intentId, profileId: ctx.dad.id });
    await verifyAndApply({ purchaseToken: "again-tok", familyId: ctx.family.id, userId: ctx.dad.id });
    const u = await getEffectiveUsage(ctx.family.id);
    expect(u.plan.id).toBe("FAMILY_50");
    expect(await snapshot([pendingId])).toEqual(pre);
    await expect(reserveQuota(ctx.family.id, 100 * MB)).resolves.toBeTruthy();
  });
});
