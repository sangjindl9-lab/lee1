/**
 * 구독 상태 전체 흐름: 최초 구매 → 갱신 6회 → 해지 → 만료 / 유예 / 결제 보류 / 환불,
 * 만료 경계 재검증, Google 장애와 실제 만료 구분, 같은 요금제 여러 구독, 승인(acknowledge) 처리, 요금제 변경 실패.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import {
  __setPlayApiForTests,
  createPurchaseIntent,
  OUTAGE_GRACE_MS,
  recomputeFamilyPlan,
  refreshFamilyEntitlement,
  verifyAndApply,
} from "@/lib/play-billing";
import { getEffectivePlan } from "@/lib/entitlement";
import { handleRtdn } from "@/lib/rtdn";
import { makeFamily, resetDb } from "./helpers";
import { DAY, fromNow, HOUR, MIN, MockPlay, rtdnBody, subNote } from "./mock-play";

let play: MockPlay;
let ctx: Awaited<ReturnType<typeof makeFamily>>;

async function family() {
  return prisma.family.findUniqueOrThrow({ where: { id: ctx.family.id } });
}

/** 테스트용: 시간이 흐른 것처럼 DB 의 만료 시각을 과거로 돌린다 */
async function ageSubscription(token: string, expiresAt: Date) {
  await prisma.subscription.update({ where: { purchaseToken: token }, data: { expiresAt } });
  const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: token } });
  await recomputeFamilyPlan(s.familyId);
  await prisma.family.update({ where: { id: s.familyId }, data: { plan: s.plan, planExpiresAt: expiresAt } });
}

async function buy(token: string, productId = "family_50", basePlanId = "monthly", expiry = fromNow(30 * MIN), userId = ctx.dad.id) {
  const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId, role: "PARENT", productId, basePlanId });
  play.put(token, { productId, basePlanId, expiry, accountId: intent.intentId, profileId: userId, linked: intent.oldToken });
  return { intent, result: await verifyAndApply({ purchaseToken: token, userId, familyId: ctx.family.id, source: "app" }) };
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
  ctx = await makeFamily();
});

