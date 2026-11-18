// 맞춤 개발: 의뢰 → 견적 → 계약 버전 → 단계별 주문·결제·납품·검수 → 변경 계약
import { db, one, all } from './db.ts';
import { AppError, audit, notify, str, int, needRole } from './util.ts';
import type { User } from './util.ts';
import { createOrder, startPayment, grantDelivery, applyOrderEvent } from './trade.ts';
import { fileProblems } from './catalog.ts';

export const WORK_TYPES: Record<string, string> = { new: '신규 개발', customize: '기존 상품 커스터마이징', install: '설치·배포', integration: '외부 시스템 연동', maintenance: '유지보수' };

export async function createRequest(user: User, f: any) {
  if (!WORK_TYPES[str(f.work_type)]) throw new AppError('작업 유형을 선택하세요');
  if (str(f.title).length < 4 || str(f.requirements).length < 20) throw new AppError('제목과 기능 요구사항(20자 이상)을 입력하세요');
  return (await one(db, `INSERT INTO requests(buyer_id, base_product_id, work_type, title, purpose, requirements, environment, budget_min, budget_max, due_date, reference_notes, source_terms, rights_ownership, maintenance, is_public)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [user.id, Number(f.base_product_id) || null, str(f.work_type), str(f.title, 120), str(f.purpose), str(f.requirements, 20000), str(f.environment), f.budget_min ? int(f.budget_min, 0, 1e11, '예산') : null,
      f.budget_max ? int(f.budget_max, 0, 1e11, '예산') : null, /^\d{4}-\d{2}-\d{2}$/.test(str(f.due_date)) ? str(f.due_date) : null, str(f.reference_notes), str(f.source_terms), str(f.rights_ownership), str(f.maintenance), f.is_public !== 'private'])).id as number;
}
export async function getRequest(user: User | null, id: number) {
  const r = await one(db, 'SELECT r.*, u.name AS buyer_name FROM requests r JOIN users u ON u.id=r.buyer_id WHERE r.id=$1', [id]);
  if (!r) throw new AppError('의뢰를 찾을 수 없습니다', 404);
  const quoted = user && await one(db, 'SELECT 1 FROM quotes WHERE request_id=$1 AND seller_id=$2', [id, user.id]);
  if (!r.is_public && user?.id !== r.buyer_id && !quoted && !user?.operator_role) throw new AppError('비공개 의뢰입니다', 403);
  return r;
}
export async function submitQuote(user: User, requestId: number, f: any) {
  const seller = await one(db, "SELECT 1 FROM sellers WHERE user_id=$1 AND status='approved'", [user.id]);
  if (!seller) throw new AppError('승인된 판매자만 견적을 낼 수 있습니다');
  const req = await one(db, "SELECT * FROM requests WHERE id=$1 AND status='open'", [requestId]);
  if (!req) throw new AppError('견적을 받을 수 있는 의뢰가 아닙니다');
  if (req.buyer_id === user.id) throw new AppError('자신의 의뢰에는 견적을 낼 수 없습니다');
  const arr = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const titles = arr(f.stage_title), outs = arr(f.stage_deliverables), amts = arr(f.stage_amount), days = arr(f.stage_days);
  const stages = titles.map((t: any, i: number) => ({ title: str(t, 100), deliverables: str(outs[i]), amount: amts[i], days: days[i] })).filter((s: any) => s.title)
    .map((s: any) => ({ ...s, amount: int(s.amount, 1000, 1e11, '단계 금액'), days: int(s.days || 7, 1, 365, '단계 기간') }));
  if (!stages.length) throw new AppError('단계를 하나 이상 입력하세요');
  for (const k of ['scope', 'out_of_scope', 'inspection_criteria']) if (!str(f[k])) throw new AppError('작업 범위, 제외 범위, 검수 기준은 반드시 적어야 합니다');
  const total = stages.reduce((a: number, s: any) => a + s.amount, 0);
  const id = (await one(db, `INSERT INTO quotes(request_id, seller_id, scope, out_of_scope, inspection_criteria, revision_scope, support_terms, stages, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
    [requestId, user.id, str(f.scope), str(f.out_of_scope), str(f.inspection_criteria), str(f.revision_scope), str(f.support_terms), JSON.stringify(stages), total])).id;
  await notify(null, req.buyer_id, `"${req.title}" 의뢰에 새 견적이 도착했습니다.`, `/requests/${requestId}`);
  return id as number;
}
/** 견적 채택: 계약(협의 중)과 1차 계약 버전, 단계 목록을 만든다. 양측이 동의해야 효력이 생긴다 */
export async function acceptQuote(user: User, quoteId: number) {
  return db.tx(async (t) => {
    const q = await one(t, "SELECT q.*, r.buyer_id, r.title, r.requirements, r.environment, r.source_terms, r.rights_ownership, r.maintenance FROM quotes q JOIN requests r ON r.id=q.request_id WHERE q.id=$1 AND q.status='submitted' FOR UPDATE OF q", [quoteId]);
    if (!q || q.buyer_id !== user.id) throw new AppError('채택할 수 없는 견적입니다', 403);
    const c = (await one(t, 'INSERT INTO contracts(request_id, quote_id, buyer_id, seller_id, current_version_no) VALUES ($1,$2,$3,$4,1) RETURNING id', [q.request_id, quoteId, q.buyer_id, q.seller_id])).id;
    const terms = { title: q.title, requirements: q.requirements, environment: q.environment, sourceTerms: q.source_terms, rightsOwnership: q.rights_ownership, maintenance: q.maintenance,
      scope: q.scope, outOfScope: q.out_of_scope, inspectionCriteria: q.inspection_criteria, revisionScope: q.revision_scope, supportTerms: q.support_terms, stages: q.stages, total: q.total_amount, changes: [] };
    await t.query('INSERT INTO contract_versions(contract_id, version_no, terms, created_by) VALUES ($1,1,$2::jsonb,$3)', [c, JSON.stringify(terms), user.id]);
    for (let i = 0; i < q.stages.length; i++) {
      const s = q.stages[i]; const last = i === q.stages.length - 1;
      // 최종 단계는 소스·설치(실행) 문서가 있어야 납품으로 인정한다
      await t.query('INSERT INTO milestones(contract_id, seq, title, deliverables, required_files, amount, due_date) VALUES ($1,$2,$3,$4,$5::jsonb,$6, (now() + make_interval(days => $7::int))::date)',
        [c, i + 1, s.title, s.deliverables, JSON.stringify(last ? ['source', 'install_doc'] : []), s.amount, q.stages.slice(0, i + 1).reduce((a: number, x: any) => a + x.days, 0)]);
    }
    await t.query("UPDATE quotes SET status='accepted' WHERE id=$1", [quoteId]);
    await t.query("UPDATE quotes SET status='declined' WHERE request_id=$1 AND id<>$2 AND status='submitted'", [q.request_id, quoteId]);
    await notify(t, q.seller_id, `"${q.title}" 견적이 채택되었습니다. 계약 조건을 확인하고 동의해 주세요.`, `/contracts/${c}`);
    return c as number;
  });
}
export async function getContract(user: User, id: number) {
  const c = await one(db, 'SELECT * FROM contracts WHERE id=$1', [id]);
  if (!c || (![c.buyer_id, c.seller_id].includes(user.id) && !user.operator_role)) throw new AppError('계약을 볼 권한이 없습니다', 403);
  c.version = await one(db, 'SELECT * FROM contract_versions WHERE contract_id=$1 AND version_no=$2', [id, c.current_version_no]);
  c.versions = await all(db, 'SELECT id, version_no, is_draft, legal_reviewed, buyer_agreed_at, seller_agreed_at, created_at FROM contract_versions WHERE contract_id=$1 ORDER BY version_no', [id]);
  c.milestones = await all(db, `SELECT m.*, o.id AS order_id, o.payment_status, o.delivery_status, o.inspection_status, o.payout_status FROM milestones m LEFT JOIN orders o ON o.milestone_id=m.id WHERE m.contract_id=$1 ORDER BY m.seq`, [id]);
  c.changes = await all(db, 'SELECT * FROM change_orders WHERE contract_id=$1 ORDER BY id', [id]);
  return c;
}
export async function agreeContract(user: User, contractId: number) {
  await db.tx(async (t) => {
    const c = await one(t, 'SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [contractId]);
    if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) throw new AppError('권한이 없습니다', 403);
    const col = user.id === c.buyer_id ? 'buyer_agreed_at' : 'seller_agreed_at';
    const v = await one(t, `UPDATE contract_versions SET ${col}=COALESCE(${col}, now()) WHERE contract_id=$1 AND version_no=$2 RETURNING *`, [contractId, c.current_version_no]);
    if (v.buyer_agreed_at && v.seller_agreed_at && c.status === 'negotiating') {
      await t.query("UPDATE contracts SET status='active' WHERE id=$1", [contractId]);
      if (c.request_id) await t.query("UPDATE requests SET status='contracted' WHERE id=$1", [c.request_id]);
    }
    await audit(t, user, 'contract.agree', 'contract', contractId, `v${c.current_version_no}`);
  });
}
/** 법률 검토 전 계약서는 초안으로 표시한다. 검토 완료 표시는 운영자만 */
export async function markLegalReviewed(actor: User, versionId: number) {
  needRole(actor, 'support');
  await db.query('UPDATE contract_versions SET legal_reviewed=true, is_draft=false WHERE id=$1', [versionId]);
  await audit(null, actor, 'contract.legal_reviewed', 'contract_version', versionId);
}

/** 단계별 결제: 단계마다 별도 주문을 만든다(임의 분할 지급이 아님). 앞 단계가 승인된 뒤에만 다음 단계를 결제할 수 있다 */
export async function payMilestone(user: User, milestoneId: number, method: string, agree: any) {
  if (!agree) throw new AppError('단계 조건을 확인하고 동의해야 결제할 수 있습니다');
  const orderId = await db.tx(async (t) => {
    const m = await one(t, 'SELECT m.*, c.buyer_id, c.seller_id, c.status AS cstatus, c.current_version_no, c.id AS cid FROM milestones m JOIN contracts c ON c.id=m.contract_id WHERE m.id=$1 FOR UPDATE OF m', [milestoneId]);
    if (!m || m.buyer_id !== user.id) throw new AppError('권한이 없습니다', 403);
    if (m.cstatus !== 'active') throw new AppError('양측이 계약 조건에 동의한 뒤에 결제할 수 있습니다');
    const ex = await one(t, 'SELECT id FROM orders WHERE milestone_id=$1', [milestoneId]);
    if (ex) return ex.id as number;
    if (await one(t, "SELECT 1 FROM milestones WHERE contract_id=$1 AND seq<$2 AND status NOT IN ('accepted','cancelled')", [m.contract_id, m.seq])) throw new AppError('앞 단계가 승인된 뒤에 다음 단계를 결제할 수 있습니다');
    const v = await one(t, 'SELECT * FROM contract_versions WHERE contract_id=$1 AND version_no=$2', [m.cid, m.current_version_no]);
    const sellerName = (await one(t, 'SELECT display_name FROM sellers WHERE user_id=$1', [m.seller_id])).display_name;
    const id = await createOrder(t, { type: 'milestone', buyerId: m.buyer_id, sellerId: m.seller_id, amount: m.amount, method, category: 'custom', inspectionDays: m.inspection_days, milestoneId,
      snapshot: { title: `${v.terms.title} — ${m.seq}단계 ${m.title}`, kind: 'custom', sellerName, contractId: m.cid, contractVersion: v.version_no, stage: { seq: m.seq, title: m.title, deliverables: m.deliverables },
        deliverables: m.required_files, included: m.deliverables, excluded: v.terms.outOfScope, inspection_criteria: v.terms.inspectionCriteria, refund_policy: '단계 납품 전: 전액 환불 협의. 납품 후: 검수 기준에 따른 분쟁 절차',
        license: { notes: `권리 귀속: ${v.terms.rightsOwnership || '계약서 기준'}` }, files: [] } });
    await t.query("UPDATE milestones SET status='awaiting_payment' WHERE id=$1", [milestoneId]);
    return id;
  });
  return { orderId, providerPaymentId: await startPayment(orderId) };
}
/** 단계 납품 제출. 화면 캡처·시연 영상(증빙)만으로는 납품이 되지 않는다 */
export async function submitMilestoneDelivery(user: User, milestoneId: number, versionId: number) {
  const m = await one(db, 'SELECT m.*, c.seller_id FROM milestones m JOIN contracts c ON c.id=m.contract_id WHERE m.id=$1', [milestoneId]);
  if (!m || m.seller_id !== user.id) throw new AppError('권한이 없습니다', 403);
  const o = await one(db, 'SELECT * FROM orders WHERE milestone_id=$1', [milestoneId]);
  if (!o || o.payment_status !== 'paid') throw new AppError('해당 단계의 결제가 확인된 뒤에 납품할 수 있습니다');
  const v = await one(db, "SELECT * FROM file_versions WHERE id=$1 AND milestone_id=$2 AND status='draft'", [versionId, milestoneId]);
  if (!v) throw new AppError('제출할 납품 버전이 없습니다');
  const files = await all(db, 'SELECT * FROM files WHERE version_id=$1', [versionId]);
  const real = files.filter((f) => !['evidence', 'other'].includes(f.kind));
  const problems = fileProblems(files, m.required_files);
  if (!real.length) problems.push('산출물 파일 없음(화면 캡처·시연 영상만으로는 납품할 수 없습니다)');
  if (problems.length) throw new AppError(`납품할 수 없습니다: ${problems.join(' / ')}`);
  await db.query("UPDATE file_versions SET status='published', published_at=now() WHERE id=$1", [versionId]); // 제출한 납품물은 잠근다
  if (['not_ready', 'failed'].includes(o.delivery_status)) await grantDelivery(o.id, versionId);
  else if (o.inspection_status === 'revision_requested') {
    await db.tx(async (t) => {
      await applyOrderEvent(t, o.id, { type: 'REVISION_DELIVERED', now: new Date() });
      await t.query("INSERT INTO deliveries(order_id, version_id, status, detail) VALUES ($1,$2,'granted','수정 납품')", [o.id, versionId]);
      await notify(t, o.buyer_id, `주문 ${o.order_no} 수정 납품이 도착했습니다. 검수 기한이 다시 시작됩니다.`, `/orders/${o.id}`);
    });
  } else throw new AppError('지금은 납품을 제출할 수 없는 상태입니다');
  await db.query("UPDATE milestones SET status='delivered' WHERE id=$1 AND status='in_progress'", [milestoneId]);
}

// ── 변경 계약 ──
export async function proposeChange(user: User, contractId: number, f: any) {
  const c = await one(db, "SELECT * FROM contracts WHERE id=$1 AND status='active'", [contractId]);
  if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) throw new AppError('권한이 없습니다', 403);
  if (!str(f.existing_scope) || !str(f.added_scope)) throw new AppError('기존 범위와 추가 범위를 모두 적어야 합니다');
  const amount = f.amount_delta ? int(f.amount_delta, 0, 1e11, '추가 금액') : 0; const days = f.days_delta ? int(f.days_delta, 0, 730, '추가 기간') : 0;
  const mine = user.id === c.buyer_id ? 'buyer_agreed_at' : 'seller_agreed_at';
  const id = (await one(db, `INSERT INTO change_orders(contract_id, requested_by, existing_scope, added_scope, in_original_scope, amount_delta, days_delta, ${mine}) VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
    [contractId, user.id, str(f.existing_scope), str(f.added_scope), f.in_original_scope === 'yes' ? true : f.in_original_scope === 'no' ? false : null, amount, days])).id;
  await notify(null, user.id === c.buyer_id ? c.seller_id : c.buyer_id, '변경 계약 제안이 도착했습니다. 금액·기간 변경을 확인해 주세요.', `/contracts/${contractId}`);
  return id as number;
}
export async function decideChange(user: User, changeId: number, agree: boolean) {
  await db.tx(async (t) => {
    const ch = await one(t, "SELECT * FROM change_orders WHERE id=$1 AND status='proposed' FOR UPDATE", [changeId]);
    const c = ch && await one(t, 'SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [ch.contract_id]);
    if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) throw new AppError('권한이 없습니다', 403);
    if (!agree) { await t.query("UPDATE change_orders SET status='rejected' WHERE id=$1", [changeId]); return; }
    const col = user.id === c.buyer_id ? 'buyer_agreed_at' : 'seller_agreed_at';
    const u = await one(t, `UPDATE change_orders SET ${col}=COALESCE(${col}, now()) WHERE id=$1 RETURNING *`, [changeId]);
    if (!(u.buyer_agreed_at && u.seller_agreed_at)) return;
    // 양측 동의 완료: 기존 버전은 그대로 두고 새 계약 버전을 만든다
    const prev = await one(t, 'SELECT * FROM contract_versions WHERE contract_id=$1 AND version_no=$2', [c.id, c.current_version_no]);
    const terms = { ...prev.terms, total: prev.terms.total + u.amount_delta, changes: [...(prev.terms.changes || []), { changeId, existingScope: u.existing_scope, addedScope: u.added_scope, inOriginalScope: u.in_original_scope, amountDelta: u.amount_delta, daysDelta: u.days_delta }] };
    const nv = await one(t, 'INSERT INTO contract_versions(contract_id, version_no, terms, buyer_agreed_at, seller_agreed_at, created_by) VALUES ($1,$2,$3::jsonb, now(), now(), $4) RETURNING id', [c.id, c.current_version_no + 1, JSON.stringify(terms), user.id]);
    await t.query('UPDATE contracts SET current_version_no=current_version_no+1 WHERE id=$1', [c.id]);
    if (u.amount_delta > 0) {
      const seq = (await one(t, 'SELECT max(seq)::int AS s FROM milestones WHERE contract_id=$1', [c.id])).s + 1;
      await t.query("INSERT INTO milestones(contract_id, seq, title, deliverables, amount, due_date) VALUES ($1,$2,$3,$4,$5, (now() + make_interval(days => $6::int))::date)", [c.id, seq, '변경 계약 추가분', u.added_scope, u.amount_delta, Math.max(u.days_delta, 1)]);
    } else if (u.days_delta > 0) await t.query("UPDATE milestones SET due_date = due_date + $2::int WHERE contract_id=$1 AND status IN ('planned','awaiting_payment','in_progress')", [c.id, u.days_delta]);
    await t.query("UPDATE change_orders SET status='agreed', resulting_version_id=$2 WHERE id=$1", [changeId, nv.id]);
    await audit(t, user, 'contract.change.agreed', 'contract', c.id, `+${u.amount_delta}원, +${u.days_delta}일`);
  });
}
