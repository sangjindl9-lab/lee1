import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { D, moneyStr } from '../common/money';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { accounts, costCodes, journalEntries, journalLines, postingRules, projects, vendors } from '../db/schema';
import { POSTING_RULES } from './defaults';
import { LedgerService, SOURCE_LABEL } from './ledger.service';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식은 YYYY-MM-DD');
const amt = z.union([z.string(), z.number()]).transform((v) => String(v).replace(/,/g, '').trim() || '0').refine((v) => /^\d{1,15}(\.\d{1,2})?$/.test(v), '금액은 0 이상의 숫자');
const uuidOpt = z.string().uuid().optional().nullable().or(z.literal('').transform(() => null));

export const JournalLineDto = z.object({
  accountId: z.string().uuid('계정을 선택해 주세요'),
  debit: amt.default('0'),
  credit: amt.default('0'),
  projectId: uuidOpt,
  vendorId: uuidOpt,
  costCodeId: uuidOpt,
  memo: z.string().trim().max(200).optional().nullable(),
});
export const JournalDto = z.object({
  entryDate: dateStr,
  description: z.string().trim().min(1, '적요를 입력해 주세요').max(300),
  lines: z.array(JournalLineDto).min(2, '분개는 2줄 이상이어야 합니다').max(200),
});
const ListQuery = z.object({
  from: dateStr.optional(), to: dateStr.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'REVERSED', 'VOID', 'OPEN']).optional().or(z.literal('').transform(() => undefined)),
  sourceType: z.string().max(30).optional(),
  accountId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});
const AccountDto = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/, '계정코드는 숫자 3~6자리'),
  name: z.string().trim().min(1).max(40),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  category: z.enum(['CURRENT_ASSET', 'NONCURRENT_ASSET', 'CURRENT_LIABILITY', 'NONCURRENT_LIABILITY', 'EQUITY', 'SALES', 'CONSTRUCTION_COST', 'SGA', 'NON_OP_INCOME', 'NON_OP_EXPENSE', 'TAX']),
  needsVendor: z.boolean().default(false),
  needsProject: z.boolean().default(false),
  isActive: z.boolean().default(true),
  memo: z.string().trim().max(200).optional().nullable(),
});
const CostCodeDto = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{2,10}$/, '코드는 영문 대문자·숫자 2~10자'),
  name: z.string().trim().min(1).max(30),
  accountId: z.string().uuid(),
  tradeType: z.enum(['ELECTRIC', 'TELECOM', 'BUILDING', 'COMMON']).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(100),
  isActive: z.boolean().default(true),
});

const CATEGORY_TYPE: Record<string, string> = {
  CURRENT_ASSET: 'ASSET', NONCURRENT_ASSET: 'ASSET', CURRENT_LIABILITY: 'LIABILITY', NONCURRENT_LIABILITY: 'LIABILITY', EQUITY: 'EQUITY',
  SALES: 'REVENUE', NON_OP_INCOME: 'REVENUE', CONSTRUCTION_COST: 'EXPENSE', SGA: 'EXPENSE', NON_OP_EXPENSE: 'EXPENSE', TAX: 'EXPENSE',
};

/** 원천문서 → 화면 경로 */
export function sourceHref(sourceType: string, sourceId: string | null, extra?: { poId?: string | null }) {
  if (!sourceId) return null;
  switch (sourceType) {
    case 'RECEIPT': return extra?.poId ? `/purchase-orders/${extra.poId}` : '/receipts';
    case 'PAYMENT_REQUEST': case 'PAYMENT': return `/payment-requests/${sourceId}`;
    case 'TAX_INVOICE': return `/tax-invoices/${sourceId}`;
    case 'CLAIM': return `/claims/${sourceId}`;
    case 'COLLECTION': return `/collections`;
    case 'SUB_CLAIM': return `/subcontracts`;
    case 'LABOR': return `/labor`;
    default: return null;
  }
}

