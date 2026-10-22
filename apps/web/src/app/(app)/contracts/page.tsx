'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePen, Plus, Trash2 } from 'lucide-react';
import { Suspense, useState } from 'react';
import { RevisionDrawer } from '@/components/construction-bits';
import { ProjectPicker } from '@/components/pickers';
import { Badge, Button, Drawer, EmptyState, Field, IconButton, Input, PageHeader, Skeleton, Textarea, TradeTag, Won, useToast } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { won } from '@/lib/format';
import { DOC_FLOW, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Summary { id: string; code: string; name: string; trade_type: TradeType; status: string; contract_date: string | null; planned_end_date: string | null; original: string; approved_delta: string; pending_delta: string; revisions: number; current: string }
interface Rev { id: string; code: string; projectId: string; projectName: string; projectCode: string; revisionNo: number; revisionDate: string; reason: string; beforeSupply: string; deltaAmount: string; afterSupply: string; status: string; afterEndDate: string | null }

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const projectId = sp.get('projectId');
  const [open, setOpen] = useState(false);
  const sum = useQuery({ queryKey: ['contract-summary', company.id], queryFn: () => api<Summary[]>('/contract-revisions/summary') });
  const revs = useQuery({ queryKey: ['contract-revisions', company.id, projectId], queryFn: () => api<Rev[]>(`/contract-revisions${qs({ projectId })}`) });
  const rows = (sum.data ?? []).filter((r) => !projectId || r.id === projectId);
  return (
    <>
      <PageHeader title="계약·변경계약" description="최초계약은 현장에 그대로 두고, 증감은 회차별 변경계약으로 쌓습니다. 대표 결재가 끝나야 확정 계약금액·기성 한도에 반영됩니다."
        actions={can('contract:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>변경계약 작성</Button>} />
      <div className="mb-4">        <div className="w-full max-w-sm"><ProjectPicker value={projectId} onChange={(v) => router.replace(`/contracts${qs({ projectId: v })}`)} placeholder="모든 현장" /></div>
      </div>
      {!sum.data ? <Skeleton className="h-[240px]" /> : (
        <div className="mb-5 overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[760px]">
            <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">현장</th><th className="px-3 py-2 text-right font-medium">최초계약</th><th className="px-3 py-2 text-right font-medium">승인된 증감</th><th className="px-3 py-2 text-right font-medium">확정 계약금액</th><th className="px-3 py-2 text-right font-medium">변경 예정 (미확정)</th><th className="px-3 py-2 text-right font-medium">변경 회차</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><TradeTag trade={r.trade_type} short /><Link href={`/projects/${r.id}`} className="font-medium hover:underline">{r.name}</Link></div><p className="num text-meta text-muted">{r.code}{r.planned_end_date ? ` · 준공예정 ${r.planned_end_date}` : ''}</p></td>
                  <td className="px-3 py-2 text-right"><Won value={r.original} /></td>
                  <td className={clsx('px-3 py-2 text-right', Number(r.approved_delta) < 0 ? 'text-seal' : Number(r.approved_delta) > 0 ? 'text-ok' : 'text-faint')}>{Number(r.approved_delta) > 0 && '+'}<Won value={r.approved_delta} /></td>
                  <td className="px-3 py-2 text-right font-semibold"><Won value={r.current} /></td>
                  <td className="px-3 py-2 text-right text-warn">{Number(r.pending_delta) ? <>{Number(r.pending_delta) > 0 && '+'}<Won value={r.pending_delta} /></> : <span className="text-faint">–</span>}</td>
                  <td className="num px-3 py-2 text-right text-muted">{r.revisions || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="rounded-[6px] border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-2.5 font-semibold">변경계약 이력</h2>
        {!revs.data ? <Skeleton className="m-4 h-24" /> : !revs.data.length ? (
          <EmptyState icon={<FilePen className="size-8" strokeWidth={1.25} />} title="변경계약이 없습니다" description="설계변경·물가변동 등으로 계약금액이나 공기가 바뀌면 변경계약을 작성해 결재받으세요." />
        ) : (
          <ul className="divide-y divide-line">
            {revs.data.map((r) => (
              <li key={r.id}>
                <Link href={`/contracts/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                  <span className="num w-24 text-meta text-muted">{r.code}</span>
                  <span className="min-w-0 flex-1"><span className="font-medium">{r.projectName}</span> <span className="text-muted">· {r.revisionNo}회 · {r.revisionDate}</span><span className="block truncate text-meta text-muted">{r.reason}</span></span>
                  <span className="num text-right"><span className="text-muted">{won(r.beforeSupply)} → </span><b>{won(r.afterSupply)}</b><span className={clsx('block text-meta', Number(r.deltaAmount) < 0 ? 'text-seal' : 'text-ok')}>{Number(r.deltaAmount) > 0 && '+'}{won(r.deltaAmount)}</span></span>
                  <Badge tone={DOC_FLOW[r.status].tone}>{DOC_FLOW[r.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <RevisionDrawer open projectId={projectId} onClose={() => setOpen(false)} onSaved={(id) => { setOpen(false); qc.invalidateQueries({ queryKey: ['contract-revisions'] }); qc.invalidateQueries({ queryKey: ['contract-summary'] }); router.push(`/contracts/${id}`); }} />}
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
