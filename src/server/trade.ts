// 주문·결제·납품·검수·분쟁·환불·정산·대사.
// 상태 변경은 반드시 주문 행을 잠근 트랜잭션 안에서 src/domain/states.ts 의 reduce() 로만 한다.
import { db, one, all } from './db.ts';
import type { Q } from './db.ts';
import { AppError, audit, notify, str, int, needRole, hasRole, randomId, signToken, readToken, getSetting } from './util.ts';
import type { User } from './util.ts';
import * as vault from './vault.ts';
import { getProvider, ProviderError } from './providers/sim.ts';
import { loadPolicies } from './catalog.ts';
import { reduce, checkoutBlockers, checkDeliverables, downloadBlockers, RuleError } from '../domain/states.ts';
import type { OrderState, OrderEvent, PayoutContext } from '../domain/states.ts';
import { resolveFeePolicy, computeSettlement, payoutEntries, taxRecords, payoutKey, availableForPayout } from '../domain/ledger.ts';
import { config } from './config.ts';

export const DISPUTE_REASONS: Record<string, string> = {
  not_delivered: '결제 후 납품되지 않음', late: '납품 기한 초과', empty_or_wrong_file: '빈 파일·엉뚱한 파일', source_missing: '소스 제공 상품인데 소스 없음',
  file_missing: '필수 파일 누락', feature_mismatch: '설명과 주요 기능 불일치', env_failure: '약속한 환경에서 실행 불가', undisclosed_cost: '고지하지 않은 추가 비용',
  rights_infringement: '권리 침해 의심', other: '기타',
};
export const CHECKLIST: [string, string][] = [
  ['files', '계약상 파일이 모두 있다'], ['install', '설명서대로 설치된다'], ['features', '약속한 기능이 작동한다'], ['env', '합의한 환경에서 실행된다'],
  ['source', '제공하기로 한 소스가 포함되어 있다'], ['docs', '필요한 문서가 있다'], ['nocost', '고지하지 않은 유료 의존성이 없다'],
];

const fail = (e: any): never => { if (e instanceof RuleError) throw new AppError(e.message, 409, e.code); throw e; };