@Injectable()
export class JournalsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly ledger: LedgerService, private readonly audit: AuditService) {}

  async list(ctx: AccessContext, q: z.infer<typeof ListQuery>) {
    const conds: SQL[] = [eq(journalEntries.companyId, ctx.companyId!)];
    // 외부 세무담당자는 승인·확정된 전표만
    if (ctx.scope === 'CONFIRMED_ONLY') conds.push(inArray(journalEntries.status, ['APPROVED', 'REVERSED']));
    if (q.status === 'OPEN') conds.push(inArray(journalEntries.status, ['DRAFT', 'APPROVED']));
    else if (q.status) conds.push(eq(journalEntries.status, q.status));
    if (q.from) conds.push(gte(journalEntries.entryDate, q.from));
    if (q.to) conds.push(lte(journalEntries.entryDate, q.to));
    if (q.sourceType) conds.push(eq(journalEntries.sourceType, q.sourceType));
    if (q.accountId || q.projectId || q.vendorId) {
      const lc: SQL[] = [sql`${journalLines.entryId} = ${journalEntries.id}`];
      if (q.accountId) lc.push(eq(journalLines.accountId, q.accountId));
      if (q.projectId) lc.push(eq(journalLines.projectId, q.projectId));
      if (q.vendorId) lc.push(eq(journalLines.vendorId, q.vendorId));
      conds.push(sql`exists (select 1 from ${journalLines} where ${and(...lc)})`);
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(journalEntries.code, like), ilike(journalEntries.description, like), ilike(journalEntries.sourceCode, like))!);
    }
    const where = and(...conds);
    const [agg] = await this.db
      .select({ count: sql<number>`count(*)::int`, debit: sql<string>`coalesce(sum(${journalEntries.totalDebit}) filter (where ${journalEntries.status} in ('APPROVED','REVERSED','DRAFT')),0)::text`, drafts: sql<number>`count(*) filter (where ${journalEntries.status}='DRAFT')::int` })
      .from(journalEntries).where(where);
    const rows = await this.db.select().from(journalEntries).where(where).orderBy(desc(journalEntries.entryDate), desc(journalEntries.code)).limit(q.size).offset((q.page - 1) * q.size);
    const lines = rows.length
      ? await this.db
          .select({ entryId: journalLines.entryId, lineNo: journalLines.lineNo, debit: journalLines.debit, credit: journalLines.credit, code: accounts.code, name: accounts.name, projectName: projects.name, vendorName: vendors.name })
          .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).leftJoin(projects, eq(projects.id, journalLines.projectId)).leftJoin(vendors, eq(vendors.id, journalLines.vendorId))
          .where(inArray(journalLines.entryId, rows.map((r) => r.id))).orderBy(asc(journalLines.lineNo))
      : [];
    return {
      total: agg.count, page: q.page, size: q.size, sums: { amount: agg.debit }, drafts: agg.drafts,
      rows: rows.map((r) => {
        const ls = lines.filter((l) => l.entryId === r.id);
        return {
          ...r, sourceLabel: SOURCE_LABEL[r.sourceType] ?? r.sourceType,
          debitAccounts: [...new Set(ls.filter((l) => D(l.debit).gt(0)).map((l) => `${l.name}`))].join(', '),
          creditAccounts: [...new Set(ls.filter((l) => D(l.credit).gt(0)).map((l) => `${l.name}`))].join(', '),
          projectNames: [...new Set(ls.map((l) => l.projectName).filter(Boolean))].join(', '),
          vendorNames: [...new Set(ls.map((l) => l.vendorName).filter(Boolean))].join(', '),
          lineCount: ls.length,
        };
      }),
    };
  }

  async get(ctx: AccessContext, id: string) {
    const [e] = await this.db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId!)));
    if (!e || (ctx.scope === 'CONFIRMED_ONLY' && !['APPROVED', 'REVERSED'].includes(e.status))) throw notFound('전표');
    const lines = await this.db
      .select({ l: journalLines, accountCode: accounts.code, accountName: accounts.name, accountType: accounts.type, projectCode: projects.code, projectName: projects.name, vendorName: vendors.name, costCodeName: costCodes.name })
      .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).leftJoin(projects, eq(projects.id, journalLines.projectId)).leftJoin(vendors, eq(vendors.id, journalLines.vendorId)).leftJoin(costCodes, eq(costCodes.id, journalLines.costCodeId))
      .where(eq(journalLines.entryId, id)).orderBy(asc(journalLines.lineNo));
    const related = await this.db.select({ id: journalEntries.id, code: journalEntries.code, status: journalEntries.status, entryDate: journalEntries.entryDate })
      .from(journalEntries).where(and(eq(journalEntries.companyId, ctx.companyId!), or(eq(journalEntries.id, e.reversalOfId ?? e.id), eq(journalEntries.id, e.reversedById ?? e.id))!));
    let poId: string | null = null;
    if (e.sourceType === 'RECEIPT' && e.sourceId) {
      const r = await this.db.execute(sql`select po_id from goods_receipt where id = ${e.sourceId}`);
      poId = (r.rows[0] as { po_id?: string } | undefined)?.po_id ?? null;
    }
    return {
      ...e, sourceLabel: SOURCE_LABEL[e.sourceType] ?? e.sourceType, sourceHref: sourceHref(e.sourceType, e.sourceId, { poId }),
      lines: lines.map(({ l, ...x }) => ({ ...l, ...x })),
      reversalOf: related.find((r) => r.id === e.reversalOfId) ?? null,
      reversedBy: related.find((r) => r.id === e.reversedById) ?? null,
    };
  }

  private async validateRefs(ctx: AccessContext, dto: z.infer<typeof JournalDto>) {
    const pids = [...new Set(dto.lines.map((l) => l.projectId).filter(Boolean))] as string[];
    if (pids.length) {
      const ps = await this.db.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, pids), eq(projects.companyId, ctx.companyId!)));
      if (ps.length !== pids.length) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
    }
    const vids = [...new Set(dto.lines.map((l) => l.vendorId).filter(Boolean))] as string[];
    if (vids.length) {
      const vs = await this.db.select({ id: vendors.id }).from(vendors).where(and(inArray(vendors.id, vids), eq(vendors.companyId, ctx.companyId!)));
      if (vs.length !== vids.length) throw new BadRequestException({ code: 'BAD_VENDOR', message: '거래처를 다시 선택해 주세요' });
    }
  }

  async create(ctx: AccessContext, dto: z.infer<typeof JournalDto>) {
    await this.validateRefs(ctx, dto);
    return this.db.transaction(async (tx) => {
      const e = await this.ledger.post(tx, ctx, { date: dto.entryDate, description: dto.description, sourceType: 'MANUAL', lines: dto.lines, status: 'DRAFT' });
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'journal_entry', resourceId: e.id, summary: `전표 작성 ${e.code} ${dto.description} (${D(e.totalDebit).toFixed(0)}원)`, after: dto }, tx);
      return e;
    });
  }

  async update(ctx: AccessContext, id: string, dto: z.infer<typeof JournalDto> & { version: number }) {
    await this.validateRefs(ctx, dto);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId!)));
      if (!e) throw notFound('전표');
      if (e.status !== 'DRAFT') throw new ConflictException({ code: 'JOURNAL_LOCKED', message: '승인된 전표는 수정할 수 없습니다. 역분개 후 새로 작성하세요' });
      if (e.sourceType !== 'MANUAL') throw new ConflictException({ code: 'AUTO_JOURNAL', message: '자동분개 전표는 원천문서(검수·지급 등)를 고치면 다시 만들어집니다. 여기서 직접 수정할 수 없습니다' });
      await this.ledger.assertOpen(tx, ctx.companyId!, dto.entryDate);
      const { lines, total } = await this.ledger.normalize(tx, ctx.companyId!, dto.lines);
      const before = await tx.select().from(journalLines).where(eq(journalLines.entryId, id));
      const [u] = await tx.update(journalEntries).set({ entryDate: dto.entryDate, description: dto.description, totalDebit: moneyStr(total), totalCredit: moneyStr(total), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${journalEntries.version} + 1` })
        .where(and(eq(journalEntries.id, id), eq(journalEntries.version, dto.version), eq(journalEntries.status, 'DRAFT'))).returning();
      if (!u) throw staleVersion();
      await tx.delete(journalLines).where(eq(journalLines.entryId, id));
      await tx.insert(journalLines).values(lines.map((l, i) => ({ entryId: id, lineNo: i + 1, accountId: l.accountId, debit: moneyStr(l.debit), credit: moneyStr(l.credit), projectId: l.projectId ?? null, vendorId: l.vendorId ?? null, costCodeId: l.costCodeId ?? null, memo: l.memo ?? null })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'journal_entry', resourceId: id, summary: `전표 수정 ${e.code}`, before: { entryDate: e.entryDate, description: e.description, lines: before.map(({ accountId, debit, credit }) => ({ accountId, debit, credit })) }, after: dto }, tx);
      return u;
    });
  }

  /** 승인 — 여러 건 한 번에. 이미 승인된 건은 건너뛴다 */
  async approve(ctx: AccessContext, ids: string[]) {
    return this.db.transaction(async (tx) => {
      const list = await tx.select().from(journalEntries).where(and(inArray(journalEntries.id, ids), eq(journalEntries.companyId, ctx.companyId!))).for('update');
      let done = 0;
      for (const e of list) {
        if (e.status !== 'DRAFT') continue;
        await this.ledger.assertOpen(tx, ctx.companyId!, e.entryDate);
        await tx.update(journalEntries).set({ status: 'APPROVED', approvedAt: new Date(), approvedById: ctx.user.id, approvedByName: ctx.user.name, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${journalEntries.version} + 1` }).where(and(eq(journalEntries.id, e.id), eq(journalEntries.status, 'DRAFT')));
        await this.audit.fromCtx(ctx, { action: 'APPROVE', resource: 'journal_entry', resourceId: e.id, summary: `전표 승인 ${e.code} ${e.description} (${D(e.totalDebit).toFixed(0)}원)` }, tx);
        done++;
      }
      return { approved: done, skipped: ids.length - done };
    });
  }

  async voidDraft(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId!)));
      if (!e) throw notFound('전표');
      if (e.status !== 'DRAFT') throw new ConflictException({ code: 'NOT_DRAFT', message: '작성중 전표만 무효 처리할 수 있습니다. 승인된 전표는 역분개하세요' });
      if (e.sourceType !== 'MANUAL') throw new ConflictException({ code: 'AUTO_JOURNAL', message: '자동분개 전표는 원천문서를 취소하면 함께 정리됩니다' });
      await this.ledger.reverseEntry(tx, ctx, e, reason);
      return { ok: true };
    });
  }

  async reverse(ctx: AccessContext, id: string, reason: string, date?: string) {
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId!))).for('update');
      if (!e) throw notFound('전표');
      if (e.status !== 'APPROVED') throw new ConflictException({ code: 'NOT_APPROVED', message: '승인된 전표만 역분개할 수 있습니다' });
      if (e.reversalOfId) throw new ConflictException({ code: 'IS_REVERSAL', message: '역분개 전표는 다시 역분개할 수 없습니다' });
      if (e.sourceType !== 'MANUAL' && e.sourceType !== 'OPENING') {
        throw new ConflictException({ code: 'AUTO_JOURNAL', message: `${SOURCE_LABEL[e.sourceType] ?? e.sourceType}에서 만든 자동분개입니다. 원천문서(${e.sourceCode ?? ''})를 취소하면 자동으로 역분개됩니다` });
      }
      const rev = await this.ledger.reverseEntry(tx, ctx, e, reason, date);
      return { reversalId: rev!.id, reversalCode: rev!.code };
    });
  }

  // ───────── 계정과목·원가항목·자동분개 규칙 ─────────
  async accounts(ctx: AccessContext) {
    const rows = await this.db.select().from(accounts).where(eq(accounts.companyId, ctx.companyId!)).orderBy(asc(accounts.code));
    const used = await this.db.select({ accountId: journalLines.accountId, n: sql<number>`count(*)::int` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).where(eq(journalEntries.companyId, ctx.companyId!)).groupBy(journalLines.accountId);
    return rows.map((r) => ({ ...r, lineCount: used.find((u) => u.accountId === r.id)?.n ?? 0 }));
  }

  async saveAccount(ctx: AccessContext, id: string | null, dto: z.infer<typeof AccountDto>) {
    if (CATEGORY_TYPE[dto.category] !== dto.type) throw new BadRequestException({ code: 'BAD_CATEGORY', message: '계정 구분과 재무제표 표시 구분이 맞지 않습니다' });
    return this.db.transaction(async (tx) => {
      if (id) {
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, ctx.companyId!)));
        if (!a) throw notFound('계정');
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalLines).where(eq(journalLines.accountId, id));
        if (n && (a.type !== dto.type || a.code !== dto.code)) throw new ConflictException({ code: 'ACCOUNT_IN_USE', message: '분개에 사용된 계정은 코드·구분을 바꿀 수 없습니다 (이름·사용여부는 가능)' });
        const [u] = await tx.update(accounts).set({ ...dto, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${accounts.version} + 1` }).where(eq(accounts.id, id)).returning();
        await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'account', resourceId: id, summary: `계정과목 수정 ${dto.code} ${dto.name}`, before: a, after: u }, tx);
        return u;
      }
      const [c] = await tx.insert(accounts).values({ ...dto, companyId: ctx.companyId!, createdById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'account', resourceId: c.id, summary: `계정과목 추가 ${dto.code} ${dto.name}` }, tx);
      return c;
    });
  }

  async costCodes(ctx: AccessContext) {
    return this.db.select({ c: costCodes, accountCode: accounts.code, accountName: accounts.name }).from(costCodes).innerJoin(accounts, eq(accounts.id, costCodes.accountId))
      .where(eq(costCodes.companyId, ctx.companyId!)).orderBy(asc(costCodes.sortOrder), asc(costCodes.code)).then((r) => r.map(({ c, ...x }) => ({ ...c, ...x })));
  }

  async saveCostCode(ctx: AccessContext, id: string | null, dto: z.infer<typeof CostCodeDto>) {
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, dto.accountId), eq(accounts.companyId, ctx.companyId!)));
    if (!acc || acc.type !== 'EXPENSE') throw new BadRequestException({ code: 'BAD_ACCOUNT', message: '원가항목에는 비용(공사원가) 계정을 연결해야 합니다' });
    const vals = { ...dto, tradeType: dto.tradeType === 'COMMON' ? null : dto.tradeType ?? null };
    return this.db.transaction(async (tx) => {
      if (id) {
        const [u] = await tx.update(costCodes).set({ ...vals, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${costCodes.version} + 1` }).where(and(eq(costCodes.id, id), eq(costCodes.companyId, ctx.companyId!))).returning();
        if (!u) throw notFound('원가항목');
        await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'cost_code', resourceId: id, summary: `원가항목 수정 ${dto.code} ${dto.name}` }, tx);
        return u;
      }
      const [c] = await tx.insert(costCodes).values({ ...vals, companyId: ctx.companyId!, createdById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'cost_code', resourceId: c.id, summary: `원가항목 추가 ${dto.code} ${dto.name}` }, tx);
      return c;
    });
  }

  async rules(ctx: AccessContext) {
    const rows = await this.db.select({ key: postingRules.key, accountId: postingRules.accountId, code: accounts.code, name: accounts.name }).from(postingRules).innerJoin(accounts, eq(accounts.id, postingRules.accountId)).where(eq(postingRules.companyId, ctx.companyId!));
    return POSTING_RULES.map((r) => {
      const x = rows.find((y) => y.key === r.key);
      return { key: r.key, label: r.label, description: r.description, accountId: x?.accountId ?? null, code: x?.code ?? null, name: x?.name ?? null };
    });
  }

  async setRule(ctx: AccessContext, key: string, accountId: string) {
    if (!POSTING_RULES.some((r) => r.key === key)) throw notFound('규칙');
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId!)));
    if (!acc) throw notFound('계정');
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(postingRules).where(and(eq(postingRules.companyId, ctx.companyId!), eq(postingRules.key, key)));
      await tx.insert(postingRules).values({ companyId: ctx.companyId!, key, accountId, updatedById: ctx.user.id })
        .onConflictDoUpdate({ target: [postingRules.companyId, postingRules.key], set: { accountId, updatedAt: new Date(), updatedById: ctx.user.id } });
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'posting_rule', resourceId: key, summary: `자동분개 규칙 변경 ${key} → ${acc.code} ${acc.name}`, before, after: { accountId } }, tx);
    });
    return this.rules(ctx);
  }
}

