'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import * as auth from '../server/auth.ts';
import * as cat from '../server/catalog.ts';
import * as trade from '../server/trade.ts';
import * as custom from '../server/custom.ts';
import * as ip from '../server/ip.ts';
import * as company from '../server/company.ts';
import { simProvider } from '../server/providers/sim.ts';
import { config } from '../server/config.ts';
import { db, one } from '../server/db.ts';
import { AppError, needRole, setSetting, audit, str, int } from '../server/util.ts';

type H = (u: any, f: Record<string, any>, sid: string) => Promise<string | void>;
const num = (v: any) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new AppError('잘못된 요청입니다'); return n; };
const testOnly = () => { if (config.paymentProvider !== 'test') throw new AppError('테스트 결제 환경에서만 쓸 수 있습니다', 403); };
const stepped = (u: any) => { if (!u.stepup) throw new AppError('비밀번호를 다시 확인한 뒤 진행하세요'); };
const opStep = (u: any) => { if (!u.operator_role) throw new AppError('권한이 없습니다', 403); stepped(u); };

const A: Record<string, H> = {
  // 판매자
  seller_apply: (u, f) => cat.applySeller(u, f).then(() => '/seller?ok=' + encodeURIComponent('판매자 등록을 신청했습니다. 심사 후 판매할 수 있습니다')),
  payout_account: async (u, f) => { stepped(u); await cat.setPayoutAccount(u, f); },
  seller_withdraw: async (u) => { stepped(u); await cat.withdrawSeller(u); },
  product_save: async (u, f) => `/seller/products/${await cat.saveProduct(u, f.id ? num(f.id) : null, f)}?ok=` + encodeURIComponent('저장했습니다'),
  version_create: async (u, f) => { await cat.createVersion(u, { productId: f.product_id && num(f.product_id), milestoneId: f.milestone_id && num(f.milestone_id), ipListingId: f.ip_listing_id && num(f.ip_listing_id) }, f.label); },
  file_remove: (u, f) => cat.removeFile(u, num(f.id)),
  product_submit: (u, f) => cat.submitProduct(u, num(f.id)),
  wish: (u, f) => cat.toggleWish(u, num(f.id)),
  report: (u, f) => cat.createReport(u, f),
  // 주문
  checkout: async (u, f) => {
    const r = await trade.checkout(u, { productId: num(f.id), method: str(f.method), agree: f.agree, companyId: f.company_id ? num(f.company_id) : undefined });
    return r.needsApproval ? `/orders/${r.orderId}?ok=` + encodeURIComponent('기업 관리자의 구매 승인을 기다립니다') : `/pay/${r.providerPaymentId}`;
  },
  order_pay: async (u, f) => { const o = await trade.getOrder(u, num(f.id)); if (o.buyer_id !== u.id) throw new AppError('권한이 없습니다', 403); return `/pay/${await trade.startPayment(o.id)}`; },
  purchase_decide: (u, f) => trade.decidePurchase(u, num(f.id), f.approve === '1', f.note),
  sim_pay: async (u, f) => {
    testOnly();
    const pay = await one(db, 'SELECT p.order_id, o.buyer_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.provider_payment_id=$1', [str(f.ppid)]);
    if (!pay || pay.buyer_id !== u.id) throw new AppError('권한이 없습니다', 403);
    const evt = f.result === 'fail' ? await simProvider.sim.fail(str(f.ppid)) : await simProvider.sim.approve(str(f.ppid));
    const p = simProvider.sim.packet(evt); await trade.processWebhook(p.raw, p.signature); // 시뮬레이터가 보내는 웹훅(서명 검증을 그대로 거친다)
    return `/orders/${pay.order_id}`;
  },
  order_sync: async (u, f) => { await trade.getOrder(u, num(f.id)); await trade.syncPayment(num(f.id)); },
  confirm: (u, f) => trade.confirmOrder(u, num(f.id), Object.fromEntries(trade.CHECKLIST.map(([k]) => [k, f[`c_${k}`] === 'on']))),
  revision: (u, f) => trade.requestRevision(u, num(f.id), f.note),
  dispute_open: async (u, f) => { await trade.openDispute(u, num(f.id), { reason: str(f.reason), description: f.description, wantsRefund: f.wants_refund === 'on' }); },
  dispute_entry: (u, f) => trade.addDisputeEntry(u, num(f.id), str(f.kind), f.body),
  close_request: (u, f) => trade.requestClose(u, num(f.id), f.note),
  message: (u, f) => trade.addMessage(u, { orderId: f.order_id && num(f.order_id), productId: f.product_id && num(f.product_id), contractId: f.contract_id && num(f.contract_id) }, f.body),
  review: (u, f) => trade.addReview(u, num(f.id), f.rating, f.body),
  ticket: async (u, f) => { if (!str(f.subject) || !str(f.body)) throw new AppError('제목과 내용을 입력하세요'); await db.query('INSERT INTO support_tickets(user_id, subject, body) VALUES ($1,$2,$3)', [u.id, str(f.subject, 200), str(f.body)]); },
  ad_ticket: async (u, f) => { opStep(u); needRole(u, 'support'); const t = await one(db, "UPDATE support_tickets SET status='answered', assigned_to=$2 WHERE id=$1 RETURNING user_id, subject", [num(f.id), u.id]); if (t) await db.query('INSERT INTO notifications(user_id, body, link) VALUES ($1,$2,$3)', [t.user_id, `문의 "${t.subject}" 답변: ${str(f.answer, 1000)}`, '/support']); },
  notif_read: async (u) => { await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [u.id]); },
  // 맞춤 개발
  request_create: async (u, f) => `/requests/${await custom.createRequest(u, f)}`,
  quote_submit: async (u, f) => { await custom.submitQuote(u, num(f.id), f); },
  quote_accept: async (u, f) => `/contracts/${await custom.acceptQuote(u, num(f.id))}`,
  contract_agree: (u, f) => custom.agreeContract(u, num(f.id)),
  milestone_pay: async (u, f) => `/pay/${(await custom.payMilestone(u, num(f.id), str(f.method), f.agree)).providerPaymentId}`,
  milestone_deliver: (u, f) => custom.submitMilestoneDelivery(u, num(f.id), num(f.version_id)),
  change_propose: async (u, f) => { await custom.proposeChange(u, num(f.id), f); },
  change_decide: (u, f) => custom.decideChange(u, num(f.id), f.agree === '1'),
  // 지식재산권
  ip_save: async (u, f) => `/ip/${await ip.saveListing(u, f.id ? num(f.id) : null, f)}`,
  ip_submit: (u, f) => ip.submitListing(u, num(f.id)),
  ip_access: (u, f) => ip.requestAccess(u, num(f.id), f.agree),
  ip_access_decide: (u, f) => ip.decideAccess(u, num(f.id), f.approve === '1'),
  ip_deal_start: async (u, f) => `/ip/deals/${await ip.startDeal(u, num(f.id))}`,
  ip_terms: (u, f) => ip.proposeDealTerms(u, num(f.id), f),
  ip_pay: async (u, f) => `/pay/${(await ip.payDeal(u, num(f.id), str(f.method), f.agree)).providerPaymentId}`,
  ip_item_add: (u, f) => ip.addTransferItem(u, num(f.id), f),
  ip_item_mark: (u, f) => ip.markTransferItem(u, num(f.id), f.evidence),
  ip_item_confirm: (u, f) => ip.confirmTransferItem(u, num(f.id)),
  ip_transfer_done: (u, f) => ip.completeTransfer(u, num(f.id)),
  ip_cancel: (u, f) => ip.cancelDeal(u, num(f.id)),
  // 기업
  company_create: async (u, f) => { await company.createCompany(u, f.name, f.approval === 'on'); },
  company_member: (u, f) => company.setMember(u, num(f.id), f.email, str(f.role)),
  // 운영자(추가 인증 필요)
  ad_seller: async (u, f) => { opStep(u); await cat.adminSeller(u, num(f.id), str(f.do)); },
  ad_review: async (u, f) => { opStep(u); await cat.reviewProduct(u, num(f.id), f.approve === '1', f.note); },
  ad_ip_review: async (u, f) => { opStep(u); await ip.reviewListing(u, num(f.id), f.approve === '1', f.note); },
  ad_close: async (u, f) => { opStep(u); await trade.decideClose(u, num(f.id), f.approve === '1', f.basis); },
  ad_dispute: async (u, f) => { opStep(u); await trade.resolveDispute(u, num(f.id), { decision: str(f.decision), basis: f.basis, amount: f.amount }); },
  ad_refund: async (u, f) => { opStep(u); const r: any = await trade.adminRefund(u, num(f.id), f.amount, f.basis); if (r.status !== 'completed') throw new AppError(`환불이 완료되지 않았습니다(${r.status}). ${r.message || ''}`); },
  ad_refund_retry: async (u, f) => { opStep(u); needRole(u, 'settlement'); await trade.executeRefund(num(f.id)); },
  ad_payout: async (u, f) => { opStep(u); const r: any = await trade.requestPayout(u, num(f.id)); if (r.status === 'failed') throw new AppError(`지급 요청 실패: ${r.message}`); },
  ad_payout_sync: async (u, f) => { opStep(u); needRole(u, 'settlement'); await trade.syncPayout(num(f.id)); },
  ad_delivery_retry: async (u, f) => { opStep(u); needRole(u, 'support', 'settlement'); await trade.grantDelivery(num(f.id)); },
  ad_recon: async (u) => { opStep(u); const r = await trade.reconcile(u); return `/admin?tab=recon&ok=` + encodeURIComponent(`확인 ${r.checked}건, 불일치 ${r.mismatched}건`); },
  ad_jobs: async (u) => { opStep(u); const l = await trade.runJobs(); if (l.length) throw new AppError(l.join(' / ')); },
  ad_report: async (u, f) => { opStep(u); const s = await cat.handleReport(u, num(f.id), f.do === 'restrict' ? 'restrict' : 'dismiss', f.note); return `/admin?tab=queue&ok=` + encodeURIComponent(`처리했습니다. 같은 상품의 결제된 주문 ${s.length}건을 주문 탭에서 확인하세요`); },
  ad_fee: async (u, f) => {
    opStep(u); needRole(u, 'settlement');
    if (!['default', 'category', 'seller'].includes(f.scope)) throw new AppError('적용 범위를 선택하세요');
    await db.query('INSERT INTO fee_policies(scope, scope_ref, rate_bps, pg_fee_bearer, valid_from, valid_to, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [f.scope, f.scope === 'default' ? '' : str(f.scope_ref, 40), Math.round(Number(f.rate_percent) * 100), f.pg_fee_bearer === 'platform' ? 'platform' : 'seller', f.valid_from || null, f.valid_to || null, str(f.note, 200), u.id]);
    await audit(null, u, 'fee.policy.create', 'fee_policy', '', `${f.scope} ${f.rate_percent}%`);
  },
  ad_fee_off: async (u, f) => { opStep(u); needRole(u, 'settlement'); await db.query('UPDATE fee_policies SET active=false WHERE id=$1', [num(f.id)]); await audit(null, u, 'fee.policy.disable', 'fee_policy', f.id); },
  ad_setting: async (u, f) => {
    opStep(u); needRole(u, 'settlement');
    const allowed: Record<string, string[]> = { auto_confirm: ['on', 'off'], withholding_base: ['net', 'gross'] };
    if (!allowed[f.key]?.includes(f.value)) throw new AppError('설정 값이 올바르지 않습니다');
    await setSetting(f.key, f.value, u); await audit(null, u, 'setting.change', 'setting', f.key, f.value);
  },
  ad_cap: async (u, f) => {
    opStep(u); if (u.operator_role !== 'super') throw new AppError('최고관리자만 바꿀 수 있습니다', 403);
    if (!['unverified', 'confirmed', 'unsupported'].includes(f.status)) throw new AppError('상태 값이 올바르지 않습니다');
    if (f.status === 'confirmed' && !str(f.evidence)) throw new AppError('확인 근거(계약서·공식 문서)를 적어야 합니다');
    await db.query(`INSERT INTO provider_capabilities(provider, key, status, value, fallback, evidence, confirmed_by, confirmed_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
      ON CONFLICT (provider, key) DO UPDATE SET status=EXCLUDED.status, value=EXCLUDED.value, fallback=EXCLUDED.fallback, evidence=EXCLUDED.evidence, confirmed_by=EXCLUDED.confirmed_by, confirmed_at=now()`,
      [str(f.provider, 30), str(f.key, 40), f.status, str(f.value, 100), str(f.fallback, 300), str(f.evidence, 500), u.id]);
    await audit(null, u, 'capability.set', 'provider', `${f.provider}:${f.key}`, f.status);
  },
  ad_role: async (u, f) => { opStep(u); const t = await one(db, 'SELECT id FROM users WHERE email=$1', [str(f.email).toLowerCase()]); if (!t) throw new AppError('회원을 찾을 수 없습니다'); await auth.setOperatorRole(u, t.id, f.role || null); },
  ad_legal: async (u, f) => { opStep(u); await custom.markLegalReviewed(u, num(f.id)); },
  ad_sim_payout: async (u, f) => { opStep(u); testOnly(); needRole(u, 'settlement'); const p = simProvider.sim.packet(await simProvider.sim.completePayout(str(f.key))); await trade.processWebhook(p.raw, p.signature); },
};

