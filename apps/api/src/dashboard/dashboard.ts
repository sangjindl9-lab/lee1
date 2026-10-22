import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { RESOURCES } from '../access/catalog';
import { D, moneyStr } from '../common/money';
import { todayKST } from '../common/numbering.service';
import { DB, DB_TOKEN } from '../db/db';
import { projects, vendors } from '../db/schema';
import { can } from '../access/context';
import { ApprovalsService } from '../approvals/approvals';
import { PurchaseService } from '../purchase/purchase.service';
import { PaymentsService } from '../payments/payments';
import { BudgetService } from '../budget/budget';

/**
 * 대시보드 — 실제 저장된 데이터만 집계한다.
 * 아직 구현되지 않은 단계의 지표는 값 대신 { available:false, stage } 로 돌려주어
 * 화면이 0원으로 오해하게 표시하지 않도록 한다.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly access: AccessService, private readonly purchase: PurchaseService, private readonly approvals: ApprovalsService, private readonly payments: PaymentsService, private readonly budget: BudgetService) {}

  async summary(ctx: AccessContext) {
    const scope = and(eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt), this.access.projectScope(ctx, projects.id));
    const today = todayKST();
    const in30 = new Date(Date.now() + 9 * 3600000 + 30 * 86400000).toISOString().slice(0, 10);
    const ACTIVE = ['PLANNED', 'IN_PROGRESS', 'SUSPENDED'] as const;

    const byStatus = await this.db
      .select({ status: projects.status, n: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(${projects.supplyAmount}),0)::text`, vat: sql<string>`coalesce(sum(${projects.vatAmount}),0)::text`, total: sql<string>`coalesce(sum(${projects.totalAmount}),0)::text`, budget: sql<string>`coalesce(sum(${projects.executionBudget}),0)::text` })
      .from(projects).where(scope).groupBy(projects.status);

    const byTrade = await this.db
      .select({ tradeType: projects.tradeType, n: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(${projects.supplyAmount}),0)::text`, budget: sql<string>`coalesce(sum(${projects.executionBudget}),0)::text` })
      .from(projects).where(and(scope, inArray(projects.status, [...ACTIVE]))).groupBy(projects.tradeType);

    // 최근 12개월 계약 체결 추이 (계약일 기준, 공급가액)
    const from12 = new Date(Date.now() + 9 * 3600000);
    from12.setUTCDate(1);
    from12.setUTCMonth(from12.getUTCMonth() - 11);
    const monthly = await this.db
      .select({ ym: sql<string>`to_char(${projects.contractDate}, 'YYYY-MM')`, n: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(${projects.supplyAmount}),0)::text` })
      .from(projects).where(and(scope, gte(projects.contractDate, from12.toISOString().slice(0, 10))))
      .groupBy(sql`1`).orderBy(sql`1`);
    const months: { ym: string; count: number; supply: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(from12);
      d.setUTCMonth(from12.getUTCMonth() + i);
      const ym = d.toISOString().slice(0, 7);
      const m = monthly.find((x) => x.ym === ym);
      months.push({ ym, count: m?.n ?? 0, supply: m?.supply ?? '0' });
    }

    const activeList = await this.db
      .select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, status: projects.status, supplyAmount: projects.supplyAmount, executionBudget: projects.executionBudget, progressRate: projects.progressRate, plannedEndDate: projects.plannedEndDate, startDate: projects.startDate })
      .from(projects).where(and(scope, inArray(projects.status, ['IN_PROGRESS', 'SUSPENDED']))).orderBy(asc(projects.plannedEndDate)).limit(50);

    const dueSoon = await this.db
      .select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, plannedEndDate: projects.plannedEndDate, progressRate: projects.progressRate })
      .from(projects).where(and(scope, eq(projects.status, 'IN_PROGRESS'), gte(projects.plannedEndDate, today), lte(projects.plannedEndDate, in30))).orderBy(asc(projects.plannedEndDate)).limit(10);

    const overdue = await this.db
      .select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, plannedEndDate: projects.plannedEndDate, progressRate: projects.progressRate })
      .from(projects).where(and(scope, eq(projects.status, 'IN_PROGRESS'), lt(projects.plannedEndDate, today))).orderBy(asc(projects.plannedEndDate)).limit(10);

    const recent = await this.db
      .select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, status: projects.status, totalAmount: projects.totalAmount, createdAt: projects.createdAt })
      .from(projects).where(scope).orderBy(desc(projects.createdAt)).limit(6);

    const [{ vendorCount }] = await this.db.select({ vendorCount: sql<number>`count(*)::int` }).from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)));

    const activeRows = byStatus.filter((s) => (ACTIVE as readonly string[]).includes(s.status));
    const sum = (rows: typeof byStatus, k: 'supply' | 'vat' | 'total' | 'budget') => moneyStr(rows.reduce((a, r) => a.plus(r[k]), D(0)));
    const activeSupply = sum(activeRows, 'supply');
    const activeBudget = sum(activeRows, 'budget');

    const pending = (stage: number) => ({ available: false as const, stage });
    const purchase = can(ctx, 'purchase', 'read') ? await this.purchase.metrics(ctx) : null;
    const myApprovals = await this.approvals.counts(ctx);
    const payables = can(ctx, 'expense', 'read') ? await this.payments.metrics(ctx) : null;
    const draftJournals = can(ctx, 'journal', 'read') && ctx.scope !== 'CONFIRMED_ONLY'
      ? ((await this.db.execute(sql`select count(*)::int n from journal_entry where company_id = ${ctx.companyId} and status = 'DRAFT'`)).rows[0] as { n: number }).n
      : null;
    let costs: { actual: string; committed: string; budget: string; alerts: Awaited<ReturnType<BudgetService['overview']>>['alerts'] } | null = null;
    if (can(ctx, 'budget', 'read')) {
      const o = await this.budget.overview(ctx, { status: 'ACTIVE' });
      costs = { actual: o.totals.actual, committed: o.totals.committed, budget: o.totals.budget, alerts: o.alerts.slice(0, 8) };
    }
    return {
      asOf: new Date().toISOString(),
      scope: ctx.scope,
      contract: {
        active: { count: activeRows.reduce((a, r) => a + r.n, 0), supply: activeSupply, vat: sum(activeRows, 'vat'), total: sum(activeRows, 'total'), budget: activeBudget,
          plannedMargin: moneyStr(D(activeSupply).minus(activeBudget)), plannedMarginRate: D(activeSupply).gt(0) ? D(activeSupply).minus(activeBudget).div(activeSupply).toFixed(4) : null },
        all: { count: byStatus.reduce((a, r) => a + r.n, 0), supply: sum(byStatus, 'supply'), vat: sum(byStatus, 'vat'), total: sum(byStatus, 'total') },
      },
      byStatus: byStatus.map((s) => ({ status: s.status, count: s.n, total: s.total })),
      byTrade: byTrade.map((t) => ({ tradeType: t.tradeType, count: t.n, supply: t.supply, budget: t.budget })),
      monthlyContracts: months,
      activeProjects: activeList.map((p) => ({
        ...p,
        plannedMarginRate: D(p.supplyAmount).gt(0) ? D(p.supplyAmount).minus(p.executionBudget).div(p.supplyAmount).toFixed(4) : null,
        // 경과율: 착공~준공예정 기간 대비 오늘까지 경과 비율 — 공정률과 비교해 지연 판단
        elapsedRate: p.startDate && p.plannedEndDate ? elapsed(p.startDate, p.plannedEndDate, today) : null,
      })),
      dueSoon,
      overdue,
      recent,
      vendorCount,
      purchase,
      approvals: myApprovals,
      payables,
      draftJournals,
      costs,
      // 이후 단계 지표 — 해당 기능이 구현되기 전에는 값을 만들어 내지 않는다
      pendingMetrics: {
        revenue: pending(RESOURCES.claim.stage), purchases: pending(RESOURCES.purchase.stage), cost: pending(RESOURCES.journal.stage),
        cash: pending(RESOURCES.bank.stage), receivables: pending(RESOURCES.claim.stage), payables: pending(RESOURCES.expense.stage),
        taxInvoices: pending(RESOURCES.taxinvoice.stage), approvals: pending(RESOURCES.approval.stage),
      },
    };
  }
}

function elapsed(start: string, end: string, today: string) {
  const s = Date.parse(start), e = Date.parse(end), t = Date.parse(today);
  if (e <= s) return null;
  return Math.min(1, Math.max(0, (t - s) / (e - s))).toFixed(4);
}

@ApiTags('대시보드')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  @RequirePermission('dashboard', 'read')
  summary(@Ctx() ctx: AccessContext) {
    return this.svc.summary(ctx);
  }
}