const IdsDto = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
const ReasonDto = z.object({ reason: z.string().trim().min(2, '사유를 2자 이상 입력해 주세요').max(300), date: dateStr.optional() });

@ApiTags('회계 · 전표')
@Controller()
export class JournalsController {
  constructor(private readonly svc: JournalsService, private readonly audit: AuditService) {}

  @Get('journal-entries')
  @RequirePermission('journal', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('journal-entries/export.xlsx')
  @RequirePermission('journal', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>, @Res() res: Response) {
    const d = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    type R = (typeof d.rows)[number];
    const wb = await buildExcel<R>({
      sheet: '전표', title: '전표 목록', rows: d.rows,
      subtitle: `${q.from ?? '처음'} ~ ${q.to ?? '현재'} · 출력 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
      columns: [
        { header: '전표번호', key: 'c', width: 13, value: (r) => r.code },
        { header: '일자', key: 'd', width: 11, type: 'date', value: (r) => r.entryDate },
        { header: '구분', key: 's', width: 9, value: (r) => r.sourceLabel },
        { header: '적요', key: 'ds', width: 40, value: (r) => r.description },
        { header: '차변 계정', key: 'da', width: 22, value: (r) => r.debitAccounts },
        { header: '대변 계정', key: 'ca', width: 22, value: (r) => r.creditAccounts },
        { header: '현장', key: 'p', width: 20, value: (r) => r.projectNames },
        { header: '금액', key: 'a', width: 15, type: 'money', value: (r) => r.totalDebit },
        { header: '상태', key: 'st', width: 8, value: (r) => ({ DRAFT: '미승인', APPROVED: '승인', REVERSED: '역분개됨', VOID: '무효' })[r.status] },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'journal_entry', summary: `전표 엑셀 출력 ${d.rows.length}건` });
    await sendExcel(res, wb, `전표_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get('journal-entries/:id')
  @RequirePermission('journal', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post('journal-entries')
  @RequirePermission('journal', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(JournalDto)) dto: z.infer<typeof JournalDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put('journal-entries/:id')
  @RequirePermission('journal', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(JournalDto.extend({ version: z.coerce.number().int() }))) dto: z.infer<typeof JournalDto> & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Post('journal-entries/approve')
  @HttpCode(200)
  @RequirePermission('journal', 'approve')
  approve(@Ctx() ctx: AccessContext, @Body(new ZodPipe(IdsDto)) dto: z.infer<typeof IdsDto>) {
    return this.svc.approve(ctx, dto.ids);
  }

  @Post('journal-entries/:id/void')
  @HttpCode(200)
  @RequirePermission('journal', 'update')
  void(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.voidDraft(ctx, id, dto.reason);
  }

  @Post('journal-entries/:id/reverse')
  @HttpCode(200)
  @RequirePermission('journal', 'approve')
  reverse(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.reverse(ctx, id, dto.reason, dto.date);
  }

  @Get('accounts')
  @RequirePermission('journal', 'read')
  accounts(@Ctx() ctx: AccessContext) {
    return this.svc.accounts(ctx);
  }

  /** 전표 입력 화면용 가벼운 목록 (지급결의 등 다른 화면에서도 사용) */
  @Get('accounts/options')
  accountOptions(@Ctx() ctx: AccessContext) {
    return this.svc.accounts(ctx).then((r) => r.filter((a) => a.isActive).map(({ id, code, name, type, category, needsProject, needsVendor }) => ({ id, code, name, type, category, needsProject, needsVendor })));
  }

  @Post('accounts')
  @RequirePermission('journal', 'approve')
  createAccount(@Ctx() ctx: AccessContext, @Body(new ZodPipe(AccountDto)) dto: z.infer<typeof AccountDto>) {
    return this.svc.saveAccount(ctx, null, dto);
  }

  @Put('accounts/:id')
  @RequirePermission('journal', 'approve')
  updateAccount(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AccountDto)) dto: z.infer<typeof AccountDto>) {
    return this.svc.saveAccount(ctx, id, dto);
  }

  @Get('cost-codes')
  costCodes(@Ctx() ctx: AccessContext) {
    return this.svc.costCodes(ctx);
  }

  @Post('cost-codes')
  @RequirePermission('budget', 'update')
  createCostCode(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CostCodeDto)) dto: z.infer<typeof CostCodeDto>) {
    return this.svc.saveCostCode(ctx, null, dto);
  }

  @Put('cost-codes/:id')
  @RequirePermission('budget', 'update')
  updateCostCode(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CostCodeDto)) dto: z.infer<typeof CostCodeDto>) {
    return this.svc.saveCostCode(ctx, id, dto);
  }

  @Get('posting-rules')
  @RequirePermission('journal', 'read')
  rules(@Ctx() ctx: AccessContext) {
    return this.svc.rules(ctx);
  }

  @Put('posting-rules/:key')
  @RequirePermission('journal', 'approve')
  setRule(@Ctx() ctx: AccessContext, @Param('key') key: string, @Body(new ZodPipe(z.object({ accountId: z.string().uuid() }))) dto: { accountId: string }) {
    return this.svc.setRule(ctx, key, dto.accountId);
  }
}

