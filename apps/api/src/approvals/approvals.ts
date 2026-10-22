import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, can, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { approvalLines, approvals, approvalSteps, memberships, membershipRoles, roles, users } from '../db/schema';

export type DocType = 'PURCHASE_ORDER';
export const DOC_LABEL: Record<DocType, string> = { PURCHASE_ORDER: '발주서' };
/** 이 문서 종류는 결재선 마지막이 반드시 이 역할이어야 한다 (회사 규정) */
const REQUIRED_FINAL: Partial<Record<DocType, string>> = { PURCHASE_ORDER: 'CEO' };
const DEFAULT_LINES: Record<DocType, { title: string; roleKey: string }[]> = { PURCHASE_ORDER: [{ title: '승인', roleKey: 'CEO' }] };

export interface DocHandler {
  /** 문서를 볼 수 있는 리소스 (권한 확인용) */
  resource: 'purchase';
  onApproved(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
  onRejected(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
  onCancelled(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
}

const ActDto = z.object({
  action: z.enum(['approve', 'reject', 'hold']),
  comment: z.string().trim().max(1000).optional().nullable(),
  version: z.coerce.number().int().positive(),
});
const LineDto = z.object({
  docType: z.enum(['PURCHASE_ORDER']),
  lines: z.array(z.object({
    minAmount: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/,/g, '') || '0').refine((v) => /^\d{1,16}$/.test(v), '금액은 0 이상의 정수'),
    steps: z.array(z.object({ title: z.string().trim().min(1).max(10), roleKey: z.string().min(1).max(40) })).min(1, '결재 단계를 하나 이상 지정해 주세요').max(5),
  })).min(1),
});

@Injectable()
export class ApprovalsService {
  private handlers = new Map<DocType, DocHandler>();
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService, private readonly access: AccessService) {}

  register(docType: DocType, h: DocHandler) {
    this.handlers.set(docType, h);
  }