async function toState(t: Q, o: any): Promise<OrderState> {
  const pr = await one(t, "SELECT amount FROM refunds WHERE order_id=$1 AND status='processing'", [o.id]);
  const dp = await one(t, "SELECT post_settlement FROM disputes WHERE order_id=$1 AND status='open'", [o.id]);
  return { buyerId: o.buyer_id, sellerId: o.seller_id, amount: o.amount, refundedAmount: o.refunded_amount, inspectionDays: o.inspection_days,
    payment: o.payment_status, escrow: o.escrow_status, delivery: o.delivery_status, inspection: o.inspection_status, dispute: o.dispute_status,
    refund: o.refund_status, payout: o.payout_status, inspectionStartedAt: o.inspection_started_at, inspectionDueAt: o.inspection_due_at,
    accessUntil: o.access_until, pendingRefund: pr?.amount || 0, postSettlementDispute: !!dp?.post_settlement };
}
/** 주문 행을 잠그고 이벤트를 적용한다 */
async function apply(t: Q, orderId: number, ev: OrderEvent | ((o: any, s: OrderState) => OrderEvent)) {
  const o = await one(t, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
  if (!o) throw new AppError('주문을 찾을 수 없습니다', 404);
  const before = await toState(t, o);
  let r; try { r = reduce(before, typeof ev === 'function' ? ev(o, before) : ev); } catch (e) { fail(e); }
  const s = r!.state;
  if (r!.changed) {
    await t.query(`UPDATE orders SET payment_status=$2, escrow_status=$3, delivery_status=$4, inspection_status=$5, dispute_status=$6, refund_status=$7, payout_status=$8,
      refunded_amount=$9, inspection_started_at=$10, inspection_due_at=$11, access_until=$12 WHERE id=$1`,
      [orderId, s.payment, s.escrow, s.delivery, s.inspection, s.dispute, s.refund, s.payout, s.refundedAmount, s.inspectionStartedAt, s.inspectionDueAt, s.accessUntil]);
  }
  return { order: o, before, state: s, notices: r!.notices, changed: r!.changed };
}
const ledger = (t: Q, e: { orderId: number; kind: string; amount: number; ref: string; memo: string }) =>
  t.query('INSERT INTO ledger_entries(order_id, kind, amount, ref, memo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (ref) DO NOTHING', [e.orderId, e.kind, e.amount, e.ref, e.memo]);

// ── 주문 생성 ──
export async function createOrder(t: Q, f: { type: 'product' | 'milestone' | 'ip'; buyerId: number; sellerId: number; amount: number; method: string; category: string; snapshot: any;
  inspectionDays: number; productId?: number; optionId?: number; versionId?: number; milestoneId?: number; ipDealId?: number; companyId?: number | null }) {
  const provider = getProvider(); const caps = provider.capabilities();
  const blockers = checkoutBlockers(caps, f.inspectionDays, f.method);
  if (caps.mode === 'live') {
    for (const key of ['digital_goods', 'multi_seller', ...(f.type === 'milestone' ? ['staged_payments'] : [])]) {
      if (!(await one(t, "SELECT 1 FROM provider_capabilities WHERE provider=$1 AND key=$2 AND status='confirmed'", [caps.id, key]))) blockers.push(`결제 사업자 기능 확인 미완료: ${key}`);
    }
  }
  if (blockers.length) throw new AppError(`결제를 진행할 수 없습니다: ${blockers.join(' / ')}`, 409, 'CHECKOUT_BLOCKED');
  const seller = await one(t, 'SELECT * FROM sellers WHERE user_id=$1', [f.sellerId]);
  if (!seller || seller.status !== 'approved') throw new AppError('판매자가 판매 가능한 상태가 아닙니다');
  if (f.buyerId === f.sellerId) throw new AppError('자신의 상품은 구매할 수 없습니다');
  const policy = resolveFeePolicy(await loadPolicies(t), { sellerId: f.sellerId, category: f.category, now: new Date() });
  const o = await one(t, `INSERT INTO orders(order_no, order_type, buyer_id, seller_id, company_id, product_id, option_id, milestone_id, ip_deal_id, version_id, snapshot, terms_agreed_at,
      amount, pay_method, fee_policy, fee_bps, pg_fee_bps, pg_fee_bearer, seller_business_type, inspection_days)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, now(), $12,$13,$14::jsonb,$15,$16,$17,$18,$19) RETURNING id`,
    [`EM${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomId(4).toUpperCase()}`, f.type, f.buyerId, f.sellerId, f.companyId || null, f.productId || null, f.optionId || null,
      f.milestoneId || null, f.ipDealId || null, f.versionId || null, JSON.stringify({ ...f.snapshot, provider: { id: caps.id, mode: caps.mode, label: caps.label }, taxInvoiceIssuable: seller.tax_invoice_issuable }),
      f.amount, f.method, JSON.stringify(policy), policy.rateBps, caps.feeBps, policy.pgFeeBearer, seller.business_type, f.inspectionDays]);
  return o.id as number;
}

export async function checkout(user: User, input: { productId: number; method: string; agree: any; companyId?: number }) {
  if (!input.agree) throw new AppError('제공물·권리·검수 기준·환불 절차를 확인하고 동의해야 결제할 수 있습니다');
  const res = await db.tx(async (t) => {
    const p = await one(t, "SELECT * FROM products WHERE id=$1 AND status='on_sale'", [input.productId]);
    if (!p || !p.current_version_id) throw new AppError('판매 중인 상품이 아닙니다', 404);
    const v = await one(t, "SELECT * FROM file_versions WHERE id=$1 AND status='published'", [p.current_version_id]);
    if (!v) throw new AppError('납품 파일이 준비되지 않은 상품입니다');
    const opt = await one(t, 'SELECT * FROM product_options WHERE product_id=$1 AND active ORDER BY id LIMIT 1', [p.id]);
    const lic = await one(t, 'SELECT * FROM licenses WHERE id=$1', [opt.license_id]);
    const files = await all(t, 'SELECT id, kind, filename, size_bytes, sha256, scan_archive, scan_secret, scan_malware FROM files WHERE version_id=$1 ORDER BY id', [v.id]);
    const sellerName = (await one(t, 'SELECT display_name FROM sellers WHERE user_id=$1', [p.seller_id])).display_name;
    let needsApproval = false, companyId: number | null = null;
    if (input.companyId) {
      const m = await one(t, 'SELECT m.role, c.purchase_approval_required FROM company_members m JOIN companies c ON c.id=m.company_id WHERE m.company_id=$1 AND m.user_id=$2', [input.companyId, user.id]);
      if (!m || m.role === 'inspector') throw new AppError('이 기업의 구매 권한이 없습니다', 403);
      companyId = input.companyId; needsApproval = m.purchase_approval_required && m.role !== 'admin';
    }
    const snapshot: any = { sellerName, versionLabel: v.label, files, license: lic, optionName: opt.name };
    for (const k of ['title', 'kind', 'category', 'summary', 'problem', 'description', 'features', 'included', 'excluded', 'environment', 'install_method', 'has_source', 'install_support',
      'install_done_criteria', 'external_paid', 'external_costs', 'third_party', 'update_support', 'inspection_criteria', 'delivery_note', 'refund_policy', 'deliverables']) snapshot[k] = p[k];
    const orderId = await createOrder(t, { type: 'product', buyerId: user.id, sellerId: p.seller_id, amount: opt.price, method: input.method, category: p.category, snapshot,
      inspectionDays: p.inspection_days, productId: p.id, optionId: opt.id, versionId: v.id, companyId });
    if (needsApproval) await t.query('INSERT INTO purchase_approvals(order_id, company_id, requested_by) VALUES ($1,$2,$3)', [orderId, companyId, user.id]);
    return { orderId, needsApproval };
  });
  return res.needsApproval ? { ...res, providerPaymentId: null } : { ...res, providerPaymentId: await startPayment(res.orderId) };
}
export async function startPayment(orderId: number) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  const ex = await one(db, 'SELECT provider_payment_id FROM payments WHERE order_id=$1', [orderId]);
  if (ex) return ex.provider_payment_id as string;
  const pa = await one(db, 'SELECT status FROM purchase_approvals WHERE order_id=$1', [orderId]);
  if (pa && pa.status !== 'approved') throw new AppError('기업 구매 승인이 필요합니다');
  const provider = getProvider();
  const pay = await provider.createPayment({ orderNo: o.order_no, amount: o.amount, method: o.pay_method });
  await db.tx(async (t) => {
    await t.query('INSERT INTO payments(order_id, provider, provider_payment_id, amount, method) VALUES ($1,$2,$3,$4,$5)', [orderId, provider.capabilities().id, pay.providerPaymentId, o.amount, o.pay_method]);
    await apply(t, orderId, { type: 'CHECKOUT_STARTED' });
  });
  return pay.providerPaymentId;
}
export async function decidePurchase(user: User, orderId: number, approve: boolean, note: string) {
  const pa = await one(db, `SELECT pa.*, m.role FROM purchase_approvals pa JOIN company_members m ON m.company_id=pa.company_id AND m.user_id=$2 WHERE pa.order_id=$1 AND pa.status='pending'`, [orderId, user.id]);
  if (!pa || pa.role !== 'admin') throw new AppError('기업 관리자만 구매를 승인할 수 있습니다', 403);
  await db.query('UPDATE purchase_approvals SET status=$2, decided_by=$3, note=$4, decided_at=now() WHERE order_id=$1', [orderId, approve ? 'approved' : 'rejected', user.id, str(note)]);
  await notify(null, pa.requested_by, approve ? '구매 요청이 승인되었습니다. 결제를 진행하세요.' : `구매 요청이 반려되었습니다: ${str(note, 200)}`, `/orders/${orderId}`);
}

