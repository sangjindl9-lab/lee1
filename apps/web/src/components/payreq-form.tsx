'use client';

import { type LineStep, useApprovalLine } from '@/components/approval-line';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AccountPicker, CostCodeSelect, ProjectPicker, useAccounts, useCostCodes, VendorPicker } from './pickers';
import { SegTabs } from './doc-ui';
import { ApprovalBox, Button, Checkbox, EmptyState, Field, IconButton, Input, MoneyInput, Spinner, Textarea } from './ui';
import { api, ApiError, qs } from '@/lib/api';
import { won } from '@/lib/format';
import { PAYREQ_KIND } from '@/lib/labels';
import { useSession } from '@/lib/session';

type Kind = 'PURCHASE' | 'SUBCONTRACT' | 'EXPENSE' | 'LABOR' | 'OTHER';
interface Line { key: string; description: string; accountId: string | null; costCodeId: string | null; supply: string; vat: string; vatDeductible: boolean; sourceType?: string | null; sourceId?: string | null; sourceCode?: string | null }
interface ReceiptSrc { id: string; code: string; receiptDate: string; supplyAmount: string; vatAmount: string; poCode: string; poTitle: string; vendorName: string; projectId: string; projectName: string }
export interface PayReqInitial {
  id: string; version: number; kind: Kind; title: string; requestDate: string; dueDate: string | null; projectId: string | null; vendorId: string | null; payeeName: string; memo: string | null;
  vendor: { id: string; name: string } | null;
  lines: { description: string; accountId: string | null; costCodeId: string | null; supplyAmount: string; vatAmount: string; vatDeductible: boolean; sourceType: string | null; sourceId: string | null; sourceCode: string | null }[];
}

type ExtraSrc = { id: string; code: string; title: string; supply: string; vat: string; type: string };
/** 구분별로 지급결의에 넣을 수 있는 원천 문서 (금액은 원천 그대로, 서버가 다시 확인) */
const EXTRA_SOURCES: Partial<Record<Kind, { type: string; label: string; needVendor: boolean; map: (r: Record<string, string>) => Omit<ExtraSrc, 'type'> }[]>> = {
  EXPENSE: [{ type: 'TAX_INVOICE', label: '처리된 세금계산서', needVendor: true, map: (r) => ({ id: r.id, code: r.code, title: `세금계산서 ${r.supplierName} · ${r.writeDate}`, supply: r.supplyAmount, vat: r.vatAmount }) }],
  OTHER: [{ type: 'TAX_INVOICE', label: '처리된 세금계산서', needVendor: true, map: (r) => ({ id: r.id, code: r.code, title: `세금계산서 ${r.supplierName} · ${r.writeDate}`, supply: r.supplyAmount, vat: r.vatAmount }) }],
  SUBCONTRACT: [
    { type: 'SUB_CLAIM', label: '승인된 하도급 기성', needVendor: true, map: (r) => ({ id: r.id, code: r.code, title: `${r.title} ${r.claimNo}회 기성 · ${r.projectName}${Number(r.retentionAmount) ? ` (유보 ${Number(r.retentionAmount).toLocaleString('ko-KR')} 제외)` : ''}`, supply: String(Number(r.thisAmount) - Number(r.retentionAmount)), vat: r.vatAmount }) },
    { type: 'SUB_RETENTION', label: '정산된 하도급 유보금', needVendor: true, map: (r) => ({ id: r.id, code: r.code, title: `${r.title} 유보금`, supply: r.retention, vat: '0' }) },
  ],
  LABOR: [{ type: 'LABOR', label: '확정된 노무비', needVendor: false, map: (r) => ({ id: r.id, code: r.workDate, title: `${r.workerName} · ${r.projectName} · ${Number(r.manDays)}공수`, supply: r.amount, vat: '0' }) }],
};

let seq = 0;
const k = () => `l${++seq}`;
const int = (v: string) => (v ? BigInt(v) : 0n);
const blank = (): Line => ({ key: k(), description: '', accountId: null, costCodeId: null, supply: '', vat: '', vatDeductible: true });

