/**
 * 복식부기 기장 엔진 — 모든 자동·수동 분개는 여기를 거친다.
 *  - 차변 합계 = 대변 합계 (서비스 검사 + DB 지연 제약 트리거)
 *  - 같은 원천문서·목적의 분개는 하나 (DB 부분 고유 인덱스)
 *  - 승인된 전표는 수정·삭제 불가, 역분개로만 취소 (DB 트리거)
 *  - 마감된 기간에는 기록 불가 (DB 트리거)
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AccessContext } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { D, moneyStr, toWon } from '../common/money';
import { NumberingService, todayKST } from '../common/numbering.service';
import type { Tx } from '../db/db';
import { accountingPeriods, accounts, costCodes, journalEntries, journalLines, postingRules } from '../db/schema';

export interface PostLine {
  accountId: string;
  debit?: Decimal.Value;
  credit?: Decimal.Value;
  projectId?: string | null;
  vendorId?: string | null;
  costCodeId?: string | null;
  bankAccountId?: string | null;
  memo?: string | null;
}
export interface PostInput {
  date: string;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  sourceCode?: string | null;
  purpose?: string;
  lines: PostLine[];
  /** 자동분개는 기본 DRAFT(회계 담당 확인 대기). 역분개는 APPROVED */
  status?: 'DRAFT' | 'APPROVED';
  reversalOfId?: string;
}

export const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수동', RECEIPT: '검수', PAYMENT_REQUEST: '지급결의', PAYMENT: '지급', TAX_INVOICE: '세금계산서', CLAIM: '기성', COLLECTION: '수금',
  SUB_CLAIM: '하도급 기성', LABOR: '노무비', BANK: '통장거래', YEAR_CLOSE: '연마감', OPENING: '기초잔액',
};

@Injectable()
export class LedgerService {
  constructor(private readonly numbering: NumberingService, private readonly audit: AuditService) {}

  async ruleAccount(tx: Tx, companyId: string, key: string) {
    const [r] = await tx.select({ accountId: postingRules.accountId }).from(postingRules).where(and(eq(postingRules.companyId, companyId), eq(postingRules.key, key)));
    if (!r) throw new BadRequestException({ code: 'POSTING_RULE_MISSING', message: `자동분개 규칙 '${key}' 계정이 지정되지 않았습니다. 관리 > 계정과목·분개규칙에서 지정해 주세요` });
    return r.accountId;
  }

  async costAccount(tx: Tx, companyId: string, costCodeId: string) {
    const [c] = await tx.select({ accountId: costCodes.accountId }).from(costCodes).where(and(eq(costCodes.id, costCodeId), eq(costCodes.companyId, companyId)));
    if (!c) throw new BadRequestException({ code: 'BAD_COST_CODE', message: '원가항목을 찾을 수 없습니다' });
    return c.accountId;
  }

