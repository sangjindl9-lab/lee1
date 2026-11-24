/**
 * 실시간 개발자 알림(RTDN): 인증(OIDC), 패키지명 검증, 메시지 중복 방지, 동시 처리, 순서 뒤바뀜,
 * 일시 오류 → 5xx(재전송), 영구 오류 → 200 + 실패 기록.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { __setPlayApiForTests, createPurchaseIntent } from "@/lib/play-billing";
import { handleRtdn, verifyPushAuth, type IdTokenVerifier } from "@/lib/rtdn";
import { makeFamily, resetDb } from "./helpers";
import { fromNow, MIN, MockPlay, rtdnBody, subNote } from "./mock-play";

let play: MockPlay;
let ctx: Awaited<ReturnType<typeof makeFamily>>;

async function newSub(token: string, expiry = fromNow(30 * MIN)) {
  const intent = await createPurchaseIntent({ familyId: ctx.family.id, userId: ctx.dad.id, role: "PARENT", productId: "family_50", basePlanId: "monthly" });
  play.put(token, { expiry, accountId: intent.intentId, profileId: ctx.dad.id });
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
  ctx = await makeFamily();
});

describe("인증", () => {
  const url = new URL("https://app.example/api/billing/play/rtdn");
  const env = { PLAY_RTDN_SA_EMAIL: "play-billing@x.iam.gserviceaccount.com", PLAY_RTDN_AUDIENCE: url.toString() } as unknown as NodeJS.ProcessEnv;
  const verifier: IdTokenVerifier = async (token, audience) => {
    if (audience !== url.toString()) throw new Error("wrong audience");
    if (token === "good") return { email: "play-billing@x.iam.gserviceaccount.com", email_verified: true };
    if (token === "other") return { email: "attacker@x.iam.gserviceaccount.com", email_verified: true };
    throw new Error("bad signature");
  };

  it("올바른 서비스 계정의 Google 서명 토큰만 통과", async () => {
    expect(await verifyPushAuth({ authorization: "Bearer good", url }, verifier, env)).toBe(true);
    expect(await verifyPushAuth({ authorization: "Bearer other", url }, verifier, env)).toBe(false);
    expect(await verifyPushAuth({ authorization: "Bearer forged", url }, verifier, env)).toBe(false);
    expect(await verifyPushAuth({ authorization: null, url }, verifier, env)).toBe(false);
  });

  it("서명 확인을 켜 두면 주소 비밀값만으로는 통과할 수 없다", async () => {
    const withToken = new URL(`${url}?token=secret`);
    expect(await verifyPushAuth({ authorization: null, url: withToken }, verifier, { ...env, PLAY_RTDN_TOKEN: "secret" })).toBe(false);
  });
});

describe("처리 규칙", () => {
  it("다른 패키지의 알림은 무시하고 아무것도 기록하지 않는다", async () => {
    await newSub("pkg-tok");
    const body = rtdnBody("pkg-1", { ...subNote("pkg-tok", 4, Date.now()), packageName: "com.evil.app" });
    const r = await handleRtdn(body);
    expect(r.status).toBe(200);
    expect(r.body.ignored).toBe("package-mismatch");
    expect(play.getCalls).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it("같은 메시지 ID 는 한 번만 처리한다 (재전송·중복)", async () => {
    await newSub("dup-tok");
    const body = rtdnBody("dup-1", subNote("dup-tok", 4, Date.now()));
    expect((await handleRtdn(body)).status).toBe(200);
    const calls = play.getCalls;
    const again = await handleRtdn(body);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe("DONE");
    expect(play.getCalls).toBe(calls);
  });

  it("같은 메시지가 동시에 10번 와도 Google 확인은 한 번", async () => {
    await newSub("conc-tok");
    play.delayMs = 50;
    const body = rtdnBody("conc-1", subNote("conc-tok", 4, Date.now()));
    const results = await Promise.all(Array.from({ length: 10 }, () => handleRtdn(body)));
    expect(play.getCalls).toBe(1);
    // 처리한 1건 외에는 '중복(200)' 또는 '처리 중이니 나중에(503)'
    for (const r of results) expect([200, 503]).toContain(r.status);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.rtdnEvent.count()).toBe(1);
  });

  it("다른 메시지가 같은 토큰으로 동시에 와도 기록은 하나 (토큰 잠금)", async () => {
    await newSub("lock-tok");
    play.delayMs = 30;
    const now = Date.now();
    await Promise.all(Array.from({ length: 8 }, (_, i) => handleRtdn(rtdnBody(`lock-${i}`, subNote("lock-tok", 2, now + i)))));
    expect(await prisma.subscription.count({ where: { purchaseToken: "lock-tok" } })).toBe(1);
    expect(play.ackCalls).toBe(1);
  });

  it("순서가 뒤바뀐 옛 알림은 건너뛴다 (STALE)", async () => {
    await newSub("order-tok");
    const t = Date.now();
    play.update("order-tok", { state: "SUBSCRIPTION_STATE_CANCELED", autoRenew: false });
    expect((await handleRtdn(rtdnBody("order-new", subNote("order-tok", 3, t + 1000)))).status).toBe(200);
    const calls = play.getCalls;
    const old = await handleRtdn(rtdnBody("order-old", subNote("order-tok", 4, t)));
    expect(old.status).toBe(200);
    expect(old.body.stale).toBe(true);
    expect(play.getCalls).toBe(calls);
    const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "order-tok" } });
    expect(s.state).toBe("SUBSCRIPTION_STATE_CANCELED");
    expect(s.lastEventTime).toBe(BigInt(t + 1000));
  });

  it("Google 장애 같은 일시 오류는 5xx → 재전송되면 처리", async () => {
    await newSub("transient-tok");
    play.outage = true;
    const body = rtdnBody("tr-1", subNote("transient-tok", 4, Date.now()));
    const first = await handleRtdn(body);
    expect(first.status).toBe(500);
    expect((await prisma.rtdnEvent.findUniqueOrThrow({ where: { messageId: "tr-1" } })).status).toBe("RETRY");
    play.outage = false;
    const second = await handleRtdn(body);
    expect(second.status).toBe(200);
    const ev = await prisma.rtdnEvent.findUniqueOrThrow({ where: { messageId: "tr-1" } });
    expect(ev.status).toBe("DONE");
    expect(ev.attempts).toBe(2);
    expect((await prisma.family.findUniqueOrThrow({ where: { id: ctx.family.id } })).plan).toBe("FAMILY_50");
  });

  it("승인 실패도 일시 오류: 5xx 로 다시 받는다", async () => {
    await newSub("ackfail-tok");
    play.ackMode = "outage";
    const r = await handleRtdn(rtdnBody("ackfail-1", subNote("ackfail-tok", 4, Date.now())));
    expect(r.status).toBe(500);
    play.ackMode = "ok";
    expect((await handleRtdn(rtdnBody("ackfail-1", subNote("ackfail-tok", 4, Date.now())))).status).toBe(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "ackfail-tok" } })).acknowledged).toBe(true);
  });

  it("모르는 토큰·주인 불명은 영구 실패로 기록하고 200 (무한 재전송 방지)", async () => {
    const unknown = await handleRtdn(rtdnBody("perm-1", subNote("no-such-token", 4, Date.now())));
    expect(unknown.status).toBe(200);
    expect((await prisma.rtdnEvent.findUniqueOrThrow({ where: { messageId: "perm-1" } })).status).toBe("FAILED_PERMANENT");

    play.put("orphan-tok", { expiry: fromNow(30 * MIN) }); // 구매 식별자 없음
    const orphan = await handleRtdn(rtdnBody("perm-2", subNote("orphan-tok", 4, Date.now())));
    expect(orphan.status).toBe(200);
    expect(orphan.body.failed).toBe("OWNERSHIP_UNKNOWN");
    expect(await prisma.subscription.count()).toBe(0);

    // 같은 메시지가 다시 와도 다시 처리하지 않는다
    const calls = play.getCalls;
    expect((await handleRtdn(rtdnBody("perm-2", subNote("orphan-tok", 4, Date.now())))).body.duplicate).toBe("FAILED_PERMANENT");
    expect(play.getCalls).toBe(calls);
  });

  it("앱보다 알림이 먼저 와도 구매 식별자로 올바른 가족에 연결", async () => {
    await newSub("early-tok");
    const r = await handleRtdn(rtdnBody("early-1", subNote("early-tok", 4, Date.now())));
    expect(r.status).toBe(200);
    const s = await prisma.subscription.findUniqueOrThrow({ where: { purchaseToken: "early-tok" } });
    expect(s.familyId).toBe(ctx.family.id);
    expect(s.userId).toBe(ctx.dad.id);
  });

  it("테스트 알림·빈 본문", async () => {
    expect((await handleRtdn(rtdnBody("test-1", { testNotification: { version: "1.0" } }))).body.test).toBe(true);
    expect((await handleRtdn({})).body.ignored).toBe("no-data");
    expect((await handleRtdn({ message: { data: "!!!not-base64-json", messageId: "bad" } })).body.ignored).toBe("no-data");
  });

  it("멈춘 처리(2분 넘게 PROCESSING)는 다음 재전송이 이어받는다", async () => {
    await newSub("stuck-tok");
    await prisma.rtdnEvent.create({
      data: { messageId: "stuck-1", kind: "SUBSCRIPTION", purchaseToken: "stuck-tok", status: "PROCESSING", attempts: 1 },
    });
    await prisma.$executeRaw`UPDATE "RtdnEvent" SET "updatedAt" = ${new Date(Date.now() - 5 * MIN)} WHERE "messageId" = 'stuck-1'`;
    const r = await handleRtdn(rtdnBody("stuck-1", subNote("stuck-tok", 4, Date.now())));
    expect(r.status).toBe(200);
    expect((await prisma.rtdnEvent.findUniqueOrThrow({ where: { messageId: "stuck-1" } })).status).toBe("DONE");
  });
});
