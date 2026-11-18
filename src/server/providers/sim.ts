// 테스트 결제 시뮬레이터. 외부 결제 사업자의 동작(결제·취소·지급 보류·지급·웹훅)을 흉내 낸다.
// 실제 돈이 움직이지 않으며 실제 결제대금 보호 서비스가 아니다. 화면에도 그렇게 표시한다.
import { db, one } from '../db.ts';
import { config } from '../config.ts';
import { randomId, hmac, safeEqual } from '../util.ts';

export class ProviderError extends Error {
  code: string;
  constructor(code: string, message?: string) { super(message || code); this.code = code; }
}
export const faults = { payoutTimeoutBeforeAccept: 0, payoutTimeoutAfterAccept: 0, cancelTimeoutAfterDone: 0 };

export const simCaps = {
  id: 'simpg', mode: 'test' as 'test' | 'live', label: '테스트 결제 시뮬레이터',
  maxHoldDays: 30 as number | null, autoConfirmDays: null as number | null, disputeHold: true, stagedPayments: true, feeBps: 330,
  partialRefund: { card: true, vbank: false } as Record<string, boolean>,
  methodLabels: { card: '카드(테스트)', vbank: '가상계좌(테스트)' } as Record<string, string>,
};

async function emit(type: string, data: any) {
  const id = 'evt_' + randomId(10);
  const r = await one(db, 'INSERT INTO simpg_events(id,type,payload) VALUES ($1,$2,$3::jsonb) RETURNING seq', [id, type, JSON.stringify(data)]);
  return { id, type, seq: r.seq, data };
}
const sign = (raw: string, ts = Date.now()) => `t=${ts},v1=${hmac(`${ts}.${raw}`, config.webhookSecret)}`;

