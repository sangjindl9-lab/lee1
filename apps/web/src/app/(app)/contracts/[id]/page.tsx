'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronLeft, ClipboardList, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, won } from '@/lib/format';
import { DOC_FLOW } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface D extends DocApprovalState {
  id: string; code: string; projectId: string; revisionNo: number; revisionDate: string; reason: string; beforeSupply: string; deltaAmount: string; afterSupply: string; vatRate: string; deltaVat: string;
  beforeEndDate: string | null; afterEndDate: string | null; status: string; version: number; createdAt: string; budgetRevisionId: string | null;
  project: { id: string; code: string; name: string };
  contract: { original: string; current: string; pending: string };
  history: { id: string; code: string; revisionNo: number; revisionDate: string; deltaAmount: string; afterSupply: string; reason: string }[];
  budgetLines: { costCodeId: string; delta: string; code?: string; name?: string }[];
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['contract-revision', company.id, id], queryFn: () => api<D>(`/contract-revisions/${id}`), retry: false });
  const { run, acting } = useRun(['contract-revisions', 'contract-summary']);
  const [dialog, setDialog] = useState(false);
  const [just, setJust] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['contract-revision', company.id, id] });
  if (q.error) return <EmptyState title="변경계약을 찾을 수 없습니다" action={<Link href="/contracts"><Button>목록으로</Button></Link>} />;
  if (!d) return <Skeleton className="h-[480px]" />;
  const a = d.approval;
  const editable = ['DRAFT', 'REJECTED'].includes(d.status);
  const up = Number(d.deltaAmount) > 0;
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/contracts?projectId=${d.projectId}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />계약·변경계약</Link>
          <div className="mb-1 flex items-center gap-2 text-meta"><span className="num text-muted">{d.code}</span><Badge tone={DOC_FLOW[d.status].tone}>{DOC_FLOW[d.status].label}</Badge><Link href={`/projects/${d.project.id}`} className="text-muted hover:text-ink">{d.project.name}</Link></div>
          <h1 className="text-title font-semibold">제 {d.revisionNo} 회 변경계약 <span className={clsx('num font-normal', up ? 'text-ok' : 'text-seal')}>{up ? '+' : ''}{won(d.deltaAmount)}원</span></h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} loading={acting === 'recall'} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {editable && can('contract:update') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog(true)}>취소</Button>}
          {editable && can('contract:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={() => run('submit', () => api(`/contract-revisions/${d.id}/submit`, { method: 'POST', json: { version: d.version } }), '대표 결재를 올렸습니다').then(refresh)}>결재 상신</Button>}
          {d.status === 'APPROVED' && d.budgetLines.length > 0 && !d.budgetRevisionId && can('budget:create') && <Button variant="primary" icon={<ClipboardList className="size-3.5" />} loading={acting === 'budget'} onClick={() => run('budget', () => api(`/contract-revisions/${d.id}/budget-draft`, { method: 'POST' }), '실행예산 변경 초안을 만들었습니다').then(refresh)}>실행예산 조정안 만들기</Button>}
          {d.budgetRevisionId && <Link href={`/budgets/revisions/${d.budgetRevisionId}`}><Button icon={<ClipboardList className="size-3.5" />}>실행예산 변경 보기</Button></Link>}
        </div>
      </div>
      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>{d.project.name} 계약금액 <b className="num">{won(d.beforeSupply)} → {won(d.afterSupply)}원</b></>} onDone={(act) => { refresh(); if (act === 'approve') setJust(true); }} />}
      {just && d.status === 'APPROVED' && <JustApproved approval={a} text="확정 계약금액과 기성 한도에 반영되었습니다." />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-meta text-muted">변경 전 계약금액</p><p className="num mt-0.5 text-[18px]">{won(d.beforeSupply)}<span className="text-meta text-faint"> 원</span></p></div>
              <div><p className="text-meta text-muted">증감</p><p className={clsx('num mt-0.5 text-[18px] font-semibold', up ? 'text-ok' : 'text-seal')}>{up ? '+' : ''}{won(d.deltaAmount)}<span className="text-meta font-normal text-faint"> 원</span></p><p className="num text-meta text-muted">부가세 {up ? '+' : ''}{won(d.deltaVat)}</p></div>
              <div><p className="text-meta text-muted">변경 후 계약금액</p><p className="num mt-0.5 text-[18px] font-semibold">{won(d.afterSupply)}<span className="text-meta font-normal text-faint"> 원</span></p></div>
            </div>
            <dl className="mt-5 grid grid-cols-[120px_1fr] gap-y-2 border-t border-line pt-4 text-body">
              <dt className="text-muted">변경계약일</dt><dd className="num">{d.revisionDate}</dd>
              <dt className="text-muted">준공예정일</dt><dd className="num">{d.afterEndDate ? <>{d.beforeEndDate ?? '미정'} → <b>{d.afterEndDate}</b></> : `${d.beforeEndDate ?? '미정'} (변경 없음)`}</dd>
              <dt className="text-muted">변경 사유</dt><dd className="whitespace-pre-wrap">{d.reason}</dd>
            </dl>
            {d.budgetLines.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="font-medium">실행예산 조정안</p>
                <ul className="mt-1 space-y-0.5 text-body">{d.budgetLines.map((l) => <li key={l.costCodeId} className="flex justify-between"><span>{l.code} {l.name}</span><span className={clsx('num', Number(l.delta) < 0 ? 'text-seal' : 'text-ok')}>{Number(l.delta) > 0 && '+'}{won(l.delta)}</span></li>)}</ul>
                <p className="mt-1 text-meta text-muted">승인 후 실행예산 변경 초안으로 만들어 따로 결재받습니다.</p>
              </div>
            )}
          </section>
          <section className="rounded-[6px] border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-2.5 font-semibold">계약금액 변천</h2>
            <ol className="divide-y divide-line text-body">
              <li className="flex justify-between px-4 py-2"><span>최초 계약</span><span className="num">{won(d.contract.original)}</span></li>
              {d.history.map((h) => <li key={h.id} className="flex justify-between px-4 py-2"><span>{h.revisionNo}회 변경 <span className="num text-meta text-muted">{h.revisionDate} · {h.reason}</span></span><span className="num">{won(h.afterSupply)} <span className={clsx('text-meta', Number(h.deltaAmount) < 0 ? 'text-seal' : 'text-ok')}>({Number(h.deltaAmount) > 0 && '+'}{won(h.deltaAmount)})</span></span></li>)}
              <li className="flex justify-between bg-surface-2 px-4 py-2 font-semibold"><span>현재 확정</span><span className="num">{won(d.contract.current)}</span></li>
            </ol>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={['작성', '대표 결재', '확정']} current={d.status === 'PENDING' ? 1 : d.status === 'APPROVED' ? 2 : 0} failed={d.status === 'REJECTED'} done={d.status === 'APPROVED'} />
            {a && <div className="mt-3 flex justify-end"><StampBox approval={a} /></div>}
          </section>
          <ApprovalHistory history={d.approvalHistory} />
          <p className="px-1 text-meta text-faint">작성 {dateTime(d.createdAt)}</p>
        </aside>
      </div>
      <ReasonDialog open={dialog} title="변경계약을 취소할까요?" danger confirm="취소" body="작성 기록은 남고 계약금액에는 반영되지 않습니다." onClose={() => setDialog(false)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/contract-revisions/${d.id}/cancel`, { method: 'POST', json: { reason } }), '취소했습니다')) { setDialog(false); refresh(); } }} />
    </>
  );
}
