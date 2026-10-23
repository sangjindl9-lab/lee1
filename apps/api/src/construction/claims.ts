/**
 * 기성청구 · 수금
 *  - 기성 승인 = 회계상 매출 인식: (공사미수금·선수금 정산·유보금 / 공사수입금)
 *  - 매출 세금계산서는 기성과 연결하되 별도 문서: 발행 시 부가세만 (공사미수금 / 부가세예수금) — 세무상 발행시기와 매출인식시기를 분리
 *  - 수금 = 입금 확인: (예금 / 공사미수금·공사선수금·유보금) — 매출액과 수금액은 항상 따로 집계
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, asc, desc, eq, inArray, ne, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerService, PostLine } from '../accounting/ledger.service';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { D, moneyStr, sumMoney } from '../common/money';
import { NumberingService, TaxRateService, todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { bankAccounts, collections, companies, progressClaimLines, progressClaims, projects, taxInvoices, vendors } from '../db/schema';
import { TaxInvoicesService } from '../taxinvoices/taxinvoices.service';
import { renderClaimPdf } from './claim-pdf';
import { sealsForPdf } from '../admin/seals';
import { contractNow, dateStr, loadProject, optDate, optText, posAmt, rateIn, ReasonDto, VersionDto } from './common';

export const CLAIM_STATUS_LABEL = { DRAFT: '작성중', PENDING: '결재중', APPROVED: '승인(미발행)', REJECTED: '반려', INVOICED: '계산서 발행', PARTIAL: '일부 수금', COLLECTED: '수금 완료', CANCELLED: '취소' } as const;
const RECOGNIZED = ['APPROVED', 'INVOICED', 'PARTIAL', 'COLLECTED'] as const;
const KIND_LABEL = { ADVANCE: '선급금', CLAIM: '기성금', RETENTION: '유보금', OTHER: '기타' } as const;

const ClaimDto = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  vendorId: z.string().uuid('발주처(거래처)를 선택해 주세요'),
  claimDate: dateStr,
  periodFrom: optDate, periodTo: optDate, dueDate: optDate,
  thisSupply: posAmt.optional(),
  advanceDeduction: posAmt.default('0'),
  retentionRate: rateIn.default('0'),
  isFinal: z.boolean().default(false),
  memo: optText(1000),
  lines: z.array(z.object({ name: z.string().trim().min(1, '공종명을 입력해 주세요').max(200), spec: optText(100), unit: optText(20), contractAmount: posAmt.default('0'), thisAmount: posAmt })).max(200).default([]),
});
type ClaimDto = z.infer<typeof ClaimDto>;
const ListQ = z.object({ projectId: z.string().uuid().optional(), status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(500).default(100) });

const CollectionDto = z.object({
  kind: z.enum(['ADVANCE', 'CLAIM', 'RETENTION']),
  projectId: z.string().uuid().optional().nullable(),
  claimId: z.string().uuid().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
  collectDate: dateStr,
  amount: posAmt.refine((v) => Number(v) > 0, '금액을 입력해 주세요'),
  method: z.enum(['TRANSFER', 'CASH', 'BILL', 'OFFSET']).default('TRANSFER'),
  bankAccountId: z.string().uuid().optional().nullable().or(z.literal('').transform(() => null)),
  memo: optText(300),
});
type CollectionDto = z.infer<typeof CollectionDto>;

@Injectable()
export class ClaimsService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
    private readonly invoices: TaxInvoicesService,
  ) {}

  onModuleInit() {
    this.approvals.register('CLAIM', {
      resource: 'claim',
      href: (id) => `/claims/${id}`,
      onApproved: async (tx, id, ctx) => {
        const [c] = await tx.update(progressClaims).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${progressClaims.version} + 1` }).where(eq(progressClaims.id, id)).returning();
        await this.postRevenue(tx, ctx, c);
      },
      onRejected: async (tx, id) => {
        await tx.update(progressClaims).set({ status: 'REJECTED', version: sql`${progressClaims.version} + 1` }).where(eq(progressClaims.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(progressClaims).set({ status: 'DRAFT', approvalId: null, version: sql`${progressClaims.version} + 1` }).where(eq(progressClaims.id, id));
      },
    });
  }

  /** 기성 승인 분개 — 매출 인식 */
  private async postRevenue(tx: Tx, ctx: AccessContext, c: typeof progressClaims.$inferSelect) {
    const ar = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AR');
    const rev = await this.ledger.ruleAccount(tx, ctx.companyId!, 'REVENUE');
    const lines: PostLine[] = [];
    const supplyPart = D(c.thisSupply).minus(c.advanceDeduction).minus(c.retentionAmount);
    if (supplyPart.gt(0)) lines.push({ accountId: ar, debit: supplyPart, vendorId: c.vendorId, projectId: c.projectId, memo: `${c.claimNo}회 기성 (공급가)` });
    if (D(c.advanceDeduction).gt(0)) lines.push({ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'ADVANCE_RECEIVED'), debit: c.advanceDeduction, vendorId: c.vendorId, projectId: c.projectId, memo: '선급금 정산' });
    if (D(c.retentionAmount).gt(0)) lines.push({ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'RETAINAGE_AR'), debit: c.retentionAmount, vendorId: c.vendorId, projectId: c.projectId, memo: '유보금' });
    lines.push({ accountId: rev, credit: c.thisSupply, projectId: c.projectId, memo: `${c.claimNo}회 기성 매출` });
    await this.ledger.post(tx, ctx, { date: c.claimDate, description: `기성 매출 인식 ${c.code} (${c.claimNo}회)`, sourceType: 'CLAIM', sourceId: c.id, sourceCode: c.code, lines });
  }

  private scope(ctx: AccessContext): SQL {
    return and(eq(progressClaims.companyId, ctx.companyId!), this.access.projectScope(ctx, progressClaims.projectId))!;
  }

  private async load(ctx: AccessContext, id: string, tx: Tx | DB = this.db) {
    const [c] = await tx.select().from(progressClaims).where(and(eq(progressClaims.id, id), this.scope(ctx)));
    if (!c) throw notFound('기성청구');
    return c;
  }

  // ───────── 기성 ─────────
  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.projectId) conds.push(eq(progressClaims.projectId, q.projectId));
    if (q.status === 'OPEN') conds.push(inArray(progressClaims.status, ['APPROVED', 'INVOICED', 'PARTIAL']));
    else if (q.status) conds.push(eq(progressClaims.status, q.status as 'DRAFT'));
    else conds.push(ne(progressClaims.status, 'CANCELLED'));
    const where = and(...conds);
    const rows = await this.db.select({
      c: progressClaims, projectName: projects.name, projectCode: projects.code, tradeType: projects.tradeType, vendorName: vendors.name,
      collected: sql<string>`coalesce((select sum(amount) from collection x where x.claim_id = ${progressClaims.id} and x.status = 'CONFIRMED'),0)::text`,
      invoiceId: sql<string | null>`(select t.id from tax_invoice t where t.claim_id = ${progressClaims.id} and t.status <> 'CANCELLED' limit 1)`,
    }).from(progressClaims).innerJoin(projects, eq(projects.id, progressClaims.projectId)).innerJoin(vendors, eq(vendors.id, progressClaims.vendorId))
      .where(where).orderBy(desc(progressClaims.claimDate), desc(progressClaims.claimNo)).limit(q.size).offset((q.page - 1) * q.size);
    const [agg] = await this.db.select({
      count: sql<number>`count(*)::int`,
      claimed: sql<string>`coalesce(sum(${progressClaims.thisSupply}) filter (where ${progressClaims.status} in ('APPROVED','INVOICED','PARTIAL','COLLECTED')),0)::text`,
      receivable: sql<string>`coalesce(sum(${progressClaims.receivableAmount}) filter (where ${progressClaims.status} in ('APPROVED','INVOICED','PARTIAL','COLLECTED')),0)::text`,
      collected: sql<string>`coalesce((select sum(x.amount) from collection x join progress_claim pc on pc.id = x.claim_id where x.status = 'CONFIRMED' and pc.company_id = ${ctx.companyId} ${q.projectId ? sql`and pc.project_id = ${q.projectId}` : sql``}),0)::text`,
    }).from(progressClaims).where(where);
    const today = todayKST();
    return {
      total: agg.count, sums: { claimed: agg.claimed, receivable: agg.receivable, collected: agg.collected, outstanding: moneyStr(D(agg.receivable).minus(agg.collected)) },
      rows: rows.map(({ c, ...x }) => {
        const out = D(c.receivableAmount).minus(x.collected);
        return { ...c, ...x, statusLabel: CLAIM_STATUS_LABEL[c.status], outstanding: moneyStr(RECOGNIZED.includes(c.status as never) ? out : 0), overdue: RECOGNIZED.includes(c.status as never) && out.gt(0) && !!c.dueDate && c.dueDate < today };
      }),
    };
  }

  /** 새 기성 작성 화면용: 전회 누적·공종별 전회·선급금 잔액 */
  async prepare(ctx: AccessContext, projectId: string) {
    const p = await loadProject(this.db, this.access, ctx, projectId);
    const c = await contractNow(this.db, projectId);
    const prev = (await this.db.execute(sql`select coalesce(sum(this_supply),0)::text s, coalesce(max(claim_no),0)::int n from progress_claim where project_id = ${projectId} and status not in ('CANCELLED','REJECTED')`)).rows[0] as { s: string; n: number };
    const lastLines = (await this.db.execute(sql`
      select l.name, max(l.spec) spec, max(l.unit) unit, max(l.contract_amount)::text contract_amount, sum(l.this_amount)::text prev_amount
      from progress_claim_line l join progress_claim c on c.id = l.claim_id
      where c.project_id = ${projectId} and c.status not in ('CANCELLED','REJECTED') group by l.name order by min(l.line_no)`)).rows as { name: string; spec: string | null; unit: string | null; contract_amount: string; prev_amount: string }[];
    const advance = await this.advanceBalance(projectId);
    const [client] = p.clientVendorId ? await this.db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, p.clientVendorId)) : await this.db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), eq(vendors.name, p.clientName ?? '\u0000')));
    return {
      project: { id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, retentionRate: p.retentionRate, advanceAmount: p.advanceAmount, clientName: p.clientName },
      client: client ?? null, contract: c, prevCumulative: moneyStr(prev.s), nextNo: prev.n + 1, remaining: moneyStr(D(c.current).minus(prev.s)), advanceBalance: advance, lines: lastLines,
    };
  }

  private async advanceBalance(projectId: string, tx: Tx | DB = this.db, exceptClaim?: string) {
    const r = (await tx.execute(sql`select
      coalesce((select sum(amount) from collection where project_id = ${projectId} and kind = 'ADVANCE' and status = 'CONFIRMED'),0) -
      coalesce((select sum(advance_deduction) from progress_claim where project_id = ${projectId} and status not in ('CANCELLED','REJECTED') ${exceptClaim ? sql`and id <> ${exceptClaim}` : sql``}),0) b`)).rows[0] as { b: string };
    return moneyStr(r.b);
  }

  private async compute(ctx: AccessContext, dto: ClaimDto, exceptId?: string) {
    const p = await loadProject(this.db, this.access, ctx, dto.projectId);
    if (p.status === 'SETTLED') throw new BadRequestException({ code: 'SETTLED', message: '정산이 끝난 현장입니다' });
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, dto.vendorId), eq(vendors.companyId, ctx.companyId!)));
    if (!v) throw new BadRequestException({ code: 'BAD_VENDOR', message: '발주처를 다시 선택해 주세요' });
    const c = await contractNow(this.db, p.id);
    const prev = (await this.db.execute(sql`select coalesce(sum(this_supply),0)::text s from progress_claim where project_id = ${p.id} and status not in ('CANCELLED','REJECTED') ${exceptId ? sql`and id <> ${exceptId}` : sql``}`)).rows[0] as { s: string };
    const prevLines = (await this.db.execute(sql`select l.name, sum(l.this_amount)::text prev from progress_claim_line l join progress_claim c on c.id = l.claim_id where c.project_id = ${p.id} and c.status not in ('CANCELLED','REJECTED') ${exceptId ? sql`and c.id <> ${exceptId}` : sql``} group by l.name`)).rows as { name: string; prev: string }[];
    const thisSupply = dto.lines.length ? D(sumMoney(dto.lines.map((l) => l.thisAmount))) : D(dto.thisSupply ?? 0);
    if (thisSupply.lte(0)) throw new BadRequestException({ code: 'ZERO_CLAIM', message: '금회 기성 금액을 입력해 주세요' });
    const cumulative = D(prev.s).plus(thisSupply);
    if (cumulative.gt(c.current)) throw new BadRequestException({ code: 'OVER_CONTRACT', message: `누적 기성(${cumulative.toFixed(0)}원)이 계약금액(${D(c.current).toFixed(0)}원)을 넘습니다. 변경계약을 먼저 승인받으세요` });
    if (dto.isFinal && !cumulative.eq(c.current)) throw new BadRequestException({ code: 'FINAL_MISMATCH', message: `준공 기성은 누적이 계약금액과 같아야 합니다 (남은 금액 ${D(c.current).minus(prev.s).toFixed(0)}원)` });
    const vatRate = await this.taxRates.rateAt('VAT', dto.claimDate);
    const vat = thisSupply.mul(vatRate).toDecimalPlaces(0, 1);
    const retention = thisSupply.mul(dto.retentionRate).toDecimalPlaces(0, 1);
    const adv = D(dto.advanceDeduction);
    const advBal = await this.advanceBalance(p.id, this.db, exceptId);
    if (adv.gt(advBal)) throw new BadRequestException({ code: 'ADVANCE_OVER', message: `선급금 공제(${adv.toFixed(0)}원)가 남은 선급금(${D(advBal).toFixed(0)}원)보다 많습니다` });
    if (adv.plus(retention).gt(thisSupply)) throw new BadRequestException({ code: 'DEDUCTION_OVER', message: '공제액이 금회 기성보다 많습니다' });
    for (const l of dto.lines) {
      const pv = D(prevLines.find((x) => x.name === l.name)?.prev ?? 0);
      if (D(l.contractAmount).gt(0) && pv.plus(l.thisAmount).gt(l.contractAmount)) throw new BadRequestException({ code: 'LINE_OVER', message: `'${l.name}'의 누적 기성이 공종 계약금액을 넘습니다` });
    }
    return {
      p, v, c, vatRate,
      values: {
        vendorId: v.id, claimDate: dto.claimDate, periodFrom: dto.periodFrom ?? null, periodTo: dto.periodTo ?? null, dueDate: dto.dueDate ?? null,
        contractSupply: c.current, prevCumulative: moneyStr(prev.s), thisSupply: moneyStr(thisSupply), cumulative: moneyStr(cumulative),
        progressRate: D(c.current).gt(0) ? cumulative.div(c.current).toFixed(4) : '0', vatRate, vatAmount: moneyStr(vat), advanceDeduction: moneyStr(adv),
        retentionRate: dto.retentionRate, retentionAmount: moneyStr(retention), receivableAmount: moneyStr(thisSupply.plus(vat).minus(adv).minus(retention)), isFinal: dto.isFinal, memo: dto.memo,
      },
      lines: dto.lines.map((l, i) => {
        const pv = D(prevLines.find((x) => x.name === l.name)?.prev ?? 0);
        return { lineNo: i + 1, name: l.name, spec: l.spec, unit: l.unit, contractAmount: moneyStr(l.contractAmount), prevAmount: moneyStr(pv), thisAmount: moneyStr(l.thisAmount), cumulativeAmount: moneyStr(pv.plus(l.thisAmount)) };
      }),
    };
  }

  async create(ctx: AccessContext, dto: ClaimDto) {
    const b = await this.compute(ctx, dto);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from project where id = ${b.p.id} for update`);
      const no = ((await tx.execute(sql`select coalesce(max(claim_no),0)::int n from progress_claim where project_id = ${b.p.id} and status not in ('CANCELLED','REJECTED')`)).rows[0] as { n: number }).n + 1;
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'PC', dto.claimDate);
      const [c] = await tx.insert(progressClaims).values({ ...b.values, companyId: ctx.companyId!, projectId: b.p.id, code, claimNo: no, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      if (b.lines.length) await tx.insert(progressClaimLines).values(b.lines.map((l) => ({ ...l, claimId: c.id })));
      if (!b.p.clientVendorId) await tx.update(projects).set({ clientVendorId: b.v.id }).where(eq(projects.id, b.p.id));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'claim', resourceId: c.id, summary: `기성청구 ${no}회 작성 ${code} ${b.p.name} 금회 ${D(c.thisSupply).toFixed(0)}원 (누적 ${D(c.progressRate).mul(100).toFixed(1)}%)` }, tx);
      return c;
    });
  }

  async update(ctx: AccessContext, id: string, dto: ClaimDto & { version: number }) {
    const cur = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'LOCKED', message: '작성중·반려 상태에서만 고칠 수 있습니다' });
    if (cur.projectId !== dto.projectId) throw new BadRequestException({ code: 'PROJECT_FIXED', message: '현장은 바꿀 수 없습니다' });
    const later = (await this.db.execute(sql`select 1 from progress_claim where project_id = ${cur.projectId} and claim_no > ${cur.claimNo} and status not in ('CANCELLED','REJECTED') limit 1`)).rows.length;
    if (later) throw new ConflictException({ code: 'NOT_LATEST', message: '다음 회차 기성이 있어 고칠 수 없습니다' });
    const b = await this.compute(ctx, dto, id);
    return this.db.transaction(async (tx) => {
      const [c] = await tx.update(progressClaims).set({ ...b.values, status: 'DRAFT', updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${progressClaims.version} + 1` })
        .where(and(eq(progressClaims.id, id), eq(progressClaims.version, dto.version))).returning();
      if (!c) throw staleVersion();
      await tx.delete(progressClaimLines).where(eq(progressClaimLines.claimId, id));
      if (b.lines.length) await tx.insert(progressClaimLines).values(b.lines.map((l) => ({ ...l, claimId: id })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'claim', resourceId: id, summary: `기성청구 수정 ${c.code}` }, tx);
      return c;
    });
  }

  async get(ctx: AccessContext, id: string) {
    const c = await this.load(ctx, id);
    const [lines, [p], [v], cols, invs, state, contract] = await Promise.all([
      this.db.select().from(progressClaimLines).where(eq(progressClaimLines.claimId, id)).orderBy(asc(progressClaimLines.lineNo)),
      this.db.select().from(projects).where(eq(projects.id, c.projectId)),
      this.db.select({ id: vendors.id, name: vendors.name, bizRegNo: vendors.bizRegNo, ceoName: vendors.ceoName, address: vendors.address }).from(vendors).where(eq(vendors.id, c.vendorId)),
      this.db.select({ x: collections, bankName: bankAccounts.name }).from(collections).leftJoin(bankAccounts, eq(bankAccounts.id, collections.bankAccountId)).where(eq(collections.claimId, id)).orderBy(asc(collections.collectDate)),
      this.db.select({ id: taxInvoices.id, code: taxInvoices.code, status: taxInvoices.status, approvalNo: taxInvoices.approvalNo, providerMode: taxInvoices.providerMode, ntsStatus: taxInvoices.ntsStatus, totalAmount: taxInvoices.totalAmount, writeDate: taxInvoices.writeDate }).from(taxInvoices).where(eq(taxInvoices.claimId, id)).orderBy(desc(taxInvoices.createdAt)),
      this.approvals.docState(ctx, 'CLAIM', id),
      contractNow(this.db, c.projectId),
    ]);
    const journals = (await this.db.execute(sql`select id, code, status, entry_date, total_debit::text from journal_entry where company_id = ${ctx.companyId} and source_type = 'CLAIM' and source_id = ${id} order by created_at`)).rows;
    const collected = sumMoney(cols.filter((x) => x.x.status === 'CONFIRMED').map((x) => x.x.amount));
    return {
      ...c, statusLabel: CLAIM_STATUS_LABEL[c.status], lines, project: { id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, siteAddress: p.siteAddress, contractDate: p.contractDate, startDate: p.startDate, plannedEndDate: p.plannedEndDate },
      vendor: v, contractOriginal: contract.original, collections: cols.map(({ x, bankName }) => ({ ...x, bankName })), collected, outstanding: moneyStr(RECOGNIZED.includes(c.status as never) ? D(c.receivableAmount).minus(collected) : 0),
      invoices: invs.map((t) => ({ ...t, isTestIssue: t.status === 'ISSUED' && t.providerMode === 'TEST' })), journals, ...state,
    };
  }

  async submit(ctx: AccessContext, id: string, version: number) {
    const c = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(c.status)) throw new ConflictException({ code: 'LOCKED', message: '이미 상신된 기성입니다' });
    const [p] = await this.db.select({ name: projects.name }).from(projects).where(eq(projects.id, c.projectId));
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(progressClaims).set({ status: 'PENDING', version: sql`${progressClaims.version} + 1` }).where(and(eq(progressClaims.id, id), eq(progressClaims.version, version))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'CLAIM', docId: id, docCode: c.code, title: `[기성 ${c.claimNo}회] ${p.name} ${D(c.thisSupply).toFixed(0)}원`, amount: c.thisSupply, projectId: c.projectId });
      await tx.update(progressClaims).set({ approvalId: a.id }).where(eq(progressClaims.id, id));
      return { approvalId: a.id };
    });
  }

  /** 취소: 작성중·반려는 그대로, 승인된 기성은 계산서·수금이 없고 마지막 회차일 때만 (매출 역분개) */
  async cancel(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(ctx, id, tx);
      if (c.status === 'PENDING') throw new ConflictException({ code: 'PENDING', message: '결재 중입니다. 먼저 결재를 회수하세요' });
      if (c.status === 'CANCELLED') throw new ConflictException({ code: 'ALREADY', message: '이미 취소되었습니다' });
      if (RECOGNIZED.includes(c.status as never)) {
        const inv = await tx.select({ code: taxInvoices.code }).from(taxInvoices).where(and(eq(taxInvoices.claimId, id), ne(taxInvoices.status, 'CANCELLED')));
        if (inv.length) throw new ConflictException({ code: 'HAS_INVOICE', message: `세금계산서 ${inv[0].code}가 연결되어 있습니다. 계산서를 먼저 취소하세요` });
        const col = await tx.select({ code: collections.code }).from(collections).where(and(eq(collections.claimId, id), eq(collections.status, 'CONFIRMED')));
        if (col.length) throw new ConflictException({ code: 'HAS_COLLECTION', message: `수금 ${col[0].code}이 있습니다. 수금을 먼저 취소하세요` });
        const later = (await tx.execute(sql`select 1 from progress_claim where project_id = ${c.projectId} and claim_no > ${c.claimNo} and status not in ('CANCELLED','REJECTED') limit 1`)).rows.length;
        if (later) throw new ConflictException({ code: 'NOT_LATEST', message: '다음 회차 기성이 있어 취소할 수 없습니다. 마지막 회차부터 취소하세요' });
        await this.ledger.reverseSource(tx, ctx, 'CLAIM', id, `기성 취소 — ${reason}`);
      }
      const [u] = await tx.update(progressClaims).set({ status: 'CANCELLED', updatedById: ctx.user.id, version: sql`${progressClaims.version} + 1` }).where(eq(progressClaims.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'claim', resourceId: id, summary: `기성청구 취소 ${c.code} — ${reason}` }, tx);
      return u;
    });
  }

  /** 승인된 기성으로 매출 세금계산서 초안 만들기 (발행은 세금계산서 화면에서 결재 후) */
  async createInvoice(ctx: AccessContext, id: string) {
    const c = await this.load(ctx, id);
    if (!RECOGNIZED.includes(c.status as never)) throw new ConflictException({ code: 'NOT_APPROVED', message: '승인된 기성만 세금계산서를 만들 수 있습니다' });
    const [exists] = await this.db.select({ id: taxInvoices.id, code: taxInvoices.code }).from(taxInvoices).where(and(eq(taxInvoices.claimId, id), ne(taxInvoices.status, 'CANCELLED')));
    if (exists) throw new ConflictException({ code: 'ALREADY', message: `이미 세금계산서 ${exists.code}가 있습니다`, details: { id: exists.id } });
    const [p] = await this.db.select({ name: projects.name }).from(projects).where(eq(projects.id, c.projectId));
    const t = await this.invoices.createManual(ctx, {
      direction: 'SALES', docKind: 'TAX', approvalNo: null, writeDate: todayKST() < c.claimDate ? c.claimDate : todayKST(), purpose: 'CHARGE', vendorId: c.vendorId, projectId: c.projectId,
      remark: `${p.name} 제${c.claimNo}회 기성 (${c.code})`,
      lines: [{ itemDate: null, name: `${p.name} 제${c.claimNo}회 기성`, spec: null, qty: null, unitPrice: null, supplyAmount: D(c.thisSupply).toFixed(0), vatAmount: D(c.vatAmount).toFixed(0), remark: null }],
    });
    await this.db.update(taxInvoices).set({ claimId: id }).where(eq(taxInvoices.id, t.id));
    await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'claim', resourceId: id, summary: `기성 ${c.code}의 매출 세금계산서 초안 ${t.code} 작성` });
    return { id: t.id, code: t.code };
  }

  async pdf(ctx: AccessContext, id: string) {
    const d = await this.get(ctx, id);
    const [co] = await this.db.select().from(companies).where(eq(companies.id, ctx.companyId!));
    const approval = d.approval && d.approval.status !== 'CANCELLED' ? d.approval : null;
    const seals = await sealsForPdf(this.db, ctx.companyId!, approval?.steps.map((st: { actedStampId?: string | null }) => st.actedStampId) ?? []);
    const buf = await renderClaimPdf({
      seals,
      ...d, client: { name: d.vendor.name, bizRegNo: d.vendor.bizRegNo, ceoName: d.vendor.ceoName, address: d.vendor.address },
      company: { name: co.name, bizRegNo: co.bizRegNo, ceoName: co.ceoName, address: co.address, phone: co.phone },
      approval, printedBy: ctx.user.name,
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'claim', resourceId: id, summary: `기성청구서 PDF 출력 ${d.code}` });
    return { buf, name: `기성청구서_${d.code}_${d.project.name}.pdf` };
  }

  // ───────── 수금 ─────────
  /** 수금 후 기성 상태 다시 계산 */
  private async refreshClaim(tx: Tx, claimId: string) {
    const [c] = await tx.select().from(progressClaims).where(eq(progressClaims.id, claimId));
    if (!c || !RECOGNIZED.includes(c.status as never)) return;
    const got = (await tx.execute(sql`select coalesce(sum(amount),0)::text s from collection where claim_id = ${claimId} and status = 'CONFIRMED'`)).rows[0] as { s: string };
    const inv = (await tx.execute(sql`select 1 from tax_invoice where claim_id = ${claimId} and status = 'ISSUED' limit 1`)).rows.length;
    const status = D(got.s).gte(c.receivableAmount) ? 'COLLECTED' : D(got.s).gt(0) ? 'PARTIAL' : inv ? 'INVOICED' : 'APPROVED';
    if (status !== c.status) await tx.update(progressClaims).set({ status, version: sql`${progressClaims.version} + 1` }).where(eq(progressClaims.id, claimId));
  }

  /** 세금계산서 발행·취소 때 호출 */
  async onInvoiceChanged(tx: Tx, claimId: string) {
    await this.refreshClaim(tx, claimId);
  }

  async collect(ctx: AccessContext, dto: CollectionDto) {
    return this.db.transaction(async (tx) => {
      let projectId = dto.projectId ?? null;
      let vendorId = dto.vendorId ?? null;
      let claim: typeof progressClaims.$inferSelect | null = null;
      if (dto.kind === 'CLAIM') {
        if (!dto.claimId) throw new BadRequestException({ code: 'NEED_CLAIM', message: '수금할 기성을 선택해 주세요' });
        await tx.execute(sql`select id from progress_claim where id = ${dto.claimId} for update`);
        claim = await this.load(ctx, dto.claimId, tx);
        if (!RECOGNIZED.includes(claim.status as never)) throw new BadRequestException({ code: 'NOT_APPROVED', message: '승인된 기성만 수금 처리할 수 있습니다' });
        projectId = claim.projectId;
        vendorId = claim.vendorId;
      }
      if (!projectId) throw new BadRequestException({ code: 'NEED_PROJECT', message: '현장을 선택해 주세요' });
      const p = await loadProject(tx, this.access, ctx, projectId);
      vendorId = vendorId ?? p.clientVendorId;
      if (!vendorId) throw new BadRequestException({ code: 'NEED_VENDOR', message: '발주처(거래처)를 선택해 주세요' });
      const amount = D(dto.amount);
      if (dto.kind === 'RETENTION') {
        const r = (await tx.execute(sql`select coalesce((select sum(retention_amount) from progress_claim where project_id = ${projectId} and status in ('APPROVED','INVOICED','PARTIAL','COLLECTED')),0) -
          coalesce((select sum(amount) from collection where project_id = ${projectId} and kind = 'RETENTION' and status = 'CONFIRMED'),0) b`)).rows[0] as { b: string };
        if (amount.gt(r.b)) throw new BadRequestException({ code: 'RETENTION_OVER', message: `받을 유보금(${D(r.b).toFixed(0)}원)보다 많습니다` });
      }
      if (claim) {
        const got = (await tx.execute(sql`select coalesce(sum(amount),0)::text s from collection where claim_id = ${claim.id} and status = 'CONFIRMED'`)).rows[0] as { s: string };
        const rest = D(claim.receivableAmount).minus(got.s);
        if (amount.gt(rest)) throw new BadRequestException({ code: 'OVER_COLLECT', message: `남은 청구액(${rest.toFixed(0)}원)보다 많습니다` });
      }
      let fundAccountId: string;
      let bankAccountId: string | null = null;
      if (dto.bankAccountId) {
        const [b] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, dto.bankAccountId), eq(bankAccounts.companyId, ctx.companyId!), eq(bankAccounts.isActive, true)));
        if (!b) throw new BadRequestException({ code: 'BAD_BANK', message: '입금 계좌를 다시 선택해 주세요' });
        fundAccountId = b.accountId;
        bankAccountId = b.id;
      } else fundAccountId = await this.ledger.ruleAccount(tx, ctx.companyId!, dto.method === 'CASH' ? 'CASH' : 'BANK_DEFAULT');
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'RC', dto.collectDate);
      const [x] = await tx.insert(collections).values({ companyId: ctx.companyId!, projectId, vendorId, claimId: claim?.id ?? null, code, kind: dto.kind, collectDate: dto.collectDate, amount: moneyStr(amount), method: dto.method, bankAccountId, memo: dto.memo, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      const credit = await this.ledger.ruleAccount(tx, ctx.companyId!, dto.kind === 'ADVANCE' ? 'ADVANCE_RECEIVED' : dto.kind === 'RETENTION' ? 'RETAINAGE_AR' : 'AR');
      await this.ledger.post(tx, ctx, {
        date: dto.collectDate, description: `수금 ${code} ${KIND_LABEL[dto.kind]} · ${p.name}`, sourceType: 'COLLECTION', sourceId: x.id, sourceCode: code,
        lines: [{ accountId: fundAccountId, debit: amount, bankAccountId, vendorId, memo: `${KIND_LABEL[dto.kind]} 입금` }, { accountId: credit, credit: amount, vendorId, projectId, memo: claim ? `${claim.claimNo}회 기성 수금` : KIND_LABEL[dto.kind] }],
      });
      if (claim) await this.refreshClaim(tx, claim.id);
      await this.audit.fromCtx(ctx, { action: 'COLLECT', resource: 'claim', resourceId: claim?.id ?? projectId, summary: `수금 ${code} ${p.name} ${KIND_LABEL[dto.kind]} ${amount.toFixed(0)}원 (${dto.collectDate})` }, tx);
      return x;
    });
  }

  async cancelCollection(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [x] = await tx.select().from(collections).where(and(eq(collections.id, id), eq(collections.companyId, ctx.companyId!)));
      if (!x || !this.access.canSeeProject(ctx, x.projectId)) throw notFound('수금');
      if (x.status !== 'CONFIRMED') throw new ConflictException({ code: 'ALREADY', message: '이미 취소되었습니다' });
      if (x.kind === 'ADVANCE') {
        const bal = await this.advanceBalance(x.projectId, tx);
        if (D(bal).lt(x.amount)) throw new ConflictException({ code: 'ADVANCE_USED', message: '이 선급금은 이미 기성에서 공제되었습니다. 해당 기성을 먼저 정리하세요' });
      }
      await tx.update(collections).set({ status: 'CANCELLED', cancelReason: reason, updatedById: ctx.user.id, version: sql`${collections.version} + 1` }).where(eq(collections.id, id));
      await this.ledger.reverseSource(tx, ctx, 'COLLECTION', id, `수금 취소 — ${reason}`);
      if (x.claimId) await this.refreshClaim(tx, x.claimId);
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'claim', resourceId: x.claimId ?? x.projectId, summary: `수금 취소 ${x.code} ${D(x.amount).toFixed(0)}원 — ${reason}` }, tx);
      return { ok: true };
    });
  }

  async collectionList(ctx: AccessContext, q: { projectId?: string; from?: string; to?: string }) {
    const conds: SQL[] = [eq(collections.companyId, ctx.companyId!), this.access.projectScope(ctx, collections.projectId)];
    if (q.projectId) conds.push(eq(collections.projectId, q.projectId));
    if (q.from) conds.push(sql`${collections.collectDate} >= ${q.from}`);
    if (q.to) conds.push(sql`${collections.collectDate} <= ${q.to}`);
    const rows = await this.db.select({ x: collections, projectName: projects.name, vendorName: vendors.name, claimCode: progressClaims.code, claimNo: progressClaims.claimNo, bankName: bankAccounts.name })
      .from(collections).innerJoin(projects, eq(projects.id, collections.projectId)).innerJoin(vendors, eq(vendors.id, collections.vendorId))
      .leftJoin(progressClaims, eq(progressClaims.id, collections.claimId)).leftJoin(bankAccounts, eq(bankAccounts.id, collections.bankAccountId))
      .where(and(...conds)).orderBy(desc(collections.collectDate), desc(collections.code)).limit(500);
    return rows.map(({ x, ...r }) => ({ ...x, ...r, kindLabel: KIND_LABEL[x.kind] }));
  }

  /** 미수금 현황: 현장·발주처별 청구·수금·미수·연체·유보금·선급금 */
  async receivables(ctx: AccessContext) {
    const today = todayKST();
    const rows = (await this.db.execute(sql`
      select p.id project_id, p.code, p.name, p.trade_type, v.id vendor_id, v.name vendor_name,
        coalesce(sum(c.receivable_amount) filter (where c.status in ('APPROVED','INVOICED','PARTIAL','COLLECTED')),0)::text billed,
        coalesce((select sum(x.amount) from collection x where x.project_id = p.id and x.kind = 'CLAIM' and x.status = 'CONFIRMED'),0)::text collected,
        coalesce(sum(c.receivable_amount - coalesce((select sum(x.amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0))
          filter (where c.status in ('APPROVED','INVOICED','PARTIAL') and c.due_date < ${today}),0)::text overdue,
        coalesce(sum(c.retention_amount) filter (where c.status in ('APPROVED','INVOICED','PARTIAL','COLLECTED')),0)::text retention,
        coalesce((select sum(x.amount) from collection x where x.project_id = p.id and x.kind = 'RETENTION' and x.status = 'CONFIRMED'),0)::text retention_collected,
        min(c.due_date) filter (where c.status in ('APPROVED','INVOICED','PARTIAL')) oldest_due
      from progress_claim c join project p on p.id = c.project_id join vendor v on v.id = c.vendor_id
      where c.company_id = ${ctx.companyId}
        ${ctx.scope === 'ASSIGNED' ? (ctx.assignedProjectIds.length ? sql`and p.id in (${sql.join(ctx.assignedProjectIds.map((i) => sql`${i}`), sql`, `)})` : sql`and false`) : sql``}
      group by p.id, v.id order by p.code`)).rows as Record<string, string>[];
    return rows.map((r) => ({ ...r, outstanding: moneyStr(D(r.billed).minus(r.collected)), retentionOutstanding: moneyStr(D(r.retention).minus(r.retention_collected)) }));
  }
}

