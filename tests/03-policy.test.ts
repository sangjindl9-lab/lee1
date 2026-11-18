import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getProvider } from "@/server/payments/provider";
import { startPayment } from "@/server/services/checkout";
import { completeOrder, expectDomainError, makeOrderWithProduct, makeUser, payOrder, resetDb } from "./helpers";
import { requestPayout } from "@/server/services/payout";
import { requestRefund, processRefund } from "@/server/services/refund";
import { decideDispute, openDispute, suggestDisputeDecision } from "@/server/services/dispute";
import { runReconciliation } from "@/server/services/reconciliation";

beforeEach(async () => {
  await resetDb();
});

describe("필수 테스트 13. 검수 기한과 외부 자동확정 일정 충돌", () => {
  it("자동확정이 검수 기간보다 짧으면 결제를 막고, 충분하면 진행한다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer, { inspectionDays: 7 });

    const blocked = await expectDomainError(
      () =>
        startPayment(buyer, {
          orderId: order.id,
          method: "BANK_TRANSFER", // 자동확정 3일
          consentToWithdrawalLimit: true,
          ip: "1.2.3.4",
        }),
      "STATE_NOT_ALLOWED",
    );
    expect(blocked.message).toContain("자동확정");

    const ok = await startPayment(buyer, {
      orderId: order.id,
      method: "CARD", // 자동확정 14일
      consentToWithdrawalLimit: true,
      ip: "1.2.3.4",
    });
    expect(ok.paymentId).toBeTruthy();

    const conflictOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(conflictOrder.paymentStatus).not.toBe("PAID");
  });
});

describe("필수 테스트 15. 디지털 콘텐츠 청약철회 제한 사전 동의", () => {
  it("동의 없이는 결제가 시작되지 않고, 동의 시각·IP·버전이 기록된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);

    await expectDomainError(
      () =>
        startPayment(buyer, {
          orderId: order.id,
          method: "CARD",
          consentToWithdrawalLimit: false,
          ip: "5.5.5.5",
        }),
      "CONSENT_REQUIRED",
    );
    expect(await prisma.consentLog.count({ where: { orderId: order.id } })).toBe(0);

    await startPayment(buyer, {
      orderId: order.id,
      method: "CARD",
      consentToWithdrawalLimit: true,
      ip: "5.5.5.5",
      userAgent: "vitest-agent",
    });

    const log = await prisma.consentLog.findFirstOrThrow({ where: { orderId: order.id } });
    expect(log.kind).toBe("WITHDRAWAL_LIMIT");
    expect(log.version).toBe("2026-11-01");
    expect(log.ip).toBe("5.5.5.5");
    expect(log.textHash).toHaveLength(64);
    expect(log.agreedAt).toBeInstanceOf(Date);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.consentVersion).toBe("2026-11-01");
    expect(fresh.consentIp).toBe("5.5.5.5");
    expect(fresh.consentWithdrawalAt).not.toBeNull();
  });
});

describe("추가: 기정산 거래의 사후 환수 분리", () => {
  it("이미 지급 완료된 거래의 환불은 일반 절차가 아닌 사후 환수로 접수된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const settlement = await makeUser({ roles: ["OPERATOR_SETTLEMENT"] });
    const { order } = await makeOrderWithProduct(seller, buyer, { priceKrw: 500_000 });
    await completeOrder({ buyer, seller, orderId: order.id });
    await requestPayout(seller, { orderId: order.id });

    const refund = await requestRefund(buyer, { orderId: order.id, reason: "뒤늦은 환불 요구" });
    const result = await processRefund(refund.refundId, settlement, { approve: true });
    expect(result.status).toBe("RECOVERY_REQUIRED");

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.refundStatus).toBe("RECOVERY_REQUIRED");
    expect(fresh.payoutStatus).toBe("PAID");
  });
});

describe("추가: 분쟁 판단은 AI 단독으로 불가", () => {
  it("AI가 판단을 시도하면 거부되고, 담당자 판단에는 근거·처리자·일시가 기록된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const reviewer = await makeUser({ roles: ["OPERATOR_REVIEW"] });
    const ai = await makeUser({ roles: ["SUPER_ADMIN"] });
    ai.isAi = true;

    const { order } = await makeOrderWithProduct(seller, buyer);
    await completeOrder({ buyer, seller, orderId: order.id });
    const dispute = await openDispute(buyer, {
      orderId: order.id,
      category: "FEATURE_MISSING",
      body: "약속한 기능이 없습니다.",
    });

    await expectDomainError(
      () => decideDispute(dispute.id, ai, { resolution: "REFUND", reason: "AI 판단으로 환불 처리합니다." }),
      "FORBIDDEN",
    );
    await expectDomainError(
      () => decideDispute(dispute.id, reviewer, { resolution: "REFUND", reason: "짧음" }),
      "VALIDATION",
    );

    await decideDispute(dispute.id, reviewer, {
      resolution: "RESUME",
      reason: "양측 자료 확인 결과 납품물에 약속 기능이 포함되어 있어 거래를 재개합니다.",
    });

    const decided = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(decided.status).toBe("DECIDED");
    expect(decided.decidedById).toBe(reviewer.id);
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.decisionReason).toContain("재개");

    const suggestion = suggestDisputeDecision({
      category: "FILE",
      buyerStatement: "파일이 다릅니다.",
      sellerStatement: "같은 파일입니다.",
      deliveredFileCount: 2,
      inspectionApproved: true,
    });
    expect(suggestion.isFinal).toBe(false);
  });
});

describe("추가: 대사(Reconciliation)", () => {
  it("내부 상태와 결제사업자 상태가 어긋난 건을 찾아낸다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);

    const clean = await runReconciliation("정상 대사");
    expect(clean.mismatchCount).toBe(0);

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.mockPgTx.update({
      where: { txId: payment.providerTxId },
      data: { status: "AUTHORIZED" },
    });

    const mismatch = await runReconciliation("불일치 대사");
    expect(mismatch.mismatchCount).toBeGreaterThan(0);
    const issue = mismatch.issues.find((i) => i.field === "payment.status");
    expect(issue?.internal).toBe("PAID");
    expect(issue?.external).toBe("AUTHORIZED");
  });
});
