import fs from 'node:fs';
import { db, one, all } from './db.ts';
import type { Q } from './db.ts';
import { AppError, audit, notify, str, int, needRole, encryptText } from './util.ts';
import type { User } from './util.ts';
import * as vault from './vault.ts';
import { resolveFeePolicy, computeSettlement } from '../domain/ledger.ts';
import { getProvider } from './providers/sim.ts';

export const CATEGORIES: Record<string, string> = {
  erp: 'ERP·그룹웨어', construction: '건설·전기·통신', accounting: '회계·견적·발주·재고', docs: '문서·PDF·엑셀 자동화',
  commerce: '쇼핑몰·예약·고객관리', ai: 'AI 도구', mobile: '모바일 앱', edu: '교육·콘텐츠', devtools: '개발 도구·플러그인',
};
export const FILE_KINDS: Record<string, string> = {
  executable: '실행 파일', source: '소스코드', install_doc: '설치 설명서', deps: '의존성 목록', env_example: '환경변수 예시',
  db_schema: 'DB 스키마·마이그레이션', license_notice: '라이선스·오픈소스 고지', guide: '이용 안내', evidence: '증빙 자료', other: '기타',
};
export const BUSINESS_TYPES: Record<string, string> = { corporation: '법인', general_taxpayer: '일반과세자', simplified_taxpayer: '간이과세자', individual: '개인(비사업자)' };

export async function loadPolicies(q: Q) {
  return (await all(q, 'SELECT * FROM fee_policies')).map((r) => ({ id: r.id, scope: r.scope, scopeRef: r.scope_ref, rateBps: r.rate_bps, pgFeeBearer: r.pg_fee_bearer, validFrom: r.valid_from, validTo: r.valid_to, active: r.active }));
}
/** 판매 전 예상 정산액 */
export async function feePreview(sellerId: number, category: string, price: number) {
  const seller = await one(db, 'SELECT * FROM sellers WHERE user_id=$1', [sellerId]);
  const policy = resolveFeePolicy(await loadPolicies(db), { sellerId, category, now: new Date() });
  const s = computeSettlement({ amount: price, refunded: 0, feeBps: policy.rateBps, pgFeeBps: getProvider().capabilities().feeBps, pgFeeBearer: policy.pgFeeBearer,
    businessType: seller?.business_type || 'individual', taxInvoiceIssuable: seller?.tax_invoice_issuable });
  return { policy, settlement: s };
}

