// 지식재산권 거래: 공개 소개와 비공개 자료실 분리, 비밀유지 동의, 독점 잠금, 자산 인도 확인
import crypto from 'node:crypto';
import { db, one, all } from './db.ts';
import { AppError, audit, notify, str, int, needRole } from './util.ts';
import type { User } from './util.ts';
import * as vault from './vault.ts';
import { createOrder, startPayment, applyOrderEvent } from './trade.ts';

export const RIGHT_TYPES: Record<string, string> = { copyright_transfer: '저작재산권 양도', exclusive_license: '독점 이용허락', nonexclusive_license: '비독점 이용허락', other_consult: '기타 권리 거래 상담', business_asset_consult: '소프트웨어 사업 자산 양도 상담' };
export const ASSET_TYPES: Record<string, string> = { source_repo: '소스 저장소', source_snapshot: '소스 스냅샷', build_docs: '빌드·배포 문서', design_source: '디자인 원본', domain: '도메인', service_asset: '이전 가능한 서비스 자산', contract_docs: '관련 계약·권리 자료', other: '기타' };
export const STAGES: Record<string, string> = { consult: '상담', nda: '비밀유지 합의', data_room: '자료 열람', due_diligence: '권리·기술 확인', terms: '거래 조건 확정', contract_payment: '계약·결제', asset_transfer: '자산 인도', rights_transfer_check: '권리 이전 확인', completed: '완료', cancelled: '취소' };
export const NDA_TEXT = '열람자는 비공개 자료실에서 확인한 소스코드, 문서, 영업 정보를 거래 검토 목적으로만 사용하고, 제3자에게 공개·복제·전달하지 않으며, 거래가 성사되지 않으면 보유한 사본을 삭제한다. (법률 검토 전 초안)';
const ndaHash = () => crypto.createHash('sha256').update(NDA_TEXT).digest('hex');

export async function saveListing(user: User, id: number | null, f: any) {
  if (!(await one(db, "SELECT 1 FROM sellers WHERE user_id=$1 AND status='approved'", [user.id]))) throw new AppError('승인된 판매자만 등록할 수 있습니다');
  const rt = str(f.right_type); if (!RIGHT_TYPES[rt]) throw new AppError('권리 종류를 선택하세요');
  for (const k of ['title', 'right_holder', 'seller_authority', 'scope']) if (!str(f[k])) throw new AppError('제목, 권리자, 판매 권한의 근거, 양도·이용허락 범위는 반드시 적어야 합니다');
  const vals = [str(f.title, 120), str(f.public_intro, 5000), rt, str(f.subject), str(f.right_holder), str(f.seller_authority), str(f.co_owners), str(f.scope), rt === 'copyright_transfer' || rt === 'exclusive_license' || f.is_exclusive === 'on',
    str(f.term), str(f.territory), str(f.field_of_use), str(f.existing_licenses), str(f.third_party), str(f.included_assets), str(f.excluded_assets), f.asking_price ? int(f.asking_price, 0, 1e12, '희망 금액') : null];
  const cols = ['title', 'public_intro', 'right_type', 'subject', 'right_holder', 'seller_authority', 'co_owners', 'scope', 'is_exclusive', 'term', 'territory', 'field_of_use', 'existing_licenses', 'third_party', 'included_assets', 'excluded_assets', 'asking_price'];
  if (id) {
    const r = await one(db, `UPDATE ip_listings SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(', ')}, status=CASE WHEN status='listed' THEN 'pending_review' ELSE status END WHERE id=$1 AND seller_id=$2 AND status IN ('draft','pending_review','listed') RETURNING id`, [id, user.id, ...vals]);
    if (!r) throw new AppError('수정할 수 없는 상태입니다');
    return id;
  }
  return (await one(db, `INSERT INTO ip_listings(seller_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`, [user.id, ...vals])).id as number;
}
export async function submitListing(user: User, id: number) {
  if (!(await one(db, "UPDATE ip_listings SET status='pending_review' WHERE id=$1 AND seller_id=$2 AND status='draft' RETURNING id", [id, user.id]))) throw new AppError('제출할 수 없는 상태입니다');
}
/** 심사는 등록 항목과 증빙 자료의 제출 여부를 확인하는 것이며, 권리의 진위를 보증하지 않는다 */
export async function reviewListing(actor: User, id: number, approve: boolean, note: string) {
  needRole(actor, 'review');
  const l = await one(db, "UPDATE ip_listings SET status=$2 WHERE id=$1 AND status='pending_review' RETURNING seller_id, title", [id, approve ? 'listed' : 'draft']);
  if (!l) throw new AppError('심사 대기 상태가 아닙니다');
  await audit(null, actor, approve ? 'ip.approve' : 'ip.reject', 'ip_listing', id, note);
  await notify(null, l.seller_id, approve ? `"${l.title}" 등록이 승인되었습니다.` : `"${l.title}" 등록이 반려되었습니다: ${str(note, 200)}`, `/ip/${id}`);
}

