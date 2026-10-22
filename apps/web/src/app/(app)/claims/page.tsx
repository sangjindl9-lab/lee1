'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Download, FileSpreadsheet, Plus, TriangleAlert } from 'lucide-react';
import { Suspense, useMemo } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs, SumStrip } from '@/components/doc-ui';
import { ProjectPicker } from '@/components/pickers';
import { Badge, Button, EmptyState, PageHeader, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { pct } from '@/lib/format';
import { CLAIM_STATUS, TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; projectId: string; projectName: string; tradeType: TradeType; vendorName: string; claimNo: number; claimDate: string; dueDate: string | null; thisSupply: string; cumulative: string; progressRate: string; receivableAmount: string; collected: string; outstanding: string; overdue: boolean; status: string; isFinal: boolean; invoiceId: string | null }
interface Resp { total: number; sums: { claimed: string; receivable: string; collected: string; outstanding: string }; rows: Row[] }

const TABS = [{ value: '', label: '전체' }, { value: 'DRAFT', label: '작성중' }, { value: 'PENDING', label: '결재중' }, { value: 'OPEN', label: '미수' }, { value: 'COLLECTED', label: '수금 완료' }];

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company } = useSession();
  const f = { projectId: sp.get('projectId') ?? '', status: sp.get('status') ?? '' };
  const set = (p: Partial<typeof f>) => router.replace(`/claims${qs({ ...f, ...p })}`, { scroll: false });
  const params = { projectId: f.projectId || undefined, status: f.status || undefined };
  const list = useQuery({ queryKey: ['claims', company.id, params], queryFn: () => api<Resp>(`/progress-claims${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: 'no', header: '회차', meta: { width: 64 }, cell: ({ row }) => <span className="num font-medium">{row.original.isFinal ? '준공' : `${row.original.claimNo}회`}</span> },
    {
      id: 'project', header: '현장',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[200px]">
          <Link href={`/claims/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline"><span aria-hidden className="mr-1.5 inline-block h-3 w-1 rounded-[1px] align-middle" style={{ background: TRADE[r.tradeType].color }} />{r.projectName}</Link>
          <p className="num text-meta text-muted">{r.code} · {r.claimDate} · {r.vendorName}</p>
        </div>
      ),
    },
    { id: 'rate', header: '누적 기성률', meta: { width: 120, hideBelow: 'md' }, cell: ({ row }) => <div><span className="num">{pct(row.original.progressRate)}</span><div className="mt-1 h-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-steel" style={{ width: `${Math.min(100, Number(row.original.progressRate) * 100)}%` }} /></div></div> },
    { id: 'status', header: '상태', meta: { width: 110 }, cell: ({ row }) => <Badge tone={CLAIM_STATUS[row.original.status].tone}>{CLAIM_STATUS[row.original.status].label}</Badge> },
    { id: 'this', header: '금회 기성', meta: { align: 'right', hideBelow: 'lg' }, cell: ({ row }) => <Won value={row.original.thisSupply} /> },
    { id: 'recv', header: '청구액', meta: { align: 'right', hideBelow: 'xl' }, cell: ({ row }) => <Won value={row.original.receivableAmount} /> },
    { id: 'col', header: '수금', meta: { align: 'right', hideBelow: 'xl' }, cell: ({ row }) => <Won value={row.original.collected} blankZero /> },
    {
      id: 'out', header: '미수금', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => Number(r.outstanding) ? <span className={clsx('inline-flex items-center gap-1 font-medium', r.overdue && 'text-seal')}>{r.overdue && <TriangleAlert className="size-3" aria-label="수금예정일 지남" />}<Won value={r.outstanding} /></span> : <span className="text-faint">–</span>,
    },
  ], []);
  return (
    <>
      <PageHeader title="기성청구" description="기성을 승인하면 매출로 인식합니다. 세금계산서 발행과 수금은 따로 처리하며, 매출액과 수금액·미수금을 항상 나누어 보여 줍니다."
        actions={<>
          {can('claim:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/progress-claims/export.xlsx${qs(params)}`, '기성청구.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
          <Link href="/collections"><Button icon={<FileSpreadsheet className="size-3.5" />}>수금·미수금</Button></Link>
          {can('claim:create') && <Link href={`/claims/new${qs({ projectId: f.projectId || undefined })}`}><Button variant="primary" icon={<Plus className="size-4" />}>기성 작성</Button></Link>}
        </>} />
      {d && <SumStrip items={[{ label: '인식 매출 (승인 기성)', value: d.sums.claimed, strong: true }, { label: '청구액 (세액 포함, 공제 후)', value: d.sums.receivable, tone: 'muted' }, { label: '수금액', value: d.sums.collected, tone: 'ok' }, { label: '미수금', value: d.sums.outstanding, tone: 'seal' }]} />}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="상태" value={f.status} onChange={(v) => set({ status: v })} items={TABS} />
          <div className="w-full sm:w-[280px]"><ProjectPicker value={f.projectId || null} onChange={(v) => set({ projectId: v ?? '' })} placeholder="모든 현장" /></div>
        </div>
        <DataTable columns={columns} data={d?.rows} loading={list.isLoading} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/claims/${r.id}`)} footerLabel={d ? `${d.total}건` : undefined}
          rowClassName={(r) => (r.status === 'CANCELLED' ? 'text-muted line-through decoration-faint' : undefined)}
          mobileRow={(r) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{r.projectName} {r.claimNo}회</span><Badge tone={CLAIM_STATUS[r.status].tone}>{CLAIM_STATUS[r.status].label}</Badge></div><div className="mt-1 flex justify-between text-meta text-muted"><span>{r.claimDate}</span><span>미수 <Won value={r.outstanding} /></span></div></div>}
          empty={<EmptyState title="기성청구가 없습니다" description="현장을 고르고 이번 기간에 시공한 금액을 공종별로 입력하면 전회·누적·기성률을 자동으로 계산합니다." action={can('claim:create') ? <Link href="/claims/new"><Button variant="primary" icon={<Plus className="size-4" />}>기성 작성</Button></Link> : undefined} />} />
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
