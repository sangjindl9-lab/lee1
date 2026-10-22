/**
 * 보고서 — 같은 데이터를 화면·엑셀·PDF(A4/A3, 세로/가로)로. 각 보고서는 해당 업무 권한이 있어야 출력할 수 있다.
 */
import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerReportsService } from '../accounting/reports';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../bank/cash';
import { BudgetService } from '../budget/budget';
import { buildExcel, ExcelColumn, sendExcel } from '../common/excel';
import { D } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { ClaimsService } from '../construction/claims';
import { LaborService } from '../construction/labor';
import { SubcontractsService } from '../construction/subcontracts';
import { DB, DB_TOKEN } from '../db/db';
import { companies } from '../db/schema';
import { PdfColumn, renderTablePdf } from './table-pdf';

type Col = PdfColumn & { type?: ExcelColumn<unknown>['type']; width?: number };
interface Built { title: string; subtitle?: string; columns: Col[]; rows: (string | number | null)[][]; totals?: (string | number | null)[]; notes?: string[]; landscape?: boolean }
interface Q { from: string; to: string; date: string; projectId?: string }

const money = (header: string, weight = 1.1): Col => ({ header, weight, money: true, align: 'right', type: 'money', width: 15 });
const text = (header: string, weight = 1, width = 14): Col => ({ header, weight, type: 'text', width });
const pctOf = (v: string | null | undefined) => (v === null || v === undefined ? '' : `${(Number(v) * 100).toFixed(1)}%`);
const sumCol = (rows: (string | number | null)[][], i: number) => rows.reduce((a, r) => a.plus(D((r[i] as string) || 0)), D(0)).toFixed(0);

