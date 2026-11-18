import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { sha256Hex } from "@/lib/crypto";
import { assertInspectionWindow } from "@/lib/money";
import { POLICY_VERSIONS, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";
import { getProvider } from "../payments/provider";
import { audit } from "./audit";
import { loadOrderForActor } from "./access";
import type { Actor } from "./rbac";

/** 결제수단별 자동확정 예정일(일). 실제 PG 정책을 연동하면 해당 값을 사용한다. */
export const METHOD_AUTO_CONFIRM_DAYS: Record<string, number | null> = {
  CARD: 14,
  EASY_PAY: 14,
  VBANK: 10,
  BANK_TRANSFER: 3,
};

/**
 * 결제 시작 — 청약철회 제한 사전 동의를 필수로 받고, 동의 시각·IP·문구 버전을 기록한다.
 * 브라우저의 "결제 성공" 화면만으로 결제 완료 처리하지 않는다. (웹훅에서만 상태를 바꾼다)
 */
export async function startPayment(
  actor: Actor,
  input: {
    orderId: string;
    method: string;
    consentToWithdrawalLimit: boolean;
    ip?: string;
    userAgent?: string;
  },
) {
  const order = await loadOrderForActor(actor, input.orderId, "VIEW");
  const isBuyerSide =
    order.buyerId === actor.id ||
    (!!order.buyerCompanyId && actor.companyId === order.buyerCompanyId);
  if (!isBuyerSide) {
    throw new DomainError("FORBIDDEN", "구매자만 결제를 진행할 수 있습니다.", 403);
  }
  if (order.paymentStatus === "PAID") {
    throw new DomainError("CONFLICT", "이미 결제가 완료된 주문입니다.", 409);
  }
  if (order.paymentStatus === "CANCELLED" || order.paymentStatus === "REFUNDED") {
    throw new DomainError("STATE_NOT_ALLOWED", "결제가 종료된 주문입니다.", 409);
  }

  if (!input.consentToWithdrawalLimit) {
    throw new DomainError(
      "CONSENT_REQUIRED",
      "디지털 콘텐츠 청약철회 제한에 대한 사전 동의가 필요합니다. 동의 후 결제를 진행해 주세요.",
      400,
    );
  }

  const provider = getProvider();
  const method = provider.paymentMethods().find((m) => m.id === input.method);
  if (!method) throw new DomainError("VALIDATION", "지원하지 않는 결제수단입니다.");

  const autoConfirmDays = METHOD_AUTO_CONFIRM_DAYS[method.id] ?? null;
  const windowCheck = assertInspectionWindow({
    inspectionDays: order.inspectionDays,
    autoConfirmAfterDays: autoConfirmDays,
  });
  if (!windowCheck.ok) {
    throw new DomainError("STATE_NOT_ALLOWED", windowCheck.reason ?? "검수 기간을 확보할 수 없습니다.", 409);
  }

  const idempotencyKey = `pay:${order.id}:${method.id}`;
  const payment = await prisma.payment.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      orderId: order.id,
      provider: provider.name,
      providerTxId: `tmp_${order.id}`,
      method: method.id,
      amount: order.grossAmount,
      status: "PENDING",
      idempotencyKey,
    },
  });

  const created = await provider.createPayment({
    orderNo: order.orderNo,
    amount: order.grossAmount,
    method: method.id,
    idempotencyKey,
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerTxId: created.txId,
      status: "AUTHORIZED",
      raw: {
        sandbox: created.sandbox,
        autoConfirmDays,
        lastEventTime: null,
      } as never,
    },
  });

  const agreedAt = new Date();
  await prisma.$transaction([
    prisma.consentLog.create({
      data: {
        userId: actor.id,
        orderId: order.id,
        kind: "WITHDRAWAL_LIMIT",
        version: POLICY_VERSIONS.withdrawalConsent,
        ip: input.ip ?? actor.ip ?? null,
        userAgent: input.userAgent ?? null,
        textHash: sha256Hex(WITHDRAWAL_CONSENT_TEXT),
        agreedAt,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: {
        consentVersion: POLICY_VERSIONS.withdrawalConsent,
        consentWithdrawalAt: agreedAt,
        consentIp: input.ip ?? actor.ip ?? null,
        consentTextHash: sha256Hex(WITHDRAWAL_CONSENT_TEXT),
        rowVersion: { increment: 1 },
      },
    }),
  ]);

  await audit({
    actor,
    action: "PAYMENT_STARTED",
    targetType: "Order",
    targetId: order.id,
    after: { method: method.id, amount: order.grossAmount, sandbox: created.sandbox },
  });

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    paymentId: payment.id,
    txId: created.txId,
    amount: order.grossAmount,
    method: method.id,
    sandbox: created.sandbox,
  };
}

/** 테스트 PG 결제창 페이지에서 "승인"을 눌렀을 때 PG가 보내는 웹훅을 생성한다. */
export async function buildSandboxWebhook(paymentTxId: string, outcome: "paid" | "failed" = "paid") {
  const provider = getProvider();
  const payment = await prisma.payment.findFirst({
    where: { providerTxId: paymentTxId },
    include: { order: true },
  });
  if (!payment) throw new DomainError("NOT_FOUND", "결제 정보를 찾을 수 없습니다.", 404);

  const raw = JSON.stringify({
    eventId: `evt_${payment.providerTxId}_${outcome}_${Date.now()}`,
    type: outcome === "paid" ? "payment.paid" : "payment.failed",
    txId: payment.providerTxId,
    orderNo: payment.order.orderNo,
    amount: payment.amount,
    eventTime: new Date().toISOString(),
  });
  return { raw, signature: provider.signWebhook(raw) };
}