export const simProvider = {
  capabilities: () => simCaps,
  async createPayment({ orderNo, amount, method }: { orderNo: string; amount: number; method: string }) {
    const id = 'sp_' + randomId(10);
    await db.query('INSERT INTO simpg_payments(id,order_no,amount,method) VALUES ($1,$2,$3,$4)', [id, orderNo, amount, method]);
    return { providerPaymentId: id };
  },
  async getPayment(id: string) {
    const r = await one(db, 'SELECT * FROM simpg_payments WHERE id=$1', [id]);
    return r && { id: r.id, status: r.status as string, amount: r.amount as number, refunded: r.refunded as number, method: r.method as string, hold: r.hold as boolean, orderNo: r.order_no as string };
  },
  async cancelPayment({ providerPaymentId, amount, idempotencyKey }: { providerPaymentId: string; amount: number; idempotencyKey: string }) {
    const res: any = await db.tx(async (t) => {
      const ex = await one(t, 'SELECT * FROM simpg_refunds WHERE idem_key=$1', [idempotencyKey]);
      if (ex) return ex;
      const p = await one(t, 'SELECT * FROM simpg_payments WHERE id=$1 FOR UPDATE', [providerPaymentId]);
      if (!p || !['paid', 'partial_cancelled'].includes(p.status)) throw new ProviderError('NOT_CANCELLABLE', '취소할 수 없는 결제 상태');
      if (await one(t, "SELECT 1 FROM simpg_payouts WHERE payment_id=$1 AND status<>'failed'", [providerPaymentId])) throw new ProviderError('ALREADY_PAID_OUT', '이미 판매자 지급이 진행된 결제');
      const remain = p.amount - p.refunded;
      if (amount > remain) throw new ProviderError('AMOUNT_EXCEEDED', '취소 가능 금액 초과');
      if (amount < remain && !simCaps.partialRefund[p.method]) throw new ProviderError('PARTIAL_REFUND_UNSUPPORTED', '이 결제수단은 부분 취소를 지원하지 않음');
      const refunded = p.refunded + amount;
      await t.query('UPDATE simpg_payments SET refunded=$2, status=$3 WHERE id=$1', [p.id, refunded, refunded === p.amount ? 'cancelled' : 'partial_cancelled']);
      await t.query("INSERT INTO simpg_refunds(idem_key,payment_id,amount,status) VALUES ($1,$2,$3,'completed')", [idempotencyKey, p.id, amount]);
      return { status: 'completed', fresh: true };
    });
    if (res.fresh) await emit('payment.refunded', { paymentId: providerPaymentId, refundKey: idempotencyKey });
    if (faults.cancelTimeoutAfterDone > 0) { faults.cancelTimeoutAfterDone--; throw new ProviderError('TIMEOUT', '응답 시간 초과'); }
    return { status: res.status as string };
  },
  async getRefundByKey(key: string) {
    const r = await one(db, 'SELECT * FROM simpg_refunds WHERE idem_key=$1', [key]);
    return r && { status: r.status as string, amount: r.amount as number };
  },
  async holdPayout(id: string): Promise<'confirmed' | 'unsupported' | 'failed'> {
    if (!simCaps.disputeHold) return 'unsupported';
    if (await one(db, "SELECT 1 FROM simpg_payouts WHERE payment_id=$1 AND status<>'failed'", [id])) return 'failed';
    await db.query('UPDATE simpg_payments SET hold=true WHERE id=$1', [id]);
    return 'confirmed';
  },
  async releaseHold(id: string) { await db.query('UPDATE simpg_payments SET hold=false WHERE id=$1', [id]); },
  async createPayout({ idempotencyKey, providerPaymentId, amount }: { idempotencyKey: string; providerPaymentId: string; amount: number }) {
    if (faults.payoutTimeoutBeforeAccept > 0) { faults.payoutTimeoutBeforeAccept--; throw new ProviderError('TIMEOUT', '응답 시간 초과'); }
    const res: any = await db.tx(async (t) => {
      const ex = await one(t, 'SELECT * FROM simpg_payouts WHERE idem_key=$1', [idempotencyKey]);
      if (ex) return ex;
      const p = await one(t, 'SELECT * FROM simpg_payments WHERE id=$1 FOR UPDATE', [providerPaymentId]);
      if (!p || !['paid', 'partial_cancelled'].includes(p.status)) throw new ProviderError('NOT_PAYABLE', '지급할 수 없는 결제 상태');
      if (p.hold) throw new ProviderError('HELD', '지급 보류 중인 결제');
      if (await one(t, "SELECT 1 FROM simpg_payouts WHERE payment_id=$1 AND status<>'failed'", [providerPaymentId])) throw new ProviderError('DUPLICATE_PAYOUT', '이미 지급 요청된 결제');
      if (amount > p.amount - p.refunded) throw new ProviderError('INSUFFICIENT', '지급 가능 금액 초과');
      const id = 'po_' + randomId(10);
      await t.query("INSERT INTO simpg_payouts(idem_key,id,payment_id,amount,status) VALUES ($1,$2,$3,$4,'accepted')", [idempotencyKey, id, providerPaymentId, amount]);
      return { id, status: 'accepted' };
    });
    if (faults.payoutTimeoutAfterAccept > 0) { faults.payoutTimeoutAfterAccept--; throw new ProviderError('TIMEOUT', '응답 시간 초과'); }
    return { payoutId: res.id as string, status: res.status as string };
  },
  async getPayoutByKey(key: string) {
    const r = await one(db, 'SELECT * FROM simpg_payouts WHERE idem_key=$1', [key]);
    return r && { payoutId: r.id as string, status: r.status as string, amount: r.amount as number };
  },
  async getBalance() {
    const a = await one(db, "SELECT COALESCE(SUM(amount-refunded),0)::bigint AS v FROM simpg_payments WHERE status IN ('paid','partial_cancelled')");
    const b = await one(db, "SELECT COALESCE(SUM(amount),0)::bigint AS v FROM simpg_payouts WHERE status<>'failed'");
    return Number(a.v) - Number(b.v);
  },
  verifyWebhook(rawBody: string, signature: string) {
    const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(signature || ''));
    if (!m || !safeEqual(m[2], hmac(`${m[1]}.${rawBody}`, config.webhookSecret))) throw new ProviderError('BAD_SIGNATURE', '웹훅 서명 검증 실패');
    if (Math.abs(Date.now() - Number(m[1])) > 5 * 60 * 1000) throw new ProviderError('STALE_SIGNATURE', '웹훅 서명 시각 만료');
    return JSON.parse(rawBody) as { id: string; type: string; data: any };
  },
  // 시뮬레이터 조작(결제창에서의 고객 행동, 은행 이체 완료)
  sim: {
    packet(evt: any, ts?: number) { const raw = JSON.stringify(evt); return { raw, signature: sign(raw, ts) }; },
    async approve(id: string) {
      if (!(await one(db, "UPDATE simpg_payments SET status='paid' WHERE id=$1 AND status='ready' RETURNING id", [id]))) throw new ProviderError('NOT_READY', '승인할 수 없는 상태');
      return emit('payment.paid', { paymentId: id });
    },
    async fail(id: string) { await db.query("UPDATE simpg_payments SET status='failed' WHERE id=$1 AND status='ready'", [id]); return emit('payment.failed', { paymentId: id }); },
    async completePayout(key: string) {
      if (!(await one(db, "UPDATE simpg_payouts SET status='paid' WHERE idem_key=$1 AND status='accepted' RETURNING id", [key]))) throw new ProviderError('NOT_ACCEPTED', '완료 처리할 수 없는 지급');
      return emit('payout.paid', { payoutKey: key });
    },
  },
};

// 실 결제 사업자(PortOne V2, 토스페이먼츠)는 계약과 기능 확인 뒤 같은 인터페이스로 추가한다.
export function getProvider() {
  if (config.paymentProvider === 'test') return simProvider;
  throw new Error(`결제 사업자 "${config.paymentProvider}" 는 아직 연동되지 않았습니다. docs/06 의 출시 전 확인 항목을 먼저 진행하세요.`);
}