// ── 비공개 자료실 ──
export async function requestAccess(user: User, listingId: number, agree: any) {
  if (!agree) throw new AppError('비밀유지 조건에 동의해야 열람을 요청할 수 있습니다');
  const l = await one(db, "SELECT * FROM ip_listings WHERE id=$1 AND status IN ('listed','locked')", [listingId]);
  if (!l) throw new AppError('열람을 요청할 수 없는 자산입니다');
  await db.query('INSERT INTO ip_access_grants(listing_id, user_id, nda_text_sha256, nda_agreed_at) VALUES ($1,$2,$3, now()) ON CONFLICT (listing_id, user_id) DO NOTHING', [listingId, user.id, ndaHash()]);
  await notify(null, l.seller_id, `"${l.title}" 비공개 자료 열람 요청이 있습니다.`, `/ip/${listingId}`);
}
export async function decideAccess(user: User, grantId: number, approve: boolean) {
  const g = await one(db, 'SELECT g.*, l.seller_id FROM ip_access_grants g JOIN ip_listings l ON l.id=g.listing_id WHERE g.id=$1', [grantId]);
  if (!g || g.seller_id !== user.id) throw new AppError('권한이 없습니다', 403);
  if (approve) await db.query('UPDATE ip_access_grants SET approved_by=$2, approved_at=now(), revoked_at=NULL WHERE id=$1', [grantId, user.id]);
  else await db.query('UPDATE ip_access_grants SET revoked_at=now() WHERE id=$1', [grantId]);
  await audit(null, user, approve ? 'ip.access.approve' : 'ip.access.revoke', 'ip_listing', g.listing_id, `user ${g.user_id}`);
  await notify(null, g.user_id, approve ? '비공개 자료 열람이 승인되었습니다.' : '비공개 자료 열람 권한이 회수되었습니다.', `/ip/${g.listing_id}`);
}
export async function canViewRoom(user: User | null, listing: any) {
  if (!user) return false;
  if (user.id === listing.seller_id) return true;
  return !!(await one(db, 'SELECT 1 FROM ip_access_grants WHERE listing_id=$1 AND user_id=$2 AND approved_at IS NOT NULL AND revoked_at IS NULL', [listing.id, user.id]));
}
export async function roomFiles(listingId: number) {
  return all(db, "SELECT f.id, f.kind, f.filename, f.size_bytes, f.sha256, f.scan_malware, v.label FROM files f JOIN file_versions v ON v.id=f.version_id WHERE v.ip_listing_id=$1 ORDER BY f.id", [listingId]);
}
export async function openRoomFile(user: User | null, fileId: number) {
  const f = await one(db, 'SELECT f.*, v.ip_listing_id FROM files f JOIN file_versions v ON v.id=f.version_id WHERE f.id=$1 AND v.ip_listing_id IS NOT NULL', [fileId]);
  const l = f && await one(db, 'SELECT * FROM ip_listings WHERE id=$1', [f.ip_listing_id]);
  if (!l || !(await canViewRoom(user, l))) throw new AppError('승인받은 사람만 열람할 수 있습니다', 403);
  await db.query('INSERT INTO ip_room_views(listing_id, file_id, user_id) VALUES ($1,$2,$3)', [l.id, fileId, user!.id]);
  return { file: f, stream: vault.readStream(f) };
}

