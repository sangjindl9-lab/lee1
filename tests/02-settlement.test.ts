import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getProvider } from "@/server/payments/provider";
import { handleWebhook } from "@/server/payments/webhooks";
import { startPayment } from "@/server/services/checkout";
import { deliverOrder } from "@/server/services/delivery";
import { openDispute } from "@/server/services/dispute";
import { requestPayout, resolvePayout } from "@/server/services/payout";
import { requestRefund, processRefund } from "@/server/services/refund";
import { issueDownload } from "@/server/services/downloads";
import { orderLedgerBalance } from "@/server/services/ledger";
import {
  completeOrder,
  expectDomainError,
  makeOrderWithProduct,
  makeUser,
  payOrder,
  resetDb,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});

describe("필수 테스트 8. 분쟁 중 지급 시도", () => {
  it("분쟁이 접수되면 판매자 지급이 차단되고 외부 중지 요청 결과가 따로 기록된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await completeOrder({ buyer, seller, orderId: order.id });

    const dispute = await openDispute(buyer, {
      orderId: order.id,
      category: "FILE_MISMATCH",
      body: "설명서와 실제 기능이 다릅니다.",
    });
    expect(dispute.providerHoldState).toBe("STOP_REQUESTED");

    await expectDomainError(() => requestPayout(seller, { orderId: order.id }), "STATE_NOT_ALLOWED");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.payoutStatus).toBe("ON_HOLD");
    expect(after.escrowStatus).toBe("STOP_REQUESTED");
    const payouts = await prisma.payout.count({ where: { orderId: order.id } });
    expect(payouts).toBe(0);
  });
});

describe("필수 테스트 9. 환불과 정산의 동시 실행", () => {
  it("동시에 실행해도 한쪽만 진행되고 원장 잔액이 음수가 되지 않는다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const settlement = await makeUser({ roles: ["OPERATOR_SETTLEMENT"] });
    const { order } = await makeOrderWithProduct(seller, buyer, { priceKrw: 2_000_000 });
    await completeOrder({ buyer, seller, orderId: order.id });

    const refund = await requestRefund(buyer, { orderId: order.id, reason: "기능 미구현" });

    const results = await Promise.allSettled([
      processRefund(refund.refundId, settlement, { approve: true }),
      requestPayout(seller, { orderId: order.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const balance = await orderLedgerBalance(prisma, order.id);
    expect(balance.available).toBeGreaterThanOrEqual(0);
    const payouts = await prisma.payout.findMany({ where: { orderId: order.id } });
    const refunds = await prisma.refundRecord.findMany({ where: { orderId: order.id } });
    const paidOut = payouts.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0);
    const refunded = refunds
      .filter((r) => r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED")
      .reduce((s, r) => s + r.amount, 0);
    expect(paidOut + refunded).toBeLessThanOrEqual(order.grossAmount);
  });
});

describe("필수 테스트 10. 중복·지연·역순 웹훅", () => {
  it("같은 이벤트는 중복 반영되지 않고, 역순 이벤트는 상태를 되돌리지 않는다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    const started = await startPayment(buyer, {
      orderId: order.id,
      method: "CARD",
      consentToWithdrawalLimit: true,
      ip: "1.1.1.1",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.paymentId } });
    const provider = getProvider();

    const paidRaw = JSON.stringify({
      eventId: "evt-paid-1",
      type: "payment.paid",
      txId: payment.providerTxId,
      orderNo: order.orderNo,
      amount: payment.amount,
      eventTime: new Date().toISOString(),
    });
    const first = await handleWebhook("mockpg", paidRaw, provider.signWebhook(paidRaw));
    expect(first.outcome).toBe("APPLIED");

    // 동일 이벤트 재전송
    const duplicate = await handleWebhook("mockpg", paidRaw, provider.signWebhook(paidRaw));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.outcome).toBe("DUPLICATE");

    // 더 이른 시점의 취소 이벤트(역순 도착)
    const staleRaw = JSON.stringify({
      eventId: "evt-cancel-old",
      type: "payment.cancelled",
      txId: payment.providerTxId,
      orderNo: order.orderNo,
      amount: payment.amount,
      eventTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const stale = await handleWebhook("mockpg", staleRaw, provider.signWebhook(staleRaw));
    expect(stale.outcome).toBe("STALE_IGNORED");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe("PAID");

    // 서명 위조는 거부된다.
    await expectDomainError(
      () => handleWebhook("mockpg", paidRaw, "forged-signature"),
      "FORBIDDEN",
    );
  });
});

