/**
 * 저장 공간 권한: 유효 요금제(만료 경계 재검증) 기준 검사, 원자적 예약(동시 업로드),
 * 직접 업로드 준비·완료, 서버 경유 업로드, 실제 저장 크기(원본+미리보기+썸네일)와 사용량 일치.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 직접 업로드(S3) 경로를 시험하기 위해 저장소의 'S3 사용 여부·서명 주소·크기 조회'만 가짜로 바꾼다. 파일 읽기·쓰기는 로컬 그대로.
const fakeSizes = new Map<string, number>();
vi.mock("@/lib/storage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...orig,
    useS3: true,
    signedPutUrl: async (rel: string) => `https://mock-bucket.local/${rel}?sig=test`,
    storedSize: async (rel: string) => (fakeSizes.has(rel) ? (fakeSizes.get(rel) as number) : orig.storedSize(rel)),
  };
});

import { createHash } from "node:crypto";
import prisma from "@/lib/db";
import { __setPlayApiForTests, verifyAndApply } from "@/lib/play-billing";
import { assertQuota, getEffectiveUsage, reserveQuota } from "@/lib/entitlement";
import { completeDirectUpload, createUploadSession, prepareDirectUpload, uploadItem } from "@/lib/upload";
import { PLANS } from "@/lib/plans";
import { storedSize as realStoredSize } from "./real-storage";
import { makeFamily, makeImageBuffer, resetDb } from "./helpers";
import { fromNow, GB, MB, MIN, MockPlay } from "./mock-play";

let play: MockPlay;
let ctx: Awaited<ReturnType<typeof makeFamily>>;
const FREE = PLANS.FREE.quotaBytes;

async function setUsed(bytes: number) {
  await prisma.family.update({ where: { id: ctx.family.id }, data: { usedBytes: BigInt(bytes) } });
}
async function used() {
  return Number((await prisma.family.findUniqueOrThrow({ where: { id: ctx.family.id } })).usedBytes);
}
function hash(i: number) {
  return createHash("sha256").update(`file-${i}`).digest("hex");
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
  fakeSizes.clear();
  ctx = await makeFamily();
});

describe("유효 권한 기준 검사", () => {
  it("요금제 기록은 50GB 지만 만료됐고 Google 도 만료라면 무료 3GB 로 검사", async () => {
    play.put("q-exp", { productId: "family_50", expiry: fromNow(10 * MIN), accountId: ctx.family.id, acked: true });
    await verifyAndApply({ purchaseToken: "q-exp", familyId: ctx.family.id });
    await setUsed(10 * GB);
    expect((await getEffectiveUsage(ctx.family.id)).quotaBytes).toBe(PLANS.FAMILY_50.quotaBytes);
    // 시간이 흘러 만료
    play.update("q-exp", { state: "SUBSCRIPTION_STATE_EXPIRED", expiry: fromNow(-MIN) });
    await prisma.subscription.update({ where: { purchaseToken: "q-exp" }, data: { expiresAt: fromNow(-MIN) } });
    await prisma.family.update({ where: { id: ctx.family.id }, data: { planExpiresAt: fromNow(-MIN) } });
    await expect(assertQuota(ctx.family.id, MB)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const u = await getEffectiveUsage(ctx.family.id);
    expect(u.plan.id).toBe("FREE");
    expect(u.usedBytes).toBe(10 * GB); // 사용량(=기존 사진)은 그대로
  });

  it("만료 시각이 지났어도 Google 이 갱신됐다고 하면 업로드 허용", async () => {
    play.put("q-renew", { productId: "family_50", expiry: fromNow(10 * MIN), accountId: ctx.family.id, acked: true });
    await verifyAndApply({ purchaseToken: "q-renew", familyId: ctx.family.id });
    await setUsed(10 * GB);
    play.update("q-renew", { expiry: fromNow(30 * MIN) });
    await prisma.subscription.update({ where: { purchaseToken: "q-renew" }, data: { expiresAt: fromNow(-MIN) } });
    await prisma.family.update({ where: { id: ctx.family.id }, data: { planExpiresAt: fromNow(-MIN) } });
    await expect(reserveQuota(ctx.family.id, 100 * MB)).resolves.toBeTruthy();
  });
});

describe("원자적 예약", () => {
  it("무료 3GB 에 100MB 씩 50건 동시 예약 → 정확히 30건만 성공, 상한 초과 없음", async () => {
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => reserveQuota(ctx.family.id, 100 * MB)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok).toBe(Math.floor(FREE / (100 * MB)));
    expect(fail.every((r) => (r as PromiseRejectedResult).reason?.code === "QUOTA_EXCEEDED")).toBe(true);
    expect(await used()).toBe(ok * 100 * MB);
    expect(await used()).toBeLessThanOrEqual(FREE);
  });
});

describe("직접 업로드 (준비 → 저장소 PUT → 완료)", () => {
  async function session(n: number, size: number) {
    const files = Array.from({ length: n }, (_, i) => ({ clientFileId: `d${i}`, fileName: `big-${i}.jpg`, mimeType: "image/jpeg", sizeBytes: size }));
    const { session: s, items } = await createUploadSession({
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      visibility: "FAMILY",
      files,
    });
    return { s, items };
  }

  it("동시 준비 20건(각 200MB) → 상한 안에서만 예약, 사용량 = 예약 합계", async () => {
    const size = 200 * MB;
    const { s, items } = await session(20, size);
    const results = await Promise.allSettled(
      items.map((it, i) =>
        prepareDirectUpload({ userId: ctx.dad.id, sessionId: s.id, itemId: it.id, contentHash: hash(i), sizeBytes: size, mimeType: "image/jpeg", fileName: it.fileName, capturedAt: null }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled" && (r.value as { mode: string }).mode === "direct");
    expect(ok.length).toBe(Math.floor(FREE / size)); // 15
    expect(await used()).toBe(ok.length * size);
    const reserved = await prisma.mediaAsset.aggregate({ where: { familyId: ctx.family.id, status: "UPLOADING" }, _sum: { storedBytes: true } });
    expect(reserved._sum.storedBytes).toBe(ok.length * size);
  });

  it("완료: 올라간 크기가 예약과 다르면 실패, 같으면 처리 작업(올린 시점 요금제 포함)을 한 번만 건다", async () => {
    const size = 5 * MB;
    const { s, items } = await session(2, size);
    const prepared = [];
    for (let i = 0; i < 2; i += 1) {
      prepared.push(
        (await prepareDirectUpload({ userId: ctx.dad.id, sessionId: s.id, itemId: items[i].id, contentHash: hash(100 + i), sizeBytes: size, mimeType: "image/jpeg", fileName: items[i].fileName, capturedAt: null })) as { mode: string; mediaId: string },
      );
    }
    const m0 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: prepared[0].mediaId } });
    const m1 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: prepared[1].mediaId } });
    fakeSizes.set(m0.originalPath, size); // 정상
    fakeSizes.set(m1.originalPath, size + 1024); // 예약보다 큰 파일로 바꿔치기
    const done = await Promise.all([1, 2, 3].map(() => completeDirectUpload({ userId: ctx.dad.id, sessionId: s.id, itemId: items[0].id })));
    expect(done.every((d) => d.status === "DONE")).toBe(true);
    const bad = await completeDirectUpload({ userId: ctx.dad.id, sessionId: s.id, itemId: items[1].id });
    expect(bad.status).toBe("FAILED");
    const jobs = await prisma.job.findMany({ where: { type: "PROCESS_MEDIA" } });
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toEqual({ mediaId: m0.id, keepOriginals: "0" });
  });

  it("상한을 넘는 준비는 거절되고 아무것도 예약하지 않는다", async () => {
    await setUsed(FREE - MB);
    const { s, items } = await session(1, 2 * MB);
    await expect(
      prepareDirectUpload({ userId: ctx.dad.id, sessionId: s.id, itemId: items[0].id, contentHash: hash(7), sizeBytes: 2 * MB, mimeType: "image/jpeg", fileName: "x.jpg", capturedAt: null }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(await used()).toBe(FREE - MB);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});

describe("서버 경유 업로드 동시성과 실제 저장 크기", () => {
  it("남은 공간이 조금일 때 10장을 동시에 올리면 일부만 성공하고, 사용량 = 실제 저장 파일 크기 합", async () => {
    const buffers = await Promise.all(Array.from({ length: 10 }, (_, i) => makeImageBuffer(`q${i}`)));
    const { session: s, items } = await createUploadSession({
      userId: ctx.dad.id,
      familyId: ctx.family.id,
      childId: ctx.first.id,
      albumId: ctx.firstAlbum.id,
      visibility: "FAMILY",
      files: buffers.map((b, i) => ({ clientFileId: `p${i}`, fileName: `p${i}.jpg`, mimeType: "image/jpeg", sizeBytes: b.byteLength })),
    });
    const one = buffers[0].byteLength;
    const baseline = FREE - Math.floor(one * 3.5);
    await setUsed(baseline);
    const results = await Promise.all(
      items.map((it, i) => uploadItem({ userId: ctx.dad.id, sessionId: s.id, itemId: it.id, fileName: `p${i}.jpg`, mimeType: "image/jpeg", buffer: buffers[i] })),
    );
    const ok = results.filter((r) => r.status === "DONE");
    const failed = results.filter((r) => r.status === "FAILED");
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.length).toBeLessThan(10);
    expect(failed.every((f) => (f.error ?? "").includes("저장 공간"))).toBe(true);

    const media = await prisma.mediaAsset.findMany({ where: { familyId: ctx.family.id } });
    const sumStored = media.reduce((s2, m) => s2 + m.storedBytes, 0);
    expect(await used()).toBe(baseline + sumStored);
    // 기록한 크기 = 저장소에 실제로 있는 원본+미리보기+썸네일 크기
    for (const m of media) {
      let actual = 0;
      for (const rel of [m.originalPath, m.previewPath, m.thumbPath]) if (rel) actual += (await realStoredSize(rel)) ?? 0;
      expect(m.storedBytes).toBe(actual);
    }
  });
});
