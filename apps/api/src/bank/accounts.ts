/**
 * 계좌·카드·현금 (자금 출처) — 지급·수금 시 어느 계좌로 처리했는지 기록하고, 계좌별 출납장을 만든다.
 * 계좌번호는 AES-256-GCM 으로 암호화 저장, 화면에는 가린 번호만.
 */
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, can, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { encryptField, decryptField, maskAccount } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { D, moneyStr } from '../common/money';
import { LedgerService } from '../accounting/ledger.service';
import { Tx } from '../db/db';
import { DB, DB_TOKEN } from '../db/db';
import { accounts, bankAccounts, postingRules } from '../db/schema';

const BankDto = z.object({
  kind: z.enum(['BANK', 'CARD', 'CASH']),
  name: z.string().trim().min(1, '별칭을 입력해 주세요').max(40),
  bankName: z.string().trim().max(30).optional().nullable(),
  accountNo: z.string().trim().max(40).optional().nullable().refine((v) => !v || /^[0-9-]{4,40}$/.test(v), '계좌·카드번호는 숫자와 - 만 입력해 주세요'),
  holder: z.string().trim().max(40).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  openingBalance: z.union([z.string(), z.number()]).transform((v) => String(v ?? '0').replace(/,/g, '') || '0').refine((v) => /^-?\d{1,15}$/.test(v), '금액 형식').default('0'),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('').transform(() => null)),
  isActive: z.boolean().default(true),
  memo: z.string().trim().max(200).optional().nullable(),
});
type BankDto = z.infer<typeof BankDto>;

