'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Download, Plus, Search, Wallet } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs, SumStrip } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Input, PageHeader, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { PAYREQ_KIND, PAYREQ_STATUS, TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface PayReqRow {
  id: string; code: string; kind: string; kindLabel: string; title: string; requestDate: string; dueDate: string | null; payeeName: string; projectId: string | null; projectName: string | null; tradeType: TradeType | null;
  vendorName: string | null; supplyAmount: string; vatAmount: string; totalAmount: string; status: string; statusLabel: string;
}
interface Resp { total: number; page: number; size: number; sums: { totalAmount: string; unpaid: string; paid: string }; rows: PayReqRow[] }

const TABS = [
  { value: '', label: '전체' }, { value: 'DRAFT', label: '작성중' }, { value: 'PENDING', label: '결재중' }, { value: 'APPROVED', label: '지급대기' },
  { value: 'PAID', label: '지급완료' }, { value: 'REJECTED', label: '반려' }, { value: 'CANCELLED', label: '취소' },
];

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company } = useSession();
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', kind: sp.get('kind') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const [q, setQ] = useState(f.q);
  const set = (p: Partial<typeof f>) => {
    const n = { ...f, page: 1, ...p };
    router.replace(`/payment-requests${qs({ ...n, page: n.page > 1 ? n.page : undefined })}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const params = { ...f, size: 50 };
  const list = useQuery({ queryKey: ['payreqs', company.id, params], queryFn: () => api<Resp>(`/payment-requests${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;

  const columns = useMemo<ColumnDef<PayReqRow>[]>(() => [
    { id: 'code', header: '결의번호', meta: { width: 100 }, cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
    { id: 'date', header: '결의일', meta: { width: 96, hideBelow: 'lg' }, cell: ({ row }) => <span className="num text-ink-2">{row.original.requestDate}</span> },
    {
      id: 'title', header: '내용',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[200px]">
          <Link href={`/payment-requests/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.title}</Link>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-meta text-muted">
            <Badge tone="muted">{r.kindLabel}</Badge>
            {r.tradeType && <span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: TRADE[r.tradeType].color }} />}
            {r.projectName ?? '본사 공통'}
          </p>
        </div>
      ),
    },
    { id: 'payee', header: '받는 분', meta: { hideBelow: 'md' }, cell: ({ row }) => <span className="text-ink-2">{row.original.payeeName}</span> },
    { id: 'status', header: '상태', meta: { width: 84 }, cell: ({ row }) => <Badge tone={PAYREQ_STATUS[row.original.status].tone}>{PAYREQ_STATUS[row.original.status].label}</Badge> },
    {
      id: 'due', header: '지급예정', meta: { width: 100, hideBelow: 'xl' },
      cell: ({ row: { original: r } }) => {
        const dd = daysUntil(r.dueDate);
        const late = dd !== null && dd < 0 && r.status === 'APPROVED';
        return <span className={clsx('num', late ? 'font-medium text-seal' : 'text-ink-2')}>{r.dueDate ?? '–'}</span>;
      },
    },
    { id: 'supply', header: '공급가액', meta: { align: 'right', hideBelow: '2xl' }, cell: ({ row }) => <Won value={row.original.supplyAmount} /> },
    { id: 'vat', header: '세액', meta: { align: 'right', hideBelow: '2xl' }, cell: ({ row }) => <Won value={row.original.vatAmount} /> },
    { id: 'total', header: '지급액', meta: { align: 'right', footer: <Won value={d?.sums.totalAmount} /> }, cell: ({ row }) => <Won value={row.original.totalAmount} className="font-medium" /> },
  ], [d?.sums]);

  return (
    <>
      <PageHeader
        title="지급결의"
        description="지급 요청 → 결재 → 지급(이체) 순서로 처리합니다. 결재가 끝나지 않은 결의는 지급할 수 없습니다."
        actions={<>
          {can('expense:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/payment-requests/export.xlsx${qs(params)}`, '지급결의.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
          {can('expense:create') && <Link href="/payment-requests/new"><Button variant="primary" icon={<Plus className="size-4" />}>지급결의 작성</Button></Link>}
        </>}
      />
      {d && <SumStrip items={[{ label: '조회 합계', value: d.sums.totalAmount, hint: `${d.total}건` }, { label: '지급 대기 (결재 완료)', value: d.sums.unpaid, tone: 'steel' }, { label: '지급 완료', value: d.sums.paid, tone: 'ok' }]} />}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="상태" value={f.status} onChange={(v) => set({ status: v })} items={TABS} />
          <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} className="h-8 rounded-[4px] border border-line-strong bg-surface px-2 text-body" aria-label="구분">
            <option value="">모든 구분</option>
            {Object.entries(PAYREQ_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-[138px]" aria-label="결의일 시작" />
            <span className="text-faint">~</span>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="w-[138px]" aria-label="결의일 끝" />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="결의번호·제목·받는 분" className="pl-8" aria-label="검색" />
          </div>
        </div>
        <DataTable
          columns={columns}
          data={d?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/payment-requests/${r.id}`)}
          footerLabel={d ? `합계 ${d.total}건` : undefined}
          rowClassName={(r) => (r.status === 'CANCELLED' ? 'text-muted line-through decoration-faint' : undefined)}
          page={d ? { page: f.page, size: 50, total: d.total, onPage: (p) => set({ page: p }) } : undefined}
          mobileRow={(r) => (
            <div>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.title}</span><Badge tone={PAYREQ_STATUS[r.status].tone}>{PAYREQ_STATUS[r.status].label}</Badge></div>
              <div className="mt-1 flex justify-between text-meta text-muted"><span>{r.kindLabel} · {r.payeeName}</span><Won value={r.totalAmount} className="text-ink-2" /></div>
            </div>
          )}
          empty={<EmptyState icon={<Wallet className="size-8" strokeWidth={1.25} />} title={f.status || f.q ? '조건에 맞는 지급결의가 없습니다' : '작성된 지급결의가 없습니다'} description="검수가 끝난 자재대금이나 현장 경비를 지급하려면 지급결의를 작성해 결재를 받으세요." action={can('expense:create') && !f.status ? <Link href="/payment-requests/new"><Button variant="primary" icon={<Plus className="size-4" />}>지급결의 작성</Button></Link> : undefined} />}
        />
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