// ── 결제 확인 ──
/** 웹훅은 서명 검증과 중복 제거만 하고, 실제 판단은 사업자 조회 결과로 한다 */
export async function processWebhook(raw: string, signature: string) {
  const provider = getProvider();
  const evt = provider.verifyWebhook(raw, signature);
  const ins = await one(db, `INSERT INTO webhook_events(provider, event_id, type, payload, signature_ok) VALUES ($1,$2,$3,$4::jsonb,true) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [provider.capabilities().id, evt.id, evt.type, raw]);
  if (!ins) return { duplicate: true };
  try {
    if (evt.type.startsWith('payment.')) {
      const pay = await one(db, 'SELECT order_id FROM payments WHERE provider_payment_id=$1', [evt.data.paymentId]);
      if (pay) await syncPayment(pay.order_id);
    } else if (evt.type.startsWith('payout.')) {
      const po = await one(db, 'SELECT order_id FROM payouts WHERE idempotency_key=$1', [evt.data.payoutKey]);
      if (po) await syncPayout(po.order_id);
    }
    await db.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1', [ins.id]);
  } catch (e: any) { await db.query('UPDATE webhook_events SET error=$2 WHERE id=$1', [ins.id, String(e.message).slice(0, 500)]); throw e; }
  return { duplicate: false };
}
export async function syncPayment(orderId: number) {
  const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [orderId]);
  if (!pay) return;
  const provider = getProvider(); const caps = provider.capabilities();
  const ext = await provider.getPayment(pay.provider_payment_id);
  if (!ext) return;
  await db.query('UPDATE payments SET external_status=$2, external_refunded=$3, external_checked_at=now() WHERE id=$1', [pay.id, ext.status, ext.refunded]);
  if (ext.status === 'ready') return;
  const processing = await one(db, "SELECT id FROM refunds WHERE order_id=$1 AND status='processing'", [orderId]);
  if (processing) { await finalizeRefund(processing.id); return; }
  const externalStatus = ext.status === 'failed' ? 'failed' : ext.status === 'cancelled' ? 'cancelled' : 'paid';
  const r = await db.tx(async (t) => {
    const cur = await one(t, 'SELECT refund_status, payment_status FROM orders WHERE id=$1', [orderId]);
    if (externalStatus === 'cancelled' && cur.payment_status === 'cancelled') return null;
    const r = await apply(t, orderId, { type: 'PAYMENT_CONFIRMED', externalStatus, externalAmount: ext.amount, mode: caps.mode, escrowSupported: caps.maxHoldDays != null, now: new Date(), retentionDays: config.retentionDays });
    if (r.changed && r.state.payment === 'paid') {
      await t.query('UPDATE orders SET paid_at=now() WHERE id=$1', [orderId]);
      await ledger(t, { orderId, kind: 'payment_in', amount: r.order.amount, ref: `pay:${orderId}`, memo: '결제 확인' });
      await t.query("INSERT INTO escrow_records(order_id, provider, mode, event, external_ref, detail) VALUES ($1,$2,$3,'held',$4,$5)",
        [orderId, caps.id, caps.mode, pay.provider_payment_id, caps.mode === 'test' ? '테스트 시뮬레이션. 실제 대금 보호 아님' : '']);
      if (r.order.milestone_id) await t.query("UPDATE milestones SET status='in_progress' WHERE id=$1 AND status='awaiting_payment'", [r.order.milestone_id]);
      await notify(t, r.order.seller_id, `주문 ${r.order.order_no} 결제가 확인되었습니다.`, `/orders/${orderId}`);
    }
    if (r.changed && r.state.payment === 'failed') await audit(t, null, 'payment.rejected', 'order', orderId, r.notices.join(' '));
    return r;
  });
  const o = await one(db, 'SELECT order_type, payment_status, delivery_status FROM orders WHERE id=$1', [orderId]);
  if (o.order_type === 'product' && o.payment_status === 'paid' && ['not_ready', 'failed'].includes(o.delivery_status)) await grantDelivery(orderId);
  return r;
}

// ── 납품 ──
async function orderFiles(q: Q, o: any) {
  if (o.order_type === 'product') return all(q, 'SELECT * FROM files WHERE version_id=$1 ORDER BY id', [o.version_id]);
  return all(q, "SELECT f.* FROM files f WHERE f.version_id IN (SELECT version_id FROM deliveries WHERE order_id=$1 AND status='granted') ORDER BY f.id", [o.id]);
}
/** 결제가 확인된 주문의 납품물을 확인하고 접근을 연다. 문제가 있으면 열지 않고 검수 기간도 시작하지 않는다 */
export async function grantDelivery(orderId: number, versionId?: number) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  const vid = o.order_type === 'product' ? o.version_id : versionId;
  const files = await all(db, 'SELECT * FROM files WHERE version_id=$1', [vid]);
  const snapFiles = o.order_type === 'product' ? (o.snapshot.files || []).map((f: any) => ({ kind: f.kind, sha256: f.sha256 })) : files.map((f) => ({ kind: f.kind, sha256: f.sha256 }));
  const problems = checkDeliverables(o.snapshot.deliverables || [], snapFiles, files.map((f) => ({ kind: f.kind, sha256: f.sha256, sizeBytes: f.size_bytes, present: vault.present(f) })));
  if (!files.length) problems.push('납품 파일 없음');
  return db.tx(async (t) => {
    const r = await apply(t, orderId, { type: 'DELIVERY_CHECKED', problems, now: new Date() });
    if (!r.changed) return r.state.delivery === 'granted';
    await t.query('INSERT INTO deliveries(order_id, version_id, status, missing, detail) VALUES ($1,$2,$3,$4::jsonb,$5)', [orderId, vid, r.state.delivery, JSON.stringify(problems), r.notices.join(' ')]);
    await t.query('UPDATE orders SET delivery_detail=$2 WHERE id=$1', [orderId, problems.join(', ')]);
    if (r.state.delivery === 'granted') {
      await notify(t, o.buyer_id, `주문 ${o.order_no} 납품물을 받을 수 있습니다. 검수 기한은 ${o.inspection_days}일입니다.`, `/orders/${orderId}`);
    } else await audit(t, null, 'delivery.failed', 'order', orderId, problems.join(', '));
    return r.state.delivery === 'granted';
  });
}
async function assertParty(user: User, o: any) {
  if (user.id === o.buyer_id || user.id === o.seller_id || user.operator_role) return;
  if (o.company_id && await one(db, 'SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2', [o.company_id, user.id])) return;
  throw new AppError('이 주문을 볼 권한이 없습니다', 403);
}
/** 구매자 대신 행동할 수 있는가(기업 검수 담당자·관리자) */
async function actsAsBuyer(user: User, o: any) {
  if (user.id === o.buyer_id) return true;
  return !!(o.company_id && await one(db, "SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2 AND role IN ('admin','inspector')", [o.company_id, user.id]));
}
export async function getOrder(user: User, orderId: number) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!o) throw new AppError('주문을 찾을 수 없습니다', 404);
  await assertParty(user, o);
  return o;
}
/** 만료되는 서명 링크 발급(5분). 구매확정 여부는 조건이 아니다 */
export async function issueDownload(user: User, orderId: number, fileId: number) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!o) throw new AppError('주문을 찾을 수 없습니다', 404);
  const actor = (await actsAsBuyer(user, o)) ? { id: o.buyer_id } : { id: user.id };
  const blockers = downloadBlockers(actor, await toState(db, o), new Date());
  if (blockers.length) throw new AppError(blockers.join(' / '), 403);
  if (!(await orderFiles(db, o)).some((f) => f.id === fileId)) throw new AppError('이 주문의 납품 파일이 아닙니다', 403);
  return signToken({ o: orderId, f: fileId, u: user.id, exp: Date.now() + 5 * 60 * 1000 });
}
export async function openDownload(user: User | null, token: string, ip = '') {
  const tk = readToken(token);
  if (!tk || !user || tk.u !== user.id) throw new AppError('다운로드 링크가 만료되었거나 올바르지 않습니다', 403);
  await issueDownload(user, tk.o, tk.f); // 링크 발급 뒤 상태가 바뀌었을 수 있으므로 다시 확인
  const file = await one(db, 'SELECT * FROM files WHERE id=$1', [tk.f]);
  if (!vault.present(file)) throw new AppError('파일을 저장소에서 읽을 수 없습니다. 고객지원에 알려 주세요', 500);
  await db.query('INSERT INTO download_logs(order_id, file_id, user_id, ip, link_expires_at) VALUES ($1,$2,$3,$4,$5)', [tk.o, tk.f, user.id, ip, new Date(tk.exp)]);
  return { file, stream: vault.readStream(file) };
}

// ── 검수 ──
async function recordInspection(t: Q, orderId: number, userId: number, checklist: any, result: string, note: string) {
  const n = await one(t, 'SELECT count(*)::int AS n FROM inspections WHERE order_id=$1', [orderId]);
  await t.query('INSERT INTO inspections(order_id, round, inspector_id, checklist, result, note) VALUES ($1,$2,$3,$4::jsonb,$5,$6)', [orderId, n.n + 1, userId, JSON.stringify(checklist || {}), result, str(note)]);
}
async function afterAccepted(t: Q, o: any) {
  if (o.milestone_id) await t.query("UPDATE milestones SET status='accepted' WHERE id=$1", [o.milestone_id]);
  if (o.ip_deal_id) {
    const d = await one(t, "UPDATE ip_deals SET stage='completed' WHERE id=$1 RETURNING listing_id", [o.ip_deal_id]);
    await t.query("UPDATE ip_listings SET status=CASE WHEN is_exclusive OR right_type='copyright_transfer' THEN 'sold' ELSE 'listed' END, locked_by_deal_id=NULL WHERE id=$1", [d.listing_id]);
  }
}
export async function confirmOrder(user: User, orderId: number, checklist: any = {}) {
  const pre = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!pre) throw new AppError('주문을 찾을 수 없습니다', 404);
  const asBuyer = await actsAsBuyer(user, pre);
  if (pre.order_type === 'ip' && await one(db, 'SELECT 1 FROM ip_transfer_items WHERE deal_id=$1 AND buyer_confirmed_at IS NULL', [pre.ip_deal_id])) throw new AppError('인수 확인하지 않은 자산이 남아 있습니다');
  await db.tx(async (t) => {
    const r = await apply(t, orderId, (o) => ({ type: 'BUYER_CONFIRMED', actorId: asBuyer ? o.buyer_id : user.id }));
    if (!r.changed) return;
    await t.query('UPDATE orders SET confirmed_at=now() WHERE id=$1', [orderId]);
    await recordInspection(t, orderId, user.id, checklist, 'accepted', '');
    await afterAccepted(t, r.order);
    await notify(t, r.order.seller_id, `주문 ${r.order.order_no} 구매확정되었습니다. 정산 조건 확인 후 지급이 진행됩니다.`, `/orders/${orderId}`);
  });
}
export async function requestRevision(user: User, orderId: number, note: string) {
  if (str(note).length < 10) throw new AppError('수정이 필요한 내용을 계약 기준과 함께 10자 이상 적어 주세요');
  const pre = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!pre) throw new AppError('주문을 찾을 수 없습니다', 404);
  const asBuyer = await actsAsBuyer(user, pre);
  await db.tx(async (t) => {
    const r = await apply(t, orderId, (o) => ({ type: 'REVISION_REQUESTED', actorId: asBuyer ? o.buyer_id : user.id }));
    await recordInspection(t, orderId, user.id, {}, 'revision_requested', note);
    await notify(t, r.order.seller_id, `주문 ${r.order.order_no} 수정 요청이 있습니다. 계약 범위 밖이면 변경 계약으로 제안하세요.`, `/orders/${orderId}`);
  });
}
/** 판매자의 검수 종료 심사 요청: 기한이 지났는데 구매자가 확정도 문제 제기도 하지 않을 때 */
export async function requestClose(user: User, orderId: number, note: string) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1 AND seller_id=$2', [orderId, user.id]);
  if (!o) throw new AppError('주문을 찾을 수 없습니다', 404);
  if (o.inspection_status !== 'in_progress' || !o.inspection_due_at || new Date(o.inspection_due_at) > new Date()) throw new AppError('검수 기한이 지난 뒤에 요청할 수 있습니다');
  if (await one(db, "SELECT 1 FROM close_requests WHERE order_id=$1 AND status='open'", [orderId])) throw new AppError('이미 심사 요청 중입니다');
  await db.query('INSERT INTO close_requests(order_id, seller_id, note) VALUES ($1,$2,$3)', [orderId, user.id, str(note)]);
  await notify(null, o.buyer_id, `주문 ${o.order_no}: 판매자가 검수 종료 심사를 요청했습니다. 문제가 있으면 지금 제기해 주세요.`, `/orders/${orderId}`);
}
export async function decideClose(actor: User, requestId: number, approve: boolean, basis: string) {
  needRole(actor, 'support');
  if (!str(basis)) throw new AppError('결정 근거를 적어야 합니다');
  await db.tx(async (t) => {
    const cr = await one(t, "SELECT * FROM close_requests WHERE id=$1 AND status='open' FOR UPDATE", [requestId]);
    if (!cr) throw new AppError('처리할 요청이 없습니다');
    if (approve) { const r = await apply(t, cr.order_id, { type: 'ADMIN_CLOSED_INSPECTION', operatorRole: actor.operator_role!, basis }); await afterAccepted(t, r.order); }
    await t.query('UPDATE close_requests SET status=$2, decided_by=$3, decision_basis=$4, decided_at=now() WHERE id=$1', [requestId, approve ? 'approved' : 'rejected', actor.id, str(basis)]);
    await audit(t, actor, approve ? 'inspection.close.approve' : 'inspection.close.reject', 'order', cr.order_id, basis);
  });
}

// ── 분쟁 ──
export async function openDispute(user: User, orderId: number, input: { reason: string; description: string; wantsRefund?: any }) {
  if (!DISPUTE_REASONS[input.reason]) throw new AppError('문제 유형을 선택하세요');
  if (str(input.description).length < 20) throw new AppError('계약 기준과 비교해 무엇이 다른지 20자 이상 적어 주세요');
  const pre = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!pre) throw new AppError('주문을 찾을 수 없습니다', 404);
  const asBuyer = await actsAsBuyer(user, pre);
  const d = await db.tx(async (t) => {
    const r = await apply(t, orderId, (o) => ({ type: 'DISPUTE_OPENED', actorId: asBuyer ? o.buyer_id : user.id }));
    if (!r.changed) throw new AppError('이미 진행 중인 분쟁이 있습니다');
    const id = (await one(t, `INSERT INTO disputes(order_id, opened_by, reason, description, wants_refund, post_settlement, external_hold) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [orderId, user.id, input.reason, str(input.description), !!input.wantsRefund, r.state.postSettlementDispute, r.state.postSettlementDispute ? 'not_applicable' : 'not_requested'])).id;
    const other = user.id === r.order.seller_id ? r.order.buyer_id : r.order.seller_id;
    await notify(t, other, `주문 ${r.order.order_no}에 문제가 제기되었습니다. 자료를 제출해 주세요.`, `/orders/${orderId}`);
    await audit(t, user, 'dispute.open', 'order', orderId, input.reason);
    return { id, post: r.state.postSettlementDispute };
  });
  if (!d.post) {
    // 내부 보류와 별개로, 사업자에 실제 지급 보류를 요청하고 그 결과를 따로 기록한다
    const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [orderId]);
    let result: 'confirmed' | 'unsupported' | 'failed' = 'failed', detail = '';
    try { result = await getProvider().holdPayout(pay.provider_payment_id); } catch (e: any) { detail = String(e.message); }
    await db.tx(async (t) => {
      const r = await apply(t, orderId, { type: 'EXTERNAL_HOLD_RESULT', result });
      await t.query('UPDATE disputes SET external_hold=$2, external_hold_detail=$3 WHERE id=$1', [d.id, result, detail || r.notices.join(' ')]);
      await t.query('INSERT INTO escrow_records(order_id, provider, mode, event, detail) VALUES ($1,$2,$3,$4,$5)',
        [orderId, pay.provider, getProvider().capabilities().mode, result === 'confirmed' ? 'hold_confirmed' : result === 'unsupported' ? 'hold_unsupported' : 'hold_failed', detail]);
    });
  }
  return d.id as number;
}
export async function addDisputeEntry(user: User, disputeId: number, kind: string, body: string) {
  const d = await one(db, 'SELECT d.*, o.buyer_id, o.seller_id FROM disputes d JOIN orders o ON o.id=d.order_id WHERE d.id=$1', [disputeId]);
  if (!d) throw new AppError('분쟁을 찾을 수 없습니다', 404);
  const role = user.id === d.buyer_id ? 'buyer' : user.id === d.seller_id ? 'seller' : hasRole(user, 'support') ? 'operator' : null;
  if (!role) throw new AppError('권한이 없습니다', 403);
  if (!['statement', 'evidence', 'fix_offer', 'settlement_offer', 'appeal'].includes(kind) || !str(body)) throw new AppError('내용을 입력하세요');
  if (d.status !== 'open' && kind !== 'appeal') throw new AppError('종결된 분쟁에는 이의제기만 남길 수 있습니다');
  await db.query('INSERT INTO dispute_entries(dispute_id, author_id, role, kind, body) VALUES ($1,$2,$3,$4,$5)', [disputeId, user.id, role, kind, str(body)]);
}
export async function resolveDispute(actor: User, disputeId: number, input: { decision: string; basis: string; amount?: any }) {
  needRole(actor, 'support');
  const decision = input.decision as any;
  if (!['refund_full', 'refund_partial', 'resume', 'release', 'external_resolution'].includes(decision)) throw new AppError('결정 유형을 선택하세요');
  const mode = getProvider().capabilities().mode;
  const out = await db.tx(async (t) => {
    const d = await one(t, "SELECT * FROM disputes WHERE id=$1 AND status='open' FOR UPDATE", [disputeId]);
    if (!d) throw new AppError('진행 중인 분쟁이 아닙니다');
    const r = await apply(t, d.order_id, { type: 'DISPUTE_RESOLVED', operatorRole: actor.operator_role!, basis: str(input.basis), decision, mode, now: new Date() });
    let refundId: number | null = null, amount: number | null = null;
    if (decision === 'refund_full' || decision === 'refund_partial') {
      const remaining = r.order.amount - r.order.refunded_amount;
      amount = decision === 'refund_full' ? remaining : int(input.amount, 1, remaining - 1, '부분 환불 금액');
      refundId = (await one(t, 'INSERT INTO refunds(order_id, dispute_id, amount, status, idempotency_key, basis, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [d.order_id, disputeId, amount, r.state.refund === 'post_settlement_review' ? 'post_settlement_review' : 'approved', `refund-${randomId(10)}`, str(input.basis), actor.id])).id;
    }
    await t.query("UPDATE disputes SET status='resolved', decision=$2, decision_amount=$3, decision_basis=$4, decided_by=$5, decided_at=now(), appeal_until=now() + interval '7 days' WHERE id=$1",
      [disputeId, decision, amount, str(input.basis), actor.id]);
    const msg = `주문 ${r.order.order_no} 분쟁 결정: ${({ refund_full: '전액 환불', refund_partial: '부분 환불', resume: '거래 재개', release: '정산 진행', external_resolution: '외부 해결 절차 안내' } as any)[decision]}. 근거와 이의제기 방법(7일 이내)은 거래 작업실에서 확인하세요.`;
    await notify(t, r.order.buyer_id, msg, `/orders/${d.order_id}`); await notify(t, r.order.seller_id, msg, `/orders/${d.order_id}`);
    await audit(t, actor, 'dispute.resolve', 'dispute', disputeId, `${decision}: ${input.basis}`);
    return { orderId: d.order_id as number, refundId, executable: r.state.refund === 'requested', post: d.post_settlement };
  });
  if (!out.post && (decision === 'resume' || decision === 'release')) {
    const pay = await one(db, 'SELECT provider_payment_id FROM payments WHERE order_id=$1', [out.orderId]);
    await getProvider().releaseHold(pay.provider_payment_id);
  }
  if (out.refundId && out.executable) {
    const res = await executeRefund(out.refundId);
    // 부분 환불이 끝나 남은 금액을 정산할 수 있게 되면 사업자 보류도 푼다
    if (decision === 'refund_partial' && res.status === 'completed') {
      const pay = await one(db, 'SELECT provider_payment_id FROM payments WHERE order_id=$1', [out.orderId]);
      await getProvider().releaseHold(pay.provider_payment_id);
      await db.query("UPDATE orders SET escrow_status=$2 WHERE id=$1 AND escrow_status='dispute_hold'", [out.orderId, mode === 'test' ? 'test_simulated' : 'held']);
    }
  }
  return out;
}

// ── 환불 ── 요청·처리 중·완료를 구분한다. 완료는 사업자의 결제 취소 성공을 확인한 뒤에만.
export async function adminRefund(actor: User, orderId: number, amountRaw: any, basis: string) {
  needRole(actor, 'settlement');
  if (!str(basis)) throw new AppError('환불 근거를 적어야 합니다');
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  const amount = int(amountRaw, 1, o.amount - o.refunded_amount, '환불 금액');
  const id = (await one(db, "INSERT INTO refunds(order_id, amount, status, idempotency_key, basis, approved_by) VALUES ($1,$2,'approved',$3,$4,$5) RETURNING id", [orderId, amount, `refund-${randomId(10)}`, str(basis), actor.id])).id;
  await audit(null, actor, 'refund.approve', 'order', orderId, `${amount}원: ${basis}`);
  return executeRefund(id);
}
export async function executeRefund(refundId: number) {
  const rf = await one(db, 'SELECT * FROM refunds WHERE id=$1', [refundId]);
  if (!rf || !['approved', 'failed'].includes(rf.status)) throw new AppError('실행할 수 없는 환불 상태입니다');
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [rf.order_id]);
  const provider = getProvider();
  let started;
  try {
    started = await db.tx(async (t) => {
      const r = await apply(t, rf.order_id, { type: 'REFUND_STARTED', amount: rf.amount, partialSupported: !!provider.capabilities().partialRefund[o.pay_method] });
      await t.query('UPDATE refunds SET status=$2 WHERE id=$1', [refundId, r.state.refund === 'post_settlement_review' ? 'post_settlement_review' : 'processing']);
      return r.state.refund;
    });
  } catch (e: any) {
    if (e.code === 'PARTIAL_REFUND_UNSUPPORTED') { await db.query("UPDATE refunds SET status='unsupported', failure=$2 WHERE id=$1", [refundId, e.message]); return { status: 'unsupported', message: e.message }; }
    throw e;
  }
  if (started === 'post_settlement_review') return { status: 'post_settlement_review' };
  const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [rf.order_id]);
  try { await provider.cancelPayment({ providerPaymentId: pay.provider_payment_id, amount: rf.amount, idempotencyKey: rf.idempotency_key }); }
  catch (e: any) {
    if (!(e instanceof ProviderError) || e.code !== 'TIMEOUT') {
      await db.tx(async (t) => { await apply(t, rf.order_id, { type: 'REFUND_FAILED' }); await t.query("UPDATE refunds SET status='failed', failure=$2 WHERE id=$1", [refundId, String(e.message).slice(0, 300)]); });
      return { status: 'failed', message: String(e.message) };
    } // 타임아웃이면 아래 조회로 실제 결과를 확인한다
  }
  return finalizeRefund(refundId);
}
export async function finalizeRefund(refundId: number) {
  const rf = await one(db, 'SELECT * FROM refunds WHERE id=$1', [refundId]);
  if (rf.status !== 'processing') return { status: rf.status };
  const ext = await getProvider().getRefundByKey(rf.idempotency_key);
  if (!ext || ext.status !== 'completed') return { status: 'processing' }; // 완료로 바꾸지 않는다
  return db.tx(async (t) => {
    const r = await apply(t, rf.order_id, { type: 'REFUND_CONFIRMED', amount: rf.amount });
    if (!r.changed) return { status: 'completed' };
    await t.query("UPDATE refunds SET status='completed', external_confirmed_at=now(), completed_at=now() WHERE id=$1", [refundId]);
    await ledger(t, { orderId: rf.order_id, kind: 'refund_out', amount: rf.amount, ref: `refund:${refundId}`, memo: '결제 취소 확인' });
    if (r.state.escrow === 'refunded') await t.query("INSERT INTO escrow_records(order_id, provider, mode, event) VALUES ($1,$2,$3,'refunded')", [rf.order_id, getProvider().capabilities().id, getProvider().capabilities().mode]);
    const limit = r.notices.join(' ');
    await notify(t, r.order.buyer_id, `주문 ${r.order.order_no} 환불 ${rf.amount.toLocaleString('ko-KR')}원이 완료되었습니다.${r.state.delivery === 'revoked' ? ' 추가 다운로드는 차단되며, 받은 파일의 이용을 종료하고 삭제해 주세요.' : ''}`, `/orders/${rf.order_id}`);
    await notify(t, r.order.seller_id, `주문 ${r.order.order_no} 환불이 완료되었습니다. ${limit}`, `/orders/${rf.order_id}`);
    return { status: 'completed', notices: r.notices };
  });
}

