import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "@/lib/crypto";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  HoldResult,
  PayoutInput,
  PayoutResult,
  PgMethod,
  PgPaymentStatus,
  PgProvider,
  RefundInput,
  RefundResult,
} from "./provider";

const SECRET = process.env.MOCKPG_WEBHOOK_SECRET || "mockpg-dev-webhook-secret";

const METHODS: PgMethod[] = [
  { id: "CARD", label: "신용·체크카드(테스트)", refundSupport: "PARTIAL", note: "테스트 환경에서는 전액·부분 취소 모두 모의 처리됩니다." },
  { id: "VBANK", label: "가상계좌(테스트)", refundSupport: "FULL_ONLY", note: "가상계좌는 전액 환불만 지원하는 것으로 가정합니다." },
  { id: "BANK_TRANSFER", label: "계좌이체(테스트)", refundSupport: "FULL_ONLY", note: "계좌이체는 부분 환불 미지원으로 가정합니다." },
  { id: "EASY_PAY", label: "간편결제(테스트)", refundSupport: "PARTIAL" },
];

/**
 * 테스트 PG — 실제 결제·송금이 발생하지 않는 샌드박스.
 * 외부 원장(MockPgTx)을 플랫폼 DB와 분리해 두어, 대사(Reconciliation) 테스트가 가능하다.
 */
export class MockPgProvider implements PgProvider {
  readonly name = "mockpg";
  readonly sandbox = true;
  readonly supportsEscrow = true;

  paymentMethods(): PgMethod[] {
    return METHODS;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const txId = `mock_${crypto.randomBytes(8).toString("hex")}`;
    await prisma.mockPgTx.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        txId,
        kind: "PAYMENT",
        orderNo: input.orderNo,
        amount: input.amount,
        method: input.method,
        status: "AUTHORIZED",
        idempotencyKey: input.idempotencyKey,
        note: "테스트 PG 결제 승인 대기",
      },
    });
    const row = await prisma.mockPgTx.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return {
      txId: row?.txId ?? txId,
      status: (row?.status as PgPaymentStatus) ?? "AUTHORIZED",
      sandbox: true,
    };
  }

  async getPayment(txId: string) {
    const row = await prisma.mockPgTx.findUnique({ where: { txId } });
    if (!row) return null;
    return { status: row.status as PgPaymentStatus, amount: row.amount };
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    const method = METHODS.find((m) => m.id === input.method);
    const isPartial = input.amount < input.fullAmount;
    if (!method || method.refundSupport === "NONE") {
      return {
        refundId: null,
        status: "UNSUPPORTED",
        partialSupported: false,
        message: "해당 결제수단은 환불을 지원하지 않습니다. 고객센터를 통한 별도 절차가 필요합니다.",
      };
    }
    if (isPartial && method.refundSupport === "FULL_ONLY") {
      return {
        refundId: null,
        status: "UNSUPPORTED",
        partialSupported: false,
        message: `${method.label} 결제수단은 부분 환불을 지원하지 않습니다. 전액 환불 후 재결제 또는 계좌 송금으로 처리해야 합니다.`,
      };
    }

    const refundId = `mockr_${crypto.randomBytes(8).toString("hex")}`;
    await prisma.mockPgTx.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        txId: refundId,
        kind: "REFUND",
        orderNo: input.orderNo,
        amount: input.amount,
        method: input.method,
        status: "REFUNDED",
        idempotencyKey: input.idempotencyKey,
        note: isPartial ? "부분 환불(테스트)" : "전액 환불(테스트)",
      },
    });
    return {
      refundId,
      status: "COMPLETED",
      partialSupported: true,
      message: "테스트 PG에서 환불이 완료 처리되었습니다. 실제 카드사·은행 반영은 발생하지 않습니다.",
    };
  }

  async createHold(input: { orderNo: string; amount: number; idempotencyKey: string }): Promise<HoldResult> {
    const ref = `mockh_${crypto.randomBytes(8).toString("hex")}`;
    await prisma.mockPgTx.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        txId: ref,
        kind: "HOLD",
        orderNo: input.orderNo,
        amount: input.amount,
        status: "HELD",
        idempotencyKey: input.idempotencyKey,
        note: "테스트 PG 모의 대금 보류",
      },
    });
    return {
      ref,
      status: "HELD",
      simulated: true,
      message: "테스트 PG의 모의 대금 보류입니다. 실제 대금 보호 서비스가 아닙니다.",
    };
  }

  async releaseHold(ref: string) {
    await prisma.mockPgTx.updateMany({ where: { txId: ref }, data: { status: "RELEASED" } });
    return { ok: true, message: "테스트 PG 모의 보류를 해제했습니다." };
  }

  async stopHold(ref: string) {
    const row = await prisma.mockPgTx.findUnique({ where: { txId: ref } });
    if (!row) return { ok: false, state: "FAILED" as const, message: "보류 건을 찾을 수 없습니다." };
    await prisma.mockPgTx.update({ where: { txId: ref }, data: { status: "STOPPED" } });
    return { ok: true, state: "STOPPED" as const, message: "테스트 PG 모의 지급 중지를 요청했습니다." };
  }

  async requestPayout(input: PayoutInput): Promise<PayoutResult> {
    if (input.simulateFailure) {
      await prisma.mockPgTx.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: { status: "FAILED" },
        create: {
          txId: `mockp_${crypto.randomBytes(8).toString("hex")}`,
          kind: "PAYOUT",
          orderNo: input.orderNo,
          amount: input.amount,
          status: "FAILED",
          idempotencyKey: input.idempotencyKey,
          note: "테스트 PG 지급 실패",
        },
      });
      return { ref: null, status: "FAILED", message: "테스트 PG가 지급을 거절했습니다." };
    }

    const ref = `mockp_${crypto.randomBytes(8).toString("hex")}`;
    const status = input.simulateTimeout ? "UNKNOWN" : "PAID";

    await prisma.mockPgTx.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        txId: ref,
        kind: "PAYOUT",
        orderNo: input.orderNo,
        amount: input.amount,
        status: input.simulateTimeout ? "PAID" : "PAID",
        idempotencyKey: input.idempotencyKey,
        note: input.simulateTimeout
          ? "테스트 PG 지급은 완료되었으나 응답이 유실된 상황"
          : "테스트 PG 지급 완료",
      },
    });

    if (input.simulateTimeout) {
      return { ref, status: "UNKNOWN", message: "지급 요청 응답이 확인되지 않았습니다. 조회 후 재시도해야 합니다." };
    }
    return { ref, status, message: "테스트 PG에서 지급이 완료 처리되었습니다." };
  }

  async getPayout(ref: string): Promise<PayoutResult> {
    const row = await prisma.mockPgTx.findUnique({ where: { txId: ref } });
    if (!row) return { ref, status: "UNKNOWN", message: "지급 내역을 찾을 수 없습니다." };
    if (row.status === "PAID") return { ref, status: "PAID", message: "지급 완료(테스트 PG 조회)" };
    if (row.status === "FAILED") return { ref, status: "FAILED", message: "지급 실패(테스트 PG 조회)" };
    return { ref, status: "PROCESSING", message: "지급 처리 중(테스트 PG 조회)" };
  }

  signWebhook(rawBody: string): string {
    return crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  }

  verifyWebhook(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    return timingSafeEqual(this.signWebhook(rawBody), signature);
  }
}
