/**
 * 하도급·외주 — 계약(대표 결재) → 변경계약(이력) → 기성 신청·승인(결재) → 지급결의(원천: 하도급 기성) → 정산(유보금 지급)
 *  - 하도급 기성 승인 = 원가 발생: (외주비·부가세대급금 / 외상매입금·하도급유보금)
 *  - 발주확정(계약금액)과 발생원가(승인 기성)와 지급액은 각각 따로 집계
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray, ne, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerService } from '../accounting/ledger.service';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { NumberingService, TaxRateService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { costCodes, paymentRequestLines, projects, subClaims, subcontractRevisions, subcontracts, vendors } from '../db/schema';
import { PaymentsService } from '../payments/payments';
import { amt, contractNow, dateStr, loadProject, optDate, optText, posAmt, rateIn, ReasonDto, VersionDto } from './common';

export const SC_STATUS_LABEL = { DRAFT: '작성중', PENDING: '결재중', ACTIVE: '진행', REJECTED: '반려', COMPLETED: '정산 완료', CANCELLED: '취소' } as const;
export const SUBCLAIM_STATUS_LABEL = { DRAFT: '작성중', PENDING: '결재중', APPROVED: '승인', REJECTED: '반려', CANCELLED: '취소' } as const;

const SubDto = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  vendorId: z.string().uuid('협력업체를 선택해 주세요'),
  costCodeId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1, '계약명을 입력해 주세요').max(200),
  contractDate: dateStr,
  startDate: optDate, endDate: optDate,
  amount: posAmt.refine((v) => Number(v) > 0, '계약금액을 입력해 주세요'),
  retentionRate: rateIn.default('0'),
  guaranteeType: optText(50), guaranteeNo: optText(80), guaranteeAmount: posAmt.optional().nullable(), guaranteeExpiry: optDate,
  scope: optText(2000), memo: optText(1000),
});
type SubDto = z.infer<typeof SubDto>;
const RevDto = z.object({ revisionDate: dateStr, deltaAmount: amt.refine((v) => v !== '0', '증감액을 입력해 주세요'), reason: z.string().trim().min(2, '변경 사유를 입력해 주세요').max(500), version: z.coerce.number().int() });
const SubClaimDto = z.object({ claimDate: dateStr, thisAmount: posAmt.refine((v) => Number(v) > 0, '금회 기성 금액을 입력해 주세요'), memo: optText(500), progressRate: rateIn.optional() });

@Injectable()
export class SubcontractsService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.approvals.register('SUBCONTRACT', {
      resource: 'subcontract',
      href: (id) => `/subcontracts/${id}`,
      onApproved: async (tx, id) => {
        await tx.update(subcontracts).set({ status: 'ACTIVE', approvedAt: new Date(), version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id));
      },
      onRejected: async (tx, id) => {
        await tx.update(subcontracts).set({ status: 'REJECTED', version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(subcontracts).set({ status: 'DRAFT', approvalId: null, version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id));
      },
    });
    this.approvals.register('SUB_CLAIM', {
      resource: 'subcontract',
      href: (id) => `/subcontracts/claims/${id}`,
      onApproved: async (tx, id, ctx) => {
        const [c] = await tx.update(subClaims).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${subClaims.version} + 1` }).where(eq(subClaims.id, id)).returning();
        await this.postCost(tx, ctx, c);
        await tx.update(subcontracts).set({ progressRate: c.progressRate }).where(eq(subcontracts.id, c.subcontractId));
      },
      onRejected: async (tx, id) => {
        await tx.update(subClaims).set({ status: 'REJECTED', version: sql`${subClaims.version} + 1` }).where(eq(subClaims.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(subClaims).set({ status: 'DRAFT', approvalId: null, version: sql`${subClaims.version} + 1` }).where(eq(subClaims.id, id));
      },
    });
    // 지급결의 원천: 하도급 기성 (유보금 제외 + 세액)
    this.payments.registerSource('SUB_CLAIM', {
      label: '하도급 기성', payableRule: 'AP_TRADE',
      resolve: async (tx, ctx, ids) => {
        const rows = await tx.select({ c: subClaims, title: subcontracts.title, costCodeId: subcontracts.costCodeId }).from(subClaims).innerJoin(subcontracts, eq(subcontracts.id, subClaims.subcontractId))
          .where(and(inArray(subClaims.id, ids), eq(subClaims.companyId, ctx.companyId!)));
        if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_SOURCE', message: '하도급 기성을 찾을 수 없습니다' });
        for (const r of rows) if (r.c.status !== 'APPROVED') throw new BadRequestException({ code: 'NOT_APPROVED', message: `${r.c.code}: 승인된 하도급 기성만 지급할 수 있습니다` });
        return rows.map(({ c, title, costCodeId }) => ({ id: c.id, code: c.code, description: `${title} ${c.claimNo}회 기성${D(c.retentionAmount).gt(0) ? ` (유보 ${D(c.retentionAmount).toFixed(0)}원 제외)` : ''}`, projectId: c.projectId, vendorId: c.vendorId, costCodeId, supplyAmount: moneyStr(D(c.thisAmount).minus(c.retentionAmount)), vatAmount: c.vatAmount }));
      },
      available: async (ctx, q) => {
        const conds: SQL[] = [eq(subClaims.companyId, ctx.companyId!), eq(subClaims.status, 'APPROVED'), sql`not exists (select 1 from ${paymentRequestLines} l where l.active_source_key = 'SUB_CLAIM:' || ${subClaims.id}::text)`];
        if (q.vendorId) conds.push(eq(subClaims.vendorId, q.vendorId));
        if (q.projectId) conds.push(eq(subClaims.projectId, q.projectId));
        return this.db.select({ id: subClaims.id, code: subClaims.code, claimNo: subClaims.claimNo, claimDate: subClaims.claimDate, title: subcontracts.title, payableAmount: subClaims.payableAmount, thisAmount: subClaims.thisAmount, vatAmount: subClaims.vatAmount, retentionAmount: subClaims.retentionAmount, projectName: projects.name })
          .from(subClaims).innerJoin(subcontracts, eq(subcontracts.id, subClaims.subcontractId)).innerJoin(projects, eq(projects.id, subClaims.projectId)).where(and(...conds)).orderBy(asc(subClaims.claimDate)).limit(300);
      },
    });
    // 지급결의 원천: 하도급 유보금 (정산 완료된 계약)
    this.payments.registerSource('SUB_RETENTION', {
      label: '하도급 유보금', payableRule: 'RETAINAGE_AP',
      resolve: async (tx, ctx, ids) => {
        const rows = await tx.select().from(subcontracts).where(and(inArray(subcontracts.id, ids), eq(subcontracts.companyId, ctx.companyId!)));
        if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_SOURCE', message: '하도급 계약을 찾을 수 없습니다' });
        const out = [];
        for (const s of rows) {
          if (s.status !== 'COMPLETED') throw new BadRequestException({ code: 'NOT_COMPLETED', message: `${s.code}: 정산이 끝난 계약만 유보금을 지급할 수 있습니다` });
          const r = (await tx.execute(sql`select coalesce(sum(retention_amount),0)::text s from sub_claim where subcontract_id = ${s.id} and status = 'APPROVED'`)).rows[0] as { s: string };
          if (D(r.s).lte(0)) throw new BadRequestException({ code: 'NO_RETENTION', message: `${s.code}: 지급할 유보금이 없습니다` });
          out.push({ id: s.id, code: s.code, description: `${s.title} 하도급 유보금 지급`, projectId: s.projectId, vendorId: s.vendorId, costCodeId: s.costCodeId, supplyAmount: moneyStr(r.s), vatAmount: '0' });
        }
        return out;
      },
      available: async (ctx, q) => {
        const conds: SQL[] = [eq(subcontracts.companyId, ctx.companyId!), eq(subcontracts.status, 'COMPLETED'), sql`not exists (select 1 from payment_request_line l where l.active_source_key = 'SUB_RETENTION:' || subcontract.id::text)`,
          sql`not exists (select 1 from payment_request_line l join payment_request r on r.id = l.request_id where l.source_type = 'SUB_RETENTION' and l.source_id = subcontract.id and r.status = 'PAID')`];
        if (q.vendorId) conds.push(eq(subcontracts.vendorId, q.vendorId));
        return this.db.select({ id: subcontracts.id, code: subcontracts.code, title: subcontracts.title, retention: sql<string>`(select coalesce(sum(retention_amount),0) from sub_claim where subcontract_id = subcontract.id and status = 'APPROVED')::text` })
          .from(subcontracts).where(and(...conds)).limit(200);
      },
    });
  }

  /** 하도급 기성 승인 분개 — 원가 발생 */
  private async postCost(tx: Tx, ctx: AccessContext, c: typeof subClaims.$inferSelect) {
    const [s] = await tx.select().from(subcontracts).where(eq(subcontracts.id, c.subcontractId));
    const costAcc = await this.ledger.costAccount(tx, ctx.companyId!, s.costCodeId);
    const lines = [
      { accountId: costAcc, debit: c.thisAmount, projectId: c.projectId, costCodeId: s.costCodeId, vendorId: c.vendorId, memo: `${s.title} ${c.claimNo}회 기성` },
      ...(D(c.vatAmount).gt(0) ? [{ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'VAT_IN'), debit: c.vatAmount, vendorId: c.vendorId, memo: '하도급 기성 매입세액' }] : []),
      { accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_TRADE'), credit: D(c.thisAmount).minus(c.retentionAmount).plus(c.vatAmount), vendorId: c.vendorId, projectId: c.projectId, memo: `${s.title} ${c.claimNo}회 기성` },
      ...(D(c.retentionAmount).gt(0) ? [{ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'RETAINAGE_AP'), credit: c.retentionAmount, vendorId: c.vendorId, projectId: c.projectId, memo: '하도급 유보금' }] : []),
    ];
    await this.ledger.post(tx, ctx, { date: c.claimDate, description: `하도급 기성 ${c.code} ${s.title} ${c.claimNo}회`, sourceType: 'SUB_CLAIM', sourceId: c.id, sourceCode: c.code, lines });
  }

  private scope(ctx: AccessContext): SQL {
    return and(eq(subcontracts.companyId, ctx.companyId!), this.access.projectScope(ctx, subcontracts.projectId))!;
  }

  private async load(ctx: AccessContext, id: string, tx: Tx | DB = this.db) {
    const [s] = await tx.select().from(subcontracts).where(and(eq(subcontracts.id, id), this.scope(ctx)));
    if (!s) throw notFound('하도급 계약');
    return s;
  }

  async list(ctx: AccessContext, q: { projectId?: string; status?: string }) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.projectId) conds.push(eq(subcontracts.projectId, q.projectId));
    if (q.status) conds.push(eq(subcontracts.status, q.status as 'ACTIVE'));
    else conds.push(ne(subcontracts.status, 'CANCELLED'));
    const rows = await this.db.select({
      s: subcontracts, projectName: projects.name, projectCode: projects.code, tradeType: projects.tradeType, vendorName: vendors.name, costCodeName: costCodes.name,
      claimed: sql<string>`coalesce((select sum(this_amount) from sub_claim c where c.subcontract_id = ${subcontracts.id} and c.status = 'APPROVED'),0)::text`,
      pending: sql<string>`coalesce((select sum(this_amount) from sub_claim c where c.subcontract_id = ${subcontracts.id} and c.status in ('DRAFT','PENDING')),0)::text`,
      paid: sql<string>`coalesce((select sum(l.total_amount) from payment_request_line l join payment_request r on r.id = l.request_id where r.status = 'PAID' and ((l.source_type = 'SUB_CLAIM' and l.source_id in (select id from sub_claim where subcontract_id = ${subcontracts.id})) or (l.source_type = 'SUB_RETENTION' and l.source_id = ${subcontracts.id}))),0)::text`,
      retention: sql<string>`coalesce((select sum(retention_amount) from sub_claim c where c.subcontract_id = ${subcontracts.id} and c.status = 'APPROVED'),0)::text`,
    }).from(subcontracts).innerJoin(projects, eq(projects.id, subcontracts.projectId)).innerJoin(vendors, eq(vendors.id, subcontracts.vendorId)).innerJoin(costCodes, eq(costCodes.id, subcontracts.costCodeId))
      .where(and(...conds)).orderBy(desc(subcontracts.contractDate)).limit(500);
    const pc = new Map<string, string>();
    for (const pid of [...new Set(rows.map((r) => r.s.projectId))]) pc.set(pid, (await contractNow(this.db, pid)).current);
    return rows.map(({ s, ...x }) => ({ ...s, ...x, statusLabel: SC_STATUS_LABEL[s.status], balance: moneyStr(D(s.currentAmount).minus(x.claimed)), subRate: D(pc.get(s.projectId) ?? 0).gt(0) ? D(s.currentAmount).div(pc.get(s.projectId)!).toFixed(4) : null }));
  }

  async get(ctx: AccessContext, id: string) {
    const s = await this.load(ctx, id);
    const [[p], [v], [cc], revisions, claims, state, contract] = await Promise.all([
      this.db.select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType }).from(projects).where(eq(projects.id, s.projectId)),
      this.db.select({ id: vendors.id, name: vendors.name, bizRegNo: vendors.bizRegNo, ceoName: vendors.ceoName, bizStatus: vendors.bizStatus }).from(vendors).where(eq(vendors.id, s.vendorId)),
      this.db.select({ id: costCodes.id, code: costCodes.code, name: costCodes.name }).from(costCodes).where(eq(costCodes.id, s.costCodeId)),
      this.db.select().from(subcontractRevisions).where(eq(subcontractRevisions.subcontractId, id)).orderBy(asc(subcontractRevisions.revisionNo)),
      this.db.select().from(subClaims).where(eq(subClaims.subcontractId, id)).orderBy(asc(subClaims.claimNo)),
      this.approvals.docState(ctx, 'SUBCONTRACT', id),
      contractNow(this.db, s.projectId),
    ]);
    const paidRows = (await this.db.execute(sql`select l.source_type, l.source_id, r.id request_id, r.code, r.status from payment_request_line l join payment_request r on r.id = l.request_id
      where r.status <> 'CANCELLED' and ((l.source_type = 'SUB_CLAIM' and l.source_id in (select id from sub_claim where subcontract_id = ${id})) or (l.source_type = 'SUB_RETENTION' and l.source_id = ${id}))`)).rows as { source_type: string; source_id: string; request_id: string; code: string; status: string }[];
    const approved = claims.filter((c) => c.status === 'APPROVED');
    const claimed = approved.reduce((a, c) => a.plus(c.thisAmount), D(0));
    const retention = approved.reduce((a, c) => a.plus(c.retentionAmount), D(0));
    return {
      ...s, statusLabel: SC_STATUS_LABEL[s.status], project: p, vendor: v, costCode: cc, revisions,
      claims: claims.map((c) => ({ ...c, statusLabel: SUBCLAIM_STATUS_LABEL[c.status], payment: paidRows.find((r) => r.source_type === 'SUB_CLAIM' && r.source_id === c.id) ?? null })),
      retentionPayment: paidRows.find((r) => r.source_type === 'SUB_RETENTION') ?? null,
      totals: { claimed: moneyStr(claimed), balance: moneyStr(D(s.currentAmount).minus(claimed)), retention: moneyStr(retention), rate: D(s.currentAmount).gt(0) ? claimed.div(s.currentAmount).toFixed(4) : '0' },
      subRate: D(contract.current).gt(0) ? D(s.currentAmount).div(contract.current).toFixed(4) : null, projectContract: contract.current, ...state,
    };
  }

  private async validate(ctx: AccessContext, dto: SubDto) {
    const p = await loadProject(this.db, this.access, ctx, dto.projectId);
    if (p.status === 'SETTLED') throw new BadRequestException({ code: 'SETTLED', message: '정산이 끝난 현장입니다' });
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, dto.vendorId), eq(vendors.companyId, ctx.companyId!)));
    if (!v) throw new BadRequestException({ code: 'BAD_VENDOR', message: '협력업체를 다시 선택해 주세요' });
    if (v.bizStatus === 'CLOSED' || v.bizStatus === 'SUSPENDED') throw new BadRequestException({ code: 'VENDOR_CLOSED', message: `${v.name}은(는) ${v.bizStatus === 'CLOSED' ? '폐업' : '휴업'} 사업자입니다` });
    let costCodeId = dto.costCodeId;
    if (!costCodeId) {
      const [c] = await this.db.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.companyId, ctx.companyId!), eq(costCodes.code, 'C04')));
      costCodeId = c?.id;
    }
    const [cc] = costCodeId ? await this.db.select().from(costCodes).where(and(eq(costCodes.id, costCodeId), eq(costCodes.companyId, ctx.companyId!))) : [];
    if (!cc) throw new BadRequestException({ code: 'BAD_COST_CODE', message: '원가항목을 선택해 주세요' });
    if (dto.endDate && dto.startDate && dto.endDate < dto.startDate) throw new BadRequestException({ code: 'BAD_PERIOD', message: '종료일이 시작일보다 빠릅니다' });
    const vatRate = await this.taxRates.rateAt('VAT', dto.contractDate);
    return { p, v, cc, vatRate };
  }

  async create(ctx: AccessContext, dto: SubDto) {
    const b = await this.validate(ctx, dto);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'SC', dto.contractDate);
      const [s] = await tx.insert(subcontracts).values({
        companyId: ctx.companyId!, projectId: b.p.id, vendorId: b.v.id, costCodeId: b.cc.id, code, title: dto.title, contractDate: dto.contractDate, startDate: dto.startDate ?? null, endDate: dto.endDate ?? null,
        originalAmount: moneyStr(dto.amount), currentAmount: moneyStr(dto.amount), vatRate: b.vatRate, retentionRate: dto.retentionRate,
        guaranteeType: dto.guaranteeType, guaranteeNo: dto.guaranteeNo, guaranteeAmount: dto.guaranteeAmount ? moneyStr(dto.guaranteeAmount) : null, guaranteeExpiry: dto.guaranteeExpiry ?? null,
        scope: dto.scope, memo: dto.memo, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'subcontract', resourceId: s.id, summary: `하도급 계약 작성 ${code} ${b.v.name} ${D(dto.amount).toFixed(0)}원 (${b.p.name})` }, tx);
      return s;
    });
  }

  async update(ctx: AccessContext, id: string, dto: SubDto & { version: number }) {
    const cur = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'LOCKED', message: '진행 중인 계약은 변경계약으로 금액을 바꾸세요' });
    const b = await this.validate(ctx, dto);
    const [s] = await this.db.update(subcontracts).set({
      projectId: b.p.id, vendorId: b.v.id, costCodeId: b.cc.id, title: dto.title, contractDate: dto.contractDate, startDate: dto.startDate ?? null, endDate: dto.endDate ?? null,
      originalAmount: moneyStr(dto.amount), currentAmount: moneyStr(dto.amount), vatRate: b.vatRate, retentionRate: dto.retentionRate,
      guaranteeType: dto.guaranteeType, guaranteeNo: dto.guaranteeNo, guaranteeAmount: dto.guaranteeAmount ? moneyStr(dto.guaranteeAmount) : null, guaranteeExpiry: dto.guaranteeExpiry ?? null,
      scope: dto.scope, memo: dto.memo, status: 'DRAFT', updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${subcontracts.version} + 1`,
    }).where(and(eq(subcontracts.id, id), eq(subcontracts.version, dto.version))).returning();
    if (!s) throw staleVersion();
    await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'subcontract', resourceId: id, summary: `하도급 계약 수정 ${s.code}` });
    return s;
  }

  async submit(ctx: AccessContext, id: string, version: number) {
    const s = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(s.status)) throw new ConflictException({ code: 'LOCKED', message: '이미 상신된 계약입니다' });
    const [v] = await this.db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, s.vendorId));
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(subcontracts).set({ status: 'PENDING', version: sql`${subcontracts.version} + 1` }).where(and(eq(subcontracts.id, id), eq(subcontracts.version, version))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'SUBCONTRACT', docId: id, docCode: s.code, title: `[하도급계약] ${v.name} ${s.title}`, amount: s.currentAmount, projectId: s.projectId });
      await tx.update(subcontracts).set({ approvalId: a.id }).where(eq(subcontracts.id, id));
      return { approvalId: a.id };
    });
  }

  async cancel(ctx: AccessContext, id: string, reason: string) {
    const s = await this.load(ctx, id);
    if (s.status === 'PENDING') throw new ConflictException({ code: 'PENDING', message: '결재 중입니다. 먼저 결재를 회수하세요' });
    if (['COMPLETED', 'CANCELLED'].includes(s.status)) throw new ConflictException({ code: 'LOCKED', message: '취소할 수 없는 상태입니다' });
    const live = await this.db.select({ id: subClaims.id }).from(subClaims).where(and(eq(subClaims.subcontractId, id), inArray(subClaims.status, ['DRAFT', 'PENDING', 'APPROVED'])));
    if (live.length) throw new ConflictException({ code: 'HAS_CLAIMS', message: '기성이 있는 계약은 해지할 수 없습니다. 감액 변경 후 정산하세요' });
    const [u] = await this.db.update(subcontracts).set({ status: 'CANCELLED', updatedById: ctx.user.id, version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id)).returning();
    await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'subcontract', resourceId: id, summary: `하도급 계약 취소 ${s.code} — ${reason}` });
    return u;
  }

  /** 변경계약 — 최초금액 보존, 회차 이력. 진행 중인 계약에만 (승인 권한자) */
  async revise(ctx: AccessContext, id: string, dto: z.infer<typeof RevDto>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from subcontract where id = ${id} for update`);
      const s = await this.load(ctx, id, tx);
      if (s.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_ACTIVE', message: '진행 중인 계약만 변경할 수 있습니다' });
      if (s.version !== dto.version) throw staleVersion();
      const after = D(s.currentAmount).plus(dto.deltaAmount);
      const claimed = (await tx.execute(sql`select coalesce(sum(this_amount),0)::text s from sub_claim where subcontract_id = ${id} and status not in ('CANCELLED','REJECTED')`)).rows[0] as { s: string };
      if (after.lt(claimed.s)) throw new BadRequestException({ code: 'BELOW_CLAIMED', message: `이미 기성 처리한 금액(${D(claimed.s).toFixed(0)}원)보다 작게 줄일 수 없습니다` });
      const no = ((await tx.execute(sql`select coalesce(max(revision_no),0)::int n from subcontract_revision where subcontract_id = ${id}`)).rows[0] as { n: number }).n + 1;
      await tx.insert(subcontractRevisions).values({ subcontractId: id, revisionNo: no, revisionDate: dto.revisionDate, beforeAmount: s.currentAmount, deltaAmount: moneyStr(dto.deltaAmount), afterAmount: moneyStr(after), reason: dto.reason, createdById: ctx.user.id });
      const [u] = await tx.update(subcontracts).set({ currentAmount: moneyStr(after), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'REVISE', resource: 'subcontract', resourceId: id, summary: `하도급 변경계약 ${no}회 ${s.code} ${D(s.currentAmount).toFixed(0)} → ${after.toFixed(0)}원 — ${dto.reason}` }, tx);
      return u;
    });
  }

  /** 하도급 정산 — 모든 기성이 끝났는지 확인 후 '정산 완료'. 남은 유보금은 지급결의(원천: 하도급 유보금)로 */
  async complete(ctx: AccessContext, id: string) {
    const s = await this.load(ctx, id);
    if (s.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_ACTIVE', message: '진행 중인 계약만 정산할 수 있습니다' });
    const open = await this.db.select({ code: subClaims.code }).from(subClaims).where(and(eq(subClaims.subcontractId, id), inArray(subClaims.status, ['DRAFT', 'PENDING'])));
    if (open.length) throw new ConflictException({ code: 'OPEN_CLAIM', message: `처리 중인 기성(${open[0].code})이 있습니다` });
    const claimed = (await this.db.execute(sql`select coalesce(sum(this_amount),0)::text s from sub_claim where subcontract_id = ${id} and status = 'APPROVED'`)).rows[0] as { s: string };
    if (!D(claimed.s).eq(s.currentAmount)) throw new ConflictException({ code: 'BALANCE_LEFT', message: `계약잔액 ${D(s.currentAmount).minus(claimed.s).toFixed(0)}원이 남아 있습니다. 마지막 기성을 처리하거나 감액 변경계약을 하세요` });
    const [u] = await this.db.update(subcontracts).set({ status: 'COMPLETED', completedAt: new Date(), progressRate: '1', updatedById: ctx.user.id, version: sql`${subcontracts.version} + 1` }).where(eq(subcontracts.id, id)).returning();
    await this.audit.fromCtx(ctx, { action: 'COMPLETE', resource: 'subcontract', resourceId: id, summary: `하도급 정산 완료 ${s.code} 총 ${D(claimed.s).toFixed(0)}원` });
    return u;
  }

  // ───────── 하도급 기성 ─────────
  async createClaim(ctx: AccessContext, subId: string, dto: z.infer<typeof SubClaimDto>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from subcontract where id = ${subId} for update`);
      const s = await this.load(ctx, subId, tx);
      if (s.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_ACTIVE', message: '결재가 끝난(진행 중) 계약만 기성을 신청할 수 있습니다' });
      const prev = (await tx.execute(sql`select coalesce(sum(this_amount),0)::text s, coalesce(max(claim_no),0)::int n from sub_claim where subcontract_id = ${subId} and status not in ('CANCELLED','REJECTED')`)).rows[0] as { s: string; n: number };
      const thisAmount = D(dto.thisAmount);
      const cumulative = D(prev.s).plus(thisAmount);
      if (cumulative.gt(s.currentAmount)) throw new BadRequestException({ code: 'OVER_CONTRACT', message: `누적 기성(${cumulative.toFixed(0)}원)이 하도급 계약금액(${D(s.currentAmount).toFixed(0)}원)을 넘습니다` });
      const vatRate = await this.taxRates.rateAt('VAT', dto.claimDate);
      const vat = thisAmount.mul(vatRate).toDecimalPlaces(0, 1);
      const retention = thisAmount.mul(s.retentionRate).toDecimalPlaces(0, 1);
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'SB', dto.claimDate);
      const [c] = await tx.insert(subClaims).values({
        companyId: ctx.companyId!, subcontractId: subId, projectId: s.projectId, vendorId: s.vendorId, code, claimNo: prev.n + 1, claimDate: dto.claimDate,
        prevCumulative: moneyStr(prev.s), thisAmount: moneyStr(thisAmount), cumulative: moneyStr(cumulative), progressRate: dto.progressRate ?? cumulative.div(s.currentAmount).toFixed(4),
        vatAmount: moneyStr(vat), retentionAmount: moneyStr(retention), payableAmount: moneyStr(thisAmount.plus(vat).minus(retention)), memo: dto.memo, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'subcontract', resourceId: subId, summary: `하도급 기성 ${c.claimNo}회 신청 ${code} ${thisAmount.toFixed(0)}원` }, tx);
      return c;
    });
  }

  private async loadClaim(ctx: AccessContext, id: string) {
    const [c] = await this.db.select().from(subClaims).where(and(eq(subClaims.id, id), eq(subClaims.companyId, ctx.companyId!)));
    if (!c || !this.access.canSeeProject(ctx, c.projectId)) throw notFound('하도급 기성');
    return c;
  }

  async getClaim(ctx: AccessContext, id: string) {
    const c = await this.loadClaim(ctx, id);
    const s = await this.get(ctx, c.subcontractId);
    const state = await this.approvals.docState(ctx, 'SUB_CLAIM', id);
    const journals = (await this.db.execute(sql`select id, code, status, entry_date from journal_entry where company_id = ${ctx.companyId} and source_type = 'SUB_CLAIM' and source_id = ${id} order by created_at`)).rows;
    return { ...c, statusLabel: SUBCLAIM_STATUS_LABEL[c.status], subcontract: { id: s.id, code: s.code, title: s.title, currentAmount: s.currentAmount, retentionRate: s.retentionRate }, project: s.project, vendor: s.vendor, payment: s.claims.find((x) => x.id === id)?.payment ?? null, journals, ...state };
  }

  async submitClaim(ctx: AccessContext, id: string, version: number) {
    const c = await this.loadClaim(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(c.status)) throw new ConflictException({ code: 'LOCKED', message: '이미 상신된 기성입니다' });
    const [s] = await this.db.select({ title: subcontracts.title }).from(subcontracts).where(eq(subcontracts.id, c.subcontractId));
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(subClaims).set({ status: 'PENDING', version: sql`${subClaims.version} + 1` }).where(and(eq(subClaims.id, id), eq(subClaims.version, version))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'SUB_CLAIM', docId: id, docCode: c.code, title: `[하도급 기성 ${c.claimNo}회] ${s.title} ${D(c.thisAmount).toFixed(0)}원`, amount: c.thisAmount, projectId: c.projectId });
      await tx.update(subClaims).set({ approvalId: a.id }).where(eq(subClaims.id, id));
      return { approvalId: a.id };
    });
  }

  async cancelClaim(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.loadClaim(ctx, id);
      if (c.status === 'PENDING') throw new ConflictException({ code: 'PENDING', message: '결재 중입니다. 먼저 결재를 회수하세요' });
      if (c.status === 'CANCELLED') throw new ConflictException({ code: 'ALREADY', message: '이미 취소되었습니다' });
      if (c.status === 'APPROVED') {
        const used = (await tx.execute(sql`select r.code from payment_request_line l join payment_request r on r.id = l.request_id where l.active_source_key = ${'SUB_CLAIM:' + id}`)).rows as { code: string }[];
        if (used.length) throw new ConflictException({ code: 'IN_PAYMENT', message: `지급결의 ${used[0].code}에 포함되어 있습니다` });
        const later = (await tx.execute(sql`select 1 from sub_claim where subcontract_id = ${c.subcontractId} and claim_no > ${c.claimNo} and status not in ('CANCELLED','REJECTED') limit 1`)).rows.length;
        if (later) throw new ConflictException({ code: 'NOT_LATEST', message: '마지막 회차부터 취소하세요' });
        await this.ledger.reverseSource(tx, ctx, 'SUB_CLAIM', id, `하도급 기성 취소 — ${reason}`);
      }
      const [u] = await tx.update(subClaims).set({ status: 'CANCELLED', updatedById: ctx.user.id, version: sql`${subClaims.version} + 1` }).where(eq(subClaims.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'subcontract', resourceId: c.subcontractId, summary: `하도급 기성 취소 ${c.code} — ${reason}` }, tx);
      return u;
    });
  }
}

@ApiTags('매출 · 하도급·외주')
@Controller('subcontracts')
export class SubcontractsController {
  constructor(private readonly svc: SubcontractsService) {}

  @Get()
  @RequirePermission('subcontract', 'read')
  list(@Ctx() ctx: AccessContext, @Query('projectId') projectId?: string, @Query('status') status?: string) {
    return this.svc.list(ctx, { projectId: projectId && /^[0-9a-f-]{36}$/.test(projectId) ? projectId : undefined, status: status && /^[A-Z]{3,12}$/.test(status) ? status : undefined });
  }

  @Get('claims/:id')
  @RequirePermission('subcontract', 'read')
  getClaim(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getClaim(ctx, id);
  }

  @Post('claims/:id/submit')
  @HttpCode(200)
  @RequirePermission('subcontract', 'create')
  submitClaim(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submitClaim(ctx, id, dto.version);
  }

  @Post('claims/:id/cancel')
  @HttpCode(200)
  @RequirePermission('subcontract', 'update')
  cancelClaim(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancelClaim(ctx, id, dto.reason);
  }

  @Get(':id')
  @RequirePermission('subcontract', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('subcontract', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(SubDto)) dto: SubDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('subcontract', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SubDto.extend({ version: z.coerce.number().int() }))) dto: SubDto & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('subcontract', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('subcontract', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancel(ctx, id, dto.reason);
  }

  @Post(':id/revise')
  @HttpCode(200)
  @RequirePermission('subcontract', 'approve')
  revise(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RevDto)) dto: z.infer<typeof RevDto>) {
    return this.svc.revise(ctx, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('subcontract', 'approve')
  complete(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.complete(ctx, id);
  }

  @Post(':id/claims')
  @RequirePermission('subcontract', 'create')
  createClaim(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SubClaimDto)) dto: z.infer<typeof SubClaimDto>) {
    return this.svc.createClaim(ctx, id, dto);
  }
}