// ── 거래 ──
async function dealOf(user: User, dealId: number, lock?: any) {
  const d = await one(lock || db, `SELECT d.*, l.seller_id, l.title, l.is_exclusive, l.right_type, l.locked_by_deal_id, l.status AS lstatus FROM ip_deals d JOIN ip_listings l ON l.id=d.listing_id WHERE d.id=$1`, [dealId]);
  if (!d || (![d.buyer_id, d.seller_id].includes(user.id) && !user.operator_role)) throw new AppError('거래를 볼 권한이 없습니다', 403);
  return d;
}
export const getDeal = (user: User, id: number) => dealOf(user, id);
export async function startDeal(user: User, listingId: number) {
  const l = await one(db, "SELECT * FROM ip_listings WHERE id=$1 AND status='listed'", [listingId]);
  if (!l) throw new AppError(listingId ? '지금은 상담을 시작할 수 없는 자산입니다(다른 거래가 진행 중일 수 있습니다)' : '자산이 없습니다');
  if (l.seller_id === user.id) throw new AppError('자신의 자산입니다');
  const ex = await one(db, "SELECT id FROM ip_deals WHERE listing_id=$1 AND buyer_id=$2 AND stage NOT IN ('completed','cancelled')", [listingId, user.id]);
  if (ex) return ex.id as number;
  const id = (await one(db, 'INSERT INTO ip_deals(listing_id, buyer_id) VALUES ($1,$2) RETURNING id', [listingId, user.id])).id;
  await notify(null, l.seller_id, `"${l.title}" 거래 상담 요청이 있습니다.`, `/ip/deals/${id}`);
  return id as number;
}
/** 판매자가 거래 조건을 제시한다. 계약서는 법률 검토 전까지 초안이다 */
export async function proposeDealTerms(user: User, dealId: number, f: any) {
  const d = await dealOf(user, dealId);
  if (user.id !== d.seller_id) throw new AppError('판매자만 조건을 제시할 수 있습니다', 403);
  if (!['consult', 'nda', 'data_room', 'due_diligence', 'terms'].includes(d.stage)) throw new AppError('조건을 바꿀 수 없는 단계입니다');
  const amount = int(f.amount, 10000, 1e12, '거래 금액'); if (str(f.terms).length < 30) throw new AppError('거래 조건을 30자 이상 적어 주세요');
  await db.tx(async (t) => {
    const l = await one(t, 'SELECT * FROM ip_listings WHERE id=$1', [d.listing_id]);
    const terms = { title: l.title, rightType: l.right_type, scope: l.scope, isExclusive: l.is_exclusive, term: l.term, territory: l.territory, fieldOfUse: l.field_of_use, existingLicenses: l.existing_licenses,
      includedAssets: l.included_assets, excludedAssets: l.excluded_assets, amount, text: str(f.terms, 20000) };
    let cid = d.contract_id;
    if (!cid) cid = (await one(t, 'INSERT INTO contracts(buyer_id, seller_id, current_version_no) VALUES ($1,$2,0) RETURNING id', [d.buyer_id, d.seller_id])).id;
    const c = await one(t, 'SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [cid]);
    if (c.status !== 'negotiating') throw new AppError('이미 확정된 계약입니다');
    await t.query('INSERT INTO contract_versions(contract_id, version_no, terms, seller_agreed_at, created_by) VALUES ($1,$2,$3::jsonb, now(), $4)', [cid, c.current_version_no + 1, JSON.stringify(terms), user.id]);
    await t.query('UPDATE contracts SET current_version_no=current_version_no+1 WHERE id=$1', [cid]);
    await t.query("UPDATE ip_deals SET contract_id=$2, amount=$3, terms=$4, extra_verification=$5, stage='terms' WHERE id=$1", [dealId, cid, amount, str(f.terms, 20000), f.extra_verification === 'on']);
    await notify(t, d.buyer_id, `"${d.title}" 거래 조건이 제시되었습니다.`, `/ip/deals/${dealId}`);
  });
}
/** 계약 동의가 끝난 뒤 결제. 독점 거래는 이 시점에 잠가 중복 판매를 막는다 */
export async function payDeal(user: User, dealId: number, method: string, agree: any) {
  if (!agree) throw new AppError('계약 조건과 권리 이전 절차 안내를 확인하고 동의해야 합니다');
  const orderId = await db.tx(async (t) => {
    const d = await dealOf(user, dealId, t);
    if (user.id !== d.buyer_id) throw new AppError('구매자만 결제할 수 있습니다', 403);
    const ex = await one(t, 'SELECT id FROM orders WHERE ip_deal_id=$1', [dealId]); if (ex) return ex.id as number;
    const c = d.contract_id && await one(t, 'SELECT * FROM contracts WHERE id=$1', [d.contract_id]);
    if (!c || c.status !== 'active') throw new AppError('양측이 계약 조건에 동의한 뒤에 결제할 수 있습니다');
    const l = await one(t, 'SELECT * FROM ip_listings WHERE id=$1 FOR UPDATE', [d.listing_id]);
    if (l.is_exclusive) {
      if (l.locked_by_deal_id && l.locked_by_deal_id !== dealId) throw new AppError('다른 독점 거래가 진행 중이어서 결제할 수 없습니다', 409);
      if (l.status !== 'listed' && l.locked_by_deal_id !== dealId) throw new AppError('판매 가능한 상태가 아닙니다', 409);
      await t.query("UPDATE ip_listings SET locked_by_deal_id=$2, status='locked' WHERE id=$1", [l.id, dealId]);
    }
    const v = await one(t, 'SELECT * FROM contract_versions WHERE contract_id=$1 AND version_no=$2', [c.id, c.current_version_no]);
    const sellerName = (await one(t, 'SELECT display_name FROM sellers WHERE user_id=$1', [d.seller_id])).display_name;
    const id = await createOrder(t, { type: 'ip', buyerId: d.buyer_id, sellerId: d.seller_id, amount: d.amount, method, category: 'ip', inspectionDays: 14, ipDealId: dealId,
      snapshot: { title: `${l.title} — ${RIGHT_TYPES[l.right_type]}`, kind: 'ip', sellerName, contractId: c.id, contractVersion: v.version_no, contractDraft: v.is_draft, terms: v.terms, deliverables: [], files: [],
        included: l.included_assets, excluded: l.excluded_assets, inspection_criteria: '자산 인도 목록의 항목별 인수 확인과 권리 이전 절차 확인',
        refund_policy: '자산 인도 전: 계약 조건에 따른 환불. 인도 후: 이미 넘겨받은 자료는 회수할 수 없으므로 계약서의 해제 조항에 따름',
        license: { notes: '권리는 계약과 필요한 공식 이전 절차로 이전됩니다. 파일이나 계정 정보 전달만으로 이전이 완료되지 않습니다.' } } });
    await t.query("UPDATE ip_deals SET stage='contract_payment' WHERE id=$1", [dealId]);
    return id;
  });
  return { orderId, providerPaymentId: await startPayment(orderId) };
}
export async function addTransferItem(user: User, dealId: number, f: any) {
  const d = await dealOf(user, dealId);
  if (user.id !== d.seller_id) throw new AppError('판매자만 추가할 수 있습니다', 403);
  const type = str(f.asset_type); if (!ASSET_TYPES[type] || !str(f.description)) throw new AppError('자산 종류와 설명을 입력하세요');
  // 도메인·서비스 계정·앱 등록 자산은 제공자의 공식 이전 절차 증빙이 있어야 인수 확인이 된다
  await db.query('INSERT INTO ip_transfer_items(deal_id, asset_type, description, official_transfer_required) VALUES ($1,$2,$3,$4)', [dealId, type, str(f.description), ['domain', 'service_asset'].includes(type) || f.official === 'on']);
}
export async function markTransferItem(user: User, itemId: number, evidence: string) {
  const it = await one(db, 'SELECT i.*, l.seller_id FROM ip_transfer_items i JOIN ip_deals d ON d.id=i.deal_id JOIN ip_listings l ON l.id=d.listing_id WHERE i.id=$1', [itemId]);
  if (!it || it.seller_id !== user.id) throw new AppError('권한이 없습니다', 403);
  if (it.official_transfer_required && !str(evidence)) throw new AppError('이 자산은 제공자의 공식 이전 절차를 마친 증빙(이전 완료 통지 등)을 적어야 합니다. 비밀번호 전달만으로는 완료 처리되지 않습니다');
  await db.query('UPDATE ip_transfer_items SET seller_marked_at=now(), official_transfer_evidence=$2 WHERE id=$1', [itemId, str(evidence)]);
}
export async function confirmTransferItem(user: User, itemId: number) {
  const it = await one(db, 'SELECT i.*, d.buyer_id FROM ip_transfer_items i JOIN ip_deals d ON d.id=i.deal_id WHERE i.id=$1', [itemId]);
  if (!it || it.buyer_id !== user.id) throw new AppError('권한이 없습니다', 403);
  if (!it.seller_marked_at) throw new AppError('판매자가 아직 인도하지 않은 자산입니다');
  await db.query('UPDATE ip_transfer_items SET buyer_confirmed_at=now() WHERE id=$1', [itemId]);
}
/** 모든 자산을 인도했다고 판매자가 알리면 구매자의 인수 확인 기간이 시작된다 */
export async function completeTransfer(user: User, dealId: number) {
  const d = await dealOf(user, dealId);
  if (user.id !== d.seller_id) throw new AppError('판매자만 할 수 있습니다', 403);
  const o = await one(db, 'SELECT * FROM orders WHERE ip_deal_id=$1', [dealId]);
  if (!o || o.payment_status !== 'paid') throw new AppError('결제가 확인된 뒤에 자산을 인도할 수 있습니다');
  const items = await all(db, 'SELECT * FROM ip_transfer_items WHERE deal_id=$1', [dealId]);
  if (!items.length) throw new AppError('자산 인도 목록이 비어 있습니다');
  if (items.some((i) => !i.seller_marked_at)) throw new AppError('인도 표시를 하지 않은 자산이 있습니다');
  await db.tx(async (t) => {
    const r = await applyOrderEvent(t, o.id, { type: 'DELIVERY_CHECKED', problems: [], now: new Date() });
    if (r.changed) await t.query("INSERT INTO deliveries(order_id, status, detail) VALUES ($1,'granted','자산 인도 목록 전달')", [o.id]);
    await t.query("UPDATE ip_deals SET stage='rights_transfer_check' WHERE id=$1", [dealId]);
    await notify(t, d.buyer_id, `"${d.title}" 자산 인도가 통지되었습니다. 항목별로 인수 확인해 주세요.`, `/ip/deals/${dealId}`);
  });
}
export async function cancelDeal(user: User, dealId: number) {
  const d = await dealOf(user, dealId);
  const o = await one(db, 'SELECT payment_status FROM orders WHERE ip_deal_id=$1', [dealId]);
  if (o && ['paid', 'partially_refunded'].includes(o.payment_status)) throw new AppError('결제된 거래는 분쟁·환불 절차로 진행해야 합니다');
  await db.query("UPDATE ip_deals SET stage='cancelled' WHERE id=$1", [dealId]);
  await db.query("UPDATE ip_listings SET locked_by_deal_id=NULL, status='listed' WHERE id=$1 AND locked_by_deal_id=$2", [d.listing_id, dealId]);
}
