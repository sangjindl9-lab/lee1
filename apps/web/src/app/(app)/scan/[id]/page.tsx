'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronLeft, FilePlus2, Plus, RefreshCw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReasonDialog, useRun } from '@/components/doc-ui';
import { AccountPicker, CostCodeSelect, ProjectPicker, VendorPicker } from '@/components/pickers';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, IconButton, Input, Skeleton, Spinner, useToast } from '@/components/ui';
import { api, ApiError, blobUrl } from '@/lib/api';
import { addDigits, bizNo, previewVat, won } from '@/lib/format';
import { DOC_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface XLine { name: string; spec?: string | null; unit?: string | null; qty?: string | null; unitPrice?: string | null; supplyAmount?: string | null; vatAmount?: string | null; memo?: string | null; confidence?: number }
interface X { vendorName?: string | null; vendorBizNo?: string | null; docNo?: string | null; docDate?: string | null; deliveryDate?: string | null; deliveryPlace?: string | null; supplyAmount?: string | null; vatAmount?: string | null; totalAmount?: string | null; memo?: string | null; lines: XLine[]; confidence?: number; warnings?: string[] }
interface Doc {
  id: string; code: string; docType: string; docTypeLabel: string; status: string; confidence: string | null; provider: string | null; providerMode: string | null; errorMessage: string | null; rejectReason: string | null;
  extracted: X | null; reviewed: X | null; file: { id: string; originalName: string; mimeType: string; size: number };
  vendor: { id: string; name: string; bizRegNo: string | null } | null; project: { id: string; name: string } | null;
  duplicateOf: { id: string; code: string; status: string } | null; registeredType: string | null; registeredHref: string | null;
}

const int = (v?: string | null) => (v ? String(v).replace(/[^0-9-]/g, '').replace(/(?!^)-/g, '') : '');
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function Preview({ id, mime }: { id: string; mime: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    blobUrl(`/documents/${id}/file`).then((r) => (url = r.url, setSrc(r.url))).catch(() => setErr(true));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (err) return <EmptyState title="원본을 불러오지 못했습니다" />;
  if (!src) return <div className="grid h-full place-items-center"><Spinner /></div>;
  return mime === 'application/pdf'
    ? <iframe title="원본 문서" src={src} className="h-full min-h-[70vh] w-full rounded-[2px] bg-white" />
    : <div className="h-full overflow-auto"><img src={src} alt="원본 문서" className="mx-auto max-w-full" /></div>;
}

const TARGETS = [
  { value: 'PURCHASE_ORDER', label: '발주서 초안', hint: '대표 결재 전 작성중 상태로 만듭니다', perm: 'purchase:create' },
  { value: 'TAX_INVOICE', label: '매입 세금계산서', hint: '미처리 상태로 들어가 검수와 맞춰 처리합니다', perm: 'taxinvoice:create' },
  { value: 'PAYMENT_REQUEST', label: '지급결의 초안', hint: '영수증·소액 경비 지급', perm: 'expense:create' },
  { value: 'PROJECT_FILE', label: '현장 첨부만', hint: '자료로 보관만 합니다', perm: 'project:update' },
] as const;

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['document', company.id, id], queryFn: () => api<Doc>(`/documents/${id}`), retry: false });
  const d = q.data;
  const [x, setX] = useState<X>({ lines: [] });
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'register' | 'reject'>(null);
  const [target, setTarget] = useState<(typeof TARGETS)[number]['value']>('PURCHASE_ORDER');
  const [extra, setExtra] = useState({ title: '', costCodeId: null as string | null, accountId: null as string | null, approvalNo: '', allowDuplicate: false });
  const { run, acting } = useRun(['documents']);

  useEffect(() => {
    if (!d) return;
    const src = d.reviewed ?? d.extracted ?? { lines: [] };
    setX({ ...src, lines: src.lines?.length ? src.lines : [{ name: '' }] });
    setVendor(d.vendor ? { id: d.vendor.id, name: d.vendor.name } : null);
    setProjectId(d.project?.id ?? null);
    setDirty(false);
    setTarget(d.docType === 'TAX_INVOICE' ? 'TAX_INVOICE' : d.docType === 'RECEIPT' ? 'PAYMENT_REQUEST' : 'PURCHASE_ORDER');
  }, [d]);

  if (q.error) return <EmptyState title="문서를 찾을 수 없습니다" action={<Link href="/scan"><Button>목록으로</Button></Link>} />;
  if (!d) return <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-[70vh]" /><Skeleton className="h-[70vh]" /></div>;

  const locked = d.status === 'REGISTERED' || d.status === 'REJECTED' || !can('document:update');
  const upd = (p: Partial<X>) => (setX((s) => ({ ...s, ...p })), setDirty(true));
  const setLine = (i: number, p: Partial<XLine>) => upd({ lines: x.lines.map((l, j) => {
    if (j !== i) return l;
    const n = { ...l, ...p };
    if (('qty' in p || 'unitPrice' in p) && n.qty && n.unitPrice) n.supplyAmount = String(Math.floor(Number(n.qty) * Number(n.unitPrice)));
    return n;
  }) });
  const lineSupply = x.lines.reduce((a, l) => addDigits(a, int(l.supplyAmount) || '0'), '0');
  const lineVat = x.lines.reduce((a, l) => addDigits(a, int(l.vatAmount) || '0'), '0');
  const docSupply = int(x.supplyAmount);
  const mismatch = !!docSupply && docSupply !== lineSupply;
  const conf = (l: XLine) => (l.confidence !== undefined && l.confidence < 0.7 ? 'bg-warn-soft' : '');

  const saveReview = () => run('review', () => api(`/documents/${id}/review`, { method: 'PUT', json: { vendorId: vendor?.id ?? null, projectId, data: x } }), '확인 내용을 저장했습니다').then((ok) => { if (ok) { setDirty(false); qc.invalidateQueries({ queryKey: ['document', company.id, id] }); } });

  async function register() {
    const lines = x.lines.filter((l) => l.name?.trim());
    let payload: unknown;
    const vatOf = (l: XLine) => int(l.vatAmount) || previewVat(int(l.supplyAmount) || '0');
    if (target === 'PURCHASE_ORDER') payload = { projectId, vendorId: vendor?.id, title: extra.title || `${vendor?.name ?? ''} ${d!.docTypeLabel}`.trim(), orderDate: x.docDate || today(), deliveryDate: x.deliveryDate || null, deliveryPlace: x.deliveryPlace || null, memo: x.memo || null, lines: lines.map((l) => ({ name: l.name, spec: l.spec || null, unit: l.unit || 'EA', qty: l.qty || '1', unitPrice: l.unitPrice || (l.qty ? String(Math.floor(Number(int(l.supplyAmount) || 0) / Number(l.qty))) : int(l.supplyAmount) || '0') })) };
    else if (target === 'TAX_INVOICE') payload = { direction: 'PURCHASE', writeDate: x.docDate || today(), vendorId: vendor?.id, projectId, approvalNo: extra.approvalNo || null, lines: lines.map((l) => ({ itemDate: x.docDate || null, name: l.name, spec: l.spec || null, qty: l.qty || null, unitPrice: l.unitPrice || null, supplyAmount: int(l.supplyAmount) || '0', vatAmount: vatOf(l) })) };
    else if (target === 'PAYMENT_REQUEST') payload = { kind: 'EXPENSE', title: extra.title || `${vendor?.name ?? x.vendorName ?? ''} 경비`.trim(), requestDate: today(), projectId, vendorId: vendor?.id ?? null, payeeName: vendor ? null : x.vendorName || '영수증', lines: lines.map((l) => ({ description: l.name, costCodeId: extra.costCodeId, accountId: extra.costCodeId ? null : extra.accountId, supplyAmount: int(l.supplyAmount) || '0', vatAmount: int(l.vatAmount) || '0' })) };
    else payload = { projectId };
    try {
      if (dirty) await api(`/documents/${id}/review`, { method: 'PUT', json: { vendorId: vendor?.id ?? null, projectId, data: x } });
      const r = await api<{ href: string }>(`/documents/${id}/register`, { method: 'POST', json: { target, payload, allowDuplicate: extra.allowDuplicate } });
      toast('ok', '등록했습니다');
      qc.invalidateQueries({ queryKey: ['documents'] });
      router.push(r.href);
    } catch (e) {
      toast('error', e instanceof ApiError ? (e.body.fields?.length ? `${e.body.message}: ${e.body.fields.map((f) => f.message).slice(0, 2).join(', ')}` : e.body.message) : '등록하지 못했습니다');
    }
  }

  const needs = target === 'PURCHASE_ORDER' ? !vendor || !projectId : target === 'TAX_INVOICE' ? !vendor : target === 'PAYMENT_REQUEST' ? !extra.costCodeId && !extra.accountId : !projectId;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href="/scan" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />문서 스캔</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
            <span className="num text-muted">{d.code}</span><Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge><Badge tone="muted">{d.docTypeLabel}</Badge>
            {d.confidence && <span className="text-muted">인식률 {Math.round(Number(d.confidence) * 100)}% · {d.provider}</span>}
          </div>
          <h1 className="truncate text-title font-semibold tracking-[-0.01em]">{d.file.originalName}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!locked && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('reject')}>반려</Button>}
          {!locked && can('document:create') && <Button icon={<RefreshCw className="size-3.5" />} loading={acting === 'extract'} onClick={() => run('extract', () => api(`/documents/${id}/extract`, { method: 'POST' }), '다시 읽었습니다').then(() => qc.invalidateQueries({ queryKey: ['document', company.id, id] }))}>다시 인식</Button>}
          {!locked && <Button icon={<Save className="size-3.5" />} disabled={!dirty} loading={acting === 'review'} onClick={saveReview}>확인 내용 저장</Button>}
          {!locked && <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setDialog('register')}>등록</Button>}
          {d.registeredHref && <Link href={d.registeredHref}><Button variant="primary">등록된 문서 열기</Button></Link>}
        </div>
      </div>

      {d.status === 'FAILED' && <p className="mb-4 flex items-start gap-2 rounded-[6px] border border-seal/40 bg-seal-soft px-4 py-2.5 text-seal"><TriangleAlert className="mt-0.5 size-4 shrink-0" />자동으로 읽지 못했습니다: {d.errorMessage} — 오른쪽 칸에 직접 입력해도 등록할 수 있습니다.</p>}
      {d.duplicateOf && d.status !== 'REGISTERED' && <p className="mb-4 flex items-start gap-2 rounded-[6px] border border-seal/40 bg-seal-soft px-4 py-2.5 text-seal"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>같은 거래처·문서번호·금액의 문서가 이미 있습니다: <Link href={`/scan/${d.duplicateOf.id}`} className="underline">{d.duplicateOf.code}</Link> ({DOC_STATUS[d.duplicateOf.status].label}). 두 번 등록하지 않도록 확인하세요.</span></p>}
      {d.status === 'REJECTED' && <p className="mb-4 text-muted">반려 사유: {d.rejectReason}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="min-h-[60vh] rounded-[6px] bg-surface-2 p-2 xl:sticky xl:top-4 xl:h-[calc(100vh-120px)]"><Preview id={id} mime={d.file.mimeType} /></section>

        <div className="min-w-0 space-y-4">
          <section className="rounded-[6px] border border-line bg-surface p-4">
            <h2 className="mb-3 font-semibold">읽은 내용 확인</h2>
            <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
              <Field label="거래처" hint={x.vendorName || x.vendorBizNo ? `문서: ${x.vendorName ?? ''} ${bizNo(x.vendorBizNo)}` : undefined} className="sm:col-span-2">
                <VendorPicker value={vendor?.id ?? null} display={vendor?.name} onChange={(v) => (setVendor(v), setDirty(true))} placeholder="거래처 검색 (없으면 거래처에서 먼저 등록)" />
              </Field>
              <Field label="현장"><ProjectPicker value={projectId} onChange={(v) => (setProjectId(v), setDirty(true))} /></Field>
              <Field label="문서번호"><Input value={x.docNo ?? ''} onChange={(e) => upd({ docNo: e.target.value })} className="num" /></Field>
              <Field label="문서 일자"><Input type="date" value={x.docDate ?? ''} onChange={(e) => upd({ docDate: e.target.value })} /></Field>
              <Field label="납품일"><Input type="date" value={x.deliveryDate ?? ''} onChange={(e) => upd({ deliveryDate: e.target.value })} /></Field>
              <Field label="납품 장소" className="sm:col-span-2"><Input value={x.deliveryPlace ?? ''} onChange={(e) => upd({ deliveryPlace: e.target.value })} /></Field>
            </fieldset>
          </section>

          <section className="rounded-[6px] border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="font-semibold">품목 <span className="num font-normal text-muted">{x.lines.filter((l) => l.name).length}</span></h2>
              <span className="text-meta text-muted"><span className="mr-1 inline-block size-2.5 rounded-[1px] bg-warn-soft ring-1 ring-warn/40 align-middle" />확인이 필요한 줄</span>
            </div>
            {(x.warnings?.length ?? 0) > 0 && <ul className="space-y-0.5 border-b border-line bg-warn-soft/50 px-4 py-2 text-meta text-ink-2">{x.warnings!.map((w) => <li key={w}>· {w}</li>)}</ul>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] text-body">
                <thead className="bg-surface-2 text-meta text-muted"><tr><th className="w-8 px-2 py-1.5 font-medium">#</th><th className="px-1 py-1.5 text-left font-medium">품명</th><th className="w-[100px] px-1 py-1.5 text-left font-medium">규격</th><th className="w-[52px] px-1 py-1.5 text-left font-medium">단위</th><th className="w-[64px] px-1 py-1.5 text-right font-medium">수량</th><th className="w-[104px] px-1 py-1.5 text-right font-medium">단가</th><th className="w-[116px] px-1 py-1.5 text-right font-medium">금액</th><th className="w-8" /></tr></thead>
                <tbody className="divide-y divide-line">
                  {x.lines.map((l, i) => (
                    <tr key={i} className={conf(l)}>
                      <td className="num px-2 text-center text-meta text-muted">{i + 1}</td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.name ?? ''} onChange={(e) => setLine(i, { name: e.target.value })} aria-label={`${i + 1}번 품명`} /></td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.spec ?? ''} onChange={(e) => setLine(i, { spec: e.target.value })} aria-label="규격" /></td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="단위" /></td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.qty ?? ''} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} className="num text-right" aria-label="수량" /></td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.unitPrice ? Number(l.unitPrice).toLocaleString('ko-KR') : ''} onChange={(e) => setLine(i, { unitPrice: int(e.target.value) })} className="num text-right" aria-label="단가" /></td>
                      <td className="px-1 py-1"><Input disabled={locked} value={l.supplyAmount ? Number(l.supplyAmount).toLocaleString('ko-KR') : ''} onChange={(e) => setLine(i, { supplyAmount: int(e.target.value) })} className="num text-right" aria-label="금액" /></td>
                      <td className="px-1">{!locked && <IconButton label="줄 삭제" onClick={() => upd({ lines: x.lines.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              {!locked ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => upd({ lines: [...x.lines, { name: '' }] })}>줄 추가</Button> : <span />}
              <div className="text-right text-meta">
                <p>품목 합계 <b className="num text-[15px] text-ink">{won(lineSupply)}</b>원{lineVat !== '0' && <span className="num text-muted"> · 세액 {won(lineVat)}</span>}</p>
                {docSupply && <p className={clsx(mismatch ? 'text-seal' : 'text-ok')}>문서의 공급가액 {won(docSupply)}원 {mismatch ? '— 다릅니다. 빠진 줄이 없는지 확인하세요' : '— 일치'}</p>}
              </div>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={dialog === 'register'} onClose={() => setDialog(null)} title="확인한 내용으로 등록" width={520}
        footer={<><Button onClick={() => setDialog(null)}>닫기</Button><Button variant="primary" loading={acting === 'reg'} disabled={needs || (!!d.duplicateOf && !extra.allowDuplicate)} onClick={() => run('reg', register)}>등록</Button></>}>
        <div className="space-y-3">
          <div role="radiogroup" aria-label="등록할 문서" className="grid gap-1.5">
            {TARGETS.filter((t) => can(t.perm)).map((t) => (
              <label key={t.value} className={clsx('flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2', target === t.value ? 'border-steel bg-steel-soft/40' : 'border-line hover:bg-surface-hover')}>
                <input type="radio" name="target" checked={target === t.value} onChange={() => setTarget(t.value)} className="mt-1 accent-[var(--color-steel)]" />
                <span><span className="font-medium">{t.label}</span><span className="block text-meta text-muted">{t.hint}</span></span>
              </label>
            ))}
          </div>
          {(target === 'PURCHASE_ORDER' || target === 'PAYMENT_REQUEST') && <Field label="제목"><Input value={extra.title} onChange={(e) => setExtra({ ...extra, title: e.target.value })} placeholder={`${vendor?.name ?? ''} ${d.docTypeLabel}`} /></Field>}
          {target === 'TAX_INVOICE' && <Field label="승인번호" hint="전자세금계산서를 출력한 것이면 입력 (중복 확인에 쓰임)"><Input value={extra.approvalNo} onChange={(e) => setExtra({ ...extra, approvalNo: e.target.value })} className="num" /></Field>}
          {target === 'PAYMENT_REQUEST' && (
            <>
              <Field label="원가항목 (현장 비용)"><CostCodeSelect value={extra.costCodeId} onChange={(v) => setExtra({ ...extra, costCodeId: v })} /></Field>
              {!extra.costCodeId && <Field label="또는 비용 계정 (본사 비용)"><AccountPicker value={extra.accountId} onChange={(a) => setExtra({ ...extra, accountId: a?.id ?? null })} filter={(a) => a.type === 'EXPENSE'} /></Field>}
            </>
          )}
          {needs && <p className="text-meta text-seal">{target === 'PURCHASE_ORDER' ? '거래처와 현장을 먼저 고르세요' : target === 'TAX_INVOICE' ? '거래처를 먼저 고르세요' : target === 'PAYMENT_REQUEST' ? '원가항목이나 계정을 고르세요' : '현장을 고르세요'}</p>}
          {d.duplicateOf && <Checkbox checked={extra.allowDuplicate} onChange={(v) => setExtra({ ...extra, allowDuplicate: v })} label={`${d.duplicateOf.code}와 다른 문서임을 확인했습니다`} />}
        </div>
      </Dialog>
      <ReasonDialog open={dialog === 'reject'} title="이 문서를 반려할까요?" danger confirm="반려" body="잘못 올렸거나 쓸 수 없는 문서일 때 씁니다. 원본은 보관되고 같은 파일을 다시 올릴 수 있게 됩니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('reject', () => api(`/documents/${id}/reject`, { method: 'POST', json: { reason } }), '반려했습니다')) { setDialog(null); qc.invalidateQueries({ queryKey: ['document', company.id, id] }); } }} />
    </>
  );
}
