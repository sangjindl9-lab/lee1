import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, downloadBlockers, canViewOrder, canViewSettlement, checkoutBlockers, checkDeliverables,
  payoutBlockers, invariantViolations, RuleError, TRANSITIONS, canTransition } from '../src/domain/states.ts';
import type { OrderState, OrderEvent, PayoutContext, ProviderCaps } from '../src/domain/states.ts';

const now = new Date('2026-11-18T06:00:00Z');
const later = (days: number) => new Date(now.getTime() + days * 86400000);
const BUYER = 1, SELLER = 2, OTHER = 3;
const fresh = () => initialState({ buyerId: BUYER, sellerId: SELLER, amount: 1_000_000, inspectionDays: 7 });
const run = (s: OrderState, ...evs: OrderEvent[]) => evs.reduce((acc, ev) => { const r = reduce(acc, ev); assert.deepEqual(invariantViolations(r.state), []); return r.state; }, s);
const paidEv: OrderEvent = { type: 'PAYMENT_CONFIRMED', externalStatus: 'paid', externalAmount: 1_000_000, mode: 'test', escrowSupported: false, now, retentionDays: 365 };
const delivered = () => run(fresh(), { type: 'CHECKOUT_STARTED' }, paidEv, { type: 'DELIVERY_CHECKED', problems: [], now });
const ctx = (over: Partial<PayoutContext> = {}): PayoutContext => ({ seller: { status: 'approved', payoutVerified: true }, externalPaymentMatches: true, availableBalance: 10_000_000, netAmount: 800_000, payoutExists: false, ...over });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as RuleError).code; } return null; };
const caps: ProviderCaps = { mode: 'test', maxHoldDays: 30, autoConfirmDays: null, disputeHold: true, partialRefund: { card: true, vbank: false }, stagedPayments: false };

test('전이표: 모든 도착 상태가 정의되어 있고 종결 상태에서는 나갈 수 없다', () => {
  for (const [kind, rows] of Object.entries(TRANSITIONS)) for (const tos of Object.values(rows)) for (const to of tos as readonly string[]) assert.ok(to in rows, `${kind}.${to}`);
  assert.equal(canTransition('payout', 'paid', 'eligible'), false);
  assert.equal(canTransition('payment', 'cancelled', 'paid'), false);
  assert.equal(canTransition('delivery', 'revoked', 'granted'), false);
});

test('① 결제하지 않은 사용자는 파일에 접근할 수 없다 / 브라우저 성공 화면만으로는 결제 완료가 아니다', () => {
  const pending = run(fresh(), { type: 'CHECKOUT_STARTED' });
  assert.ok(downloadBlockers({ id: BUYER }, pending, now).length > 0);
  assert.equal(code(() => reduce(pending, { type: 'DELIVERY_CHECKED', problems: [], now })), 'NOT_PAID');
  assert.equal(downloadBlockers({ id: BUYER }, delivered(), now).length, 0);
});

test('② 타인의 주문·정산 정보에 접근할 수 없다', () => {
  const o = delivered();
  assert.equal(canViewOrder({ id: OTHER }, o), false);
  assert.equal(canViewOrder(null, o), false);
  assert.ok(downloadBlockers({ id: OTHER }, o, now).length > 0);
  assert.ok(downloadBlockers({ id: SELLER }, o, now).length > 0);
  assert.equal(canViewSettlement({ id: BUYER }, o), false);
  assert.equal(canViewSettlement({ id: SELLER }, o), true);
  assert.equal(canViewSettlement({ id: 9, operatorRole: 'review' }, o), false);
  assert.equal(canViewSettlement({ id: 9, operatorRole: 'settlement' }, o), true);
});

