'use client';

import { useApprovalLine } from '@/components/approval-line';
import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookOpen, ChevronLeft, Lock, Pencil, RotateCcw, Send, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { BankSelect } from '@/components/pickers';
import { Badge, Button, Dialog, EmptyState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { bizNo, dateTime, won } from '@/lib/format';
import { JOURNAL_STATUS, PAY_METHOD, PAYREQ_STATUS, SOURCE_LABEL, TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface Detail extends DocApprovalState {
  id: string; code: string; kind: string; kindLabel: string; title: string; requestDate: string; dueDate: string | null; payeeName: string; memo: string | null;
  supplyAmount: string; vatAmount: string; totalAmount: string; status: string; version: number; createdAt: string; paidAt: string | null;
  project: { id: string; code: string; name: string; tradeType: TradeType } | null;
  vendor: { id: string; name: string; bizRegNo: string | null; bankName: string | null; bankAccountMask: string | null; bankHolder: string | null } | null;
  lines: { id: string; lineNo: number; description: string; accountCode: string | null; accountName: string | null; costCodeName: string | null; sourceType: string | null; sourceCode: string | null; supplyAmount: string; vatAmount: string; vatDeductible: boolean; totalAmount: string }[];
  payments: { id: string; code: string; payDate: string; amount: string; method: string; bankName: string | null; memo: string | null; status: string; cancelReason: string | null; createdAt: string }[];
  journals: { id: string; code: string; status: string; entry_date: string; source_type: string; total_debit: string }[];
}

function PayDialog({ d, open, onClose, onDone }: { d: Detail; open: boolean; onClose: () => void; onDone: () => void }) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [f, setF] = useState({ payDate: today, method: 'TRANSFER', bankAccountId: null as string | null, memo: '' });
  const { run, acting } = useRun(['payreq', 'payreqs', 'journals']);
  return (
    <Dialog open={open} onClose={onClose} title="지급 처리" width={480}
      footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" icon={<Wallet className="size-4" />} loading={acting === 'pay'} onClick={async () => { if (await run('pay', () => api(`/payment-requests/${d.id}/pay`, { method: 'POST', json: { version: d.version, ...f } }), '지급 완료로 처리했습니다')) onDone(); }}>지급 완료 처리</Button></>}>
      <div className="space-y-3">
        <div className="rounded-[4px] bg-surface-2 px-3 py-2.5">
          <p className="text-meta text-muted">{d.payeeName}에게</p>
          <p className="num text-[22px] font-semibold">{won(d.totalAmount)}<span className="ml-0.5 text-meta font-normal text-faint">원</span></p>
          {d.vendor?.bankAccountMask && <p className="num text-meta text-muted">{d.vendor.bankName} {d.vendor.bankAccountMask} {d.vendor.bankHolder && `(${d.vendor.bankHolder})`}</p>}
        </div>
        <p className="text-meta text-muted">실제 이체는 인터넷뱅킹에서 하신 뒤 여기서 지급 완료로 기록하세요. 기록하면 (채무 / 예금) 분개가 자동으로 만들어집니다.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="지급일" required><Input type="date" value={f.payDate} onChange={(e) => setF({ ...f, payDate: e.target.value })} /></Field>
          <Field label="지급 방법"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        <Field label="출금 계좌·카드"><BankSelect value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} /></Field>
        <Field label="메모"><Textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="이체 확인번호 등" /></Field>
      </div>
    </Dialog>
  );
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const q = useQuery({ queryKey: ['payreq', company.id, id], queryFn: () => api<Detail>(`/payment-requests/${id}`), retry: false });
  const { run, acting } = useRun(['payreq', 'payreqs']);
  const [dialog, setDialog] = useState<null | 'pay' | 'cancel' | 'unpay'>(null);
  const [justApproved, setJustApproved] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['payreq', company.id, id] });

  if (q.error) return <EmptyState title="지급결의를 찾을 수 없습니다" description="삭제되었거나 볼 수 있는 권한이 없습니다." action={<Link href="/payment-requests"><Button>목록으로</Button></Link>} />;
  if (!d) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-[520px]" /></div>;

  const a = d.approval;
  const editable = ['DRAFT', 'REJECTED'].includes(d.status) && can('expense:update');
  const stage = d.status === 'DRAFT' || d.status === 'REJECTED' ? 0 : d.status === 'PENDING' ? 1 : d.status === 'APPROVED' ? 2 : 3;
  const activePay = d.payments.find((p) => p.status === 'CONFIRMED');

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/payment-requests" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />지급결의 목록</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
            <span className="num text-muted">{d.code}</span>
            <Badge tone={PAYREQ_STATUS[d.status].tone}>{PAYREQ_STATUS[d.status].label}</Badge>
            <Badge tone="muted">{d.kindLabel}</Badge>
            {d.project && <Link href={`/projects/${d.project.id}`} className="flex items-center gap-1.5 text-muted hover:text-ink"><span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: TRADE[d.project.tradeType].color }} />{d.project.name}</Link>}
          </div>
          <h1 className="text-title font-semibold tracking-[-0.01em]">{d.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} loading={acting === 'recall'} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {(editable || (d.status === 'APPROVED' && can('expense:update'))) && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>결의 취소</Button>}
          {editable && <Link href={`/payment-requests/${d.id}/edit`}><Button icon={<Pencil className="size-3.5" />}>수정</Button></Link>}
          {editable && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={async () => { const line = await pickLine('PAYMENT_REQUEST', d.totalAmount); if (line === null) return; run('submit', () => api(`/payment-requests/${d.id}/submit`, { method: 'POST', json: { version: d.version, approvalLine: line } }), '결재를 올렸습니다').then(refresh); }}>결재 상신</Button>}
          {d.status === 'APPROVED' && can('payment:create') && <Button variant="primary" icon={<Wallet className="size-4" />} onClick={() => setDialog('pay')}>지급 처리</Button>}
          {d.status === 'PAID' && can('payment:approve') && <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setDialog('unpay')}>지급 취소</Button>}
        </div>
      </div>

      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>지급액 <b className="num text-ink">{won(d.totalAmount)}원</b> · {d.payeeName} · {d.kindLabel}</>} onDone={(act) => { refresh(); if (act === 'approve') setJustApproved(true); }} />}
      {justApproved && d.status === 'APPROVED' && <JustApproved approval={a} text="이제 회계 담당이 이체한 뒤 '지급 처리'로 기록하면 됩니다." />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-[6px] bg-surface-2 p-2 sm:p-5">
          {/* 지급결의서 — 종이 양식 */}
          <div className="relative overflow-hidden rounded-[2px] bg-white p-6 text-[12px] leading-[1.5] text-[#17202b] shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_24px_-12px_rgb(16_24_40/0.18)] ring-1 ring-black/5 sm:p-8 [color-scheme:light]">
            {['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED'].includes(d.status) && (
              <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center"><span className="-rotate-[24deg] text-[40px] font-bold text-[#c42b1c]/10 select-none">{d.status === 'CANCELLED' ? '취소' : d.status === 'REJECTED' ? '반려' : '결재 전'}</span></div>
            )}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[24px] font-bold tracking-[0.4em]">지급결의서</h2>
                <p className="num mt-1 text-[11px] text-[#5b6573]">문서번호 {d.code} · 결의일 {d.requestDate.replace(/-/g, '. ')}.</p>
              </div>
              <div className="[&_td]:!border-[#17202b] [&_th]:!border-[#17202b] [&_th]:!bg-[#eef1f4] [&_th]:!text-[#5b6573]"><StampBox approval={a} fallback={[{ title: '담당' }, { title: '검토' }, { title: '승인' }]} /></div>
            </div>
            <table className="mt-5 w-full border-collapse">
              <tbody>
                {[
                  ['받는 분', <b key="p">{d.payeeName}{d.vendor?.bizRegNo && <span className="num ml-2 font-normal text-[#5b6573]">{bizNo(d.vendor.bizRegNo)}</span>}</b>],
                  ['지급 계좌', d.vendor?.bankAccountMask ? <span className="num">{d.vendor.bankName} {d.vendor.bankAccountMask} {d.vendor.bankHolder && `(예금주 ${d.vendor.bankHolder})`}</span> : <span className="text-[#8a93a0]">거래처에 등록된 계좌 없음</span>],
                  ['현장', d.project ? `${d.project.name} (${d.project.code})` : '본사 공통'],
                  ['지급 예정일', d.dueDate ?? '협의'],
                  ['구분', d.kindLabel],
                ].map(([k, v]) => <tr key={k as string}><th scope="row" className="w-[96px] border border-[#c9ced6] bg-[#eef1f4] px-2 py-1 text-left font-normal text-[#5b6573]">{k}</th><td className="border border-[#c9ced6] px-2 py-1">{v}</td></tr>)}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-[1.5px] border-[#17202b] px-3 py-2.5">
              <span className="text-[11px] text-[#5b6573]">지급 합계</span>
              <span className="num ml-auto text-[17px] font-bold">₩{won(d.totalAmount)}</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead><tr className="bg-[#eef1f4] text-[11px]">{['No', '내용', '계정·원가항목', '공급가액', '세액', '합계'].map((h) => <th key={h} className="border border-[#17202b] px-1.5 py-1 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num border border-[#c9ced6] px-1.5 py-1 text-center">{l.lineNo}</td>
                      <td className="border border-[#c9ced6] px-1.5 py-1">{l.description}{l.sourceType && <span className="ml-1 text-[10.5px] text-[#5b6573]">[{SOURCE_LABEL[l.sourceType]} {l.sourceCode}]</span>}</td>
                      <td className="border border-[#c9ced6] px-1.5 py-1">{l.costCodeName ?? (l.accountName ? `${l.accountCode} ${l.accountName}` : l.sourceType ? '외상매입금 정리' : '')}</td>
                      <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{won(l.supplyAmount)}</td>
                      <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{won(l.vatAmount)}{!l.vatDeductible && Number(l.vatAmount) > 0 && <span className="block text-[10px] text-[#8a93a0]">불공제</span>}</td>
                      <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{won(l.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-bold"><td colSpan={3} className="border border-[#17202b] bg-[#eef1f4] px-1.5 py-1 text-center text-[11px]">합계</td><td className="num border border-[#17202b] px-1.5 py-1 text-right">{won(d.supplyAmount)}</td><td className="num border border-[#17202b] px-1.5 py-1 text-right">{won(d.vatAmount)}</td><td className="num border border-[#17202b] px-1.5 py-1 text-right">{won(d.totalAmount)}</td></tr></tfoot>
              </table>
            </div>
            {d.memo && <p className="mt-3 border border-[#c9ced6] px-3 py-2 whitespace-pre-wrap">{d.memo}</p>}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={['작성', '결재', '지급대기', '지급완료']} current={stage} failed={d.status === 'REJECTED'} done={d.status === 'PAID'} />
            {d.status === 'REJECTED' && a && <p className="mt-3 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">반려 사유: {a.steps.find((s) => s.state === 'REJECTED')?.comment}</p>}
            {d.status === 'PENDING' && a && <p className="mt-3 text-meta text-muted">{a.steps.find((s) => s.stepNo === a.currentStep)?.approverNames} 님의 {a.steps.find((s) => s.stepNo === a.currentStep)?.title} 대기 중</p>}
            {d.status === 'CANCELLED' && <p className="mt-3 flex items-center gap-1.5 text-meta text-muted"><Lock className="size-3.5" />취소된 결의입니다. 기록은 보존됩니다.</p>}
            {activePay && <p className="mt-3 text-meta text-ok">{activePay.payDate} {PAY_METHOD[activePay.method]}{activePay.bankName ? ` · ${activePay.bankName}` : ''} 지급 완료 ({activePay.code})</p>}
          </section>

          {d.payments.length > 0 && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-2.5 font-semibold">지급 이력</h2>
              <ul className="divide-y divide-line">
                {d.payments.map((p) => (
                  <li key={p.id} className={clsx('px-4 py-2.5', p.status === 'CANCELLED' && 'text-muted')}>
                    <div className="flex items-center justify-between"><span className="num font-medium">{p.code}</span>{p.status === 'CANCELLED' ? <Badge tone="muted">취소</Badge> : <span className="num">{won(p.amount)}원</span>}</div>
                    <p className="num text-meta text-muted">{p.payDate} · {PAY_METHOD[p.method]}{p.bankName ? ` · ${p.bankName}` : ''}</p>
                    {p.cancelReason && <p className="text-meta text-muted">취소 사유: {p.cancelReason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.journals.length > 0 && can('journal:read') && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 font-semibold"><BookOpen className="size-4 text-muted" />연결된 전표</h2>
              <ul className="divide-y divide-line">
                {d.journals.map((j) => (
                  <li key={j.id}><Link href={`/journals/${j.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-surface-hover"><span><span className="num">{j.code}</span> <span className="text-meta text-muted">{SOURCE_LABEL[j.source_type]} · {j.entry_date}</span></span><Badge tone={JOURNAL_STATUS[j.status].tone}>{JOURNAL_STATUS[j.status].label}</Badge></Link></li>
                ))}
              </ul>
            </section>
          )}
          <ApprovalHistory history={d.approvalHistory} />
          <p className="px-1 text-meta text-faint">작성 {dateTime(d.createdAt)}</p>
        </aside>
      </div>

      {dialog === 'pay' && <PayDialog d={d} open onClose={() => setDialog(null)} onDone={() => (setDialog(null), refresh())} />}
      <ReasonDialog open={dialog === 'cancel'} title="지급결의를 취소할까요?" danger confirm="결의 취소" body={<>{d.code}를 취소합니다. 기록은 남고, 포함된 검수 내역은 다른 결의에 다시 넣을 수 있게 됩니다.{d.status === 'APPROVED' && ' 승인 때 만든 분개는 역분개됩니다.'}</>} onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/payment-requests/${d.id}/cancel`, { method: 'POST', json: { version: d.version, reason } }), '취소했습니다')) { setDialog(null); refresh(); } }} />
      <ReasonDialog open={dialog === 'unpay'} title="지급을 취소할까요?" danger confirm="지급 취소" body="이체가 실패했거나 잘못 기록한 경우에 씁니다. 지급 분개는 역분개되고 결의는 '지급대기'로 돌아갑니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('unpay', () => api(`/payment-requests/${d.id}/cancel-payment`, { method: 'POST', json: { reason } }), '지급을 취소했습니다')) { setDialog(null); refresh(); } }} />
      {lineNode}
    </>
  );
}