// ── 판매자 지급 ── 접수와 완료를 구분하고, 응답이 불명확하면 조회 후에만 재시도한다.
export async function settlementOf(o: any) {
  const seller = await one(db, 'SELECT * FROM sellers WHERE user_id=$1', [o.seller_id]);
  return { seller, s: computeSettlement({ amount: o.amount, refunded: o.refunded_amount, feeBps: o.fee_bps, pgFeeBps: o.pg_fee_bps, pgFeeBearer: o.pg_fee_bearer,
    businessType: o.seller_business_type, taxInvoiceIssuable: seller?.tax_invoice_issuable, withholdingBase: (await getSetting('withholding_base', 'net')) as any }) };
}
export async function requestPayout(actor: User, orderId: number) {
  needRole(actor, 'settlement');
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!o) throw new AppError('주문을 찾을 수 없습니다', 404);
  const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [orderId]);
  const provider = getProvider();
  const ext = pay ? await provider.getPayment(pay.provider_payment_id) : null;
  const balance = await provider.getBalance();
  const { seller, s } = await settlementOf(o);
  const externalPaymentMatches = !!ext && ['paid', 'partial_cancelled'].includes(ext.status) && ext.amount === o.amount && ext.refunded === o.refunded_amount;
  const po = await db.tx(async (t) => {
    const existing = await one(t, 'SELECT * FROM payouts WHERE order_id=$1 FOR UPDATE', [orderId]);
    const context: PayoutContext = { seller: { status: seller.status, payoutVerified: seller.payout_verified }, externalPaymentMatches, availableBalance: balance, netAmount: s.net,
      payoutExists: !!existing && existing.status !== 'failed' };
    await apply(t, orderId, { type: 'PAYOUT_REQUESTED', context });
    const entries = (await all(t, 'SELECT * FROM ledger_entries WHERE order_id=$1', [orderId])).map((e) => ({ orderId, kind: e.kind, amount: e.amount, ref: e.ref, memo: e.memo }));
    if (availableForPayout(entries) < s.base) throw new AppError('원장상 지급 가능 금액이 부족합니다(대사 필요)', 409);
    const attempt = existing ? existing.attempt + 1 : 1; const key = payoutKey(orderId, attempt);
    const cols = [o.seller_id, attempt, key, o.seller_business_type, s.base, s.feeSupply, s.feeVat, s.pgFee, s.sellerPgFee, s.withholdingIncomeTax, s.withholdingLocalTax, s.net, actor.id];
    if (existing) await t.query(`UPDATE payouts SET seller_id=$2, attempt=$3, idempotency_key=$4, seller_business_type=$5, base_amount=$6, fee_supply=$7, fee_vat=$8, pg_fee=$9, seller_pg_fee=$10,
      withholding_income_tax=$11, withholding_local_tax=$12, net_amount=$13, requested_by=$14, status='requested', failure='', requested_at=now(), provider_payout_id=NULL WHERE order_id=$1`, [orderId, ...cols]);
    else await t.query(`INSERT INTO payouts(order_id, seller_id, attempt, idempotency_key, seller_business_type, base_amount, fee_supply, fee_vat, pg_fee, seller_pg_fee, withholding_income_tax, withholding_local_tax, net_amount, requested_by, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'requested')`, [orderId, ...cols]);
    await audit(t, actor, 'payout.request', 'order', orderId, `${s.net}원`);
    return { key, net: s.net };
  });
  return sendPayout(orderId, po.key, pay.provider_payment_id, po.net);
}
async function sendPayout(orderId: number, key: string, providerPaymentId: string, net: number) {
  try {
    const res = await getProvider().createPayout({ idempotencyKey: key, providerPaymentId, amount: net });
    await db.query('UPDATE payouts SET provider_payout_id=$2 WHERE order_id=$1', [orderId, res.payoutId]);
    return { status: 'requested' }; // 접수. 완료는 사업자 확인 후
  } catch (e: any) {
    if (e instanceof ProviderError && e.code === 'TIMEOUT') {
      await db.tx(async (t) => { await apply(t, orderId, { type: 'PAYOUT_TIMEOUT' }); await t.query("UPDATE payouts SET status='unknown' WHERE order_id=$1", [orderId]); });
      return { status: 'unknown' };
    }
    await db.tx(async (t) => { await apply(t, orderId, { type: 'PAYOUT_LOOKUP', found: 'failed' }); await t.query("UPDATE payouts SET status='failed', failure=$2 WHERE order_id=$1", [orderId, String(e.message).slice(0, 300)]); });
    return { status: 'failed', message: String(e.message) };
  }
}
export async function syncPayout(orderId: number) {
  const po = await one(db, 'SELECT * FROM payouts WHERE order_id=$1', [orderId]);
  if (!po || !['requested', 'unknown'].includes(po.status)) return { status: po?.status };
  const ext = await getProvider().getPayoutByKey(po.idempotency_key);
  const found = !ext ? 'none' : ext.status === 'paid' ? 'paid' : ext.status === 'failed' ? 'failed' : 'accepted';
  const res = await db.tx(async (t) => {
    const r = await apply(t, orderId, { type: 'PAYOUT_LOOKUP', found: found as any });
    if (!r.changed) return { status: po.status, resend: false };
    if (r.state.payout === 'paid') {
      await t.query("UPDATE payouts SET status='paid', external_confirmed_at=now(), paid_at=now(), provider_payout_id=$2 WHERE order_id=$1", [orderId, ext!.payoutId]);
      const o = r.order;
      const s = { base: po.base_amount, feeSupply: po.fee_supply, feeVat: po.fee_vat, pgFee: po.pg_fee, sellerPgFee: po.seller_pg_fee, platformPgFee: po.pg_fee - po.seller_pg_fee,
        withholdingBaseAmount: po.withholding_income_tax ? po.base_amount - po.fee_supply - po.fee_vat - po.seller_pg_fee : 0, withholdingIncomeTax: po.withholding_income_tax, withholdingLocalTax: po.withholding_local_tax,
        net: po.net_amount, platformNetRevenue: po.fee_supply - (po.pg_fee - po.seller_pg_fee), feeDoc: (po.seller_business_type === 'individual' ? 'fee_receipt' : 'tax_invoice') as any,
        needsWithholdingStatement: po.withholding_income_tax > 0, sellerCanIssueTaxInvoice: false };
      for (const e of payoutEntries(orderId, po.attempt, s)) await ledger(t, e);
      for (const tr of taxRecords(s, new Date())) await t.query(`INSERT INTO tax_records(payout_id, seller_id, doc_type, period, supply_amount, vat_amount, gross_payment, income_tax, local_tax)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (payout_id, doc_type) DO NOTHING`, [po.id, po.seller_id, tr.docType, tr.period, tr.supplyAmount, tr.vatAmount, tr.grossPayment, tr.incomeTax, tr.localTax]);
      await t.query("INSERT INTO escrow_records(order_id, provider, mode, event, external_ref) VALUES ($1,$2,$3,'released',$4)", [orderId, getProvider().capabilities().id, getProvider().capabilities().mode, ext!.payoutId]);
      await notify(t, o.seller_id, `주문 ${o.order_no} 정산금 ${po.net_amount.toLocaleString('ko-KR')}원 지급이 완료되었습니다.`, '/seller');
    } else await t.query('UPDATE payouts SET status=$2 WHERE order_id=$1', [orderId, r.state.payout === 'failed' ? 'failed' : 'requested']);
    return { status: r.state.payout, resend: found === 'none' };
  });
  if (res.resend) { // 사업자에 접수 기록이 없을 때만 같은 멱등성 키로 다시 요청
    const pay = await one(db, 'SELECT provider_payment_id FROM payments WHERE order_id=$1', [orderId]);
    return sendPayout(orderId, po.idempotency_key, pay.provider_payment_id, po.net_amount);
  }
  return res;
}

