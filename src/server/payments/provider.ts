/**
 * 결제 사업자(PG) 연동 경계.
 * 실제 운영에서는 이 인터페이스의 구현체만 교체한다.
 * 현재 구현(mockpg)은 테스트 환경이며, 실제 대금 보호·송금이 일어난 것처럼 표시하지 않는다.
 */

export type PgPaymentStatus = "AUTHORIZED" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";

export interface PgMethod {
  id: string;
  label: string;
  /** 부분 환불 지원 수준 */
  refundSupport: "PARTIAL" | "FULL_ONLY" | "NONE";
  note?: string;
}

export interface CreatePaymentInput {
  orderNo: string;
  amount: number;
  method: string;
  idempotencyKey: string;
}

export interface CreatePaymentResult {
  txId: string;
  status: PgPaymentStatus;
  /** 테스트 환경 여부 */
  sandbox: boolean;
}

export interface RefundInput {
  txId: string;
  orderNo: string;
  amount: number;
  fullAmount: number;
  method: string;
  idempotencyKey: string;
}

export interface RefundResult {
  refundId: string | null;
  status: "COMPLETED" | "PROCESSING" | "FAILED" | "UNSUPPORTED";
  partialSupported: boolean;
  message: string;
}

export interface HoldResult {
  ref: string | null;
  status: "HELD" | "REQUESTED" | "NOT_SUPPORTED" | "FAILED";
  simulated: boolean;
  message: string;
}

export interface PayoutInput {
  sellerId: string;
  orderNo: string;
  amount: number;
  idempotencyKey: string;
  /** 응답이 유실되는 상황을 재현할 때 사용한다. */
  simulateTimeout?: boolean;
  simulateFailure?: boolean;
}

export interface PayoutResult {
  ref: string | null;
  status: "PAID" | "PROCESSING" | "FAILED" | "UNKNOWN";
  message: string;
}

export interface PgProvider {
  readonly name: string;
  readonly sandbox: boolean;
  readonly supportsEscrow: boolean;
  paymentMethods(): PgMethod[];
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(txId: string): Promise<{ status: PgPaymentStatus; amount: number } | null>;
  refundPayment(input: RefundInput): Promise<RefundResult>;
  createHold(input: { orderNo: string; amount: number; idempotencyKey: string }): Promise<HoldResult>;
  releaseHold(ref: string): Promise<{ ok: boolean; message: string }>;
  /** 분쟁 발생 시 지급 중지 요청. 지원하지 않는 사업자는 ok:false 로 응답한다. */
  stopHold(ref: string): Promise<{ ok: boolean; state: "STOPPED" | "FAILED"; message: string }>;
  requestPayout(input: PayoutInput): Promise<PayoutResult>;
  getPayout(ref: string): Promise<PayoutResult>;
  signWebhook(rawBody: string): string;
  verifyWebhook(rawBody: string, signature: string | null): boolean;
}

import { MockPgProvider } from "./mockpg";

export function getProvider(): PgProvider {
  // 실제 연동 시: 아래 한 줄만 교체한다. (예: new TossProvider(process.env.TOSS_SECRET_KEY))
  return new MockPgProvider();
}
