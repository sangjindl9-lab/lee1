'use client';

import clsx from 'clsx';
import { Badge, Won } from './ui';
import { BUDGET_LEVEL } from '@/lib/labels';
import { pct } from '@/lib/format';
import type { ProjectStatus, TradeType } from '@/lib/labels';

export interface CostRow { costCodeId: string; code: string; name: string; planned: string; committed: string; actual: string; paid: string; remaining: string; usedRate: string | null; level: 'OK' | 'WARN' | 'OVER' | 'UNBUDGETED'; ack?: { ackedByName: string; ackedAt: string; note: string | null } | null }
export interface BudgetSummary {
  project: { id: string; code: string; name: string; tradeType: 'ELECTRIC' | 'TELECOM' | 'BUILDING' | 'COMPLEX'; status: string; supplyAmount: string; executionBudget: string; progressRate: string; startDate: string | null; plannedEndDate: string | null };
  hasBreakdown: boolean;
  rows: CostRow[];
  totals: { planned: string; committed: string; actual: string; paid: string; remaining: string; costRate: string | null };
  revenue: { available: boolean; contractOriginal: string; contractCurrent: string; contractPending: string; claimed: string; recognized: string; collected: string; receivable: string; unbilled: string; retention: string; advanceBalance: string };
  forecast: { estimatedCost: string; estimatedProfit: string; estimatedMarginRate: string | null; currentProfit: string; unpaidCost: string };
  revisions: { id: string; code: string; title: string; status: string; statusLabel: string; totalBefore: string; totalAfter: string; createdAt: string; approvedAt: string | null }[];
}

/** 사용률 막대: 계획 대비 max(확정, 발생). 90% 이상 주황, 초과 빨강 */
export function UseBar({ row }: { row: Pick<CostRow, 'planned' | 'committed' | 'actual' | 'usedRate' | 'level'> }) {
  const planned = Number(row.planned);
  const committed = Number(row.committed);
  const actual = Number(row.actual);
  const max = Math.max(planned, committed, actual, 1);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-steel/25" style={{ width: `${(committed / max) * 100}%` }} />
        <div className={clsx('absolute inset-y-0 left-0', row.level === 'OVER' || row.level === 'UNBUDGETED' ? 'bg-seal' : row.level === 'WARN' ? 'bg-warn' : 'bg-steel')} style={{ width: `${(actual / max) * 100}%` }} />
        {planned > 0 && <div className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `calc(${(planned / max) * 100}% - 1px)` }} />}
      </div>
      <span className={clsx('num w-12 text-right text-meta', row.level === 'OVER' ? 'font-semibold text-seal' : row.level === 'WARN' ? 'text-warn' : 'text-ink-2')}>{row.usedRate ? pct(row.usedRate, 0) : '–'}</span>
    </div>
  );
}

export function LevelBadge({ level }: { level: CostRow['level'] }) {
  if (level === 'OK') return null;
  return <Badge tone={BUDGET_LEVEL[level].tone}>{BUDGET_LEVEL[level].label}</Badge>;
}

export function CostTable({ rows, totals, onRowAction }: { rows: CostRow[]; totals: BudgetSummary['totals']; onRowAction?: (r: CostRow) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-body">
        <thead>
          <tr className="bg-surface-2 text-meta text-muted">
            <th className="px-3 py-2 text-left font-medium">원가항목</th>
            <th className="px-3 py-2 text-right font-medium" title="결재 승인된 실행예산">① 계획(실행예산)</th>
            <th className="px-3 py-2 text-right font-medium" title="승인된 발주서·외주계약·경비 결의">② 발주확정</th>
            <th className="px-3 py-2 text-right font-medium" title="검수·경비·노무 등으로 실제 발생한 원가 (부가세 제외)">③ 발생원가</th>
            <th className="px-3 py-2 text-right font-medium" title="실제로 지급한 금액 (공급가액)">④ 지급완료</th>
            <th className="px-3 py-2 text-right font-medium" title="계획 − max(발주확정, 발생원가)">잔여예산</th>
            <th className="px-3 py-2 text-left font-medium">사용률</th>
            {onRowAction && <th className="w-[120px] px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.costCodeId} className={clsx('border-t border-line', r.level === 'OVER' && 'bg-seal-soft/40')}>
              <td className="px-3 py-2"><span className="font-medium">{r.name}</span> <LevelBadge level={r.level} /></td>
              <td className="num px-3 text-right"><Won value={r.planned} blankZero /></td>
              <td className="num px-3 text-right text-ink-2"><Won value={r.committed} blankZero /></td>
              <td className="num px-3 text-right"><Won value={r.actual} blankZero /></td>
              <td className="num px-3 text-right text-ink-2"><Won value={r.paid} blankZero /></td>
              <td className="num px-3 text-right font-medium"><Won value={r.remaining} blankZero /></td>
              <td className="px-3"><UseBar row={r} /></td>
              {onRowAction && <td className="px-3 text-right">{onRowAction(r)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold">
            <td className="px-3 py-2">합계</td>
            <td className="num px-3 text-right"><Won value={totals.planned} /></td>
            <td className="num px-3 text-right"><Won value={totals.committed} /></td>
            <td className="num px-3 text-right"><Won value={totals.actual} /></td>
            <td className="num px-3 text-right"><Won value={totals.paid} /></td>
            <td className="num px-3 text-right"><Won value={totals.remaining} /></td>
            <td className="num px-3 text-meta">{totals.costRate ? `원가율 ${pct(totals.costRate)}` : ''}</td>
            {onRowAction && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export interface PlRow { id: string; code: string; name: string; tradeType: TradeType; status: ProjectStatus; progressRate: string; contractCurrent: string; recognized: string; collected: string; receivable: string; unbilled: string; budget: string; budgetBreakdown: boolean; committed: string; actual: string; paid: string; unpaid: string; costRate: string | null; estimatedCost: string; estimatedProfit: string; currentProfit: string; alertCount: number }
export interface Overview { revenueAvailable: boolean; rows: PlRow[]; totals: Record<string, string>; alerts: { projectId: string; projectCode: string; projectName: string; tradeType: TradeType; costCodeId: string; costCodeName: string; level: string; planned: string; used: string; usedRate: string | null; ackedBy: string | null; ackedAt: string | null }[] }
