/**
 * 준공정산 — 현장의 최종 계약·기성·수금·원가·지급을 한 장으로 확인하고 '정산 완료'로 잠근다.
 *  - 결재 중인 문서가 있으면 정산할 수 없다 (나머지 미결 사항은 경고로 보여 주고 확인 후 진행)
 *  - 정산 시점의 숫자를 snapshot 으로 보존. 다시 열기는 사유와 함께 (감사로그)
 */
import { Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { BudgetService } from '../budget/budget';
import { D, moneyStr } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { projects, projectSettlements } from '../db/schema';
import { dateStr, loadProject, optText, ReasonDto } from './common';

const w = (v: Decimal.Value) => `${D(v).toDecimalPlaces(0, 1).toNumber().toLocaleString('ko-KR')}원`;
import type Decimal from 'decimal.js';

interface Check { key: string; label: string; level: 'BLOCK' | 'WARN' | 'OK'; detail: string; href?: string }

@Injectable()
export class SettlementService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly access: AccessService, private readonly audit: AuditService, private readonly budget: BudgetService) {}

  async preview(ctx: AccessContext, projectId: string) {
    const p = await loadProject(this.db, this.access, ctx, projectId);
    const s = await this.budget.projectSummary(ctx, projectId);
    const one = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute(q)).rows[0] as T;
    const pending = await one<{ n: number; codes: string | null }>(sql`select count(*)::int n, string_agg(doc_code, ', ') codes from approval where company_id = ${ctx.companyId} and project_id = ${projectId} and status in ('PENDING','HOLD')`);
    const unpaidReq = await one<{ n: number; amt: string }>(sql`select count(*)::int n, coalesce(sum(total_amount),0)::text amt from payment_request where project_id = ${projectId} and status = 'APPROVED'`);
    const subs = (await this.db.execute(sql`select s.id, s.code, s.title, s.status, v.name vendor_name, s.current_amount::text amount,
        coalesce((select sum(this_amount) from sub_claim c where c.subcontract_id = s.id and c.status = 'APPROVED'),0)::text claimed,
        coalesce((select sum(retention_amount) from sub_claim c where c.subcontract_id = s.id and c.status = 'APPROVED'),0)::text retention
      from subcontract s join vendor v on v.id = s.vendor_id where s.project_id = ${projectId} and s.status in ('ACTIVE','COMPLETED') order by s.code`)).rows as Record<string, string>[];
    const labor = await one<{ n: number; amt: string }>(sql`select count(*)::int n, coalesce(sum(amount),0)::text amt from labor_record where project_id = ${projectId} and status = 'RECORDED'`);
    const ti = await one<{ n: number }>(sql`select count(*)::int n from tax_invoice where project_id = ${projectId} and direction = 'PURCHASE' and status = 'COLLECTED'`);
    const openPo = await one<{ n: number }>(sql`select count(*)::int n from purchase_order where project_id = ${projectId} and status in ('APPROVED','SENT','PARTIAL')`);
    const r = s.revenue;
    const t = s.totals;
    const unpaidCost = D(t.actual).minus(t.paid);
    const checks: Check[] = [
      { key: 'approvals', label: '결재 중인 문서', level: pending.n ? 'BLOCK' : 'OK', detail: pending.n ? `${pending.n}건 (${pending.codes})` : '없음', href: '/approvals' },
      { key: 'unbilled', label: '미청구 기성', level: D(r.unbilled).gt(0) ? 'WARN' : 'OK', detail: `${w(r.unbilled)}`, href: `/claims?projectId=${projectId}` },
      { key: 'receivable', label: '미수금', level: D(r.receivable).gt(0) ? 'WARN' : 'OK', detail: `${w(r.receivable)} (유보금 ${w(r.retention)} 포함)`, href: '/collections' },
      { key: 'unpaid', label: '미지급 원가', level: unpaidCost.gt(0) ? 'WARN' : 'OK', detail: `${w(unpaidCost)} · 지급대기 결의 ${unpaidReq.n}건`, href: '/payment-requests?status=APPROVED' },
      { key: 'subcontracts', label: '정산 안 된 하도급', level: subs.some((x) => x.status === 'ACTIVE') ? 'WARN' : 'OK', detail: `${subs.filter((x) => x.status === 'ACTIVE').length}건`, href: '/subcontracts' },
      { key: 'labor', label: '미확정 노무비', level: labor.n ? 'WARN' : 'OK', detail: `${labor.n}건 ${w(labor.amt)}`, href: '/labor' },
      { key: 'taxinvoice', label: '미처리 매입 세금계산서', level: ti.n ? 'WARN' : 'OK', detail: `${ti.n}건`, href: '/tax-invoices?status=COLLECTED' },
      { key: 'po', label: '입고가 끝나지 않은 발주', level: openPo.n ? 'WARN' : 'OK', detail: `${openPo.n}건`, href: '/purchase-orders' },
    ];
    const history = await this.db.select().from(projectSettlements).where(eq(projectSettlements.projectId, projectId)).orderBy(desc(projectSettlements.createdAt));
    const profit = D(r.recognized).minus(t.actual);
    return {
      project: { id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, status: p.status, contractDate: p.contractDate, startDate: p.startDate, plannedEndDate: p.plannedEndDate, actualEndDate: p.actualEndDate, clientName: p.clientName },
      figures: {
        contractOriginal: r.contractOriginal, contractFinal: r.contractCurrent, claimed: r.claimed, recognized: r.recognized, collected: r.collected, receivable: r.receivable, retention: r.retention, unbilled: r.unbilled,
        budget: t.planned, committed: t.committed, cost: t.actual, paid: t.paid, unpaid: moneyStr(unpaidCost), profit: moneyStr(profit), profitRate: D(r.recognized).gt(0) ? profit.div(r.recognized).toFixed(4) : null,
        costRate: t.costRate,
      },
      costRows: s.rows, subcontracts: subs.map((x) => ({ ...x, balance: moneyStr(D(x.amount).minus(x.claimed)) })), checks, canSettle: !checks.some((c) => c.level === 'BLOCK') && p.status !== 'SETTLED',
      settlement: history.find((h) => h.status === 'SETTLED') ?? null, history,
    };
  }

  async settle(ctx: AccessContext, projectId: string, dto: { settleDate: string; memo?: string | null; acknowledge: boolean }) {
    const pv = await this.preview(ctx, projectId);
    if (pv.project.status === 'SETTLED') throw new ConflictException({ code: 'ALREADY', message: '이미 정산 완료된 현장입니다' });
    const block = pv.checks.find((c) => c.level === 'BLOCK');
    if (block) throw new ConflictException({ code: 'BLOCKED', message: `${block.label}: ${block.detail} — 먼저 처리하세요` });
    const warns = pv.checks.filter((c) => c.level === 'WARN');
    if (warns.length && !dto.acknowledge) throw new ConflictException({ code: 'NEED_ACK', message: `확인할 미결 사항이 ${warns.length}건 있습니다. 내용을 확인했다고 체크한 뒤 정산하세요` });
    const f = pv.figures;
    return this.db.transaction(async (tx) => {
      const [s] = await tx.insert(projectSettlements).values({
        companyId: ctx.companyId!, projectId, settleDate: dto.settleDate, finalContract: f.contractFinal, totalClaimed: f.recognized, totalCollected: f.collected, receivable: f.receivable,
        totalCost: f.cost, totalPaid: f.paid, unpaid: f.unpaid, profit: f.profit, snapshot: { figures: f, costRows: pv.costRows, subcontracts: pv.subcontracts, warnings: warns } as never, memo: dto.memo ?? null, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).returning();
      await tx.update(projects).set({ status: 'SETTLED', actualEndDate: pv.project.actualEndDate ?? dto.settleDate, progressRate: '1', updatedById: ctx.user.id, updatedAt: new Date() }).where(eq(projects.id, projectId));
      await this.audit.fromCtx(ctx, { action: 'SETTLE', resource: 'project', resourceId: projectId, summary: `준공정산 완료 ${pv.project.name} — 최종계약 ${D(f.contractFinal).toFixed(0)}원, 원가 ${D(f.cost).toFixed(0)}원, 손익 ${D(f.profit).toFixed(0)}원${warns.length ? ` (미결 ${warns.length}건 확인)` : ''}` }, tx);
      return s;
    });
  }

  async reopen(ctx: AccessContext, projectId: string, reason: string) {
    const p = await loadProject(this.db, this.access, ctx, projectId);
    if (p.status !== 'SETTLED') throw new ConflictException({ code: 'NOT_SETTLED', message: '정산 완료 상태가 아닙니다' });
    return this.db.transaction(async (tx) => {
      await tx.update(projectSettlements).set({ status: 'REOPENED', reopenReason: reason, updatedById: ctx.user.id, updatedAt: new Date() }).where(and(eq(projectSettlements.projectId, projectId), eq(projectSettlements.status, 'SETTLED')));
      await tx.update(projects).set({ status: 'COMPLETED', updatedById: ctx.user.id, updatedAt: new Date() }).where(eq(projects.id, projectId));
      await this.audit.fromCtx(ctx, { action: 'REOPEN', resource: 'project', resourceId: projectId, summary: `준공정산 다시 열기 ${p.name} — ${reason}` }, tx);
      return { ok: true };
    });
  }
}

@ApiTags('현장 · 준공정산')
@Controller('projects/:id/settlement')
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Get()
  @RequirePermission('report', 'read')
  preview(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.preview(ctx, id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('closing', 'approve')
  settle(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ settleDate: dateStr.default(todayKST()), memo: optText(1000), acknowledge: z.boolean().default(false) }))) dto: { settleDate: string; memo?: string | null; acknowledge: boolean }) {
    return this.svc.settle(ctx, id, dto);
  }

  @Post('reopen')
  @HttpCode(200)
  @RequirePermission('closing', 'approve')
  reopen(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.reopen(ctx, id, dto.reason);
  }
}
