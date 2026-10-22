'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BookOpen, Building2, ChevronLeft, CircleCheck, EyeOff, Link2, Pencil, RefreshCw, RotateCcw, Send, ShieldAlert, Sparkles, TriangleAlert, Undo2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApprovalActionPanel, ApprovalHistory, JustApproved, Progress, ReasonDialog, StampBox, useRun } from '@/components/doc-ui';
import { AccountPicker, CostCodeSelect, ProjectPicker, VendorPicker } from '@/components/pickers';
import { TaxInvoicePaper, type TiLine } from '@/components/tax-bits';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { bizNo, dateTime, won } from '@/lib/format';
import { JOURNAL_STATUS, NTS_STATUS, PAYREQ_STATUS, TI_SOURCE, TI_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { DocApprovalState } from '@/lib/types';

interface Detail extends DocApprovalState {
  id: string; code: string; direction: 'SALES' | 'PURCHASE'; docKind: string; status: string; statusLabel: string; version: number; approvalNo: string | null; writeDate: string; issueDate: string | null; sendDate: string | null; purpose: string;
  supplierBizNo: string | null; supplierName: string | null; supplierCeo: string | null; supplierAddress: string | null; supplierBizType: string | null; supplierBizItem: string | null; supplierEmail: string | null;
  buyerBizNo: string | null; buyerName: string | null; buyerCeo: string | null; buyerAddress: string | null; buyerBizType: string | null; buyerBizItem: string | null; buyerEmail: string | null;
  supplyAmount: string; vatAmount: string; totalAmount: string; remark: string | null; source: string; provider: string | null; providerMode: string | null; ntsStatus: string | null; ntsMessage: string | null;
  matchedSupply: string | null; matchDiff: string | null; matchNote: string | null; accountId: string | null; costCodeId: string | null; vatDeductible: boolean; ignoredReason: string | null; projectId: string | null;
  isTestIssue: boolean; counterpartName: string | null; createdAt: string;
  vendor: { id: string; name: string; bizRegNo: string | null } | null;
  project: { id: string; code: string; name: string } | null;
  lines: TiLine[];
  matches: { id: string; sourceId: string; supplyAmount: string; vatAmount: string; code: string; receiptDate: string; receiptSupply: string; poId: string; poCode: string; poTitle: string; projectName: string }[];
  journals: { id: string; code: string; status: string; entry_date: string; total_debit: string }[];
  paymentRequests: { id: string; code: string; status: string }[];
}
interface Cand { id: string; code: string; receipt_date: string; supply: string; vat: string; po_id: string; po_code: string; po_title: string; project_name: string; used: string; remaining: string }

function MatchPanel({ d, onChange }: { d: Detail; onChange: () => void }) {
  const { company } = useSession();
  const cands = useQuery({ queryKey: ['ti-cands', company.id, d.id], queryFn: () => api<Cand[]>(`/tax-invoices/${d.id}/candidates`), enabled: d.status === 'COLLECTED' && !!d.vendor });
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => setSel(new Set(d.matches.map((m) => m.sourceId))), [d.matches]);
  const { run, acting } = useRun(['tax-invoices']);
  const all = useMemo(() => {
    const m = new Map<string, { id: string; code: string; date: string; po: string; title: string; project: string; amount: string }>();
    for (const x of d.matches) m.set(x.sourceId, { id: x.sourceId, code: x.code, date: x.receiptDate, po: x.poCode, title: x.poTitle, project: x.projectName, amount: x.supplyAmount });
    for (const c of cands.data ?? []) if (!m.has(c.id)) m.set(c.id, { id: c.id, code: c.code, date: c.receipt_date, po: c.po_code, title: c.po_title, project: c.project_name, amount: c.remaining });
    return [...m.values()];
  }, [d.matches, cands.data]);
  const selSum = all.filter((a) => sel.has(a.id)).reduce((s, a) => s + Number(a.amount), 0);
  const diff = Number(d.supplyAmount) - selSum;
  const locked = d.status !== 'COLLECTED';
  const changed = sel.size !== d.matches.length || d.matches.some((m) => !sel.has(m.sourceId));

  if (!d.vendor) return null;
  return (
    <section className="rounded-[6px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 font-semibold"><Link2 className="size-4 text-muted" />검수 내역과 맞추기</h2>
        {!locked && all.length > 0 && <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={acting === 'auto'} onClick={() => run('auto', () => api<{ exact: boolean }>(`/tax-invoices/${d.id}/auto-match`, { method: 'POST', json: { version: d.version } }).then((r) => r), '맞는 검수를 찾아 연결했습니다').then(onChange)}>자동 맞추기</Button>}
      </div>
      {all.length === 0 ? (
        <p className="px-4 py-3 text-meta text-muted">{locked ? '검수와 연결하지 않고 경비로 처리했습니다.' : `${d.vendor.name}의 연결할 검수 내역이 없습니다. 자재 대금이 아니라면 아래에서 비용 계정을 골라 경비로 처리하세요.`}</p>
      ) : (
        <>
          <ul className="max-h-[300px] divide-y divide-line overflow-auto">
            {all.map((a) => (
              <li key={a.id} className={clsx('flex items-start gap-2.5 px-4 py-2', locked && !sel.has(a.id) && 'hidden')}>
                {!locked && <Checkbox checked={sel.has(a.id)} onChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(a.id); else n.delete(a.id); return n; })} />}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2"><Link href={`/purchase-orders/${d.matches.find((m) => m.sourceId === a.id)?.poId ?? cands.data?.find((c) => c.id === a.id)?.po_id}`} className="truncate hover:underline">{a.title}</Link><span className="num shrink-0">{won(a.amount)}</span></p>
                  <p className="num truncate text-meta text-muted">{a.code} · {a.date} · {a.po} · {a.project}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-line px-4 py-2.5 text-meta">
            <p className="flex justify-between"><span className="text-muted">계산서 공급가액</span><span className="num">{won(d.supplyAmount)}</span></p>
            <p className="flex justify-between"><span className="text-muted">선택한 검수 금액</span><span className="num">{won(String(selSum))}</span></p>
            <p className={clsx('flex justify-between font-semibold', sel.size === 0 ? 'text-muted' : diff === 0 ? 'text-ok' : 'text-seal')}>
              <span>{sel.size === 0 ? '연결 안 함' : diff === 0 ? '금액 일치' : '차이'}</span>{sel.size > 0 && diff !== 0 && <span className="num">{diff > 0 ? '+' : ''}{won(String(diff))}</span>}
            </p>
            {d.matchNote && <p className="text-muted">차이 사유: {d.matchNote}</p>}
          </div>
          {!locked && changed && (
            <div className="border-t border-line px-4 py-2.5">
              <Button variant="primary" className="w-full" loading={acting === 'match'} onClick={() => run('match', () => api(`/tax-invoices/${d.id}/match`, { method: 'POST', json: { version: d.version, links: [...sel].map((receiptId) => ({ receiptId })) } }), sel.size ? '검수와 연결했습니다' : '연결을 풀었습니다').then(onChange)}>{sel.size ? `검수 ${sel.size}건 연결` : '연결 해제'}</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PostPanel({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [f, setF] = useState({ accountId: d.accountId, costCodeId: d.costCodeId, projectId: d.projectId, vatDeductible: true, matchNote: d.matchNote ?? '' });
  const { run, acting } = useRun(['tax-invoices', 'journals']);
  const matched = d.matches.length > 0;
  const diff = Number(d.matchDiff ?? 0);
  return (
    <section className="rounded-[6px] border-2 border-steel bg-surface p-4">
      <h2 className="font-semibold">장부에 반영 (처리)</h2>
      <p className="mt-0.5 text-meta text-muted">{matched ? '공급가액은 검수 때 원가로 잡혔으므로 세액(과 차액)만 외상매입금에 더합니다.' : '검수와 무관한 계산서입니다. 비용 계정을 고르면 (비용·부가세대급금 / 미지급금)으로 분개합니다.'}</p>
      <div className="mt-3 space-y-3">
        {!matched && (
          <>
            <Field label="비용 계정" required><AccountPicker value={f.accountId} onChange={(a) => setF({ ...f, accountId: a?.id ?? null })} filter={(a) => a.type === 'EXPENSE' || a.category === 'NONCURRENT_ASSET'} /></Field>
            <Field label="원가항목" hint="공사원가 계정일 때 실행예산과 비교됩니다"><CostCodeSelect value={f.costCodeId} onChange={(v) => setF({ ...f, costCodeId: v })} /></Field>
          </>
        )}
        <Field label="현장"><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
        {matched && diff !== 0 && <Field label="금액 차이 사유" required hint={`검수보다 ${won(String(Math.abs(diff)))}원 ${diff > 0 ? '많습니다' : '적습니다'}`}><Textarea rows={2} value={f.matchNote} onChange={(e) => setF({ ...f, matchNote: e.target.value })} placeholder="예: 운반비 별도 청구, 단가 인상분" /></Field>}
        {d.docKind === 'TAX' && Number(d.vatAmount) > 0 && <Checkbox checked={f.vatDeductible} onChange={(v) => setF({ ...f, vatDeductible: v })} label="매입세액 공제 (접대비·비영업용 승용차 등은 해제)" />}
        <Button variant="primary" className="w-full" icon={<CircleCheck className="size-4" />} loading={acting === 'post'}
          onClick={() => run('post', () => api(`/tax-invoices/${d.id}/post`, { method: 'POST', json: { version: d.version, ...f, matchNote: f.matchNote || null } }), '장부에 반영했습니다').then(onDone)}>처리 (분개 만들기)</Button>
      </div>
    </section>
  );
}

function IssueDialog({ d, open, onClose, onDone }: { d: Detail; open: boolean; onClose: () => void; onDone: () => void }) {
  const st = useQuery({ queryKey: ['integrations-status'], queryFn: () => api<Record<string, { provider: string; mode: string; enabled: boolean; label: string; testOnly: boolean } | null>>('/integrations/status'), enabled: open });
  const cfg = st.data?.TAX_ISSUE;
  const live = !!cfg && cfg.mode === 'LIVE' && !cfg.testOnly;
  const [confirm, setConfirm] = useState('');
  const { run, acting } = useRun(['tax-invoices', 'journals']);
  return (
    <Dialog open={open} onClose={onClose} title="세금계산서 발행" tone={live ? 'danger' : undefined} width={500}
      footer={<><Button onClick={onClose}>취소</Button><Button variant={live ? 'danger' : 'primary'} icon={<Send className="size-3.5" />} loading={acting === 'issue'} disabled={!cfg?.enabled || (live && confirm !== d.buyerName)}
        onClick={async () => { if (await run('issue', () => api(`/tax-invoices/${d.id}/issue`, { method: 'POST', json: { version: d.version, confirm } }), live ? '발행했습니다' : '가상 발행했습니다 (효력 없음)')) onDone(); }}>{live ? '국세청으로 발행' : '가상 발행'}</Button></>}>
      {!cfg?.enabled ? <p className="text-seal">발행 연동이 꺼져 있습니다. 관리 › 외부 연동에서 설정하세요.</p> : (
        <div className="space-y-3">
          <div className={clsx('rounded-[4px] px-3 py-2.5', live ? 'bg-seal-soft text-seal' : 'bg-warn-soft text-ink-2')}>
            <p className="flex items-center gap-1.5 font-medium"><ShieldAlert className="size-4" />{live ? '실제 발행 — 국세청에 전송되며 법적 효력이 있습니다' : '테스트(가상) 발행 — 국세청에 보내지 않습니다'}</p>
            <p className="mt-0.5 text-meta">{cfg.label} · {cfg.mode === 'LIVE' ? '운영' : '테스트'} 모드{live ? '. 발행 후에는 국세청 전송 전까지만 취소할 수 있습니다.' : '. 화면과 출력물에 "가상 발행"으로 표시되고 장부에도 반영되지 않습니다.'}</p>
          </div>
          <dl className="grid grid-cols-[96px_1fr] gap-y-1 text-meta">
            <dt className="text-muted">공급받는자</dt><dd>{d.buyerName} <span className="num text-muted">{bizNo(d.buyerBizNo)}</span></dd>
            <dt className="text-muted">작성일자</dt><dd className="num">{d.writeDate}</dd>
            <dt className="text-muted">합계금액</dt><dd className="num font-semibold">{won(d.totalAmount)}원</dd>
          </dl>
          {live && <Field label={`확인을 위해 공급받는자 상호 '${d.buyerName}'을(를) 그대로 입력하세요`} required><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field>}
        </div>
      )}
    </Dialog>
  );
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['tax-invoice', company.id, id], queryFn: () => api<Detail>(`/tax-invoices/${id}`), retry: false });
  const { run, acting } = useRun(['tax-invoices', 'journals']);
  const [dialog, setDialog] = useState<null | 'ignore' | 'unpost' | 'cancel' | 'issue' | 'vendor'>(null);
  const [vendorPick, setVendorPick] = useState<{ id: string; name: string } | null>(null);
  const [justApproved, setJustApproved] = useState(false);
  const d = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tax-invoice', company.id, id] });
    qc.invalidateQueries({ queryKey: ['ti-cands', company.id, id] });
  };

  if (q.error) return <EmptyState title="세금계산서를 찾을 수 없습니다" description="삭제되었거나 볼 수 있는 권한이 없습니다." action={<Link href="/tax-invoices"><Button>목록으로</Button></Link>} />;
  if (!d) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-[520px]" /></div>;

  const sales = d.direction === 'SALES';
  const a = d.approval;
  const party = (p: 'supplier' | 'buyer') => ({ bizNo: d[`${p}BizNo`], name: d[`${p}Name`], ceo: d[`${p}Ceo`], address: d[`${p}Address`], bizType: d[`${p}BizType`], bizItem: d[`${p}BizItem`], email: d[`${p}Email`] });
  const watermark = d.status === 'CANCELLED' ? '취소' : d.isTestIssue ? '가상 발행 · 효력 없음' : sales && !['ISSUED'].includes(d.status) ? '발행 전' : d.status === 'IGNORED' ? '처리 제외' : null;
  const stage = sales ? ({ DRAFT: 0, PENDING: 1, READY: 2, FAILED: 2, ISSUED: d.ntsStatus === 'SENT' ? 4 : 3, CANCELLED: 0 } as Record<string, number>)[d.status] : d.status === 'COLLECTED' ? (d.matches.length ? 1 : 0) : 2;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href={`/tax-invoices${sales ? '?direction=SALES' : ''}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />{sales ? '매출' : '매입'} 세금계산서</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
            <span className="num text-muted">{d.code}</span>
            <Badge tone={TI_STATUS[d.status].tone}>{d.isTestIssue && d.status === 'ISSUED' ? '가상 발행' : TI_STATUS[d.status].label}</Badge>
            {sales && d.status === 'ISSUED' && !d.isTestIssue && d.ntsStatus && <Badge tone={NTS_STATUS[d.ntsStatus].tone}>{NTS_STATUS[d.ntsStatus].label}</Badge>}
            <span className="text-muted">{TI_SOURCE[d.source] ?? d.source}</span>
            {d.project && <Link href={`/projects/${d.project.id}`} className="text-muted hover:text-ink">· {d.project.name}</Link>}
          </div>
          <h1 className="text-title font-semibold tracking-[-0.01em]">{d.counterpartName} <span className="num font-normal text-muted">{won(d.totalAmount)}원</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {d.canRecall && <Button icon={<Undo2 className="size-3.5" />} loading={acting === 'recall'} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다').then(refresh)}>결재 회수</Button>}
          {!sales && d.status === 'COLLECTED' && can('taxinvoice:update') && <Button icon={<EyeOff className="size-3.5" />} onClick={() => setDialog('ignore')}>처리 제외</Button>}
          {!sales && d.status === 'IGNORED' && can('taxinvoice:update') && <Button icon={<RotateCcw className="size-3.5" />} loading={acting === 'restore'} onClick={() => run('restore', () => api(`/tax-invoices/${d.id}/restore`, { method: 'POST' }), '처리 대상으로 되돌렸습니다').then(refresh)}>제외 취소</Button>}
          {!sales && d.status === 'POSTED' && can('taxinvoice:approve') && <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setDialog('unpost')}>처리 취소</Button>}
          {!sales && d.status === 'POSTED' && d.matches.length === 0 && d.paymentRequests.length === 0 && can('expense:create') && <Link href={`/payment-requests/new?source=TAX_INVOICE&id=${d.id}`}><Button variant="primary" icon={<Wallet className="size-3.5" />}>지급결의 작성</Button></Link>}
          {sales && ['DRAFT', 'READY', 'FAILED'].includes(d.status) && can('taxinvoice:approve') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>취소</Button>}
          {sales && d.status === 'ISSUED' && d.ntsStatus !== 'SENT' && can('taxinvoice:approve') && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>발행 취소</Button>}
          {sales && d.status === 'ISSUED' && <Button icon={<RefreshCw className="size-3.5" />} loading={acting === 'refresh'} onClick={() => run('refresh', () => api(`/tax-invoices/${d.id}/refresh`, { method: 'POST' }), '전송 상태를 새로 확인했습니다').then(refresh)}>전송상태 확인</Button>}
          {sales && d.status === 'DRAFT' && can('taxinvoice:update') && <Link href={`/tax-invoices/${d.id}/edit`}><Button icon={<Pencil className="size-3.5" />}>수정</Button></Link>}
          {sales && d.status === 'DRAFT' && can('taxinvoice:create') && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={() => run('submit', () => api(`/tax-invoices/${d.id}/submit`, { method: 'POST', json: { version: d.version } }), '발행 결재를 올렸습니다').then(refresh)}>발행 결재 올리기</Button>}
          {sales && ['READY', 'FAILED'].includes(d.status) && can('taxinvoice:approve') && <Button variant="primary" icon={<Send className="size-3.5" />} onClick={() => setDialog('issue')}>{d.status === 'FAILED' ? '다시 발행' : '발행'}</Button>}
        </div>
      </div>

      {d.canAct && a && <ApprovalActionPanel approval={a} summary={<>합계 <b className="num text-ink">{won(d.totalAmount)}원</b> · {d.buyerName}</>} onDone={(act) => { refresh(); if (act === 'approve') setJustApproved(true); }} />}
      {justApproved && d.status === 'READY' && <JustApproved approval={a} text="이제 '발행'을 누르면 연동사로 보냅니다." />}
      {d.status === 'FAILED' && d.ntsMessage && <p className="mb-4 flex items-start gap-2 rounded-[6px] border border-seal/40 bg-seal-soft px-4 py-2.5 text-seal"><TriangleAlert className="mt-0.5 size-4 shrink-0" />발행하지 못했습니다: {d.ntsMessage}</p>}
      {d.isTestIssue && <p className="mb-4 flex items-start gap-2 rounded-[6px] border border-warn/50 bg-warn-soft px-4 py-2.5 text-ink-2"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />테스트 모드로 만든 가상 발행입니다. 국세청에 전송되지 않았고 법적 효력이 없으며 장부에도 반영하지 않았습니다.</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="rounded-[6px] bg-surface-2 p-2 sm:p-5">
            <TaxInvoicePaper d={{ ...d, supplier: party('supplier'), buyer: party('buyer'), watermark } as never} />
          </div>
          {sales && a && <div className="flex justify-end"><StampBox approval={a} /></div>}
        </div>

        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <Progress steps={sales ? ['작성', '결재', '발행대기', '발행', '국세청'] : ['수집', '검수 대사', '처리']} current={stage} failed={d.status === 'FAILED' || d.status === 'CANCELLED'} done={sales ? d.ntsStatus === 'SENT' : d.status === 'POSTED'} />
            {d.status === 'IGNORED' && <p className="mt-3 text-meta text-muted">처리 제외: {d.ignoredReason}</p>}
            {!sales && d.status === 'POSTED' && <p className="mt-3 text-meta text-muted">장부 반영 완료. 지급은 지급결의로 따로 처리합니다{d.matches.length ? ' (검수 내역 기준 자재대금 결의)' : ''}.</p>}
          </section>

          {!d.vendor && (
            <section className="rounded-[6px] border border-warn/60 bg-warn-soft/40 p-4">
              <h2 className="flex items-center gap-1.5 font-semibold"><Building2 className="size-4" />거래처로 등록되지 않은 사업자</h2>
              <p className="mt-0.5 text-meta text-muted"><span className="num">{bizNo(sales ? d.buyerBizNo : d.supplierBizNo)}</span> {d.counterpartName} — 처리하려면 거래처와 연결해야 합니다.</p>
              {can('taxinvoice:update') && (
                <div className="mt-3 space-y-2">
                  <Button variant="primary" className="w-full" loading={acting === 'vcreate'} onClick={() => run('vcreate', () => api(`/tax-invoices/${d.id}/vendor`, { method: 'POST', json: { create: true } }), '계산서 정보로 거래처를 등록했습니다').then(refresh)}>이 정보로 거래처 등록</Button>
                  <div className="flex gap-2"><VendorPicker className="flex-1" value={vendorPick?.id ?? null} display={vendorPick?.name} onChange={setVendorPick} placeholder="기존 거래처와 연결" />
                    <Button disabled={!vendorPick} loading={acting === 'vlink'} onClick={() => run('vlink', () => api(`/tax-invoices/${d.id}/vendor`, { method: 'POST', json: { vendorId: vendorPick!.id } }), '연결했습니다').then(refresh)}>연결</Button></div>
                </div>
              )}
            </section>
          )}

          {!sales && <MatchPanel d={d} onChange={refresh} />}
          {!sales && d.status === 'COLLECTED' && d.vendor && can('taxinvoice:approve') && <PostPanel d={d} onDone={refresh} />}

          {(d.journals.length > 0 || d.paymentRequests.length > 0) && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 font-semibold"><BookOpen className="size-4 text-muted" />연결된 문서</h2>
              <ul className="divide-y divide-line">
                {can('journal:read') && d.journals.map((j) => <li key={j.id}><Link href={`/journals/${j.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-surface-hover"><span><span className="num">{j.code}</span> <span className="text-meta text-muted">전표 · {j.entry_date}</span></span><Badge tone={JOURNAL_STATUS[j.status].tone}>{JOURNAL_STATUS[j.status].label}</Badge></Link></li>)}
                {d.paymentRequests.map((p) => <li key={p.id}><Link href={`/payment-requests/${p.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-surface-hover"><span><span className="num">{p.code}</span> <span className="text-meta text-muted">지급결의</span></span><Badge tone={PAYREQ_STATUS[p.status].tone}>{PAYREQ_STATUS[p.status].label}</Badge></Link></li>)}
              </ul>
            </section>
          )}
          {sales && <ApprovalHistory history={d.approvalHistory} />}
          <p className="px-1 text-meta text-faint">등록 {dateTime(d.createdAt)}{d.provider ? ` · ${d.provider}` : ''}</p>
        </aside>
      </div>

      <ReasonDialog open={dialog === 'ignore'} title="처리 대상에서 제외할까요?" confirm="제외" body="회사 업무와 무관하거나 다른 경로로 이미 처리한 계산서에 씁니다. 언제든 되돌릴 수 있습니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('ignore', () => api(`/tax-invoices/${d.id}/ignore`, { method: 'POST', json: { reason } }), '제외했습니다')) { setDialog(null); refresh(); } }} />
      <ReasonDialog open={dialog === 'unpost'} title="처리를 취소할까요?" danger confirm="처리 취소" body="이 계산서로 만든 분개를 역분개하고 '미처리'로 되돌립니다. 지급결의에 들어간 계산서는 먼저 결의를 취소해야 합니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('unpost', () => api(`/tax-invoices/${d.id}/unpost`, { method: 'POST', json: { reason } }), '처리를 취소했습니다')) { setDialog(null); refresh(); } }} />
      <ReasonDialog open={dialog === 'cancel'} title={d.status === 'ISSUED' ? '발행을 취소할까요?' : '계산서를 취소할까요?'} danger confirm="취소" body={d.status === 'ISSUED' ? '국세청 전송 전이라 연동사에서 발행을 취소합니다. 전송된 뒤에는 수정세금계산서를 발행해야 합니다.' : '기록은 남고 이 계산서는 더 이상 발행할 수 없습니다.'} onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('cancel', () => api(`/tax-invoices/${d.id}/cancel`, { method: 'POST', json: { reason } }), '취소했습니다')) { setDialog(null); refresh(); } }} />
      {dialog === 'issue' && <IssueDialog d={d} open onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
    </>
  );
}
