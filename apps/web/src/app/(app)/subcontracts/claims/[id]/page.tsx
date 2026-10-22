'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookOpen, ChevronLeft, Send, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { pct, won } from '@/lib/format';
import { DOC_FLOW, JOURNAL_STATUS, PAYREQ_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface D extends DocApprovalState {
  id: string; code: string; claimNo: number; claimDate: string; prevCumulative: string; thisAmount: string; cumulative: string; progressRate: string; vatAmount: string; retentionAmount: string; payableAmount: string; status: string; version: number; memo: string | null;
  subcontract: { id: string; code: string; title: string; currentAmount: string; retentionRate: string };
  project: { id: string; name: string }; vendor: { id: string; name: string };
  payment: { request_id: string; code: string; status: string } | null;
  journals: { id: string; code: string; status: string; entry_date: string }[];
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['sub-claim', company.id, id], queryFn: () => api<D>(`/subcontracts/claims/${id}`), retry: false });
  const { run, acting } = useRun(['subcontracts', 'subcontract']);
  const [cancel, setCancel] = useState(false);
  const [just, setJust] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['sub-claim', company.id, id] });
  if (q.error) return <EmptyState title="하도급 기성을 찾을 수 없습니다" action={<Link href="/subcontracts"><Button>목록으로</Button></Link>} />;
  if (!d) return <Skeleton className="h-[420px]" />;
  const a = d.approval;
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/subcontracts/${d.subcontract.id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />{d.subcontract.title}</Link>
          <div className="mb-1 flex items-center gap-2 text-meta"><span className="num text-muted">{d.code}</span><Badge tone={DOC_FLOW[d.status].tone}>{DOC_FLOW[d.status].label}</Badge><span className="text-muted">{d.project.name}</span></div>
          <h1 className="text-title font-semibold">{d.vendor.name} · {d.claimNo}회 하도급 기성 <span className="num font-normal text-muted">{won(d.thisAmount)}원</span></h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {!['PENDING', 'CANCELLED'].includes(d.status) && can('subcontract:update') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setCancel(true)}>취소</Button>}
          {['DRAFT', 'REJECTED'].includes(d.status) && can('subcontract:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={() => run('submit', () => api(`/subcontracts/claims/${d.id}/submit`, { method: 'POST', json: { version: d.version } }), '결재를 올렸습니다').then(refresh)}>결재 상신</Button>}
          {d.status === 'APPROVED' && !d.payment && can('expense:create') && <Link href={`/payment-requests/new?source=SUB&vendorId=${d.vendor.id}`}><Button variant="primary" icon={<Wallet className="size-3.5" />}>지급결의 작성</Button></Link>}
        </div>
      </div>
      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>금회 <b className="num">{won(d.thisAmount)}원</b> · 누적 {pct(d.progressRate)} · 지급할 금액 {won(d.payableAmount)}원</>} onDone={(act) => { refresh(); if (act === 'approve') setJust(true); }} />}
      {just && d.status === 'APPROVED' && <JustApproved approval={a} text="원가로 반영했습니다. 지급결의로 대금을 지급하세요." />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-[6px] border border-line bg-surface p-5">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-body">
            <dt className="text-muted">계약금액</dt><dd className="num">{won(d.subcontract.currentAmount)}</dd>
            <dt className="text-muted">전회 누적</dt><dd className="num">{won(d.prevCumulative)}</dd>
            <dt className="text-muted">금회 기성</dt><dd className="num font-semibold">{won(d.thisAmount)}</dd>
            <dt className="text-muted">누적 · 기성률</dt><dd className="num">{won(d.cumulative)} · {pct(d.progressRate)}</dd>
            <dt className="border-t border-line pt-2 text-muted">부가세</dt><dd className="num border-t border-line pt-2">+ {won(d.vatAmount)}</dd>
            <dt className="text-muted">유보금 ({pct(d.subcontract.retentionRate)})</dt><dd className="num">△ {won(d.retentionAmount)}</dd>
            <dt className="font-semibold">지급할 금액</dt><dd className="num text-[17px] font-semibold">{won(d.payableAmount)}</dd>
          </dl>
          {d.memo && <p className="mt-4 text-meta text-ink-2">{d.memo}</p>}
          <p className="mt-4 text-meta text-faint">승인되면 (외주비·부가세대급금 / 외상매입금·하도급유보금)으로 분개합니다. 유보금은 하도급 정산 후 따로 지급합니다.</p>
        </section>
        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={['신청', '결재', '원가 반영', '지급']} current={d.status === 'PENDING' ? 1 : d.status === 'APPROVED' ? (d.payment?.status === 'PAID' ? 3 : 2) : 0} failed={d.status === 'REJECTED' || d.status === 'CANCELLED'} done={d.payment?.status === 'PAID'} />
            {d.payment && <Link href={`/payment-requests/${d.payment.request_id}`} className="mt-3 flex items-center justify-between rounded-[4px] bg-surface-2 px-3 py-2 text-meta hover:bg-surface-hover"><span>지급결의 {d.payment.code}</span><Badge tone={PAYREQ_STATUS[d.payment.status].tone}>{PAYREQ_STATUS[d.payment.status].label}</Badge></Link>}
            {a && <div className="mt-3 flex justify-end"><StampBox approval={a} /></div>}
          </section>
          {d.journals.length > 0 && can('journal:read') && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 font-semibold"><BookOpen className="size-4 text-muted" />전표</h2>
              <ul className="divide-y divide-line">{d.journals.map((j) => <li key={j.id}><Link href={`/journals/${j.id}`} className="flex justify-between px-4 py-2 hover:bg-surface-hover"><span className="num">{j.code}</span><Badge tone={JOURNAL_STATUS[j.status].tone}>{JOURNAL_STATUS[j.status].label}</Badge></Link></li>)}</ul>
            </section>
          )}
          <ApprovalHistory history={d.approvalHistory} />
        </aside>
      </div>
      <ReasonDialog open={cancel} title="하도급 기성을 취소할까요?" danger confirm="취소" body={d.status === 'APPROVED' ? '원가 분개를 역분개합니다. 지급결의에 들어간 기성은 먼저 결의를 취소하세요.' : '기록은 남습니다.'} onClose={() => setCancel(false)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/subcontracts/claims/${d.id}/cancel`, { method: 'POST', json: { reason } }), '취소했습니다')) { setCancel(false); refresh(); } }} />
    </>
  );
}