// ── 대사: 내부 상태와 사업자 상태의 불일치 탐지 ──
export async function reconcile(actor: User | null) {
  if (actor) needRole(actor, 'settlement');
  const provider = getProvider();
  const run = (await one(db, 'INSERT INTO recon_runs(provider) VALUES ($1) RETURNING id', [provider.capabilities().id])).id;
  const expect: Record<string, string[]> = { unpaid: ['ready'], pending: ['ready'], paid: ['paid'], partially_refunded: ['partial_cancelled'], cancelled: ['cancelled'], failed: ['failed', 'ready', 'paid'] };
  let checked = 0, bad = 0;
  const miss = async (orderId: number, kind: string, i: any, e: any) => { bad++; await db.query('INSERT INTO recon_mismatches(run_id, order_id, kind, internal_value, external_value) VALUES ($1,$2,$3,$4,$5)', [run, orderId, kind, String(i), String(e)]); };
  for (const p of await all(db, 'SELECT p.*, o.payment_status, o.refunded_amount, o.amount AS order_amount FROM payments p JOIN orders o ON o.id=p.order_id')) {
    checked++;
    const ext = await provider.getPayment(p.provider_payment_id);
    if (!ext) { await miss(p.order_id, 'missing_external', p.payment_status, '없음'); continue; }
    if (!expect[p.payment_status].includes(ext.status)) await miss(p.order_id, 'payment_status', p.payment_status, ext.status);
    if (ext.amount !== p.order_amount) await miss(p.order_id, 'payment_amount', p.order_amount, ext.amount);
    if (ext.refunded !== p.refunded_amount) await miss(p.order_id, 'refund_amount', p.refunded_amount, ext.refunded);
  }
  for (const po of await all(db, 'SELECT * FROM payouts')) {
    checked++;
    const ext = await provider.getPayoutByKey(po.idempotency_key);
    const e = !ext ? '없음' : ext.status === 'accepted' ? 'requested' : ext.status;
    if (po.status === 'failed' && !ext) continue;
    if (e !== po.status) await miss(po.order_id, 'payout_status', po.status, e);
    else if (ext && ext.amount !== po.net_amount) await miss(po.order_id, 'payout_amount', po.net_amount, ext.amount);
  }
  await db.query('UPDATE recon_runs SET finished_at=now(), checked=$2, mismatched=$3 WHERE id=$1', [run, checked, bad]);
  if (actor) await audit(null, actor, 'recon.run', 'recon', run, `확인 ${checked}건, 불일치 ${bad}건`);
  return { run, checked, mismatched: bad };
}

