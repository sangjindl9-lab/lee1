'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { HardHat, Plus } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { SubcontractDrawer } from '@/components/construction-bits';
import { DataTable } from '@/components/data-table';
import { SumStrip } from '@/components/doc-ui';
import { ProjectPicker } from '@/components/pickers';
import { Badge, Button, EmptyState, PageHeader, Won } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { pct } from '@/lib/format';
import { SC_STATUS, TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; title: string; projectName: string; tradeType: TradeType; vendorName: string; costCodeName: string; contractDate: string; originalAmount: string; currentAmount: string; claimed: string; pending: string; paid: string; retention: string; balance: string; subRate: string | null; progressRate: string; status: string }

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { can, company } = useSession();
  const projectId = sp.get('projectId');
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['subcontracts', company.id, projectId], queryFn: () => api<Row[]>(`/subcontracts${qs({ projectId })}`) });
  const rows = q.data;
  const tot = (k: keyof Row) => String((rows ?? []).filter((r) => r.status !== 'DRAFT' && r.status !== 'REJECTED').reduce((a, r) => a + Number(r[k]), 0));
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: 'title', header: '계약',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[220px]">
          <Link href={`/subcontracts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.vendorName} · {r.title}</Link>
          <p className="text-meta text-muted"><span aria-hidden className="mr-1 inline-block h-2.5 w-1 rounded-[1px] align-middle" style={{ background: TRADE[r.tradeType].color }} />{r.projectName} · <span className="num">{r.code}</span> · {r.costCodeName}</p>
        </div>
      ),
    },
    { id: 'status', header: '상태', meta: { width: 90 }, cell: ({ row }) => <Badge tone={SC_STATUS[row.original.status].tone}>{SC_STATUS[row.original.status].label}</Badge> },
    { id: 'amt', header: '계약금액', meta: { align: 'right' }, cell: ({ row: { original: r } }) => <div><Won value={r.currentAmount} />{r.currentAmount !== r.originalAmount && <p className="num text-meta text-muted">최초 <Won value={r.originalAmount} /></p>}</div> },
    { id: 'rate', header: '하도급률', meta: { align: 'right', hideBelow: 'lg', width: 80 }, cell: ({ row }) => <span className="num text-muted">{row.original.subRate ? pct(row.original.subRate) : '–'}</span> },
    { id: 'claimed', header: '기성 (승인)', meta: { align: 'right', hideBelow: 'md' }, cell: ({ row: { original: r } }) => <div><Won value={r.claimed} /><p className="num text-meta text-muted">{pct(Number(r.currentAmount) ? Number(r.claimed) / Number(r.currentAmount) : 0)}</p></div> },
    { id: 'paid', header: '지급', meta: { align: 'right', hideBelow: 'xl' }, cell: ({ row }) => <Won value={row.original.paid} blankZero /> },
    { id: 'bal', header: '계약잔액', meta: { align: 'right' }, cell: ({ row }) => <Won value={row.original.balance} className="font-medium" /> },
  ], []);
  return (
    <>
      <PageHeader title="하도급·외주" description="하도급 계약(대표 결재) → 기성 신청·승인 → 지급결의 → 정산. 계약금액은 발주확정, 승인 기성은 발생원가, 지급은 지급액으로 따로 집계합니다."
        actions={can('subcontract:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>하도급 계약</Button>} />
      <div className="mb-4">        <div className="w-full max-w-sm"><ProjectPicker value={projectId} onChange={(v) => router.replace(`/subcontracts${qs({ projectId: v })}`)} placeholder="모든 현장" /></div>
      </div>
      {rows && <SumStrip items={[{ label: '계약금액 (진행·정산)', value: tot('currentAmount'), strong: true }, { label: '승인 기성 (발생원가)', value: tot('claimed'), tone: 'steel' }, { label: '지급액', value: tot('paid'), tone: 'ok' }, { label: '계약잔액', value: tot('balance'), tone: 'muted' }, { label: '유보금 (미지급)', value: tot('retention'), tone: 'muted' }]} />}
      <div className="rounded-[6px] border border-line bg-surface">
        <DataTable columns={columns} data={rows} loading={q.isLoading} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/subcontracts/${r.id}`)}
          mobileRow={(r) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{r.vendorName} · {r.title}</span><Badge tone={SC_STATUS[r.status].tone}>{SC_STATUS[r.status].label}</Badge></div><p className="text-meta text-muted">{r.projectName} · 잔액 <Won value={r.balance} /></p></div>}
          empty={<EmptyState icon={<HardHat className="size-8" strokeWidth={1.25} />} title="하도급 계약이 없습니다" description="통신·소방 등 공종을 협력업체에 맡기면 하도급 계약을 등록해 대표 결재를 받으세요." />} />
      </div>
      {open && <SubcontractDrawer projectId={projectId} onClose={() => setOpen(false)} onSaved={(id) => router.push(`/subcontracts/${id}`)} />}
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
