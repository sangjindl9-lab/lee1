'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Suspense, useMemo } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs } from '@/components/doc-ui';
import { Badge, EmptyState, PageHeader, StatusBadge, TradeTag, Won } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { pct, wonShort } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Overview, PlRow } from '@/components/budget-bits';

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const status = sp.get('status') ?? 'ACTIVE';
  const { company } = useSession();
  const q = useQuery({ queryKey: ['project-pl', company.id, status], queryFn: () => api<Overview>(`/project-pl${qs({ status })}`) });
  const d = q.data;
  const columns = useMemo<ColumnDef<PlRow>[]>(() => [
    { id: 'name', header: '현장', cell: ({ row: { original: p } }) => <div className="min-w-[200px]"><Link href={`/project-pl/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.name}</Link><p className="mt-0.5 flex items-center gap-2 text-meta text-muted"><TradeTag trade={p.tradeType} short /><span className="num">{p.code}</span><StatusBadge status={p.status} /></p></div> },
    { id: 'contract', header: '계약(변경 반영)', meta: { align: 'right', footer: <Won value={d?.totals.contractCurrent} /> }, cell: ({ row }) => <Won value={row.original.contractCurrent} /> },
    { id: 'rec', header: '매출 인식', meta: { align: 'right', hideBelow: 'lg', footer: <Won value={d?.totals.recognized} /> }, cell: ({ row }) => <Won value={row.original.recognized} blankZero /> },
    { id: 'coll', header: '수금', meta: { align: 'right', hideBelow: 'xl', footer: <Won value={d?.totals.collected} /> }, cell: ({ row }) => <Won value={row.original.collected} blankZero /> },
    { id: 'ar', header: '미수금', meta: { align: 'right', hideBelow: 'lg', footer: <Won value={d?.totals.receivable} /> }, cell: ({ row }) => <Won value={row.original.receivable} blankZero className={Number(row.original.receivable) > 0 ? 'font-medium' : ''} /> },
    { id: 'actual', header: '발생원가', meta: { align: 'right', footer: <Won value={d?.totals.actual} /> }, cell: ({ row }) => <Won value={row.original.actual} blankZero /> },
    { id: 'unpaid', header: '미지급원가', meta: { align: 'right', hideBelow: 'xl', footer: <Won value={d?.totals.unpaid} /> }, cell: ({ row }) => <Won value={row.original.unpaid} blankZero /> },
    { id: 'rate', header: '원가율', meta: { align: 'right', width: 72, hideBelow: 'md' }, cell: ({ row }) => <span className="num text-ink-2">{row.original.costRate ? pct(row.original.costRate, 0) : '–'}</span> },
    { id: 'est', header: '예상 준공손익', meta: { align: 'right', footer: <Won value={d?.totals.estimatedProfit} /> }, cell: ({ row: { original: p } }) => <span className="inline-flex items-center gap-1.5">{!!p.alertCount && <Badge tone="seal">초과 {p.alertCount}</Badge>}<Won value={p.estimatedProfit} className="font-semibold" /></span> },
  ], [d?.totals]);
  return (
    <>
      <PageHeader title="현장 손익" description="받을 돈(계약 → 기성 → 매출 → 수금)과 줄 돈(예산 → 발주확정 → 발생 → 지급)을 현장별로 실시간 집계합니다." />
      {d && !d.revenueAvailable && <p className="mb-3 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted">기성·수금 기능을 쓰기 전에는 매출·수금이 0으로 표시됩니다. 예상 손익은 계약금액 기준입니다.</p>}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="border-b border-line p-2.5"><SegTabs label="상태" value={status} onChange={(v) => router.replace(`/project-pl?status=${v}`)} items={[{ value: 'ACTIVE', label: '진행 현장' }, { value: 'COMPLETED', label: '준공' }, { value: 'SETTLED', label: '정산완료' }, { value: 'ALL', label: '전체' }]} /></div>
        <DataTable columns={columns} data={d?.rows} loading={q.isLoading} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/project-pl/${r.id}`)} footerLabel="합계"
          mobileRow={(p) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{p.name}</span><Won value={p.estimatedProfit} className="font-semibold" /></div><p className="num mt-1 text-meta text-muted">계약 {wonShort(p.contractCurrent)} · 발생 {wonShort(p.actual)} · 미수 {wonShort(p.receivable)}</p></div>}
          empty={<EmptyState title="해당하는 현장이 없습니다" />} />
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
