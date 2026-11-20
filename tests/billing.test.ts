import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db";
import { BillingError, createInquiry, getEntitlement, nextAd, purchase, recheckBilling, restorePurchases } from "@/lib/billing";
import { makeFamily, resetDb } from "./helpers";

let ctx: Awaited<ReturnType<typeof makeFamily>>;

describe("3) 광고 제거 결제 · 구매 복원 · 일일 1회 광고", () => {
  beforeAll(async () => {
    await resetDb();
    ctx = await makeFamily();
  });

  it("광고는 같은 날 두 번 나오지 않는다 (재실행·재시도 포함)", async () => {
    const first = await nextAd(ctx.dad.id, "today");
    expect(first.show).toBe(true);
    expect(first.ad?.id).toBeTruthy();

    const second = await nextAd(ctx.dad.id, "today");
    expect(second.show).toBe(false);
    expect(second.reason).toBe("DAILY_LIMIT_REACHED");

    const third = await nextAd(ctx.dad.id, "today");
    expect(third.show).toBe(false);
    expect(await prisma.adImpression.count({ where: { userId: ctx.dad.id } })).toBe(1);
  });

  it("결제 전에는 어떤 혜택도 적용되지 않는다", async () => {
    const entitlement = await getEntitlement(ctx.dad.id);
    expect(entitlement.adFree).toBe(false);
    expect(entitlement.explanation).toContain("적용되어 있지 않습니다");
  });

  it("가족 전체 상품을 결제하면 초대된 가족(조부모) 전원에게 적용된다", async () => {
    const { purchase: record, alreadyOwned } = await purchase({
      userId: ctx.dad.id,
      productId: "adfree.family.monthly",
      platform: "WEB_MOCK",
    });
    expect(alreadyOwned).toBe(false);
    expect(record.scope).toBe("FAMILY");
    expect(record.status).toBe("ACTIVE");

    const dadEntitlement = await getEntitlement(ctx.dad.id);
    expect(dadEntitlement.adFree).toBe(true);
    expect(dadEntitlement.coversFamily).toBe(true);
    expect(dadEntitlement.scope).toBe("FAMILY");

    const grandmaEntitlement = await getEntitlement(ctx.grandma.id);
    expect(grandmaEntitlement.adFree).toBe(true);
    expect(grandmaEntitlement.explanation).toContain("가족 전체");

    const ad = await nextAd(ctx.grandma.id, "today");
    expect(ad.show).toBe(false);
    expect(ad.reason).toBe("AD_FREE");
  });

  it("휴대폰 변경·재설치 후 구매 복원으로 다시 적용된다", async () => {
    const restored = await restorePurchases(ctx.dad.id);
    expect(restored.restored).toBeGreaterThanOrEqual(1);
    expect(restored.entitlement.adFree).toBe(true);
    const record = await prisma.purchase.findFirst({ where: { userId: ctx.dad.id } });
    expect(record?.restoreCount).toBeGreaterThanOrEqual(1);

    const recheck = await recheckBilling(ctx.dad.id);
    expect(recheck.entitlement.adFree).toBe(true);
    expect(recheck.verified).toBe(true);
    expect(recheck.adImpressionsToday).toBeGreaterThanOrEqual(1);
  });

  it("개인 상품은 결제자 본인에게만 적용된다", async () => {
    const other = await makeFamily();
    const personal = await purchase({ userId: other.mom.id, productId: "adfree.personal.monthly", platform: "WEB_MOCK" });
    expect(personal.purchase.scope).toBe("PERSONAL");
    expect((await getEntitlement(other.mom.id)).adFree).toBe(true);
    expect((await getEntitlement(other.dad.id)).adFree).toBe(false);
    const ad = await nextAd(other.dad.id, "today");
    expect(ad.show).toBe(true);
  });

  it("스토어 계정이 연결되지 않은 실제 결제는 명확히 거절된다", async () => {
    await expect(
      purchase({ userId: ctx.dad.id, productId: "adfree.family.monthly", platform: "GOOGLE_PLAY" }),
    ).rejects.toBeInstanceOf(BillingError);
  });

  it("결제 후 광고가 보일 때 문의를 DB에 접수할 수 있다", async () => {
    const inquiry = await createInquiry({
      userId: ctx.dad.id,
      message: "결제했는데 업로드 화면에 광고가 계속 표시됩니다.",
      category: "AD_REMOVAL",
    });
    expect(inquiry.id).toBeTruthy();
    const saved = await prisma.inquiry.findUnique({ where: { id: inquiry.id } });
    expect(saved?.status).toBe("OPEN");
    expect(saved?.message).toContain("광고");
  });
});