export const REPORTS: { key: string; title: string; group: string; perm: string; params: ('period' | 'date' | 'project')[]; description: string }[] = [
  { key: 'project-pl', title: '현장별 손익 현황', group: '현장', perm: 'report:read', params: [], description: '계약·매출·수금·원가·지급·예상 손익을 현장별로' },
  { key: 'cost-statement', title: '공사원가명세서', group: '현장', perm: 'journal:read', params: ['period', 'project'], description: '기간 중 발생한 공사원가를 현장 × 원가계정으로' },
  { key: 'claims', title: '기성청구 및 수금 현황', group: '매출', perm: 'claim:read', params: ['project'], description: '회차별 금회·누적·청구액·수금·미수금' },
  { key: 'receivables', title: '거래처별 미수금 현황', group: '매출', perm: 'claim:read', params: [], description: '현장·발주처별 청구·수금·미수·연체·유보금' },
  { key: 'vendor-balances', title: '거래처별 채권·채무 잔액', group: '회계', perm: 'journal:read', params: ['date'], description: '기준일 현재 거래처별 미수금·미지급금 (장부 기준)' },
  { key: 'subcontracts', title: '하도급 지급 현황', group: '원가', perm: 'subcontract:read', params: ['project'], description: '하도급 계약·기성·지급·잔액·유보금' },
  { key: 'labor', title: '노무비 집계표', group: '원가', perm: 'labor:read', params: ['period'], description: '작업자별 출역일·공수·연장·노무비 (세전)' },
  { key: 'cash-daily', title: '자금일보', group: '자금', perm: 'bank:read', params: ['date'], description: '계좌별 전일잔액·입금·출금·당일잔액' },
  { key: 'cash-forecast', title: '자금수지 전망', group: '자금', perm: 'bank:read', params: [], description: '6개월 예상 입금·출금·잔액' },
  { key: 'trial-balance', title: '합계잔액시산표', group: '회계', perm: 'journal:read', params: ['date'], description: '기준일 현재 계정별 차변·대변 합계와 잔액' },
];

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly budget: BudgetService,
    private readonly ledger: LedgerReportsService,
    private readonly claims: ClaimsService,
    private readonly subs: SubcontractsService,
    private readonly labor: LaborService,
    private readonly cash: CashService,
  ) {}

  async build(ctx: AccessContext, key: string, q: Q): Promise<Built> {
    switch (key) {
      case 'project-pl': {
        const o = await this.budget.overview(ctx, {});
        const rows = o.rows.map((r) => [r.code, r.name, r.contractCurrent, r.recognized, r.collected, r.receivable, r.budget, r.actual, r.paid, r.currentProfit, r.estimatedProfit, pctOf(r.costRate)]);
        return {
          title: '현장별 손익 현황', subtitle: `${todayKST()} 기준`, landscape: true,
          columns: [text('코드', 0.7, 10), text('현장', 2.2, 30), money('확정 계약'), money('인식 매출'), money('수금'), money('미수금'), money('실행예산'), money('발생원가'), money('지급'), money('현재 손익'), money('예상 준공손익'), { header: '원가율', weight: 0.6, align: 'right', type: 'text', width: 8 }],
          rows, totals: ['', '합계', ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => sumCol(rows, i)), ''],
          notes: ['매출은 승인된 기성 기준(수금과 별개), 원가는 장부 발생 기준, 예상 준공손익 = 확정 계약 − 예상 준공원가(원가항목별 max(실행·확정·발생))'],
        };
      }
      case 'cost-statement': {
        const r = await this.ledger.costStatement(ctx, q.from, q.to, q.projectId);
        const rows = r.projects.map((p) => [p.code ?? '', p.name, ...r.accounts.map((a) => p.cells[a.code]), p.total]);
        return {
          title: '공사원가명세서', subtitle: `${q.from} ~ ${q.to}`, landscape: true,
          columns: [text('코드', 0.7, 10), text('현장', 2, 28), ...r.accounts.map((a) => money(a.name.replace('공사원가-', ''), 1)), money('합계', 1.2)],
          rows, totals: ['', '합계', ...r.accounts.map((a) => r.totals[a.code]), r.grandTotal],
        };
      }
      case 'claims': {
        const r = await this.claims.list(ctx, { projectId: q.projectId, page: 1, size: 500 });
        const rows = r.rows.map((x) => [x.code, x.projectName, x.isFinal ? '준공' : `${x.claimNo}회`, x.claimDate, x.vendorName, x.thisSupply, x.cumulative, pctOf(x.progressRate), x.receivableAmount, x.collected, x.outstanding, x.dueDate, x.statusLabel]);
        return {
          title: '기성청구 및 수금 현황', landscape: true,
          columns: [text('번호', 0.8, 12), text('현장', 1.8, 26), text('회차', 0.5, 6), text('청구일', 0.8, 11), text('발주처', 1.3, 18), money('금회 기성'), money('누적 기성'), { header: '기성률', weight: 0.6, align: 'right', type: 'text', width: 8 }, money('청구액'), money('수금'), money('미수금'), text('수금예정', 0.8, 11), text('상태', 0.8, 10)],
          rows, totals: ['', '합계', '', '', '', sumCol(rows, 5), '', '', sumCol(rows, 8), sumCol(rows, 9), sumCol(rows, 10), '', ''],
        };
      }
      case 'receivables': {
        const r = await this.claims.receivables(ctx);
        const rows = (r as unknown as Record<string, string>[]).map((x) => [x.name, x.vendor_name, x.billed, x.collected, x.outstanding, x.overdue, x.retentionOutstanding, x.oldest_due]);
        return {
          title: '거래처별 미수금 현황', subtitle: `${todayKST()} 기준`,
          columns: [text('현장', 2, 28), text('발주처', 1.4, 20), money('청구액'), money('수금'), money('미수금'), money('연체'), money('유보금 잔액'), text('가장 오래된 예정일', 1, 14)],
          rows, totals: ['합계', '', ...[2, 3, 4, 5, 6].map((i) => sumCol(rows, i)), ''],
        };
      }
      case 'vendor-balances': {
        const r = await this.ledger.vendorBalances(ctx, q.date);
        const rows = r.rows.map((x) => [x.vendorName, x.bizRegNo ?? '', x.receivable, x.payable, x.accounts.map((a) => `${a.name} ${Number(a.balance).toLocaleString('ko-KR')}`).join(', ')]);
        return {
          title: '거래처별 채권·채무 잔액', subtitle: `${q.date} 현재 (장부 기준)`,
          columns: [text('거래처', 1.6, 22), text('사업자번호', 1, 14), money('채권 (받을 돈)'), money('채무 (줄 돈)'), text('계정별', 2.6, 40)],
          rows, totals: ['합계', '', r.totals.receivable, r.totals.payable, ''],
        };
      }
      case 'subcontracts': {
        const r = await this.subs.list(ctx, { projectId: q.projectId });
        const rows = r.filter((x) => !['DRAFT', 'REJECTED'].includes(x.status)).map((x) => [x.code, x.projectName, x.vendorName, x.title, x.originalAmount, x.currentAmount, x.claimed, x.paid, x.balance, x.retention, x.statusLabel]);
        return {
          title: '하도급 지급 현황', landscape: true,
          columns: [text('번호', 0.8, 12), text('현장', 1.5, 22), text('협력업체', 1.2, 18), text('계약명', 1.6, 24), money('최초 계약'), money('현재 계약'), money('승인 기성'), money('지급'), money('계약잔액'), money('유보금'), text('상태', 0.6, 9)],
          rows, totals: ['', '합계', '', '', ...[4, 5, 6, 7, 8, 9].map((i) => sumCol(rows, i)), ''],
        };
      }
      case 'labor': {
        const r = await this.labor.summary(ctx, { from: q.from, to: q.to });
        const rows = (r.byWorker as Record<string, string>[]).map((w) => [w.name, w.trade ?? '', w.days, w.man_days, w.overtime, w.amount, `${w.bank_name ?? ''} ${w.bank_account_mask ?? ''}`.trim()]);
        return {
          title: '노무비 집계표', subtitle: `${r.from} ~ ${r.to}`,
          columns: [text('작업자', 1, 12), text('직종', 1, 12), { header: '출역일', weight: 0.6, align: 'right', type: 'int', width: 8 }, { header: '공수', weight: 0.6, align: 'right', type: 'text', width: 8 }, { header: '연장(h)', weight: 0.6, align: 'right', type: 'text', width: 8 }, money('노무비 (세전)'), text('지급 계좌', 1.4, 22)],
          rows, totals: ['합계', '', '', rows.reduce((a, x) => a + Number(x[3]), 0).toString(), '', sumCol(rows, 5), ''],
          notes: ['노무비는 일당×공수 + 일당÷8×연장시간×1.5 (원 미만 버림)이며 원천세·4대보험 공제 전 금액입니다.'],
        };
      }
      case 'cash-daily': {
        const r = await this.cash.daily(ctx, q.date);
        const rows = r.accounts.map((a) => [a.kind === 'CARD' ? '카드' : a.kind === 'CASH' ? '현금' : '예금', a.name, `${a.bank_name ?? ''} ${a.account_no_mask ?? ''}`.trim(), a.opening, a.in, a.out, a.closing]);
        return {
          title: '자금일보', subtitle: q.date,
          columns: [text('구분', 0.5, 8), text('계좌', 1.4, 18), text('은행·번호', 1.4, 20), money('전일 잔액'), money('입금 (카드: 사용)'), money('출금 (카드: 결제)'), money('당일 잔액')],
          rows, totals: ['', '예금·현금 합계', '', r.totals.opening, r.totals.in, r.totals.out, r.totals.closing],
          notes: [`7일 안 지급 예정 ${r.upcomingPay.length}건, 수금 예정 ${r.upcomingIn.length}건`, '장부(계좌 지정 전표) 기준 — 통장 거래내역과의 차이는 거래내역 대사 화면에서 확인'],
        };
      }
      case 'cash-forecast': {
        const r = await this.cash.forecast(ctx, 6);
        const rows = r.rows.map((m) => [m.month, m.opening, m.expectedIn, m.expectedOut, m.pendingOut, m.net, m.closing]);
        return {
          title: '자금수지 전망', subtitle: `${r.today} 기준, 현재 잔액 ${Number(r.currentBalance).toLocaleString('ko-KR')}원`,
          columns: [text('월', 0.8, 10), money('기초'), money('예상 입금 (기성 미수)'), money('예상 출금 (결재된 결의)'), money('결재 중 결의'), money('증감'), money('기말')],
          rows, notes: [`예정일 미정: 입금 ${Number(r.undated.in).toLocaleString('ko-KR')}원, 출금 ${Number(r.undated.out).toLocaleString('ko-KR')}원 (월별 계산 제외)`, `결재 중 기성 ${Number(r.notes.pendingClaims).toLocaleString('ko-KR')}원, 남은 하도급 계약(세액 포함) ${Number(r.notes.subcontractBalance).toLocaleString('ko-KR')}원은 참고`],
        };
      }
      case 'trial-balance': {
        const r = await this.ledger.trialBalance(ctx, q.date);
        const rows = r.rows.map((x) => [x.debitBalance, x.debitTotal, `${x.code} ${x.name}`, x.creditTotal, x.creditBalance]);
        return {
          title: '합계잔액시산표', subtitle: `${q.date} 현재${r.unapprovedDrafts ? ` · 미승인 전표 ${r.unapprovedDrafts}건 제외` : ''}`,
          columns: [money('차변 잔액'), money('차변 합계'), { header: '계정과목', weight: 1.6, align: 'center', type: 'text', width: 24 }, money('대변 합계'), money('대변 잔액')],
          rows, totals: [r.totals.debitBalance, r.totals.debitTotal, '합계', r.totals.creditTotal, r.totals.creditBalance],
        };
      }
      default:
        throw new BadRequestException({ code: 'UNKNOWN_REPORT', message: '없는 보고서입니다' });
    }
  }

  async company(ctx: AccessContext) {
    const [c] = await this.db.select({ name: companies.name }).from(companies).where(eq(companies.id, ctx.companyId!));
    return c?.name ?? '';
  }
}