  /** 사용자가 이 회사에서 가진 역할 키 */
  async roleKeys(companyId: string, userId: string, tx: Tx | DB = this.db): Promise<string[]> {
    const rows = await tx
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.isActive, true)));
    return rows.map((r) => r.key);
  }

  private async holders(tx: Tx, companyId: string, roleKey: string) {
    return tx
      .select({ name: users.name })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(roles.companyId, companyId), eq(roles.key, roleKey), eq(memberships.isActive, true), eq(users.status, 'ACTIVE')));
  }

  async lineFor(companyId: string, docType: DocType, amount: string, tx: Tx | DB = this.db) {
    const [row] = await tx
      .select()
      .from(approvalLines)
      .where(and(eq(approvalLines.companyId, companyId), eq(approvalLines.docType, docType), lte(approvalLines.minAmount, moneyStr(amount))))
      .orderBy(desc(approvalLines.minAmount))
      .limit(1);
    const steps = row?.steps ?? DEFAULT_LINES[docType];
    const final = REQUIRED_FINAL[docType];
    if (final && steps[steps.length - 1]?.roleKey !== final) return [...steps.filter((s) => s.roleKey !== final), { title: '승인', roleKey: final }];
    return steps;
  }

  /** 결재 상신 — 문서 쪽 트랜잭션 안에서 호출 */
  async submit(tx: Tx, ctx: AccessContext, doc: { docType: DocType; docId: string; docCode: string; title: string; amount: string; projectId?: string | null }) {
    const steps = await this.lineFor(ctx.companyId!, doc.docType, doc.amount, tx);
    const roleNames = await tx.select({ key: roles.key, name: roles.name }).from(roles).where(eq(roles.companyId, ctx.companyId!));
    const resolved = [];
    for (const s of steps) {
      const h = await this.holders(tx, ctx.companyId!, s.roleKey);
      if (!h.length) {
        const rn = roleNames.find((r) => r.key === s.roleKey)?.name ?? s.roleKey;
        throw new BadRequestException({ code: 'NO_APPROVER', message: `'${rn}' 역할을 가진 사용자가 없어 상신할 수 없습니다. 관리자에게 결재자 지정을 요청하세요` });
      }
      resolved.push({ ...s, approverNames: h.map((x) => x.name).join(', ') });
    }
    const [a] = await tx
      .insert(approvals)
      .values({ companyId: ctx.companyId!, docType: doc.docType, docId: doc.docId, docCode: doc.docCode, title: doc.title, amount: moneyStr(doc.amount), projectId: doc.projectId ?? null, drafterId: ctx.user.id, drafterName: ctx.user.name, currentStep: 1 })
      .returning();
    const now = new Date();
    await tx.insert(approvalSteps).values([
      { approvalId: a.id, stepNo: 0, title: '담당', state: 'APPROVED', actedById: ctx.user.id, actedByName: ctx.user.name, actedAt: now, approverNames: ctx.user.name },
      ...resolved.map((s, i) => ({ approvalId: a.id, stepNo: i + 1, title: s.title, roleKey: s.roleKey, approverNames: s.approverNames, state: 'WAITING' as const })),
    ]);
    await this.audit.fromCtx(ctx, { action: 'SUBMIT', resource: 'approval', resourceId: doc.docId, summary: `${DOC_LABEL[doc.docType]} 결재 상신 ${doc.docCode} (${resolved.map((s) => s.title).join('→')})` }, tx);
    return a;
  }

  async get(ctx: AccessContext, id: string) {
    const [a] = await this.db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.companyId, ctx.companyId!)));
    if (!a) throw notFound('결재 문서');
    const steps = await this.db.select().from(approvalSteps).where(eq(approvalSteps.approvalId, id)).orderBy(asc(approvalSteps.stepNo));
    return { ...a, steps };
  }

  /** 문서의 결재 이력 전체 (반려 후 재상신 포함) */
  async historyFor(companyId: string, docType: DocType, docId: string) {
    const list = await this.db.select().from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.docType, docType), eq(approvals.docId, docId))).orderBy(desc(approvals.submittedAt));
    if (!list.length) return [];
    const steps = await this.db.select().from(approvalSteps).where(inArray(approvalSteps.approvalId, list.map((a) => a.id))).orderBy(asc(approvalSteps.stepNo));
    return list.map((a) => ({ ...a, steps: steps.filter((s) => s.approvalId === a.id) }));
  }

  /**
   * 승인·반려·보류. 결재 행을 잠그고(FOR UPDATE) 처리하므로 두 사람이 동시에 눌러도 한 번만 반영된다.
   */
  async act(ctx: AccessContext, id: string, dto: z.infer<typeof ActDto>) {
    if (dto.action === 'reject' && !dto.comment) throw new BadRequestException({ code: 'COMMENT_REQUIRED', message: '반려 사유를 입력해 주세요', fields: [{ field: 'comment', message: '반려 사유 필수' }] });
    const myRoles = await this.roleKeys(ctx.companyId!, ctx.user.id);
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from approval where id = ${id} and company_id = ${ctx.companyId} for update`);
      if (!locked.rows.length) throw notFound('결재 문서');
      const [a] = await tx.select().from(approvals).where(eq(approvals.id, id));
      if (a.status !== 'PENDING' && a.status !== 'HOLD') throw new ConflictException({ code: 'APPROVAL_CLOSED', message: '이미 처리가 끝난 결재입니다' });
      if (a.version !== dto.version) throw new ConflictException({ code: 'STALE_VERSION', message: '다른 사람이 먼저 처리했습니다. 새로고침 후 확인해 주세요' });
      const steps = await tx.select().from(approvalSteps).where(eq(approvalSteps.approvalId, id)).orderBy(asc(approvalSteps.stepNo));
      const cur = steps.find((s) => s.stepNo === a.currentStep);
      if (!cur || !cur.roleKey || !myRoles.includes(cur.roleKey)) {
        throw new ForbiddenException({ code: 'NOT_APPROVER', message: `지금은 '${cur?.title ?? ''}' 단계로, ${cur?.approverNames ?? '지정된 결재자'} 님이 처리할 차례입니다` });
      }
      const now = new Date();
      const state = dto.action === 'approve' ? 'APPROVED' : dto.action === 'reject' ? 'REJECTED' : 'HOLD';
      const [upd] = await tx
        .update(approvalSteps)
        .set({ state, actedById: ctx.user.id, actedByName: ctx.user.name, actedAt: now, comment: dto.comment ?? null })
        .where(and(eq(approvalSteps.id, cur.id), inArray(approvalSteps.state, ['WAITING', 'HOLD'])))
        .returning({ id: approvalSteps.id });
      if (!upd) throw new ConflictException({ code: 'ALREADY_ACTED', message: '이미 처리된 단계입니다' });

      const last = steps[steps.length - 1].stepNo === cur.stepNo;
      const h = this.handlers.get(a.docType as DocType);
      let status: (typeof approvals.$inferSelect)['status'] = a.status;
      if (dto.action === 'approve') {
        status = last ? 'APPROVED' : 'PENDING';
        await tx.update(approvals).set({ status, currentStep: last ? a.currentStep : a.currentStep + 1, completedAt: last ? now : null, version: a.version + 1 }).where(eq(approvals.id, id));
        if (last) await h?.onApproved(tx, a.docId, ctx);
      } else if (dto.action === 'reject') {
        status = 'REJECTED';
        await tx.update(approvals).set({ status, completedAt: now, version: a.version + 1 }).where(eq(approvals.id, id));
        await h?.onRejected(tx, a.docId, ctx);
      } else {
        status = 'HOLD';
        await tx.update(approvals).set({ status, version: a.version + 1 }).where(eq(approvals.id, id));
      }
      const label = { approve: last ? '최종 승인' : '승인', reject: '반려', hold: '보류' }[dto.action];
      await this.audit.fromCtx(ctx, { action: `APPROVAL_${dto.action.toUpperCase()}`, resource: 'approval', resourceId: a.docId, summary: `${a.docCode} ${cur.title} ${label}${dto.comment ? ` — ${dto.comment}` : ''}` }, tx);
      return { status, final: last && dto.action === 'approve' };
    });
  }

  /** 회수: 기안자가 아직 아무도 처리하지 않은 결재를 거둬들임 */
  async cancel(ctx: AccessContext, id: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`select id from approval where id = ${id} and company_id = ${ctx.companyId} for update`);
      if (!locked.rows.length) throw notFound('결재 문서');
      const [a] = await tx.select().from(approvals).where(eq(approvals.id, id));
      if (a.drafterId !== ctx.user.id) throw new ForbiddenException({ code: 'NOT_DRAFTER', message: '상신한 본인만 회수할 수 있습니다' });
      if (a.status !== 'PENDING') throw new ConflictException({ code: 'CANNOT_CANCEL', message: '진행 중인 결재만 회수할 수 있습니다' });
      const acted = await tx.select({ id: approvalSteps.id }).from(approvalSteps).where(and(eq(approvalSteps.approvalId, id), sql`${approvalSteps.stepNo} > 0`, inArray(approvalSteps.state, ['APPROVED', 'HOLD'])));
      if (acted.length) throw new ConflictException({ code: 'CANNOT_CANCEL', message: '결재자가 이미 처리한 문서는 회수할 수 없습니다' });
      await tx.update(approvals).set({ status: 'CANCELLED', completedAt: new Date(), version: a.version + 1 }).where(eq(approvals.id, id));
      await this.handlers.get(a.docType as DocType)?.onCancelled(tx, a.docId, ctx);
      await this.audit.fromCtx(ctx, { action: 'APPROVAL_CANCEL', resource: 'approval', resourceId: a.docId, summary: `${a.docCode} 결재 회수` }, tx);
    });
  }

  /** 결재함 */
  async inbox(ctx: AccessContext, box: 'todo' | 'mine' | 'done') {
    const myRoles = await this.roleKeys(ctx.companyId!, ctx.user.id);
    let list: (typeof approvals.$inferSelect)[] = [];
    if (box === 'todo') {
      if (!myRoles.length) return [];
      list = await this.db
        .select({ a: approvals })
        .from(approvals)
        .innerJoin(approvalSteps, and(eq(approvalSteps.approvalId, approvals.id), eq(approvalSteps.stepNo, approvals.currentStep)))
        .where(and(eq(approvals.companyId, ctx.companyId!), inArray(approvals.status, ['PENDING', 'HOLD']), inArray(approvalSteps.roleKey, myRoles)))
        .orderBy(asc(approvals.submittedAt))
        .then((r) => r.map((x) => x.a));
    } else if (box === 'mine') {
      list = await this.db.select().from(approvals).where(and(eq(approvals.companyId, ctx.companyId!), eq(approvals.drafterId, ctx.user.id))).orderBy(desc(approvals.submittedAt)).limit(200);
    } else {
      const ids = await this.db
        .selectDistinct({ id: approvalSteps.approvalId })
        .from(approvalSteps)
        .innerJoin(approvals, eq(approvals.id, approvalSteps.approvalId))
        .where(and(eq(approvals.companyId, ctx.companyId!), eq(approvalSteps.actedById, ctx.user.id), sql`${approvalSteps.stepNo} > 0`));
      if (ids.length) list = await this.db.select().from(approvals).where(inArray(approvals.id, ids.map((i) => i.id))).orderBy(desc(approvals.submittedAt)).limit(200);
    }
    if (!list.length) return [];
    const steps = await this.db.select().from(approvalSteps).where(inArray(approvalSteps.approvalId, list.map((a) => a.id))).orderBy(asc(approvalSteps.stepNo));
    return list.map((a) => ({ ...a, steps: steps.filter((s) => s.approvalId === a.id) }));
  }

  async counts(ctx: AccessContext) {
    const todo = await this.inbox(ctx, 'todo');
    const [{ mine }] = await this.db.select({ mine: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.companyId, ctx.companyId!), eq(approvals.drafterId, ctx.user.id), inArray(approvals.status, ['PENDING', 'HOLD'])));
    return { todo: todo.length, minePending: mine };
  }

  async getLines(ctx: AccessContext) {
    const rows = await this.db.select().from(approvalLines).where(eq(approvalLines.companyId, ctx.companyId!)).orderBy(approvalLines.docType, asc(approvalLines.minAmount));
    const roleList = await this.db.select({ key: roles.key, name: roles.name }).from(roles).where(eq(roles.companyId, ctx.companyId!));
    return { lines: rows, roles: roleList, required: REQUIRED_FINAL, docTypes: DOC_LABEL };
  }

  async setLines(ctx: AccessContext, dto: z.infer<typeof LineDto>) {
    const final = REQUIRED_FINAL[dto.docType];
    for (const l of dto.lines) {
      if (final && l.steps[l.steps.length - 1].roleKey !== final) {
        throw new BadRequestException({ code: 'FINAL_REQUIRED', message: `${DOC_LABEL[dto.docType]}는 회사 규정상 마지막 결재가 대표이사여야 합니다` });
      }
    }
    if (!dto.lines.some((l) => D(l.minAmount).eq(0))) throw new BadRequestException({ code: 'NEED_BASE', message: '0원부터 적용되는 기본 결재선이 하나 있어야 합니다' });
    await this.db.transaction(async (tx) => {
      const before = await tx.select().from(approvalLines).where(and(eq(approvalLines.companyId, ctx.companyId!), eq(approvalLines.docType, dto.docType)));
      await tx.delete(approvalLines).where(and(eq(approvalLines.companyId, ctx.companyId!), eq(approvalLines.docType, dto.docType)));
      await tx.insert(approvalLines).values(dto.lines.map((l) => ({ companyId: ctx.companyId!, docType: dto.docType, minAmount: moneyStr(l.minAmount), steps: l.steps, createdById: ctx.user.id })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'approval_line', summary: `${DOC_LABEL[dto.docType]} 결재선 변경`, before: before.map((b) => ({ minAmount: b.minAmount, steps: b.steps })), after: dto.lines }, tx);
    });
    return this.getLines(ctx);
  }

  /** 상신 전 미리보기: 이 금액이면 어떤 결재선이 걸리는지 */
  async preview(ctx: AccessContext, docType: DocType, amount: string) {
    const steps = await this.lineFor(ctx.companyId!, docType, amount);
    const out = [];
    for (const s of steps) {
      const h = await this.db.transaction((tx) => this.holders(tx, ctx.companyId!, s.roleKey));
      out.push({ ...s, approverNames: h.map((x) => x.name).join(', ') || null });
    }
    return { drafter: ctx.user.name, steps: out };
  }

  canView(ctx: AccessContext, a: typeof approvals.$inferSelect, steps: (typeof approvalSteps.$inferSelect)[], myRoles: string[]) {
    if (a.drafterId === ctx.user.id) return true;
    if (steps.some((s) => s.roleKey && myRoles.includes(s.roleKey))) return true;
    const h = this.handlers.get(a.docType as DocType);
    return !!h && can(ctx, h.resource, 'read') && (!a.projectId || this.access.canSeeProject(ctx, a.projectId));
  }
}

@ApiTags('전자결재')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Get()
  @RequirePermission('approval', 'create')
  inbox(@Ctx() ctx: AccessContext, @Query('box') box: string) {
    return this.svc.inbox(ctx, box === 'mine' ? 'mine' : box === 'done' ? 'done' : 'todo');
  }

  @Get('counts')
  counts(@Ctx() ctx: AccessContext) {
    return this.svc.counts(ctx);
  }

  @Get('preview')
  @RequirePermission('approval', 'create')
  preview(@Ctx() ctx: AccessContext, @Query('docType') docType: string, @Query('amount') amount: string) {
    return this.svc.preview(ctx, docType === 'PURCHASE_ORDER' ? 'PURCHASE_ORDER' : 'PURCHASE_ORDER', /^\d{1,16}(\.\d+)?$/.test(amount ?? '') ? amount : '0');
  }

  @Get('lines')
  @RequirePermission('approval', 'read')
  lines(@Ctx() ctx: AccessContext) {
    return this.svc.getLines(ctx);
  }

  @Put('lines')
  @RequirePermission('approval', 'update')
  setLines(@Ctx() ctx: AccessContext, @Body(new ZodPipe(LineDto)) dto: z.infer<typeof LineDto>) {
    return this.svc.setLines(ctx, dto);
  }

  @Get(':id')
  async get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.svc.get(ctx, id);
    const myRoles = await this.svc.roleKeys(ctx.companyId!, ctx.user.id);
    if (!this.svc.canView(ctx, a, a.steps, myRoles)) throw notFound('결재 문서');
    return a;
  }

  @Post(':id/act')
  @HttpCode(200)
  act(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ActDto)) dto: z.infer<typeof ActDto>) {
    return this.svc.act(ctx, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.cancel(ctx, id);
    return { ok: true };
  }
}

