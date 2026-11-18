import { z } from "zod";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { getProvider } from "./provider";
import { notify } from "@/server/services/audit";

const PayloadSchema = z.object({
  eventId: z.string().min(3),
  type: z.string(),
  txId: z.string().optional(),
  orderNo: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
  eventTime: z.string(),
});

export interface WebhookResult {
  accepted: boolean;
  duplicate: boolean;
  outcome:
    | "APPLIED"
    | "DUPLICATE"
    | "STALE_IGNORED"
    | "ALREADY_APPLIED"
    | "UNKNOWN_EVENT"
    | "INVALID_SIGNATURE"
    | "NOT_FOUND";
  message: string;
}

/** 웹훅 수신 — 서명 검증 → 중복 → 역순(지연) 판정 → 상태 반영 순서로 처리한다. */
export async function handleWebhook(
  providerName: string,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const provider = getProvider();
  const signatureValid = provider.verifyWebhook(rawBody, signature);

  let payload: z.infer<typeof PayloadSchema>;
  try {
    payload = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new DomainError("VALIDATION", "웹훅 본문 형식이 올바르지 않습니다.", 400);
  }

  const eventTime = new Date(payload.eventTime);

  if (!signatureValid) {
    await prisma.webhookEvent
      .create({
        data: {
          provider: providerName,
          eventId: `${payload.eventId}:invalid:${Date.now()}`,
          type: payload.type,
          signatureValid: false,
          eventTime,
          payload: payload as never,
          result: { outcome: "INVALID_SIGNATURE" } as never,
        },
      })
      .catch(() => undefined);
    throw new DomainError("FORBIDDEN", "웹훅 서명 검증에 실패했습니다.", 401);
  }

  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: providerName, eventId: payload.eventId } },
  });
  if (existing) {
    await prisma.webhookEvent.update({
      where: { id: existing.id },
      data: { duplicate: true, result: { outcome: "DUPLICATE" } as never },
    });
    return {
      accepted: true,
      duplicate: true,
      outcome: "DUPLICATE",
      message: "이미 처리된 이벤트입니다. 중복 반영하지 않았습니다.",
    };
  }

  const event = await prisma.webhookEvent.create({
    data: {
      provider: providerName,
      eventId: payload.eventId,
      type: payload.type,
      signatureValid,
      eventTime,
      payload: payload as never,
    },
  });

  const finish = async (outcome: WebhookResult["outcome"], message: string): Promise<WebhookResult> => {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), result: { outcome, message } as never },
    });
    return { accepted: true, duplicate: false, outcome, message };
  };

  if (payload.type.startsWith("payment.")) {
    const payment = payload.txId
      ? await prisma.payment.findFirst({
          where: { providerTxId: payload.txId },
          include: { order: true },
        })
      : payload.orderNo
        ? await prisma.payment.findFirst({
            where: { order: { orderNo: payload.orderNo } },
            include: { order: true },
          })
        : null;

    if (!payment) return finish("NOT_FOUND", "해당 결제 건을 찾을 수 없습니다.");

    const raw = (payment.raw ?? {}) as { lastEventTime?: string | null };
    const lastEventTime = raw.lastEventTime ? new Date(raw.lastEventTime) : null;

    if (lastEventTime && eventTime.getTime() < lastEventTime.getTime()) {
      return finish(
        "STALE_IGNORED",
        "이미 처리된 이후 시점의 상태를 되돌리는 지연·역순 이벤트여서 반영하지 않았습니다.",
      );
    }

    if (payload.type === "payment.failed") {
      if (payment.status === "PAID") {
        return finish("ALREADY_APPLIED", "이미 결제가 완료된 건입니다. 실패 이벤트를 반영하지 않았습니다.");
      }
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "FAILED",
            raw: { ...raw, lastEventTime: eventTime.toISOString(), lastEvent: payload.type } as never,
          },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "FAILED", rowVersion: { increment: 1 } },
        }),
      ]);
      return finish("APPLIED", "결제 실패 상태를 반영했습니다.");
    }

    if (payload.type === "payment.cancelled") {
      if (payment.status === "PAID") {
        return finish("ALREADY_APPLIED", "이미 결제가 완료된 건입니다. 취소 이벤트를 반영하지 않았습니다.");
      }
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "CANCELLED",
            raw: { ...raw, lastEventTime: eventTime.toISOString(), lastEvent: payload.type } as never,
          },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "CANCELLED", rowVersion: { increment: 1 } },
        }),
      ]);
      return finish("APPLIED", "결제 취소 상태를 반영했습니다.");
    }

    if (payload.type === "payment.paid") {
      if (payment.status === "PAID") {
        return finish("ALREADY_APPLIED", "이미 결제 완료로 반영된 건입니다.");
      }
      if (payment.status === "CANCELLED" || payment.status === "REFUNDED") {
        return finish("STALE_IGNORED", "취소·환불된 결제 건에는 승인 이벤트를 반영하지 않습니다.");
      }

      await prisma.mockPgTx.updateMany({
        where: { txId: payment.providerTxId },
        data: { status: "PAID" },
      });

      const paidAt = new Date();
      const order = payment.order;
      const deliveryDueAt = new Date(paidAt.getTime() + 7 * 24 * 60 * 60 * 1000);

      const hold = await provider.createHold({
        orderNo: order.orderNo,
        amount: order.grossAmount,
        idempotencyKey: `hold:${order.id}`,
      });

      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            approvedAt: paidAt,
            raw: { ...raw, lastEventTime: eventTime.toISOString(), lastEvent: payload.type } as never,
          },
        }),
        prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: "PAID",
            paidAt,
            deliveryDueAt,
            escrowStatus: hold.status === "HELD" ? "HELD" : hold.status === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "REQUESTED",
            rowVersion: { increment: 1 },
          },
        }),
        prisma.escrowRecord.upsert({
          where: { orderId: order.id },
          update: {
            holdState: hold.status === "HELD" ? "HELD" : "REQUESTED",
            providerRef: hold.ref,
            note: hold.message,
            requestedAt: paidAt,
          },
          create: {
            orderId: order.id,
            provider: provider.name,
            providerRef: hold.ref,
            holdState: hold.status === "HELD" ? "HELD" : "REQUESTED",
            note: hold.message,
            requestedAt: paidAt,
          },
        }),
      ]);

      await notify({
        userId: order.buyerId,
        kind: "PAYMENT_PAID",
        title: "결제가 확인되었습니다",
        body: `${order.orderNo} 주문의 납품물을 내려받고 검수를 시작할 수 있습니다.`,
        link: `/orders/${order.id}`,
      });

      // 거래 원장 기록(중복 실행 안전)
      const { recordPaymentLedger } = await import("@/server/services/ledger");
      await recordPaymentLedger({
        id: order.id,
        sellerId: order.sellerId,
        grossAmount: payment.amount,
        commissionAmount: order.commissionAmount,
        paymentFeeAmount: order.paymentFeeAmount,
        withholdingTax: order.withholdingTax,
      });

      return finish("APPLIED", "결제 완료를 반영하고 대금 보호 상태를 확인했습니다.");
    }

    return finish("UNKNOWN_EVENT", "처리 규칙이 없는 결제 이벤트입니다.");
  }

  if (payload.type === "escrow.stopped" && payload.orderNo) {
    const order = await prisma.order.findFirst({ where: { orderNo: payload.orderNo } });
    if (!order) return finish("NOT_FOUND", "주문을 찾을 수 없습니다.");
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { escrowStatus: "STOPPED" } }),
      prisma.escrowRecord.upsert({
        where: { orderId: order.id },
        update: { holdState: "STOPPED" },
        create: { orderId: order.id, holdState: "STOPPED", provider: provider.name },
      }),
    ]);
    return finish("APPLIED", "대금 지급 중지 상태를 반영했습니다.");
  }

  return finish("UNKNOWN_EVENT", "처리 규칙이 없는 이벤트입니다.");
}

/** 테스트 PG에서 결제를 승인했을 때 서버가 자기 웹훅을 수신하는 경로(샌드박스 전용). */
export async function approveSandboxPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new DomainError("NOT_FOUND", "결제 정보를 찾을 수 없습니다.", 404);
  const provider = getProvider();
  const { raw, signature } = await (await import("@/server/services/checkout")).buildSandboxWebhook(
    payment.providerTxId,
    "paid",
  );
  return handleWebhook(provider.name, raw, signature);
}
