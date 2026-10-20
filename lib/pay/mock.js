/**
 * 테스트 결제: 실제 돈이 오가지 않는다. PG 계약 전 전체 흐름 확인용.
 * paymentKey 가 'mock_' 으로 시작하면 승인한다.
 */
export const ready = () => true;
export const isTest = () => true;
export const clientKey = () => '';

export async function confirm({ paymentKey, orderId, amount }) {
  if (!String(paymentKey).startsWith('mock_')) return { ok: false, message: '테스트 결제 키가 아닙니다.' };
  return { ok: true, paymentKey, method: '테스트 카드', receiptUrl: '', raw: { mock: true, orderId, amount, approvedAt: new Date().toISOString() } };
}

export async function cancel({ paymentKey, amount, reason }) {
  return { ok: true, raw: { mock: true, paymentKey, cancelAmount: amount, reason, canceledAt: new Date().toISOString() } };
}