@Injectable()
export class BankAccountsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService, private readonly ledger: LedgerService) {}

  async list(ctx: AccessContext) {
    const rows = await this.db.select({ b: bankAccounts, accountCode: accounts.code, accountName: accounts.name }).from(bankAccounts).innerJoin(accounts, eq(accounts.id, bankAccounts.accountId))
      .where(eq(bankAccounts.companyId, ctx.companyId!)).orderBy(asc(bankAccounts.kind), asc(bankAccounts.name));
    // 장부 잔액: 이 계좌로 태그된 승인 전표 합계 (+ 기초잔액)
    const bal = (await this.db.execute(sql`
      select l.bank_account_id id, coalesce(sum(l.debit - l.credit),0)::text net, max(e.entry_date) last
      from journal_line l join journal_entry e on e.id = l.entry_id
      where e.company_id = ${ctx.companyId} and e.status in ('APPROVED','REVERSED') and l.bank_account_id is not null group by 1`)).rows as { id: string; net: string; last: string }[];
    return rows.map(({ b, ...x }) => {
      const { accountNoEnc, ...safe } = b;
      void accountNoEnc;
      const r = bal.find((y) => y.id === b.id);
      // 기초잔액은 '기초잔액' 전표로 장부에 들어가 있으므로 장부 합계가 곧 잔액. 카드(부채)는 대변 잔액이 미결제 사용액
      const net = D(r?.net ?? 0);
      return { ...safe, ...x, lastEntryDate: r?.last ?? null, bookBalance: moneyStr(b.kind === 'CARD' ? net.neg() : net) };
    });
  }

  /** 지급·수금 화면용 선택 목록 */
  async options(ctx: AccessContext) {
    return this.db.select({ id: bankAccounts.id, kind: bankAccounts.kind, name: bankAccounts.name, bankName: bankAccounts.bankName, accountNoMask: bankAccounts.accountNoMask })
      .from(bankAccounts).where(and(eq(bankAccounts.companyId, ctx.companyId!), eq(bankAccounts.isActive, true))).orderBy(asc(bankAccounts.kind), asc(bankAccounts.name));
  }

  private async defaultAccount(ctx: AccessContext, kind: BankDto['kind']) {
    if (kind === 'CARD') {
      const [a] = await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, ctx.companyId!), eq(accounts.code, '253')));
      return a?.id;
    }
    const [r] = await this.db.select({ id: postingRules.accountId }).from(postingRules).where(and(eq(postingRules.companyId, ctx.companyId!), eq(postingRules.key, kind === 'CASH' ? 'CASH' : 'BANK_DEFAULT')));
    return r?.id;
  }

  async save(ctx: AccessContext, id: string | null, dto: BankDto & { version?: number }) {
    const accountId = dto.accountId ?? (await this.defaultAccount(ctx, dto.kind));
    if (!accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: '연결할 계정과목을 선택해 주세요' });
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId!)));
    if (!acc || (dto.kind !== 'CARD' && acc.type !== 'ASSET') || (dto.kind === 'CARD' && acc.type !== 'LIABILITY')) {
      throw new BadRequestException({ code: 'BAD_ACCOUNT', message: dto.kind === 'CARD' ? '카드는 부채 계정(미지급금 등)과 연결해야 합니다' : '계좌·현금은 자산 계정(보통예금·현금 등)과 연결해야 합니다' });
    }
    const vals = {
      kind: dto.kind, name: dto.name, bankName: dto.bankName ?? null, holder: dto.holder ?? null, accountId, openingBalance: `${dto.openingBalance}.00`, openingDate: dto.openingDate ?? null,
      isActive: dto.isActive, memo: dto.memo ?? null,
      ...(dto.accountNo ? { accountNoEnc: encryptField(dto.accountNo), accountNoMask: maskAccount(dto.accountNo) } : {}),
    };
    return this.db.transaction(async (tx) => {
      if (id) {
        const [u] = await tx.update(bankAccounts).set({ ...vals, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${bankAccounts.version} + 1` })
          .where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, ctx.companyId!), ...(dto.version ? [eq(bankAccounts.version, dto.version)] : []))).returning();
        if (!u) throw staleVersion();
        await this.syncOpening(tx, ctx, u);
        await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'bank_account', resourceId: id, summary: `계좌·카드 수정 ${dto.name}`, after: { ...vals, accountNoEnc: undefined } }, tx);
        return { id: u.id };
      }
      const [c] = await tx.insert(bankAccounts).values({ ...vals, companyId: ctx.companyId!, createdById: ctx.user.id }).returning();
      await this.syncOpening(tx, ctx, c);
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'bank_account', resourceId: c.id, summary: `계좌·카드 등록 ${dto.name} ${c.accountNoMask ?? ''}` }, tx);
      return { id: c.id };
    });
  }

  /** 기초잔액을 장부에 반영: (계좌 계정) / 이월이익잉여금. 값이 바뀌면 이전 기초 전표를 역분개하고 다시 기록 */
  private async syncOpening(tx: Tx, ctx: AccessContext, b: typeof bankAccounts.$inferSelect) {
    const active = (await this.ledger.activeFor(tx, ctx.companyId!, 'OPENING', b.id)).filter((e) => !e.purpose.startsWith('REVERSAL') && e.status !== 'REVERSED');
    const amount = D(b.openingBalance);
    const same = active.length === 1 && D(active[0].totalDebit).eq(amount.abs()) && active[0].entryDate === b.openingDate;
    if (same || (!active.length && (amount.eq(0) || !b.openingDate))) return;
    for (const e of active) await this.ledger.reverseEntry(tx, ctx, e, '기초잔액 변경');
    if (amount.eq(0) || !b.openingDate) return;
    const equity = await this.ledger.ruleAccount(tx, ctx.companyId!, 'RETAINED_EARNINGS');
    // 자산 계좌는 차변 잔액, 카드(부채)는 대변 잔액이 정상
    const debitSide = (b.kind === 'CARD') === amount.lt(0);
    const abs = amount.abs();
    await this.ledger.post(tx, ctx, {
      date: b.openingDate, description: `기초잔액 — ${b.name}`, sourceType: 'OPENING', sourceId: b.id, sourceCode: b.name, purpose: `OPENING:${b.version}`, status: 'APPROVED',
      lines: debitSide
        ? [{ accountId: b.accountId, debit: abs, bankAccountId: b.id }, { accountId: equity, credit: abs }]
        : [{ accountId: b.accountId, credit: abs, bankAccountId: b.id }, { accountId: equity, debit: abs }],
    });
  }

  async reveal(ctx: AccessContext, id: string) {
    const [b] = await this.db.select().from(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, ctx.companyId!)));
    if (!b) throw notFound('계좌');
    await this.audit.fromCtx(ctx, { action: 'VIEW_SENSITIVE', resource: 'bank_account', resourceId: id, summary: `계좌번호 원문 조회 ${b.name}` });
    return { accountNo: b.accountNoEnc ? decryptField(b.accountNoEnc) : null };
  }
}

@ApiTags('자금 · 계좌·카드')
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly svc: BankAccountsService) {}

  @Get()
  @RequirePermission('bank', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  @Get('options')
  options(@Ctx() ctx: AccessContext) {
    if (!can(ctx, 'bank', 'read') && !can(ctx, 'payment', 'create') && !can(ctx, 'expense', 'read') && !can(ctx, 'claim', 'read')) return [];
    return this.svc.options(ctx);
  }

  @Post()
  @RequirePermission('bank', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(BankDto)) dto: BankDto) {
    return this.svc.save(ctx, null, dto);
  }

  @Put(':id')
  @RequirePermission('bank', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(BankDto.extend({ version: z.coerce.number().int().optional() }))) dto: BankDto & { version?: number }) {
    return this.svc.save(ctx, id, dto);
  }

  @Post(':id/reveal')
  @RequirePermission('bank', 'update')
  reveal(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reveal(ctx, id);
  }
}