// ── 판매자 ──
export async function applySeller(user: User, input: any) {
  const name = str(input.display_name, 60); const bt = str(input.business_type);
  if (!name) throw new AppError('상점 이름을 입력하세요');
  if (!BUSINESS_TYPES[bt]) throw new AppError('사업자 유형을 선택하세요');
  const biz = str(input.biz_reg_no, 20).replace(/[^0-9]/g, '');
  if (bt !== 'individual' && biz.length !== 10) throw new AppError('사업자등록번호 10자리를 입력하세요');
  await db.query(`INSERT INTO sellers(user_id, display_name, intro, portfolio, business_type, biz_reg_no_enc, tax_invoice_issuable)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name, intro=EXCLUDED.intro, portfolio=EXCLUDED.portfolio,
    business_type=EXCLUDED.business_type, biz_reg_no_enc=EXCLUDED.biz_reg_no_enc, tax_invoice_issuable=EXCLUDED.tax_invoice_issuable`,
    [user.id, name, str(input.intro, 2000), str(input.portfolio, 4000), bt, biz ? encryptText(biz) : null, bt === 'simplified_taxpayer' ? !!input.tax_invoice_issuable : bt !== 'individual']);
  await audit(null, user, 'seller.apply', 'seller', user.id);
}
/** 정산 계좌 변경: 호출 전에 비밀번호 재확인을 거친다. 변경 후에는 운영자 확인 전까지 지급이 막힌다 */
export async function setPayoutAccount(user: User, input: any) {
  const bank = str(input.bank, 30), number = str(input.number, 30).replace(/[^0-9-]/g, ''), holder = str(input.holder, 40);
  if (!bank || number.length < 8 || !holder) throw new AppError('은행, 계좌번호, 예금주를 모두 입력하세요');
  const r = await one(db, `UPDATE sellers SET payout_account_enc=$2, payout_account_hint=$3, payout_verified=false, payout_account_changed_at=now() WHERE user_id=$1 RETURNING user_id`,
    [user.id, encryptText(JSON.stringify({ bank, number, holder })), `${bank} ****${number.slice(-4)}`]);
  if (!r) throw new AppError('판매자 등록을 먼저 하세요');
  await notify(null, user.id, '정산 계좌가 변경되었습니다. 본인이 변경하지 않았다면 즉시 고객지원에 알려 주세요. 운영자 확인 전까지 지급이 보류됩니다.', '/seller');
  await audit(null, user, 'seller.payout_account.change', 'seller', user.id);
}
export async function adminSeller(actor: User, sellerId: number, action: string) {
  needRole(actor, 'review', 'settlement');
  if (action === 'approve') await db.query("UPDATE sellers SET status='approved', identity_verified=true WHERE user_id=$1 AND status IN ('pending','suspended')", [sellerId]);
  else if (action === 'suspend') { await db.query("UPDATE sellers SET status='suspended' WHERE user_id=$1", [sellerId]); await db.query("UPDATE products SET status='suspended' WHERE seller_id=$1 AND status='on_sale'", [sellerId]); }
  else if (action === 'verify_payout') { needRole(actor, 'settlement'); await db.query('UPDATE sellers SET payout_verified=true WHERE user_id=$1 AND payout_account_enc IS NOT NULL', [sellerId]); }
  else throw new AppError('알 수 없는 처리');
  await audit(null, actor, `seller.${action}`, 'seller', sellerId);
  await notify(null, sellerId, action === 'approve' ? '판매자 심사가 승인되었습니다.' : action === 'suspend' ? '판매자 계정이 정지되었습니다. 고객지원에 문의하세요.' : '정산 계좌 확인이 완료되었습니다.', '/seller');
}
/** 판매자 탈퇴: 신규 판매만 중단한다. 기존 주문의 납품물은 보관 정책 기간 동안 유지된다 */
export async function withdrawSeller(user: User) {
  const open = await one(db, "SELECT count(*)::int AS n FROM orders WHERE seller_id=$1 AND payment_status IN ('paid','partially_refunded') AND payout_status NOT IN ('paid','void')", [user.id]);
  await db.query("UPDATE sellers SET status='withdrawn' WHERE user_id=$1", [user.id]);
  await db.query("UPDATE products SET status='withdrawn' WHERE seller_id=$1", [user.id]);
  await audit(null, user, 'seller.withdraw', 'seller', user.id, `진행 중 거래 ${open.n}건`);
}