export type PayReqSeed = Omit<PayReqInitial, 'id' | 'version'>;

export function PayReqForm({ initial, seed, onSaved, onCancel }: { initial?: PayReqInitial; seed?: PayReqSeed; onSaved: (id: string, submitted: boolean) => void; onCancel: () => void }) {
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const base: PayReqSeed | undefined = initial ?? seed;
  const { project: ctxProject } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [kind, setKind] = useState<Kind>(base?.kind ?? 'EXPENSE');
  const [h, setH] = useState({ title: base?.title ?? '', requestDate: base?.requestDate ?? today, dueDate: base?.dueDate ?? '', payeeName: base?.vendorId ? '' : base?.payeeName ?? '', memo: base?.memo ?? '' });
  const [projectId, setProjectId] = useState<string | null>(base ? base.projectId : ctxProject?.id ?? null);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(base?.vendor ?? null);
  const [lines, setLines] = useState<Line[]>(() => base?.lines.length
    ? base.lines.map((l) => ({ key: k(), description: l.description, accountId: l.accountId, costCodeId: l.costCodeId, supply: l.supplyAmount.split('.')[0], vat: l.vatAmount.split('.')[0], vatDeductible: l.vatDeductible, sourceType: l.sourceType, sourceId: l.sourceId, sourceCode: l.sourceCode }))
    : [blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const submitAfter = useRef(false);
  const accounts = useAccounts();
  const costCodes = useCostCodes();

  const sourceMode = kind === 'PURCHASE';
  const srcLines = lines.filter((l) => l.sourceType);
  const manualLines = lines.filter((l) => !l.sourceType);
  const extraTypes = EXTRA_SOURCES[kind] ?? [];
  const tiLines = lines.filter((l) => l.sourceType && l.sourceType !== 'RECEIPT');
  const used = sourceMode ? srcLines : [...tiLines, ...manualLines.filter((l) => l.description.trim() || l.supply || l.vat)];

  const receipts = useQuery({
    queryKey: ['payreq-sources', vendor?.id, projectId],
    queryFn: () => api<ReceiptSrc[]>(`/payment-requests/sources${qs({ type: 'RECEIPT', vendorId: vendor?.id, projectId: projectId ?? undefined })}`),
    enabled: sourceMode && !!vendor,
  });
  // 수정 화면: 이미 이 결의에 담긴 검수는 '사용 가능' 목록에서 빠지므로 따로 보여 준다
  const pickedIds = new Set(srcLines.map((l) => l.sourceId));
  const tiSrc = useQuery({
    queryKey: ['payreq-sources-extra', kind, vendor?.id, projectId],
    queryFn: async () => (await Promise.all(extraTypes.map(async (t) => (await api<Record<string, string>[]>(`/payment-requests/sources${qs({ type: t.type, vendorId: vendor?.id, projectId: t.type === 'LABOR' ? projectId ?? undefined : undefined })}`)).map((r) => ({ ...t.map(r), type: t.type }))))).flat(),
    enabled: !sourceMode && extraTypes.length > 0 && (!!vendor || extraTypes.every((t) => !t.needVendor)),
  });
  const toggleTi = (t: ExtraSrc) => {
    if (tiLines.some((l) => l.sourceId === t.id)) setLines((ls) => ls.filter((l) => l.sourceId !== t.id));
    else setLines((ls) => [...ls.filter((l) => l.sourceType || l.description || l.supply), { key: k(), description: t.title, accountId: null, costCodeId: null, supply: t.supply.split('.')[0], vat: t.vat.split('.')[0], vatDeductible: true, sourceType: t.type, sourceId: t.id, sourceCode: t.code }]);
  };
  const toggleReceipt = (r: ReceiptSrc) => {
    if (pickedIds.has(r.id)) setLines((ls) => ls.filter((l) => l.sourceId !== r.id));
    else setLines((ls) => [...ls.filter((l) => l.sourceType || l.description || l.supply), { key: k(), description: `${r.poCode} ${r.poTitle} — 검수 ${r.code}`, accountId: null, costCodeId: null, supply: r.supplyAmount.split('.')[0], vat: r.vatAmount.split('.')[0], vatDeductible: true, sourceType: 'RECEIPT', sourceId: r.id, sourceCode: r.code }]);
  };

  const totals = useMemo(() => {
    const s = used.reduce((a, l) => a + int(l.supply), 0n);
    const v = used.reduce((a, l) => a + int(l.vat), 0n);
    return { supply: s, vat: v, total: s + v };
  }, [used]);

  const preview = useQuery({
    queryKey: ['approval-preview', 'PAYMENT_REQUEST', String(totals.total)],
    queryFn: () => api<{ drafter: string; steps: { title: string; roleKey: string; approverNames: string | null }[] }>(`/approvals/preview${qs({ docType: 'PAYMENT_REQUEST', amount: String(totals.total) })}`),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!h.title && !initial) {
      if (sourceMode && vendor) setH((x) => ({ ...x, title: `${vendor.name} 자재대금` }));
    }
  }, [sourceMode, vendor, h.title, initial]);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const accName = (id: string | null) => accounts.data?.find((a) => a.id === id);

  async function save(e: FormEvent) {
    e.preventDefault();
    const submit = submitAfter.current;
    submitAfter.current = false;
    setFormError(null);
    const local: Record<string, string> = {};
    if (!h.title.trim()) local.title = '제목을 입력해 주세요';
    if (sourceMode && !vendor) local.vendorId = '거래처를 먼저 선택해 주세요';
    if (!vendor && !h.payeeName.trim()) local.payeeName = '거래처를 고르거나 받는 분 이름을 입력해 주세요';
    if (!used.length) local.lines = sourceMode ? '지급할 검수 내역을 하나 이상 선택해 주세요' : '지급 항목을 하나 이상 입력해 주세요';
    if (!sourceMode) used.filter((l) => !l.sourceType).forEach((l) => {
      if (!l.description.trim()) local[`${l.key}.description`] = '내용';
      if (!l.accountId && !l.costCodeId) local[`${l.key}.account`] = '계정';
      if (int(l.supply) + int(l.vat) <= 0n) local[`${l.key}.supply`] = '금액';
    });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError(Object.keys(local).some((x) => x.includes('.')) ? '빨간 칸을 채워 주세요' : null);
      return;
    }
    let line: LineStep[] | undefined;
    if (submit) {
      const picked = await pickLine('PAYMENT_REQUEST', String(totals.total));
      if (picked === null) return;
      line = picked;
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      const body = {
        kind, title: h.title, requestDate: h.requestDate, dueDate: h.dueDate || null, projectId, vendorId: vendor?.id ?? null, payeeName: vendor ? null : h.payeeName, memo: h.memo,
        lines: used.map((l) => l.sourceType
          ? { sourceType: l.sourceType, sourceId: l.sourceId }
          : { description: l.description, accountId: l.costCodeId ? null : l.accountId, costCodeId: l.costCodeId, supplyAmount: l.supply || '0', vatAmount: l.vat || '0', vatDeductible: l.vatDeductible }),
      };
      const saved = initial
        ? await api<{ id: string; version: number }>(`/payment-requests/${initial.id}`, { method: 'PUT', json: { ...body, version: initial.version } })
        : await api<{ id: string; version: number }>('/payment-requests', { method: 'POST', json: body });
      if (submit) await api(`/payment-requests/${saved.id}/submit`, { method: 'POST', json: { version: saved.version, approvalLine: line } });
      onSaved(saved.id, submit);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.body.message);
      } else setFormError('저장하지 못했습니다');
    } finally {
      setBusy(null);
    }
  }

  const steps = [{ title: '담당', name: '작성자', state: 'waiting' as const }, ...(preview.data?.steps ?? []).map((s) => ({ title: s.title, name: s.approverNames ?? s.roleKey, state: 'waiting' as const }))];
  const proj = projectId;

  return (
    <form onSubmit={save} noValidate className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      {lineNode}
      <div className="min-w-0 space-y-4">
        <section className="rounded-[6px] border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="text-section font-semibold">지급 구분</h2>
            <SegTabs<Kind> label="지급 구분" value={kind} onChange={(v) => { setKind(v); setLines(v === 'PURCHASE' ? lines.filter((l) => l.sourceType === 'RECEIPT') : [...lines.filter((l) => !l.sourceType || (EXTRA_SOURCES[v] ?? []).some((t) => t.type === l.sourceType)), ...(lines.some((l) => !l.sourceType) ? [] : [blank()])]); }} items={(['PURCHASE', 'EXPENSE', 'SUBCONTRACT', 'LABOR', 'OTHER'] as Kind[]).map((v) => ({ value: v, label: PAYREQ_KIND[v] }))} />
          </header>
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="제목" required error={errors.title} className="lg:col-span-2"><Input value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} aria-invalid={!!errors.title} placeholder={sourceMode ? '예: 대한전기자재 10월 자재대금' : '예: 강서초 현장 안전용품 구입'} /></Field>
            <Field label="결의일" required><Input type="date" value={h.requestDate} onChange={(e) => setH({ ...h, requestDate: e.target.value })} /></Field>
            <Field label="현장" hint={sourceMode ? '비워 두면 검수 내역의 현장으로' : '본사 비용이면 비워 두세요'} className="lg:col-span-2"><ProjectPicker value={proj} onChange={setProjectId} placeholder="현장 (선택)" /></Field>
            <Field label="지급 예정일"><Input type="date" value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
            <Field label="거래처 (받는 곳)" required={sourceMode} error={errors.vendorId} className="lg:col-span-2" hint={!sourceMode ? '거래처가 있으면 승인 시 미지급금으로, 없으면 지급할 때 비용으로 처리합니다' : undefined}>
              <VendorPicker value={vendor?.id ?? null} display={vendor?.name} onChange={(v) => { setVendor(v); setErrors((e) => ({ ...e, vendorId: '', payeeName: '' })); if (sourceMode) setLines([]); }} invalid={!!errors.vendorId} />
            </Field>
            {!vendor && <Field label="받는 분" required error={errors.payeeName}><Input value={h.payeeName} onChange={(e) => setH({ ...h, payeeName: e.target.value })} placeholder="개인·소액 경비" aria-invalid={!!errors.payeeName} /></Field>}
            <Field label="메모" className="sm:col-span-full"><Textarea value={h.memo} onChange={(e) => setH({ ...h, memo: e.target.value })} rows={2} placeholder="지급 계좌, 증빙 등" /></Field>
          </div>
        </section>

        {sourceMode ? (
          <section className="rounded-[6px] border border-line bg-surface">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-section font-semibold">지급할 검수 내역 <span className="num font-normal text-muted">{srcLines.length}</span></h2>
              <p className="text-meta text-muted">검수(입고)가 끝난 금액만 지급할 수 있습니다. 금액은 검수 금액 그대로 쓰며 고칠 수 없습니다. 다른 결의에 들어간 검수는 보이지 않습니다.</p>
            </header>
            {!vendor ? <EmptyState icon={<PackageCheck className="size-7" strokeWidth={1.25} />} title="거래처를 먼저 선택하세요" description="선택한 거래처의 검수 내역 중 아직 지급결의하지 않은 것이 나옵니다." /> : receipts.isLoading ? <div className="p-6"><Spinner /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-body">
                  <thead><tr className="bg-surface-2 text-meta text-muted"><th className="w-10 px-3 py-2" /><th className="px-2 py-2 text-left font-medium">검수</th><th className="px-2 py-2 text-left font-medium">발주</th><th className="px-2 py-2 text-left font-medium">현장</th><th className="px-2 py-2 text-right font-medium">공급가액</th><th className="px-3 py-2 text-right font-medium">세액</th></tr></thead>
                  <tbody>
                    {srcLines.filter((l) => !(receipts.data ?? []).some((r) => r.id === l.sourceId)).map((l) => (
                      <tr key={l.key} className="border-t border-line bg-steel-soft/40">
                        <td className="px-3"><Checkbox checked onChange={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                        <td className="num px-2 py-2" colSpan={3}>{l.description}</td>
                        <td className="num px-2 text-right">{won(l.supply)}</td><td className="num px-3 text-right">{won(l.vat)}</td>
                      </tr>
                    ))}
                    {(receipts.data ?? []).map((r) => (
                      <tr key={r.id} className={clsx('cursor-pointer border-t border-line hover:bg-surface-hover', pickedIds.has(r.id) && 'bg-steel-soft/40')} onClick={() => toggleReceipt(r)}>
                        <td className="px-3" onClick={(e) => e.stopPropagation()}><Checkbox checked={pickedIds.has(r.id)} onChange={() => toggleReceipt(r)} /></td>
                        <td className="px-2 py-2"><span className="num">{r.code}</span> <span className="num text-meta text-muted">{r.receiptDate}</span></td>
                        <td className="px-2"><span className="num text-muted">{r.poCode}</span> {r.poTitle}</td>
                        <td className="px-2 text-ink-2">{r.projectName}</td>
                        <td className="num px-2 text-right">{won(r.supplyAmount)}</td>
                        <td className="num px-3 text-right">{won(r.vatAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!receipts.data?.length && !srcLines.length && <EmptyState title="지급할 검수 내역이 없습니다" description="이 거래처의 검수가 모두 지급결의되었거나 아직 검수된 발주가 없습니다." />}
              </div>
            )}
            {errors.lines && <p className="px-4 pb-3 text-meta text-seal">{errors.lines}</p>}
          </section>
        ) : (
          <section className="rounded-[6px] border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div>
                <h2 className="text-section font-semibold">지급 항목</h2>
                <p className="text-meta text-muted">현장 비용은 원가항목을, 본사 비용은 계정을 고르세요. 세액 칸 옆 ‘10%’를 누르면 부가세를 계산합니다.</p>
              </div>
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, blank()])}>항목 추가</Button>
            </header>
            {(tiLines.length > 0 || (tiSrc.data?.length ?? 0) > 0) && (
              <div className="border-b border-line bg-surface-2/60 px-4 py-2.5">
                <p className="mb-1.5 text-meta font-medium text-ink-2">{extraTypes.map((t) => t.label).join(' · ')}에서 가져오기 <span className="font-normal text-muted">— 금액은 원천 문서 그대로이며 이미 잡힌 채무를 정리합니다</span></p>
                <ul className="max-h-[280px] space-y-1 overflow-auto">
                  {[...tiLines.filter((l) => !(tiSrc.data ?? []).some((t) => t.id === l.sourceId)).map((l) => ({ id: l.sourceId!, code: l.sourceCode ?? '', title: l.description, supply: l.supply, vat: l.vat, type: l.sourceType! })), ...(tiSrc.data ?? [])].map((t) => (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1.5 py-1 hover:bg-surface-hover">
                        <Checkbox checked={tiLines.some((l) => l.sourceId === t.id)} onChange={() => toggleTi(t)} />
                        <span className="num shrink-0 text-muted">{t.code}</span><span className="min-w-0 flex-1 truncate">{t.title}</span>
                        <span className="num">{won(String(BigInt(t.supply.split('.')[0] || '0') + BigInt(t.vat.split('.')[0] || '0')))}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {extraTypes.some((t) => t.needVendor) && !vendor && <p className="border-b border-line px-4 py-2 text-meta text-muted">거래처를 고르면 그 거래처의 {extraTypes.map((t) => t.label).join('·')}을(를) 불러올 수 있습니다.</p>}
            <div className="divide-y divide-line">
              {manualLines.map((l, i) => {
                const a = accName(l.accountId);
                return (
                  <div key={l.key} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_200px_130px_130px_auto] md:items-start">
                    <Field label={i === 0 ? '내용' : ''} error={errors[`${l.key}.description`] ? '내용 입력' : undefined}><Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="예: 안전모·조끼 20세트" aria-invalid={!!errors[`${l.key}.description`]} aria-label="내용" /></Field>
                    <Field label={i === 0 ? (proj ? '원가항목 / 계정' : '계정') : ''} error={errors[`${l.key}.account`] ? '선택' : undefined}>
                      {proj ? (
                        <div className="space-y-1">
                          <CostCodeSelect value={l.costCodeId} onChange={(id) => setLine(l.key, { costCodeId: id, accountId: id ? null : l.accountId })} emptyLabel="원가항목 (현장 비용)" invalid={!!errors[`${l.key}.account`]} />
                          {!l.costCodeId && <AccountPicker value={l.accountId} onChange={(acc) => setLine(l.key, { accountId: acc?.id ?? null })} filter={(x) => x.type === 'EXPENSE' || x.type === 'ASSET'} compact />}
                        </div>
                      ) : (
                        <AccountPicker value={l.accountId} onChange={(acc) => setLine(l.key, { accountId: acc?.id ?? null })} filter={(x) => (x.type === 'EXPENSE' || x.type === 'ASSET') && !x.needsProject} invalid={!!errors[`${l.key}.account`]} compact />
                      )}
                      {a?.needsProject && !proj && <p className="text-[11px] text-seal">현장을 지정해야 하는 계정입니다</p>}
                    </Field>
                    <Field label={i === 0 ? '공급가액' : ''}><MoneyInput value={l.supply} onChange={(v) => setLine(l.key, { supply: v })} aria-label="공급가액" aria-invalid={!!errors[`${l.key}.supply`]} /></Field>
                    <Field label={i === 0 ? '세액' : ''}>
                      <div className="flex gap-1">
                        <MoneyInput value={l.vat} onChange={(v) => setLine(l.key, { vat: v })} aria-label="세액" />
                        <button type="button" className="shrink-0 rounded-[4px] border border-line px-1.5 text-meta text-muted hover:bg-surface-2" onClick={() => setLine(l.key, { vat: String(int(l.supply) / 10n) })} title="공급가액의 10% (원 미만 절사)">10%</button>
                      </div>
                      {int(l.vat) > 0n && <Checkbox checked={l.vatDeductible} onChange={(v) => setLine(l.key, { vatDeductible: v })} label={<span className="text-meta text-muted">매입세액 공제</span>} />}
                    </Field>
                    <div className={clsx('flex items-end justify-end', i === 0 && 'md:pt-5')}><IconButton label="항목 삭제" onClick={() => setLines((ls) => (ls.filter((x) => !x.sourceType).length === 1 ? [blank()] : ls.filter((x) => x.key !== l.key)))}><Trash2 className="size-4" /></IconButton></div>
                  </div>
                );
              })}
            </div>
            {errors.lines && <p className="px-4 pb-3 text-meta text-seal">{errors.lines}</p>}
            {!costCodes.data?.length && proj && <p className="px-4 pb-3 text-meta text-muted">원가항목을 불러오는 중…</p>}
          </section>
        )}
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <section className="rounded-[6px] border border-line bg-surface p-4">
          <dl className="space-y-1.5">
            <div className="flex justify-between text-muted"><dt>공급가액</dt><dd className="num">{won(String(totals.supply))}</dd></div>
            <div className="flex justify-between text-muted"><dt>세액</dt><dd className="num">{won(String(totals.vat))}</dd></div>
            <div className="flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">지급 합계</dt><dd className="num text-[20px] font-semibold">{won(String(totals.total))}<span className="ml-0.5 text-meta font-normal text-faint">원</span></dd></div>
          </dl>
          <div className="mt-4 overflow-x-auto"><ApprovalBox steps={steps} /></div>
          <p className="mt-2 text-meta text-muted">결재가 끝나야 지급할 수 있습니다. 지급(이체)은 결재 후 회계 담당이 따로 처리합니다.</p>
        </section>
        {formError && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{formError}</p>}
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" className="h-10" icon={<Send className="size-4" />} loading={busy === 'submit'} disabled={!!busy} onClick={() => (submitAfter.current = true)}>저장하고 결재 상신</Button>
          <Button type="submit" loading={busy === 'save'} disabled={!!busy}>임시저장</Button>
          <Button variant="ghost" onClick={onCancel}>취소</Button>
        </div>
      </aside>
    </form>
  );
}