@ApiTags('매출 · 기성청구·수금')
@Controller()
export class ClaimsController {
  constructor(private readonly svc: ClaimsService, private readonly audit: AuditService) {}

  @Get('progress-claims')
  @RequirePermission('claim', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get('progress-claims/prepare')
  @RequirePermission('claim', 'create')
  prepare(@Ctx() ctx: AccessContext, @Query('projectId', ParseUUIDPipe) projectId: string) {
    return this.svc.prepare(ctx, projectId);
  }

  @Get('progress-claims/export.xlsx')
  @RequirePermission('claim', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>, @Res() res: Response) {
    const d = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    type R = (typeof d.rows)[number];
    const wb = await buildExcel<R>({
      sheet: '기성청구', title: '기성청구 및 수금 현황', rows: d.rows,
      columns: [
        { header: '번호', key: 'c', width: 12, value: (r) => r.code }, { header: '현장', key: 'p', width: 26, value: (r) => r.projectName }, { header: '회차', key: 'n', width: 6, value: (r) => r.claimNo },
        { header: '청구일', key: 'd', width: 11, type: 'date', value: (r) => r.claimDate }, { header: '발주처', key: 'v', width: 18, value: (r) => r.vendorName },
        { header: '금회 기성', key: 's', width: 14, type: 'money', value: (r) => r.thisSupply }, { header: '누적 기성', key: 'cu', width: 14, type: 'money', value: (r) => r.cumulative },
        { header: '기성률', key: 'r', width: 8, value: (r) => `${(Number(r.progressRate) * 100).toFixed(1)}%` },
        { header: '청구액', key: 'rc', width: 14, type: 'money', value: (r) => r.receivableAmount }, { header: '수금액', key: 'co', width: 14, type: 'money', value: (r) => r.collected },
        { header: '미수금', key: 'o', width: 14, type: 'money', value: (r) => r.outstanding }, { header: '수금예정일', key: 'du', width: 11, type: 'date', value: (r) => r.dueDate },
        { header: '상태', key: 'st', width: 11, value: (r) => r.statusLabel },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'claim', summary: `기성청구 엑셀 출력 ${d.rows.length}건` });
    await sendExcel(res, wb, `기성청구_${todayKST()}.xlsx`);
  }

  @Get('progress-claims/:id')
  @RequirePermission('claim', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get('progress-claims/:id/pdf')
  @RequirePermission('claim', 'export')
  async pdf(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buf, name } = await this.svc.pdf(ctx, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }

  @Post('progress-claims')
  @RequirePermission('claim', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(ClaimDto)) dto: ClaimDto) {
    return this.svc.create(ctx, dto);
  }

  @Put('progress-claims/:id')
  @RequirePermission('claim', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ClaimDto.extend({ version: z.coerce.number().int() }))) dto: ClaimDto & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post('progress-claims/:id/submit')
  @HttpCode(200)
  @RequirePermission('claim', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post('progress-claims/:id/cancel')
  @HttpCode(200)
  @RequirePermission('claim', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancel(ctx, id, dto.reason);
  }

  @Post('progress-claims/:id/tax-invoice')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'create')
  invoice(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.createInvoice(ctx, id);
  }

  @Get('collections')
  @RequirePermission('claim', 'read')
  collections(@Ctx() ctx: AccessContext, @Query(new ZodPipe(z.object({ projectId: z.string().uuid().optional(), from: dateStr.optional(), to: dateStr.optional() }))) q: { projectId?: string; from?: string; to?: string }) {
    return this.svc.collectionList(ctx, q);
  }

  @Get('collections/receivables')
  @RequirePermission('claim', 'read')
  receivables(@Ctx() ctx: AccessContext) {
    return this.svc.receivables(ctx);
  }

  @Post('collections')
  @RequirePermission('payment', 'create')
  collect(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CollectionDto)) dto: CollectionDto) {
    return this.svc.collect(ctx, dto);
  }

  @Post('collections/:id/cancel')
  @HttpCode(200)
  @RequirePermission('payment', 'approve')
  cancelCollection(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancelCollection(ctx, id, dto.reason);
  }
}