describe("필수 테스트 11. 외부 지급 요청 타임아웃", () => {
  it("응답이 불명확하면 재요청하지 않고 조회로 확정하며, 지급은 한 번만 일어난다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer, { priceKrw: 1_500_000 });
    await completeOrder({ buyer, seller, orderId: order.id });

    const first = await requestPayout(seller, { orderId: order.id, simulateTimeout: true });
    expect(first.status).toBe("PROCESSING");

    // 중복 지급 방지: 같은 주문에 다시 요청할 수 없다.
    const conflict = await expectDomainError(
      () => requestPayout(seller, { orderId: order.id }),
      "CONFLICT",
    );
    expect(conflict.message).toContain("이미 지급 요청이 접수된");

    const resolved = await resolvePayout(first.payoutId);
    expect(resolved.status).toBe("PAID");

    const payouts = await prisma.payout.findMany({ where: { orderId: order.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe("PAID");

    const ledger = await prisma.ledgerEntry.findMany({
      where: { orderId: order.id, type: "PAYOUT_OUT" },
    });
    expect(ledger).toHaveLength(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.payoutStatus).toBe("PAID");
    expect(after.settledAt).not.toBeNull();
  });
});

describe("필수 테스트 12. 부분 환불 미지원 결제수단 처리", () => {
  it("부분 환불을 지원하지 않는 수단은 완료로 표시하지 않고 대체 절차를 안내한다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const settlement = await makeUser({ roles: ["OPERATOR_SETTLEMENT"] });
    const { order } = await makeOrderWithProduct(seller, buyer, { priceKrw: 1_000_000, inspectionDays: 2 });
    await payOrder(buyer, order.id, "BANK_TRANSFER");
    await deliverOrder(seller, { orderId: order.id });

    const refund = await requestRefund(buyer, {
      orderId: order.id,
      amount: 400_000,
      reason: "일부 기능 미구현",
    });
    const result = await processRefund(refund.refundId, settlement, { approve: true });

    expect(result.status).toBe("UNSUPPORTED");
    if (result.status === "UNSUPPORTED") {
      expect(result.message).toContain("부분 환불을 지원하지 않습니다");
    }

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.refundStatus).toBe("UNSUPPORTED");
    expect(fresh.paymentStatus).toBe("PAID");
    const ledger = await prisma.ledgerEntry.count({
      where: { orderId: order.id, type: "REFUND_OUT" },
    });
    expect(ledger).toBe(0);
  });
});

describe("필수 테스트 14. 환불 뒤 이미 다운로드한 파일의 처리 한계 표시", () => {
  it("환불 후에는 추가 다운로드가 차단되고, 회수 불가 안내가 함께 제공된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const settlement = await makeUser({ roles: ["OPERATOR_SETTLEMENT"] });
    const { order } = await makeOrderWithProduct(seller, buyer, { priceKrw: 800_000 });
    await completeOrder({ buyer, seller, orderId: order.id });

    const orderFile = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    const ticket = await issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id });

    const refund = await requestRefund(buyer, { orderId: order.id, reason: "단순 변심" });
    const result = await processRefund(refund.refundId, settlement, { approve: true });
    expect(result.status).toBe("COMPLETED");
    expect(result.limitationNote).toContain("회수");

    const blocked = await expectDomainError(
      () => issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id }),
      "STATE_NOT_ALLOWED",
    );
    expect(blocked.message).toContain("이미 내려받은 파일은 회수되지 않습니다");

    const grant = await prisma.downloadGrant.findFirstOrThrow({
      where: { orderId: order.id, tokenHash: { not: "" } },
    });
    expect(grant.revokedAt).not.toBeNull();

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.refundStatus).toBe("COMPLETED");
    expect(after.paymentStatus).toBe("REFUNDED");
    expect(ticket.fileName).toBe(orderFile.fileName);
  });
});