describe("구독 수명 주기 (2026-11-23 테스트 구독 재현: 30분 간격 6회 갱신 후 해지)", () => {
  it("최초 구매 → 승인 → 가족 요금제 50GB", async () => {
    const { result } = await buy("tok-life");
    expect(result.sub.state).toBe("SUBSCRIPTION_STATE_ACTIVE");
    expect(result.sub.acknowledged).toBe(true);
    expect(play.ackCalls).toBe(1);
    expect((await family()).plan).toBe("FAMILY_50");
    const intent = await prisma.purchaseIntent.findFirstOrThrow({ where: { familyId: ctx.family.id } });
    expect(intent.status).toBe("COMPLETED");
  });

  it("갱신 6회: 매번 최신 만료일로 연장되고 요금제가 유지된다", async () => {
    const start = Date.now();
    await buy("tok-renew", "family_50", "monthly", new Date(start + 30 * MIN));
    for (let i = 1; i <= 6; i += 1) {
      const expiry = new Date(start + (i + 1) * 30 * MIN);
      play.update("tok-renew", { expiry });
      const r = await handleRtdn(rtdnBody(`renew-${i}`, subNote("tok-renew", 2, start + i * 30 * MIN)));
      expect(r.status).toBe(200);
      const f = await family();
      expect(f.plan).toBe("FAMILY_50");
      expect(f.planExpiresAt?.toISOString()).toBe(expiry.toISOString());
    }
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.rtdnEvent.count({ where: { status: "DONE" } })).toBe(6);
  });

  it("해지(CANCELED): 결제한 기간이 끝날 때까지는 유지, 만료 뒤에는 무료", async () => {
    await buy("tok-cancel", "family_50", "monthly", fromNow(20 * MIN));
    play.update("tok-cancel", { state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false });
    await handleRtdn(rtdnBody("cancel-1", subNote("tok-cancel", 3, Date.now())));
    expect((await family()).plan).toBe("FAMILY_50");

    // 기간이 지나면 Google 은 EXPIRED 로 바뀐다 → 경계에서 다시 확인해 무료로
    play.update("tok-cancel", { state: "SUBSCRIPTION_STATE_EXPIRED", expiry: fromNow(-MIN) });
    await ageSubscription("tok-cancel", fromNow(-MIN));
    const before = play.getCalls;
    const eff = await getEffectivePlan(ctx.family.id);
    expect(play.getCalls).toBe(before + 1); // 경계에서 Google 재검증
    expect(eff.plan.id).toBe("FREE");
    expect((await family()).plan).toBe("FREE");
  });

  it("ACTIVE 라도 만료 시각이 지나면 권한이 없다 (상태만 믿지 않음)", async () => {
    await buy("tok-active-past", "family_50", "monthly", fromNow(10 * MIN));
    await prisma.subscription.update({ where: { purchaseToken: "tok-active-past" }, data: { expiresAt: fromNow(-MIN) } });
    const r = await recomputeFamilyPlan(ctx.family.id);
    expect(r.plan).toBe("FREE");
  });

  it("만료 경계: Google 이 갱신됐다고 하면 새 만료일로 계속 유지", async () => {
    await buy("tok-boundary", "family_50", "monthly", fromNow(10 * MIN));
    await ageSubscription("tok-boundary", fromNow(-MIN));
    play.update("tok-boundary", { expiry: fromNow(30 * MIN) });
    const eff = await getEffectivePlan(ctx.family.id);
    expect(eff.plan.id).toBe("FAMILY_50");
    expect(eff.unverified).toBe(false);
  });

  it("Google 장애와 실제 만료를 구분: 장애면 만료 후 72시간까지 유지(미확인 표시), 그 뒤에는 무료", async () => {
    await buy("tok-outage", "family_50", "monthly", fromNow(10 * MIN));
    await ageSubscription("tok-outage", fromNow(-HOUR));
    play.outage = true;
    const eff = await getEffectivePlan(ctx.family.id);
    expect(eff.plan.id).toBe("FAMILY_50");
    expect(eff.unverified).toBe(true);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "tok-outage" } });
    expect(sub.lastCheckError).toContain("503");

    // 장애가 72시간 넘게 이어지면 더는 유지하지 않는다
    await prisma.subscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - OUTAGE_GRACE_MS - HOUR) } });
    const after = await refreshFamilyEntitlement(ctx.family.id);
    expect(after.plan).toBe("FREE");

    // 장애가 풀리고 Google 이 '실제로 만료'라고 하면 바로 무료 (유지 기간 없음)
    play.outage = false;
    play.update("tok-outage", { state: "SUBSCRIPTION_STATE_EXPIRED", expiry: fromNow(-HOUR) });
    await refreshFamilyEntitlement(ctx.family.id);
    const s2 = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(s2.state).toBe("SUBSCRIPTION_STATE_EXPIRED");
    expect(s2.lastCheckError).toBeNull();
    expect((await family()).plan).toBe("FREE");
  });

  it("유예 기간(IN_GRACE_PERIOD)은 유지, 결제 보류(ON_HOLD)는 무료", async () => {
    await buy("tok-grace", "family_50", "monthly", fromNow(10 * MIN));
    play.update("tok-grace", { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", expiry: fromNow(3 * DAY) });
    await handleRtdn(rtdnBody("grace-1", subNote("tok-grace", 6, Date.now())));
    expect((await family()).plan).toBe("FAMILY_50");

    play.update("tok-grace", { state: "SUBSCRIPTION_STATE_ON_HOLD", expiry: fromNow(-MIN) });
    await handleRtdn(rtdnBody("hold-1", subNote("tok-grace", 5, Date.now() + 1)));
    expect((await family()).plan).toBe("FREE");

    // 보류가 풀리면(결제 복구) 다시 유료
    play.update("tok-grace", { state: "SUBSCRIPTION_STATE_ACTIVE", expiry: fromNow(30 * MIN) });
    await handleRtdn(rtdnBody("recovered-1", subNote("tok-grace", 1, Date.now() + 2)));
    expect((await family()).plan).toBe("FAMILY_50");
  });

  it("환불(voided): 즉시 무료, 이후 다른 알림이 와도 되살아나지 않는다", async () => {
    await buy("tok-refund", "family_50", "monthly", fromNow(30 * MIN));
    const r = await handleRtdn(rtdnBody("void-1", { voidedPurchaseNotification: { purchaseToken: "tok-refund", orderId: "GPA.1", productType: 1, refundType: 1 } }));
    expect(r.status).toBe(200);
    expect((await family()).plan).toBe("FREE");
    // 순서가 늦게 도착한 '갱신' 알림 (Google 은 아직 ACTIVE 로 응답하는 상황)
    await handleRtdn(rtdnBody("late-renew", subNote("tok-refund", 2, Date.now() + 5)));
    const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "tok-refund" } });
    expect(s.state).toBe("REVOKED");
    expect((await family()).plan).toBe("FREE");
  });
});

describe("요금제 선택", () => {
  it("같은 요금제의 유효 구독이 여럿이면 가장 늦은 만료일", async () => {
    const t1 = fromNow(1 * DAY);
    const t2 = fromNow(20 * DAY);
    for (const [token, exp] of [
      ["same-a", t1],
      ["same-b", t2],
    ] as const) {
      play.put(token, { productId: "family_50", expiry: exp, accountId: ctx.family.id, acked: true });
      await verifyAndApply({ purchaseToken: token, familyId: ctx.family.id, userId: ctx.dad.id });
    }
    const f = await family();
    expect(f.plan).toBe("FAMILY_50");
    expect(f.planExpiresAt?.toISOString()).toBe(t2.toISOString());
  });

  it("더 높은 요금제가 만료일이 짧아도 우선", async () => {
    play.put("low", { productId: "family_50", expiry: fromNow(30 * DAY), accountId: ctx.family.id, acked: true });
    play.put("high", { productId: "family_200", expiry: fromNow(1 * DAY), accountId: ctx.family.id, acked: true });
    await verifyAndApply({ purchaseToken: "low", familyId: ctx.family.id });
    await verifyAndApply({ purchaseToken: "high", familyId: ctx.family.id });
    expect((await family()).plan).toBe("FAMILY_200");
  });
});