// ── 주기 작업: 장애 복구와 기한 관리 ──
export async function runJobs() {
  const log: string[] = [];
  const safe = async (name: string, fn: () => Promise<any>) => { try { await fn(); } catch (e: any) { log.push(`${name}: ${e.message}`); } };
  for (const r of await all(db, "SELECT id FROM orders WHERE payment_status='pending' AND created_at < now() - interval '1 minute'")) await safe('결제 조회', () => syncPayment(r.id));
  for (const r of await all(db, "SELECT id FROM orders WHERE order_type='product' AND payment_status='paid' AND delivery_status IN ('not_ready','failed')")) await safe('납품 복구', () => grantDelivery(r.id));
  for (const r of await all(db, "SELECT id FROM refunds WHERE status='processing'")) await safe('환불 확인', async () => {
    const res = await finalizeRefund(r.id);
    if (res.status === 'processing') { const rf = await one(db, 'SELECT r.*, p.provider_payment_id FROM refunds r JOIN payments p ON p.order_id=r.order_id WHERE r.id=$1', [r.id]);
      await getProvider().cancelPayment({ providerPaymentId: rf.provider_payment_id, amount: rf.amount, idempotencyKey: rf.idempotency_key }).catch(() => {}); await finalizeRefund(r.id); }
  });
  for (const r of await all(db, "SELECT order_id FROM payouts WHERE status IN ('requested','unknown')")) await safe('지급 확인', () => syncPayout(r.order_id));
  // 검수 기한 알림(하루 전, 초과)
  for (const o of await all(db, `SELECT * FROM orders WHERE inspection_status='in_progress' AND dispute_status<>'open' AND inspection_due_at < now() + interval '1 day'`)) {
    const over = new Date(o.inspection_due_at) < new Date(); const tag = over ? `검수기한초과:${o.id}` : `검수기한임박:${o.id}`;
    if (await one(db, 'SELECT 1 FROM notifications WHERE link=$1', [`/orders/${o.id}#${tag}`])) continue;
    await notify(null, o.buyer_id, `주문 ${o.order_no} 검수 기한이 ${over ? '지났습니다' : '하루 남았습니다'}. 구매확정하거나 문제를 제기해 주세요.`, `/orders/${o.id}#${tag}`);
    if (over) await notify(null, o.seller_id, `주문 ${o.order_no} 검수 기한이 지났습니다. 검수 종료 심사를 요청할 수 있습니다.`, `/orders/${o.id}#${tag}`);
  }
  // 자동확정: 검토된 운영 정책으로 켜져 있고 사업자 정책과 충돌하지 않을 때만
  if ((await getSetting('auto_confirm', 'off')) === 'on') {
    const caps = getProvider().capabilities();
    for (const o of await all(db, "SELECT id, inspection_days FROM orders WHERE inspection_status='in_progress' AND dispute_status<>'open' AND inspection_due_at < now()")) {
      await safe('자동확정', () => db.tx(async (t) => {
        const r = await apply(t, o.id, { type: 'AUTO_CONFIRM', now: new Date(), policyEnabled: true, providerAllows: caps.autoConfirmDays == null || caps.autoConfirmDays >= o.inspection_days + 1 });
        if (r.changed) { await t.query('UPDATE orders SET confirmed_at=now() WHERE id=$1', [o.id]); await afterAccepted(t, r.order); await audit(t, null, 'inspection.auto_confirm', 'order', o.id); }
      }));
    }
  }
  return log;
}