const Q = z.object({
  format: z.enum(['json', 'pdf', 'xlsx']).default('json'), size: z.enum(['A4', 'A3']).default('A4'), orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), projectId: z.string().uuid().optional(),
});

@ApiTags('보고서')
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('report', 'read')
  catalog(@Ctx() ctx: AccessContext) {
    return REPORTS.filter((r) => ctx.permissions.has(r.perm));
  }

  @Get(':key')
  @RequirePermission('report', 'read')
  async get(@Ctx() ctx: AccessContext, @Param('key') key: string, @Query(new ZodPipe(Q)) q: z.infer<typeof Q>, @Res() res: Response) {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new BadRequestException({ code: 'UNKNOWN_REPORT', message: '없는 보고서입니다' });
    if (!ctx.permissions.has(def.perm)) throw new ForbiddenException({ code: 'FORBIDDEN', message: '이 보고서를 볼 권한이 없습니다' });
    const today = todayKST();
    const params: Q = { from: q.from ?? today.slice(0, 8) + '01', to: q.to ?? today, date: q.date ?? today, projectId: q.projectId };
    const b = await this.svc.build(ctx, key, params);
    if (q.format === 'json') return res.json(b);
    if (!ctx.permissions.has('report:export')) throw new ForbiddenException({ code: 'FORBIDDEN', message: '보고서를 출력할 권한이 없습니다' });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'report', summary: `보고서 출력 ${b.title} (${q.format.toUpperCase()}${q.format === 'pdf' ? ` ${q.size}` : ''})` });
    const name = `${b.title.replace(/\s/g, '')}_${today}`;
    if (q.format === 'xlsx') {
      type R = (string | number | null)[];
      const wb = await buildExcel<R>({ sheet: b.title.slice(0, 28), title: b.title, subtitle: b.subtitle, rows: b.rows, columns: b.columns.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width ?? 14, type: c.type, value: (r: R) => (c.type === 'money' ? (r[i] === '' || r[i] === null ? null : r[i]) : r[i]) })) });
      return sendExcel(res, wb, `${name}.xlsx`);
    }
    const buf = await renderTablePdf({ ...b, company: await this.svc.company(ctx), printedBy: ctx.user.name, size: q.size, landscape: q.orientation === 'auto' ? !!b.landscape : q.orientation === 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }
}