test('③ 결제 완료 후 파일 전달 실패: 검수 기간을 시작하지 않고, 복구되면 그때 시작한다', () => {
  const failed = run(fresh(), { type: 'CHECKOUT_STARTED' }, paidEv, { type: 'DELIVERY_CHECKED', problems: ['저장소에서 읽을 수 없음: source'], now });
  assert.equal(failed.delivery, 'failed'); assert.equal(failed.inspection, 'not_started'); assert.equal(failed.inspectionDueAt, null);
  const ok = run(failed, { type: 'DELIVERY_CHECKED', problems: [], now: later(2) });
  assert.equal(ok.delivery, 'granted'); assert.equal(ok.inspection, 'in_progress');
  assert.deepEqual(ok.inspectionDueAt, later(9)); // 복구 시점부터 7일
});

test('④ 빈 파일·누락 파일 납품은 납품으로 인정하지 않는다', () => {
  const snap = [{ kind: 'source', sha256: 'a' }, { kind: 'install_doc', sha256: 'b' }];
  assert.deepEqual(checkDeliverables(['source', 'install_doc'], snap, [{ kind: 'source', sha256: 'a', sizeBytes: 10, present: true }, { kind: 'install_doc', sha256: 'b', sizeBytes: 5, present: true }]), []);
  assert.ok(checkDeliverables(['source', 'install_doc'], snap, [{ kind: 'install_doc', sha256: 'b', sizeBytes: 5, present: true }]).some((p) => p.includes('누락: source')));
  assert.ok(checkDeliverables(['source'], snap.slice(0, 1), [{ kind: 'source', sha256: 'a', sizeBytes: 0, present: true }]).length > 0);
  // 소스 제공 상품인데 실행 파일만 있는 경우
  assert.ok(checkDeliverables(['source', 'executable'], [], [{ kind: 'executable', sha256: 'x', sizeBytes: 9, present: true }]).includes('누락: source'));
});

test('⑤ 계약과 다른 파일로 교체하면 주문 시점 해시와 달라 납품이 열리지 않는다', () => {
  const p = checkDeliverables(['source'], [{ kind: 'source', sha256: 'a' }], [{ kind: 'source', sha256: 'zzz', sizeBytes: 10, present: true }]);
  assert.ok(p.some((x) => x.includes('주문 시점 파일과 다름')));
});

test('⑥ 판매자가 탈퇴해도 기존 구매자의 접근은 보관 기간 동안 유지된다', () => {
  const o = delivered(); // 다운로드 규칙은 판매자 상태를 보지 않는다
  assert.equal(downloadBlockers({ id: BUYER }, o, later(300)).length, 0);
  assert.ok(downloadBlockers({ id: BUYER }, o, later(366)).some((b) => b.includes('접근 기간')));
  // 탈퇴한 판매자에게도 이미 끝난 거래의 대금은 지급한다. 정지·미확인 판매자는 막는다
  const confirmed = run(o, { type: 'BUYER_CONFIRMED', actorId: BUYER });
  assert.deepEqual(payoutBlockers(confirmed, ctx({ seller: { status: 'withdrawn', payoutVerified: true } })), []);
  assert.ok(payoutBlockers(confirmed, ctx({ seller: { status: 'suspended', payoutVerified: true } })).length > 0);
});

