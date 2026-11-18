// 7대 상태 전이 규칙.
// 하나의 주문 상태에 모든 의미를 넣지 않고, 결제·대금 보호·납품·검수·분쟁·환불·판매자 지급을 따로 관리한다.
// 이 파일은 순수 함수만 담는다. 서비스 계층은 주문 행을 잠근(SELECT … FOR UPDATE) 트랜잭션 안에서
// reduce() 를 호출하고, 결과 상태를 그대로 저장한다. 외부 결제 사업자 호출은 트랜잭션 밖에서 한다.

export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'partially_refunded' | 'cancelled' | 'failed';
export type EscrowStatus = 'none' | 'test_simulated' | 'held' | 'dispute_hold' | 'released' | 'refunded' | 'unsupported';
export type DeliveryStatus = 'not_ready' | 'submitted' | 'granted' | 'failed' | 'revoked';
export type InspectionStatus = 'not_started' | 'in_progress' | 'revision_requested' | 'confirmed' | 'auto_confirmed' | 'disputed' | 'closed_by_admin';
export type DisputeStatus = 'none' | 'open' | 'resolved';
export type RefundStatus = 'none' | 'requested' | 'processing' | 'completed' | 'failed' | 'post_settlement_review';
export type PayoutStatus = 'not_eligible' | 'eligible' | 'requested' | 'unknown' | 'paid' | 'failed' | 'blocked' | 'void';

export interface OrderState {
  buyerId: number;
  sellerId: number;
  amount: number;            // 원
  refundedAmount: number;    // 원
  inspectionDays: number;
  payment: PaymentStatus;
  escrow: EscrowStatus;
  delivery: DeliveryStatus;
  inspection: InspectionStatus;
  dispute: DisputeStatus;
  refund: RefundStatus;
  payout: PayoutStatus;
  inspectionStartedAt: Date | null;
  inspectionDueAt: Date | null;
  accessUntil: Date | null;
  /** 진행 중 환불 금액(처리 중일 때만) */
  pendingRefund: number;
  /** 분쟁이 지급 이후에 접수되었는지 */
  postSettlementDispute: boolean;
}

export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// ── 상태별 허용 전이표 ──────────────────────────────────────────
export const TRANSITIONS = {
  payment: {
    unpaid: ['pending', 'failed'],
    pending: ['paid', 'failed', 'cancelled'],
    paid: ['partially_refunded', 'cancelled'],
    partially_refunded: ['partially_refunded', 'cancelled'],
    cancelled: [],
    failed: [],
  },
  escrow: {
    none: ['test_simulated', 'held', 'unsupported'],
    test_simulated: ['dispute_hold', 'released', 'refunded'],
    held: ['dispute_hold', 'released', 'refunded'],
    dispute_hold: ['held', 'test_simulated', 'released', 'refunded'],
    unsupported: [],
    released: [],
    refunded: [],
  },
  delivery: {
    not_ready: ['submitted', 'granted', 'failed'],
    submitted: ['granted', 'failed', 'not_ready'],
    failed: ['granted', 'failed', 'not_ready'],
    granted: ['revoked'],
    revoked: [],
  },
  inspection: {
    not_started: ['in_progress'],
    in_progress: ['confirmed', 'auto_confirmed', 'revision_requested', 'disputed', 'closed_by_admin'],
    revision_requested: ['in_progress', 'confirmed', 'disputed', 'closed_by_admin'],
    disputed: ['in_progress', 'closed_by_admin'],
    confirmed: [],
    auto_confirmed: [],
    closed_by_admin: [],
  },
  dispute: {
    none: ['open'],
    open: ['resolved'],
    resolved: ['open'],
  },
  refund: {
    none: ['requested', 'processing', 'post_settlement_review'],
    requested: ['processing', 'none', 'post_settlement_review'],
    processing: ['completed', 'failed'],
    failed: ['processing', 'requested', 'none'],
    completed: ['requested', 'processing'],
    post_settlement_review: ['processing', 'none'],
  },
  payout: {
    not_eligible: ['eligible', 'blocked', 'void'],
    eligible: ['requested', 'blocked', 'not_eligible', 'void'],
    blocked: ['eligible', 'not_eligible', 'void'],
    requested: ['paid', 'failed', 'unknown'],
    unknown: ['requested', 'paid', 'failed'],
    failed: ['eligible', 'requested', 'blocked', 'void'],
    paid: [],
    void: [],
  },
} as const;

