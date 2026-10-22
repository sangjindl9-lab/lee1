/**
 * 지급결의 → 결재 → 지급 — 지급 요청과 실제 지급(이체)을 분리한다.
 *  - 결재 승인 전에는 지급할 수 없다 (서버 + DB 트리거)
 *  - 지급결의 1건에 유효한 지급은 1건 (DB 부분 고유 인덱스) → 중복 지급 차단
 *  - 같은 검수(원천)를 두 결의에 넣을 수 없다 (활성 원천 키 고유 인덱스)
 *  - 분개: 경비성 결의는 승인 시 (비용/미지급금), 지급 시 (채무/예금). 검수 대금은 검수 때 이미 채무로 잡혀 있어 지급 시만 분개
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerService, PostLine } from '../accounting/ledger.service';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { D, moneyStr, sumMoney } from '../common/money';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { accounts, bankAccounts, costCodes, goodsReceipts, paymentRequestLines, paymentRequests, payments, projects, purchaseOrders, vendors } from '../db/schema';

type Req = typeof paymentRequests.$inferSelect;
type Kind = Req['kind'];
export const PAYREQ_STATUS_LABEL: Record<Req['status'], string> = { DRAFT: '작성중', PENDING: '결재중', APPROVED: '지급대기', REJECTED: '반려', PAID: '지급완료', CANCELLED: '취소' };
export const PAYREQ_KIND_LABEL: Record<Kind, string> = { PURCHASE: '자재대금', SUBCONTRACT: '외주·하도급', EXPENSE: '경비', LABOR: '노무비', OTHER: '기타' };

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식은 YYYY-MM-DD');
const amt = z.union([z.string(), z.number()]).transform((v) => String(v ?? '').replace(/,/g, '').trim() || '0').refine((v) => /^\d{1,15}$/.test(v), '금액은 원 단위 정수로 입력해 주세요');
const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const PayReqLineDto = z.object({
  description: z.string().trim().max(200).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  costCodeId: z.string().uuid().optional().nullable(),
  sourceType: z.enum(['RECEIPT', 'SUB_CLAIM', 'LABOR', 'TAX_INVOICE']).optional().nullable(),
  sourceId: z.string().uuid().optional().nullable(),
  supplyAmount: amt.default('0'),
  vatAmount: amt.default('0'),
  vatDeductible: z.boolean().default(true),
});
export const PayReqDto = z.object({
  kind: z.enum(['PURCHASE', 'SUBCONTRACT', 'EXPENSE', 'LABOR', 'OTHER']),
  title: z.string().trim().min(1, '제목을 입력해 주세요').max(200),
  requestDate: dateStr,
  dueDate: dateStr.optional().nullable().or(z.literal('').transform(() => null)),
  projectId: z.string().uuid().optional().nullable().or(z.literal('').transform(() => null)),
  vendorId: z.string().uuid().optional().nullable().or(z.literal('').transform(() => null)),
  payeeName: optText(100),
  memo: optText(1000),
  lines: z.array(PayReqLineDto).min(1, '지급 항목을 하나 이상 넣어 주세요').max(200),
});
type PayReqDto = z.infer<typeof PayReqDto>;
const ListQ = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'OPEN']).optional().or(z.literal('').transform(() => undefined)),
  kind: z.enum(['PURCHASE', 'SUBCONTRACT', 'EXPENSE', 'LABOR', 'OTHER']).optional().or(z.literal('').transform(() => undefined)),
  projectId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(),
  from: dateStr.optional(), to: dateStr.optional(), q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(500).default(50),
});
const PayDto = z.object({
  version: z.coerce.number().int(),
  payDate: dateStr,
  method: z.enum(['TRANSFER', 'CASH', 'CARD', 'BILL', 'OFFSET']).default('TRANSFER'),
  bankAccountId: z.string().uuid().optional().nullable().or(z.literal('').transform(() => null)),
  memo: optText(300),
});

/** 원천 문서(검수·하도급 기성·노무비 등)를 지급결의 줄로 바꾸는 규칙 — 다른 모듈이 등록한다 */
export interface SourceResolver {
  label: string;
  /** 검증 + 금액 확정. 원천 문서의 금액을 그대로 쓴다 (화면 입력값 무시) */
  resolve(tx: Tx | DB, ctx: AccessContext, ids: string[]): Promise<{ id: string; code: string; description: string; projectId: string | null; vendorId: string | null; costCodeId: string | null; supplyAmount: string; vatAmount: string }[]>;
  /** 결의 작성 화면의 선택 목록 */
  available(ctx: AccessContext, q: { vendorId?: string; projectId?: string }): Promise<unknown[]>;
  /** 지급 시 차변으로 쓸 채무 계정 규칙 키 */
  payableRule: string;
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private sources = new Map<string, SourceResolver>();
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
  ) {}

  registerSource(type: string, r: SourceResolver) {
    this.sources.set(type, r);
  }

  onModuleInit() {
    this.registerSource('RECEIPT', {
      label: '검수',
      payableRule: 'AP_TRADE',
      resolve: async (tx, ctx, ids) => {
        const rows = await tx
          .select({ r: goodsReceipts, poCode: purchaseOrders.code, poTitle: purchaseOrders.title, vendorId: purchaseOrders.vendorId, costCodeId: purchaseOrders.costCodeId })
          .from(goodsReceipts).innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
          .where(and(inArray(goodsReceipts.id, ids), eq(goodsReceipts.companyId, ctx.companyId!)));
        if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_SOURCE', message: '선택한 검수 내역을 찾을 수 없습니다' });
        for (const x of rows) if (x.r.status !== 'CONFIRMED') throw new BadRequestException({ code: 'SOURCE_CANCELLED', message: `취소된 검수(${x.r.code})는 지급할 수 없습니다` });
        return rows.map((x) => ({ id: x.r.id, code: x.r.code, description: `${x.poCode} ${x.poTitle} — 검수 ${x.r.code} (${x.r.receiptDate})`, projectId: x.r.projectId, vendorId: x.vendorId, costCodeId: x.costCodeId, supplyAmount: x.r.supplyAmount, vatAmount: x.r.vatAmount }));
      },
      available: async (ctx, q) => {
        const conds: SQL[] = [eq(goodsReceipts.companyId, ctx.companyId!), eq(goodsReceipts.status, 'CONFIRMED'), this.access.projectScope(ctx, goodsReceipts.projectId),
          sql`not exists (select 1 from ${paymentRequestLines} where ${paymentRequestLines.activeSourceKey} = 'RECEIPT:' || ${goodsReceipts.id}::text)`];
        if (q.vendorId) conds.push(eq(purchaseOrders.vendorId, q.vendorId));
        if (q.projectId) conds.push(eq(goodsReceipts.projectId, q.projectId));
        return this.db
          .select({ id: goodsReceipts.id, code: goodsReceipts.code, receiptDate: goodsReceipts.receiptDate, supplyAmount: goodsReceipts.supplyAmount, vatAmount: goodsReceipts.vatAmount, poId: purchaseOrders.id, poCode: purchaseOrders.code, poTitle: purchaseOrders.title, vendorId: vendors.id, vendorName: vendors.name, projectId: projects.id, projectName: projects.name })
          .from(goodsReceipts).innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
          .where(and(...conds)).orderBy(asc(goodsReceipts.receiptDate)).limit(300);
      },
    });

    this.approvals.register('PAYMENT_REQUEST', {
      resource: 'expense',
      href: (id) => `/payment-requests/${id}`,
      onApproved: async (tx, id, ctx) => {
        const [r] = await tx.update(paymentRequests).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${paymentRequests.version} + 1` }).where(eq(paymentRequests.id, id)).returning();
        await this.postAccrual(tx, ctx, r);
      },
      onRejected: async (tx, id) => {
        await tx.update(paymentRequests).set({ status: 'REJECTED', version: sql`${paymentRequests.version} + 1` }).where(eq(paymentRequests.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(paymentRequests).set({ status: 'DRAFT', approvalId: null, version: sql`${paymentRequests.version} + 1` }).where(eq(paymentRequests.id, id));
      },
    });
  }

  private scope(ctx: AccessContext): SQL {
    // 현장 지정 결의는 현장 범위로, 본사 공통(현장 없음)은 회사 전체 범위 사용자만
    if (ctx.scope === 'ASSIGNED') return and(eq(paymentRequests.companyId, ctx.companyId!), ctx.assignedProjectIds.length ? inArray(paymentRequests.projectId, ctx.assignedProjectIds) : sql`false`)!;
    return eq(paymentRequests.companyId, ctx.companyId!);
  }

  private async load(ctx: AccessContext, id: string, tx: Tx | DB = this.db) {
    const [r] = await tx.select().from(paymentRequests).where(and(eq(paymentRequests.id, id), this.scope(ctx)));
    if (!r) throw notFound('지급결의');
    return r;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.status === 'OPEN') conds.push(inArray(paymentRequests.status, ['PENDING', 'APPROVED']));
    else if (q.status) conds.push(eq(paymentRequests.status, q.status));
    else conds.push(ne(paymentRequests.status, 'CANCELLED'));
    if (q.kind) conds.push(eq(paymentRequests.kind, q.kind));
    if (q.projectId) conds.push(eq(paymentRequests.projectId, q.projectId));
    if (q.vendorId) conds.push(eq(paymentRequests.vendorId, q.vendorId));
    if (q.from) conds.push(gte(paymentRequests.requestDate, q.from));
    if (q.to) conds.push(lte(paymentRequests.requestDate, q.to));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(paymentRequests.code, like), ilike(paymentRequests.title, like), ilike(paymentRequests.payeeName, like))!);
    }
    const where = and(...conds);
    const [agg] = await this.db.select({
      count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${paymentRequests.totalAmount}),0)::text`,
      unpaid: sql<string>`coalesce(sum(${paymentRequests.totalAmount}) filter (where ${paymentRequests.status} = 'APPROVED'),0)::text`,
      paid: sql<string>`coalesce(sum(${paymentRequests.totalAmount}) filter (where ${paymentRequests.status} = 'PAID'),0)::text`,
    }).from(paymentRequests).where(where);
    const rows = await this.db
      .select({ r: paymentRequests, projectCode: projects.code, projectName: projects.name, tradeType: projects.tradeType, vendorName: vendors.name })
      .from(paymentRequests).leftJoin(projects, eq(projects.id, paymentRequests.projectId)).leftJoin(vendors, eq(vendors.id, paymentRequests.vendorId))
      .where(where).orderBy(desc(paymentRequests.requestDate), desc(paymentRequests.code)).limit(q.size).offset((q.page - 1) * q.size);
    return { total: agg.count, page: q.page, size: q.size, sums: { totalAmount: agg.total, unpaid: agg.unpaid, paid: agg.paid }, rows: rows.map(({ r, ...x }) => ({ ...r, ...x, kindLabel: PAYREQ_KIND_LABEL[r.kind], statusLabel: PAYREQ_STATUS_LABEL[r.status] })) };
  }

  async get(ctx: AccessContext, id: string) {
    const r = await this.load(ctx, id);
    const [lines, [project], [vendor], pays, state] = await Promise.all([
      this.db.select({ l: paymentRequestLines, accountCode: accounts.code, accountName: accounts.name, costCodeName: costCodes.name }).from(paymentRequestLines)
        .leftJoin(accounts, eq(accounts.id, paymentRequestLines.accountId)).leftJoin(costCodes, eq(costCodes.id, paymentRequestLines.costCodeId))
        .where(eq(paymentRequestLines.requestId, id)).orderBy(asc(paymentRequestLines.lineNo)),
      r.projectId ? this.db.select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType }).from(projects).where(eq(projects.id, r.projectId)) : Promise.resolve([null]),
      r.vendorId ? this.db.select({ id: vendors.id, name: vendors.name, bizRegNo: vendors.bizRegNo, bankName: vendors.bankName, bankAccountMask: vendors.bankAccountMask, bankHolder: vendors.bankHolder }).from(vendors).where(eq(vendors.id, r.vendorId)) : Promise.resolve([null]),
      this.db.select({ p: payments, bankName: bankAccounts.name }).from(payments).leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId)).where(eq(payments.requestId, id)).orderBy(desc(payments.createdAt)),
      this.approvals.docState(ctx, 'PAYMENT_REQUEST', id),
    ]);
    const journals = (await this.db.execute(sql`select id, code, status, entry_date, source_type, total_debit from journal_entry where company_id = ${ctx.companyId} and ((source_type = 'PAYMENT_REQUEST' and source_id = ${id}) or (source_type = 'PAYMENT' and source_id in (select id from payment where request_id = ${id}))) order by created_at`)).rows;
    return {
      ...r, kindLabel: PAYREQ_KIND_LABEL[r.kind], statusLabel: PAYREQ_STATUS_LABEL[r.status], project, vendor,
      lines: lines.map(({ l, ...x }) => ({ ...l, ...x })),
      payments: pays.map(({ p, bankName }) => ({ ...p, bankName })),
      journals,
      ...state,
    };
  }

  /** 줄 확정: 원천 줄은 원천 금액으로, 직접 입력 줄은 계정 검증 */
  private async prepare(tx: Tx | DB, ctx: AccessContext, dto: PayReqDto) {
    const lines: (Omit<typeof paymentRequestLines.$inferInsert, 'requestId'> & { _projectId?: string | null; _vendorId?: string | null })[] = [];
    const bySource = new Map<string, string[]>();
    for (const l of dto.lines) if (l.sourceType && l.sourceId) bySource.set(l.sourceType, [...(bySource.get(l.sourceType) ?? []), l.sourceId]);
    const resolved = new Map<string, Awaited<ReturnType<SourceResolver['resolve']>>[number]>();
    for (const [type, ids] of bySource) {
      const res = this.sources.get(type);
      if (!res) throw new BadRequestException({ code: 'BAD_SOURCE', message: `지원하지 않는 원천 문서입니다: ${type}` });
      if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: 'DUP_SOURCE', message: '같은 원천 문서가 두 번 들어 있습니다' });
      for (const x of await res.resolve(tx, ctx, ids)) resolved.set(`${type}:${x.id}`, x);
    }
    const accIds = [...new Set(dto.lines.map((l) => l.accountId).filter(Boolean))] as string[];
    const accs = accIds.length ? await tx.select().from(accounts).where(and(inArray(accounts.id, accIds), eq(accounts.companyId, ctx.companyId!))) : [];
    const ccIds = [...new Set(dto.lines.map((l) => l.costCodeId).filter(Boolean))] as string[];
    const ccs = ccIds.length ? await tx.select().from(costCodes).where(and(inArray(costCodes.id, ccIds), eq(costCodes.companyId, ctx.companyId!))) : [];
    for (const [i, l] of dto.lines.entries()) {
      const no = i + 1;
      if (l.sourceType && l.sourceId) {
        const x = resolved.get(`${l.sourceType}:${l.sourceId}`)!;
        if (dto.vendorId && x.vendorId && x.vendorId !== dto.vendorId) throw new BadRequestException({ code: 'SOURCE_VENDOR', message: `${x.code}은(는) 다른 거래처의 문서입니다` });
        lines.push({
          lineNo: no, description: l.description || x.description, sourceType: l.sourceType, sourceId: x.id, sourceCode: x.code, activeSourceKey: `${l.sourceType}:${x.id}`,
          costCodeId: x.costCodeId, supplyAmount: moneyStr(x.supplyAmount), vatAmount: moneyStr(x.vatAmount), totalAmount: moneyStr(D(x.supplyAmount).plus(x.vatAmount)), vatDeductible: true,
          _projectId: x.projectId, _vendorId: x.vendorId,
        });
        continue;
      }
      if (!l.description) throw new BadRequestException({ code: 'LINE_DESC', message: `${no}번째 줄의 내용을 입력해 주세요` });
      let accountId = l.accountId ?? null;
      const cc = l.costCodeId ? ccs.find((c) => c.id === l.costCodeId) : null;
      if (l.costCodeId && !cc) throw new BadRequestException({ code: 'BAD_COST_CODE', message: `${no}번째 줄의 원가항목을 다시 선택해 주세요` });
      if (!accountId && cc) accountId = cc.accountId;
      if (!accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: `${no}번째 줄의 비용 계정(또는 원가항목)을 선택해 주세요`, fields: [{ field: `lines.${i}.accountId`, message: '계정 선택' }] });
      const acc = accs.find((a) => a.id === accountId) ?? (await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId!))))[0];
      if (!acc) throw new BadRequestException({ code: 'BAD_ACCOUNT', message: `${no}번째 줄의 계정을 찾을 수 없습니다` });
      if (acc.needsProject && !dto.projectId) throw new BadRequestException({ code: 'NEEDS_PROJECT', message: `${acc.name} 계정은 현장을 지정해야 합니다. 현장을 선택하거나 본사 비용 계정을 쓰세요` });
      if (D(l.supplyAmount).plus(l.vatAmount).lte(0)) throw new BadRequestException({ code: 'ZERO_LINE', message: `${no}번째 줄의 금액을 입력해 주세요` });
      lines.push({ lineNo: no, description: l.description, accountId, costCodeId: cc?.id ?? null, supplyAmount: moneyStr(l.supplyAmount), vatAmount: moneyStr(l.vatAmount), totalAmount: moneyStr(D(l.supplyAmount).plus(l.vatAmount)), vatDeductible: l.vatDeductible });
    }
    // 원천 문서가 한 현장이면 결의 현장으로
    const srcProjects = [...new Set(lines.filter((l) => l.sourceId).map((l) => l._projectId ?? null))];
    let projectId = dto.projectId ?? null;
    if (!projectId && srcProjects.length === 1) projectId = srcProjects[0];
    if (projectId && srcProjects.some((p) => p && p !== projectId)) throw new BadRequestException({ code: 'MIXED_PROJECT', message: '다른 현장의 검수가 섞여 있습니다. 현장별로 나누어 결의하세요' });
    const srcVendors = [...new Set(lines.filter((l) => l.sourceId).map((l) => l._vendorId).filter(Boolean))];
    if (srcVendors.length > 1) throw new BadRequestException({ code: 'MIXED_VENDOR', message: '여러 거래처의 문서가 섞여 있습니다. 거래처별로 결의하세요' });
    const vendorId = dto.vendorId ?? (srcVendors[0] as string | undefined) ?? null;
    if (projectId) {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
      if (!p || !this.access.canSeeProject(ctx, projectId)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
    } else if (ctx.scope === 'ASSIGNED') {
      throw new BadRequestException({ code: 'PROJECT_REQUIRED', message: '배정된 현장을 선택해 주세요' });
    }
    let payeeName = dto.payeeName ?? null;
    if (vendorId) {
      const [v] = await tx.select({ id: vendors.id, name: vendors.name, bizStatus: vendors.bizStatus }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)));
      if (!v) throw new BadRequestException({ code: 'BAD_VENDOR', message: '거래처를 다시 선택해 주세요' });
      payeeName = payeeName ?? v.name;
    }
    if (!payeeName) throw new BadRequestException({ code: 'PAYEE_REQUIRED', message: '받는 분(거래처 또는 이름)을 입력해 주세요', fields: [{ field: 'payeeName', message: '받는 분' }] });
    if (dto.kind === 'PURCHASE' && lines.some((l) => !l.sourceId)) throw new BadRequestException({ code: 'PURCHASE_SOURCE', message: '자재대금은 검수 내역을 골라서 결의합니다. 기타 비용은 경비로 결의하세요' });
    const supply = sumMoney(lines.map((l) => l.supplyAmount!));
    const vat = sumMoney(lines.map((l) => l.vatAmount!));
    return { lines: lines.map(({ _projectId, _vendorId, ...l }) => (void _projectId, void _vendorId, l)), projectId, vendorId, payeeName, supply, vat, total: moneyStr(D(supply).plus(vat)) };
  }

  async create(ctx: AccessContext, dto: PayReqDto) {
    return this.db.transaction(async (tx) => {
      const p = await this.prepare(tx, ctx, dto);
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'PR');
      const [r] = await tx.insert(paymentRequests).values({
        companyId: ctx.companyId!, code, kind: dto.kind, title: dto.title, requestDate: dto.requestDate, dueDate: dto.dueDate ?? null, projectId: p.projectId, vendorId: p.vendorId, payeeName: p.payeeName,
        supplyAmount: p.supply, vatAmount: p.vat, totalAmount: p.total, memo: dto.memo, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).returning();
      await tx.insert(paymentRequestLines).values(p.lines.map((l) => ({ ...l, requestId: r.id })));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'payment_request', resourceId: r.id, summary: `지급결의 작성 ${code} ${dto.title} (${D(p.total).toFixed(0)}원)`, after: { ...r, lines: p.lines } }, tx);
      return r;
    });
  }

  async update(ctx: AccessContext, id: string, dto: PayReqDto & { version: number }) {
    return this.db.transaction(async (tx) => {
      const before = await this.load(ctx, id, tx);
      if (!['DRAFT', 'REJECTED'].includes(before.status)) throw new ConflictException({ code: 'PAYREQ_LOCKED', message: `${PAYREQ_STATUS_LABEL[before.status]} 상태에서는 고칠 수 없습니다` });
      // 기존 원천 예약을 풀고 다시 잡는다
      await tx.update(paymentRequestLines).set({ activeSourceKey: null }).where(eq(paymentRequestLines.requestId, id));
      const p = await this.prepare(tx, ctx, dto);
      const [r] = await tx.update(paymentRequests).set({
        kind: dto.kind, title: dto.title, requestDate: dto.requestDate, dueDate: dto.dueDate ?? null, projectId: p.projectId, vendorId: p.vendorId, payeeName: p.payeeName,
        supplyAmount: p.supply, vatAmount: p.vat, totalAmount: p.total, memo: dto.memo, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${paymentRequests.version} + 1`,
      }).where(and(eq(paymentRequests.id, id), eq(paymentRequests.version, dto.version))).returning();
      if (!r) throw staleVersion();
      await tx.delete(paymentRequestLines).where(eq(paymentRequestLines.requestId, id));
      await tx.insert(paymentRequestLines).values(p.lines.map((l) => ({ ...l, requestId: id })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'payment_request', resourceId: id, summary: `지급결의 수정 ${r.code}`, before: { totalAmount: before.totalAmount }, after: { totalAmount: r.totalAmount, lines: p.lines.map((l) => ({ description: l.description, totalAmount: l.totalAmount })) } }, tx);
      return r;
    });
  }

  async submit(ctx: AccessContext, id: string, version: number) {
    const r = await this.load(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(r.status)) throw new ConflictException({ code: 'PAYREQ_LOCKED', message: `${PAYREQ_STATUS_LABEL[r.status]} 상태에서는 상신할 수 없습니다` });
    if (D(r.totalAmount).lte(0)) throw new BadRequestException({ code: 'ZERO_AMOUNT', message: '금액이 0원인 결의는 상신할 수 없습니다' });
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(paymentRequests).set({ status: 'PENDING', version: sql`${paymentRequests.version} + 1` }).where(and(eq(paymentRequests.id, id), eq(paymentRequests.version, version), inArray(paymentRequests.status, ['DRAFT', 'REJECTED']))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'PAYMENT_REQUEST', docId: id, docCode: r.code, title: `[지급결의] ${r.title} — ${r.payeeName}`, amount: r.totalAmount, projectId: r.projectId });
      await tx.update(paymentRequests).set({ approvalId: a.id }).where(eq(paymentRequests.id, id));
      return { approvalId: a.id };
    });
  }

  /** 승인 시 분개: 직접 입력(경비성) 줄만 — 거래처가 있으면 비용/미지급금. 거래처 없는 소액 경비는 지급 시 비용 처리 */
  private async postAccrual(tx: Tx, ctx: AccessContext, r: Req) {
    if (!r.vendorId) return;
    const lines = await tx.select().from(paymentRequestLines).where(and(eq(paymentRequestLines.requestId, r.id), isNull(paymentRequestLines.sourceType)));
    if (!lines.length) return;
    const post = await this.expenseLines(tx, ctx, r, lines);
    const ap = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_OTHER');
    const total = sumMoney(lines.map((l) => l.totalAmount));
    post.push({ accountId: ap, credit: total, vendorId: r.vendorId, projectId: r.projectId, memo: r.title });
    await this.ledger.post(tx, ctx, { date: r.requestDate, description: `지급결의 승인 ${r.code} · ${r.title}`, sourceType: 'PAYMENT_REQUEST', sourceId: r.id, sourceCode: r.code, lines: post });
  }

  private async expenseLines(tx: Tx, ctx: AccessContext, r: Req, lines: (typeof paymentRequestLines.$inferSelect)[]) {
    const out: PostLine[] = [];
    const vatIn = await this.ledger.ruleAccount(tx, ctx.companyId!, 'VAT_IN');
    let vat = D(0);
    for (const l of lines) {
      const deductible = l.vatDeductible;
      out.push({ accountId: l.accountId!, debit: deductible ? l.supplyAmount : D(l.supplyAmount).plus(l.vatAmount), projectId: r.projectId, vendorId: r.vendorId, costCodeId: l.costCodeId, memo: l.description });
      if (deductible) vat = vat.plus(l.vatAmount);
    }
    if (vat.gt(0)) out.push({ accountId: vatIn, debit: vat, vendorId: r.vendorId, memo: `${r.code} 매입 부가세` });
    return out;
  }

  /** 지급 처리 — 결재 승인된 결의만 (DB 트리거가 한 번 더 확인) */
  async pay(ctx: AccessContext, id: string, dto: z.infer<typeof PayDto>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from payment_request where id = ${id} and company_id = ${ctx.companyId} for update`);
      const r = await this.load(ctx, id, tx);
      if (r.status !== 'APPROVED') {
        throw new ConflictException({ code: 'NOT_APPROVED', message: r.status === 'PAID' ? '이미 지급 완료된 결의입니다' : r.status === 'PENDING' ? '결재가 끝나지 않아 지급할 수 없습니다' : `${PAYREQ_STATUS_LABEL[r.status]} 상태에서는 지급할 수 없습니다` });
      }
      if (r.version !== dto.version) throw staleVersion();
      if (dto.payDate < r.requestDate) throw new BadRequestException({ code: 'PAY_DATE', message: '지급일이 결의일보다 빠릅니다' });
      let fundAccountId: string;
      let bankAccountId: string | null = null;
      if (dto.bankAccountId) {
        const [b] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, dto.bankAccountId), eq(bankAccounts.companyId, ctx.companyId!), eq(bankAccounts.isActive, true)));
        if (!b) throw new BadRequestException({ code: 'BAD_BANK', message: '출금 계좌를 다시 선택해 주세요' });
        fundAccountId = b.accountId;
        bankAccountId = b.id;
      } else {
        fundAccountId = await this.ledger.ruleAccount(tx, ctx.companyId!, dto.method === 'CASH' ? 'CASH' : 'BANK_DEFAULT');
      }
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'PM');
      const [pay] = await tx.insert(payments).values({ companyId: ctx.companyId!, code, requestId: id, payDate: dto.payDate, amount: r.totalAmount, method: dto.method, bankAccountId, memo: dto.memo, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await tx.update(paymentRequests).set({ status: 'PAID', paidAt: new Date(), version: sql`${paymentRequests.version} + 1` }).where(eq(paymentRequests.id, id));

      // 분개: 차변 = 원천별 채무 / 직접 입력 줄(거래처 있으면 미지급금, 없으면 비용), 대변 = 출금 계좌
      const lines = await tx.select().from(paymentRequestLines).where(eq(paymentRequestLines.requestId, id)).orderBy(asc(paymentRequestLines.lineNo));
      const post: PostLine[] = [];
      for (const l of lines.filter((x) => x.sourceType)) {
        const rule = this.sources.get(l.sourceType!)?.payableRule ?? 'AP_TRADE';
        post.push({ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, rule), debit: l.totalAmount, vendorId: r.vendorId, projectId: r.projectId, memo: l.description });
      }
      const manual = lines.filter((x) => !x.sourceType);
      if (manual.length) {
        if (r.vendorId) post.push({ accountId: await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_OTHER'), debit: sumMoney(manual.map((m) => m.totalAmount)), vendorId: r.vendorId, projectId: r.projectId, memo: r.title });
        else post.push(...(await this.expenseLines(tx, ctx, r, manual)));
      }
      post.push({ accountId: fundAccountId, credit: r.totalAmount, bankAccountId, vendorId: r.vendorId, memo: `${r.payeeName} 지급` });
      await this.ledger.post(tx, ctx, { date: dto.payDate, description: `지급 ${code} · ${r.payeeName} · ${r.title}`, sourceType: 'PAYMENT', sourceId: pay.id, sourceCode: code, lines: post });
      await this.audit.fromCtx(ctx, { action: 'PAY', resource: 'payment_request', resourceId: id, summary: `지급 완료 ${r.code} → ${code} ${r.payeeName} ${D(r.totalAmount).toFixed(0)}원 (${dto.payDate})` }, tx);
      return pay;
    });
  }

  async cancelPayment(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from payment_request where id = ${id} and company_id = ${ctx.companyId} for update`);
      const r = await this.load(ctx, id, tx);
      const [p] = await tx.select().from(payments).where(and(eq(payments.requestId, id), eq(payments.status, 'CONFIRMED')));
      if (!p || r.status !== 'PAID') throw new ConflictException({ code: 'NOT_PAID', message: '취소할 지급 내역이 없습니다' });
      await tx.update(payments).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, updatedById: ctx.user.id, version: sql`${payments.version} + 1` }).where(eq(payments.id, p.id));
      await tx.update(paymentRequests).set({ status: 'APPROVED', paidAt: null, version: sql`${paymentRequests.version} + 1` }).where(eq(paymentRequests.id, id));
      await this.ledger.reverseSource(tx, ctx, 'PAYMENT', p.id, `지급 취소 — ${reason}`);
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'payment', resourceId: id, summary: `지급 취소 ${p.code} (${r.code}) — ${reason}` }, tx);
      return { ok: true };
    });
  }

  /** 결의 취소 — 지급 전까지만. 승인 분개가 있으면 역분개, 원천 예약 해제 */
  async cancel(ctx: AccessContext, id: string, version: number, reason: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.load(ctx, id, tx);
      if (!['DRAFT', 'REJECTED', 'APPROVED'].includes(r.status)) throw new ConflictException({ code: 'CANNOT_CANCEL', message: r.status === 'PAID' ? '지급된 결의는 먼저 지급을 취소해야 합니다' : r.status === 'PENDING' ? '결재 중인 결의는 회수한 뒤 취소하세요' : '이미 취소된 결의입니다' });
      const [u] = await tx.update(paymentRequests).set({ status: 'CANCELLED', updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${paymentRequests.version} + 1` }).where(and(eq(paymentRequests.id, id), eq(paymentRequests.version, version))).returning();
      if (!u) throw staleVersion();
      await tx.update(paymentRequestLines).set({ activeSourceKey: null }).where(eq(paymentRequestLines.requestId, id));
      if (r.status === 'APPROVED') await this.ledger.reverseSource(tx, ctx, 'PAYMENT_REQUEST', id, `지급결의 취소 — ${reason}`);
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'payment_request', resourceId: id, summary: `지급결의 취소 ${r.code} — ${reason}` }, tx);
      return u;
    });
  }

  available(ctx: AccessContext, type: string, q: { vendorId?: string; projectId?: string }) {
    const r = this.sources.get(type);
    if (!r) throw new BadRequestException({ code: 'BAD_SOURCE', message: '지원하지 않는 원천 문서입니다' });
    return r.available(ctx, q);
  }

  /** 대시보드·현장 손익용 */
  async metrics(ctx: AccessContext) {
    const [m] = await this.db.select({
      pending: sql<number>`count(*) filter (where ${paymentRequests.status} = 'PENDING')::int`,
      approvedCount: sql<number>`count(*) filter (where ${paymentRequests.status} = 'APPROVED')::int`,
      approvedAmount: sql<string>`coalesce(sum(${paymentRequests.totalAmount}) filter (where ${paymentRequests.status} = 'APPROVED'),0)::text`,
      overdue: sql<number>`count(*) filter (where ${paymentRequests.status} = 'APPROVED' and ${paymentRequests.dueDate} < current_date)::int`,
    }).from(paymentRequests).where(this.scope(ctx));
    return m;
  }
}