test('⑦ 미납품 상태에서는 구매확정·검수 종료·정산이 모두 막힌다 / 다운로드는 구매확정이 아니다', () => {
  const paid = run(fresh(), { type: 'CHECKOUT_STARTED' }, paidEv);
  assert.equal(code(() => reduce(paid, { type: 'BUYER_CONFIRMED', actorId: BUYER })), 'NOT_DELIVERED');
  assert.equal(code(() => reduce(paid, { type: 'ADMIN_CLOSED_INSPECTION', operatorRole: 'support', basis: '근거' })), 'NOT_DELIVERED');
  assert.equal(code(() => reduce(paid, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED');
  const d = delivered(); // 납품(다운로드 가능)만으로는 지급 대상이 아니다
  assert.equal(d.payout, 'not_eligible');
  assert.equal(code(() => reduce(d, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED');
  assert.equal(code(() => reduce(d, { type: 'BUYER_CONFIRMED', actorId: SELLER })), 'FORBIDDEN');
});

test('⑧ 분쟁 중에는 지급할 수 없고, 외부 보류 결과는 내부 보류와 따로 기록된다', () => {
  const confirmed = run(delivered(), { type: 'BUYER_CONFIRMED', actorId: BUYER });
  const r = reduce(confirmed, { type: 'DISPUTE_OPENED', actorId: BUYER });
  assert.equal(r.state.payout, 'blocked'); assert.equal(r.state.escrow, 'test_simulated'); // 내부 보류만으로 외부 보류가 된 것으로 보지 않는다
  assert.equal(code(() => reduce(r.state, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED');
  const unsupported = reduce(r.state, { type: 'EXTERNAL_HOLD_RESULT', result: 'unsupported' });
  assert.equal(unsupported.state.escrow, 'test_simulated'); assert.ok(unsupported.notices[0].includes('지원하지 않습니다'));
  const held = reduce(r.state, { type: 'EXTERNAL_HOLD_RESULT', result: 'confirmed' });
  assert.equal(held.state.escrow, 'dispute_hold');
  // 결정에는 사람 운영자와 근거가 필요하다
  const base = { type: 'DISPUTE_RESOLVED', decision: 'release', mode: 'test', now } as const;
  assert.equal(code(() => reduce(held.state, { ...base, operatorRole: 'support', basis: '' })), 'BASIS_REQUIRED');
  assert.equal(code(() => reduce(held.state, { ...base, operatorRole: 'review', basis: '근거' })), 'FORBIDDEN');
  assert.equal(code(() => reduce(held.state, { ...base, operatorRole: 'support', basis: '근거', decidedByAi: true })), 'HUMAN_REQUIRED');
  const released = run(held.state, { ...base, operatorRole: 'support', basis: '설치 문서대로 실행됨을 확인' });
  assert.equal(released.payout, 'eligible'); assert.equal(released.escrow, 'test_simulated');
});

test('⑨ 환불과 정산이 동시에 실행되어도 같은 돈이 두 번 쓰이지 않는다', () => {
  const eligible = run(delivered(), { type: 'BUYER_CONFIRMED', actorId: BUYER });
  // 환불이 먼저 잡힌 경우: 지급 불가
  const refunding = run(eligible, { type: 'REFUND_STARTED', amount: 1_000_000, partialSupported: true });
  assert.equal(code(() => reduce(refunding, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED');
  // 지급이 먼저 잡힌 경우: 환불은 사후 검토로만
  const paying = run(eligible, { type: 'PAYOUT_REQUESTED', context: ctx() });
  const r = reduce(paying, { type: 'REFUND_STARTED', amount: 1_000_000, partialSupported: true });
  assert.equal(r.state.refund, 'post_settlement_review'); assert.equal(r.state.payout, 'requested'); assert.equal(r.state.refundedAmount, 0);
  assert.equal(code(() => reduce(paying, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED'); // 중복 지급
  // 이미 지급된 뒤의 분쟁은 보류가 아니라 사후 절차
  const paidOut = run(paying, { type: 'PAYOUT_LOOKUP', found: 'paid' });
  const d = reduce(paidOut, { type: 'DISPUTE_OPENED', actorId: BUYER });
  assert.equal(d.state.payout, 'paid'); assert.equal(d.state.postSettlementDispute, true);
  const res = run(d.state, { type: 'DISPUTE_RESOLVED', operatorRole: 'super', basis: '근거', decision: 'refund_full', mode: 'test', now });
  assert.equal(res.refund, 'post_settlement_review');
});

test('⑩ 중복·지연·역순 웹훅에도 결과가 같다', () => {
  const pending = run(fresh(), { type: 'CHECKOUT_STARTED' });
  const once = reduce(pending, paidEv);
  const twice = reduce(once.state, paidEv);
  assert.equal(twice.changed, false); assert.deepEqual(twice.state, once.state);
  // 납품·확정까지 끝난 뒤 뒤늦게 도착한 결제 승인 통지
  const done = run(once.state, { type: 'DELIVERY_CHECKED', problems: [], now }, { type: 'BUYER_CONFIRMED', actorId: BUYER });
  assert.equal(reduce(done, paidEv).changed, false);
  // 취소 통지가 승인 통지보다 먼저 도착: 납품을 열지 않는다
  const cancelledFirst = run(pending, { ...paidEv, externalStatus: 'cancelled' });
  assert.equal(cancelledFirst.payment, 'cancelled'); assert.equal(cancelledFirst.delivery, 'not_ready');
  assert.equal(reduce(cancelledFirst, paidEv).changed, false);
  assert.equal(code(() => reduce(cancelledFirst, { type: 'DELIVERY_CHECKED', problems: [], now })), 'NOT_PAID');
  // 금액이 다른 결제는 인정하지 않는다
  assert.equal(run(pending, { ...paidEv, externalAmount: 1000 }).payment, 'failed');
  // 환불 확인 통지 중복
  const refunding = run(delivered(), { type: 'REFUND_STARTED', amount: 1_000_000, partialSupported: true }, { type: 'REFUND_CONFIRMED', amount: 1_000_000 });
  assert.equal(reduce(refunding, { type: 'REFUND_CONFIRMED', amount: 1_000_000 }).changed, false);
  assert.equal(refunding.refundedAmount, 1_000_000);
});

test('⑪ 외부 지급 요청 타임아웃: 조회 후에만 재시도하고, 접수와 완료를 구분한다', () => {
  const requested = run(delivered(), { type: 'BUYER_CONFIRMED', actorId: BUYER }, { type: 'PAYOUT_REQUESTED', context: ctx() });
  assert.equal(requested.payout, 'requested'); // 접수일 뿐 완료가 아니다
  const unknown = run(requested, { type: 'PAYOUT_TIMEOUT' });
  assert.equal(unknown.payout, 'unknown');
  assert.equal(code(() => reduce(unknown, { type: 'PAYOUT_REQUESTED', context: ctx() })), 'PAYOUT_BLOCKED'); // 조회 없이 새 지급 불가
  assert.equal(run(unknown, { type: 'PAYOUT_LOOKUP', found: 'accepted' }).payout, 'requested'); // 사실은 접수돼 있었음
  assert.equal(run(unknown, { type: 'PAYOUT_LOOKUP', found: 'paid' }).payout, 'paid');
  const retry = reduce(unknown, { type: 'PAYOUT_LOOKUP', found: 'none' }); // 접수 기록 없음 → 같은 키로 재요청
  assert.equal(retry.state.payout, 'requested'); assert.ok(retry.notices[0].includes('같은 멱등성 키'));
  const failed = run(unknown, { type: 'PAYOUT_LOOKUP', found: 'failed' });
  assert.equal(run(failed, { type: 'PAYOUT_RETRY_ALLOWED' }).payout, 'eligible');
});

test('⑫ 부분 환불을 지원하지 않는 결제수단은 대체 절차를 안내하고 상태를 바꾸지 않는다', () => {
  const d = delivered();
  try { reduce(d, { type: 'REFUND_STARTED', amount: 300_000, partialSupported: false }); assert.fail('막혀야 함'); }
  catch (e) { assert.equal((e as RuleError).code, 'PARTIAL_REFUND_UNSUPPORTED'); assert.ok((e as Error).message.includes('대체 절차')); }
  assert.equal(run(d, { type: 'REFUND_STARTED', amount: 1_000_000, partialSupported: false }).refund, 'processing'); // 전액은 가능
  const partial = run(run(d, { type: 'BUYER_CONFIRMED', actorId: BUYER }), { type: 'REFUND_STARTED', amount: 300_000, partialSupported: true }, { type: 'REFUND_CONFIRMED', amount: 300_000 });
  assert.equal(partial.payment, 'partially_refunded'); assert.equal(partial.refundedAmount, 300_000); assert.equal(partial.payout, 'eligible');
  assert.equal(code(() => reduce(partial, { type: 'REFUND_STARTED', amount: 700_001, partialSupported: true })), 'BAD_AMOUNT');
});

test('⑬ 검수 기한과 외부 자동확정 일정이 충돌하면 결제를 막는다', () => {
  assert.deepEqual(checkoutBlockers(caps, 7, 'card'), []);
  assert.ok(checkoutBlockers({ ...caps, autoConfirmDays: 7 }, 7, 'card')[0].includes('자동 구매확정'));
  assert.ok(checkoutBlockers({ ...caps, maxHoldDays: 5 }, 7, 'card')[0].includes('보류 가능 기간'));
  assert.ok(checkoutBlockers({ ...caps, mode: 'live', maxHoldDays: null }, 7, 'card')[0].includes('확인되지 않았습니다'));
  assert.ok(checkoutBlockers(caps, 7, 'paypal').length > 0);
  // 자동확정은 정책과 사업자 조건이 모두 맞을 때만
  const overdue = delivered();
  assert.equal(code(() => reduce(overdue, { type: 'AUTO_CONFIRM', now: later(8), policyEnabled: false, providerAllows: true })), 'AUTO_CONFIRM_DISABLED');
  assert.equal(reduce(overdue, { type: 'AUTO_CONFIRM', now: later(6), policyEnabled: true, providerAllows: true }).changed, false); // 기한 전
  assert.equal(run(overdue, { type: 'AUTO_CONFIRM', now: later(8), policyEnabled: true, providerAllows: true }).inspection, 'auto_confirmed');
});

test('⑭ 환불 완료 뒤에는 추가 다운로드를 막고, 이미 받은 파일의 한계를 안내한다', () => {
  const refunding = run(delivered(), { type: 'REFUND_STARTED', amount: 1_000_000, partialSupported: true });
  assert.equal(refunding.refund, 'processing'); assert.equal(refunding.payment, 'paid'); // 요청·처리 중은 완료가 아니다
  assert.equal(downloadBlockers({ id: BUYER }, refunding, now).length, 0);
  const r = reduce(refunding, { type: 'REFUND_CONFIRMED', amount: 1_000_000 });
  assert.equal(r.state.refund, 'completed'); assert.equal(r.state.payment, 'cancelled'); assert.equal(r.state.delivery, 'revoked'); assert.equal(r.state.payout, 'void');
  assert.ok(r.notices.some((n) => n.includes('회수하거나 원격 삭제할 수 없으므로')));
  assert.ok(downloadBlockers({ id: BUYER }, r.state, now).some((b) => b.includes('추가 다운로드가 차단')));
  const f = run(refunding, { type: 'REFUND_FAILED' });
  assert.equal(f.refund, 'failed'); assert.equal(f.refundedAmount, 0); assert.equal(f.payment, 'paid');
});

test('수정 요청 → 재납품 → 확정, 분쟁 → 거래 재개 흐름', () => {
  const rev = run(delivered(), { type: 'REVISION_REQUESTED', actorId: BUYER });
  assert.equal(rev.inspection, 'revision_requested');
  const back = run(rev, { type: 'REVISION_DELIVERED', now: later(3) });
  assert.deepEqual(back.inspectionDueAt, later(10));
  const disputed = run(back, { type: 'DISPUTE_OPENED', actorId: BUYER });
  assert.equal(disputed.inspection, 'disputed');
  const resumed = run(disputed, { type: 'DISPUTE_RESOLVED', operatorRole: 'support', basis: '판매자가 누락 문서를 보완하기로 합의', decision: 'resume', mode: 'test', now: later(5) });
  assert.equal(resumed.inspection, 'in_progress'); assert.equal(resumed.payout, 'not_eligible');
  assert.equal(run(resumed, { type: 'BUYER_CONFIRMED', actorId: BUYER }).payout, 'eligible');
});
