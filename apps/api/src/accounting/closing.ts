/**
 * 월마감·연마감 — 마감된 기간에는 전표를 기록할 수 없다 (DB 트리거가 최종 차단).
 * 마감 전 점검표: 미승인 전표, 차대 균형, 미지급 지급결의, 결재 대기 문서, 미확인 통장거래·세금계산서(해당 기능 사용 시).
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { D } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { accountingPeriods, journalEntries } from '../db/schema';
import { LedgerService, PostLine } from './ledger.service';

export interface CloseCheck {
  key: string;
  label: string;
  /** ok: 통과 / warn: 확인 권장(마감 가능) / block: 해결해야 마감 가능 */
  state: 'ok' | 'warn' | 'block';
  detail: string;
  href?: string;
  count?: number;
}

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

@Injectable()
export class ClosingService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly ledger: LedgerService, private readonly audit: AuditService) {}

  private async q<T>(query: ReturnType<typeof sql>) {
    return (await this.db.execute(query)).rows as T[];
  }

  private async tableExists(name: string) {
    const [r] = await this.q<{ ok: boolean }>(sql`select to_regclass(${'public.' + name}) is not null as ok`);
    return !!r?.ok;
  }

  async checks(ctx: AccessContext, period: string): Promise<CloseCheck[]> {
    const from = `${period}-01`, to = lastDay(period), cid = ctx.companyId!;
    const out: CloseCheck[] = [];

    const [bank] = (await this.tableExists('bank_transaction'))
      ? await this.q<{ n: number }>(sql`select count(*)::int n from bank_transaction where company_id = ${cid} and tx_date between ${from} and ${to} and status = 'UNMATCHED'`)
      : [{ n: -1 }];
    out.push(bank.n < 0
      ? { key: 'bank', label: '은행 거래내역 확인', state: 'ok', detail: '통장 거래내역 업로드 기능 사용 전 — 해당 없음' }
      : { key: 'bank', label: '은행 거래내역 확인', state: bank.n ? 'warn' : 'ok', detail: bank.n ? `전표와 맞춰지지 않은 통장 거래 ${bank.n}건` : '모든 통장 거래가 처리되었습니다', href: '/bank/transactions?status=UNMATCHED', count: bank.n });

    const [ti] = (await this.tableExists('tax_invoice'))
      ? await this.q<{ n: number }>(sql`select count(*)::int n from tax_invoice where company_id = ${cid} and write_date between ${from} and ${to} and direction = 'PURCHASE' and status = 'COLLECTED'`)
      : [{ n: -1 }];
    out.push(ti.n < 0
      ? { key: 'taxinvoice', label: '미처리 세금계산서', state: 'ok', detail: '세금계산서 수집 기능 사용 전 — 해당 없음' }
      : { key: 'taxinvoice', label: '미처리 매입 세금계산서', state: ti.n ? 'warn' : 'ok', detail: ti.n ? `분개·대사하지 않은 매입 세금계산서 ${ti.n}건` : '모든 매입 세금계산서가 처리되었습니다', href: '/tax-invoices?direction=PURCHASE&status=COLLECTED', count: ti.n });

    const [ap] = await this.q<{ n: number; amt: string }>(sql`select count(*)::int n, coalesce(sum(total_amount),0)::text amt from payment_request where company_id = ${cid} and status = 'APPROVED' and coalesce(due_date, request_date) <= ${to}`);
    out.push({ key: 'payables', label: '미지급금 대조', state: ap.n ? 'warn' : 'ok', detail: ap.n ? `승인되었지만 지급하지 않은 지급결의 ${ap.n}건 (${D(ap.amt).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원) — 지급일이 지났는지 확인하세요` : '지급 대기 중인 결의가 없습니다', href: '/payment-requests?status=APPROVED', count: ap.n });

    const [pend] = await this.q<{ n: number }>(sql`select count(*)::int n from approval where company_id = ${cid} and status in ('PENDING','HOLD') and submitted_at < ${to + 'T23:59:59+09:00'}`);
    out.push({ key: 'approvals', label: '결재 대기 문서', state: pend.n ? 'warn' : 'ok', detail: pend.n ? `아직 결재가 끝나지 않은 문서 ${pend.n}건 — 이 달에 반영할 문서인지 확인하세요` : '결재 대기 문서가 없습니다', href: '/approvals', count: pend.n });

    const [dr] = await this.q<{ n: number }>(sql`select count(*)::int n from journal_entry where company_id = ${cid} and status = 'DRAFT' and entry_date between ${from} and ${to}`);
    out.push({ key: 'drafts', label: '전표 승인', state: dr.n ? 'block' : 'ok', detail: dr.n ? `승인하지 않은 전표 ${dr.n}건 — 승인하거나 무효 처리해야 마감할 수 있습니다` : '이 달의 모든 전표가 승인되었습니다', href: `/journals?status=DRAFT&from=${from}&to=${to}`, count: dr.n });

    const [bal] = await this.q<{ d: string; c: string; bad: number }>(sql`
      select coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c,
        (select count(*)::int from journal_entry e2 where e2.company_id = ${cid} and e2.status in ('APPROVED','REVERSED') and e2.entry_date between ${from} and ${to}
           and (select coalesce(sum(debit),0) - coalesce(sum(credit),0) from journal_line where entry_id = e2.id) <> 0) bad
      from journal_line l join journal_entry e on e.id = l.entry_id where e.company_id = ${cid} and e.status in ('APPROVED','REVERSED') and e.entry_date between ${from} and ${to}`);
    const ok = D(bal.d).eq(bal.c) && !bal.bad;
    out.push({ key: 'balance', label: '차변·대변 검증', state: ok ? 'ok' : 'block', detail: ok ? `차변 ${D(bal.d).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원 = 대변 ${D(bal.c).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원` : `차대 불일치 전표 ${bal.bad}건` });

    const prev = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const [pp] = await this.db.select().from(accountingPeriods).where(and(eq(accountingPeriods.companyId, cid), eq(accountingPeriods.period, prev)));
    const [anyBefore] = await this.q<{ n: number }>(sql`select count(*)::int n from journal_entry where company_id = ${cid} and entry_date < ${from} and status <> 'VOID'`);
    if (anyBefore.n && pp?.status !== 'CLOSED') out.push({ key: 'previous', label: '이전 달 마감', state: 'warn', detail: `${prev}이(가) 아직 마감되지 않았습니다. 순서대로 마감하는 것을 권장합니다` });
    return out;
  }

  async overview(ctx: AccessContext, year: string) {
    const periods = await this.db.select().from(accountingPeriods).where(and(eq(accountingPeriods.companyId, ctx.companyId!), sql`${accountingPeriods.period} like ${year + '-%'}`));
    const stats = await this.q<{ ym: string; n: number; drafts: number; amt: string }>(sql`
      select to_char(entry_date,'YYYY-MM') ym, count(*) filter (where status <> 'VOID')::int n, count(*) filter (where status = 'DRAFT')::int drafts,
        coalesce(sum(total_debit) filter (where status in ('APPROVED','REVERSED')),0)::text amt
      from journal_entry where company_id = ${ctx.companyId} and entry_date between ${year + '-01-01'} and ${year + '-12-31'} group by 1`);
    const [yc] = await this.q<{ id: string; code: string } | undefined>(sql`select id, code from journal_entry where company_id = ${ctx.companyId} and source_type = 'YEAR_CLOSE' and entry_date = ${year + '-12-31'} and status = 'APPROVED' limit 1`);
    return {
      year, today: todayKST(), yearClosed: !!yc, yearCloseEntry: yc ?? null,
      months: Array.from({ length: 12 }, (_, i) => {
        const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
        const p = periods.find((x) => x.period === ym);
        const s = stats.find((x) => x.ym === ym);
        return { period: ym, status: p?.status ?? 'OPEN', closedAt: p?.closedAt ?? null, closedByName: p?.closedByName ?? null, note: p?.note ?? null, entries: s?.n ?? 0, drafts: s?.drafts ?? 0, amount: s?.amt ?? '0' };
      }),
    };
  }

  async close(ctx: AccessContext, period: string, note?: string) {
    if (period > todayKST().slice(0, 7)) throw new BadRequestException({ code: 'FUTURE_PERIOD', message: '아직 끝나지 않은 달은 마감할 수 없습니다' });
    const checks = await this.checks(ctx, period);
    const blocking = checks.filter((c) => c.state === 'block');
    if (blocking.length) throw new ConflictException({ code: 'CLOSE_BLOCKED', message: `마감할 수 없습니다: ${blocking.map((b) => b.detail).join(' / ')}`, checks });
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from journal_entry where company_id = ${ctx.companyId} and entry_date between ${period + '-01'} and ${lastDay(period)} for update`);
      const [{ n }] = (await tx.execute(sql`select count(*)::int n from journal_entry where company_id = ${ctx.companyId} and status = 'DRAFT' and entry_date between ${period + '-01'} and ${lastDay(period)}`)).rows as { n: number }[];
      if (n) throw new ConflictException({ code: 'CLOSE_BLOCKED', message: '그사이 미승인 전표가 생겼습니다. 다시 확인해 주세요' });
      await tx.insert(accountingPeriods).values({ companyId: ctx.companyId!, period, status: 'CLOSED', closedAt: new Date(), closedById: ctx.user.id, closedByName: ctx.user.name, note: note ?? null })
        .onConflictDoUpdate({ target: [accountingPeriods.companyId, accountingPeriods.period], set: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.user.id, closedByName: ctx.user.name, note: note ?? null } });
      await this.audit.fromCtx(ctx, { action: 'CLOSE', resource: 'accounting_period', resourceId: period, summary: `${period} 월마감${note ? ` — ${note}` : ''}`, after: { checks: checks.map((c) => ({ key: c.key, state: c.state, detail: c.detail })) } }, tx);
      return { period, status: 'CLOSED' };
    });
  }

  async reopen(ctx: AccessContext, period: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.companyId, ctx.companyId!), eq(accountingPeriods.period, period))).for('update');
      if (p?.status !== 'CLOSED') throw new ConflictException({ code: 'NOT_CLOSED', message: '마감된 기간이 아닙니다' });
      const later = await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.companyId, ctx.companyId!), eq(accountingPeriods.status, 'CLOSED'), sql`${accountingPeriods.period} > ${period}`));
      if (later.length) throw new ConflictException({ code: 'LATER_CLOSED', message: `이후 기간(${later.map((l) => l.period).sort().join(', ')})이 마감되어 있습니다. 최근 달부터 차례로 해제하세요` });
      await tx.update(accountingPeriods).set({ status: 'OPEN', note: `마감 해제: ${reason}` }).where(and(eq(accountingPeriods.companyId, ctx.companyId!), eq(accountingPeriods.period, period)));
      // 12월 해제 시 연마감 손익대체 전표도 역분개
      if (period.endsWith('-12')) {
        const [yc] = await tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, ctx.companyId!), eq(journalEntries.sourceType, 'YEAR_CLOSE'), eq(journalEntries.entryDate, `${period.slice(0, 4)}-12-31`), eq(journalEntries.status, 'APPROVED')));
        if (yc) await this.ledger.reverseEntry(tx, ctx, yc, `마감 해제 — ${reason}`);
      }
      await this.audit.fromCtx(ctx, { action: 'REOPEN', resource: 'accounting_period', resourceId: period, summary: `${period} 마감 해제 — ${reason}` }, tx);
      return { period, status: 'OPEN' };
    });
  }

  /** 연마감: 1~11월 마감 확인 → 손익 계정을 이월이익잉여금으로 대체(12/31) → 12월 마감 */
  async closeYear(ctx: AccessContext, year: string) {
    const months = Array.from({ length: 11 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const closed = await this.db.select().from(accountingPeriods).where(and(eq(accountingPeriods.companyId, ctx.companyId!), eq(accountingPeriods.status, 'CLOSED'), sql`${accountingPeriods.period} like ${year + '-%'}`));
    const missing = months.filter((m) => !closed.some((c) => c.period === m));
    if (missing.length) throw new ConflictException({ code: 'MONTHS_OPEN', message: `먼저 마감해야 할 달: ${missing.join(', ')}` });
    const dec = `${year}-12`;
    const checks = await this.checks(ctx, dec);
    const blocking = checks.filter((c) => c.state === 'block');
    if (blocking.length) throw new ConflictException({ code: 'CLOSE_BLOCKED', message: `12월을 마감할 수 없습니다: ${blocking.map((b) => b.detail).join(' / ')}` });
    await this.db.transaction(async (tx) => {
      const pl = (await tx.execute(sql`
        select a.id, a.type, coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c
        from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
        where e.company_id = ${ctx.companyId} and e.status in ('APPROVED','REVERSED') and a.type in ('REVENUE','EXPENSE') and e.entry_date <= ${year + '-12-31'}
        group by a.id, a.type`)).rows as { id: string; type: string; d: string; c: string }[];
      // 손익 계정 잔액을 0으로 만들고 차액을 이월이익잉여금으로
      const lines: PostLine[] = [];
      let net = D(0);
      for (const a of pl) {
        const b = D(a.d).minus(a.c); // 차변 잔액
        if (b.eq(0)) continue;
        lines.push(b.gt(0) ? { accountId: a.id, credit: b } : { accountId: a.id, debit: b.neg() });
        net = net.plus(b.neg()); // 수익(대변잔액)은 +
      }
      if (lines.length) {
        const re = await this.ledger.ruleAccount(tx, ctx.companyId!, 'RETAINED_EARNINGS');
        lines.push(net.gt(0) ? { accountId: re, credit: net } : { accountId: re, debit: net.neg() });
        await this.ledger.post(tx, ctx, { date: `${year}-12-31`, description: `${year}년 연마감 손익대체 (당기순이익 ${net.toFixed(0)}원)`, sourceType: 'YEAR_CLOSE', sourceId: null, sourceCode: year, purpose: 'MAIN', status: 'APPROVED', lines });
      }
      await this.audit.fromCtx(ctx, { action: 'CLOSE', resource: 'accounting_period', resourceId: year, summary: `${year}년 연마감 손익대체 (당기순이익 ${net.toFixed(0)}원)` }, tx);
    });
    return this.close(ctx, dec, `${year}년 연마감`);
  }
}


const PeriodParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

@ApiTags('회계 · 마감')
@Controller('closing')
export class ClosingController {
  constructor(private readonly svc: ClosingService) {}

  @Get()
  @RequirePermission('closing', 'read')
  overview(@Ctx() ctx: AccessContext, @Query('year') year?: string) {
    return this.svc.overview(ctx, /^\d{4}$/.test(year ?? '') ? year! : todayKST().slice(0, 4));
  }

  @Get(':period/checks')
  @RequirePermission('closing', 'read')
  checks(@Ctx() ctx: AccessContext, @Param('period', new ZodPipe(PeriodParam)) period: string) {
    return this.svc.checks(ctx, period);
  }

  @Post(':period/close')
  @HttpCode(200)
  @RequirePermission('closing', 'approve')
  close(@Ctx() ctx: AccessContext, @Param('period', new ZodPipe(PeriodParam)) period: string, @Body(new ZodPipe(z.object({ note: z.string().trim().max(200).optional() }))) dto: { note?: string }) {
    return this.svc.close(ctx, period, dto.note);
  }

  @Post(':period/reopen')
  @HttpCode(200)
  @RequirePermission('closing', 'approve')
  reopen(@Ctx() ctx: AccessContext, @Param('period', new ZodPipe(PeriodParam)) period: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(2, '해제 사유를 입력해 주세요').max(300) }))) dto: { reason: string }) {
    return this.svc.reopen(ctx, period, dto.reason);
  }

  @Post('year/:year/close')
  @HttpCode(200)
  @RequirePermission('closing', 'approve')
  closeYear(@Ctx() ctx: AccessContext, @Param('year', new ZodPipe(z.string().regex(/^\d{4}$/))) year: string) {
    return this.svc.closeYear(ctx, year);
  }
}
