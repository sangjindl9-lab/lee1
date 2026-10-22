/**
 * 통장·카드 거래내역 — 은행·카드사에서 내려받은 엑셀/CSV를 올려 지급·수금·전표와 맞춘다 (대사)
 *  - 같은 거래는 두 번 들어가지 않는다 (날짜·금액·잔액·적요 조합 + 같은 파일 안 순번)
 *  - 출금 ↔ 지급 완료 기록, 입금 ↔ 수금 기록을 금액·날짜로 찾아 연결 (자동 대사는 후보가 하나일 때만)
 *  - 연결할 기록이 없으면: 결재된 지급결의를 지급 처리 / 기성 수금 기록 / 바로 전표 만들기 / 제외(계좌 간 이체 등)
 *  - 은행 이체·카드 결제 실행 기능은 없다 (조회·대사만)
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import ExcelJS from 'exceljs';
import { and, desc, eq, gte, inArray, lte, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerService } from '../accounting/ledger.service';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { notFound } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { accounts, bankAccounts, bankTransactions } from '../db/schema';
import { ClaimsService } from '../construction/claims';
import { PaymentsService } from '../payments/payments';

export interface ParsedTx { txDate: string; txTime: string | null; direction: 'IN' | 'OUT'; amount: string; balance: string | null; description: string | null; counterparty: string | null; memo: string | null; approvalNo: string | null }

const HEAD = {
  date: /^(거래일시|거래일자|거래일|일자|이용일시|이용일자|이용일|승인일시|승인일자|승인일|날짜|거래날짜)$/,
  time: /^(거래시간|시간|시각|이용시간|승인시간)$/,
  in: /(입금|맡기신|들어온)/,
  out: /(출금|찾으신|나간|지급액)/,
  amount: /^(거래금액|금액|이용금액|승인금액|결제금액|매출금액)$/,
  balance: /(잔액)/,
  desc: /^(적요|내용|거래내용|가맹점|가맹점명|사용처|이용가맹점|거래구분)$/,
  counterparty: /(기재내용|의뢰인|받는분|보낸분|수취인|입금자|상대|예금주)/,
  memo: /^(메모|비고|거래점|취급점|통장메모)$/,
  approvalNo: /승인번호/,
  status: /^(구분|상태|취소여부|매출구분)$/,
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
  if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result);
  if (typeof v === 'object' && v && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('');
  return String(v).trim();
}

function parseDate(s: string): { date: string | null; time: string | null } {
  const m = s.match(/(\d{4})\s*[-./년]?\s*(\d{1,2})\s*[-./월]?\s*(\d{1,2})/);
  if (!m) return { date: null, time: null };
  const t = s.slice(m.index! + m[0].length).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return { date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, time: t ? `${t[1].padStart(2, '0')}:${t[2]}${t[3] ? ':' + t[3] : ''}` : null };
}
const num = (s: string) => {
  const v = s.replace(/[^0-9.-]/g, '');
  return v && /\d/.test(v) ? v : '';
};

/** 표 형태(행 배열)에서 머리글을 찾아 거래를 읽는다 — 은행·카드사마다 열 이름이 달라 이름으로 찾는다 */
export function parseRows(rows: string[][], isCard: boolean): { txs: ParsedTx[]; errors: { row: number; message: string }[] } {
  let hi = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i].map((c) => c.replace(/\s|\(원\)|\[원\]/g, ''));
    const find = (re: RegExp, exclude: number[] = []) => r.findIndex((c, j) => !exclude.includes(j) && re.test(c));
    const date = find(HEAD.date);
    const inn = find(HEAD.in);
    const out = find(HEAD.out);
    const amount = find(HEAD.amount);
    if (date >= 0 && ((inn >= 0 && out >= 0) || amount >= 0)) {
      hi = i;
      cols = { date, in: inn, out, amount, time: find(HEAD.time), balance: find(HEAD.balance), desc: find(HEAD.desc), counterparty: find(HEAD.counterparty), memo: find(HEAD.memo), approvalNo: find(HEAD.approvalNo), status: find(HEAD.status) };
      break;
    }
  }
  if (hi < 0) throw new BadRequestException({ code: 'UNKNOWN_FORMAT', message: '거래내역 머리글(거래일·입금·출금 또는 이용금액)을 찾지 못했습니다. 은행·카드사에서 내려받은 원본 파일을 올려 주세요' });
  const txs: ParsedTx[] = [];
  const errors: { row: number; message: string }[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (k: string) => (cols[k] >= 0 ? (r[cols[k]] ?? '').trim() : '');
    if (!r.some((c) => c.trim())) continue;
    const { date, time } = parseDate(g('date'));
    if (!date) {
      if (/합계|소계|총계/.test(r.join(''))) continue;
      errors.push({ row: i + 1, message: '거래일을 읽지 못했습니다' });
      continue;
    }
    if (/취소/.test(g('status'))) continue;
    let direction: 'IN' | 'OUT';
    let amount: string;
    if (cols.in >= 0 && cols.out >= 0 && (num(g('in')) || num(g('out')))) {
      const a = num(g('in')), b = num(g('out'));
      if (a && Number(a) > 0) (direction = 'IN'), (amount = a);
      else if (b && Number(b) > 0) (direction = 'OUT'), (amount = b);
      else continue;
    } else {
      const v = num(g('amount'));
      if (!v || Number(v) === 0) continue;
      direction = isCard ? (Number(v) < 0 ? 'IN' : 'OUT') : Number(v) < 0 ? 'OUT' : 'IN';
      amount = String(Math.abs(Number(v)));
    }
    txs.push({ txDate: date, txTime: g('time') || time, direction, amount: D(amount).toFixed(0), balance: num(g('balance')) || null, description: g('desc') || null, counterparty: g('counterparty') || null, memo: g('memo') || null, approvalNo: g('approvalNo') || null });
  }
  return { txs, errors };
}