export type StateKind = keyof typeof TRANSITIONS;

export function canTransition(kind: StateKind, from: string, to: string): boolean {
  const row = (TRANSITIONS[kind] as Record<string, readonly string[]>)[from];
  return from === to || (!!row && row.includes(to));
}
export function assertTransition(kind: StateKind, from: string, to: string): void {
  if (!canTransition(kind, from, to)) throw new RuleError('INVALID_TRANSITION', `${kind}: ${from} → ${to} 전이는 허용되지 않습니다`);
}

export function initialState(p: { buyerId: number; sellerId: number; amount: number; inspectionDays: number }): OrderState {
  return {
    ...p, refundedAmount: 0, payment: 'unpaid', escrow: 'none', delivery: 'not_ready', inspection: 'not_started',
    dispute: 'none', refund: 'none', payout: 'not_eligible', inspectionStartedAt: null, inspectionDueAt: null,
    accessUntil: null, pendingRefund: 0, postSettlementDispute: false,
  };
}

// ── 접근 규칙 ───────────────────────────────────────────────────
export interface Actor { id: number; operatorRole?: 'review' | 'support' | 'settlement' | 'super' | null }

/** 주문·정산 정보 열람: 당사자와 운영자만 */
export function canViewOrder(actor: Actor | null, o: OrderState): boolean {
  if (!actor) return false;
  return actor.id === o.buyerId || actor.id === o.sellerId || !!actor.operatorRole;
}
/** 정산 내역 열람: 판매자 본인과 정산·최고관리자만 */
export function canViewSettlement(actor: Actor | null, o: OrderState): boolean {
  if (!actor) return false;
  return actor.id === o.sellerId || actor.operatorRole === 'settlement' || actor.operatorRole === 'super';
}
/**
 * 납품 파일 다운로드. 결제가 서버에서 확인되고 납품 접근이 허용된 구매자만 가능하다.
 * 구매확정 여부는 조건이 아니다(확정을 먼저 눌러야 받는 구조 금지). 판매자의 탈퇴·삭제 여부도 조건이 아니다.
 */
export function downloadBlockers(actor: Actor | null, o: OrderState, now: Date): string[] {
  const b: string[] = [];
  if (!actor || actor.id !== o.buyerId) b.push('구매자 본인만 받을 수 있습니다');
  if (o.payment !== 'paid' && o.payment !== 'partially_refunded') b.push('결제가 확인되지 않았습니다');
  if (o.delivery !== 'granted') b.push(o.delivery === 'revoked' ? '환불이 완료되어 추가 다운로드가 차단되었습니다' : '납품물 접근이 아직 허용되지 않았습니다');
  if (o.accessUntil && now > o.accessUntil) b.push('보관 정책에 따른 접근 기간이 지났습니다');
  return b;
}

// ── 결제 전 차단 규칙 ───────────────────────────────────────────
export interface ProviderCaps {
  mode: 'test' | 'live';
  /** 사업자가 지급을 보류해 줄 수 있는 최대 일수. null 이면 확인되지 않음 */
  maxHoldDays: number | null;
  /** 사업자 측 자동 구매확정까지의 일수. null 이면 자동확정 없음 */
  autoConfirmDays: number | null;
  disputeHold: boolean;
  partialRefund: Record<string, boolean>; // 결제수단별
  stagedPayments: boolean;
}
/** 납품 여유 1일 + 검수 기간을 사업자 보호 기간 안에 넣을 수 없으면 결제를 막는다 */
export function checkoutBlockers(caps: ProviderCaps, inspectionDays: number, payMethod: string): string[] {
  const need = inspectionDays + 1;
  const b: string[] = [];
  if (!(payMethod in caps.partialRefund)) b.push('지원하지 않는 결제수단입니다');
  if (caps.mode === 'live' && caps.maxHoldDays == null) b.push('결제 사업자의 대금 보류 기간이 확인되지 않았습니다');
  if (caps.maxHoldDays != null && need > caps.maxHoldDays) b.push(`검수 기간(${inspectionDays}일)을 결제 사업자의 보류 가능 기간(${caps.maxHoldDays}일) 안에 확보할 수 없습니다`);
  if (caps.autoConfirmDays != null && need > caps.autoConfirmDays) b.push(`결제 사업자가 ${caps.autoConfirmDays}일 뒤 자동 구매확정하므로 검수 기간(${inspectionDays}일)과 충돌합니다`);
  return b;
}

