/**
 * 실행예산·현장 원가·현장 손익
 *  계획(실행예산) / 발주확정 / 발생원가 / 지급완료 / 잔여예산 을 원가항목별로 구분한다.
 *  - 발주확정: 승인된 발주서 공급가액 (종결된 발주는 실제 입고분만) + 승인된 경비 결의 + (4단계) 하도급 계약
 *  - 발생원가: 공사원가 계정 분개 합계 (미승인 자동분개 포함 — 현장에서는 실시간으로 보여야 하므로)
 *  - 지급완료: 지급된 결의의 공급가액
 *  - 잔여예산: 계획 − max(발주확정, 발생원가)
 * 실행예산 변경은 결재 승인 시에만 반영된다.
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { D, moneyStr, sumMoney } from '../common/money';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { budgetAlertAcks, budgetRevisionLines, budgetRevisions, costCodes, projectBudgets, projects } from '../db/schema';

const RevisionDto = z.object({
  title: z.string().trim().min(1, '제목을 입력해 주세요').max(200),
  reason: z.string().trim().min(2, '편성·변경 사유를 입력해 주세요').max(1000),
  lines: z.array(z.object({
    costCodeId: z.string().uuid(),
    afterAmount: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/,/g, '') || '0').refine((v) => /^\d{1,15}$/.test(v), '금액은 원 단위'),
    memo: z.string().trim().max(200).optional().nullable(),
  })).min(1).max(100),
});
type RevisionDto = z.infer<typeof RevisionDto>;
export const REV_STATUS_LABEL = { DRAFT: '작성중', PENDING: '결재중', APPROVED: '반영', REJECTED: '반려', CANCELLED: '취소' } as const;

export interface CostRow { costCodeId: string; code: string; name: string; planned: string; committed: string; actual: string; paid: string; remaining: string; usedRate: string | null; level: 'OK' | 'WARN' | 'OVER' | 'UNBUDGETED' }
const tableExists = async (db: DB, name: string) => !!((await db.execute(sql`select to_regclass(${'public.' + name}) is not null as ok`)).rows[0] as { ok: boolean }).ok;

@Injectable()
export class BudgetService implements OnModuleInit {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly access: AccessService, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly approvals: ApprovalsService) {}

  onModuleInit() {
    this.approvals.register('BUDGET', {
      resource: 'budget',
      href: (id) => `/budgets/revisions/${id}`,
      onApproved: async (tx, id, ctx) => {
        const [rev] = await tx.update(budgetRevisions).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${budgetRevisions.version} + 1` }).where(eq(budgetRevisions.id, id)).returning();
        const lines = await tx.select().from(budgetRevisionLines).where(eq(budgetRevisionLines.revisionId, id));
        // 변경분(증감액)을 현재 예산에 더한다 — 그사이 다른 변경이 승인되었어도 서로 덮어쓰지 않게
        for (const l of lines) {
          const delta = D(l.afterAmount).minus(l.beforeAmount);
          await tx.insert(projectBudgets).values({ companyId: rev.companyId, projectId: rev.projectId, costCodeId: l.costCodeId, amount: moneyStr(D(l.afterAmount)) })
            .onConflictDoUpdate({ target: [projectBudgets.projectId, projectBudgets.costCodeId], set: { amount: sql`greatest(0, ${projectBudgets.amount} + ${moneyStr(delta)})`, updatedAt: new Date() } });
        }
        const [{ total }] = (await tx.execute(sql`select coalesce(sum(amount),0)::text total from project_budget where project_id = ${rev.projectId}`)).rows as { total: string }[];
        await tx.update(projects).set({ executionBudget: total, version: sql`${projects.version} + 1` }).where(eq(projects.id, rev.projectId));
        await this.audit.fromCtx(ctx, { action: 'APPLY', resource: 'budget', resourceId: rev.projectId, summary: `실행예산 반영 ${rev.code} → 총 ${D(total).toFixed(0)}원` }, tx);
      },
      onRejected: async (tx, id) => {
        await tx.update(budgetRevisions).set({ status: 'REJECTED', version: sql`${budgetRevisions.version} + 1` }).where(eq(budgetRevisions.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(budgetRevisions).set({ status: 'DRAFT', approvalId: null, version: sql`${budgetRevisions.version} + 1` }).where(eq(budgetRevisions.id, id));
      },
    });
  }

  private async project(ctx: AccessContext, id: string) {
    const [p] = await this.db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
    if (!p || !this.access.canSeeProject(ctx, id)) throw notFound('현장');
    return p;
  }

  /** 현장들의 원가항목별 계획·확정·발생·지급 (한 번의 집계로) */
  async costMatrix(ctx: AccessContext, projectIds: string[]) {
    if (!projectIds.length) return new Map<string, CostRow[]>();
    const cid = ctx.companyId!;
    const ids = sql.join(projectIds.map((i) => sql`${i}`), sql`, `);
    const ccs = await this.db.select().from(costCodes).where(eq(costCodes.companyId, cid)).orderBy(asc(costCodes.sortOrder), asc(costCodes.code));
    const defaultCc = ccs.find((c) => c.code === 'C01')?.id ?? ccs[0]?.id;
    const q = async (query: ReturnType<typeof sql>) => (await this.db.execute(query)).rows as { project_id: string; cost_code_id: string | null; amt: string }[];
    const planned = await q(sql`select project_id, cost_code_id, amount::text amt from project_budget where project_id in (${ids})`);
    const committedPo = await q(sql`
      select po.project_id, po.cost_code_id, sum(case when po.status = 'CLOSED' then coalesce((select sum(gr.supply_amount) from goods_receipt gr where gr.po_id = po.id and gr.status = 'CONFIRMED'),0) else po.supply_amount end)::text amt
      from purchase_order po where po.company_id = ${cid} and po.project_id in (${ids}) and po.status in ('APPROVED','SENT','PARTIAL','RECEIVED','CLOSED') group by 1,2`);
    const committedExp = await q(sql`
      select r.project_id, coalesce(l.cost_code_id, (select c.id from cost_code c where c.company_id = ${cid} and c.account_id = l.account_id order by c.sort_order limit 1)) cost_code_id,
             sum(l.supply_amount + case when l.vat_deductible then 0 else l.vat_amount end)::text amt
      from payment_request_line l join payment_request r on r.id = l.request_id
      where r.company_id = ${cid} and r.project_id in (${ids}) and r.status in ('APPROVED','PAID') and l.source_type is null group by 1,2`);
    const committedSub = (await tableExists(this.db, 'subcontract'))
      ? await q(sql`select project_id, cost_code_id, sum(current_amount)::text amt from subcontract where company_id = ${cid} and project_id in (${ids}) and status in ('ACTIVE','COMPLETED') group by 1,2`)
      : [];
    const actual = await q(sql`
      select l.project_id, coalesce(l.cost_code_id, (select c.id from cost_code c where c.company_id = ${cid} and c.account_id = l.account_id order by c.sort_order limit 1)) cost_code_id,
             sum(l.debit - l.credit)::text amt
      from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
      where e.company_id = ${cid} and e.status in ('DRAFT','APPROVED','REVERSED') and a.category = 'CONSTRUCTION_COST' and l.project_id in (${ids}) group by 1,2`);
    const paid = await q(sql`
      select r.project_id, coalesce(l.cost_code_id, (select c.id from cost_code c where c.company_id = ${cid} and c.account_id = l.account_id order by c.sort_order limit 1)) cost_code_id,
             sum(l.supply_amount)::text amt
      from payment_request_line l join payment_request r on r.id = l.request_id
      where r.company_id = ${cid} and r.project_id in (${ids}) and r.status = 'PAID' group by 1,2`);
    const pick = (rows: typeof planned, pid: string, ccid: string) => rows.filter((r) => r.project_id === pid && (r.cost_code_id ?? defaultCc) === ccid).reduce((a, r) => a.plus(r.amt), D(0));
    const out = new Map<string, CostRow[]>();
    for (const pid of projectIds) {
      const rows: CostRow[] = [];
      for (const c of ccs) {
        const pl = pick(planned, pid, c.id);
        const cm = pick(committedPo, pid, c.id).plus(pick(committedExp, pid, c.id)).plus(pick(committedSub, pid, c.id));
        const ac = pick(actual, pid, c.id);
        const pd = pick(paid, pid, c.id);
        if (!c.isActive && pl.eq(0) && cm.eq(0) && ac.eq(0)) continue;
        const used = Decimal.max(cm, ac);
        const level: CostRow['level'] = pl.eq(0) ? (used.gt(0) ? 'UNBUDGETED' : 'OK') : used.gt(pl) ? 'OVER' : used.gte(pl.mul(0.9)) ? 'WARN' : 'OK';
        rows.push({ costCodeId: c.id, code: c.code, name: c.name, planned: moneyStr(pl), committed: moneyStr(cm), actual: moneyStr(ac), paid: moneyStr(pd), remaining: moneyStr(pl.minus(used)), usedRate: pl.gt(0) ? used.div(pl).toFixed(4) : null, level });
      }
      out.set(pid, rows);
    }
    return out;
  }

  /** 매출 측 (4단계 기성·수금 테이블이 있으면 집계) */
  async revenueMatrix(ctx: AccessContext, projectIds: string[]) {
    const out = new Map<string, { contractOriginal: string; contractCurrent: string; contractPending: string; claimed: string; recognized: string; collected: string; receivable: string; unbilled: string; retention: string; advanceBalance: string; available: boolean }>();
    if (!projectIds.length) return out;
    const ids = sql.join(projectIds.map((i) => sql`${i}`), sql`, `);
    const ps = (await this.db.execute(sql`select id, supply_amount::text supply from project where id in (${ids})`)).rows as { id: string; supply: string }[];
    const hasClaims = await tableExists(this.db, 'progress_claim');
    const hasRev = await tableExists(this.db, 'contract_revision');
    const q = async (query: ReturnType<typeof sql>) => (await this.db.execute(query)).rows as { project_id: string; amt: string }[];
    const revApproved = hasRev ? await q(sql`select project_id, sum(delta_amount)::text amt from contract_revision where project_id in (${ids}) and status = 'APPROVED' group by 1`) : [];
    const revPending = hasRev ? await q(sql`select project_id, sum(delta_amount)::text amt from contract_revision where project_id in (${ids}) and status in ('DRAFT','PENDING') group by 1`) : [];
    const claimed = hasClaims ? await q(sql`select project_id, sum(this_supply)::text amt from progress_claim where project_id in (${ids}) and status in ('PENDING','APPROVED','INVOICED','COLLECTED','PARTIAL') group by 1`) : [];
    const recognized = hasClaims ? await q(sql`select project_id, sum(this_supply)::text amt from progress_claim where project_id in (${ids}) and status in ('APPROVED','INVOICED','COLLECTED','PARTIAL') group by 1`) : [];
    const billedTotal = hasClaims ? await q(sql`select project_id, sum(receivable_amount)::text amt from progress_claim where project_id in (${ids}) and status in ('APPROVED','INVOICED','COLLECTED','PARTIAL') group by 1`) : [];
    const retention = hasClaims ? await q(sql`select project_id, sum(retention_amount)::text amt from progress_claim where project_id in (${ids}) and status in ('APPROVED','INVOICED','COLLECTED','PARTIAL') group by 1`) : [];
    const collected = hasClaims ? await q(sql`select c.project_id, sum(c.amount)::text amt from collection c where c.project_id in (${ids}) and c.status = 'CONFIRMED' and c.kind <> 'ADVANCE' group by 1`) : [];
    const adv = hasClaims ? await q(sql`select project_id, (coalesce(sum(case when kind = 'ADVANCE' then amount else 0 end),0))::text amt from collection where project_id in (${ids}) and status = 'CONFIRMED' group by 1`) : [];
    const advUsed = hasClaims ? await q(sql`select project_id, sum(advance_deduction)::text amt from progress_claim where project_id in (${ids}) and status in ('APPROVED','INVOICED','COLLECTED','PARTIAL') group by 1`) : [];
    const get = (rows: { project_id: string; amt: string }[], id: string) => D(rows.find((r) => r.project_id === id)?.amt ?? 0);
    for (const p of ps) {
      const current = D(p.supply).plus(get(revApproved, p.id));
      const rec = get(recognized, p.id);
      out.set(p.id, {
        available: hasClaims,
        contractOriginal: moneyStr(p.supply), contractCurrent: moneyStr(current), contractPending: moneyStr(get(revPending, p.id)),
        claimed: moneyStr(get(claimed, p.id)), recognized: moneyStr(rec), collected: moneyStr(get(collected, p.id)),
        // 미수금 = 청구해서 받을 금액(부가세 포함, 유보·선급 공제 후) − 수금
        receivable: moneyStr(get(billedTotal, p.id).minus(get(collected, p.id))),
        unbilled: moneyStr(current.minus(get(claimed, p.id))),
        retention: moneyStr(get(retention, p.id)),
        advanceBalance: moneyStr(get(adv, p.id).minus(get(advUsed, p.id))),
      });
    }
    return out;
  }

  async projectSummary(ctx: AccessContext, projectId: string) {
    const p = await this.project(ctx, projectId);
    const rows = (await this.costMatrix(ctx, [projectId])).get(projectId)!;
    const rev = (await this.revenueMatrix(ctx, [projectId])).get(projectId)!;
    const revisions = await this.db.select().from(budgetRevisions).where(eq(budgetRevisions.projectId, projectId)).orderBy(desc(budgetRevisions.createdAt));
    const acks = await this.db.select().from(budgetAlertAcks).where(eq(budgetAlertAcks.projectId, projectId));
    const tot = (k: keyof CostRow) => sumMoney(rows.map((r) => r[k] as string));
    const planned = D(tot('planned'));
    const actual = D(tot('actual'));
    // 예상 준공원가: 원가항목별 max(계획, 발주확정, 발생)
    const eac = rows.reduce((a, r) => a.plus(Decimal.max(r.planned, r.committed, r.actual)), D(0));
    const contract = D(rev.contractCurrent);
    return {
      project: { id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, status: p.status, supplyAmount: p.supplyAmount, executionBudget: p.executionBudget, progressRate: p.progressRate, startDate: p.startDate, plannedEndDate: p.plannedEndDate },
      hasBreakdown: rows.some((r) => !D(r.planned).eq(0)),
      rows: rows.map((r) => ({ ...r, ack: acks.find((a) => a.costCodeId === r.costCodeId && a.level === (r.level === 'UNBUDGETED' ? 'OVER' : r.level)) ?? null })),
      totals: { planned: moneyStr(planned), committed: tot('committed'), actual: moneyStr(actual), paid: tot('paid'), remaining: tot('remaining'), costRate: planned.gt(0) ? actual.div(planned).toFixed(4) : null },
      revenue: rev,
      forecast: {
        estimatedCost: moneyStr(eac),
        estimatedProfit: moneyStr(contract.minus(eac)),
        estimatedMarginRate: contract.gt(0) ? contract.minus(eac).div(contract).toFixed(4) : null,
        currentProfit: moneyStr(D(rev.recognized).minus(actual)),
        unpaidCost: moneyStr(actual.minus(tot('paid'))),
      },
      revisions: revisions.map((r) => ({ ...r, statusLabel: REV_STATUS_LABEL[r.status] })),
    };
  }

  /** 모든 현장 (범위 내) 요약 — 현장 손익 목록·대시보드 경고 */
  async overview(ctx: AccessContext, opts: { status?: string } = {}) {
    const conds = [eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt), this.access.projectScope(ctx, projects.id)];
    if (opts.status === 'ACTIVE') conds.push(inArray(projects.status, ['PLANNED', 'IN_PROGRESS', 'SUSPENDED']));
    else if (opts.status) conds.push(eq(projects.status, opts.status as 'IN_PROGRESS'));
    const ps = await this.db.select().from(projects).where(and(...conds)).orderBy(desc(projects.createdAt)).limit(500);
    const ids = ps.map((p) => p.id);
    const cost = await this.costMatrix(ctx, ids);
    const rev = await this.revenueMatrix(ctx, ids);
    const acks = ids.length ? await this.db.select().from(budgetAlertAcks).where(inArray(budgetAlertAcks.projectId, ids)) : [];
    const alerts: { projectId: string; projectCode: string; projectName: string; tradeType: string; costCodeId: string; costCodeName: string; level: string; planned: string; used: string; usedRate: string | null; ackedBy: string | null; ackedAt: Date | null }[] = [];
    const rows = ps.map((p) => {
      const cr = cost.get(p.id) ?? [];
      const r = rev.get(p.id)!;
      const sum = (k: keyof CostRow) => cr.reduce((a, x) => a.plus(x[k] as string), D(0));
      const planned = sum('planned'), actual = sum('actual'), committed = sum('committed'), paid = sum('paid');
      const eac = cr.reduce((a, x) => a.plus(Decimal.max(x.planned, x.committed, x.actual)), D(0));
      const budgetTotal = planned.gt(0) ? planned : D(p.executionBudget);
      const contract = D(r.contractCurrent);
      for (const x of cr) {
        if (x.level === 'OVER' || x.level === 'WARN' || x.level === 'UNBUDGETED') {
          if (x.level === 'UNBUDGETED' && planned.eq(0)) continue; // 예산을 아예 편성하지 않은 현장은 항목별 경고 대신 '미편성' 표시
          const ack = acks.find((a) => a.projectId === p.id && a.costCodeId === x.costCodeId && a.level === (x.level === 'UNBUDGETED' ? 'OVER' : x.level));
          alerts.push({ projectId: p.id, projectCode: p.code, projectName: p.name, tradeType: p.tradeType, costCodeId: x.costCodeId, costCodeName: x.name, level: x.level, planned: x.planned, used: moneyStr(Decimal.max(x.committed, x.actual)), usedRate: x.usedRate, ackedBy: ack?.ackedByName ?? null, ackedAt: ack?.ackedAt ?? null });
        }
      }
      return {
        id: p.id, code: p.code, name: p.name, tradeType: p.tradeType, status: p.status, progressRate: p.progressRate,
        contractCurrent: r.contractCurrent, recognized: r.recognized, collected: r.collected, receivable: r.receivable, unbilled: r.unbilled,
        budget: moneyStr(budgetTotal), budgetBreakdown: planned.gt(0), committed: moneyStr(committed), actual: moneyStr(actual), paid: moneyStr(paid), unpaid: moneyStr(actual.minus(paid)),
        costRate: budgetTotal.gt(0) ? actual.div(budgetTotal).toFixed(4) : null,
        estimatedCost: moneyStr(planned.gt(0) ? eac : Decimal.max(budgetTotal, actual, committed)),
        estimatedProfit: moneyStr(contract.minus(planned.gt(0) ? eac : Decimal.max(budgetTotal, actual, committed))),
        currentProfit: moneyStr(D(r.recognized).minus(actual)),
        alertCount: cr.filter((x) => x.level === 'OVER' || (x.level === 'UNBUDGETED' && planned.gt(0))).length,
      };
    });
    const t = (k: keyof (typeof rows)[number]) => sumMoney(rows.map((r) => r[k] as string));
    return {
      revenueAvailable: [...rev.values()][0]?.available ?? false,
      rows,
      totals: { contractCurrent: t('contractCurrent'), recognized: t('recognized'), collected: t('collected'), receivable: t('receivable'), budget: t('budget'), committed: t('committed'), actual: t('actual'), paid: t('paid'), unpaid: t('unpaid'), estimatedProfit: t('estimatedProfit') },
      alerts: alerts.sort((a, b) => (a.level === 'OVER' ? 0 : 1) - (b.level === 'OVER' ? 0 : 1) || Number(b.usedRate ?? 9) - Number(a.usedRate ?? 9)),
    };
  }

  async ack(ctx: AccessContext, projectId: string, costCodeId: string, level: 'WARN' | 'OVER', note?: string) {
    await this.project(ctx, projectId);
    await this.db.transaction(async (tx) => {
      await tx.insert(budgetAlertAcks).values({ projectId, costCodeId, level, note: note ?? null, ackedById: ctx.user.id, ackedByName: ctx.user.name })
        .onConflictDoUpdate({ target: [budgetAlertAcks.projectId, budgetAlertAcks.costCodeId, budgetAlertAcks.level], set: { note: note ?? null, ackedById: ctx.user.id, ackedByName: ctx.user.name, ackedAt: new Date() } });
      await this.audit.fromCtx(ctx, { action: 'ACK', resource: 'budget', resourceId: projectId, summary: `예산 ${level === 'OVER' ? '초과' : '90% 도달'} 경고 확인${note ? ` — ${note}` : ''}` }, tx);
    });
    return { ok: true };
  }

  // ───────── 실행예산 편성·변경 ─────────
  async getRevision(ctx: AccessContext, id: string) {
    const [r] = await this.db.select({ r: budgetRevisions, projectCode: projects.code, projectName: projects.name, tradeType: projects.tradeType }).from(budgetRevisions).innerJoin(projects, eq(projects.id, budgetRevisions.projectId))
      .where(and(eq(budgetRevisions.id, id), eq(budgetRevisions.companyId, ctx.companyId!), this.access.projectScope(ctx, budgetRevisions.projectId)));
    if (!r) throw notFound('실행예산 변경');
    const lines = await this.db.select({ l: budgetRevisionLines, code: costCodes.code, name: costCodes.name }).from(budgetRevisionLines).innerJoin(costCodes, eq(costCodes.id, budgetRevisionLines.costCodeId)).where(eq(budgetRevisionLines.revisionId, id)).orderBy(asc(costCodes.sortOrder));
    const current = (await this.costMatrix(ctx, [r.r.projectId])).get(r.r.projectId)!;
    return {
      ...r.r, projectCode: r.projectCode, projectName: r.projectName, tradeType: r.tradeType, statusLabel: REV_STATUS_LABEL[r.r.status],
      lines: lines.map(({ l, code, name }) => {
        const c = current.find((x) => x.costCodeId === l.costCodeId);
        return { ...l, code, name, delta: moneyStr(D(l.afterAmount).minus(l.beforeAmount)), committed: c?.committed ?? '0', actual: c?.actual ?? '0' };
      }),
      ...(await this.approvals.docState(ctx, 'BUDGET', id)),
    };
  }

  private async buildLines(ctx: AccessContext, projectId: string, dto: RevisionDto) {
    const ccIds = [...new Set(dto.lines.map((l) => l.costCodeId))];
    if (ccIds.length !== dto.lines.length) throw new BadRequestException({ code: 'DUP_COST_CODE', message: '같은 원가항목이 두 번 들어 있습니다' });
    const ccs = await this.db.select().from(costCodes).where(and(inArray(costCodes.id, ccIds), eq(costCodes.companyId, ctx.companyId!)));
    if (ccs.length !== ccIds.length) throw new BadRequestException({ code: 'BAD_COST_CODE', message: '원가항목을 다시 확인해 주세요' });
    const cur = await this.db.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId));
    const lines = dto.lines.map((l) => ({ costCodeId: l.costCodeId, beforeAmount: cur.find((c) => c.costCodeId === l.costCodeId)?.amount ?? '0.00', afterAmount: moneyStr(l.afterAmount), memo: l.memo ?? null }))
      .filter((l) => !D(l.beforeAmount).eq(l.afterAmount));
    if (!lines.length) throw new BadRequestException({ code: 'NO_CHANGE', message: '바뀐 금액이 없습니다' });
    const totalBefore = sumMoney(cur.map((c) => c.amount));
    const totalAfter = moneyStr(D(totalBefore).plus(lines.reduce((a, l) => a.plus(D(l.afterAmount).minus(l.beforeAmount)), D(0))));
    return { lines, totalBefore, totalAfter };
  }

  async createRevision(ctx: AccessContext, projectId: string, dto: RevisionDto) {
    await this.project(ctx, projectId);
    const b = await this.buildLines(ctx, projectId, dto);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'BR');
      const [r] = await tx.insert(budgetRevisions).values({ companyId: ctx.companyId!, projectId, code, title: dto.title, reason: dto.reason, totalBefore: b.totalBefore, totalAfter: b.totalAfter, createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await tx.insert(budgetRevisionLines).values(b.lines.map((l) => ({ ...l, revisionId: r.id })));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'budget', resourceId: projectId, summary: `실행예산 변경 작성 ${code} (${D(b.totalBefore).toFixed(0)} → ${D(b.totalAfter).toFixed(0)}원)`, after: b }, tx);
      return r;
    });
  }

  async updateRevision(ctx: AccessContext, id: string, dto: RevisionDto & { version: number }) {
    const cur = await this.getRevision(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'REV_LOCKED', message: '작성중·반려 상태에서만 고칠 수 있습니다' });
    const b = await this.buildLines(ctx, cur.projectId, dto);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(budgetRevisions).set({ title: dto.title, reason: dto.reason, totalBefore: b.totalBefore, totalAfter: b.totalAfter, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${budgetRevisions.version} + 1` })
        .where(and(eq(budgetRevisions.id, id), eq(budgetRevisions.version, dto.version))).returning();
      if (!r) throw staleVersion();
      await tx.delete(budgetRevisionLines).where(eq(budgetRevisionLines.revisionId, id));
      await tx.insert(budgetRevisionLines).values(b.lines.map((l) => ({ ...l, revisionId: id })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'budget', resourceId: cur.projectId, summary: `실행예산 변경 수정 ${r.code}` }, tx);
      return r;
    });
  }

  async submitRevision(ctx: AccessContext, id: string, version: number) {
    const cur = await this.getRevision(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'REV_LOCKED', message: '이미 상신했거나 처리된 문서입니다' });
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(budgetRevisions).set({ status: 'PENDING', version: sql`${budgetRevisions.version} + 1` }).where(and(eq(budgetRevisions.id, id), eq(budgetRevisions.version, version), inArray(budgetRevisions.status, ['DRAFT', 'REJECTED']))).returning();
      if (!u) throw staleVersion();
      const delta = D(cur.totalAfter).minus(cur.totalBefore);
      const a = await this.approvals.submit(tx, ctx, { docType: 'BUDGET', docId: id, docCode: cur.code, title: `[실행예산 ${delta.gte(0) ? '증액' : '감액'}] ${cur.projectName} — ${cur.title}`, amount: moneyStr(delta.abs()), projectId: cur.projectId });
      await tx.update(budgetRevisions).set({ approvalId: a.id }).where(eq(budgetRevisions.id, id));
      return { approvalId: a.id };
    });
  }

  async cancelRevision(ctx: AccessContext, id: string, version: number) {
    const cur = await this.getRevision(ctx, id);
    if (!['DRAFT', 'REJECTED'].includes(cur.status)) throw new ConflictException({ code: 'REV_LOCKED', message: '작성중·반려 상태에서만 취소할 수 있습니다' });
    const [u] = await this.db.update(budgetRevisions).set({ status: 'CANCELLED', version: sql`${budgetRevisions.version} + 1` }).where(and(eq(budgetRevisions.id, id), eq(budgetRevisions.version, version))).returning();
    if (!u) throw staleVersion();
    return u;
  }
}

const Version = z.object({ version: z.coerce.number().int() });

@ApiTags('현장 · 실행예산·손익')
@Controller()
export class BudgetController {
  constructor(private readonly svc: BudgetService) {}

  @Get('budgets/overview')
  @RequirePermission('budget', 'read')
  overview(@Ctx() ctx: AccessContext, @Query('status') status?: string) {
    return this.svc.overview(ctx, { status: status || 'ACTIVE' });
  }

  @Get('budgets/:projectId')
  @RequirePermission('budget', 'read')
  summary(@Ctx() ctx: AccessContext, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.svc.projectSummary(ctx, projectId);
  }

  @Post('budgets/:projectId/revisions')
  @RequirePermission('budget', 'create')
  createRevision(@Ctx() ctx: AccessContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Body(new ZodPipe(RevisionDto)) dto: RevisionDto) {
    return this.svc.createRevision(ctx, projectId, dto);
  }

  @Post('budgets/:projectId/alerts/:costCodeId/ack')
  @HttpCode(200)
  @RequirePermission('budget', 'read')
  ack(@Ctx() ctx: AccessContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('costCodeId', ParseUUIDPipe) costCodeId: string, @Body(new ZodPipe(z.object({ level: z.enum(['WARN', 'OVER']), note: z.string().trim().max(300).optional() }))) dto: { level: 'WARN' | 'OVER'; note?: string }) {
    return this.svc.ack(ctx, projectId, costCodeId, dto.level, dto.note);
  }

  @Get('budget-revisions/:id')
  @RequirePermission('budget', 'read')
  getRevision(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRevision(ctx, id);
  }

  @Put('budget-revisions/:id')
  @RequirePermission('budget', 'update')
  updateRevision(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RevisionDto.extend({ version: z.coerce.number().int() }))) dto: RevisionDto & { version: number }) {
    return this.svc.updateRevision(ctx, id, dto);
  }

  @Post('budget-revisions/:id/submit')
  @HttpCode(200)
  @RequirePermission('budget', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Version)) dto: { version: number }) {
    return this.svc.submitRevision(ctx, id, dto.version);
  }

  @Post('budget-revisions/:id/cancel')
  @HttpCode(200)
  @RequirePermission('budget', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Version)) dto: { version: number }) {
    return this.svc.cancelRevision(ctx, id, dto.version);
  }

  /** 현장 손익 목록 */
  @Get('project-pl')
  @RequirePermission('report', 'read')
  pl(@Ctx() ctx: AccessContext, @Query('status') status?: string) {
    return this.svc.overview(ctx, { status: status === 'ALL' ? undefined : status || 'ACTIVE' });
  }

  @Get('project-pl/:projectId')
  @RequirePermission('report', 'read')
  plOne(@Ctx() ctx: AccessContext, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.svc.projectSummary(ctx, projectId);
  }
}