export async function readTable(buf: Buffer, name: string): Promise<string[][]> {
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
    text = text.replace(/^﻿/, '');
    const out: string[][] = [];
    for (const line of text.split(/\r?\n/)) {
      const cells: string[] = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',' || ch === '\t') cells.push(cur), (cur = '');
        else cur += ch;
      }
      cells.push(cur);
      out.push(cells);
    }
    return out;
  }
  if (!/\.xlsx$/i.test(name)) throw new BadRequestException({ code: 'BAD_FILE', message: '.xlsx 또는 .csv 파일만 올릴 수 있습니다 (.xls는 엑셀에서 .xlsx로 저장해 주세요)' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = (row.values as unknown[]).slice(1);
    out.push(vals.map(cellText));
  });
  return out;
}

const ListQ = z.object({
  bankAccountId: z.string().uuid().optional(), status: z.enum(['UNMATCHED', 'MATCHED', 'IGNORED']).optional(), direction: z.enum(['IN', 'OUT']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(500).default(100),
});
const JournalDto = z.object({ accountId: z.string().uuid(), projectId: z.string().uuid().optional().nullable(), vendorId: z.string().uuid().optional().nullable(), costCodeId: z.string().uuid().optional().nullable(), memo: z.string().trim().max(200).optional().nullable() });

@Injectable()
export class BankTransactionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly claims: ClaimsService,
  ) {}

  private async account(ctx: AccessContext, id: string) {
    const [b] = await this.db.select().from(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, ctx.companyId!)));
    if (!b) throw notFound('계좌');
    return b;
  }

  private async load(ctx: AccessContext, id: string) {
    const [t] = await this.db.select().from(bankTransactions).where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, ctx.companyId!)));
    if (!t) throw notFound('거래');
    return t;
  }

  async import(ctx: AccessContext, bankAccountId: string, file: Express.Multer.File | undefined, dryRun: boolean) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일을 선택해 주세요' });
    const b = await this.account(ctx, bankAccountId);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const { txs, errors } = parseRows(await readTable(file.buffer, name), b.kind === 'CARD');
    // 같은 파일 안에서 똑같은 줄은 순번으로 구분 (다시 올리면 같은 순번 → 중복 제외)
    const seen = new Map<string, number>();
    const keyed = txs.map((t) => {
      const base = [t.txDate, t.txTime ?? '', t.direction, t.amount, t.balance ?? '', t.description ?? '', t.counterparty ?? '', t.approvalNo ?? ''].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...t, dedupeKey: sha256(`${base}#${n}`).slice(0, 40) };
    });
    const existing = keyed.length ? new Set((await this.db.select({ k: bankTransactions.dedupeKey }).from(bankTransactions).where(and(eq(bankTransactions.bankAccountId, b.id), inArray(bankTransactions.dedupeKey, keyed.map((k) => k.dedupeKey))))).map((x) => x.k)) : new Set<string>();
    const fresh = keyed.filter((k) => !existing.has(k.dedupeKey));
    const summary = { total: keyed.length, fresh: fresh.length, duplicate: keyed.length - fresh.length, in: moneyStr(fresh.filter((t) => t.direction === 'IN').reduce((a, t) => a.plus(t.amount), D(0))), out: moneyStr(fresh.filter((t) => t.direction === 'OUT').reduce((a, t) => a.plus(t.amount), D(0))), from: keyed.map((k) => k.txDate).sort()[0] ?? null, to: keyed.map((k) => k.txDate).sort().at(-1) ?? null };
    if (dryRun) return { dryRun: true, summary, errors, rows: keyed.slice(0, 200).map((k) => ({ ...k, duplicate: existing.has(k.dedupeKey) })) };
    const batch = (await this.db.execute(sql`select gen_random_uuid() id`)).rows[0] as { id: string };
    let inserted = 0;
    for (let i = 0; i < fresh.length; i += 500) {
      const rows = await this.db.insert(bankTransactions).values(fresh.slice(i, i + 500).map((t) => ({ ...t, companyId: ctx.companyId!, bankAccountId: b.id, importBatch: batch.id, source: /\.csv$/i.test(name) ? 'CSV' : 'EXCEL', createdById: ctx.user.id, updatedById: ctx.user.id }))).onConflictDoNothing().returning({ id: bankTransactions.id });
      inserted += rows.length;
    }
    await this.audit.fromCtx(ctx, { action: 'IMPORT', resource: 'bank', resourceId: b.id, summary: `${b.name} 거래내역 업로드 ${name} — 새로 ${inserted}건, 중복 제외 ${summary.duplicate}건` });
    const auto = await this.autoMatch(ctx, b.id);
    return { dryRun: false, inserted, duplicates: summary.duplicate, errors, autoMatched: auto.matched };
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [eq(bankTransactions.companyId, ctx.companyId!)];
    if (q.bankAccountId) conds.push(eq(bankTransactions.bankAccountId, q.bankAccountId));
    if (q.status) conds.push(eq(bankTransactions.status, q.status));
    if (q.direction) conds.push(eq(bankTransactions.direction, q.direction));
    if (q.from) conds.push(gte(bankTransactions.txDate, q.from));
    if (q.to) conds.push(lte(bankTransactions.txDate, q.to));
    const where = and(...conds);
    const [agg] = await this.db.select({
      count: sql<number>`count(*)::int`,
      unmatched: sql<number>`count(*) filter (where ${bankTransactions.status} = 'UNMATCHED')::int`,
      inSum: sql<string>`coalesce(sum(${bankTransactions.amount}) filter (where ${bankTransactions.direction} = 'IN'),0)::text`,
      outSum: sql<string>`coalesce(sum(${bankTransactions.amount}) filter (where ${bankTransactions.direction} = 'OUT'),0)::text`,
    }).from(bankTransactions).where(where);
    const rows = await this.db.select({ t: bankTransactions, accountName: bankAccounts.name }).from(bankTransactions).innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
      .where(where).orderBy(desc(bankTransactions.txDate), desc(bankTransactions.txTime), desc(bankTransactions.createdAt)).limit(q.size).offset((q.page - 1) * q.size);
    // 연결된 문서 설명
    const pIds = rows.filter((r) => r.t.matchedType === 'PAYMENT' && r.t.matchedId).map((r) => r.t.matchedId!);
    const cIds = rows.filter((r) => r.t.matchedType === 'COLLECTION' && r.t.matchedId).map((r) => r.t.matchedId!);
    const pInfo = pIds.length ? ((await this.db.execute(sql`select p.id, p.code, r.id request_id, r.title, r.payee_name from payment p join payment_request r on r.id = p.request_id where p.id in (${sql.join(pIds.map((i) => sql`${i}`), sql`, `)})`)).rows as Record<string, string>[]) : [];
    const cInfo = cIds.length ? ((await this.db.execute(sql`select x.id, x.code, x.claim_id, p.name project_name from collection x join project p on p.id = x.project_id where x.id in (${sql.join(cIds.map((i) => sql`${i}`), sql`, `)})`)).rows as Record<string, string>[]) : [];
    return {
      total: agg.count, unmatched: agg.unmatched, sums: { in: agg.inSum, out: agg.outSum },
      rows: rows.map(({ t, accountName }) => {
        const p = pInfo.find((x) => x.id === t.matchedId);
        const c = cInfo.find((x) => x.id === t.matchedId);
        const link = p ? { label: `지급 ${p.code} · ${p.payee_name} · ${p.title}`, href: `/payment-requests/${p.request_id}` }
          : c ? { label: `수금 ${c.code} · ${c.project_name}`, href: c.claim_id ? `/claims/${c.claim_id}` : '/collections' }
          : t.journalEntryId ? { label: '전표', href: `/journals/${t.journalEntryId}` } : null;
        return { ...t, accountName, link };
      }),
    };
  }

  /** 계좌별 장부 잔액과 통장 잔액(마지막 거래 잔액) 비교 */
  async accountsSummary(ctx: AccessContext) {
    return (await this.db.execute(sql`
      select b.id, b.name, b.kind, b.bank_name, b.account_no_mask,
        (select balance::text from bank_transaction t where t.bank_account_id = b.id and t.balance is not null order by tx_date desc, tx_time desc nulls last, created_at desc limit 1) statement_balance,
        (select max(tx_date) from bank_transaction t where t.bank_account_id = b.id) last_tx,
        (select count(*) from bank_transaction t where t.bank_account_id = b.id and t.status = 'UNMATCHED')::int unmatched,
        ((case when b.kind = 'CARD' then -1 else 1 end) * coalesce((select sum(l.debit - l.credit) from journal_line l join journal_entry e on e.id = l.entry_id where l.bank_account_id = b.id and e.status in ('DRAFT','APPROVED','REVERSED')),0))::text book_balance
      from bank_account b where b.company_id = ${ctx.companyId} and b.is_active order by b.kind, b.name`)).rows;
  }

  /** 맞출 후보 — 같은 금액, 거래일 ±5일 */
  async candidates(ctx: AccessContext, id: string) {
    const t = await this.load(ctx, id);
    const cid = ctx.companyId!;
    if (t.direction === 'OUT') {
      const paid = (await this.db.execute(sql`select p.id, p.code, p.pay_date date, p.amount::text, r.id request_id, r.title, r.payee_name, p.bank_account_id
        from payment p join payment_request r on r.id = p.request_id where p.company_id = ${cid} and p.status = 'CONFIRMED' and p.amount = ${t.amount}
          and p.pay_date between (${t.txDate}::date - 5) and (${t.txDate}::date + 5) and (p.bank_account_id is null or p.bank_account_id = ${t.bankAccountId})
          and not exists (select 1 from bank_transaction x where x.matched_type = 'PAYMENT' and x.matched_id = p.id and x.status = 'MATCHED')
        order by abs(p.pay_date - ${t.txDate}::date) limit 10`)).rows;
      const requests = (await this.db.execute(sql`select r.id, r.code, r.title, r.payee_name, r.total_amount::text amount, r.due_date date from payment_request r
        where r.company_id = ${cid} and r.status = 'APPROVED' and r.total_amount = ${t.amount} order by r.due_date nulls last limit 10`)).rows;
      return { existing: paid.map((p) => ({ ...p, type: 'PAYMENT' })), create: requests.map((r) => ({ ...r, type: 'PAY_REQUEST' })) };
    }
    const col = (await this.db.execute(sql`select x.id, x.code, x.collect_date date, x.amount::text, x.kind, p.name project_name, x.claim_id from collection x join project p on p.id = x.project_id
      where x.company_id = ${cid} and x.status = 'CONFIRMED' and x.amount = ${t.amount} and x.collect_date between (${t.txDate}::date - 5) and (${t.txDate}::date + 5)
        and not exists (select 1 from bank_transaction b where b.matched_type = 'COLLECTION' and b.matched_id = x.id and b.status = 'MATCHED')
      order by abs(x.collect_date - ${t.txDate}::date) limit 10`)).rows;
    const claims = (await this.db.execute(sql`select c.id, c.code, c.claim_no, p.name project_name, v.name vendor_name, c.due_date date,
        (c.receivable_amount - coalesce((select sum(amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0))::text outstanding
      from progress_claim c join project p on p.id = c.project_id join vendor v on v.id = c.vendor_id
      where c.company_id = ${cid} and c.status in ('APPROVED','INVOICED','PARTIAL')
        and (c.receivable_amount - coalesce((select sum(amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0)) >= ${t.amount}
      order by (c.receivable_amount - coalesce((select sum(amount) from collection x where x.claim_id = c.id and x.status = 'CONFIRMED'),0)) = ${t.amount} desc, c.due_date nulls last limit 10`)).rows;
    return { existing: col.map((c) => ({ ...c, type: 'COLLECTION' })), create: claims.map((c) => ({ ...c, type: 'CLAIM' })) };
  }

  private async link(ctx: AccessContext, id: string, type: 'PAYMENT' | 'COLLECTION' | 'JOURNAL', targetId: string, journalId: string | null = null) {
    try {
      const [u] = await this.db.update(bankTransactions).set({ status: 'MATCHED', matchedType: type, matchedId: targetId, journalEntryId: journalId, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${bankTransactions.version} + 1` })
        .where(and(eq(bankTransactions.id, id), eq(bankTransactions.status, 'UNMATCHED'))).returning();
      if (!u) throw new ConflictException({ code: 'ALREADY', message: '이미 처리된 거래입니다' });
      return u;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException({ code: 'TARGET_USED', message: '이 지급·수금은 이미 다른 통장 거래와 연결되어 있습니다' });
      throw e;
    }
  }

  async match(ctx: AccessContext, id: string, type: 'PAYMENT' | 'COLLECTION', targetId: string) {
    const t = await this.load(ctx, id);
    if (t.status !== 'UNMATCHED') throw new ConflictException({ code: 'ALREADY', message: '이미 처리된 거래입니다' });
    if ((type === 'PAYMENT') !== (t.direction === 'OUT')) throw new BadRequestException({ code: 'DIRECTION', message: '출금은 지급과, 입금은 수금과 맞춥니다' });
    const r = (await this.db.execute(type === 'PAYMENT'
      ? sql`select amount::text from payment where id = ${targetId} and company_id = ${ctx.companyId} and status = 'CONFIRMED'`
      : sql`select amount::text from collection where id = ${targetId} and company_id = ${ctx.companyId} and status = 'CONFIRMED'`)).rows[0] as { amount: string } | undefined;
    if (!r) throw notFound(type === 'PAYMENT' ? '지급' : '수금');
    if (!D(r.amount).eq(t.amount)) throw new BadRequestException({ code: 'AMOUNT_MISMATCH', message: `금액이 다릅니다 (통장 ${D(t.amount).toFixed(0)}원 / 기록 ${D(r.amount).toFixed(0)}원)` });
    const u = await this.link(ctx, id, type, targetId);
    await this.audit.fromCtx(ctx, { action: 'MATCH', resource: 'bank', resourceId: id, summary: `통장 ${t.txDate} ${t.direction === 'IN' ? '입금' : '출금'} ${D(t.amount).toFixed(0)}원 ↔ ${type === 'PAYMENT' ? '지급' : '수금'} 연결` });
    return u;
  }

  /** 후보가 정확히 하나인 거래만 자동으로 연결 */
  async autoMatch(ctx: AccessContext, bankAccountId?: string) {
    const list = await this.db.select().from(bankTransactions).where(and(eq(bankTransactions.companyId, ctx.companyId!), eq(bankTransactions.status, 'UNMATCHED'), ...(bankAccountId ? [eq(bankTransactions.bankAccountId, bankAccountId)] : []))).limit(2000);
    let matched = 0;
    const used = new Set<string>();
    for (const t of list) {
      const c = await this.candidates(ctx, t.id);
      const ex = (c.existing as { id: string; type: string }[]).filter((x) => !used.has(x.id));
      if (ex.length !== 1) continue;
      try {
        await this.link(ctx, t.id, ex[0].type as 'PAYMENT' | 'COLLECTION', ex[0].id);
        used.add(ex[0].id);
        matched++;
      } catch {
        /* 다른 거래가 먼저 가져감 */
      }
    }
    if (matched) await this.audit.fromCtx(ctx, { action: 'AUTO_MATCH', resource: 'bank', summary: `통장 거래 자동 대사 ${matched}건` });
    return { matched };
  }

  /** 결재된 지급결의를 이 출금으로 지급 처리 */
  async payFrom(ctx: AccessContext, id: string, requestId: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'OUT' || t.status !== 'UNMATCHED') throw new ConflictException({ code: 'BAD_TX', message: '처리되지 않은 출금만 지급 처리에 쓸 수 있습니다' });
    const r = (await this.db.execute(sql`select version, total_amount::text amount from payment_request where id = ${requestId} and company_id = ${ctx.companyId}`)).rows[0] as { version: number; amount: string } | undefined;
    if (!r) throw notFound('지급결의');
    if (!D(r.amount).eq(t.amount)) throw new BadRequestException({ code: 'AMOUNT_MISMATCH', message: '결의 금액과 출금액이 다릅니다' });
    const pay = await this.payments.pay(ctx, requestId, { version: r.version, payDate: t.txDate, method: 'TRANSFER', bankAccountId: t.bankAccountId, memo: `통장 거래 ${t.txDate} ${t.description ?? ''}`.trim() });
    return this.link(ctx, id, 'PAYMENT', pay.id);
  }

  /** 기성 수금을 이 입금으로 기록 */
  async collectFrom(ctx: AccessContext, id: string, claimId: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'IN' || t.status !== 'UNMATCHED') throw new ConflictException({ code: 'BAD_TX', message: '처리되지 않은 입금만 수금 기록에 쓸 수 있습니다' });
    const x = await this.claims.collect(ctx, { kind: 'CLAIM', claimId, collectDate: t.txDate, amount: D(t.amount).toFixed(0), method: 'TRANSFER', bankAccountId: t.bankAccountId, memo: `통장 입금 ${t.counterparty ?? t.description ?? ''}`.trim() });
    await this.db.execute(sql`update collection set bank_transaction_id = ${id} where id = ${x.id}`);
    return this.link(ctx, id, 'COLLECTION', x.id);
  }

  /** 지급·수금 기록이 없는 거래 (수수료·이자·카드 사용 등) → 바로 전표 */
  async journal(ctx: AccessContext, id: string, dto: z.infer<typeof JournalDto>) {
    const t = await this.load(ctx, id);
    if (t.status !== 'UNMATCHED') throw new ConflictException({ code: 'ALREADY', message: '이미 처리된 거래입니다' });
    const b = await this.account(ctx, t.bankAccountId);
    const [acc] = await this.db.select().from(accounts).where(and(eq(accounts.id, dto.accountId), eq(accounts.companyId, ctx.companyId!)));
    if (!acc) throw new BadRequestException({ code: 'BAD_ACCOUNT', message: '계정을 다시 선택해 주세요' });
    if (acc.id === b.accountId) throw new BadRequestException({ code: 'SAME_ACCOUNT', message: '통장과 같은 계정은 고를 수 없습니다' });
    const desc = dto.memo || [t.description, t.counterparty].filter(Boolean).join(' ') || '통장 거래';
    const entry = await this.db.transaction(async (tx) => {
      const other = { accountId: acc.id, projectId: dto.projectId ?? null, vendorId: dto.vendorId ?? null, costCodeId: dto.costCodeId ?? null, memo: desc };
      const bank = { accountId: b.accountId, bankAccountId: b.id, memo: desc };
      const e = await this.ledger.post(tx, ctx, {
        date: t.txDate, description: `통장 ${t.direction === 'IN' ? '입금' : '출금'} · ${desc}`, sourceType: 'BANK', sourceId: t.id, sourceCode: `${b.name} ${t.txDate}`,
        lines: t.direction === 'OUT' ? [{ ...other, debit: t.amount }, { ...bank, credit: t.amount }] : [{ ...bank, debit: t.amount }, { ...other, credit: t.amount }],
      });
      return e;
    });
    const u = await this.link(ctx, id, 'JOURNAL', entry.id, entry.id);
    await this.audit.fromCtx(ctx, { action: 'JOURNAL', resource: 'bank', resourceId: id, summary: `통장 거래로 전표 작성 ${t.txDate} ${D(t.amount).toFixed(0)}원 → ${acc.code} ${acc.name}` });
    return u;
  }

  async ignore(ctx: AccessContext, id: string, reason: string) {
    const t = await this.load(ctx, id);
    if (t.status !== 'UNMATCHED') throw new ConflictException({ code: 'ALREADY', message: '이미 처리된 거래입니다' });
    await this.db.update(bankTransactions).set({ status: 'IGNORED', ignoreReason: reason, updatedById: ctx.user.id, version: sql`${bankTransactions.version} + 1` }).where(eq(bankTransactions.id, id));
    await this.audit.fromCtx(ctx, { action: 'IGNORE', resource: 'bank', resourceId: id, summary: `통장 거래 대사 제외 ${t.txDate} ${D(t.amount).toFixed(0)}원 — ${reason}` });
    return { ok: true };
  }

  /** 연결 해제 — 전표를 만든 경우 역분개. 지급·수금 기록 자체는 그대로 둔다 */
  async unmatch(ctx: AccessContext, id: string, reason: string) {
    const t = await this.load(ctx, id);
    if (t.status === 'UNMATCHED') throw new ConflictException({ code: 'NOT_MATCHED', message: '연결되지 않은 거래입니다' });
    await this.db.transaction(async (tx) => {
      if (t.matchedType === 'JOURNAL') await this.ledger.reverseSource(tx, ctx, 'BANK', t.id, `통장 대사 해제 — ${reason}`);
      await tx.update(bankTransactions).set({ status: 'UNMATCHED', matchedType: null, matchedId: null, journalEntryId: null, ignoreReason: null, updatedById: ctx.user.id, version: sql`${bankTransactions.version} + 1` }).where(eq(bankTransactions.id, id));
      await this.audit.fromCtx(ctx, { action: 'UNMATCH', resource: 'bank', resourceId: id, summary: `통장 거래 대사 해제 ${t.txDate} ${D(t.amount).toFixed(0)}원 — ${reason}` }, tx);
    });
    return { ok: true };
  }
}

@ApiTags('자금 · 통장·카드 거래 대사')
@Controller('bank-transactions')
export class BankTransactionsController {
  constructor(private readonly svc: BankTransactionsService) {}

  @Get()
  @RequirePermission('bank', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get('accounts')
  @RequirePermission('bank', 'read')
  accounts(@Ctx() ctx: AccessContext) {
    return this.svc.accountsSummary(ctx);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('bank', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  import(@Ctx() ctx: AccessContext, @UploadedFile() file: Express.Multer.File, @Query('bankAccountId', ParseUUIDPipe) bankAccountId: string, @Query('dryRun') dryRun: string) {
    return this.svc.import(ctx, bankAccountId, file, dryRun !== 'false');
  }

  @Post('auto-match')
  @HttpCode(200)
  @RequirePermission('bank', 'update')
  autoMatch(@Ctx() ctx: AccessContext) {
    return this.svc.autoMatch(ctx);
  }

  @Get(':id/candidates')
  @RequirePermission('bank', 'read')
  candidates(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidates(ctx, id);
  }

  @Post(':id/match')
  @HttpCode(200)
  @RequirePermission('bank', 'update')
  match(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ type: z.enum(['PAYMENT', 'COLLECTION']), targetId: z.string().uuid() }))) dto: { type: 'PAYMENT' | 'COLLECTION'; targetId: string }) {
    return this.svc.match(ctx, id, dto.type, dto.targetId);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('payment', 'create')
  pay(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ requestId: z.string().uuid() }))) dto: { requestId: string }) {
    return this.svc.payFrom(ctx, id, dto.requestId);
  }

  @Post(':id/collect')
  @HttpCode(200)
  @RequirePermission('payment', 'create')
  collect(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ claimId: z.string().uuid() }))) dto: { claimId: string }) {
    return this.svc.collectFrom(ctx, id, dto.claimId);
  }

  @Post(':id/journal')
  @HttpCode(200)
  @RequirePermission('journal', 'create')
  journal(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(JournalDto)) dto: z.infer<typeof JournalDto>) {
    return this.svc.journal(ctx, id, dto);
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @RequirePermission('bank', 'update')
  ignore(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(2).max(200) }))) dto: { reason: string }) {
    return this.svc.ignore(ctx, id, dto.reason);
  }

  @Post(':id/unmatch')
  @HttpCode(200)
  @RequirePermission('bank', 'update')
  unmatch(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(2).max(200) }))) dto: { reason: string }) {
    return this.svc.unmatch(ctx, id, dto.reason);
  }
}
