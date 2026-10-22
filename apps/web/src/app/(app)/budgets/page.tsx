'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { DataTable } from '@/components/data-table';
import { UseBar, type Overview, type PlRow } from '@/components/budget-bits';
import { Badge, EmptyState, PageHeader, Skeleton, StatusBadge, TradeTag, Won } from '@/components/ui';
import { api } from '@/lib/api';
import { pct, relative, wonShort } from '@/lib/format';
import { BUDGET_LEVEL } from '@/lib/labels';
import { useSession } from '@/lib/session';


export default function Page() {
  const router = useRouter();
  const { company } = useSession();
  const q = useQuery({ queryKey: ['budget-overview', company.id], queryFn: () => api<Overview>('/budgets/overview') });
  const d = q.data;
  const columns = useMemo<ColumnDef<PlRow>[]>(() => [
    { id: 'name', header: '현장', cell: ({ row: { original: p } }) => <div className="min-w-[220px]"><Link href={`/budgets/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.name}</Link><p className="mt-0.5 flex items-center gap-2 text-meta text-muted"><TradeTag trade={p.tradeType} short /><span className="num">{p.code}</span>{!p.budgetBreakdown && <Badge tone="warn">항목별 미편성</Badge>}</p></div> },
    { id: 'st', header: '상태', meta: { width: 64, hideBelow: 'lg' }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'budget', header: '실행예산', meta: { align: 'right' }, cell: ({ row }) => <Won value={row.original.budget} /> },
    { id: 'committed', header: '발주확정', meta: { align: 'right', hideBelow: 'xl' }, cell: ({ row }) => <Won value={row.original.committed} blankZero /> },
    { id: 'actual', header: '발생원가', meta: { align: 'right' }, cell: ({ row }) => <Won value={row.original.actual} blankZero /> },
    { id: 'paid', header: '지급', meta: { align: 'right', hideBelow: 'xl' }, cell: ({ row }) => <Won value={row.original.paid} blankZero /> },
    { id: 'use', header: '사용률', meta: { width: 180, hideBelow: 'md' }, cell: ({ row: { original: p } }) => <UseBar row={{ planned: p.budget, committed: p.committed, actual: p.actual, usedRate: Number(p.budget) > 0 ? String(Math.max(Number(p.committed), Number(p.actual)) / Number(p.budget)) : null, level: p.alertCount ? 'OVER' : Number(p.budget) > 0 && Math.max(Number(p.committed), Number(p.actual)) >= Number(p.budget) * 0.9 ? 'WARN' : 'OK' }} /> },
    { id: 'alerts', header: '경고', meta: { width: 64, align: 'center' }, cell: ({ row }) => row.original.alertCount ? <Badge tone="seal">{row.original.alertCount}</Badge> : null },
  ], []);
  return (
    <>
      <PageHeader title="실행예산" description="원가항목별 계획(실행예산)·발주확정·발생원가·지급을 구분해 봅니다. 실행예산 편성·변경은 결재 승인 후 반영됩니다." />
      {!d ? <Skeleton className="h-96" /> : (
        <>
          <section className="mb-4 rounded-[6px] border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="flex items-center gap-2 font-semibold">{d.alerts.length ? <TriangleAlert className="size-4 text-seal" /> : <CheckCircle2 className="size-4 text-ok" />}예산 경고 <span className="num font-normal text-muted">{d.alerts.length}</span></h2>
              <span className="text-meta text-muted">사용액 = max(발주확정, 발생원가)</span>
            </header>
            {!d.alerts.length ? <p className="px-4 py-6 text-center text-muted">예산을 넘었거나 90%에 이른 원가항목이 없습니다.</p> : (
              <ul className="divide-y divide-line">
                {d.alerts.map((a) => (
                  <li key={`${a.projectId}:${a.costCodeId}`}>
                    <Link href={`/budgets/${a.projectId}`} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-surface-hover', a.level === 'OVER' && 'border-l-[3px] border-l-seal')}>
                      <Badge tone={BUDGET_LEVEL[a.level].tone}>{BUDGET_LEVEL[a.level].label}</Badge>
                      <span className="min-w-0 flex-1"><b className="font-medium">{a.projectName}</b> · {a.costCodeName}</span>
                      <span className="num text-meta text-ink-2">계획 {wonShort(a.planned)} · 사용 {wonShort(a.used)} {a.usedRate && `(${pct(a.usedRate, 0)})`}</span>
                      <span className="text-meta">{a.ackedBy ? <span className="text-muted">{a.ackedBy} 확인 · {relative(a.ackedAt)}</span> : <span className="font-medium text-seal">미확인</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="rounded-[6px] border border-line bg-surface">
            <DataTable columns={columns} data={d.rows} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/budgets/${r.id}`)}
              mobileRow={(p) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{p.name}</span>{!!p.alertCount && <Badge tone="seal">경고 {p.alertCount}</Badge>}</div><p className="num mt-1 text-meta text-muted">예산 {wonShort(p.budget)} · 발생 {wonShort(p.actual)}</p></div>}
              empty={<EmptyState title="진행 중인 현장이 없습니다" />} />
          </div>
        </>
      )}
    </>
  );
}
