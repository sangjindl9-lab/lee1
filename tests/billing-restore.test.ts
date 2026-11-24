/**
 * 구매 복원·소유권·중복 결제 방지:
 * 새 휴대폰·재설치 후 같은 가족 복원, 다른 가족 토큰 탈취 차단, 주인 불명 토큰 미연결, 이전 버전(가족 ID) 호환,
 * 같은 토큰 동시 100회 멱등성, 가족 단위 결제 잠금, 이미 보유한 상품 → 복원/요금제 변경 안내.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { __setPlayApiForTests, cancelPurchaseIntent, createPurchaseIntent, INTENT_TTL_MS, verifyAndApply } from "@/lib/play-billing";
import { makeFamily, resetDb } from "./helpers";
import { DAY, fromNow, MIN, MockPlay } from "./mock-play";

let play: MockPlay;
let a: Awaited<ReturnType<typeof makeFamily>>;
let b: Awaited<ReturnType<typeof makeFamily>>;

async function purchase(ctx: typeof a, token: string, productId = "family_50", basePlanId = "monthly", userId = ctx.dad.id) {
  const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId, role: "PARENT", productId, basePlanId });
  play.put(token, { productId, basePlanId, expiry: fromNow(30 * DAY), accountId: intent.intentId, profileId: userId, linked: intent.oldToken });
  await verifyAndApply({ purchaseToken: token, familyId: ctx.family.id, userId, source: "app" });
  return intent;
}

beforeAll(() => {
  play = new MockPlay();
  __setPlayApiForTests(play);
});
afterAll(() => __setPlayApiForTests(null));
beforeEach(async () => {
  await resetDb();
  play.subs.clear();
  play.getCalls = 0;
  play.ackCalls = 0;
  play.outage = false;
  play.ackMode = "ok";
  play.delayMs = 0;
  a = await makeFamily();
  b = await makeFamily();
});

describe("복원", () => {
  it("새 휴대폰(엄마 기기)·재설치 후 복원: 같은 가족이면 그대로 이어진다", async () => {
    await purchase(a, "restore-tok");
    // 엄마가 새 휴대폰에서 같은 Google 계정으로 로그인 → 앱이 구매 목록을 읽어 서버에 보냄
    const r1 = await verifyAndApply({ purchaseToken: "restore-tok", familyId: a.family.id, userId: a.mom.id, source: "restore" });
    expect(r1.sub.familyId).toBe(a.family.id);
    expect(r1.sub.userId).toBe(a.dad.id); // 결제자는 그대로
    // 재설치 후 아빠가 다시 복원
    await verifyAndApply({ purchaseToken: "restore-tok", familyId: a.family.id, userId: a.dad.id, source: "restore" });
    expect(await prisma.subscription.count()).toBe(1);
    expect((await prisma.family.findUniqueOrThrow({ where: { id: a.family.id } })).plan).toBe("FAMILY_50");
  });

  it("DB 기록이 사라졌어도(새 서버 등) 구매 식별자로 원래 가족에 다시 연결", async () => {
    await purchase(a, "rebuild-tok");
    await prisma.subscription.deleteMany();
    const r = await verifyAndApply({ purchaseToken: "rebuild-tok", familyId: a.family.id, userId: a.mom.id, source: "restore" });
    expect(r.sub.familyId).toBe(a.family.id);
  });

  it("다른 가족의 토큰으로는 복원할 수 없다 (토큰 탈취 차단)", async () => {
    await purchase(a, "stolen-tok");
    await expect(verifyAndApply({ purchaseToken: "stolen-tok", familyId: b.family.id, userId: b.dad.id, source: "restore" })).rejects.toMatchObject({
      code: "FAMILY_MISMATCH",
      status: 403,
    });
    const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "stolen-tok" } });
    expect(s.familyId).toBe(a.family.id);
    expect((await prisma.family.findUniqueOrThrow({ where: { id: b.family.id } })).plan).toBe("FREE");
  });

  it("처음 보는 다른 가족 토큰도 차단 (DB 에 기록이 없을 때)", async () => {
    const intent = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    play.put("fresh-stolen", { expiry: fromNow(DAY), accountId: intent.intentId });
    await expect(verifyAndApply({ purchaseToken: "fresh-stolen", familyId: b.family.id, userId: b.dad.id, source: "restore" })).rejects.toMatchObject({
      code: "FAMILY_MISMATCH",
    });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("주인을 확인할 수 없는 토큰은 요청한 가족에게도 자동 연결하지 않는다", async () => {
    play.put("no-owner", { expiry: fromNow(DAY) }); // obfuscatedAccountId 없음
    await expect(verifyAndApply({ purchaseToken: "no-owner", familyId: b.family.id, userId: b.dad.id, source: "restore" })).rejects.toMatchObject({
      code: "OWNERSHIP_UNKNOWN",
    });
    play.put("fake-owner", { expiry: fromNow(DAY), accountId: "not-an-intent-or-family" });
    await expect(verifyAndApply({ purchaseToken: "fake-owner", familyId: b.family.id, userId: b.dad.id })).rejects.toMatchObject({
      code: "OWNERSHIP_UNKNOWN",
    });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("이전 버전 앱의 구매(가족 ID 를 그대로 넘긴 경우)도 그 가족에만 연결", async () => {
    play.put("legacy-tok", { expiry: fromNow(DAY), accountId: a.family.id, profileId: a.dad.id, acked: true });
    await expect(verifyAndApply({ purchaseToken: "legacy-tok", familyId: b.family.id })).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
    const r = await verifyAndApply({ purchaseToken: "legacy-tok", familyId: a.family.id, source: "restore" });
    expect(r.sub.familyId).toBe(a.family.id);
    expect(r.sub.userId).toBe(a.dad.id);
  });

  it("같은 토큰 동시 100회: 기록 1개, 승인 1번, 모두 같은 결과", async () => {
    const intent = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    play.put("hundred", { expiry: fromNow(30 * MIN), accountId: intent.intentId, profileId: a.dad.id });
    play.delayMs = 2;
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        verifyAndApply({ purchaseToken: "hundred", familyId: a.family.id, userId: i % 2 ? a.dad.id : a.mom.id, source: i % 3 ? "app" : "restore" }),
      ),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);
    expect(await prisma.subscription.count({ where: { purchaseToken: "hundred" } })).toBe(1);
    expect(play.ackCalls).toBe(1);
    const fam = await prisma.family.findUniqueOrThrow({ where: { id: a.family.id } });
    expect(fam.plan).toBe("FAMILY_50");
    expect((await prisma.purchaseIntent.findUniqueOrThrow({ where: { id: intent.intentId! } })).status).toBe("COMPLETED");
  });
});

describe("중복 결제 방지", () => {
  it("가족 단위 결제 잠금: 아빠가 결제창을 연 동안 엄마는 시작할 수 없다", async () => {
    const dad = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    expect(dad.action).toBe("PURCHASE");
    await expect(
      createPurchaseIntent({ familyId: a.family.id, userId: a.mom.id, role: "PARENT", productId: "family_200", basePlanId: "monthly" }),
    ).rejects.toMatchObject({ code: "PURCHASE_IN_PROGRESS" });
    // 다른 가족은 영향 없음
    expect((await createPurchaseIntent({ familyId: b.family.id, userId: b.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" })).action).toBe("PURCHASE");
    // 결제창을 닫으면 풀린다
    await cancelPurchaseIntent({ intentId: dad.intentId!, userId: a.dad.id });
    expect((await createPurchaseIntent({ familyId: a.family.id, userId: a.mom.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" })).action).toBe("PURCHASE");
  });

  it("연속 클릭: 같은 사람이 여러 번 눌러도 결제 시작 기록은 하나", async () => {
    const r = await Promise.all(
      Array.from({ length: 20 }, () => createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" })),
    );
    expect(new Set(r.map((x) => x.intentId)).size).toBe(1);
    expect(await prisma.purchaseIntent.count({ where: { familyId: a.family.id, status: "PENDING" } })).toBe(1);
  });

  it("잠금은 30분 뒤 자동으로 풀린다", async () => {
    const dad = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    await prisma.purchaseIntent.update({ where: { id: dad.intentId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(INTENT_TTL_MS).toBe(30 * MIN);
    expect((await createPurchaseIntent({ familyId: a.family.id, userId: a.mom.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" })).action).toBe("PURCHASE");
  });

  it("이미 같은 상품을 쓰면 새 결제 대신 복원, 다른 요금제면 요금제 변경(기존 토큰)", async () => {
    await purchase(a, "own-50", "family_50", "monthly");
    const same = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    expect(same.action).toBe("RESTORE");
    expect(same.intentId).toBeNull();
    const change = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_200", basePlanId: "monthly" });
    expect(change.action).toBe("CHANGE");
    expect(change.oldToken).toBe("own-50");
    const cycle = await createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_50", basePlanId: "yearly" });
    expect(cycle.action).toBe("CHANGE");
  });

  it("다른 부모가 구독 중이면 두 번째 결제를 막는다", async () => {
    await purchase(a, "dad-sub");
    await expect(
      createPurchaseIntent({ familyId: a.family.id, userId: a.mom.id, role: "PARENT", productId: "family_200", basePlanId: "monthly" }),
    ).rejects.toMatchObject({ code: "SUBSCRIBED_BY_OTHER" });
  });

  it("조부모 계정·없는 상품은 결제 시작 불가", async () => {
    await expect(
      createPurchaseIntent({ familyId: a.family.id, userId: a.grandma.id, role: "GRANDPARENT", productId: "family_50", basePlanId: "monthly" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createPurchaseIntent({ familyId: a.family.id, userId: a.dad.id, role: "PARENT", productId: "family_1tb", basePlanId: "yearly" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
  });

  it("purchaseToken 은 DB 에서 고유하다", async () => {
    await purchase(a, "unique-tok");
    await expect(
      prisma.subscription.create({
        data: { familyId: b.family.id, userId: b.dad.id, productId: "family_50", plan: "FAMILY_50", purchaseToken: "unique-tok", state: "SUBSCRIPTION_STATE_ACTIVE" },
      }),
    ).rejects.toThrow();
  });
});