// ── 메시지·후기 ──
export async function addMessage(user: User, target: { orderId?: number; productId?: number; contractId?: number }, body: string) {
  if (!str(body)) throw new AppError('내용을 입력하세요');
  let recipient: number | null = null;
  if (target.orderId) { const o = await getOrder(user, target.orderId); recipient = user.id === o.buyer_id ? o.seller_id : o.buyer_id; }
  else if (target.productId) { const p = await one(db, 'SELECT seller_id FROM products WHERE id=$1', [target.productId]); if (!p) throw new AppError('상품이 없습니다', 404); recipient = p.seller_id; }
  else if (target.contractId) { const c = await one(db, 'SELECT * FROM contracts WHERE id=$1', [target.contractId]); if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) throw new AppError('권한이 없습니다', 403); recipient = user.id === c.buyer_id ? c.seller_id : c.buyer_id; }
  await db.query('INSERT INTO messages(order_id, product_id, contract_id, sender_id, recipient_id, body) VALUES ($1,$2,$3,$4,$5,$6)', [target.orderId || null, target.productId || null, target.contractId || null, user.id, recipient, str(body, 4000)]);
  if (recipient && recipient !== user.id) await notify(null, recipient, '새 메시지가 있습니다.', target.orderId ? `/orders/${target.orderId}` : target.contractId ? `/contracts/${target.contractId}` : '/me');
}
/** 후기는 실제 구매를 마친 구매자만, 주문당 1건 */
export async function addReview(user: User, orderId: number, rating: any, body: string) {
  const o = await one(db, 'SELECT * FROM orders WHERE id=$1 AND buyer_id=$2', [orderId, user.id]);
  if (!o || !o.product_id) throw new AppError('후기를 쓸 수 있는 주문이 아닙니다', 403);
  if (!['confirmed', 'auto_confirmed', 'closed_by_admin'].includes(o.inspection_status) || o.payment_status === 'cancelled') throw new AppError('검수를 마친 구매만 후기를 쓸 수 있습니다');
  if (str(body).length < 10) throw new AppError('후기를 10자 이상 적어 주세요');
  await db.query('INSERT INTO reviews(order_id, product_id, buyer_id, rating, body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING', [orderId, o.product_id, user.id, int(rating, 1, 5, '평점'), str(body, 2000)]);
}
export { apply as applyOrderEvent };