// ── 상품 ──
const bool = (v: any) => v === 'on' || v === 'true' || v === true;
export async function saveProduct(user: User, id: number | null, f: any) {
  const seller = await one(db, 'SELECT * FROM sellers WHERE user_id=$1', [user.id]);
  if (!seller || seller.status === 'withdrawn' || seller.status === 'suspended') throw new AppError('판매자 등록이 필요합니다');
  const kind = str(f.kind); const category = str(f.category); const title = str(f.title, 120);
  if (!['license', 'source'].includes(kind)) throw new AppError('거래 유형을 선택하세요');
  if (!CATEGORIES[category]) throw new AppError('분야를 선택하세요');
  if (title.length < 4) throw new AppError('상품명을 4자 이상 입력하세요');
  const price = int(f.price, 1000, 1_000_000_000, '가격');
  const inspectionDays = int(f.inspection_days || 7, 1, 60, '검수 기간');
  let deliverables: string[] = (Array.isArray(f.deliverables) ? f.deliverables : [f.deliverables]).filter((k: any) => FILE_KINDS[k]);
  const hasSource = kind === 'source' || bool(f.has_source);
  if (hasSource && !deliverables.includes('source')) deliverables.push('source');
  if (!deliverables.length) throw new AppError('제공 파일 종류를 하나 이상 선택하세요');
  for (const k of ['inspection_criteria', 'refund_policy', 'included']) if (!str(f[k])) throw new AppError('포함 범위, 검수 기준, 환불·분쟁 절차는 반드시 적어야 합니다');
  if (bool(f.external_paid) && !str(f.external_costs)) throw new AppError('외부 유료 서비스가 필요하면 비용 내용을 적어야 합니다');
  const cols = ['kind', 'category', 'title', 'summary', 'problem', 'description', 'features', 'included', 'excluded', 'media_urls', 'demo_url', 'environment', 'install_method',
    'has_source', 'install_support', 'install_done_criteria', 'customizable', 'external_paid', 'external_costs', 'third_party', 'update_support', 'inspection_criteria',
    'inspection_days', 'delivery_note', 'refund_policy', 'deliverables'];
  const vals: any[] = [kind, category, title, str(f.summary, 200), str(f.problem), str(f.description, 20000), str(f.features), str(f.included), str(f.excluded), str(f.media_urls, 2000),
    /^https?:\/\//.test(str(f.demo_url)) ? str(f.demo_url, 500) : '', str(f.environment), str(f.install_method), hasSource, bool(f.install_support), str(f.install_done_criteria), bool(f.customizable),
    bool(f.external_paid), str(f.external_costs), str(f.third_party), str(f.update_support), str(f.inspection_criteria), inspectionDays, str(f.delivery_note), str(f.refund_policy), JSON.stringify(deliverables)];
  return db.tx(async (t) => {
    let pid = id;
    if (pid) {
      const p = await one(t, 'SELECT * FROM products WHERE id=$1 AND seller_id=$2 FOR UPDATE', [pid, user.id]);
      if (!p) throw new AppError('상품을 찾을 수 없습니다', 404);
      // 판매 중인 상품의 조건을 바꾸면 다시 심사를 받는다. 기존 주문은 주문 시점 스냅샷을 유지한다
      const status = p.status === 'on_sale' ? 'pending_review' : p.status === 'withdrawn' || p.status === 'suspended' ? p.status : p.status;
      await t.query(`UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 3}${c === 'deliverables' ? '::jsonb' : ''}`).join(', ')}, status=$2, updated_at=now() WHERE id=$1`, [pid, status, ...vals]);
    } else {
      pid = (await one(t, `INSERT INTO products(seller_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((c, i) => `$${i + 2}${c === 'deliverables' ? '::jsonb' : ''}`).join(', ')}) RETURNING id`, [user.id, ...vals])).id;
    }
    const lic = [str(f.license_term) === 'subscription' ? 'subscription' : 'perpetual', f.term_months ? int(f.term_months, 1, 120, '기간') : null, f.max_users ? int(f.max_users, 1, 100000, '사용자 수') : null,
      f.max_devices ? int(f.max_devices, 1, 100000, '기기 수') : null, bool(f.can_modify), bool(f.can_commercial), bool(f.can_redistribute), bool(f.can_resell), str(f.license_notes)];
    const ex = await one(t, 'SELECT id FROM licenses WHERE product_id=$1 ORDER BY id LIMIT 1', [pid]);
    let licId = ex?.id;
    if (licId) await t.query('UPDATE licenses SET term=$2, term_months=$3, max_users=$4, max_devices=$5, can_modify=$6, can_commercial=$7, can_redistribute=$8, can_resell=$9, notes=$10 WHERE id=$1', [licId, ...lic]);
    else licId = (await one(t, "INSERT INTO licenses(product_id, name, term, term_months, max_users, max_devices, can_modify, can_commercial, can_redistribute, can_resell, notes) VALUES ($1,'기본',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", [pid, ...lic])).id;
    const op = await one(t, 'SELECT id FROM product_options WHERE product_id=$1 ORDER BY id LIMIT 1', [pid]);
    if (op) await t.query('UPDATE product_options SET price=$2, includes_source=$3, includes_install=$4 WHERE id=$1', [op.id, price, hasSource, bool(f.install_support)]);
    else await t.query("INSERT INTO product_options(product_id, license_id, name, price, includes_source, includes_install) VALUES ($1,$2,'기본',$3,$4,$5)", [pid, licId, price, hasSource, bool(f.install_support)]);
    await audit(t, user, id ? 'product.update' : 'product.create', 'product', pid);
    return pid as number;
  });
}

async function versionOwner(q: Q, versionId: number) {
  return one(q, `SELECT v.*, COALESCE(p.seller_id, c.seller_id, l.seller_id) AS owner_id FROM file_versions v
    LEFT JOIN products p ON p.id=v.product_id LEFT JOIN milestones m ON m.id=v.milestone_id LEFT JOIN contracts c ON c.id=m.contract_id
    LEFT JOIN ip_listings l ON l.id=v.ip_listing_id WHERE v.id=$1`, [versionId]);
}
export async function createVersion(user: User, target: { productId?: number; milestoneId?: number; ipListingId?: number }, label: string) {
  const owner = target.productId ? await one(db, 'SELECT seller_id FROM products WHERE id=$1', [target.productId])
    : target.milestoneId ? await one(db, 'SELECT c.seller_id FROM milestones m JOIN contracts c ON c.id=m.contract_id WHERE m.id=$1', [target.milestoneId])
    : await one(db, 'SELECT seller_id FROM ip_listings WHERE id=$1', [target.ipListingId]);
  if (!owner || owner.seller_id !== user.id) throw new AppError('권한이 없습니다', 403);
  if (!str(label, 40)) throw new AppError('버전 이름을 입력하세요');
  return (await one(db, 'INSERT INTO file_versions(product_id, milestone_id, ip_listing_id, label, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [target.productId || null, target.milestoneId || null, target.ipListingId || null, str(label, 40), user.id])).id as number;
}
export async function addFile(user: User, versionId: number, kind: string, tmpPath: string, filename: string) {
  try {
    const v = await versionOwner(db, versionId);
    if (!v || v.owner_id !== user.id) throw new AppError('권한이 없습니다', 403);
    if (v.status !== 'draft') throw new AppError('심사에 제출했거나 공개된 버전의 파일은 바꿀 수 없습니다. 새 버전을 만드세요');
    if (!FILE_KINDS[kind]) throw new AppError('파일 종류를 선택하세요');
    const size = fs.statSync(tmpPath).size;
    if (size === 0) throw new AppError('빈 파일은 등록할 수 없습니다');
    const name = str(filename, 200).replace(/[\\/\x00-\x1f]/g, '_') || 'file';
    const scan = await vault.scan(tmpPath, name);
    const s = await vault.store(tmpPath);
    try {
      return (await one(db, `INSERT INTO files(version_id, kind, filename, size_bytes, sha256, storage_key, key_wrapped, scan_archive, scan_secret, scan_malware, scan_detail, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING id`, [versionId, kind, name, s.size, s.sha256, s.storageKey, s.keyWrapped, scan.archive, scan.secret, scan.malware, JSON.stringify(scan.detail), user.id])).id as number;
    } catch (e) { vault.remove(s.storageKey); throw e; }
  } finally { try { fs.unlinkSync(tmpPath); } catch { /* */ } }
}
export async function removeFile(user: User, fileId: number) {
  const f = await one(db, 'SELECT * FROM files WHERE id=$1', [fileId]);
  const v = f && await versionOwner(db, f.version_id);
  if (!v || v.owner_id !== user.id) throw new AppError('권한이 없습니다', 403);
  if (v.status !== 'draft') throw new AppError('심사에 제출했거나 공개된 버전의 파일은 삭제할 수 없습니다');
  await db.query('DELETE FROM files WHERE id=$1', [fileId]);
  vault.remove(f.storage_key);
}
/** 파일 묶음이 판매·납품에 쓸 수 있는 상태인지 */
export function fileProblems(files: any[], required: string[]) {
  const p: string[] = [];
  for (const k of required) if (!files.some((f) => f.kind === k)) p.push(`${FILE_KINDS[k] || k} 누락`);
  for (const f of files) {
    if ([f.scan_archive, f.scan_secret, f.scan_malware].includes('pending') || [f.scan_archive, f.scan_secret, f.scan_malware].includes('scanning')) p.push(`${f.filename}: 검사가 끝나지 않음`);
    if (f.scan_archive === 'flagged') p.push(`${f.filename}: 압축 파일 안전성 문제`);
    if (f.scan_secret === 'flagged') p.push(`${f.filename}: 비밀키·개인정보 의심 내용 포함`);
    if (f.scan_malware === 'flagged') p.push(`${f.filename}: 악성 파일 의심`);
  }
  return p;
}
export async function submitProduct(user: User, productId: number) {
  return db.tx(async (t) => {
    const p = await one(t, 'SELECT * FROM products WHERE id=$1 AND seller_id=$2 FOR UPDATE', [productId, user.id]);
    if (!p) throw new AppError('상품을 찾을 수 없습니다', 404);
    const seller = await one(t, 'SELECT * FROM sellers WHERE user_id=$1', [user.id]);
    if (seller.status !== 'approved') throw new AppError('판매자 심사가 승인된 뒤에 제출할 수 있습니다');
    const v = await one(t, "SELECT * FROM file_versions WHERE product_id=$1 AND status='draft' ORDER BY id DESC LIMIT 1", [productId]);
    if (!v && !p.current_version_id) throw new AppError('판매를 시작하려면 실제 납품 파일을 먼저 등록해야 합니다');
    if (v) {
      const files = await all(t, 'SELECT * FROM files WHERE version_id=$1', [v.id]);
      if (!files.length) throw new AppError('납품 파일이 없습니다');
      const problems = fileProblems(files, p.deliverables);
      if (problems.length) throw new AppError(`제출할 수 없습니다: ${problems.join(' / ')}`);
      await t.query("UPDATE file_versions SET status='submitted' WHERE id=$1", [v.id]);
    }
    if (p.status !== 'on_sale') await t.query("UPDATE products SET status='pending_review' WHERE id=$1", [productId]);
    await audit(t, user, 'product.submit', 'product', productId, v ? `버전 ${v.label}` : '조건 변경');
  });
}
export async function reviewProduct(actor: User, productId: number, approve: boolean, note: string) {
  needRole(actor, 'review');
  await db.tx(async (t) => {
    const p = await one(t, 'SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]);
    if (!p) throw new AppError('상품을 찾을 수 없습니다', 404);
    const v = await one(t, "SELECT * FROM file_versions WHERE product_id=$1 AND status='submitted' ORDER BY id DESC LIMIT 1", [productId]);
    if (approve) {
      let current = p.current_version_id;
      if (v) {
        if (current) await t.query("UPDATE file_versions SET status='retired' WHERE id=$1", [current]); // 기존 주문용 파일은 그대로 보관
        await t.query("UPDATE file_versions SET status='published', published_at=now(), review_note=$2 WHERE id=$1", [v.id, str(note)]);
        current = v.id;
      }
      if (!current) throw new AppError('공개할 납품 파일 버전이 없습니다');
      await t.query("UPDATE products SET status='on_sale', current_version_id=$2, review_note=$3 WHERE id=$1", [productId, current, str(note)]);
    } else {
      if (!str(note)) throw new AppError('반려 사유를 적어야 합니다');
      if (v) await t.query("UPDATE file_versions SET status='rejected', review_note=$2 WHERE id=$1", [v.id, str(note)]);
      await t.query('UPDATE products SET status=$2, review_note=$3 WHERE id=$1', [productId, p.current_version_id && v ? 'on_sale' : 'rejected', str(note)]);
    }
    await audit(t, actor, approve ? 'product.approve' : 'product.reject', 'product', productId, note);
    await notify(t, p.seller_id, approve ? `"${p.title}" 심사가 승인되어 판매가 시작되었습니다.` : `"${p.title}" 심사가 반려되었습니다: ${str(note, 200)}`, `/seller/products/${productId}`);
  });
}

const LIST_SQL = `SELECT p.id, p.kind, p.category, p.title, p.summary, p.has_source, p.install_support, p.customizable, p.external_paid, p.environment, p.status, p.seller_id,
  s.display_name AS seller_name, o.price, (SELECT round(avg(rating)::numeric,1) FROM reviews r WHERE r.product_id=p.id AND r.hidden_reason IS NULL) AS rating,
  (SELECT count(*)::int FROM reviews r WHERE r.product_id=p.id AND r.hidden_reason IS NULL) AS review_count
  FROM products p JOIN sellers s ON s.user_id=p.seller_id JOIN LATERAL (SELECT price FROM product_options WHERE product_id=p.id AND active ORDER BY id LIMIT 1) o ON true`;
export async function searchProducts(f: any) {
  const w = ["p.status='on_sale'"]; const a: any[] = [];
  const add = (sql: string, v: any) => { a.push(v); w.push(sql.replace('?', `$${a.length}`)); };
  if (['license', 'source'].includes(f.kind)) add('p.kind=?', f.kind);
  if (CATEGORIES[f.category]) add('p.category=?', f.category);
  if (str(f.q)) { a.push(`%${str(f.q, 60)}%`); w.push(`(p.title ILIKE $${a.length} OR p.summary ILIKE $${a.length} OR p.problem ILIKE $${a.length})`); }
  if (str(f.env)) add('p.environment ILIKE ?', `%${str(f.env, 40)}%`);
  if (Number(f.min) > 0) add('o.price >= ?', Number(f.min));
  if (Number(f.max) > 0) add('o.price <= ?', Number(f.max));
  if (f.source) w.push('p.has_source'); if (f.install) w.push('p.install_support'); if (f.custom) w.push('p.customizable'); if (f.noext) w.push('NOT p.external_paid');
  if (Number(f.seller) > 0) add('p.seller_id=?', Number(f.seller));
  const order = f.sort === 'price' ? 'o.price ASC' : f.sort === 'rating' ? 'rating DESC NULLS LAST' : 'p.id DESC';
  return all(db, `${LIST_SQL} WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT 60`, a);
}
export async function getProduct(id: number) {
  const p = await one(db, `SELECT p.*, s.display_name AS seller_name, s.status AS seller_status, s.business_type, s.tax_invoice_issuable FROM products p JOIN sellers s ON s.user_id=p.seller_id WHERE p.id=$1`, [id]);
  if (!p) return null;
  p.license = await one(db, 'SELECT * FROM licenses WHERE product_id=$1 ORDER BY id LIMIT 1', [id]);
  p.option = await one(db, 'SELECT * FROM product_options WHERE product_id=$1 ORDER BY id LIMIT 1', [id]);
  p.version = p.current_version_id ? await one(db, 'SELECT * FROM file_versions WHERE id=$1', [p.current_version_id]) : null;
  p.files = p.version ? await all(db, 'SELECT id, kind, filename, size_bytes, sha256, scan_archive, scan_secret, scan_malware, uploaded_at FROM files WHERE version_id=$1 ORDER BY id', [p.version.id]) : [];
  p.reviews = await all(db, 'SELECT r.rating, r.body, r.created_at, u.name FROM reviews r JOIN users u ON u.id=r.buyer_id WHERE r.product_id=$1 AND r.hidden_reason IS NULL ORDER BY r.id DESC LIMIT 20', [id]);
  return p;
}
export async function toggleWish(user: User, productId: number) {
  const d = await one(db, 'DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2 RETURNING 1 AS x', [user.id, productId]);
  if (!d) await db.query('INSERT INTO wishlist(user_id, product_id) VALUES ($1,$2)', [user.id, productId]);
}
export async function createReport(user: User, input: any) {
  const reason = str(input.reason);
  if (!['rights_infringement', 'malware', 'false_description', 'fake_review', 'other'].includes(reason) || str(input.body).length < 10) throw new AppError('신고 사유와 내용을 10자 이상 적어 주세요');
  await db.query('INSERT INTO reports(reporter_id, product_id, ip_listing_id, reason, body) VALUES ($1,$2,$3,$4,$5)', [user.id, Number(input.product_id) || null, Number(input.ip_listing_id) || null, reason, str(input.body)]);
}
/** 신고 처리. 판매 제한 시 같은 상품의 다른 주문(유사 피해 가능 주문)을 돌려준다 */
export async function handleReport(actor: User, reportId: number, action: 'restrict' | 'dismiss', note: string) {
  needRole(actor, 'support', 'review');
  const r = await one(db, "SELECT * FROM reports WHERE id=$1 AND status IN ('open','reviewing')", [reportId]);
  if (!r) throw new AppError('처리할 신고가 없습니다');
  if (!str(note)) throw new AppError('처리 근거를 적어야 합니다');
  let similar: any[] = [];
  if (action === 'restrict' && r.product_id) {
    await db.query("UPDATE products SET status='suspended', review_note=$2 WHERE id=$1", [r.product_id, `신고 처리: ${str(note, 300)}`]);
    similar = await all(db, "SELECT id, order_no, buyer_id FROM orders WHERE product_id=$1 AND payment_status IN ('paid','partially_refunded')", [r.product_id]);
  }
  if (action === 'restrict' && r.ip_listing_id) await db.query("UPDATE ip_listings SET status='withdrawn' WHERE id=$1", [r.ip_listing_id]);
  await db.query('UPDATE reports SET status=$2, action_taken=$3, handled_by=$4, handled_at=now() WHERE id=$1', [reportId, action === 'restrict' ? 'actioned' : 'dismissed', str(note), actor.id]);
  await audit(null, actor, `report.${action}`, 'report', reportId, `${note} / 유사 주문 ${similar.length}건`);
  return similar;
}