// ── 납품물 확인 ─────────────────────────────────────────────────
export interface StoredFileInfo { kind: string; sizeBytes: number; sha256: string; present: boolean }
/** 약속한 파일 종류가 모두 있고, 주문 시점 해시와 같으며, 저장소에 실제로 존재하는지 */
export function checkDeliverables(promisedKinds: string[], snapshot: { kind: string; sha256: string }[], stored: StoredFileInfo[]): string[] {
  const problems: string[] = [];
  for (const k of promisedKinds) if (!stored.some((f) => f.kind === k)) problems.push(`누락: ${k}`);
  for (const s of snapshot) {
    const f = stored.find((x) => x.sha256 === s.sha256 && x.kind === s.kind);
    if (!f) problems.push(`주문 시점 파일과 다름: ${s.kind}`);
    else if (!f.present || f.sizeBytes <= 0) problems.push(`저장소에서 읽을 수 없음: ${s.kind}`);
  }
  return problems;
}

// ── 판매자 지급 전 확인 ─────────────────────────────────────────
export interface SellerState { status: 'pending' | 'approved' | 'suspended' | 'withdrawn'; payoutVerified: boolean }
export interface PayoutContext {
  seller: SellerState;
  /** 사업자에 직접 조회한 결제 상태가 내부 기록과 일치하는가 */
  externalPaymentMatches: boolean;
  /** 사업자 계정의 실제 지급 가능 잔액 */
  availableBalance: number;
  netAmount: number;
  payoutExists: boolean;
}
export function payoutBlockers(o: OrderState, c: PayoutContext): string[] {
  const b: string[] = [];
  if (o.payment !== 'paid' && o.payment !== 'partially_refunded') b.push('결제가 완료 상태가 아닙니다');
  if (!c.externalPaymentMatches) b.push('결제 사업자의 결제 상태가 내부 기록과 다릅니다(대사 필요)');
  if (o.delivery !== 'granted') b.push('납품이 완료되지 않았습니다');
  if (!['confirmed', 'auto_confirmed', 'closed_by_admin'].includes(o.inspection)) b.push('검수가 끝나지 않았습니다');
  if (o.dispute === 'open') b.push('분쟁이 진행 중입니다');
  if (['requested', 'processing', 'post_settlement_review'].includes(o.refund)) b.push('환불이 진행 중입니다');
  if (c.seller.status === 'pending' || c.seller.status === 'suspended') b.push('판매자 확인이 끝나지 않았거나 정지 상태입니다');
  if (!c.seller.payoutVerified) b.push('판매자 정산 계좌가 확인되지 않았습니다');
  if (c.payoutExists || ['requested', 'unknown', 'paid'].includes(o.payout)) b.push('이미 지급 요청되었거나 지급된 주문입니다');
  else if (o.payout !== 'eligible' && o.payout !== 'failed') b.push('지급 대상 상태가 아닙니다');
  if (c.netAmount > c.availableBalance) b.push('실제 지급 가능 잔액이 부족합니다');
  return b;
}

// ── 이벤트 ──────────────────────────────────────────────────────
export type OrderEvent =
  | { type: 'CHECKOUT_STARTED' }
  | { type: 'PAYMENT_CONFIRMED'; externalStatus: 'paid' | 'failed' | 'cancelled'; externalAmount: number; mode: 'test' | 'live'; escrowSupported: boolean; now: Date; retentionDays: number }
  | { type: 'DELIVERY_SUBMITTED' }
  | { type: 'DELIVERY_CHECKED'; problems: string[]; now: Date }
  | { type: 'REVISION_REQUESTED'; actorId: number }
  | { type: 'REVISION_DELIVERED'; now: Date }
  | { type: 'BUYER_CONFIRMED'; actorId: number }
  | { type: 'AUTO_CONFIRM'; now: Date; policyEnabled: boolean; providerAllows: boolean }
  | { type: 'ADMIN_CLOSED_INSPECTION'; operatorRole: string; basis: string }
  | { type: 'DISPUTE_OPENED'; actorId: number }
  | { type: 'EXTERNAL_HOLD_RESULT'; result: 'confirmed' | 'unsupported' | 'failed' }
  | { type: 'DISPUTE_RESOLVED'; operatorRole: string; basis: string; decidedByAi?: boolean; decision: 'refund_full' | 'refund_partial' | 'resume' | 'release' | 'external_resolution'; mode: 'test' | 'live'; now: Date }
  | { type: 'REFUND_STARTED'; amount: number; partialSupported: boolean }
  | { type: 'REFUND_CONFIRMED'; amount: number }
  | { type: 'REFUND_FAILED' }
  | { type: 'PAYOUT_REQUESTED'; context: PayoutContext }
  | { type: 'PAYOUT_TIMEOUT' }
  | { type: 'PAYOUT_LOOKUP'; found: 'none' | 'accepted' | 'paid' | 'failed' }
  | { type: 'PAYOUT_RETRY_ALLOWED' };