const withMsg = (url: string, key: string, msg: string) => `${url.split('#')[0]}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg)}`;
const safeBack = (v: any) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v.replace(/[?&](ok|err)=[^&]*/g, '') : '/');

export async function run(fd: FormData) {
  const f: Record<string, any> = {};
  for (const [k, v] of fd.entries()) { if (typeof v !== 'string') continue; if (k in f) f[k] = [].concat(f[k], v as any); else f[k] = v; }
  const back = safeBack(f._back); const name = String(f._a || '');
  const jar = await cookies(); const sid = jar.get('sid')?.value || '';
  let to = back;
  try {
    if (name === 'login') {
      const s = await auth.login(f.email, f.password);
      jar.set('sid', s, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 14 * 86400 });
    } else if (name === 'register') {
      await auth.register(f as any);
      const s = await auth.login(f.email, f.password);
      jar.set('sid', s, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 14 * 86400 });
    } else if (name === 'logout') { if (sid) await auth.logout(sid); jar.delete('sid'); to = '/'; }
    else {
      const u = await auth.sessionUser(sid);
      if (!u) { to = `/login?back=${encodeURIComponent(back)}`; }
      else if (name === 'stepup') await auth.stepUp(sid, u.id, f.password);
      else { const h = A[name]; if (!h) throw new AppError('알 수 없는 요청입니다'); const r = await h(u, f, sid); if (typeof r === 'string') to = r; }
    }
  } catch (e: any) {
    if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    if (!(e instanceof AppError)) { console.error(`[action ${name}]`, e); to = withMsg(back, 'err', '처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 고객지원에 알려 주세요'); }
    else to = withMsg(name === 'login' ? `/login?back=${encodeURIComponent(back)}` : name === 'register' ? '/register' : back, 'err', e.message);
  }
  void headers; revalidatePath('/', 'layout');
  redirect(to);
}
