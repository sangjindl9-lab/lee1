'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, GitCompareArrows, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ProjectPicker, VendorPicker } from '@/components/pickers';
import { Checkbox, EmptyState, Input, PageHeader, Skeleton, Won } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Row {
  id: string; code: string; title: string; order_date: string; status: string; po_supply: string; vendor_id: string; vendor_name: string; project_id: string; project_name: string;
  received: string; invoiced: string; invoice_total: string; invoice_codes: string | null; diffReceivedInvoiced: string; diffPoReceived: string; issues: string[]; ok: boolean;
}

/** 발주 → 검수 → 세금계산서 세 금액을 한 줄에 놓고 어긋난 곳을 표시한다 */
export default function Page() {
  const { company } = useSession();
  const [f, setF] = useState({ vendor: null as { id: string; name: string } | null, projectId: null as string | null, from: '', to: '', onlyDiff: true });
  const params = { vendorId: f.vendor?.id, projectId: f.projectId ?? undefined, from: f.from || undefined, to: f.to || undefined, onlyDiff: f.onlyDiff ? '1' : undefined };
  const q = useQuery({ queryKey: ['ti-reconcile', company.id, params], queryFn: () => api<Row[]>(`/tax-invoices/reconcile${qs(params)}`) });
  const rows = q.data ?? [];
  const bar = (r: Row) => {
    const max = Math.max(Number(r.po_supply), Number(r.received), Number(r.invoice_total), 1);
    const diff = Number(r.invoice_total) - Number(r.received);
    return [
      { label: '발주', v: r.po_supply, w: Number(r.po_supply) / max, c: 'bg-line-strong' },
      { label: '검수', v: r.received, w: Number(r.received) / max, c: 'bg-steel' },
      { label: '계산서', v: r.invoice_total, w: Number(r.invoice_total) / max, c: diff === 0 ? 'bg-ok' : 'bg-seal' },
    ];
  };
  return (
    <>
      <PageHeader title="발주·검수·세금계산서 대사" description="발주한 금액, 실제 검수한 금액, 받은 세금계산서 금액을 나란히 놓고 차이를 찾습니다. 검수했는데 계산서가 없거나, 계산서가 검수보다 많으면 표시됩니다.">
        <Link href="/tax-invoices" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />세금계산서</Link>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[6px] border border-line bg-surface p-2.5">
        <div className="w-full sm:w-[240px]"><VendorPicker value={f.vendor?.id ?? null} display={f.vendor?.name} onChange={(v) => setF({ ...f, vendor: v })} placeholder="모든 거래처" /></div>
        <div className="w-full sm:w-[260px]"><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} placeholder="모든 현장" /></div>
        <div className="flex items-center gap-1">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-[138px]" aria-label="발주일 시작" /><span className="text-faint">~</span>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-[138px]" aria-label="발주일 끝" />
        </div>
        <Checkbox checked={f.onlyDiff} onChange={(v) => setF({ ...f, onlyDiff: v })} label="차이 있는 발주만" />
      </div>
      {q.isLoading ? <Skeleton className="h-[360px]" /> : rows.length === 0 ? (
        <EmptyState icon={f.onlyDiff ? <CircleCheck className="size-8 text-ok" strokeWidth={1.25} /> : <GitCompareArrows className="size-8" strokeWidth={1.25} />} title={f.onlyDiff ? '어긋난 발주가 없습니다' : '조건에 맞는 발주가 없습니다'} description={f.onlyDiff ? '검수한 금액만큼 세금계산서가 모두 연결되어 있습니다.' : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[920px]">
            <thead className="bg-surface-2 text-meta text-muted"><tr>
              <th className="px-3 py-2 text-left font-medium">발주</th><th className="w-[260px] px-3 py-2 text-left font-medium">금액 비교</th>
              <th className="px-3 py-2 text-right font-medium">발주</th><th className="px-3 py-2 text-right font-medium">검수</th><th className="px-3 py-2 text-right font-medium">계산서</th><th className="px-3 py-2 text-right font-medium">계산서−검수</th><th className="px-3 py-2 text-left font-medium">확인할 점</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={clsx(!r.ok && 'bg-seal-soft/30')}>
                  <td className="px-3 py-2.5">
                    <Link href={`/purchase-orders/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                    <p className="num text-meta text-muted">{r.code} · {r.order_date} · {r.vendor_name} · {r.project_name}</p>
                    {r.invoice_codes && <p className="num text-meta text-faint">계산서 {r.invoice_codes}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="space-y-[3px]" aria-hidden>
                      {bar(r).map((b) => <div key={b.label} className="flex items-center gap-1.5"><span className="w-9 text-[10.5px] text-faint">{b.label}</span><span className="h-[6px] flex-1 rounded-[1px] bg-surface-2"><span className={clsx('block h-full rounded-[1px]', b.c)} style={{ width: `${Math.max(b.w * 100, b.w > 0 ? 2 : 0)}%` }} /></span></div>)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right"><Won value={r.po_supply} /></td>
                  <td className="px-3 py-2.5 text-right"><Won value={r.received} /></td>
                  <td className="px-3 py-2.5 text-right"><Won value={r.invoice_total} /></td>
                  <td className={clsx('px-3 py-2.5 text-right font-medium', Number(r.invoice_total) - Number(r.received) !== 0 ? 'text-seal' : 'text-muted')}>{Number(r.invoice_total) - Number(r.received) > 0 && '+'}<Won value={String(Number(r.invoice_total) - Number(r.received))} /></td>
                  <td className="px-3 py-2.5">
                    {r.issues.length ? <ul className="space-y-0.5 text-meta">{r.issues.map((i) => <li key={i} className={clsx('flex items-center gap-1', i === '미입고 잔량' ? 'text-muted' : 'text-seal')}>{i !== '미입고 잔량' && <TriangleAlert className="size-3 shrink-0" />}{i}</li>)}</ul> : <span className="text-meta text-ok">일치</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