  /** 기본 원가항목(재료비) */
  async defaultCostCode(tx: Tx, companyId: string, code = 'C01') {
    const [c] = await tx.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.companyId, companyId), eq(costCodes.code, code)));
    return c?.id ?? null;
  }

  async assertOpen(tx: Tx, companyId: string, date: string) {
    const period = date.slice(0, 7);
    const [p] = await tx.select({ status: accountingPeriods.status }).from(accountingPeriods).where(and(eq(accountingPeriods.companyId, companyId), eq(accountingPeriods.period, period)));
    if (p?.status === 'CLOSED') throw new ConflictException({ code: 'PERIOD_CLOSED', message: `${period}은(는) 마감된 회계기간입니다. 열린 기간의 날짜로 처리하거나 회계관리자에게 마감 해제를 요청하세요` });
  }

  /** 줄 검증 + 원 단위 정리. 문제가 있으면 사람이 읽을 수 있는 메시지로 거부 */
  async normalize(tx: Tx, companyId: string, lines: PostLine[]) {
    const clean = lines
      .map((l) => ({ ...l, debit: toWon(D(l.debit ?? 0), 'HALF_UP'), credit: toWon(D(l.credit ?? 0), 'HALF_UP') }))
      .filter((l) => !l.debit.eq(0) || !l.credit.eq(0));
    if (clean.length < 2) throw new BadRequestException({ code: 'JOURNAL_LINES', message: '분개는 차변·대변을 포함해 2줄 이상이어야 합니다' });
    for (const l of clean) {
      if (l.debit.lt(0) || l.credit.lt(0)) throw new BadRequestException({ code: 'JOURNAL_NEGATIVE', message: '금액은 음수일 수 없습니다. 반대편(차변↔대변)에 입력하세요' });
      if (l.debit.gt(0) && l.credit.gt(0)) throw new BadRequestException({ code: 'JOURNAL_BOTH', message: '한 줄에 차변과 대변을 함께 넣을 수 없습니다' });
    }
    const dr = clean.reduce((a, l) => a.plus(l.debit), D(0));
    const cr = clean.reduce((a, l) => a.plus(l.credit), D(0));
    if (!dr.eq(cr)) throw new BadRequestException({ code: 'JOURNAL_UNBALANCED', message: `차변 합계(${dr.toFixed(0)})와 대변 합계(${cr.toFixed(0)})가 일치하지 않습니다 (차이 ${dr.minus(cr).abs().toFixed(0)}원)` });
    const ids = [...new Set(clean.map((l) => l.accountId))];
    const accs = await tx.select().from(accounts).where(and(inArray(accounts.id, ids), eq(accounts.companyId, companyId)));
    for (const l of clean) {
      const a = accs.find((x) => x.id === l.accountId);
      if (!a) throw new BadRequestException({ code: 'BAD_ACCOUNT', message: '이 회사에 없는 계정과목입니다' });
      if (!a.isActive) throw new BadRequestException({ code: 'ACCOUNT_INACTIVE', message: `사용 중지된 계정입니다: ${a.code} ${a.name}` });
      if (a.needsProject && !l.projectId) throw new BadRequestException({ code: 'NEEDS_PROJECT', message: `${a.code} ${a.name} 계정은 현장을 지정해야 합니다` });
      if (a.needsVendor && !l.vendorId) throw new BadRequestException({ code: 'NEEDS_VENDOR', message: `${a.code} ${a.name} 계정은 거래처를 지정해야 합니다` });
    }
    return { lines: clean, total: dr };
  }

  async post(tx: Tx, ctx: AccessContext, input: PostInput) {
    const companyId = ctx.companyId!;
    await this.assertOpen(tx, companyId, input.date);
    const { lines, total } = await this.normalize(tx, companyId, input.lines);
    const code = await this.numbering.yearly(tx, companyId, 'JV', input.date, 5);
    const status = input.status ?? 'DRAFT';
    const now = new Date();
    // 승인된 전표의 분개 줄은 DB 가 잠그므로, 작성중으로 넣고 줄을 채운 뒤 승인 상태로 바꾼다
    let [e] = await tx
      .insert(journalEntries)
      .values({
        companyId, code, entryDate: input.date, description: input.description.slice(0, 300), status: 'DRAFT', sourceType: input.sourceType, sourceId: input.sourceId ?? null, sourceCode: input.sourceCode ?? null,
        purpose: input.purpose ?? 'MAIN', reversalOfId: input.reversalOfId ?? null, totalDebit: moneyStr(total), totalCredit: moneyStr(total), createdById: ctx.user.id, createdByName: ctx.user.name, updatedById: ctx.user.id,
      })
      .returning();
    await tx.insert(journalLines).values(lines.map((l, i) => ({
      entryId: e.id, lineNo: i + 1, accountId: l.accountId, debit: moneyStr(l.debit), credit: moneyStr(l.credit), projectId: l.projectId ?? null, vendorId: l.vendorId ?? null, costCodeId: l.costCodeId ?? null, bankAccountId: l.bankAccountId ?? null, memo: l.memo ?? null,
    })));
    if (status === 'APPROVED') {
      [e] = await tx.update(journalEntries).set({ status: 'APPROVED', approvedAt: now, approvedById: ctx.user.id, approvedByName: ctx.user.name }).where(eq(journalEntries.id, e.id)).returning();
    }
    return e;
  }

  /**
   * 원천문서 취소 시 분개 정리: 작성중(미승인) 전표는 무효, 승인된 전표는 역분개.
   * 역분개 날짜: 원 전표 기간이 열려 있으면 원 날짜, 마감되었으면 오늘(열린 기간).
   */
  async reverseSource(tx: Tx, ctx: AccessContext, sourceType: string, sourceId: string, reason: string, purpose = 'MAIN') {
    const list = await tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, ctx.companyId!), eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId), eq(journalEntries.purpose, purpose), inArray(journalEntries.status, ['DRAFT', 'APPROVED'])));
    for (const e of list) await this.reverseEntry(tx, ctx, e, reason);
  }

  async reverseEntry(tx: Tx, ctx: AccessContext, e: typeof journalEntries.$inferSelect, reason: string, date?: string) {
    if (e.status === 'DRAFT') {
      await tx.update(journalEntries).set({ status: 'VOID', voidReason: reason, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${journalEntries.version} + 1` }).where(and(eq(journalEntries.id, e.id), eq(journalEntries.status, 'DRAFT')));
      await this.audit.fromCtx(ctx, { action: 'VOID', resource: 'journal_entry', resourceId: e.id, summary: `전표 무효 ${e.code} — ${reason}` }, tx);
      return null;
    }
    if (e.status !== 'APPROVED') throw new ConflictException({ code: 'NOT_REVERSIBLE', message: '이미 취소된 전표입니다' });
    let when = date ?? e.entryDate;
    const [p] = await tx.select({ status: accountingPeriods.status }).from(accountingPeriods).where(and(eq(accountingPeriods.companyId, ctx.companyId!), eq(accountingPeriods.period, when.slice(0, 7))));
    if (p?.status === 'CLOSED') when = todayKST();
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, e.id));
    const rev = await this.post(tx, ctx, {
      date: when, description: `[역분개] ${e.description} — ${reason}`, sourceType: e.sourceType, sourceId: e.sourceId ?? e.id, sourceCode: e.sourceCode ?? e.code,
      purpose: `REVERSAL:${e.id}`, status: 'APPROVED', reversalOfId: e.id,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, projectId: l.projectId, vendorId: l.vendorId, costCodeId: l.costCodeId, bankAccountId: l.bankAccountId, memo: l.memo })),
    });
    const [u] = await tx.update(journalEntries).set({ status: 'REVERSED', reversedById: rev.id, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${journalEntries.version} + 1` }).where(and(eq(journalEntries.id, e.id), eq(journalEntries.status, 'APPROVED'))).returning({ id: journalEntries.id });
    if (!u) throw new ConflictException({ code: 'ALREADY_REVERSED', message: '다른 사용자가 먼저 처리했습니다' });
    await this.audit.fromCtx(ctx, { action: 'REVERSE', resource: 'journal_entry', resourceId: e.id, summary: `역분개 ${e.code} → ${rev.code} — ${reason}` }, tx);
    return rev;
  }

  /** 원천문서에 연결된 유효 전표가 있는지 */
  async activeFor(tx: Tx, companyId: string, sourceType: string, sourceId: string) {
    return tx.select().from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId), ne(journalEntries.status, 'VOID')));
  }
}
