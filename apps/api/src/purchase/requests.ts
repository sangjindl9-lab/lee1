/**
 * 구매요청 — 현장에서 필요한 자재를 요청하면 구매담당이 발주서로 만든다.
 * 요청 → (발주서 작성 시 자동) 발주완료 / 반려 / 요청자 취소
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { D } from '../common/money';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { materials, projects, purchaseOrders, purchaseRequestLines, purchaseRequests } from '../db/schema';

const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const RequestDto = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  title: z.string().trim().min(1, '요청 제목을 입력해 주세요').max(200),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('').transform(() => null)),
  memo: optText(1000),
  lines: z.array(z.object({
    materialId: z.string().uuid().optional().nullable(),
    name: z.string().trim().min(1, '품명을 입력해 주세요').max(200),
    spec: optText(200),
    unit: z.string().trim().min(1).max(20),
    qty: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/,/g, '')).refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, '수량은 0보다 커야 합니다'),
    memo: optText(200),
  })).min(1, '품목을 하나 이상 입력해 주세요').max(300),
});
type RequestDto = z.infer<typeof RequestDto>;
const ListQ = z.object({
  status: z.enum(['REQUESTED', 'ORDERED', 'REJECTED', 'CANCELLED']).optional().or(z.literal('').transform(() => undefined)),
  projectId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export const PR_STATUS_LABEL = { REQUESTED: '요청', ORDERED: '발주완료', REJECTED: '반려', CANCELLED: '취소' } as const;

@Injectable()
export class PurchaseRequestsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly access: AccessService, private readonly numbering: NumberingService, private readonly audit: AuditService) {}

  private scope(ctx: AccessContext) {
    return and(eq(purchaseRequests.companyId, ctx.companyId!), this.access.projectScope(ctx, purchaseRequests.projectId))!;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.status) conds.push(eq(purchaseRequests.status, q.status));
    if (q.projectId) conds.push(eq(purchaseRequests.projectId, q.projectId));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(purchaseRequests.code, like), ilike(purchaseRequests.title, like), ilike(projects.name, like))!);
    }
    const where = and(...conds);
    const [{ count, open }] = await this.db.select({ count: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${purchaseRequests.status}='REQUESTED')::int` }).from(purchaseRequests).innerJoin(projects, eq(projects.id, purchaseRequests.projectId)).where(where);
    const rows = await this.db
      .select({ r: purchaseRequests, projectCode: projects.code, projectName: projects.name, tradeType: projects.tradeType, poCode: purchaseOrders.code })
      .from(purchaseRequests).innerJoin(projects, eq(projects.id, purchaseRequests.projectId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseRequests.poId))
      .where(where).orderBy(sql`case when ${purchaseRequests.status}='REQUESTED' then 0 else 1 end`, desc(purchaseRequests.createdAt)).limit(q.size).offset((q.page - 1) * q.size);
    const counts = rows.length ? await this.db.select({ id: purchaseRequestLines.requestId, n: sql<number>`count(*)::int` }).from(purchaseRequestLines).where(inArray(purchaseRequestLines.requestId, rows.map((r) => r.r.id))).groupBy(purchaseRequestLines.requestId) : [];
    return { total: count, open, page: q.page, size: q.size, rows: rows.map(({ r, ...x }) => ({ ...r, ...x, lineCount: counts.find((c) => c.id === r.id)?.n ?? 0 })) };
  }

  async get(ctx: AccessContext, id: string) {
    const [row] = await this.db
      .select({ r: purchaseRequests, projectCode: projects.code, projectName: projects.name, tradeType: projects.tradeType, poCode: purchaseOrders.code })
      .from(purchaseRequests).innerJoin(projects, eq(projects.id, purchaseRequests.projectId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseRequests.poId))
      .where(and(eq(purchaseRequests.id, id), this.scope(ctx)));
    if (!row) throw notFound('구매요청');
    const lines = await this.db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.requestId, id)).orderBy(asc(purchaseRequestLines.lineNo));
    return { ...row.r, projectCode: row.projectCode, projectName: row.projectName, tradeType: row.tradeType, poCode: row.poCode, lines };
  }

  private async validate(ctx: AccessContext, dto: RequestDto) {
    const [p] = await this.db.select({ id: projects.id, status: projects.status }).from(projects).where(and(eq(projects.id, dto.projectId), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
    if (!p || !this.access.canSeeProject(ctx, p.id)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '선택한 현장을 찾을 수 없습니다', fields: [{ field: 'projectId', message: '현장을 다시 선택해 주세요' }] });
    const mids = [...new Set(dto.lines.map((l) => l.materialId).filter(Boolean))] as string[];
    if (mids.length) {
      const ms = await this.db.select({ id: materials.id }).from(materials).where(and(inArray(materials.id, mids), eq(materials.companyId, ctx.companyId!)));
      if (ms.length !== mids.length) throw new BadRequestException({ code: 'BAD_MATERIAL', message: '자재마스터에 없는 자재가 포함되어 있습니다' });
    }
  }

  private lineRows(dto: RequestDto, requestId: string) {
    return dto.lines.map((l, i) => ({ requestId, lineNo: i + 1, materialId: l.materialId ?? null, name: l.name, spec: l.spec, unit: l.unit, qty: D(l.qty).toFixed(4), memo: l.memo }));
  }

  async create(ctx: AccessContext, dto: RequestDto) {
    await this.validate(ctx, dto);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'RQ');
      const [r] = await tx.insert(purchaseRequests).values({ companyId: ctx.companyId!, projectId: dto.projectId, code, title: dto.title, neededBy: dto.neededBy ?? null, memo: dto.memo, requesterName: ctx.user.name, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await tx.insert(purchaseRequestLines).values(this.lineRows(dto, r.id));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'purchase_request', resourceId: r.id, summary: `구매요청 ${code} ${dto.title} (${dto.lines.length}개 품목)` }, tx);
      return r;
    });
  }

  async update(ctx: AccessContext, id: string, dto: RequestDto & { version: number }) {
    await this.validate(ctx, dto);
    const cur = await this.get(ctx, id);
    if (cur.status !== 'REQUESTED') throw new ConflictException({ code: 'REQUEST_LOCKED', message: '요청 상태에서만 고칠 수 있습니다' });
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(purchaseRequests).set({ projectId: dto.projectId, title: dto.title, neededBy: dto.neededBy ?? null, memo: dto.memo, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${purchaseRequests.version} + 1` })
        .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.version, dto.version), eq(purchaseRequests.status, 'REQUESTED'))).returning();
      if (!r) throw staleVersion();
      await tx.delete(purchaseRequestLines).where(eq(purchaseRequestLines.requestId, id));
      await tx.insert(purchaseRequestLines).values(this.lineRows(dto, id));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'purchase_request', resourceId: id, summary: `구매요청 수정 ${r.code}` }, tx);
      return r;
    });
  }

  async setStatus(ctx: AccessContext, id: string, version: number, to: 'REJECTED' | 'CANCELLED', reason: string) {
    await this.get(ctx, id);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(purchaseRequests).set({ status: to, rejectReason: reason, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${purchaseRequests.version} + 1` })
        .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.version, version), eq(purchaseRequests.status, 'REQUESTED'))).returning();
      if (!r) throw new ConflictException({ code: 'REQUEST_DONE', message: '요청 상태가 바뀌었습니다. 새로고침 후 확인해 주세요' });
      await this.audit.fromCtx(ctx, { action: 'STATUS', resource: 'purchase_request', resourceId: id, summary: `구매요청 ${r.code} ${PR_STATUS_LABEL[to]} — ${reason}` }, tx);
      return r;
    });
  }
}

const Reason = z.object({ version: z.coerce.number().int(), reason: z.string().trim().min(2, '사유를 입력해 주세요').max(300) });

@ApiTags('구매요청')
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly svc: PurchaseRequestsService) {}

  @Get()
  @RequirePermission('purchase', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  @RequirePermission('purchase', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('purchase', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(RequestDto)) dto: RequestDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('purchase', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RequestDto.extend({ version: z.coerce.number().int() }))) dto: RequestDto & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  reject(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) dto: z.infer<typeof Reason>) {
    return this.svc.setStatus(ctx, id, dto.version, 'REJECTED', dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase', 'create')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) dto: z.infer<typeof Reason>) {
    return this.svc.setStatus(ctx, id, dto.version, 'CANCELLED', dto.reason);
  }
}