const VersionDto = z.object({ version: z.coerce.number().int() });
const ReasonDto = VersionDto.extend({ reason: z.string().trim().min(2, '사유를 입력해 주세요').max(300) });

@ApiTags('자금 · 지급결의')
@Controller('payment-requests')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('expense', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get('sources')
  @RequirePermission('expense', 'create')
  sources(@Ctx() ctx: AccessContext, @Query('type') type: string, @Query('vendorId') vendorId?: string, @Query('projectId') projectId?: string) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return this.svc.available(ctx, type, { vendorId: vendorId && uuid.test(vendorId) ? vendorId : undefined, projectId: projectId && uuid.test(projectId) ? projectId : undefined });
  }

  @Get('export.xlsx')
  @RequirePermission('expense', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>, @Res() res: Response) {
    const d = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    type R = (typeof d.rows)[number];
    const wb = await buildExcel<R>({
      sheet: '지급결의', title: '지급결의 현황', rows: d.rows,
      columns: [
        { header: '결의번호', key: 'c', width: 12, value: (r) => r.code },
        { header: '결의일', key: 'd', width: 11, type: 'date', value: (r) => r.requestDate },
        { header: '지급예정일', key: 'dd', width: 11, type: 'date', value: (r) => r.dueDate },
        { header: '구분', key: 'k', width: 10, value: (r) => r.kindLabel },
        { header: '제목', key: 't', width: 30, value: (r) => r.title },
        { header: '받는 분', key: 'p', width: 18, value: (r) => r.payeeName },
        { header: '현장', key: 'pj', width: 22, value: (r) => r.projectName ?? '본사' },
        { header: '공급가액', key: 's', width: 14, type: 'money', value: (r) => r.supplyAmount },
        { header: '세액', key: 'v', width: 12, type: 'money', value: (r) => r.vatAmount },
        { header: '합계', key: 'tt', width: 14, type: 'money', value: (r) => r.totalAmount },
        { header: '상태', key: 'st', width: 9, value: (r) => r.statusLabel },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'payment_request', summary: `지급결의 엑셀 출력 ${d.rows.length}건` });
    await sendExcel(res, wb, `지급결의_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get(':id')
  @RequirePermission('expense', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('expense', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(PayReqDto)) dto: PayReqDto) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('expense', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PayReqDto.extend({ version: z.coerce.number().int() }))) dto: PayReqDto & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('expense', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('payment', 'create')
  pay(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PayDto)) dto: z.infer<typeof PayDto>) {
    return this.svc.pay(ctx, id, dto);
  }

  @Post(':id/cancel-payment')
  @HttpCode(200)
  @RequirePermission('payment', 'approve')
  cancelPayment(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto.omit({ version: true }))) dto: { reason: string }) {
    return this.svc.cancelPayment(ctx, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('expense', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.cancel(ctx, id, dto.version, dto.reason);
  }
}

