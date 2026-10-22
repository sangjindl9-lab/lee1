/**
 * 장부·재무제표 — 승인된 전표(APPROVED, 역분개로 취소된 원전표 REVERSED 포함 — 역분개 전표와 합쳐 0)만 집계한다.
 * 미승인(DRAFT)·무효(VOID) 전표는 장부에 들어가지 않는다.
 */
import { BadRequestException, Controller, Get, Inject, Injectable, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { buildExcel, sendExcel } from '../common/excel';
import { D, moneyStr } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const POSTED = sql.raw(`('APPROVED','REVERSED')`);
type Row = Record<string, unknown>;

export const CATEGORY_LABEL: Record<string, string> = {
  CURRENT_ASSET: '유동자산', NONCURRENT_ASSET: '비유동자산', CURRENT_LIABILITY: '유동부채', NONCURRENT_LIABILITY: '비유동부채', EQUITY: '자본',
  SALES: '매출액', CONSTRUCTION_COST: '매출원가(공사원가)', SGA: '판매비와관리비', NON_OP_INCOME: '영업외수익', NON_OP_EXPENSE: '영업외비용', TAX: '법인세비용',
};
const debitNormal = (type: string) => type === 'ASSET' || type === 'EXPENSE';
/** 계정 성격에 맞춘 잔액 (자산·비용은 차변-대변, 부채·자본·수익은 대변-차변) */
const bal = (type: string, d: string | number, c: string | number) => (debitNormal(type) ? D(d).minus(c) : D(c).minus(d));

@Injectable()
export class LedgerReportsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  private async rows<T = Row>(q: ReturnType<typeof sql>) {
    const r = await this.db.execute(q);
    return r.rows as T[];
  }

  private async account(ctx: AccessContext, accountId: string) {
    const [a] = await this.rows<{ id: string; code: string; name: string; type: string; category: string }>(sql`select id, code, name, type, category from account where id = ${accountId} and company_id = ${ctx.companyId}`);
    if (!a) throw new BadRequestException({ code: 'BAD_ACCOUNT', message: '계정을 선택해 주세요' });
    return a;
  }

  /** 계정별원장 (현금출납장·보통예금출납장 포함) */
  async accountLedger(ctx: AccessContext, q: { accountId: string; from: string; to: string; projectId?: string; vendorId?: string; bankAccountId?: string }) {
    const a = await this.account(ctx, q.accountId);
    const extra = sql.join([
      q.projectId ? sql`and l.project_id = ${q.projectId}` : sql``,
      q.vendorId ? sql`and l.vendor_id = ${q.vendorId}` : sql``,
      q.bankAccountId ? sql`and l.bank_account_id = ${q.bankAccountId}` : sql``,
    ], sql` `);
    const [open] = await this.rows<{ d: string; c: string }>(sql`
      select coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c from journal_line l join journal_entry e on e.id = l.entry_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and l.account_id = ${q.accountId} and e.entry_date < ${q.from} ${extra}
        ${['REVENUE', 'EXPENSE'].includes(a.type) ? sql`and e.entry_date >= ${q.from.slice(0, 4) + '-01-01'}` : sql``}`);
    const lines = await this.rows<{ entry_id: string; code: string; entry_date: string; description: string; source_type: string; status: string; line_no: number; debit: string; credit: string; memo: string | null; project_name: string | null; vendor_name: string | null; cost_code_name: string | null }>(sql`
      select e.id entry_id, e.code, e.entry_date, e.description, e.source_type, e.status, l.line_no, l.debit::text, l.credit::text, l.memo,
             p.name project_name, v.name vendor_name, cc.name cost_code_name
      from journal_line l join journal_entry e on e.id = l.entry_id
      left join project p on p.id = l.project_id left join vendor v on v.id = l.vendor_id left join cost_code cc on cc.id = l.cost_code_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and l.account_id = ${q.accountId} and e.entry_date between ${q.from} and ${q.to} ${extra}
      order by e.entry_date, e.code, l.line_no`);
    let run = bal(a.type, open.d, open.c);
    const opening = moneyStr(run);
    let td = D(0), tc = D(0);
    const out = lines.map((l) => {
      run = run.plus(bal(a.type, l.debit, l.credit));
      td = td.plus(l.debit);
      tc = tc.plus(l.credit);
      return { ...l, balance: moneyStr(run) };
    });
    return { account: a, from: q.from, to: q.to, opening, rows: out, totals: { debit: moneyStr(td), credit: moneyStr(tc) }, closing: moneyStr(run) };
  }

  /** 거래처별 채권·채무 잔액 (거래처원장 요약) */
  async vendorBalances(ctx: AccessContext, asOf: string) {
    const r = await this.rows<{ vendor_id: string; vendor_name: string; biz_reg_no: string | null; code: string; name: string; type: string; d: string; c: string }>(sql`
      select v.id vendor_id, v.name vendor_name, v.biz_reg_no, a.code, a.name, a.type, sum(l.debit)::text d, sum(l.credit)::text c
      from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id join vendor v on v.id = l.vendor_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and e.entry_date <= ${asOf} and a.type in ('ASSET','LIABILITY')
      group by v.id, v.name, v.biz_reg_no, a.code, a.name, a.type order by v.name, a.code`);
    const map = new Map<string, { vendorId: string; vendorName: string; bizRegNo: string | null; receivable: Decimal; payable: Decimal; accounts: { code: string; name: string; balance: string }[] }>();
    for (const x of r) {
      const b = bal(x.type, x.d, x.c);
      if (b.eq(0)) continue;
      const m = map.get(x.vendor_id) ?? { vendorId: x.vendor_id, vendorName: x.vendor_name, bizRegNo: x.biz_reg_no, receivable: D(0), payable: D(0), accounts: [] };
      if (x.type === 'ASSET') m.receivable = m.receivable.plus(b);
      else m.payable = m.payable.plus(b);
      m.accounts.push({ code: x.code, name: x.name, balance: moneyStr(b) });
      map.set(x.vendor_id, m);
    }
    const rows = [...map.values()].map((m) => ({ ...m, receivable: moneyStr(m.receivable), payable: moneyStr(m.payable) }));
    return { asOf, rows, totals: { receivable: moneyStr(rows.reduce((a, x) => a.plus(x.receivable), D(0))), payable: moneyStr(rows.reduce((a, x) => a.plus(x.payable), D(0))) } };
  }

  /** 거래처원장: 한 거래처의 채권·채무 계정 움직임 */
  async vendorLedger(ctx: AccessContext, q: { vendorId: string; from: string; to: string }) {
    const accs = await this.rows<{ account_id: string }>(sql`select distinct l.account_id from journal_line l join journal_entry e on e.id = l.entry_id where e.company_id = ${ctx.companyId} and l.vendor_id = ${q.vendorId} and e.status in ${POSTED}`);
    const out = [];
    for (const a of accs) {
      const led = await this.accountLedger(ctx, { accountId: a.account_id, from: q.from, to: q.to, vendorId: q.vendorId });
      if (led.rows.length || !D(led.opening).eq(0)) out.push(led);
    }
    return out.sort((x, y) => x.account.code.localeCompare(y.account.code));
  }

  /** 계정별 합계 (기간) — 시산표·재무제표의 바탕 */
  private async sums(ctx: AccessContext, from: string | null, to: string, opts: { projectId?: string; excludeYearClose?: boolean; types?: string[] } = {}) {
    return this.rows<{ id: string; code: string; name: string; type: string; category: string; d: string; c: string }>(sql`
      select a.id, a.code, a.name, a.type, a.category, coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c
      from account a join journal_line l on l.account_id = a.id join journal_entry e on e.id = l.entry_id
      where a.company_id = ${ctx.companyId} and e.status in ${POSTED} and e.entry_date <= ${to}
        ${from ? sql`and e.entry_date >= ${from}` : sql``}
        ${opts.projectId ? sql`and l.project_id = ${opts.projectId}` : sql``}
        ${opts.excludeYearClose ? sql`and e.source_type <> 'YEAR_CLOSE'` : sql``}
        ${opts.types ? sql`and a.type in (${sql.join(opts.types.map((t) => sql`${t}`), sql`, `)})` : sql``}
      group by a.id order by a.code`);
  }

  /** 합계잔액시산표: 재무상태표 계정은 누적, 손익 계정은 회계연도 시작부터 */
  async trialBalance(ctx: AccessContext, to: string) {
    const yearStart = to.slice(0, 4) + '-01-01';
    const bs = await this.sums(ctx, null, to, { types: ['ASSET', 'LIABILITY', 'EQUITY'] });
    const pl = await this.sums(ctx, yearStart, to, { types: ['REVENUE', 'EXPENSE'] });
    // 마감하지 않은 전년도 손익 (이월이익잉여금으로 대체되지 않은 금액)
    const prior = await this.sums(ctx, null, new Date(Date.parse(yearStart) - 86400000).toISOString().slice(0, 10), { types: ['REVENUE', 'EXPENSE'] });
    const priorNet = prior.reduce((a, r) => a.plus(D(r.c).minus(r.d)), D(0)); // 수익-비용 (대변 잔액)
    const rows = [...bs, ...pl].map((r) => {
      const b = D(r.d).minus(r.c);
      return { ...r, debitTotal: r.d, creditTotal: r.c, debitBalance: moneyStr(b.gt(0) ? b : 0), creditBalance: moneyStr(b.lt(0) ? b.neg() : 0), categoryLabel: CATEGORY_LABEL[r.category] };
    });
    if (!priorNet.eq(0)) {
      rows.push({
        id: 'PRIOR', code: '377', name: '전기 미처분손익 (연마감 전)', type: 'EQUITY', category: 'EQUITY', d: moneyStr(priorNet.lt(0) ? priorNet.neg() : 0), c: moneyStr(priorNet.gt(0) ? priorNet : 0),
        debitTotal: moneyStr(priorNet.lt(0) ? priorNet.neg() : 0), creditTotal: moneyStr(priorNet.gt(0) ? priorNet : 0),
        debitBalance: moneyStr(priorNet.lt(0) ? priorNet.neg() : 0), creditBalance: moneyStr(priorNet.gt(0) ? priorNet : 0), categoryLabel: '자본',
      });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    const t = (k: 'debitTotal' | 'creditTotal' | 'debitBalance' | 'creditBalance') => moneyStr(rows.reduce((a, r) => a.plus(r[k]), D(0)));
    const totals = { debitTotal: t('debitTotal'), creditTotal: t('creditTotal'), debitBalance: t('debitBalance'), creditBalance: t('creditBalance') };
    const [{ drafts }] = await this.rows<{ drafts: number }>(sql`select count(*)::int drafts from journal_entry where company_id = ${ctx.companyId} and status = 'DRAFT' and entry_date <= ${to}`);
    return { to, rows, totals, balanced: D(totals.debitBalance).eq(totals.creditBalance) && D(totals.debitTotal).eq(totals.creditTotal), unapprovedDrafts: drafts };
  }

  /** 손익계산서 (현장 지정 시 현장별 손익계산서) */
  async incomeStatement(ctx: AccessContext, from: string, to: string, projectId?: string) {
    const r = await this.sums(ctx, from, to, { projectId, excludeYearClose: true, types: ['REVENUE', 'EXPENSE'] });
    const group = (cat: string) => r.filter((x) => x.category === cat).map((x) => ({ id: x.id, code: x.code, name: x.name, amount: moneyStr(bal(x.type, x.d, x.c)) }));
    const sum = (rows: { amount: string }[]) => rows.reduce((a, x) => a.plus(x.amount), D(0));
    const sales = group('SALES'), cost = group('CONSTRUCTION_COST'), sga = group('SGA'), noi = group('NON_OP_INCOME'), noe = group('NON_OP_EXPENSE'), tax = group('TAX');
    const gross = sum(sales).minus(sum(cost));
    const op = gross.minus(sum(sga));
    const pretax = op.plus(sum(noi)).minus(sum(noe));
    const net = pretax.minus(sum(tax));
    return {
      from, to, projectId: projectId ?? null,
      sections: [
        { key: 'SALES', label: 'Ⅰ. 매출액', rows: sales, total: moneyStr(sum(sales)) },
        { key: 'CONSTRUCTION_COST', label: 'Ⅱ. 매출원가 (공사원가)', rows: cost, total: moneyStr(sum(cost)) },
        { key: 'GROSS', label: 'Ⅲ. 매출총이익', rows: [], total: moneyStr(gross) },
        { key: 'SGA', label: 'Ⅳ. 판매비와관리비', rows: sga, total: moneyStr(sum(sga)) },
        { key: 'OP', label: 'Ⅴ. 영업이익', rows: [], total: moneyStr(op) },
        { key: 'NON_OP_INCOME', label: 'Ⅵ. 영업외수익', rows: noi, total: moneyStr(sum(noi)) },
        { key: 'NON_OP_EXPENSE', label: 'Ⅶ. 영업외비용', rows: noe, total: moneyStr(sum(noe)) },
        { key: 'PRETAX', label: 'Ⅷ. 법인세차감전순이익', rows: [], total: moneyStr(pretax) },
        { key: 'TAX', label: 'Ⅸ. 법인세비용', rows: tax, total: moneyStr(sum(tax)) },
        { key: 'NET', label: 'Ⅹ. 당기순이익', rows: [], total: moneyStr(net) },
      ],
      netIncome: moneyStr(net),
      grossMarginRate: sum(sales).gt(0) ? gross.div(sum(sales)).toFixed(4) : null,
    };
  }

  /** 재무상태표 */
  async balanceSheet(ctx: AccessContext, asOf: string) {
    const r = await this.sums(ctx, null, asOf, {});
    const yearStart = asOf.slice(0, 4) + '-01-01';
    const plCurrent = await this.sums(ctx, yearStart, asOf, { types: ['REVENUE', 'EXPENSE'] });
    const plAll = r.filter((x) => x.type === 'REVENUE' || x.type === 'EXPENSE');
    const net = (rows: typeof r) => rows.reduce((a, x) => a.plus(D(x.c).minus(x.d)), D(0));
    const currentNet = net(plCurrent);
    const priorUnclosed = net(plAll).minus(currentNet);
    const group = (cat: string) => r.filter((x) => x.category === cat).map((x) => ({ id: x.id, code: x.code, name: x.name, amount: moneyStr(bal(x.type, x.d, x.c)) })).filter((x) => !D(x.amount).eq(0));
    const sum = (rows: { amount: string }[]) => rows.reduce((a, x) => a.plus(x.amount), D(0));
    const ca = group('CURRENT_ASSET'), nca = group('NONCURRENT_ASSET'), cl = group('CURRENT_LIABILITY'), ncl = group('NONCURRENT_LIABILITY');
    const eq = group('EQUITY');
    if (!priorUnclosed.eq(0)) eq.push({ id: 'PRIOR', code: '377', name: '전기 미처분손익', amount: moneyStr(priorUnclosed) });
    eq.push({ id: 'NET', code: '378', name: '당기순이익', amount: moneyStr(currentNet) });
    const assets = sum(ca).plus(sum(nca));
    const liab = sum(cl).plus(sum(ncl));
    const equity = sum(eq);
    return {
      asOf,
      assets: { sections: [{ label: 'Ⅰ. 유동자산', rows: ca, total: moneyStr(sum(ca)) }, { label: 'Ⅱ. 비유동자산', rows: nca, total: moneyStr(sum(nca)) }], total: moneyStr(assets) },
      liabilities: { sections: [{ label: 'Ⅰ. 유동부채', rows: cl, total: moneyStr(sum(cl)) }, { label: 'Ⅱ. 비유동부채', rows: ncl, total: moneyStr(sum(ncl)) }], total: moneyStr(liab) },
      equity: { rows: eq, total: moneyStr(equity) },
      balanced: assets.eq(liab.plus(equity)),
      difference: moneyStr(assets.minus(liab.plus(equity))),
    };
  }

  /** 공사원가명세서 (현장별·원가항목별) */
  async costStatement(ctx: AccessContext, from: string, to: string, projectId?: string) {
    const r = await this.rows<{ project_id: string | null; project_code: string | null; project_name: string | null; code: string; name: string; d: string; c: string }>(sql`
      select l.project_id, p.code project_code, p.name project_name, a.code, a.name, coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c
      from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id left join project p on p.id = l.project_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and a.category = 'CONSTRUCTION_COST' and e.source_type <> 'YEAR_CLOSE'
        and e.entry_date between ${from} and ${to} ${projectId ? sql`and l.project_id = ${projectId}` : sql``}
        ${ctx.scope === 'ASSIGNED' ? (ctx.assignedProjectIds.length ? sql`and l.project_id in (${sql.join(ctx.assignedProjectIds.map((i) => sql`${i}`), sql`, `)})` : sql`and false`) : sql``}
      group by l.project_id, p.code, p.name, a.code, a.name order by p.code nulls last, a.code`);
    const accountsSeen = [...new Map(r.map((x) => [x.code, x.name])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const projectsSeen = [...new Map(r.map((x) => [x.project_id ?? 'NONE', { id: x.project_id, code: x.project_code, name: x.project_name ?? '현장 미지정' }])).values()];
    const cell = (pid: string | null, code: string) => {
      const x = r.find((y) => (y.project_id ?? null) === pid && y.code === code);
      return x ? moneyStr(D(x.d).minus(x.c)) : '0';
    };
    const matrix = projectsSeen.map((p) => {
      const cells = Object.fromEntries(accountsSeen.map(([code]) => [code, cell(p.id, code)]));
      return { ...p, cells, total: moneyStr(Object.values(cells).reduce((a, v) => a.plus(v), D(0))) };
    });
    const accTotals = Object.fromEntries(accountsSeen.map(([code]) => [code, moneyStr(matrix.reduce((a, m) => a.plus(m.cells[code]), D(0)))]));
    return { from, to, accounts: accountsSeen.map(([code, name]) => ({ code, name })), projects: matrix, totals: accTotals, grandTotal: moneyStr(Object.values(accTotals).reduce((a, v) => a.plus(v), D(0))) };
  }

  /** 총계정원장: 계정 × 월 */
  async generalLedger(ctx: AccessContext, year: string) {
    const r = await this.rows<{ id: string; code: string; name: string; type: string; ym: string; d: string; c: string }>(sql`
      select a.id, a.code, a.name, a.type, to_char(e.entry_date,'YYYY-MM') ym, sum(l.debit)::text d, sum(l.credit)::text c
      from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and e.entry_date between ${year + '-01-01'} and ${year + '-12-31'}
      group by a.id, a.code, a.name, a.type, ym order by a.code, ym`);
    const open = await this.rows<{ id: string; type: string; d: string; c: string }>(sql`
      select a.id, a.type, sum(l.debit)::text d, sum(l.credit)::text c from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
      where e.company_id = ${ctx.companyId} and e.status in ${POSTED} and e.entry_date < ${year + '-01-01'} and a.type in ('ASSET','LIABILITY','EQUITY') group by a.id, a.type`);
    const ids = [...new Set([...r.map((x) => x.id), ...open.map((o) => o.id)])];
    const meta = await this.rows<{ id: string; code: string; name: string; type: string }>(sql`select id, code, name, type from account where company_id = ${ctx.companyId} order by code`);
    return meta.filter((m) => ids.includes(m.id)).map((m) => {
      const o = open.find((x) => x.id === m.id);
      let run = o ? bal(m.type, o.d, o.c) : D(0);
      const opening = moneyStr(run);
      const months = Array.from({ length: 12 }, (_, i) => {
        const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
        const x = r.find((y) => y.id === m.id && y.ym === ym);
        run = run.plus(x ? bal(m.type, x.d, x.c) : 0);
        return { ym, debit: x?.d ?? '0', credit: x?.c ?? '0', balance: moneyStr(run) };
      });
      return { ...m, opening, months, closing: moneyStr(run) };
    });
  }
}


const RangeQ = z.object({ from: dateStr.optional(), to: dateStr.optional(), projectId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(), bankAccountId: z.string().uuid().optional(), accountId: z.string().uuid().optional(), year: z.string().regex(/^\d{4}$/).optional() });
type RangeQ = z.infer<typeof RangeQ>;
const range = (q: RangeQ) => {
  const to = q.to ?? todayKST();
  return { from: q.from ?? to.slice(0, 4) + '-01-01', to };
};

@ApiTags('회계 · 장부·재무제표')
@Controller('ledger')
export class LedgerReportsController {
  constructor(private readonly svc: LedgerReportsService, private readonly audit: AuditService) {}

  @Get('account')
  @RequirePermission('journal', 'read')
  account(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    if (!q.accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: '계정을 선택해 주세요' });
    return this.svc.accountLedger(ctx, { accountId: q.accountId, ...range(q), projectId: q.projectId, vendorId: q.vendorId, bankAccountId: q.bankAccountId });
  }

  @Get('vendors')
  @RequirePermission('journal', 'read')
  vendors(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    return this.svc.vendorBalances(ctx, range(q).to);
  }

  @Get('vendor')
  @RequirePermission('journal', 'read')
  vendor(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    if (!q.vendorId) throw new BadRequestException({ code: 'VENDOR_REQUIRED', message: '거래처를 선택해 주세요' });
    return this.svc.vendorLedger(ctx, { vendorId: q.vendorId, ...range(q) });
  }

  @Get('trial-balance')
  @RequirePermission('journal', 'read')
  tb(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    return this.svc.trialBalance(ctx, range(q).to);
  }

  @Get('general')
  @RequirePermission('journal', 'read')
  general(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    return this.svc.generalLedger(ctx, q.year ?? todayKST().slice(0, 4));
  }

  @Get('income-statement')
  @RequirePermission('journal', 'read')
  income(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    const r = range(q);
    return this.svc.incomeStatement(ctx, r.from, r.to, q.projectId);
  }

  @Get('balance-sheet')
  @RequirePermission('journal', 'read')
  bs(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    return this.svc.balanceSheet(ctx, range(q).to);
  }

  @Get('cost-statement')
  @RequirePermission('journal', 'read')
  cost(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ)) q: RangeQ) {
    const r = range(q);
    return this.svc.costStatement(ctx, r.from, r.to, q.projectId);
  }

  /** 장부 엑셀 — 실제 숫자 셀과 합계 수식 */
  @Get('export.xlsx')
  @RequirePermission('journal', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(RangeQ.extend({ kind: z.enum(['account', 'trial-balance', 'income-statement', 'balance-sheet', 'cost-statement', 'vendors']) }))) q: RangeQ & { kind: string }, @Res() res: Response) {
    const r = range(q);
    let wb;
    let name = '';
    if (q.kind === 'account') {
      if (!q.accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: '계정을 선택해 주세요' });
      const d = await this.svc.accountLedger(ctx, { accountId: q.accountId, ...r, projectId: q.projectId, vendorId: q.vendorId, bankAccountId: q.bankAccountId });
      name = `계정별원장_${d.account.code}${d.account.name}`;
      type L = (typeof d.rows)[number];
      wb = await buildExcel<L>({
        sheet: '원장', title: `계정별원장 — ${d.account.code} ${d.account.name}`, subtitle: `${r.from} ~ ${r.to} · 전기이월 ${D(d.opening).toFixed(0)}원`, rows: d.rows,
        columns: [
          { header: '일자', key: 'd', width: 11, type: 'date', value: (x) => x.entry_date },
          { header: '전표번호', key: 'c', width: 13, value: (x) => x.code },
          { header: '적요', key: 's', width: 40, value: (x) => x.memo || x.description },
          { header: '거래처', key: 'v', width: 18, value: (x) => x.vendor_name },
          { header: '현장', key: 'p', width: 20, value: (x) => x.project_name },
          { header: '차변', key: 'dr', width: 15, type: 'money', value: (x) => x.debit },
          { header: '대변', key: 'cr', width: 15, type: 'money', value: (x) => x.credit },
          { header: '잔액', key: 'b', width: 16, type: 'money', value: (x) => x.balance },
        ],
      });
    } else if (q.kind === 'trial-balance') {
      const d = await this.svc.trialBalance(ctx, r.to);
      name = `합계잔액시산표_${r.to}`;
      type T = (typeof d.rows)[number];
      wb = await buildExcel<T>({
        sheet: '시산표', title: '합계잔액시산표', subtitle: `${r.to} 현재`, rows: d.rows,
        columns: [
          { header: '차변 잔액', key: 'db', width: 16, type: 'money', value: (x) => x.debitBalance },
          { header: '차변 합계', key: 'dt', width: 16, type: 'money', value: (x) => x.debitTotal },
          { header: '코드', key: 'c', width: 7, value: (x) => x.code },
          { header: '계정과목', key: 'n', width: 24, value: (x) => x.name },
          { header: '대변 합계', key: 'ct', width: 16, type: 'money', value: (x) => x.creditTotal },
          { header: '대변 잔액', key: 'cb', width: 16, type: 'money', value: (x) => x.creditBalance },
        ],
      });
    } else if (q.kind === 'income-statement' || q.kind === 'balance-sheet') {
      const flat: { label: string; amount: string | null; bold?: boolean }[] = [];
      if (q.kind === 'income-statement') {
        const d = await this.svc.incomeStatement(ctx, r.from, r.to, q.projectId);
        name = `손익계산서_${r.from}_${r.to}`;
        for (const s of d.sections) {
          flat.push({ label: s.label, amount: s.total, bold: true });
          for (const x of s.rows) flat.push({ label: `    ${x.name}`, amount: x.amount });
        }
      } else {
        const d = await this.svc.balanceSheet(ctx, r.to);
        name = `재무상태표_${r.to}`;
        flat.push({ label: '자산', amount: d.assets.total, bold: true });
        for (const s of d.assets.sections) { flat.push({ label: `  ${s.label}`, amount: s.total, bold: true }); for (const x of s.rows) flat.push({ label: `    ${x.name}`, amount: x.amount }); }
        flat.push({ label: '부채', amount: d.liabilities.total, bold: true });
        for (const s of d.liabilities.sections) { flat.push({ label: `  ${s.label}`, amount: s.total, bold: true }); for (const x of s.rows) flat.push({ label: `    ${x.name}`, amount: x.amount }); }
        flat.push({ label: '자본', amount: d.equity.total, bold: true });
        for (const x of d.equity.rows) flat.push({ label: `    ${x.name}`, amount: x.amount });
        flat.push({ label: '부채와 자본 총계', amount: moneyStr(D(d.liabilities.total).plus(d.equity.total)), bold: true });
      }
      wb = await buildExcel<(typeof flat)[number]>({
        sheet: q.kind === 'income-statement' ? '손익계산서' : '재무상태표', title: q.kind === 'income-statement' ? '손익계산서' : '재무상태표',
        subtitle: q.kind === 'income-statement' ? `${r.from} ~ ${r.to}` : `${r.to} 현재`, rows: flat,
        columns: [{ header: '과목', key: 'l', width: 40, value: (x) => x.label }, { header: '금액', key: 'a', width: 20, type: 'money', value: (x) => (x.bold ? x.amount : x.amount) }],
      });
      // 구분 행 합계는 의미가 없으므로 마지막 SUM 행 제거
      const ws = wb.worksheets[0];
      ws.spliceRows(ws.rowCount, 1);
      flat.forEach((x, i) => x.bold && (ws.getRow(4 + i).font = { bold: true }));
    } else if (q.kind === 'cost-statement') {
      const d = await this.svc.costStatement(ctx, r.from, r.to, q.projectId);
      name = `공사원가명세서_${r.from}_${r.to}`;
      type P = (typeof d.projects)[number];
      wb = await buildExcel<P>({
        sheet: '공사원가명세서', title: '공사원가명세서 (현장별)', subtitle: `${r.from} ~ ${r.to}`, rows: d.projects,
        columns: [
          { header: '현장', key: 'p', width: 30, value: (x) => `${x.code ?? ''} ${x.name}` },
          ...d.accounts.map((a) => ({ header: a.name.replace('공사원가-', ''), key: a.code, width: 14, type: 'money' as const, value: (x: P) => x.cells[a.code] })),
          { header: '합계', key: 't', width: 16, type: 'money', value: (x) => x.total },
        ],
      });
    } else {
      const d = await this.svc.vendorBalances(ctx, r.to);
      name = `거래처별채권채무_${r.to}`;
      type V = (typeof d.rows)[number];
      wb = await buildExcel<V>({
        sheet: '채권채무', title: '거래처별 채권·채무 현황', subtitle: `${r.to} 현재`, rows: d.rows,
        columns: [
          { header: '거래처', key: 'v', width: 24, value: (x) => x.vendorName },
          { header: '사업자번호', key: 'b', width: 14, value: (x) => x.bizRegNo },
          { header: '채권(받을 돈)', key: 'r', width: 16, type: 'money', value: (x) => x.receivable },
          { header: '채무(줄 돈)', key: 'pa', width: 16, type: 'money', value: (x) => x.payable },
          { header: '계정별', key: 'a', width: 40, value: (x) => x.accounts.map((a) => `${a.name} ${D(a.balance).toFixed(0)}`).join(', ') },
        ],
      });
    }
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'ledger', summary: `${name} 엑셀 출력` });
    await sendExcel(res, wb, `${name}.xlsx`);
  }
}
