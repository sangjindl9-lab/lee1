/**
 * 구독 종료 후 30일 보관 정책:
 * - 끝난 날 + 30일(최소 오늘 + 7일)을 보관 기한으로 잡고 안내한다
 * - 기한 전·재구독·3GB 이하로 정리·Google 장애 시에는 아무것도 지우지 않는다
 * - 기한이 지나면 3GB 를 넘는 만큼만, 휴지통 → 최근에 올린 것 순서로 지우고 오래된 사진·앨범·육아기록은 남긴다
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { __setPlayApiForTests, createPurchaseIntent, RETENTION_MS, refreshFamilyEntitlement, verifyAndApply } from "@/lib/play-billing";
import { enforceDueRetention, enforceRetention, getRetentionNotice } from "@/lib/retention";
import { newObjectBase } from "@/lib/media";
import { writeStored } from "@/lib/storage";
import { PLANS } from "@/lib/plans";
import { makeFamily, resetDb } from "./helpers";
import { sha256Of } from "./real-storage";
import { DAY, fromNow, GB, MIN, MockPlay } from "./mock-play";

let play: MockPlay;
let ctx: Awaited<ReturnType<typeof makeFamily>>;
const FREE = PLANS.FREE.quotaBytes;
const ITEM = 500 * 1024 ** 2; // 기록상 500MB 씩

/** n 개의 사진 기록(작은 실제 파일 + 기록상 500MB). i 가 작을수록 오래전에 올린 것 */
async function addMedia(n: number, opts: { trashed?: boolean; tag?: string } = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const rel = `${newObjectBase(ctx.family.id)}.jpg`;
    await writeStored(rel, Buffer.from(`${opts.tag ?? "m"}-${i}-`.repeat(10)), "image/jpeg");
    const tag = `${opts.tag ?? "m"}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const m = await prisma.mediaAsset.create({
      data: {
        familyId: ctx.family.id,
        childId: ctx.first.id,
        albumId: ctx.firstAlbum.id,
        ownerId: ctx.dad.id,
        kind: "IMAGE",
        fileName: `${tag}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: ITEM,
        storedBytes: ITEM,
        originalPath: rel,
        contentHash: tag,
        dedupeKey: `${ctx.firstAlbum.id}:${tag}`,
        capturedAt: new Date(),
        createdAt: new Date(Date.now() - (1000 - ids.length) * DAY + (opts.trashed ? 500 : 0) * DAY),
        deletedAt: opts.trashed ? new Date() : null,
        status: "READY",
      },
    });
    ids.push(m.id);
  }
  await prisma.family.update({ where: { id: ctx.family.id }, data: { usedBytes: { increment: BigInt(n * ITEM) } } });
  return ids;
}

async function subscribeThenExpire(token: string, endedAt: Date) {
  const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
  play.put(token, { productId: "family_50", expiry: fromNow(30 * MIN), accountId: intent.intentId, profileId: ctx.dad.id });
  await verifyAndApply({ purchaseToken: token, familyId: ctx.family.id, userId: ctx.dad.id });
  play.update(token, { state: "SUBSCRIPTION_STATE_EXPIRED", expiry: endedAt });
  await prisma.subscription.update({ where: { purchaseToken: token }, data: { expiresAt: endedAt } });
  await prisma.family.update({ where: { id: ctx.family.id }, data: { planExpiresAt: endedAt } });
  await refreshFamilyEntitlement(ctx.family.id);
}

async function fam() {
  return prisma.family.findUniqueOrThrow({ where: { id: ctx.family.id } });
}

beforeAll(() => {
  play = new MockPlay();
  __setPlayApiForTests(play);
});
afterAll(() => __setPlayApiForTests(null));
beforeEach(async () => {
  await resetDb();
  play.subs.clear();
  play.outage = false;
  ctx = await makeFamily();
});

describe("보관 기한 정하기·안내", () => {
  it("구독이 끝나고 3GB 를 넘으면 '끝난 날 + 30일'이 기한이고 화면 안내가 나온다", async () => {
    await addMedia(10); // 5GB
    const ended = fromNow(-2 * DAY);
    await subscribeThenExpire("r-1", ended);
    const f = await fam();
    expect(f.plan).toBe("FREE");
    expect(f.retentionUntil?.getTime()).toBe(ended.getTime() + RETENTION_MS);
    const n = await getRetentionNotice(ctx.family.id);
    expect(n?.daysLeft).toBe(28);
    expect(n?.overBytes).toBe(10 * ITEM - FREE);
  });

  it("끝난 것을 늦게 알았어도(이미 30일 지남) 최소 7일은 보관", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-late", fromNow(-40 * DAY));
    const until = (await fam()).retentionUntil!.getTime();
    expect(until).toBeGreaterThanOrEqual(Date.now() + 7 * DAY - MIN);
  });

  it("3GB 이하이거나 구독 이력이 없으면 기한이 없다", async () => {
    await addMedia(2); // 1GB
    await subscribeThenExpire("r-small", fromNow(-DAY));
    expect((await fam()).retentionUntil).toBeNull();
    expect(await getRetentionNotice(ctx.family.id)).toBeNull();
  });

  it("한 번 정한 기한은 다시 계산해도 바뀌지 않는다", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-fixed", fromNow(-DAY));
    const first = (await fam()).retentionUntil!.getTime();
    await refreshFamilyEntitlement(ctx.family.id);
    expect((await fam()).retentionUntil!.getTime()).toBe(first);
  });
});

