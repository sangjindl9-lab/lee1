'use client';

import { useApprovalLine } from '@/components/approval-line';
import clsx from 'clsx';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCheck, ChevronLeft, FilePen, Plus, Send, ShieldCheck, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { SubClaimDialog, SubReviseDialog } from '@/components/construction-bits';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Skeleton, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { bizNo, pct, won } from '@/lib/format';
import { BIZ_STATUS, DOC_FLOW, PAYREQ_STATUS, SC_STATUS, type BizStatus } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface D extends DocApprovalState {
  id: string; code: string; title: string; status: string; version: number; contractDate: string; startDate: string | null; endDate: string | null; originalAmount: string; currentAmount: string; vatRate: string; retentionRate: string;
  guaranteeType: string | null; guaranteeNo: string | null; guaranteeAmount: string | null; guaranteeExpiry: string | null; scope: string | null;
  project: { id: string; code: string; name: string }; vendor: { id: string; name: string; bizRegNo: string | null; ceoName: string | null; bizStatus: BizStatus }; costCode: { code: string; name: string };
  revisions: { id: string; revisionNo: number; revisionDate: string; beforeAmount: string; deltaAmount: string; afterAmount: string; reason: string }[];
  claims: { id: string; code: string; claimNo: number; claimDate: string; thisAmount: string; cumulative: string; vatAmount: string; retentionAmount: string; payableAmount: string; status: string; payment: { request_id: string; code: string; status: string } | null }[];
  retentionPayment: { request_id: string; code: string; status: string } | null;
  totals: { claimed: string; balance: string; retention: string; rate: string }; subRate: string | null; projectContract: string;
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { ask, node } = useConfirm();
  const { can, company } = useSession();
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const q = useQuery({ queryKey: ['subcontract', company.id, id], queryFn: () => api<D>(`/subcontracts/${id}`), retry: false });
  const { run, acting } = useRun(['subcontracts']);
  const [dialog, setDialog] = useState<null | 'cancel' | 'claim' | 'revise'>(null);
  const [just, setJust] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['subcontract', company.id, id] });
  if (q.error) return <EmptyState title="하도급 계약을 찾을 수 없습니다" action={<Link href="/subcontracts"><Button>목록으로</Button></Link>} />;
  if (!d) return <Skeleton className="h-[520px]" />;
  const a = d.approval;
  const live = d.claims.filter((c) => !['CANCELLED', 'REJECTED'].includes(c.status));
  const unpaidClaims = d.claims.filter((c) => c.status === 'APPROVED' && !c.payment);
  return (
    <>
      {node}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/subcontracts?projectId=${d.project.id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />하도급·외주</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta"><span className="num text-muted">{d.code}</span><Badge tone={SC_STATUS[d.status].tone}>{SC_STATUS[d.status].label}</Badge><Link href={`/projects/${d.project.id}`} className="text-muted hover:text-ink">{d.project.name}</Link></div>
          <h1 className="text-title font-semibold">{d.vendor.name} · {d.title}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {['DRAFT', 'REJECTED', 'ACTIVE'].includes(d.status) && can('subcontract:update') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>계약 취소</Button>}
          {['DRAFT', 'REJECTED'].includes(d.status) && can('subcontract:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={async () => { const line = await pickLine('SUBCONTRACT', d.currentAmount); if (line === null) return; run('submit', () => api(`/subcontracts/${d.id}/submit`, { method: 'POST', json: { version: d.version, approvalLine: line } }), '대표 결재를 올렸습니다').then(refresh); }}>결재 상신</Button>}
          {d.status === 'ACTIVE' && can('subcontract:approve') && <Button icon={<FilePen className="size-3.5" />} onClick={() => setDialog('revise')}>변경계약</Button>}
          {d.status === 'ACTIVE' && can('subcontract:approve') && <Button icon={<CheckCheck className="size-3.5" />} loading={acting === 'complete'} onClick={async () => { if (await ask({ title: '하도급을 정산할까요?', body: '모든 기성이 끝났는지 확인합니다. 정산 후에는 기성을 더 받을 수 없고, 남은 유보금은 지급결의로 지급합니다.', confirm: '정산 완료' })) run('complete', () => api(`/subcontracts/${d.id}/complete`, { method: 'POST' }), '정산 완료했습니다').then(refresh); }}>정산</Button>}
          {d.status === 'ACTIVE' && can('subcontract:create') && Number(d.totals.balance) > 0 && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog('claim')}>기성 신청</Button>}
          {(unpaidClaims.length > 0 || (d.status === 'COMPLETED' && Number(d.totals.retention) > 0 && !d.retentionPayment)) && can('expense:create') && <Link href={`/payment-requests/new?source=SUB&vendorId=${d.vendor.id}`}><Button variant="primary" icon={<Wallet className="size-3.5" />}>지급결의 작성</Button></Link>}
        </div>
      </div>
      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>{d.vendor.name} 계약금액 <b className="num">{won(d.currentAmount)}원</b>{d.subRate && ` · 하도급률 ${pct(d.subRate)}`}</>} onDone={(act) => { refresh(); if (act === 'approve') setJust(true); }} />}
      {just && d.status === 'ACTIVE' && <JustApproved approval={a} text="계약이 진행 상태가 되었습니다. 기성을 신청받을 수 있습니다." />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-line bg-surface lg:grid-cols-5">
            {[['계약금액', d.currentAmount], ['승인 기성', d.totals.claimed], ['기성률', null], ['계약잔액', d.totals.balance], ['유보금', d.totals.retention]].map(([k, v]) => (
              <div key={k as string} className="border-line px-4 py-3 not-last:border-r max-lg:border-b"><p className="text-meta text-muted">{k}</p><p className="num mt-0.5 text-[17px]">{v === null ? pct(d.totals.rate) : won(v)}</p></div>
            ))}
          </section>
          <section className="rounded-[6px] border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-2.5 font-semibold">기성 <span className="num font-normal text-muted">{live.length}</span></h2>
            {!d.claims.length ? <p className="px-4 py-3 text-meta text-muted">{d.status === 'ACTIVE' ? '협력업체가 기성을 신청하면 여기서 등록해 결재를 올리세요.' : '계약 결재가 끝나면 기성을 받을 수 있습니다.'}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">회차</th><th className="px-3 py-2 text-right font-medium">금회</th><th className="px-3 py-2 text-right font-medium">누적</th><th className="px-3 py-2 text-right font-medium">유보금</th><th className="px-3 py-2 text-right font-medium">지급할 금액</th><th className="px-3 py-2 text-left font-medium">상태</th><th className="px-3 py-2 text-left font-medium">지급</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.claims.map((c) => (
                      <tr key={c.id} className={clsx('cursor-pointer hover:bg-surface-hover', c.status === 'CANCELLED' && 'text-muted line-through decoration-faint')} onClick={() => router.push(`/subcontracts/claims/${c.id}`)}>
                        <td className="px-3 py-2"><span className="num font-medium">{c.claimNo}회</span> <span className="num text-meta text-muted">{c.claimDate}</span></td>
                        <td className="num px-3 py-2 text-right">{won(c.thisAmount)}</td><td className="num px-3 py-2 text-right text-muted">{won(c.cumulative)}</td><td className="num px-3 py-2 text-right text-muted">{won(c.retentionAmount)}</td><td className="num px-3 py-2 text-right font-medium">{won(c.payableAmount)}</td>
                        <td className="px-3 py-2"><Badge tone={DOC_FLOW[c.status].tone}>{DOC_FLOW[c.status].label}</Badge></td>
                        <td className="px-3 py-2">{c.payment ? <Badge tone={PAYREQ_STATUS[c.payment.status].tone}>{c.payment.code} {PAYREQ_STATUS[c.payment.status].label}</Badge> : c.status === 'APPROVED' ? <span className="text-meta text-warn">결의 전</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="rounded-[6px] border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-2.5 font-semibold">계약금액 변천</h2>
            <ol className="divide-y divide-line text-body">
              <li className="flex justify-between px-4 py-2"><span>최초 계약 <span className="num text-meta text-muted">{d.contractDate}</span></span><span className="num">{won(d.originalAmount)}</span></li>
              {d.revisions.map((r) => <li key={r.id} className="flex justify-between gap-3 px-4 py-2"><span>{r.revisionNo}회 변경 <span className="num text-meta text-muted">{r.revisionDate} · {r.reason}</span></span><span className="num shrink-0">{won(r.afterAmount)} <span className={clsx('text-meta', Number(r.deltaAmount) < 0 ? 'text-seal' : 'text-ok')}>({Number(r.deltaAmount) > 0 && '+'}{won(r.deltaAmount)})</span></span></li>)}
            </ol>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={['작성', '대표 결재', '진행', '정산']} current={d.status === 'PENDING' ? 1 : d.status === 'ACTIVE' ? 2 : d.status === 'COMPLETED' ? 3 : 0} failed={d.status === 'REJECTED' || d.status === 'CANCELLED'} done={d.status === 'COMPLETED'} />
            <dl className="mt-4 grid grid-cols-[96px_1fr] gap-y-1.5 text-body">
              <dt className="text-muted">협력업체</dt><dd>{d.vendor.name} <span className="num text-meta text-muted">{bizNo(d.vendor.bizRegNo)}</span> {d.vendor.bizStatus !== 'UNKNOWN' && <Badge tone={BIZ_STATUS[d.vendor.bizStatus].tone}>{BIZ_STATUS[d.vendor.bizStatus].label}</Badge>}</dd>
              <dt className="text-muted">원가항목</dt><dd>{d.costCode.code} {d.costCode.name}</dd>
              <dt className="text-muted">공기</dt><dd className="num">{d.startDate ?? '–'} ~ {d.endDate ?? '–'}</dd>
              <dt className="text-muted">하도급률</dt><dd className="num">{d.subRate ? pct(d.subRate) : '–'} <span className="text-meta text-muted">(원도급 {won(d.projectContract)})</span></dd>
              <dt className="text-muted">유보율</dt><dd className="num">{pct(d.retentionRate)}</dd>
            </dl>
            {d.guaranteeType && <p className="mt-3 flex items-start gap-1.5 rounded-[4px] bg-surface-2 px-2.5 py-2 text-meta"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" /><span>{d.guaranteeType} {d.guaranteeNo} · {won(d.guaranteeAmount)}원 · 만료 {d.guaranteeExpiry ?? '–'}</span></p>}
            {d.scope && <p className="mt-3 whitespace-pre-wrap text-meta text-ink-2">{d.scope}</p>}
            {a && <div className="mt-3 flex justify-end"><StampBox approval={a} /></div>}
          </section>
          <ApprovalHistory history={d.approvalHistory} />
        </aside>
      </div>
      {dialog === 'claim' && <SubClaimDialog sub={{ id: d.id, title: d.title, currentAmount: d.currentAmount, claimed: String(live.reduce((s, c) => s + Number(c.thisAmount), 0)), retentionRate: d.retentionRate, nextNo: live.length + 1 }} onClose={() => setDialog(null)} onDone={(cid) => router.push(`/subcontracts/claims/${cid}`)} />}
      {dialog === 'revise' && <SubReviseDialog sub={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      <ReasonDialog open={dialog === 'cancel'} title="하도급 계약을 취소할까요?" danger confirm="계약 취소" body="기성이 있는 계약은 취소할 수 없습니다. 기록은 남습니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/subcontracts/${d.id}/cancel`, { method: 'POST', json: { reason } }), '취소했습니다')) { setDialog(null); refresh(); } }} />
      {lineNode}
    </>
  );
}
