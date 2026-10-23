import { BadRequestException, Body, CallHandler, ConflictException, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Inject, Injectable, NestInterceptor, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, can, Ctx, ErpRequest, RequirePermission } from '../access/context';
import type { Resource } from '../access/catalog';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { approvalLines, approvals, approvalSteps, memberships, membershipRoles, roles, users } from '../db/schema';
import { activeUserStampId } from '../admin/seals';

export const DOC_TYPES = ['PURCHASE_ORDER', 'PAYMENT_REQUEST', 'BUDGET', 'CLAIM', 'CONTRACT_CHANGE', 'SUBCONTRACT', 'SUB_CLAIM', 'TAX_ISSUE'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_LABEL: Record<DocType, string> = {
  PURCHASE_ORDER: '발주서', PAYMENT_REQUEST: '지급결의서', BUDGET: '실행예산', CLAIM: '기성청구', CONTRACT_CHANGE: '변경계약',
  SUBCONTRACT: '하도급계약', SUB_CLAIM: '하도급 기성', TAX_ISSUE: '세금계산서 발행',
};
/** 이 문서 종류는 결재선 마지막이 반드시 이 역할이어야 한다 (회사 규정) */
const REQUIRED_FINAL: Partial<Record<DocType, string>> = { PURCHASE_ORDER: 'CEO' };
export interface LineStep { title: string; roleKey?: string | null; userId?: string | null }
const CEO_ONLY = [{ title: '승인', roleKey: 'CEO' }];
const DEFAULT_LINES: Record<DocType, LineStep[]> = {
  PURCHASE_ORDER: CEO_ONLY, BUDGET: CEO_ONLY, CONTRACT_CHANGE: CEO_ONLY, SUBCONTRACT: CEO_ONLY, CLAIM: CEO_ONLY,
  PAYMENT_REQUEST: [{ title: '검토', roleKey: 'ACCOUNTING_MANAGER' }, { title: '승인', roleKey: 'CEO' }],
  SUB_CLAIM: [{ title: '검토', roleKey: 'ACCOUNTING_MANAGER' }, { title: '승인', roleKey: 'CEO' }],
  TAX_ISSUE: [{ title: '승인', roleKey: 'ACCOUNTING_MANAGER' }],
};

export interface DocHandler {
  /** 문서를 볼 수 있는 리소스 (권한 확인용) */
  resource: Resource;
  /** 결재함에서 문서로 가는 화면 경로 */
  href: (docId: string) => string;
  onApproved(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
  onRejected(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
  onCancelled(tx: Tx, docId: string, ctx: AccessContext): Promise<void>;
}

const ActDto = z.object({
  action: z.enum(['approve', 'reject', 'hold']),
  comment: z.string().trim().max(1000).optional().nullable(),
  version: z.coerce.number().int().positive(),
});
const StepDto = z.object({
  title: z.string().trim().min(1, '단계 이름을 입력해 주세요').max(10),
  roleKey: z.string().min(1).max(40).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
}).refine((s) => !!s.roleKey !== !!s.userId, '단계마다 역할 또는 결재자 한 명을 지정해 주세요');
const LineDto = z.object({
  docType: z.enum(DOC_TYPES),
  lines: z.array(z.object({
    minAmount: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/,/g, '') || '0').refine((v) => /^\d{1,16}$/.test(v), '금액은 0 이상의 정수'),
    steps: z.array(StepDto).min(1, '결재 단계를 하나 이상 지정해 주세요').max(6),
  })).min(1),
});
/** 상신할 때 이번 문서만 결재선을 따로 지정 — 마지막 결재자는 회사 결재선과 같아야 한다 */
export const CustomLineDto = z.array(StepDto).min(1).max(6);

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

  /** 결재자로 지정할 수 있는 사람 (이 회사 소속·사용 중) */
  async candidates(companyId: string, tx: Tx | DB = this.db) {
    const rows = await tx
      .select({ id: users.id, name: users.name, department: memberships.department, position: memberships.position, roleName: roles.name, roleKey: roles.key })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.companyId, companyId), eq(memberships.isActive, true), eq(users.status, 'ACTIVE')))
      .orderBy(asc(users.name));
    const map = new Map<string, { id: string; name: string; department: string | null; position: string | null; roles: string[]; roleKeys: string[] }>();
    for (const r of rows) {
      const m = map.get(r.id) ?? { id: r.id, name: r.name, department: r.department, position: r.position, roles: [], roleKeys: [] };
      if (r.roleName) m.roles.push(r.roleName);
      if (r.roleKey) m.roleKeys.push(r.roleKey);
      map.set(r.id, m);
    }
    return [...map.values()];
  }

  /** 단계마다 실제 결재자 이름을 붙이고, 지정된 사람·역할이 유효한지 확인 */
  private async resolve(tx: Tx | DB, companyId: string, steps: LineStep[], drafterId: string | null) {
    const people = await this.candidates(companyId, tx);
    const roleNames = await tx.select({ key: roles.key, name: roles.name }).from(roles).where(eq(roles.companyId, companyId));
    const out: (LineStep & { approverNames: string })[] = [];
    for (const s of steps) {
      if (s.userId) {
        const p = people.find((x) => x.id === s.userId);
        if (!p) throw new BadRequestException({ code: 'BAD_APPROVER', message: `'${s.title}' 단계의 결재자가 이 회사 사용자가 아니거나 사용 중지되었습니다` });
        if (drafterId && p.id === drafterId) throw new BadRequestException({ code: 'SELF_APPROVER', message: '본인을 결재자로 지정할 수 없습니다' });
        out.push({ title: s.title, roleKey: null, userId: p.id, approverNames: [p.name, p.position].filter(Boolean).join(' ') });
      } else {
        const holders = people.filter((x) => x.roleKeys.includes(s.roleKey!));
        if (!holders.length) {
          const rn = roleNames.find((r) => r.key === s.roleKey)?.name ?? s.roleKey;
          throw new BadRequestException({ code: 'NO_APPROVER', message: `'${rn}' 역할을 가진 사용자가 없어 상신할 수 없습니다. 관리자에게 결재자 지정을 요청하세요` });
        }
        out.push({ title: s.title, roleKey: s.roleKey!, userId: null, approverNames: holders.map((h) => h.name).join(', ') });
      }
    }
    if (out.some((s, i) => s.userId && out.findIndex((x) => x.userId === s.userId) !== i)) throw new BadRequestException({ code: 'DUP_APPROVER', message: '같은 사람을 결재선에 두 번 넣을 수 없습니다' });
    return out;
  }

  /** 이번 상신에만 쓰는 결재선 확인 — 회사 결재선의 마지막 결재자(최종 승인)는 바꿀 수 없다 */
  async checkCustom(companyId: string, docType: DocType, amount: string, custom: LineStep[], tx: Tx | DB = this.db) {
    const base = await this.lineFor(companyId, docType, amount, tx);
    const fin = base[base.length - 1];
    const last = custom[custom.length - 1];
    const same = fin.userId ? last.userId === fin.userId : !!fin.roleKey && last.roleKey === fin.roleKey;
    if (!same) throw new BadRequestException({ code: 'FINAL_FIXED', message: `마지막 결재(${fin.title})는 회사 결재선대로 두어야 합니다. 중간 단계만 더하거나 뺄 수 있습니다` });
    return custom;
  }

  async lineFor(companyId: string, docType: DocType, amount: string, tx: Tx | DB = this.db): Promise<LineStep[]> {
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
    // 상신 화면에서 이번 문서만 결재선을 따로 지정했으면 그것을, 아니면 회사 결재선
    const custom = ctx.approvalLine?.length ? await this.checkCustom(ctx.companyId!, doc.docType, doc.amount, ctx.approvalLine, tx) : null;
    const steps = custom ?? (await this.lineFor(ctx.companyId!, doc.docType, doc.amount, tx));
    const resolved = await this.resolve(tx, ctx.companyId!, steps, ctx.user.id);
    const [a] = await tx
      .insert(approvals)
      .values({ companyId: ctx.companyId!, docType: doc.docType, docId: doc.docId, docCode: doc.docCode, title: doc.title, amount: moneyStr(doc.amount), projectId: doc.projectId ?? null, drafterId: ctx.user.id, drafterName: ctx.user.name, currentStep: 1 })
      .returning();
    const now = new Date();
    const drafterStamp = await activeUserStampId(tx, ctx.user.id);
    await tx.insert(approvalSteps).values([
      { approvalId: a.id, stepNo: 0, title: '담당', state: 'APPROVED', actedById: ctx.user.id, actedByName: ctx.user.name, actedStampId: drafterStamp, actedAt: now, approverNames: ctx.user.name },
      ...resolved.map((s, i) => ({ approvalId: a.id, stepNo: i + 1, title: s.title, roleKey: s.roleKey ?? null, approverUserId: s.userId ?? null, approverNames: s.approverNames, state: 'WAITING' as const })),
    ]);
    await this.audit.fromCtx(ctx, { action: 'SUBMIT', resource: 'approval', resourceId: doc.docId, summary: `${DOC_LABEL[doc.docType]} 결재 상신 ${doc.docCode} (${resolved.map((s) => `${s.title} ${s.approverNames}`).join(' → ')}${custom ? ', 결재선 직접 지정' : ''})` }, tx);
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
    // 결재는 사람만 — API 키로는 승인·반려할 수 없다 (가드에서도 막지만 한 번 더)
    if (ctx.apiKeyId) throw new ForbiddenException({ code: 'API_NOT_ALLOWED', message: '결재는 API 키로 할 수 없습니다' });
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
      if (!cur || !this.isMine(cur, ctx.user.id, myRoles)) {
        throw new ForbiddenException({ code: 'NOT_APPROVER', message: `지금은 '${cur?.title ?? ''}' 단계로, ${cur?.approverNames ?? '지정된 결재자'} 님이 처리할 차례입니다` });
      }
      const now = new Date();
      const state = dto.action === 'approve' ? 'APPROVED' : dto.action === 'reject' ? 'REJECTED' : 'HOLD';
      const [upd] = await tx
        .update(approvalSteps)
        .set({ state, actedById: ctx.user.id, actedByName: ctx.user.name, actedStampId: state === 'HOLD' ? null : await activeUserStampId(tx, ctx.user.id), actedAt: now, comment: dto.comment ?? null })
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
      list = await this.db
        .select({ a: approvals })
        .from(approvals)
        .innerJoin(approvalSteps, and(eq(approvalSteps.approvalId, approvals.id), eq(approvalSteps.stepNo, approvals.currentStep)))
        .where(and(eq(approvals.companyId, ctx.companyId!), inArray(approvals.status, ['PENDING', 'HOLD']), or(eq(approvalSteps.approverUserId, ctx.user.id), and(isNull(approvalSteps.approverUserId), myRoles.length ? inArray(approvalSteps.roleKey, myRoles) : sql`false`))))
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
    return list.map((a) => ({ ...a, docLabel: DOC_LABEL[a.docType as DocType] ?? a.docType, href: this.handlers.get(a.docType as DocType)?.href(a.docId) ?? null, steps: steps.filter((s) => s.approvalId === a.id) }));
  }

  /** 문서 상세 화면용: 현재 결재·이력·내가 처리할 차례인지·회수 가능한지 */
  async docState(ctx: AccessContext, docType: DocType, docId: string) {
    const history = await this.historyFor(ctx.companyId!, docType, docId);
    const current = history[0] ?? null;
    const myRoles = current ? await this.roleKeys(ctx.companyId!, ctx.user.id) : [];
    const curStep = current?.steps.find((s) => s.stepNo === current.currentStep);
    const canAct = !!current && ['PENDING', 'HOLD'].includes(current.status) && !!curStep && this.isMine(curStep, ctx.user.id, myRoles);
    const canRecall = !!current && current.status === 'PENDING' && current.drafterId === ctx.user.id && !current.steps.some((s) => s.stepNo > 0 && (s.state === 'APPROVED' || s.state === 'HOLD'));
    return { approval: current, approvalHistory: history, canAct, canRecall };
  }

  async counts(ctx: AccessContext) {
    const todo = await this.inbox(ctx, 'todo');
    const [{ mine }] = await this.db.select({ mine: sql<number>`count(*)::int` }).from(approvals).where(and(eq(approvals.companyId, ctx.companyId!), eq(approvals.drafterId, ctx.user.id), inArray(approvals.status, ['PENDING', 'HOLD'])));
    return { todo: todo.length, minePending: mine };
  }

  async getLines(ctx: AccessContext) {
    const rows = await this.db.select().from(approvalLines).where(eq(approvalLines.companyId, ctx.companyId!)).orderBy(approvalLines.docType, asc(approvalLines.minAmount));
    const roleList = await this.db.select({ key: roles.key, name: roles.name }).from(roles).where(eq(roles.companyId, ctx.companyId!));
    return { lines: rows, roles: roleList, people: await this.candidates(ctx.companyId!), required: REQUIRED_FINAL, docTypes: Object.fromEntries([...this.handlers.keys()].map((k) => [k, DOC_LABEL[k]])), defaults: DEFAULT_LINES };
  }

  async setLines(ctx: AccessContext, dto: z.infer<typeof LineDto>) {
    const final = REQUIRED_FINAL[dto.docType];
    for (const l of dto.lines) {
      await this.resolve(this.db, ctx.companyId!, l.steps, null);
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
    const people = await this.candidates(ctx.companyId!);
    const out = steps.map((s) => ({
      ...s,
      approverNames: s.userId ? (people.find((p) => p.id === s.userId)?.name ?? null) : people.filter((p) => p.roleKeys.includes(s.roleKey!)).map((p) => p.name).join(', ') || null,
    }));
    return { drafter: ctx.user.name, docLabel: DOC_LABEL[docType], steps: out };
  }

  /** 이 단계를 내가 처리할 수 있는가 — 사람이 지정됐으면 그 사람만, 아니면 그 역할을 가진 사람 */
  isMine(step: { roleKey: string | null; approverUserId: string | null }, userId: string, myRoles: string[]) {
    return step.approverUserId ? step.approverUserId === userId : !!step.roleKey && myRoles.includes(step.roleKey);
  }

  canView(ctx: AccessContext, a: typeof approvals.$inferSelect, steps: (typeof approvalSteps.$inferSelect)[], myRoles: string[]) {
    if (a.drafterId === ctx.user.id) return true;
    if (steps.some((s) => s.approverUserId === ctx.user.id || (!s.approverUserId && s.roleKey && myRoles.includes(s.roleKey)))) return true;
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
    const dt = (DOC_TYPES as readonly string[]).includes(docType) ? (docType as DocType) : 'PURCHASE_ORDER';
    return this.svc.preview(ctx, dt, /^\d{1,16}(\.\d+)?$/.test(amount ?? '') ? amount : '0');
  }

  @Get('candidates')
  @RequirePermission('approval', 'create')
  candidates(@Ctx() ctx: AccessContext) {
    return this.svc.candidates(ctx.companyId!).then((l) => l.map(({ roleKeys, ...p }) => ({ ...p, roleKeys })));
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


/**
 * 상신 요청(…/submit)에 `approvalLine` 이 함께 오면 검사해서 요청 컨텍스트에 담는다.
 * 문서 종류마다 상신 API 가 따로 있어도, 결재선 지정은 이 한 곳에서 처리된다.
 */
@Injectable()
export class ApprovalLineInterceptor implements NestInterceptor {
  intercept(ec: ExecutionContext, next: CallHandler) {
    const req = ec.switchToHttp().getRequest<ErpRequest>();
    const raw = (req.body as { approvalLine?: unknown } | undefined)?.approvalLine;
    if (req.method === 'POST' && /\/submit$/.test(req.path) && req.ctx && raw !== undefined && raw !== null) {
      const r = CustomLineDto.safeParse(raw);
      if (!r.success) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: r.error.issues[0]?.message ?? '결재선을 확인해 주세요', fields: r.error.issues.map((i) => ({ field: 'approvalLine.' + i.path.join('.'), message: i.message })) });
      req.ctx.approvalLine = r.data;
    }
    return next.handle();
  }
}
