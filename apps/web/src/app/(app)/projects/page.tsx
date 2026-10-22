'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Building2, Download, Plus, Search, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Button, EmptyState, Input, PageHeader, Select, StatusBadge, TradeTag, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { daysUntil, pct, wonShort } from '@/lib/format';
import { CONTRACT_ROLE, SECTOR, STATUS, TRADE, type ProjectStatus, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { ProjectRow } from '@/lib/types';

interface ListResp { total: number; page: number; size: number; sums: { supplyAmount: string; vatAmount: string; totalAmount: string; executionBudget: string }; rows: ProjectRow[] }

const STATUS_FILTERS: { value: '' | ProjectStatus; label: string }[] = [{ value: '', label: '전체' }, ...(Object.keys(STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))];

function ProjectsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company } = useSession();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const filters = {
    q: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as '' | ProjectStatus,
    tradeType: (sp.get('tradeType') ?? '') as '' | TradeType,
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    sort: sp.get('sort') ?? 'code',
    dir: (sp.get('dir') ?? 'desc') as 'asc' | 'desc',
    page: Number(sp.get('page') ?? 1),
  };
  const set = (patch: Partial<typeof filters>) => {
    const next = { ...filters, page: 1, ...patch };
    router.replace(`/projects${qs({ ...next, page: next.page > 1 ? next.page : undefined, sort: next.sort === 'code' ? undefined : next.sort, dir: next.dir === 'desc' ? undefined : next.dir })}`, { scroll: false });
  };
  // 검색어 입력은 잠시 멈췄을 때 반영
  useEffect(() => {
    const t = setTimeout(() => q !== filters.q && set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useQuery({
    queryKey: ['projects', company.id, filters],
    queryFn: () => api<ListResp>(`/projects${qs({ ...filters, size: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  const columns = useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      { id: 'code', header: '번호', meta: { sortKey: 'code', width: 92 }, cell: ({ row }) => <span className="num whitespace-nowrap text-muted">{row.original.code}</span> },
      {
        id: 'name', header: '공사명', meta: { sortKey: 'name' },
        cell: ({ row: { original: p } }) => (
          <div className="min-w-[220px]">
            <Link href={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.name}</Link>
            <p className="mt-0.5 truncate text-meta text-muted">{[p.clientName, CONTRACT_ROLE[p.contractRole], SECTOR[p.clientSector]].filter(Boolean).join(' · ')}</p>
          </div>
        ),
      },
      { id: 'trade', header: '공종', meta: { width: 84 }, cell: ({ row }) => <TradeTag trade={row.original.tradeType} short /> },
      { id: 'status', header: '상태', meta: { width: 76 }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'contractDate', header: '계약일', meta: { sortKey: 'contractDate', width: 96, hideBelow: '2xl' }, cell: ({ row }) => <span className="num whitespace-nowrap text-ink-2">{row.original.contractDate ?? "–"}</span> },
      {
        id: 'end', header: '준공예정', meta: { sortKey: 'plannedEndDate', width: 104, hideBelow: 'lg' },
        cell: ({ row: { original: p } }) => {
          const d = daysUntil(p.plannedEndDate);
          const late = p.status === 'IN_PROGRESS' && d !== null && d < 0;
          return <span className={clsx("num whitespace-nowrap", late ? 'font-medium text-seal' : 'text-ink-2')} title={late ? `${-d!}일 경과` : undefined}>{p.plannedEndDate ?? '–'}</span>;
        },
      },
      { id: 'supply', header: '공급가액', meta: { align: 'right', hideBelow: 'xl', footer: <Won value={data?.sums.supplyAmount} /> }, cell: ({ row }) => <Won value={row.original.supplyAmount} /> },
      { id: 'total', header: '계약총액', meta: { align: 'right', sortKey: 'totalAmount', footer: <Won value={data?.sums.totalAmount} /> }, cell: ({ row }) => <Won value={row.original.totalAmount} /> },
      { id: 'budget', header: '실행예산', meta: { align: 'right', hideBelow: 'lg', footer: <Won value={data?.sums.executionBudget} /> }, cell: ({ row }) => <Won value={row.original.executionBudget} blankZero /> },
      { id: 'margin', header: '계획이익률', meta: { align: 'right', width: 88, hideBelow: 'lg' }, cell: ({ row }) => (Number(row.original.executionBudget) > 0 ? <span className={clsx(Number(row.original.plannedMarginRate) < 0 && 'text-seal')}>{pct(row.original.plannedMarginRate)}</span> : <span className="text-faint">–</span>) },
      {
        id: 'progress', header: '공정률', meta: { align: 'right', sortKey: 'progressRate', width: 108, hideBelow: 'md' },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <div className="h-1 w-12 rounded-full bg-surface-2"><div className="h-full rounded-full bg-steel" style={{ width: `${row.original.progressPercent}%` }} /></div>
            <span className="w-10 text-ink-2">{Number(row.original.progressPercent).toFixed(0)}%</span>
          </div>
        ),
      },
    ],
    [data?.sums],
  );

  const hasFilter = filters.q || filters.status || filters.tradeType || filters.from || filters.to;

  return (
    <>
      <PageHeader
        title="현장 목록"
        description={data ? <span className="num">총 {data.total.toLocaleString('ko-KR')}곳 · 계약총액 {wonShort(data.sums.totalAmount)}원</span> : ' '}
        actions={
          <>
            {can('project:export') && (
              <Button icon={<Download className="size-3.5" />} onClick={() => download(`/projects/export.xlsx${qs(filters)}`, '현장목록.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>
                엑셀
              </Button>
            )}
            {can('project:create') && <Link href="/projects/new"><Button variant="primary" icon={<Plus className="size-4" />}>현장 등록</Button></Link>}
          </>
        }
      />

      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <div role="radiogroup" aria-label="상태" className="flex overflow-x-auto rounded-[4px] bg-surface-2 p-0.5 max-sm:w-full">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={filters.status === s.value}
                onClick={() => set({ status: s.value })}
                className={clsx('h-7 shrink-0 rounded-[3px] px-2.5 text-meta', filters.status === s.value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Select value={filters.tradeType} onChange={(e) => set({ tradeType: e.target.value as TradeType })} className="w-[110px]" aria-label="공종">
            <option value="">공종 전체</option>
            {(Object.keys(TRADE) as TradeType[]).map((t) => <option key={t} value={t}>{TRADE[t].label}</option>)}
          </Select>
          <div className="flex items-center gap-1" aria-label="계약일 기간">
            <Input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="w-[138px]" aria-label="계약일 시작" />
            <span className="text-faint">~</span>
            <Input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="w-[138px]" aria-label="계약일 끝" />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="공사명·번호·발주처·주소" className="pl-8" aria-label="검색" />
          </div>
          {hasFilter && (
            <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => (setQ(''), router.replace('/projects'))}>조건 지우기</Button>
          )}
        </div>
        <DataTable
          columns={columns}
          data={data?.rows}
          loading={query.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/projects/${r.id}`)}
          sort={{ key: filters.sort, dir: filters.dir }}
          onSort={(s) => set({ sort: s.key, dir: s.dir })}
          footerLabel={data ? `합계 ${data.total}곳` : undefined}
          page={data ? { page: data.page, size: data.size, total: data.total, onPage: (p) => set({ page: p }) } : undefined}
          rowClassName={(r) => (r.status === 'SETTLED' ? 'text-muted' : undefined)}
          mobileRow={(p) => (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{p.name}</span>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-1 flex items-center justify-between text-meta text-muted">
                <span className="flex items-center gap-2"><TradeTag trade={p.tradeType} short /><span className="num">{p.code}</span></span>
                <span className="num text-ink-2">{wonShort(p.totalAmount)}원 · {Number(p.progressPercent).toFixed(0)}%</span>
              </div>
            </div>
          )}
          empty={
            hasFilter ? (
              <EmptyState title="조건에 맞는 현장이 없습니다" description="검색어나 필터를 바꿔 보세요." />
            ) : (
              <EmptyState
                icon={<Building2 className="size-8" strokeWidth={1.25} />}
                title="등록된 현장이 없습니다"
                description="현장을 먼저 등록하면 발주·세금계산서·지출을 모두 현장별로 모을 수 있습니다."
                action={can('project:create') ? <Link href="/projects/new"><Button variant="primary" icon={<Plus className="size-4" />}>첫 현장 등록</Button></Link> : undefined}
              />
            )
          }
        />
      </div>
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsInner />
    </Suspense>
  );
}
