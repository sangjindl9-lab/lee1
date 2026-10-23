'use client';

import { useApprovalLine } from '@/components/approval-line';
import clsx from 'clsx';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ChevronLeft, CircleSlash, FileDown, Lock, PackageCheck, Pause, Pencil, RotateCcw, Send, Truck, Undo2, X } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { PoStatusBadge, sealUrl, stampSteps } from '@/components/po-bits';
import { CompanySignature } from '@/components/seal-bits';
import { ApprovalBox, Badge, Button, Dialog, EmptyState, Field, Input, Seal, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { bizNo, dateTime, won } from '@/lib/format';
import { TAX_TYPE, TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { PoDetailFull, PoLine } from '@/lib/types';

const qtyText = (v: string) => {
  const [i, f = ''] = v.split('.');
  const t = f.replace(/0+$/, '');
  return won(i) + (t ? `.${t}` : '');
};

/** 한글 금액 (발주서 문서 표시) */
function koreanAmount(n: string) {
  const D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const S = ['', '십', '백', '천'];
  const B = ['', '만', '억', '조'];
  const s = n.split('.')[0].replace(/^0+/, '');
  if (!s) return '영';
  const groups: string[] = [];
  for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
  return groups.map((g, gi) => {
    const p = g.padStart(4, '0');
    let part = '';
    for (let k = 0; k < 4; k++) if (Number(p[k])) part += D[Number(p[k])] + S[3 - k];
    return part ? part + B[groups.length - 1 - gi] : '';
  }).join('');
}

/** 화면용 발주서 — 인쇄될 PDF 와 같은 구성 */
function PaperDocument({ po }: { po: PoDetailFull }) {
  const approved = ['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED'].includes(po.status);
  const steps = stampSteps(po.approval && po.approval.status !== 'CANCELLED' ? po.approval : null);
  const row = (k: string, v: ReactNode) => (
    <tr key={k}><th scope="row" className="w-[84px] border border-[#c9ced6] bg-[#eef1f4] px-2 py-1 text-left font-normal text-[#5b6573]">{k}</th><td className="border border-[#c9ced6] px-2 py-1">{v}</td></tr>
  );
  return (
    <div className="relative overflow-hidden rounded-[2px] bg-white p-6 text-[12px] leading-[1.5] text-[#17202b] shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_24px_-12px_rgb(16_24_40/0.18)] ring-1 ring-black/5 sm:p-8 [color-scheme:light]">
      {!approved && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-[24deg] text-[34px] font-bold whitespace-nowrap text-[#c42b1c]/10 select-none sm:text-[44px]">
            {po.status === 'CANCELLED' ? '취소된 발주서' : po.status === 'REJECTED' ? '반려 · 효력 없음' : '대표이사 결재 전'}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold tracking-[0.5em]">발주서</h2>
          <p className="num mt-1 text-[11px] text-[#5b6573]">문서번호 {po.code}{po.revision ? ` (개정 ${po.revision})` : ''} · 발주일자 {po.orderDate.replace(/-/g, '. ')}.</p>
        </div>
        <div className="[&_td]:!border-[#17202b] [&_th]:!border-[#17202b] [&_th]:!bg-[#eef1f4] [&_th]:!text-[#5b6573]">
          <ApprovalBox steps={steps} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          ['수신 (공급자)', [['상호', <b key="n">{po.vendor.name}</b>], ['사업자번호', <span key="b" className="num">{bizNo(po.vendor.bizRegNo)}</span>], ['대표자', po.vendor.ceoName], ['담당자', po.vendorContact ?? po.vendor.contactName], ['연락처', po.vendor.contactPhone ?? po.vendor.phone]]],
          ['발신 (발주자)', [['상호', <b key="n">{po.company.name}</b>], ['사업자번호', <span key="b" className="num">{bizNo(po.company.bizRegNo)}</span>], ['대표자', po.company.ceoName], ['주소', po.company.address], ['담당·연락처', [po.ourContact, po.ourPhone].filter(Boolean).join('  ')]]],
        ].map(([title, rows]) => (
          <table key={title as string} className="w-full border-collapse">
            <caption className="bg-[#2b4c6f] px-2 py-1 text-left text-[11px] font-medium text-white">{title as string}</caption>
            <tbody>{(rows as [string, ReactNode][]).map(([k, v]) => row(k, v))}</tbody>
          </table>
        ))}
      </div>

      <table className="mt-3 w-full border-collapse">
        <tbody>
          {row('공사명', <span className="font-medium">{po.project.name} <span className="num text-[#5b6573]">({po.project.code})</span></span>)}
          {row('발주내용', po.title)}
          {row('납품장소', po.deliveryPlace ?? po.project.siteAddress ?? '')}
          {row('납품기한', po.deliveryDate ? po.deliveryDate.replace(/-/g, '. ') + '.' : '협의')}
          {row('결제조건', po.paymentTerms ?? '')}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-[1.5px] border-[#17202b] px-3 py-2.5">
        <span className="text-[11px] text-[#5b6573]">합계금액<br />(부가세 포함)</span>
        <span className="text-[15px] font-bold">금 {koreanAmount(po.totalAmount)}원정</span>
        <span className="num ml-auto text-[15px] font-bold">₩{won(po.totalAmount)}</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="bg-[#eef1f4] text-[11px]">
              {['No', '품명', '규격', '단위', '수량', '단가', '공급가액', '세액', '비고'].map((h) => <th key={h} className="border border-[#17202b] px-1.5 py-1 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td className="num border border-[#c9ced6] px-1.5 py-1 text-center">{l.lineNo}</td>
                <td className="border border-[#c9ced6] px-1.5 py-1">{l.name}</td>
                <td className="border border-[#c9ced6] px-1.5 py-1">{l.spec}</td>
                <td className="border border-[#c9ced6] px-1.5 py-1 text-center">{l.unit}</td>
                <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{qtyText(l.qty)}</td>
                <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{qtyText(l.unitPrice)}</td>
                <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{won(l.supplyAmount)}</td>
                <td className="num border border-[#c9ced6] px-1.5 py-1 text-right">{l.taxType === 'TAXABLE' ? won(l.vatAmount) : TAX_TYPE[l.taxType]}</td>
                <td className="border border-[#c9ced6] px-1.5 py-1">{l.memo}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {[['공급가액 계', po.supplyAmount], ['세액 계', po.vatAmount], ['합계', po.totalAmount]].map(([k, v], i) => (
              <tr key={k} className={i === 2 ? 'font-bold' : ''}>
                <td colSpan={5} />
                <td className="border border-[#17202b] bg-[#eef1f4] px-1.5 py-1 text-center text-[11px]">{k}</td>
                <td colSpan={3} className="num border border-[#17202b] px-1.5 py-1 text-right">{won(v)} 원</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex border border-[#c9ced6]">
        <div className="grid w-[84px] shrink-0 place-items-center bg-[#eef1f4] text-[11px] text-[#5b6573]">특기사항</div>
        <div className="px-3 py-2 text-[11.5px] whitespace-pre-wrap">
          {po.memo && <p className="mb-1">{po.memo}</p>}
          <p>1. 납품 시 거래명세표를 함께 제출해 주십시오. 검수 후 수량·규격이 다른 품목은 반품합니다.</p>
          <p>2. 세금계산서는 검수 완료된 수량 기준으로 발행해 주십시오. (발주번호 기재)</p>
          <p>3. 납품기한을 지키기 어려우면 미리 담당자에게 알려 주십시오.</p>
        </div>
      </div>

      <div className="mt-6 text-center">
        <p>위와 같이 발주합니다.</p>
        <p className="num mt-2">{po.orderDate.slice(0, 4)}년 {Number(po.orderDate.slice(5, 7))}월 {Number(po.orderDate.slice(8, 10))}일</p>
        <CompanySignature name={po.company.name} ceoName={po.company.ceoName} stamped={approved} />
      </div>
    </div>
  );
}

function ReasonDialog({ open, title, body, confirm, danger, onClose, onConfirm }: { open: boolean; title: string; body: ReactNode; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      tone={danger ? 'danger' : undefined}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 2} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); setReason(''); } finally { setBusy(false); } }}>{confirm}</Button></>}
    >
      <div className="space-y-3">
        <div className="text-ink-2">{body}</div>
        <Field label="사유" required hint="감사로그에 남습니다"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus /></Field>
      </div>
    </Dialog>
  );
}

function ReceiptDialog({ po, open, onClose, onDone }: { po: PoDetailFull; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { me } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const open_ = po.lines.filter((l) => Number(l.remainingQty) > 0);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open_.map((l) => [l.id, qtyText(l.remainingQty).replace(/,/g, '')])));
  const [date, setDate] = useState(today);
  const [inspector, setInspector] = useState(me.user.name);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const over = (l: PoLine) => Number(qty[l.id] || 0) > Number(l.remainingQty);
  const total = open_.reduce((a, l) => a + Math.floor(Number(qty[l.id] || 0) * Number(l.unitPrice)), 0);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ code: string; poStatus: string }>(`/purchase-orders/${po.id}/receipts`, { method: 'POST', json: { receiptDate: date, inspectorName: inspector, memo, lines: open_.filter((l) => Number(qty[l.id] || 0) > 0).map((l) => ({ poLineId: l.id, qty: qty[l.id] })) } });
      toast('ok', `검수 ${r.code}를 등록했습니다`);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.body.message : '등록하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="납품 검수 등록" width={760} footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" loading={busy} disabled={open_.some(over) || !open_.some((l) => Number(qty[l.id] || 0) > 0)} onClick={submit} icon={<PackageCheck className="size-4" />}>검수 확정</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="검수일"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="검수자"><Input value={inspector} onChange={(e) => setInspector(e.target.value)} /></Field>
        <Field label="메모"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="거래명세표 번호 등" /></Field>
      </div>
      <p className="mb-2 text-meta text-muted">실제로 받은 수량을 입력하세요. 일부만 받았다면 그만큼만 입력하면 나머지는 잔량으로 남습니다.</p>
      <div className="overflow-x-auto rounded-[4px] border border-line">
        <table className="w-full min-w-[560px] text-body">
          <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-2 text-left font-medium">품명</th><th className="px-2 py-2 text-right font-medium">발주</th><th className="px-2 py-2 text-right font-medium">기입고</th><th className="px-2 py-2 text-right font-medium">잔량</th><th className="w-[130px] px-2 py-2 text-right font-medium">이번 검수</th></tr></thead>
          <tbody>
            {open_.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-3 py-1.5"><p>{l.name}</p><p className="text-meta text-muted">{l.spec}</p></td>
                <td className="num px-2 text-right text-ink-2">{qtyText(l.qty)} {l.unit}</td>
                <td className="num px-2 text-right text-ink-2">{qtyText(l.receivedQty)}</td>
                <td className="num px-2 text-right font-medium">{qtyText(l.remainingQty)}</td>
                <td className="px-2 py-1">
                  <Input value={qty[l.id] ?? ''} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="num text-right" aria-invalid={over(l)} aria-label={`${l.name} 검수 수량`} />
                  {over(l) && <p className="mt-0.5 text-right text-[11px] text-seal">잔량보다 많습니다</p>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td colSpan={4} className="px-3 py-2">이번 검수 공급가액 (예상)</td><td className="num px-2 text-right">{won(String(total))}</td></tr></tfoot>
        </table>
      </div>
      {err && <p role="alert" className="mt-3 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{err}</p>}
    </Dialog>
  );
}

const PROGRESS = ['작성', '결재', '승인', '입고'] as const;

export default function PoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const q = useQuery({ queryKey: ['po', company.id, id], queryFn: () => api<PoDetailFull>(`/purchase-orders/${id}`), retry: false });
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'cancel' | 'reopen' | 'close' | 'receive' | { receiptId: string; code: string }>(null);
  const [justApproved, setJustApproved] = useState(false);
  const po = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['po', company.id, id] });
    qc.invalidateQueries({ queryKey: ['pos'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['approval-counts'] });
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['receipts'] });
  };
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setActing(key);
    try {
      await fn();
      toast('ok', ok);
      refresh();
      return true;
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
      return false;
    } finally {
      setActing(null);
    }
  };

  if (q.error) return <EmptyState title="발주서를 찾을 수 없습니다" description="삭제되었거나 볼 수 있는 권한이 없는 발주서입니다." action={<Link href="/purchase-orders"><Button>발주서 목록</Button></Link>} />;
  if (!po) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-[640px]" /></div>;

  const a = po.approval;
  const editable = ['DRAFT', 'REJECTED'].includes(po.status) && can('purchase:update');
  const receivable = ['APPROVED', 'SENT', 'PARTIAL'].includes(po.status) && can('receipt:create');
  const hasReceipts = po.receipts.some((r) => r.status === 'CONFIRMED');
  const stage = po.status === 'DRAFT' || po.status === 'REJECTED' ? 0 : po.status === 'PENDING' ? 1 : ['APPROVED', 'SENT'].includes(po.status) ? 2 : 3;

  const openPdf = async () => {
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/pdf`, { headers: { 'x-company-id': company.id }, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).message);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast('error', (e as Error).message || 'PDF를 만들지 못했습니다');
    }
  };
  const act = (action: 'approve' | 'reject' | 'hold') =>
    run(action, () => api(`/approvals/${a!.id}/act`, { method: 'POST', json: { action, comment: comment || null, version: a!.version } }), { approve: '승인했습니다', reject: '반려했습니다', hold: '보류했습니다' }[action]).then((ok) => {
      if (ok) {
        setComment('');
        if (action === 'approve') setJustApproved(true);
      }
    });

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/purchase-orders" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />발주서 목록</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
            <span className="num text-muted">{po.code}{po.revision ? ` · 개정 ${po.revision}` : ''}</span>
            <PoStatusBadge status={po.status} />
            <Link href={`/projects/${po.project.id}`} className="flex items-center gap-1.5 text-muted hover:text-ink"><span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: TRADE[po.project.tradeType].color }} />{po.project.name}</Link>
          </div>
          <h1 className="text-title font-semibold tracking-[-0.01em]">{po.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {can('purchase:export') && <Button icon={<FileDown className="size-3.5" />} onClick={openPdf}>PDF</Button>}
          {po.canRecall && <Button icon={<Undo2 className="size-3.5" />} loading={acting === 'recall'} onClick={() => run('recall', () => api(`/approvals/${a!.id}/cancel`, { method: 'POST' }), '결재를 회수했습니다. 작성중으로 돌아갑니다')}>결재 회수</Button>}
          {editable && <Button icon={<Ban className="size-3.5" />} variant="danger" onClick={() => setDialog('cancel')}>발주 취소</Button>}
          {editable && <Link href={`/purchase-orders/${po.id}/edit`}><Button icon={<Pencil className="size-3.5" />}>수정</Button></Link>}
          {editable && <Button variant="primary" icon={<Send className="size-3.5" />} loading={acting === 'submit'} onClick={async () => { const line = await pickLine('PURCHASE_ORDER', po.totalAmount); if (line === null) return; run('submit', () => api(`/purchase-orders/${po.id}/submit`, { method: 'POST', json: { version: po.version, approvalLine: line } }), '결재를 올렸습니다'); }}>결재 상신</Button>}
          {po.status === 'APPROVED' && can('purchase:update') && <Button icon={<Truck className="size-3.5" />} loading={acting === 'sent'} onClick={() => run('sent', () => api(`/purchase-orders/${po.id}/sent`, { method: 'POST', json: { version: po.version } }), '거래처 전송으로 표시했습니다')}>거래처 전송 표시</Button>}
          {['APPROVED', 'SENT'].includes(po.status) && can('purchase:update') && !hasReceipts && (
            <>
              <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setDialog('reopen')}>변경 재결재</Button>
              <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('cancel')}>발주 취소</Button>
            </>
          )}
          {po.status === 'PARTIAL' && can('purchase:update') && <Button icon={<CircleSlash className="size-3.5" />} onClick={() => setDialog('close')}>잔량 종결</Button>}
          {receivable && <Button variant="primary" icon={<PackageCheck className="size-4" />} onClick={() => setDialog('receive')}>검수 등록</Button>}
        </div>
      </div>

      {/* 결재 차례인 사람에게만 보이는 결재 패널 */}
      {po.canAct && a && (
        <section className="mb-4 rounded-[6px] border-2 border-steel bg-surface p-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">결재할 차례입니다 — {a.steps.find((s) => s.stepNo === a.currentStep)?.title}</p>
              <p className="mt-0.5 text-muted"><span className="num">{a.drafterName} · {dateTime(a.submittedAt)} 상신</span> · 합계 <b className="num text-ink">{won(po.totalAmount)}원</b> · 품목 {po.lines.length}건 · {po.vendor.name}</p>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="의견 (반려할 때는 사유를 꼭 적어 주세요)" className="mt-3" aria-label="결재 의견" />
            </div>
            <div className="flex w-full gap-2 sm:w-auto sm:flex-col">
              <Button variant="primary" className="h-10! flex-1 px-6 sm:flex-none" icon={<Check className="size-4" />} loading={acting === 'approve'} disabled={!!acting} onClick={() => act('approve')}>승인</Button>
              <Button className="flex-1 sm:flex-none" icon={<Pause className="size-3.5" />} loading={acting === 'hold'} disabled={!!acting} onClick={() => act('hold')}>보류</Button>
              <Button variant="danger" className="flex-1 sm:flex-none" icon={<X className="size-3.5" />} loading={acting === 'reject'} disabled={!!acting || !comment.trim()} title={!comment.trim() ? '반려 사유를 입력해 주세요' : undefined} onClick={() => act('reject')}>반려</Button>
            </div>
          </div>
        </section>
      )}
      {justApproved && po.status === 'APPROVED' && (
        <section className="mb-4 flex items-center gap-4 rounded-[6px] border border-line bg-surface p-4">
          <Seal image={sealUrl(a?.steps[a.steps.length - 1]?.actedStampId)} name={a?.steps[a.steps.length - 1]?.actedByName ?? '승인'} date={new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')} size={64} animate />
          <div><p className="font-semibold">결재가 끝났습니다</p><p className="text-muted">이제 발주서 PDF를 거래처에 보내고, 납품되면 검수를 등록하세요.</p></div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-[6px] bg-surface-2 p-2 sm:p-5">
          <PaperDocument po={po} />
        </div>

        <aside className="space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <ol className="flex items-center">
              {PROGRESS.map((p, i) => {
                const done = i < stage || (i === 3 && po.status === 'RECEIVED');
                const cur = i === stage && po.status !== 'RECEIVED';
                return (
                  <li key={p} className="flex flex-1 items-center last:flex-none">
                    <span className="flex flex-col items-center gap-1">
                      <span className={clsx('grid size-6 place-items-center rounded-full border text-[11px] font-semibold', done ? 'border-ok bg-ok text-white' : cur ? (po.status === 'REJECTED' ? 'border-seal text-seal' : 'border-steel text-steel') : 'border-line-strong text-faint')}>
                        {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      <span className={clsx('text-meta', cur ? 'font-medium text-ink' : 'text-muted')}>{p}</span>
                    </span>
                    {i < 3 && <span className={clsx('mx-1 mb-5 h-px flex-1', i < stage ? 'bg-ok' : 'bg-line')} />}
                  </li>
                );
              })}
            </ol>
            {po.status === 'REJECTED' && a && <p className="mt-3 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">반려 사유: {a.steps.find((s) => s.state === 'REJECTED')?.comment}</p>}
            {po.status === 'PENDING' && a && <p className="mt-3 text-meta text-muted">{a.steps.find((s) => s.stepNo === a.currentStep)?.approverNames} 님의 {a.steps.find((s) => s.stepNo === a.currentStep)?.title} 대기 중{a.status === 'HOLD' ? ' (보류)' : ''}</p>}
            {po.status === 'CANCELLED' && <p className="mt-3 flex items-center gap-1.5 text-meta text-muted"><Lock className="size-3.5" />취소된 발주서입니다. 기록은 보존됩니다.</p>}
          </section>

          {['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED'].includes(po.status) && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-2.5 font-semibold">입고 현황</h2>
              <ul className="divide-y divide-line">
                {po.lines.map((l) => {
                  const r = Number(l.receivedQty) / Number(l.qty);
                  return (
                    <li key={l.id} className="px-4 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{l.name}</span>
                        <span className="num shrink-0 text-meta text-ink-2">{qtyText(l.receivedQty)} / {qtyText(l.qty)} {l.unit}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', r >= 1 ? 'bg-ok' : 'bg-steel')} style={{ width: `${Math.min(100, r * 100)}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {po.receipts.length > 0 && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-2.5 font-semibold">검수 이력</h2>
              <ul className="divide-y divide-line">
                {po.receipts.map((r) => (
                  <li key={r.id} className={clsx('px-4 py-2.5', r.status === 'CANCELLED' && 'text-muted')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="num font-medium">{r.code}</span>
                      {r.status === 'CANCELLED' ? <Badge tone="muted">취소</Badge> : <span className="num text-ink-2">{won(r.supplyAmount)}원</span>}
                    </div>
                    <p className="num text-meta text-muted">{r.receiptDate} · {r.inspectorName} · {r.lines.length}개 품목</p>
                    {r.cancelReason && <p className="text-meta text-muted">취소 사유: {r.cancelReason}</p>}
                    {r.status === 'CONFIRMED' && can('receipt:update') && <Button size="sm" variant="quiet" className="mt-1 text-meta" onClick={() => setDialog({ receiptId: r.id, code: r.code })}>검수 취소(반품)</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {po.approvalHistory.length > 0 && (
            <section className="rounded-[6px] border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-2.5 font-semibold">결재 이력</h2>
              <ol className="space-y-3 px-4 py-3">
                {po.approvalHistory.map((h, hi) => (
                  <li key={h.id} className={clsx(hi > 0 && 'border-t border-dashed border-line pt-3')}>
                    <p className="num mb-1.5 text-meta text-muted">{hi === 0 ? '현재 결재' : `이전 결재 ${po.approvalHistory.length - hi}`} · {dateTime(h.submittedAt)} 상신 · {{ PENDING: '진행 중', HOLD: '보류', APPROVED: '승인 완료', REJECTED: '반려', CANCELLED: '회수' }[h.status]}</p>
                    <ul className="space-y-1">
                      {h.steps.map((s) => (
                        <li key={s.id} className="flex gap-2 text-meta">
                          <span className="w-8 shrink-0 text-muted">{s.title}</span>
                          <span className={clsx('min-w-0 flex-1', s.state === 'REJECTED' ? 'text-seal' : s.state === 'APPROVED' ? 'text-ink' : 'text-faint')}>
                            {s.state === 'WAITING' ? `${s.approverNames ?? ''} 대기` : `${s.actedByName} ${{ APPROVED: s.stepNo === 0 ? '상신' : '승인', REJECTED: '반려', HOLD: '보류', SKIPPED: '생략', WAITING: '' }[s.state]}`}
                            {s.actedAt && <span className="num text-faint"> · {dateTime(s.actedAt)}</span>}
                            {s.comment && <span className="block text-ink-2">“{s.comment}”</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>

      {dialog === 'receive' && <ReceiptDialog po={po} open onClose={() => setDialog(null)} onDone={() => (setDialog(null), refresh())} />}
      <ReasonDialog
        open={dialog === 'cancel'}
        title="발주를 취소할까요?"
        danger
        confirm="발주 취소"
        body={<><b>{po.code}</b>를 취소합니다. 발주서와 결재 기록은 지워지지 않고 '취소' 상태로 남습니다.{['APPROVED', 'SENT'].includes(po.status) && ' 이미 거래처에 보냈다면 취소 사실을 따로 알려 주세요.'}</>}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => void ((await run('cancel', () => api(`/purchase-orders/${po.id}/cancel`, { method: 'POST', json: { version: po.version, reason } }), '발주를 취소했습니다')) && setDialog(null))}
      />
      <ReasonDialog
        open={dialog === 'reopen'}
        title="변경 재결재"
        confirm="작성중으로 전환"
        body="승인된 발주서를 작성중으로 되돌리고 개정번호를 올립니다. 고친 뒤 다시 대표이사 결재를 받아야 효력이 생깁니다."
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          if (await run('reopen', () => api(`/purchase-orders/${po.id}/reopen`, { method: 'POST', json: { version: po.version, reason } }), '작성중으로 전환했습니다')) router.push(`/purchase-orders/${po.id}/edit`);
        }}
      />
      <ReasonDialog
        open={dialog === 'close'}
        title="잔량 종결"
        confirm="종결"
        body="아직 들어오지 않은 수량을 더 받지 않기로 하고 발주를 끝냅니다."
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => void ((await run('close', () => api(`/purchase-orders/${po.id}/close`, { method: 'POST', json: { version: po.version, reason } }), '종결했습니다')) && setDialog(null))}
      />
      <ReasonDialog
        open={typeof dialog === 'object' && dialog !== null}
        title="검수를 취소할까요?"
        danger
        confirm="검수 취소"
        body={<>{typeof dialog === 'object' && dialog?.code} 검수를 취소하고 입고 수량을 되돌립니다. 반품이나 잘못 입력한 경우에 사용하세요.</>}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          if (typeof dialog === 'object' && dialog) {
            if (await run('rc', () => api(`/purchase-orders/receipts/${dialog.receiptId}/cancel`, { method: 'POST', json: { reason } }), '검수를 취소했습니다')) setDialog(null);
          }
        }}
      />
      {lineNode}
    </>
  );
}