export interface Reduced { state: OrderState; notices: string[]; changed: boolean }

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const inspectionDone = (s: InspectionStatus) => s === 'confirmed' || s === 'auto_confirmed' || s === 'closed_by_admin';

/**
 * 이벤트 하나를 적용해 다음 상태를 돌려준다. 같은 이벤트가 다시 와도(중복·지연·역순 웹훅) 결과가 달라지지 않는다.
 * 허용되지 않는 요청은 RuleError 를 던진다.
 */
export function reduce(prev: OrderState, ev: OrderEvent): Reduced {
  const s: OrderState = { ...prev };
  const notices: string[] = [];
  const set = <K extends StateKind>(kind: K, to: OrderState[K]) => { assertTransition(kind, s[kind] as string, to as string); (s[kind] as OrderState[K]) = to; };
  const noop = (): Reduced => ({ state: prev, notices, changed: false });

  switch (ev.type) {
    case 'CHECKOUT_STARTED':
      if (s.payment !== 'unpaid') return noop();
      set('payment', 'pending');
      break;

    case 'PAYMENT_CONFIRMED': {
      // 웹훅은 "조회해 보라"는 신호일 뿐이고, 판단 근거는 서버가 사업자에 직접 조회한 결과(externalStatus)다.
      if (ev.externalStatus === 'failed') { if (s.payment !== 'pending' && s.payment !== 'unpaid') return noop(); set('payment', 'failed'); break; }
      if (ev.externalStatus === 'cancelled') {
        // 결제 승인 통지보다 취소 통지가 먼저 도착한 경우 등: 납품을 열지 않고 종결
        if (s.payment === 'cancelled' || s.payment === 'failed') return noop();
        if (s.payment === 'unpaid') set('payment', 'pending');
        set('payment', 'cancelled'); s.refundedAmount = s.amount; s.pendingRefund = 0;
        if (s.payout !== 'paid') s.payout = canTransition('payout', s.payout, 'void') ? 'void' : s.payout;
        if (s.delivery === 'granted') set('delivery', 'revoked');
        if (canTransition('escrow', s.escrow, 'refunded')) s.escrow = 'refunded';
        notices.push('결제 사업자에서 결제가 취소된 것으로 확인되었습니다. 내부 환불 기록이 없으면 대사에서 불일치로 표시됩니다');
        break;
      }
      if (s.payment !== 'pending' && s.payment !== 'unpaid') return noop(); // 이미 반영된 결제(중복·지연 통지)
      if (ev.externalAmount !== s.amount) { if (s.payment === 'unpaid') set('payment', 'pending'); set('payment', 'failed'); notices.push('결제 금액이 주문 금액과 달라 결제를 인정하지 않았습니다'); break; }
      if (s.payment === 'unpaid') set('payment', 'pending');
      set('payment', 'paid');
      set('escrow', ev.mode === 'test' ? 'test_simulated' : ev.escrowSupported ? 'held' : 'unsupported');
      s.accessUntil = addDays(ev.now, ev.retentionDays);
      if (ev.mode === 'test') notices.push('테스트 결제입니다. 실제 결제대금 보호는 이루어지지 않습니다');
      break;
    }

    case 'DELIVERY_SUBMITTED': // 맞춤 개발: 판매자가 단계 산출물을 제출
      if (s.payment !== 'paid') throw new RuleError('NOT_PAID', '해당 단계의 결제가 확인된 뒤에 납품할 수 있습니다');
      set('delivery', 'submitted');
      break;

    case 'DELIVERY_CHECKED': {
      if (s.payment !== 'paid' && s.payment !== 'partially_refunded') throw new RuleError('NOT_PAID', '결제가 확인되지 않은 주문에는 납품물 접근을 열 수 없습니다');
      if (s.delivery === 'granted' || s.delivery === 'revoked') return noop();
      if (ev.problems.length) { set('delivery', 'failed'); notices.push(`납품물 확인 실패: ${ev.problems.join(', ')}`); break; } // 검수 기간은 시작하지 않는다
      set('delivery', 'granted');
      set('inspection', 'in_progress');
      s.inspectionStartedAt = ev.now; s.inspectionDueAt = addDays(ev.now, s.inspectionDays);
      break;
    }

    case 'REVISION_REQUESTED':
      if (ev.actorId !== s.buyerId) throw new RuleError('FORBIDDEN', '구매자만 수정 요청할 수 있습니다');
      set('inspection', 'revision_requested');
      break;

    case 'REVISION_DELIVERED':
      if (s.inspection !== 'revision_requested') return noop();
      set('inspection', 'in_progress');
      s.inspectionDueAt = addDays(ev.now, s.inspectionDays);
      break;

    case 'BUYER_CONFIRMED':
      if (ev.actorId !== s.buyerId) throw new RuleError('FORBIDDEN', '구매자만 구매확정할 수 있습니다');
      if (s.delivery !== 'granted') throw new RuleError('NOT_DELIVERED', '납품물이 전달되지 않은 주문은 구매확정할 수 없습니다');
      if (s.dispute === 'open') throw new RuleError('DISPUTE_OPEN', '분쟁이 진행 중입니다');
      if (inspectionDone(s.inspection)) return noop();
      set('inspection', 'confirmed');
      set('payout', 'eligible');
      break;

    case 'AUTO_CONFIRM':
      if (!ev.policyEnabled || !ev.providerAllows) throw new RuleError('AUTO_CONFIRM_DISABLED', '자동확정은 결제 사업자 정책과 검토된 운영 정책이 일치할 때만 적용합니다');
      if (s.inspection !== 'in_progress' || s.delivery !== 'granted' || s.dispute === 'open' || !s.inspectionDueAt || ev.now <= s.inspectionDueAt) return noop();
      set('inspection', 'auto_confirmed');
      set('payout', 'eligible');
      break;

    case 'ADMIN_CLOSED_INSPECTION': // 판매자의 검수 종료 심사 요청을 운영자가 승인
      if (ev.operatorRole !== 'support' && ev.operatorRole !== 'super') throw new RuleError('FORBIDDEN', '고객지원·최고관리자만 처리할 수 있습니다');
      if (!ev.basis.trim()) throw new RuleError('BASIS_REQUIRED', '결정 근거를 기록해야 합니다');
      if (s.delivery !== 'granted') throw new RuleError('NOT_DELIVERED', '납품되지 않은 주문의 검수를 종료할 수 없습니다');
      if (s.dispute === 'open') throw new RuleError('DISPUTE_OPEN', '분쟁은 분쟁 결정으로 처리해야 합니다');
      set('inspection', 'closed_by_admin');
      set('payout', 'eligible');
      break;

    case 'DISPUTE_OPENED': {
      if (ev.actorId !== s.buyerId && ev.actorId !== s.sellerId) throw new RuleError('FORBIDDEN', '거래 당사자만 문제를 제기할 수 있습니다');
      if (s.payment !== 'paid' && s.payment !== 'partially_refunded') throw new RuleError('NOT_PAID', '결제된 주문에만 문제를 제기할 수 있습니다');
      if (s.dispute === 'open') return noop();
      set('dispute', 'open');
      if (s.payout === 'requested' || s.payout === 'unknown' || s.payout === 'paid') {
        // 이미 지급이 진행된 거래는 일반 보류로 되돌릴 수 없다
        s.postSettlementDispute = true;
        notices.push('이미 판매자 지급이 진행된 거래입니다. 지급 보류가 아니라 사후 환불·회수 검토 절차로 진행합니다');
      } else {
        set('payout', 'blocked');
        if (s.inspection === 'in_progress' || s.inspection === 'revision_requested') set('inspection', 'disputed');
        notices.push('플랫폼 내부 정산을 보류했습니다. 결제 사업자의 지급 보류 여부는 별도로 확인해 표시합니다');
      }
      break;
    }

    case 'EXTERNAL_HOLD_RESULT':
      if (s.dispute !== 'open' || s.postSettlementDispute) return noop();
      if (ev.result === 'confirmed') { if (canTransition('escrow', s.escrow, 'dispute_hold')) s.escrow = 'dispute_hold'; }
      else notices.push(ev.result === 'unsupported' ? '결제 사업자가 지급 보류를 지원하지 않습니다. 플랫폼 내부 보류만 적용 중입니다' : '결제 사업자 지급 보류 요청이 실패했습니다. 운영자 확인이 필요합니다');
      break;

    case 'DISPUTE_RESOLVED': {
      if (ev.decidedByAi) throw new RuleError('HUMAN_REQUIRED', '환불·권리 분쟁의 최종 판단은 사람 운영자가 내려야 합니다');
      if (ev.operatorRole !== 'support' && ev.operatorRole !== 'super') throw new RuleError('FORBIDDEN', '고객지원·최고관리자만 결정할 수 있습니다');
      if (!ev.basis.trim()) throw new RuleError('BASIS_REQUIRED', '결정 근거를 기록해야 합니다');
      if (s.dispute !== 'open') throw new RuleError('NO_DISPUTE', '진행 중인 분쟁이 없습니다');
      set('dispute', 'resolved');
      if (s.escrow === 'dispute_hold' && (ev.decision === 'resume' || ev.decision === 'release')) s.escrow = ev.mode === 'test' ? 'test_simulated' : 'held';
      if (ev.decision === 'refund_full' || ev.decision === 'refund_partial') {
        if (s.postSettlementDispute) { set('refund', 'post_settlement_review'); notices.push('이미 지급된 거래이므로 사후 환불·회수 검토로 넘깁니다'); }
        else set('refund', 'requested');
      } else if (ev.decision === 'resume') {
        if (s.postSettlementDispute) break;
        if (s.inspection === 'disputed') { set('inspection', 'in_progress'); s.inspectionDueAt = addDays(ev.now, s.inspectionDays); set('payout', 'not_eligible'); }
        else if (inspectionDone(s.inspection)) set('payout', 'eligible');
        else set('payout', 'not_eligible');
      } else if (ev.decision === 'release') {
        if (s.postSettlementDispute) break;
        if (s.delivery !== 'granted') throw new RuleError('NOT_DELIVERED', '납품되지 않은 거래는 정산으로 결정할 수 없습니다');
        if (!inspectionDone(s.inspection)) set('inspection', 'closed_by_admin');
        set('payout', 'eligible');
      } else notices.push('외부 분쟁 해결 절차를 안내합니다. 결과가 나올 때까지 내부 정산 보류를 유지합니다');
      notices.push('양측에 결정 내용과 이의제기 방법을 안내합니다');
      break;
    }

    case 'REFUND_STARTED': {
      const remaining = s.amount - s.refundedAmount;
      if (ev.amount <= 0 || ev.amount > remaining) throw new RuleError('BAD_AMOUNT', '환불 가능 금액을 벗어났습니다');
      if (s.payment !== 'paid' && s.payment !== 'partially_refunded') throw new RuleError('NOT_PAID', '결제된 주문만 환불할 수 있습니다');
      if (s.refund === 'processing') throw new RuleError('REFUND_IN_PROGRESS', '이미 처리 중인 환불이 있습니다');
      if (s.payout === 'requested' || s.payout === 'unknown' || s.payout === 'paid') {
        // 지급과 환불이 같은 돈을 두 번 쓰지 못하게 한다: 지급이 먼저 잡혔으면 환불은 사후 검토로만 간다
        set('refund', 'post_settlement_review');
        notices.push('이미 지급 요청·지급된 거래입니다. 일반 환불이 아니라 사후 환불·회수 검토로 연결합니다');
        break;
      }
      if (ev.amount < remaining && !ev.partialSupported) {
        throw new RuleError('PARTIAL_REFUND_UNSUPPORTED', '이 결제수단은 부분 환불을 지원하지 않습니다. 대체 절차: 전액 환불 후 합의 금액으로 재결제, 또는 양측 합의에 따른 거래 종결');
      }
      set('refund', 'processing');
      s.pendingRefund = ev.amount;
      if (s.payout !== 'void') set('payout', 'blocked');
      break;
    }

    case 'REFUND_CONFIRMED': {
      // 사업자의 결제 취소 성공을 확인한 뒤에만 호출한다
      if (s.refund !== 'processing') return noop();
      if (ev.amount !== s.pendingRefund) throw new RuleError('AMOUNT_MISMATCH', '확인된 환불 금액이 요청 금액과 다릅니다');
      s.refundedAmount += ev.amount; s.pendingRefund = 0;
      set('refund', 'completed');
      if (s.refundedAmount === s.amount) {
        set('payment', 'cancelled'); set('payout', 'void');
        if (canTransition('escrow', s.escrow, 'refunded')) s.escrow = 'refunded';
        if (s.delivery === 'granted') {
          set('delivery', 'revoked');
          notices.push('추가 다운로드를 차단했습니다. 이미 내려받은 파일은 회수하거나 원격 삭제할 수 없으므로, 구매자에게 이용 종료와 삭제 확인을 안내합니다');
        }
      } else {
        set('payment', 'partially_refunded');
        set('payout', s.dispute !== 'open' && s.delivery === 'granted' && inspectionDone(s.inspection) ? 'eligible' : 'not_eligible');
      }
      break;
    }

    case 'REFUND_FAILED':
      if (s.refund !== 'processing') return noop();
      set('refund', 'failed'); s.pendingRefund = 0;
      notices.push('결제 취소가 실패했습니다. 환불은 완료되지 않았습니다');
      break;

    case 'PAYOUT_REQUESTED': {
      const b = payoutBlockers(s, ev.context);
      if (b.length) throw new RuleError('PAYOUT_BLOCKED', b.join(' / '));
      set('payout', 'requested'); // 접수. 완료는 사업자 확인 후
      break;
    }

    case 'PAYOUT_TIMEOUT':
      if (s.payout !== 'requested') return noop();
      set('payout', 'unknown');
      notices.push('지급 요청 응답이 불명확합니다. 같은 멱등성 키로 조회한 뒤에만 재시도합니다');
      break;

    case 'PAYOUT_LOOKUP':
      if (s.payout !== 'requested' && s.payout !== 'unknown') return noop();
      if (ev.found === 'paid') { set('payout', 'paid'); if (canTransition('escrow', s.escrow, 'released')) s.escrow = 'released'; }
      else if (ev.found === 'failed') set('payout', 'failed');
      else if (ev.found === 'accepted') set('payout', 'requested');
      else if (s.payout === 'unknown') { set('payout', 'requested'); notices.push('사업자에 접수 기록이 없어 같은 멱등성 키로 다시 요청합니다'); }
      else return noop();
      break;

    case 'PAYOUT_RETRY_ALLOWED':
      if (s.payout !== 'failed') return noop();
      set('payout', s.dispute === 'open' ? 'blocked' : 'eligible');
      break;
  }
  return { state: s, notices, changed: true };
}

/** 상태 조합이 깨지지 않았는지 검사(DB의 CHECK 제약과 같은 내용). 위반 목록을 돌려준다 */
export function invariantViolations(o: OrderState): string[] {
  const v: string[] = [];
  if (o.inspection !== 'not_started' && o.delivery !== 'granted' && o.delivery !== 'revoked') v.push('납품 없이 검수가 시작됨');
  if (o.delivery === 'granted' && o.payment !== 'paid' && o.payment !== 'partially_refunded') v.push('결제 확인 없이 납품 접근이 열림');
  if (o.payout === 'eligible' && o.dispute === 'open') v.push('분쟁 중인데 지급 대상임');
  if (o.payout === 'eligible' && !inspectionDone(o.inspection)) v.push('검수가 끝나지 않았는데 지급 대상임');
  if (o.payment === 'cancelled' && !['not_eligible', 'void', 'blocked', 'failed'].includes(o.payout)) v.push('전액 취소된 결제인데 지급이 살아 있음');
  if (o.refundedAmount < 0 || o.refundedAmount > o.amount) v.push('환불 누계가 결제액을 벗어남');
  return v;
}
