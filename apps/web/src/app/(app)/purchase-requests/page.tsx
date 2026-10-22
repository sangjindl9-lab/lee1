'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { ClipboardList, Plus } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs } from '@/components/doc-ui';
import { RequestForm } from '@/components/request-form';
import { Badge, Button, Drawer, EmptyState, PageHeader, TradeTag, useToast } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { daysUntil, relative } from '@/lib/format';
import { PR_STATUS, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; title: string; status: string; projectName: string; tradeType: TradeType; neededBy: string | null; requesterName: string; createdAt: string; lineCount: number; poId: string | null; poCode: string | null }

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const status = sp.get('status') ?? 'REQUESTED';
  const page = Number(sp.get('page') ?? 1);
  const [open, setOpen] = useState(sp.get('new') === '1');
  const q = useQuery({ queryKey: ['purchase-requests', company.id, status, page], queryFn: () => api<{ total: number; open: number; rows: Row[] }>(`/purchase-requests${qs({ status, page })}`), placeholderData: keepPreviousData });
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: 'code', header: '요청번호', meta: { width: 100 }, cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
    { id: 'title', header: '요청 내용', cell: ({ row: { original: r } }) => <div className="min-w-[200px]"><Link href={`/purchase-requests/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.title}</Link><p className="mt-0.5 flex items-center gap-2 text-meta text-muted"><TradeTag trade={r.tradeType} short />{r.projectName} · {r.lineCount}개 품목</p></div> },
    { id: 'who', header: '요청자', meta: { hideBelow: 'md' }, cell: ({ row }) => <span className="text-ink-2">{row.original.requesterName} <span className="text-meta text-faint">{relative(row.original.createdAt)}</span></span> },
    { id: 'need', header: '필요일', meta: { width: 100 }, cell: ({ row: { original: r } }) => { const d = daysUntil(r.neededBy); return <span className={`num ${r.status === 'REQUESTED' && d !== null && d <= 2 ? 'font-medium text-seal' : 'text-ink-2'}`}>{r.neededBy ?? '–'}</span>; } },
    { id: 'st', header: '상태', meta: { width: 120 }, cell: ({ row: { original: r } }) => <span className="flex items-center gap-1.5"><Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge>{r.poCode && <span className="num text-meta text-muted">{r.poCode}</span>}</span> },
  ], []);
  return (
    <>
      <PageHeader title="구매요청" description="현장에서 필요한 자재를 요청하면 구매담당이 확인해 발주서로 만듭니다."
        actions={can('purchase:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>구매요청</Button>} />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="border-b border-line p-2.5"><SegTabs label="상태" value={status} onChange={(v) => router.replace(`/purchase-requests?status=${v}`)} items={[{ value: 'REQUESTED', label: <>처리 대기 {!!q.data?.open && <span className="num ml-1 rounded-full bg-seal px-1.5 text-[11px] text-white">{q.data.open}</span>}</> }, { value: 'ORDERED', label: '발주완료' }, { value: 'REJECTED', label: '반려' }, { value: 'CANCELLED', label: '취소' }, { value: '', label: '전체' }]} /></div>
        <DataTable columns={columns} data={q.data?.rows} loading={q.isLoading} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/purchase-requests/${r.id}`)}
          page={q.data ? { page, size: 50, total: q.data.total, onPage: (p) => router.replace(`/purchase-requests${qs({ status, page: p })}`) } : undefined}
          mobileRow={(r) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{r.title}</span><Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge></div><p className="mt-1 text-meta text-muted">{r.projectName} · {r.lineCount}개 · {r.neededBy ?? ''}</p></div>}
          empty={<EmptyState icon={<ClipboardList className="size-8" strokeWidth={1.25} />} title={status === 'REQUESTED' ? '처리할 구매요청이 없습니다' : '해당하는 요청이 없습니다'} description="현장소장은 ‘구매요청’으로 필요한 자재를 적어 보내면 됩니다." />} />
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="구매요청" subtitle="구매담당에게 필요한 자재를 알립니다" width={720}>
        <RequestForm onCancel={() => setOpen(false)} onSaved={(id) => { setOpen(false); qc.invalidateQueries({ queryKey: ['purchase-requests'] }); toast('ok', '구매요청을 보냈습니다'); router.push(`/purchase-requests/${id}`); }} />
      </Drawer>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
