'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Badge, Button, EmptyState, Input, PageHeader, Won } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { wonShort } from '@/lib/format';
import { TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; receiptDate: string; inspectorName: string | null; status: 'CONFIRMED' | 'CANCELLED'; supplyAmount: string; vatAmount: string; poId: string; poCode: string; poTitle: string; vendorName: string; projectCode: string; projectName: string; tradeType: TradeType; cancelReason: string | null }
interface Resp { total: number; page: number; size: number; sums: { supplyAmount: string }; rows: Row[] }

export default function ReceiptsPage() {
  const router = useRouter();
  const { company, project } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const params = { from, to, page, size: 50, projectId: project?.id };
  const q = useQuery({ queryKey: ['receipts', company.id, params], queryFn: () => api<Resp>(`/purchase-orders/receipts${qs(params)}`), placeholderData: keepPreviousData });
  const cols = useMemo<ColumnDef<Row>[]>(() => [
    { id: 'code', header: '검수번호', meta: { width: 104 }, cell: ({ row }) => <span className="num whitespace-nowrap text-muted">{row.original.code}</span> },
    { id: 'date', header: '검수일', meta: { width: 100 }, cell: ({ row }) => <span className="num whitespace-nowrap">{row.original.receiptDate}</span> },
    { id: 'po', header: '발주서', cell: ({ row: { original: r } }) => <div><p className="font-medium">{r.poTitle}</p><p className="mt-0.5 flex items-center gap-1.5 text-meta text-muted"><span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: TRADE[r.tradeType].color }} /><span className="num">{r.poCode}</span> · {r.projectName}</p></div> },
    { id: 'vendor', header: '거래처', meta: { hideBelow: 'md' }, cell: ({ row }) => <span className="text-ink-2">{row.original.vendorName}</span> },
    { id: 'insp', header: '검수자', meta: { width: 90, hideBelow: 'lg' }, cell: ({ row }) => row.original.inspectorName },
    { id: 'st', header: '상태', meta: { width: 72 }, cell: ({ row }) => (row.original.status === 'CANCELLED' ? <Badge tone="muted">취소</Badge> : <Badge tone="ok">확정</Badge>) },
    { id: 'amt', header: '검수 공급가액', meta: { align: 'right', footer: <Won value={q.data?.sums.supplyAmount} /> }, cell: ({ row }) => <Won value={row.original.status === 'CANCELLED' ? '0' : row.original.supplyAmount} className={row.original.status === 'CANCELLED' ? 'text-faint line-through' : undefined} /> },
  ], [q.data?.sums]);
  return (
    <>
      <PageHeader title="납품·검수" description={q.data ? <span className="num">{project ? project.name : '전체 현장'} · 검수 확정 공급가액 {wonShort(q.data.sums.supplyAmount)}원</span> : ' '} />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} className="w-[138px]" aria-label="검수일 시작" />
          <span className="text-faint">~</span>
          <Input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} className="w-[138px]" aria-label="검수일 끝" />
          <p className="ml-auto text-meta text-muted">검수 등록은 승인된 발주서 화면에서 합니다.</p>
        </div>
        <DataTable
          columns={cols}
          data={q.data?.rows}
          loading={q.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/purchase-orders/${r.poId}`)}
          footerLabel={q.data ? `합계 ${q.data.total}건` : undefined}
          page={q.data ? { page, size: 50, total: q.data.total, onPage: setPage } : undefined}
          empty={<EmptyState icon={<PackageCheck className="size-8" strokeWidth={1.25} />} title="검수 내역이 없습니다" description="대표이사 승인이 끝난 발주서에서 납품받은 수량을 검수로 등록하세요." action={<Link href="/purchase-orders?status=OPEN"><Button>입고 대기 발주서 보기</Button></Link>} />}
        />
      </div>
    </>
  );
}
