'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Download, FileText, Plus, Search, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Button, EmptyState, Input, PageHeader, TradeTag, Won, useToast } from '@/components/ui';
import { PoStatusBadge } from '@/components/po-bits';
import { api, ApiError, download, qs } from '@/lib/api';
import { daysUntil, wonShort } from '@/lib/format';
import { TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { PoRow } from '@/lib/types';

interface ListResp { total: number; page: number; size: number; sums: { supplyAmount: string; vatAmount: string; totalAmount: string }; rows: PoRow[] }

const TABS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'DRAFT', label: '작성중' },
  { value: 'PENDING', label: '결재중' },
  { value: 'REJECTED', label: '반려' },
  { value: 'OPEN', label: '입고 대기' },
  { value: 'RECEIVED', label: '입고완료' },
  { value: 'CLOSED', label: '종결' },
  { value: 'CANCELLED', label: '취소' },
];

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company, project } = useSession();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1), all: sp.get('all') === '1' };
  const projectId = f.all ? undefined : project?.id;
  const set = (patch: Partial<typeof f>) => {
    const n = { ...f, page: 1, ...patch };
    router.replace(`/purchase-orders${qs({ q: n.q, status: n.status, from: n.from, to: n.to, page: n.page > 1 ? n.page : undefined, all: n.all ? 1 : undefined })}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const params = { q: f.q, status: f.status, from: f.from, to: f.to, page: f.page, projectId, size: 50 };
  const list = useQuery({ queryKey: ['pos', company.id, params], queryFn: () => api<ListResp>(`/purchase-orders${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;

  const columns = useMemo<ColumnDef<PoRow>[]>(
    () => [
      { id: 'code', header: '발주번호', meta: { width: 104 }, cell: ({ row: { original: p } }) => <span className="num whitespace-nowrap text-muted">{p.code}{p.revision ? <sup className="ml-0.5 text-[10px]">r{p.revision}</sup> : null}</span> },
      { id: 'date', header: '발주일', meta: { width: 96, hideBelow: 'lg' }, cell: ({ row }) => <span className="num whitespace-nowrap text-ink-2">{row.original.orderDate}</span> },
      {
        id: 'title', header: '발주내용',
        cell: ({ row: { original: p } }) => (
          <div className="min-w-[200px]">
            <Link href={`/purchase-orders/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.title}</Link>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-meta text-muted">
              <span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: TRADE[p.tradeType].color }} />
              {p.projectName} · 품목 {p.lineCount}
            </p>
          </div>
        ),
      },
      { id: 'vendor', header: '거래처', meta: { hideBelow: 'md' }, cell: ({ row }) => <span className="text-ink-2">{row.original.vendorName}</span> },
      { id: 'status', header: '상태', meta: { width: 84 }, cell: ({ row }) => <PoStatusBadge status={row.original.status} /> },
      {
        id: 'delivery', header: '납품기한', meta: { width: 100, hideBelow: 'xl' },
        cell: ({ row: { original: p } }) => {
          const dd = daysUntil(p.deliveryDate);
          const late = dd !== null && dd < 0 && ['APPROVED', 'SENT', 'PARTIAL'].includes(p.status);
          return <span className={clsx('num whitespace-nowrap', late ? 'font-medium text-seal' : 'text-ink-2')} title={late ? `${-dd!}일 지남` : undefined}>{p.deliveryDate ?? '–'}</span>;
        },
      },
      { id: 'supply', header: '공급가액', meta: { align: 'right', hideBelow: '2xl', footer: <Won value={d?.sums.supplyAmount} /> }, cell: ({ row }) => <Won value={row.original.supplyAmount} /> },
      { id: 'total', header: '합계', meta: { align: 'right', footer: <Won value={d?.sums.totalAmount} /> }, cell: ({ row }) => <Won value={row.original.totalAmount} /> },
      {
        id: 'recv', header: '입고율', meta: { align: 'right', width: 104, hideBelow: 'lg' },
        cell: ({ row: { original: p } }) =>
          ['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED'].includes(p.status) ? (
            <div className="flex items-center justify-end gap-2">
              <div className="h-1 w-10 rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', Number(p.receivedRate) >= 1 ? 'bg-ok' : 'bg-steel')} style={{ width: `${Math.min(100, Number(p.receivedRate) * 100)}%` }} /></div>
              <span className="w-9 text-ink-2">{Math.round(Number(p.receivedRate) * 100)}%</span>
            </div>
          ) : <span className="text-faint">–</span>,
      },
    ],
    [d?.sums],
  );

  return (
    <>
      <PageHeader
        title="발주서"
        description={d ? <span className="num">{f.all || !project ? '전체 현장' : project.name} · {d.total.toLocaleString('ko-KR')}건 · 합계 {wonShort(d.sums.totalAmount)}원</span> : ' '}
        actions={
          <>
            {can('purchase:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/purchase-orders/export.xlsx${qs(params)}`, '발주현황.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
            {can('purchase:create') && <Link href="/purchase-orders/new"><Button variant="primary" icon={<Plus className="size-4" />}>발주서 작성</Button></Link>}
          </>
        }
      />
      {project && (
        <div className="mb-3 flex items-center gap-2 text-meta">
          <span className="text-muted">작업 현장 기준으로 보는 중</span>
          <button type="button" onClick={() => set({ all: !f.all })} className={clsx('rounded-[3px] border px-2 py-0.5', f.all ? 'border-line text-muted' : 'border-steel bg-steel-soft text-steel-ink')}>
            {f.all ? '전체 현장' : project.name} {f.all ? '' : <X className="ml-0.5 inline size-3" />}
          </button>
        </div>
      )}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <div role="radiogroup" aria-label="상태" className="flex overflow-x-auto rounded-[4px] bg-surface-2 p-0.5 max-sm:w-full">
            {TABS.map((t) => (
              <button key={t.value} role="radio" aria-checked={f.status === t.value} onClick={() => set({ status: t.value })} className={clsx('h-7 shrink-0 rounded-[3px] px-2.5 text-meta', f.status === t.value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>{t.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-[138px]" aria-label="발주일 시작" />
            <span className="text-faint">~</span>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="w-[138px]" aria-label="발주일 끝" />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="발주번호·내용·거래처·현장" className="pl-8" aria-label="검색" />
          </div>
        </div>
        <DataTable
          columns={columns}
          data={d?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/purchase-orders/${r.id}`)}
          footerLabel={d ? `합계 ${d.total}건` : undefined}
          rowClassName={(r) => (r.status === 'CANCELLED' ? 'text-muted line-through decoration-faint' : undefined)}
          page={d ? { page: f.page, size: 50, total: d.total, onPage: (p) => set({ page: p }) } : undefined}
          mobileRow={(p) => (
            <div>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.title}</span><PoStatusBadge status={p.status} /></div>
              <div className="mt-1 flex items-center justify-between text-meta text-muted">
                <span className="flex items-center gap-2"><TradeTag trade={p.tradeType} short /><span className="num">{p.code}</span><span className="truncate">{p.vendorName}</span></span>
                <span className="num text-ink-2">{wonShort(p.totalAmount)}원</span>
              </div>
            </div>
          )}
          empty={
            f.q || f.status || f.from || f.to ? <EmptyState title="조건에 맞는 발주서가 없습니다" /> : (
              <EmptyState
                icon={<FileText className="size-8" strokeWidth={1.25} />}
                title={project && !f.all ? `${project.name}에 작성된 발주서가 없습니다` : '작성된 발주서가 없습니다'}
                description="현장과 거래처를 고르고 품목을 넣으면 대표이사 결재를 거쳐 발주서 PDF가 만들어집니다."
                action={can('purchase:create') ? <Link href="/purchase-orders/new"><Button variant="primary" icon={<Plus className="size-4" />}>발주서 작성</Button></Link> : undefined}
              />
            )
          }
        />
      </div>
    </>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