describe("기한 처리", () => {
  it("기한 전에는 아무것도 지우지 않는다", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-early", fromNow(-DAY));
    const r = await enforceRetention(ctx.family.id);
    expect(r.reason).toBe("not-due");
    expect(await prisma.mediaAsset.count()).toBe(10);
  });

  it("기한이 지나면 3GB 를 넘는 만큼만, 휴지통 → 최근 것부터 지우고 오래된 사진·앨범·육아기록은 남긴다", async () => {
    const active = await addMedia(10, { tag: "a" }); // 5GB, active[0] 이 가장 오래됨
    const trashed = await addMedia(2, { tag: "t", trashed: true }); // 1GB 휴지통
    await prisma.careRecord.create({ data: { familyId: ctx.family.id, childId: ctx.first.id, type: "SLEEP", startAt: new Date(), createdById: ctx.dad.id } });
    await subscribeThenExpire("r-due", fromNow(-31 * DAY));
    await prisma.family.update({ where: { id: ctx.family.id }, data: { retentionUntil: fromNow(-MIN) } });

    const oldest = await prisma.mediaAsset.findMany({ where: { id: { in: active.slice(0, 6) } } });
    const oldestSha = await Promise.all(oldest.map((m) => sha256Of(m.originalPath)));

    expect(await prisma.mediaAsset.count({ where: { familyId: ctx.family.id, deletedAt: { not: null } } })).toBe(2);
    expect(Number((await fam()).usedBytes)).toBe(12 * ITEM);
    expect(await enforceDueRetention()).toBe(1);
    const f = await fam();
    expect(Number(f.usedBytes)).toBeLessThanOrEqual(FREE);
    expect(f.retentionUntil).toBeNull();
    expect(f.retentionEnforcedAt).not.toBeNull();

    const left = await prisma.mediaAsset.findMany({ where: { familyId: ctx.family.id } });
    // 6GB → 3GB: 휴지통 2개(1GB) + 최근 4개(2GB) 삭제, 오래된 6개(3GB) 유지
    expect(left.map((m) => m.id).sort()).toEqual(active.slice(0, 6).sort());
    expect(f.retentionDeletedCount).toBe(6);
    for (const id of trashed) expect(left.find((m) => m.id === id)).toBeUndefined();
    // 남은 사진 파일은 그대로, 지운 파일은 저장소에서도 사라짐
    expect(await Promise.all(oldest.map((m) => sha256Of(m.originalPath)))).toEqual(oldestSha);
    expect(await prisma.careRecord.count({ where: { familyId: ctx.family.id } })).toBe(1);
    expect(await prisma.album.count({ where: { familyId: ctx.family.id } })).toBe(2);
  });

  it("기한 안에 재구독했으면 지우지 않고 기한도 사라진다", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-old", fromNow(-29 * DAY));
    expect((await fam()).retentionUntil).not.toBeNull();
    const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    play.put("r-new", { productId: "family_50", expiry: fromNow(30 * DAY), accountId: intent.intentId });
    await verifyAndApply({ purchaseToken: "r-new", familyId: ctx.family.id });
    expect((await fam()).retentionUntil).toBeNull();
    expect(await prisma.mediaAsset.count()).toBe(10);
  });

  it("기한 직전 재구독이 아직 반영 안 됐어도, 지우기 직전 Google 재확인으로 막는다", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-race", fromNow(-31 * DAY));
    await prisma.family.update({ where: { id: ctx.family.id }, data: { retentionUntil: fromNow(-MIN) } });
    // Google 에서는 이미 다시 활성 (우리 DB 는 아직 만료 기록)
    play.update("r-race", { state: "SUBSCRIPTION_STATE_ACTIVE", expiry: fromNow(30 * DAY) });
    await prisma.subscription.update({ where: { purchaseToken: "r-race" }, data: { state: "SUBSCRIPTION_STATE_ACTIVE", expiresAt: fromNow(-MIN) } });
    const r = await enforceRetention(ctx.family.id);
    expect(r.deleted).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(10);
    expect((await fam()).plan).toBe("FAMILY_50");
  });

  it("Google 장애로 재확인이 안 되면 지우지 않는다", async () => {
    await addMedia(10);
    await subscribeThenExpire("r-outage", fromNow(-31 * DAY));
    await prisma.subscription.update({ where: { purchaseToken: "r-outage" }, data: { state: "SUBSCRIPTION_STATE_ACTIVE", expiresAt: fromNow(-HOURS(2)) } });
    await prisma.family.update({ where: { id: ctx.family.id }, data: { retentionUntil: fromNow(-MIN) } });
    play.outage = true;
    const r = await enforceRetention(ctx.family.id);
    expect(r.deleted).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(10);
  });

  it("직접 정리해 3GB 이하가 되었으면 기한이 지나도 지우지 않는다", async () => {
    const ids = await addMedia(10);
    await subscribeThenExpire("r-cleaned", fromNow(-31 * DAY));
    await prisma.family.update({ where: { id: ctx.family.id }, data: { retentionUntil: fromNow(-MIN) } });
    // 사용자가 4개를 영구 삭제 → 3GB
    await prisma.mediaAsset.deleteMany({ where: { id: { in: ids.slice(6) } } });
    await prisma.family.update({ where: { id: ctx.family.id }, data: { usedBytes: BigInt(6 * ITEM) } });
    expect(await getRetentionNotice(ctx.family.id)).toBeNull();
    const r = await enforceRetention(ctx.family.id);
    expect(r.deleted).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(6);
    expect((await fam()).retentionUntil).toBeNull();
  });
});

function HOURS(n: number) {
  return n * 3600 * 1000;
}
void GB;