describe("구매 승인(acknowledge)", () => {
  it("Google 이 400 으로 거절하고 실제로도 미승인이면 승인 성공으로 처리하지 않는다", async () => {
    play.ackMode = "reject";
    const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
    play.put("ack-reject", { expiry: fromNow(30 * MIN), accountId: intent.intentId });
    await expect(verifyAndApply({ purchaseToken: "ack-reject", familyId: ctx.family.id, userId: ctx.dad.id })).rejects.toMatchObject({
      code: "ACK_REJECTED",
      retryable: true,
    });
    const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "ack-reject" } });
    expect(s.acknowledged).toBe(false); // 재확인 작업이 다시 승인한다
    // 재시도 때 승인이 되면 정상 반영
    play.ackMode = "ok";
    const r = await verifyAndApply({ purchaseToken: "ack-reject", familyId: ctx.family.id, userId: ctx.dad.id });
    expect(r.sub.acknowledged).toBe(true);
  });

  it("400 거절이지만 Google 상태가 '이미 승인됨'이면 성공", async () => {
    play.ackMode = "reject-but-acked";
    const { result } = await buy("ack-already");
    expect(result.sub.acknowledged).toBe(true);
  });

  it("승인 후 DB 기록이 실패했어도 다음 확인에서 Google 상태로 복구 (승인 재요청 없음)", async () => {
    await buy("ack-db-fail");
    // DB 반영 실패를 흉내: Google 은 승인됨, 우리 DB 는 미승인
    await prisma.subscription.update({ where: { purchaseToken: "ack-db-fail" }, data: { acknowledged: false } });
    const acks = play.ackCalls;
    const r = await verifyAndApply({ purchaseToken: "ack-db-fail", familyId: ctx.family.id });
    expect(r.sub.acknowledged).toBe(true);
    expect(play.ackCalls).toBe(acks);
  });

  it("결제 대기(PENDING)는 권한도 승인도 없다", async () => {
    play.put("pending-1", { state: "SUBSCRIPTION_STATE_PENDING", expiry: fromNow(30 * MIN), accountId: ctx.family.id });
    const r = await verifyAndApply({ purchaseToken: "pending-1", familyId: ctx.family.id });
    expect(r.plan.plan).toBe("FREE");
    expect(play.ackCalls).toBe(0);
  });
});

describe("요금제 변경", () => {
  it("변경 결제가 대기·실패면 기존 구독을 REPLACED 로 바꾸지 않는다", async () => {
    await buy("old-50", "family_50", "monthly", fromNow(20 * DAY));
    const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_200", basePlanId: "monthly" });
    expect(intent.action).toBe("CHANGE");
    expect(intent.oldToken).toBe("old-50");
    play.put("new-200", { productId: "family_200", state: "SUBSCRIPTION_STATE_PENDING", expiry: fromNow(30 * DAY), accountId: intent.intentId, linked: "old-50" });
    await verifyAndApply({ purchaseToken: "new-200", familyId: ctx.family.id, userId: ctx.dad.id });
    const old = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "old-50" } });
    expect(old.state).toBe("SUBSCRIPTION_STATE_ACTIVE");
    expect((await family()).plan).toBe("FAMILY_50");

    // 결제가 끝나 새 구독이 활성화되면 그때 교체
    play.update("new-200", { state: "SUBSCRIPTION_STATE_ACTIVE" });
    await verifyAndApply({ purchaseToken: "new-200", familyId: ctx.family.id, userId: ctx.dad.id });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "old-50" } })).state).toBe("REPLACED");
    expect((await family()).plan).toBe("FAMILY_200");
  });

  it("변경 확인 중 Google 장애면 아무것도 바꾸지 않는다", async () => {
    await buy("old-keep", "family_50", "monthly", fromNow(20 * DAY));
    const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_200", basePlanId: "monthly" });
    play.put("new-fail", { productId: "family_200", expiry: fromNow(30 * DAY), accountId: intent.intentId, linked: "old-keep" });
    play.outage = true;
    await expect(verifyAndApply({ purchaseToken: "new-fail", familyId: ctx.family.id })).rejects.toMatchObject({ retryable: true });
    expect(await prisma.subscription.count({ where: { purchaseToken: "new-fail" } })).toBe(0);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "old-keep" } })).state).toBe("SUBSCRIPTION_STATE_ACTIVE");
    expect((await family()).plan).toBe("FAMILY_50");
  });
});
