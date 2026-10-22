'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookOpen, ChevronLeft, FileDown, Receipt, RotateCcw, Send, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { CollectDialog } from '@/components/construction-bits';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { Badge, Button, EmptyState, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, blobUrl } from '@/lib/api';
import { pct, won } from '@/lib/format';
import { CLAIM_STATUS, COLLECTION_KIND, JOURNAL_STATUS, NTS_STATUS, TI_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface D extends DocApprovalState {
  id: string; code: string; projectId: string; claimNo: number; claimDate: string; periodFrom: string | null; periodTo: string | null; dueDate: string | null; isFinal: boolean;
  contractSupply: string; contractOriginal: string; prevCumulative: string; thisSupply: string; cumulative: string; progressRate: string; vatRate: string; vatAmount: string;
  advanceDeduction: string; retentionRate: string; retentionAmount: string; receivableAmount: string; status: string; version: number; memo: string | null;
  project: { id: string; code: string; name: string }; vendor: { id: string; name: string; bizRegNo: string | null };
  lines: { id: string; lineNo: number; name: string; spec: string | null; contractAmount: string; prevAmount: string; thisAmount: string; cumulativeAmount: string }[];
  collections: { id: string; code: string; collectDate: string; amount: string; kind: string; method: string; bankName: string | null; status: string; cancelReason: string | null }[];
  collected: string; outstanding: string;
  invoices: { id: string; code: string; status: string; approvalNo: string | null; ntsStatus: string | null; totalAmount: string; writeDate: string; isTestIssue: boolean }[];
  journals: { id: string; code: string; status: string; entry_date: string }[];
}
const RECOGNIZED = ['APPROVED', 'INVOICED', 'PARTIAL', 'COLLECTED'];

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['claim', company.id, id], queryFn: () => api<D>(`/progress-claims/${id}`), retry: false });
  const { run, acting } = useRun(['claims', 'collections']);
  const [dialog, setDialog] = useState<null | 'cancel' | 'collect' | { cancelCol: string }>(null);
  const [just, setJust] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['claim', company.id, id] });
  if (q.error) return <EmptyState title="기성을 찾을 수 없습니다" action={<Link href="/claims"><Button>목록으로</Button></Link>} />;
  if (!d) return <Skeleton className="h-[520px]" />;
  const a = d.approval;
  const recognized = RECOGNIZED.includes(d.status);
  const inv = d.invoices.find((t) => t.status !== 'CANCELLED');
  const stage = d.status === 'DRAFT' || d.status === 'REJECTED' ? 0 : d.status === 'PENDING' ? 1 : d.status === 'APPROVED' ? 2 : d.status === 'INVOICED' || d.status === 'PARTIAL' ? 3 : 4;
  const openPdf = async () => {
    try {
      const { url } = await blobUrl(`/progress-claims/${id}/pdf`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : 'PDF를 만들지 못했습니다');
    }
  };
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/claims?projectId=${d.projectId}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />기성청구</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta"><span className="num text-muted">{d.code}</span><Badge tone={CLAIM_STATUS[d.status].tone}>{CLAIM_STATUS[d.status].label}</Badge><span className="text-muted">{d.vendor.name}</span></div>
          <h1 className="text-title font-semibold">{d.project.name} · {d.isFinal ? '준공' : `제 ${d.claimNo} 회`} 기성 <span className="num font-normal text-muted">{won(d.thisSupply)}원</span></h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} loading={acting === 'recall'} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {can('claim:export') && <Button icon={<FileDown className="size-3.5" />} onClick={openPdf}>기성청구서 PDF</Button>}
          {d.status !== 'CANCELLED' && d.status !== 'PENDING' && can('claim:update') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>취소</Button>}
          {['DRAFT', 'REJECTED'].includes(d.status) && can('claim:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={() => run('submit', () => api(`/progress-claims/${d.id}/submit`, { method: 'POST', json: { version: d.version } }), '대표 결재를 올렸습니다').then(refresh)}>결재 상신</Button>}
          {recognized && !inv && can('taxinvoice:create') && <Button variant="primary" icon={<Receipt className="size-3.5" />} loading={acting === 'inv'} onClick={async () => { const r = await run('inv', () => api<{ id: string }>(`/progress-claims/${d.id}/tax-invoice`, { method: 'POST' }), '매출 세금계산서 초안을 만들었습니다'); if (r && typeof r === 'object') router.push(`/tax-invoices/${(r as { id: string }).id}`); }}>세금계산서 만들기</Button>}
          {recognized && Number(d.outstanding) > 0 && can('payment:create') && <Button variant="primary" icon={<Wallet className="size-3.5" />} onClick={() => setDialog('collect')}>수금 기록</Button>}
        </div>
      </div>
      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>금회 기성 <b className="num">{won(d.thisSupply)}원</b> · 누적 {pct(d.progressRate)} · 청구액 {won(d.receivableAmount)}원</>} onDone={(act) => { refresh(); if (act === 'approve') setJust(true); }} />}
      {just && d.status === 'APPROVED' && <JustApproved approval={a} text="매출로 인식했습니다. 세금계산서를 만들어 발행하고, 입금되면 수금을 기록하세요." />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['확정 계약금액', d.contractSupply], ['전회 누적', d.prevCumulative], ['금회 기성', d.thisSupply, true], ['누적 기성', d.cumulative], ['잔여 계약', String(Number(d.contractSupply) - Number(d.cumulative))], ['기성률', null],
            ].map(([k, v, strong]) => (
              <div key={k as string} className="border-line px-4 py-3 not-last:border-r max-lg:border-b">
                <p className="text-meta text-muted">{k}</p>
                <p className={clsx('num mt-0.5 text-[17px]', strong && 'font-semibold')}>{v === null ? pct(d.progressRate) : won(v as string)}</p>
              </div>
            ))}
          </section>
          {d.lines.length > 0 && (
            <section className="overflow-x-auto rounded-[6px] border border-line bg-surface">
              <table className="w-full min-w-[640px]">
                <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">공종·내역</th><th className="px-3 py-2 text-right font-medium">계약금액</th><th className="px-3 py-2 text-right font-medium">전회 누적</th><th className="px-3 py-2 text-right font-medium">금회</th><th className="px-3 py-2 text-right font-medium">누적</th><th className="px-3 py-2 text-right font-medium">누적률</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.lines.map((l) => <tr key={l.id}><td className="px-3 py-2">{l.name}{l.spec && <span className="text-meta text-muted"> · {l.spec}</span>}</td><td className="num px-3 py-2 text-right">{won(l.contractAmount)}</td><td className="num px-3 py-2 text-right text-muted">{won(l.prevAmount)}</td><td className="num px-3 py-2 text-right font-medium">{won(l.thisAmount)}</td><td className="num px-3 py-2 text-right">{won(l.cumulativeAmount)}</td><td className="num px-3 py-2 text-right text-muted">{Number(l.contractAmount) ? pct(Number(l.cumulativeAmount) / Number(l.contractAmount)) : '–'}</td></tr>)}
                </tbody>
              </table>
            </section>
          )}
          <section className="rounded-[6px] border border-line bg-surface">
            <h2 className="flex items-center justify-between border-b border-line px-4 py-2.5 font-semibold">수금 내역 <span className="text-meta font-normal text-muted">수금 {won(d.collected)} / 청구 {won(d.receivableAmount)}</span></h2>
            {!d.collections.length ? <p className="px-4 py-3 text-meta text-muted">{recognized ? '아직 입금이 없습니다.' : '승인된 기성만 수금을 기록할 수 있습니다.'}</p> : (
              <ul className="divide-y divide-line">
                {d.collections.map((c) => (
                  <li key={c.id} className={clsx('flex items-center gap-3 px-4 py-2', c.status === 'CANCELLED' && 'text-muted line-through decoration-faint')}>
                    <span className="num text-meta text-muted">{c.code}</span><span className="num">{c.collectDate}</span><span className="text-meta text-muted">{COLLECTION_KIND[c.kind]} · {c.bankName ?? '계좌 미지정'}</span>
                    <span className="num ml-auto font-medium">{won(c.amount)}</span>
                    {c.status === 'CONFIRMED' && can('payment:approve') && <Button size="sm" icon={<RotateCcw className="size-3" />} onClick={() => setDialog({ cancelCol: c.id })}>취소</Button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={['작성', '결재', '매출인식', '계산서', '수금']} current={stage} failed={d.status === 'REJECTED' || d.status === 'CANCELLED'} done={d.status === 'COLLECTED'} />
            <dl className="mt-4 space-y-1 text-body">
              <div className="flex justify-between"><dt className="text-muted">금회 공급가액</dt><dd className="num">{won(d.thisSupply)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">부가세</dt><dd className="num">{won(d.vatAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">선급금 공제</dt><dd className="num">△ {won(d.advanceDeduction)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">유보금 ({pct(d.retentionRate)})</dt><dd className="num">△ {won(d.retentionAmount)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><dt>청구액</dt><dd className="num">{won(d.receivableAmount)}</dd></div>
              <div className="flex justify-between text-ok"><dt>수금</dt><dd className="num">{won(d.collected)}</dd></div>
              <div className={clsx('flex justify-between font-semibold', Number(d.outstanding) > 0 ? 'text-seal' : 'text-muted')}><dt>미수금</dt><dd className="num">{won(d.outstanding)}</dd></div>
            </dl>
            {d.dueDate && <p className="num mt-2 text-meta text-muted">수금예정일 {d.dueDate}</p>}
            {a && <div className="mt-3 flex justify-end"><StampBox approval={a} /></div>}
          </section>
          {d.invoices.length > 0 && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-2.5 font-semibold">매출 세금계산서</h2>
              <ul className="divide-y divide-line">{d.invoices.map((t) => <li key={t.id}><Link href={`/tax-invoices/${t.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-surface-hover"><span className="num">{t.code} <span className="text-meta text-muted">{t.writeDate}</span></span><span className="flex gap-1"><Badge tone={TI_STATUS[t.status].tone}>{t.isTestIssue ? '가상 발행' : TI_STATUS[t.status].label}</Badge>{t.status === 'ISSUED' && !t.isTestIssue && t.ntsStatus && <Badge tone={NTS_STATUS[t.ntsStatus].tone}>{NTS_STATUS[t.ntsStatus].label.replace('국세청 ', '')}</Badge>}</span></Link></li>)}</ul>
              <p className="px-4 pb-3 text-meta text-faint">매출은 기성 승인 때 인식했으므로 계산서 발행 시에는 부가세만 장부에 반영됩니다.</p>
            </section>
          )}
          {d.journals.length > 0 && can('journal:read') && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 font-semibold"><BookOpen className="size-4 text-muted" />매출 인식 전표</h2>
              <ul className="divide-y divide-line">{d.journals.map((j) => <li key={j.id}><Link href={`/journals/${j.id}`} className="flex justify-between px-4 py-2 hover:bg-surface-hover"><span className="num">{j.code} <span className="text-meta text-muted">{j.entry_date}</span></span><Badge tone={JOURNAL_STATUS[j.status].tone}>{JOURNAL_STATUS[j.status].label}</Badge></Link></li>)}</ul>
            </section>
          )}
          <ApprovalHistory history={d.approvalHistory} />
        </aside>
      </div>
      {dialog === 'collect' && <CollectDialog open claim={{ id: d.id, code: d.code, claimNo: d.claimNo, outstanding: d.outstanding }} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); qc.invalidateQueries({ queryKey: ['claims'] }); }} />}
      <ReasonDialog open={dialog === 'cancel'} title="기성을 취소할까요?" danger confirm="기성 취소" body={recognized ? '승인된 기성을 취소하면 매출 인식 분개를 역분개합니다. 세금계산서·수금이 있으면 먼저 정리해야 하고, 마지막 회차만 취소할 수 있습니다.' : '작성 기록은 남습니다.'} onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/progress-claims/${d.id}/cancel`, { method: 'POST', json: { reason } }), '취소했습니다')) { setDialog(null); refresh(); } }} />
      <ReasonDialog open={typeof dialog === 'object' && dialog !== null} title="수금을 취소할까요?" danger confirm="수금 취소" body="잘못 기록한 입금을 되돌립니다. 분개는 역분개되고 미수금이 다시 늘어납니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (typeof dialog === 'object' && dialog && await run('cc', () => api(`/collections/${dialog.cancelCol}/cancel`, { method: 'POST', json: { reason } }), '수금을 취소했습니다')) { setDialog(null); refresh(); } }} />
    </>
  );
}
