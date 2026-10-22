'use client';

import { useApprovalLine } from '@/components/approval-line';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronLeft, Send, Undo2 } from 'lucide-react';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, StampBox, useRun } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Skeleton, TradeTag } from '@/components/ui';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import { REV_STATUS, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';
import { useState } from 'react';

interface Rev extends DocApprovalState {
  id: string; code: string; title: string; reason: string | null; status: string; version: number; projectId: string; projectCode: string; projectName: string; tradeType: TradeType; totalBefore: string; totalAfter: string;
  lines: { id: string; code: string; name: string; beforeAmount: string; afterAmount: string; delta: string; committed: string; actual: string; memo: string | null }[];
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const q = useQuery({ queryKey: ['budget-rev', company.id, id], queryFn: () => api<Rev>(`/budget-revisions/${id}`), retry: false });
  const { run, acting } = useRun(['budget', 'budget-overview']);
  const [just, setJust] = useState(false);
  const r = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget-rev', company.id, id] });
  if (q.error) return <EmptyState title="문서를 찾을 수 없습니다" />;
  if (!r) return <Skeleton className="h-96" />;
  const delta = BigInt(r.totalAfter.split('.')[0]) - BigInt(r.totalBefore.split('.')[0]);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/budgets/${r.projectId}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />{r.projectName} 실행예산</Link>
          <p className="mb-1 flex items-center gap-2 text-meta"><span className="num text-muted">{r.code}</span><Badge tone={REV_STATUS[r.status].tone}>{REV_STATUS[r.status].label}</Badge><TradeTag trade={r.tradeType} short /></p>
          <h1 className="text-title font-semibold">{r.title}</h1>
        </div>
        <div className="flex gap-1.5">
          {r.canRecall && <Button icon={<Undo2 className="size-3.5" />} onClick={() => run('recall', () => api(`/approvals/${r.approval!.id}/cancel`, { method: 'POST' }), '회수했습니다').then(refresh)}>결재 회수</Button>}
          {['DRAFT', 'REJECTED'].includes(r.status) && can('budget:update') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => run('cancel', () => api(`/budget-revisions/${r.id}/cancel`, { method: 'POST', json: { version: r.version } }), '취소했습니다').then(refresh)}>취소</Button>}
          {['DRAFT', 'REJECTED'].includes(r.status) && can('budget:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={async () => { const line = await pickLine('BUDGET', String(delta)); if (line === null) return; run('submit', () => api(`/budget-revisions/${r.id}/submit`, { method: 'POST', json: { version: r.version, approvalLine: line } }), '결재를 올렸습니다').then(refresh); }}>결재 상신</Button>}
        </div>
      </div>
      {r.canAct && r.approval && <ApprovalActionPanel approval={r.approval} summary={<>{r.projectName} · 실행예산 <b className="num text-ink">{delta >= 0n ? '+' : '△'}{won(String(delta >= 0n ? delta : -delta))}원</b></>} onDone={(a) => { refresh(); if (a === 'approve') setJust(true); }} />}
      {just && r.status === 'APPROVED' && <JustApproved approval={r.approval} text="실행예산에 반영되었습니다." />}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-[6px] border border-line bg-surface">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div><p className="text-meta text-muted">사유</p><p className="whitespace-pre-wrap">{r.reason}</p></div>
            <StampBox approval={r.approval} fallback={[{ title: '담당' }, { title: '승인', name: '대표이사' }]} />
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-body">
              <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-2 text-left font-medium">원가항목</th><th className="px-3 py-2 text-right font-medium">변경 전</th><th className="px-3 py-2 text-right font-medium">변경 후</th><th className="px-3 py-2 text-right font-medium">증감</th><th className="px-3 py-2 text-right font-medium">현재 발주확정</th><th className="px-3 py-2 text-right font-medium">현재 발생</th></tr></thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="num px-3 text-right text-ink-2">{won(l.beforeAmount)}</td>
                    <td className="num px-3 text-right font-medium">{won(l.afterAmount)}</td>
                    <td className={`num px-3 text-right ${Number(l.delta) > 0 ? 'text-seal' : 'text-steel-ink'}`}>{Number(l.delta) > 0 ? '+' : ''}{won(l.delta)}</td>
                    <td className="num px-3 text-right text-ink-2">{won(l.committed)}</td>
                    <td className="num px-3 text-right text-ink-2">{won(l.actual)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td className="px-3 py-2">현장 실행예산 합계</td><td className="num px-3 text-right">{won(r.totalBefore)}</td><td className="num px-3 text-right">{won(r.totalAfter)}</td><td className="num px-3 text-right">{delta >= 0n ? '+' : '△'}{won(String(delta >= 0n ? delta : -delta))}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        </section>
        <aside><ApprovalHistory history={r.approvalHistory} /></aside>
      </div>
      {lineNode}
    </>
  );
}
