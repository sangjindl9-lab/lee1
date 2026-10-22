/**
 * 변경계약 — 최초계약은 현장에 그대로 보존하고, 변경은 회차별로 쌓는다.
 *  - 결재(대표) 전에는 '변경 예정'으로만 표시하고 확정 계약금액·기성 한도에 넣지 않는다
 *  - 승인되면 확정 계약금액이 바뀌고(최초 + 승인 증감), 공기 변경이 있으면 준공예정일도 바뀐다
 *  - 실행예산은 자동으로 바꾸지 않고, 조정안(실행예산 변경 초안)을 만들어 별도 결재를 받게 한다
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq, inArray, ne, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { BudgetService } from '../budget/budget';
import { notFound, staleVersion } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { NumberingService, TaxRateService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { contractRevisions, costCodes, projectBudgets, projects } from '../db/schema';
import { amt, contractNow, dateStr, loadProject, optDate, ReasonDto, VersionDto } from './common';

export const CR_STATUS_LABEL = { DRAFT: '작성중', PENDING: '결재중', APPROVED: '승인', REJECTED: '반려', CANCELLED: '취소' } as const;

const RevisionDto = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  revisionDate: dateStr,
  reason: z.string().trim().min(2, '변경 사유를 입력해 주세요').max(1000),
  deltaAmount: amt.refine((v) => v !== '0', '증감액을 입력해 주세요 (감액은 -)'),
  afterEndDate: optDate,
  budgetLines: z.array(z.object({ costCodeId: z.string().uuid(), delta: amt })).max(30).optional().nullable(),
});
type RevisionDto = z.infer<typeof RevisionDto>;
const ListQ = z.object({ projectId: z.string().uuid().optional(), status: z.string().max(20).optional() });

@Injectable()
export class ContractRevisionsService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
    private readonly approvals: ApprovalsService,
    private readonly budget: BudgetService,
  ) {}

  onModuleInit() {
    this.approvals.register('CONTRACT_CHANGE', {
      resource: 'contract',
      href: (id) => `/contracts/${id}`,
      onApproved: async (tx, id) => {
        const [r] = await tx.update(contractRevisions).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${contractRevisions.version} + 1` }).where(eq(contractRevisions.id, id)).returning();
        if (r.afterEndDate) await tx.update(projects).set({ plannedEndDate: r.afterEndDate, updatedAt: new Date() }).where(eq(projects.id, r.projectId));
      },
      onRejected: async (tx, id) => {
        await tx.update(contractRevisions).set({ status: 'REJECTED', version: sql`${contractRevisions.version} + 1` }).where(eq(contractRevisions.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(contractRevisions).set({ status: 'DRAFT', approvalId: null, version: sql`${contractRevisions.version} + 1` }).where(eq(contractRevisions.id, id));
      },
    });
  }

  private scope(ctx: AccessContext): SQL {
    return and(eq(contractRevisions.companyId, ctx.companyId!), this.access.projectScope(ctx, contractRevisions.projectId))!;
  }

  private async load(ctx: AccessContext, id: string) {
    const [r] = await this.db.select().from(contractRevisions).where(and(eq(contractRevisions.id, id), this.scope(ctx)));
    if (!r) throw notFound('변경계약');
    return r;
  }

  /** 현장별 계약 현황 (최초·확정·변경 예정) */
  async summary(ctx: AccessContext) {
    const rows = (await this.db.execute(sql`
      select p.id, p.code, p.name, p.trade_type, p.status, p.contract_date, p.planned_end_date, p.supply_amount::text original,
        coalesce((select sum(delta_amount) from contract_revision r where r.project_id = p.id and r.status = 'APPROVED'),0)::text approved_delta,
        coalesce((select sum(delta_amount) from contract_revision r where r.project_id = p.id and r.status in ('DRAFT','PENDING')),0)::text pending_delta,
        (select count(*) from contract_revision r where r.project_id = p.id and r.status = 'APPROVED')::int revisions
      from project p where p.company_id = ${ctx.companyId} and p.deleted_at is null
        ${ctx.scope === 'ASSIGNED' ? (ctx.assignedProjectIds.length ? sql`and p.id in (${sql.join(ctx.assignedProjectIds.map((i) => sql`${i}`), sql`, `)})` : sql`and false`) : sql``}
      order by p.created_at desc`)).rows as Record<string, string>[];
    return rows.map((r) => ({ ...r, current: moneyStr(D(r.original).plus(r.approved_delta)) }));
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.projectId) conds.push(eq(contractRevisions.projectId, q.projectId));
    if (q.status) conds.push(eq(contractRevisions.status, q.status as 'DRAFT'));
    else conds.push(ne(contractRevisions.status, 'CANCELLED'));
    const rows = await this.db.select({ r: contractRevisions, projectName: projects.name, projectCode: projects.code }).from(contractRevisions).innerJoin(projects, eq(projects.id, contractRevisions.projectId))
      .where(and(...conds)).orderBy(desc(contractRevisions.revisionDate), desc(contractRevisions.revisionNo)).limit(300);
    return rows.map(({ r, ...x }) => ({ ...r, ...x, statusLabel: CR_STATUS_LABEL[r.status] }));
  }

  async get(ctx: AccessContext, id: string) {
    const r = await this.load(ctx, id);
    const p = await loadProject(this.db, this.access, ctx, r.projectId);
    const c = await contractNow(this.db, r.projectId);
    const history = await this.db.select().from(contractRevisions).where(and(eq(contractRevisions.projectId, r.projectId), inArray(contractRevisions.status, ['APPROVED']))).orderBy(contractRevisions.revisionNo);
    const lines = (r.budgetLines as { costCodeId: string; delta: string }[] | null) ?? [];
    const ccs = lines.length ? await this.db.select({ id: costCodes.id, code: costCodes.code, name: costCodes.name }).from(costCodes).where(inArray(costCodes.id, lines.map((l) => l.costCodeId))) : [];
    const state = await this.approvals.docState(ctx, 'CONTRACT_CHANGE', id);
    return {
      ...r, statusLabel: CR_STATUS_LABEL[r.status], project: { id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, plannedEndDate: p.plannedEndDate, vatRate: p.vatRate },
      contract: c, history, budgetLines: lines.map((l) => ({ ...l, code: ccs.find((x) => x.id === l.costCodeId)?.code, name: ccs.find((x) => x.id === l.costCodeId)?.name })), ...state,
    };
  }

  private async build(ctx: AccessContext, dto: RevisionDto, exceptId?: string) {
    const p = await loadProject(this.db, this.access, ctx, dto.projectId);
    if (p.status === 'SETTLED') throw new BadRequestException({ code: 'SETTLED', message: '정산이 끝난 현장은 계약을 바꿀 수 없습니다' });
    const open = await this.db.select({ id: contractRevisions.id, code: contractRevisions.code }).from(contractRevisions)
      .where(and(eq(contractRevisions.projectId, p.id), inArray(contractRevisions.status, ['DRAFT', 'PENDING', 'REJECTED']), exceptId ? ne(contractRevisions.id, exceptId) : sql`true`));
    if (open.length) throw new ConflictException({ code: 'OPEN_REVISION', message: `처리 중인 변경계약(${open[0].code})이 있습니다. 먼저 승인받거나 취소하세요` });
    const c = await contractNow(this.db, p.id);
    const after = D(c.current).plus(dto.deltaAmount);
    if (after.lt(0)) throw new BadRequestException({ code: 'NEGATIVE', message: '변경 후 계약금액이 0보다 작습니다' });
    const claimed = (await this.db.execute(sql`select coalesce(sum(this_supply),0)::text s from progress_claim where project_id = ${p.id} and status not in ('CANCELLED','REJECTED')`)).rows[0] as { s: string };
    if (after.lt(claimed.s)) throw new BadRequestException({ code: 'BELOW_CLAIMED', message: `이미 청구한 기성(${D(claimed.s).toFixed(0)}원)보다 작게 감액할 수 없습니다` });
    if (dto.budgetLines?.length) {
      const ids = dto.budgetLines.map((l) => l.costCodeId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: 'DUP_COST_CODE', message: '같은 원가항목이 두 번 들어 있습니다' });
      const ccs = await this.db.select({ id: costCodes.id }).from(costCodes).where(and(inArray(costCodes.id, ids), eq(costCodes.companyId, ctx.companyId!)));
      if (ccs.length !== ids.length) throw new BadRequestException({ code: 'BAD_COST_CODE', message: '원가항목을 다시 선택해 주세요' });
    }
    const vatRate = await this.taxRates.rateAt('VAT', dto.revisionDate);
    return { p, c, after, vatRate, deltaVat: moneyStr(D(dto.deltaAmount).mul(vatRate).toDecimalPlaces(0, 1)) };
  }

  async create(ctx: AccessContext, dto: RevisionDto) {
    const b = await this.build(ctx, dto);
    return this.db.transaction(async (tx) => {
      const no = ((await tx.execute(sql`select coalesce(max(revision_no),0)::int n from contract_revision where project_id = ${b.p.id} and status <> 'CANCELLED'`)).rows[0] as { n: number }).n + 1;
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'CR', dto.revisionDate);
      const [r] = await tx.insert(contractRevisions).values({
        companyId: ctx.companyId!, projectId: b.p.id, code, revisionNo: no, revisionDate: dto.revisionDate, reason: dto.reason,
        beforeSupply: b.c.current, deltaAmount: moneyStr(dto.deltaAmount), afterSupply: moneyStr(b.after), vatRate: b.vatRate, deltaVat: b.deltaVat,
        beforeEndDate: b.p.plannedEndDate, afterEndDate: dto.afterEndDate ?? null, budgetLines: (dto.budgetLines ?? null) as never, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'contract', resourceId: r.id, summary: `변경계약 ${no}회 작성 ${code} ${b.p.name} ${D(b.c.current).toFixed(0)} → ${b.after.toFixed(0)}원 — ${dto.reason}` }, tx);
      return r;
    });
  }

  async update(ctx: AccessContext, id: string, dto: RevisionDto & { version: number }) {
    const cur = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'LOCKED', message: '작성중·반려 상태에서만 고칠 수 있습니다' });
    if (dto.projectId !== cur.projectId) throw new BadRequestException({ code: 'PROJECT_FIXED', message: '현장은 바꿀 수 없습니다' });
    const b = await this.build(ctx, dto, id);
    const [r] = await this.db.update(contractRevisions).set({
      revisionDate: dto.revisionDate, reason: dto.reason, beforeSupply: b.c.current, deltaAmount: moneyStr(dto.deltaAmount), afterSupply: moneyStr(b.after), vatRate: b.vatRate, deltaVat: b.deltaVat,
      afterEndDate: dto.afterEndDate ?? null, budgetLines: (dto.budgetLines ?? null) as never, status: 'DRAFT', updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${contractRevisions.version} + 1`,
    }).where(and(eq(contractRevisions.id, id), eq(contractRevisions.version, dto.version))).returning();
    if (!r) throw staleVersion();
    await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'contract', resourceId: id, summary: `변경계약 수정 ${r.code}` });
    return r;
  }

  async submit(ctx: AccessContext, id: string, version: number) {
    const r = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(r.status)) throw new ConflictException({ code: 'LOCKED', message: '이미 상신된 변경계약입니다' });
    const p = await loadProject(this.db, this.access, ctx, r.projectId);
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(contractRevisions).set({ status: 'PENDING', version: sql`${contractRevisions.version} + 1` }).where(and(eq(contractRevisions.id, id), eq(contractRevisions.version, version))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'CONTRACT_CHANGE', docId: id, docCode: r.code, title: `[변경계약 ${r.revisionNo}회] ${p.name} ${D(r.deltaAmount).gt(0) ? '+' : ''}${D(r.deltaAmount).toFixed(0)}원`, amount: moneyStr(D(r.deltaAmount).abs()), projectId: r.projectId });
      await tx.update(contractRevisions).set({ approvalId: a.id }).where(eq(contractRevisions.id, id));
      return { approvalId: a.id };
    });
  }

  async cancel(ctx: AccessContext, id: string, reason: string) {
    const r = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(r.status)) throw new ConflictException({ code: 'LOCKED', message: r.status === 'PENDING' ? '결재 중입니다. 먼저 결재를 회수하세요' : '승인된 변경계약은 취소할 수 없습니다. 감액 변경계약을 새로 작성하세요' });
    const [u] = await this.db.update(contractRevisions).set({ status: 'CANCELLED', updatedById: ctx.user.id, version: sql`${contractRevisions.version} + 1` }).where(eq(contractRevisions.id, id)).returning();
    await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'contract', resourceId: id, summary: `변경계약 취소 ${r.code} — ${reason}` });
    return u;
  }

  /** 승인된 변경계약의 실행예산 조정안 → 실행예산 변경 초안 (별도 결재) */
  async budgetDraft(ctx: AccessContext, id: string) {
    const r = await this.load(ctx, id);
    if (r.status !== 'APPROVED') throw new ConflictException({ code: 'NOT_APPROVED', message: '승인된 변경계약만 실행예산 조정안을 만들 수 있습니다' });
    if (r.budgetRevisionId) throw new ConflictException({ code: 'ALREADY', message: '이미 실행예산 조정안을 만들었습니다' });
    const lines = (r.budgetLines as { costCodeId: string; delta: string }[] | null) ?? [];
    if (!lines.length) throw new BadRequestException({ code: 'NO_LINES', message: '이 변경계약에는 실행예산 조정 내용이 없습니다' });
    const cur = await this.db.select().from(projectBudgets).where(eq(projectBudgets.projectId, r.projectId));
    const br = await this.budget.createRevision(ctx, r.projectId, {
      title: `변경계약 ${r.revisionNo}회 반영 (${r.code})`, reason: `변경계약 ${r.code}: ${r.reason}`,
      lines: lines.map((l) => {
        const after = D(cur.find((c) => c.costCodeId === l.costCodeId)?.amount ?? 0).plus(l.delta);
        if (after.lt(0)) throw new BadRequestException({ code: 'NEGATIVE_BUDGET', message: '조정 후 실행예산이 0보다 작은 원가항목이 있습니다' });
        return { costCodeId: l.costCodeId, afterAmount: after.toFixed(0), memo: `변경계약 ${r.code}` };
      }),
    });
    await this.db.update(contractRevisions).set({ budgetRevisionId: br.id }).where(eq(contractRevisions.id, id));
    return { budgetRevisionId: br.id };
  }
}

@ApiTags('현장 · 변경계약')
@Controller('contract-revisions')
export class ContractRevisionsController {
  constructor(private readonly svc: ContractRevisionsService) {}

  @Get('summary')
  @RequirePermission('contract', 'read')
  summary(@Ctx() ctx: AccessContext) {
    return this.svc.summary(ctx);
  }

  @Get()
  @RequirePermission('contract', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  @RequirePermission('contract', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('contract', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(RevisionDto)) dto: RevisionDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('contract', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RevisionDto.extend({ version: z.coerce.number().int() }))) dto: RevisionDto & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('contract', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('contract', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancel(ctx, id, dto.reason);
  }

  @Post(':id/budget-draft')
  @HttpCode(200)
  @RequirePermission('budget', 'create')
  budgetDraft(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.budgetDraft(ctx, id);
  }
}
