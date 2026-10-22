'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { CollectDialog } from '@/components/construction-bits';
import { SegTabs, SumStrip } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Input, PageHeader, Skeleton, Won } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { COLLECTION_KIND, TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Rec { project_id: string; code: string; name: string; trade_type: TradeType; vendor_id: string; vendor_name: string; billed: string; collected: string; outstanding: string; overdue: string; retention: string; retention_collected: string; retentionOutstanding: string; oldest_due: string | null }
interface Col { id: string; code: string; kind: string; kindLabel: string; collectDate: string; amount: string; projectName: string; vendorName: string; claimId: string | null; claimNo: number | null; bankName: string | null; status: string; memo: string | null }

export default function Page() {
  const qc = useQueryClient();
  const { can, company } = useSession();
  const [tab, setTab] = useState<'recv' | 'list'>('recv');
  const [open, setOpen] = useState(false);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: today.slice(0, 8) + '01', to: today });
  const recv = useQuery({ queryKey: ['receivables', company.id], queryFn: () => api<Rec[]>('/collections/receivables') });
  const cols = useQuery({ queryKey: ['collections', company.id, range], queryFn: () => api<Col[]>(`/collections${qs(range)}`), enabled: tab === 'list' });
  const sum = (k: keyof Rec) => String((recv.data ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0));
  return (
    <>
      <PageHeader title="수금·미수금" description="청구한 금액 중 받은 돈과 못 받은 돈을 현장·발주처별로 봅니다. 수금예정일이 지난 미수금은 붉게 표시됩니다."
        actions={can('payment:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>선급금·유보금 수금</Button>} />
      <div className="mb-4">        <div className=""><SegTabs label="보기" value={tab} onChange={setTab} items={[{ value: 'recv', label: '미수금 현황' }, { value: 'list', label: '수금 내역' }]} /></div>
      </div>
      {tab === 'recv' ? (
        <>
          {recv.data && <SumStrip items={[{ label: '청구액 합계', value: sum('billed'), tone: 'muted' }, { label: '수금액', value: sum('collected'), tone: 'ok' }, { label: '미수금', value: sum('outstanding'), tone: 'seal', strong: true }, { label: '연체 (예정일 지남)', value: sum('overdue'), tone: 'seal' }, { label: '받을 유보금', value: sum('retentionOutstanding'), tone: 'steel' }]} />}
          {!recv.data ? <Skeleton className="h-60" /> : !recv.data.length ? <EmptyState title="청구한 기성이 없습니다" description="기성을 승인하면 여기에서 현장별 미수금을 확인할 수 있습니다." action={<Link href="/claims"><Button>기성청구로</Button></Link>} /> : (
            <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
              <table className="w-full min-w-[820px]">
                <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">현장 · 발주처</th><th className="px-3 py-2 text-right font-medium">청구액</th><th className="px-3 py-2 text-right font-medium">수금</th><th className="px-3 py-2 text-right font-medium">미수금</th><th className="px-3 py-2 text-right font-medium">연체</th><th className="px-3 py-2 text-right font-medium">유보금 잔액</th><th className="px-3 py-2 text-left font-medium">가장 오래된 예정일</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {recv.data.map((r) => (
                    <tr key={r.project_id + r.vendor_id} className={clsx(Number(r.overdue) > 0 && 'bg-seal-soft/30')}>
                      <td className="px-3 py-2"><Link href={`/claims?projectId=${r.project_id}`} className="font-medium hover:underline"><span aria-hidden className="mr-1.5 inline-block h-3 w-1 rounded-[1px] align-middle" style={{ background: TRADE[r.trade_type].color }} />{r.name}</Link><p className="text-meta text-muted">{r.vendor_name}</p></td>
                      <td className="px-3 py-2 text-right"><Won value={r.billed} /></td>
                      <td className="px-3 py-2 text-right text-ok"><Won value={r.collected} /></td>
                      <td className="px-3 py-2 text-right font-semibold"><Won value={r.outstanding} /></td>
                      <td className="px-3 py-2 text-right">{Number(r.overdue) > 0 ? <span className="inline-flex items-center gap-1 font-medium text-seal"><TriangleAlert className="size-3" /><Won value={r.overdue} /></span> : <span className="text-faint">–</span>}</td>
                      <td className="px-3 py-2 text-right text-steel-ink"><Won value={r.retentionOutstanding} blankZero /></td>
                      <td className={clsx('num px-3 py-2', r.oldest_due && r.oldest_due < today ? 'text-seal' : 'text-muted')}>{r.oldest_due ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[6px] border border-line bg-surface">
          <div className="flex items-center gap-1 border-b border-line p-2.5">
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-[138px]" aria-label="시작일" /><span className="text-faint">~</span>
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-[138px]" aria-label="종료일" />
          </div>
          {!cols.data ? <Skeleton className="m-4 h-40" /> : !cols.data.length ? <EmptyState title="이 기간에 수금 기록이 없습니다" /> : (
            <ul className="divide-y divide-line">
              {cols.data.map((c) => (
                <li key={c.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-2.5', c.status === 'CANCELLED' && 'text-muted line-through decoration-faint')}>
                  <span className="num w-24 text-meta text-muted">{c.code}</span><span className="num">{c.collectDate}</span>
                  <Badge tone={c.kind === 'ADVANCE' ? 'steel' : c.kind === 'RETENTION' ? 'warn' : 'outline'}>{COLLECTION_KIND[c.kind]}</Badge>
                  <span className="min-w-0 flex-1 truncate">{c.projectName} <span className="text-meta text-muted">· {c.vendorName}{c.claimNo ? ` · ${c.claimNo}회 기성` : ''}{c.bankName ? ` · ${c.bankName}` : ''}</span></span>
                  {c.claimId ? <Link href={`/claims/${c.claimId}`} className="num font-medium hover:underline"><Won value={c.amount} /></Link> : <Won value={c.amount} className="font-medium" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <CollectDialog open onClose={() => setOpen(false)} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['collections'] }); }} />}
    </>
  );
}
