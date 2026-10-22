/**
 * 자금일보 · 자금수지 전망
 *  - 자금일보: 계좌별 전일잔액·입금·출금·당일잔액 (장부 기준, 계좌 태그된 전표) + 그날의 입출금 내역 + 7일 안 지급·수금 예정
 *  - 자금수지 전망: 앞으로 몇 달의 예상 입금(받을 기성 미수금, 수금예정일 기준)과 예상 출금(결재된·결재 중 지급결의, 지급예정일 기준)
 *    예정일이 없는 금액은 '예정일 미정'으로 따로 보여 주고 월별 계산에 넣지 않는다
 */
import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { D, moneyStr } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';

@Injectable()
export class CashService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  async daily(ctx: AccessContext, date: string) {
    const cid = ctx.companyId!;
    const accounts = (await this.db.execute(sql`
      select b.id, b.name, b.kind, b.bank_name, b.account_no_mask,
        (case when b.kind = 'CARD' then -1 else 1 end) * coalesce((select sum(l.debit - l.credit) from journal_line l join journal_entry e on e.id = l.entry_id where l.bank_account_id = b.id and e.status in ('DRAFT','APPROVED','REVERSED') and e.entry_date < ${date}),0) opening,
        coalesce((select sum(l.debit) from journal_line l join journal_entry e on e.id = l.entry_id where l.bank_account_id = b.id and e.status in ('DRAFT','APPROVED','REVERSED') and e.entry_date = ${date}),0) debit,
        coalesce((select sum(l.credit) from journal_line l join journal_entry e on e.id = l.entry_id where l.bank_account_id = b.id and e.status in ('DRAFT','APPROVED','REVERSED') and e.entry_date = ${date}),0) credit
      from bank_account b where b.company_id = ${cid} and b.is_active order by b.kind, b.name`)).rows as { id: string; name: string; kind: string; bank_name: string | null; account_no_mask: string | null; opening: string; debit: string; credit: string }[];
    const rows = accounts.map((a) => {
      const card = a.kind === 'CARD';
      const inn = D(card ? a.credit : a.debit), out = D(card ? a.debit : a.credit);
      // 카드: 사용(대변) = 미결제 증가, 결제(차변) = 감소 → 화면에서는 '사용' / '결제'로 표시
      return { ...a, in: moneyStr(inn), out: moneyStr(out), opening: moneyStr(a.opening), closing: moneyStr(card ? D(a.opening).plus(inn).minus(out) : D(a.opening).plus(inn).minus(out)) };
    });
    const funds = rows.filter((r) => r.kind !== 'CARD');
    const lines = (await this.db.execute(sql`
      select e.id entry_id, e.code, e.description, e.source_type, e.source_id, b.name account_name, b.kind, l.debit::text, l.credit::text, l.memo, v.name vendor_name, p.name project_name
      from journal_line l join journal_entry e on e.id = l.entry_id join bank_account b on b.id = l.bank_account_id
        left join vendor v on v.id = (select l2.vendor_id from journal_line l2 where l2.entry_id = e.id and l2.vendor_id is not null limit 1)
        left join project p on p.id = (select l3.project_id from journal_line l3 where l3.entry_id = e.id and l3.project_id is not null limit 1)
      where e.company_id = ${cid} and e.entry_date = ${date} and e.status in ('DRAFT','APPROVED','REVERSED') order by e.created_at`)).rows;
    const upcomingPay = (await this.db.execute(sql`select id, code, title, payee_name, total_amount::text amount, due_date from payment_request
      where company_id = ${cid} and status = 'APPROVED' and (due_date is null or due_date <= (${date}::date + 7)) order by due_date nulls last limit 50`)).rows;
    const upcomingIn = (await this.db.execute(sql`select c.id, c.code, c.claim_no, p.name project_name, v.name vendor_name, c.due_date,
        (c.receivable_amount - coalesce((select sum(amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0))::text amount
      from progress_claim c join project p on p.id = c.project_id join vendor v on v.id = c.vendor_id
      where c.company_id = ${cid} and c.status in ('APPROVED','INVOICED','PARTIAL') and (c.due_date is null or c.due_date <= (${date}::date + 7)) order by c.due_date nulls last limit 50`)).rows;
    const sum = (k: 'opening' | 'in' | 'out' | 'closing') => moneyStr(funds.reduce((a, r) => a.plus(r[k]), D(0)));
    return { date, accounts: rows, totals: { opening: sum('opening'), in: sum('in'), out: sum('out'), closing: sum('closing') }, lines, upcomingPay, upcomingIn };
  }

  async forecast(ctx: AccessContext, months: number) {
    const cid = ctx.companyId!;
    const today = todayKST();
    const start = today.slice(0, 7);
    const list: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + i, 1));
      list.push(d.toISOString().slice(0, 7));
    }
    const bal = (await this.db.execute(sql`select coalesce(sum(l.debit - l.credit),0)::text s from journal_line l join journal_entry e on e.id = l.entry_id join bank_account b on b.id = l.bank_account_id
      where e.company_id = ${cid} and b.kind <> 'CARD' and b.is_active and e.status in ('DRAFT','APPROVED','REVERSED')`)).rows[0] as { s: string };
    const ins = (await this.db.execute(sql`select to_char(greatest(c.due_date, ${today}::date), 'YYYY-MM') m, c.due_date is null nodate,
        sum(c.receivable_amount - coalesce((select sum(amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0))::text amt
      from progress_claim c where c.company_id = ${cid} and c.status in ('APPROVED','INVOICED','PARTIAL') group by 1, 2`)).rows as { m: string | null; nodate: boolean; amt: string }[];
    const outs = (await this.db.execute(sql`select to_char(greatest(r.due_date, ${today}::date), 'YYYY-MM') m, r.due_date is null nodate, r.status, sum(r.total_amount)::text amt
      from payment_request r where r.company_id = ${cid} and r.status in ('APPROVED','PENDING') group by 1, 2, 3`)).rows as { m: string | null; nodate: boolean; status: string; amt: string }[];
    const pendingIn = (await this.db.execute(sql`select coalesce(sum(receivable_amount),0)::text s from progress_claim where company_id = ${cid} and status = 'PENDING'`)).rows[0] as { s: string };
    const subBalance = (await this.db.execute(sql`select coalesce(sum(s.current_amount * (1 + s.vat_rate) - coalesce((select sum(c.this_amount * (1 + s.vat_rate)) from sub_claim c where c.subcontract_id = s.id and c.status = 'APPROVED'),0)),0)::text s
      from subcontract s where s.company_id = ${cid} and s.status = 'ACTIVE'`)).rows[0] as { s: string };
    let running = D(bal.s);
    const rows = list.map((m) => {
      const inn = ins.filter((x) => !x.nodate && (x.m === m || (m === list[0] && x.m! < m))).reduce((a, x) => a.plus(x.amt), D(0));
      const outA = outs.filter((x) => !x.nodate && x.status === 'APPROVED' && (x.m === m || (m === list[0] && x.m! < m))).reduce((a, x) => a.plus(x.amt), D(0));
      const outP = outs.filter((x) => !x.nodate && x.status === 'PENDING' && (x.m === m || (m === list[0] && x.m! < m))).reduce((a, x) => a.plus(x.amt), D(0));
      const opening = running;
      running = running.plus(inn).minus(outA).minus(outP);
      return { month: m, opening: moneyStr(opening), expectedIn: moneyStr(inn), expectedOut: moneyStr(outA), pendingOut: moneyStr(outP), net: moneyStr(inn.minus(outA).minus(outP)), closing: moneyStr(running) };
    });
    return {
      today, currentBalance: moneyStr(bal.s), rows,
      undated: {
        in: moneyStr(ins.filter((x) => x.nodate).reduce((a, x) => a.plus(x.amt), D(0))),
        out: moneyStr(outs.filter((x) => x.nodate).reduce((a, x) => a.plus(x.amt), D(0))),
      },
      notes: { pendingClaims: moneyStr(pendingIn.s), subcontractBalance: moneyStr(D(subBalance.s).toDecimalPlaces(0, 1)) },
    };
  }
}

@ApiTags('자금 · 자금일보·수지')
@Controller('cash')
export class CashController {
  constructor(private readonly svc: CashService) {}

  @Get('daily')
  @RequirePermission('bank', 'read')
  daily(@Ctx() ctx: AccessContext, @Query(new ZodPipe(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().transform((v) => v ?? todayKST()) }))) q: { date: string }) {
    return this.svc.daily(ctx, q.date);
  }

  @Get('forecast')
  @RequirePermission('bank', 'read')
  forecast(@Ctx() ctx: AccessContext, @Query(new ZodPipe(z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }))) q: { months: number }) {
    return this.svc.forecast(ctx, q.months);
  }
}
