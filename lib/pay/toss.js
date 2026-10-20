/**
 * 토스페이먼츠 (결제창 v2)
 * 환경변수: TOSS_CLIENT_KEY (클라이언트 키), TOSS_SECRET_KEY (시크릿 키)
 * 테스트 키는 test_ 로 시작한다.
 * 문서: https://docs.tosspayments.com/reference
 */
const auth = () => 'Basic ' + Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64');

export const ready = () => !!(process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY);
export const isTest = () => String(process.env.TOSS_CLIENT_KEY || '').startsWith('test_');
export const clientKey = () => process.env.TOSS_CLIENT_KEY || '';

export async function confirm({ paymentKey, orderId, amount }) {
  const r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentKey, orderId, amount })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'DONE') return { ok: false, message: j.message || '결제 승인에 실패했습니다.', raw: j };
  if (j.totalAmount !== amount || j.orderId !== orderId) return { ok: false, message: '결제 금액이 일치하지 않습니다.', raw: j };
  return { ok: true, paymentKey: j.paymentKey, method: j.method || '', receiptUrl: (j.receipt && j.receipt.url) || '', raw: j };
}

export async function cancel({ paymentKey, amount, reason }) {
  const r = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/json', 'Idempotency-Key': `${paymentKey}-${amount}-${Date.now()}` },
    body: JSON.stringify({ cancelReason: reason || '고객 요청', cancelAmount: amount })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, message: j.message || '결제 취소에 실패했습니다.', raw: j };
  return { ok: true, raw: j };
}
