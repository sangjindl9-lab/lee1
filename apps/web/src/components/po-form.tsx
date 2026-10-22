'use client';

import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { ClipboardPaste, Plus, Send, Trash2 } from 'lucide-react';
import { ClipboardEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Combobox, type ComboOption } from '@/components/combobox';
import { CostCodeSelect } from '@/components/pickers';
import { ApprovalBox, Button, Field, Input, Textarea, Won } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { formatMoneyInput, won } from '@/lib/format';
import { TAX_TYPE, TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Material, PoDetail, TaxType, VendorRow } from '@/lib/types';

export interface LineDraft {
  key: string;
  materialId: string | null;
  name: string;
  spec: string;
  unit: string;
  qty: string;
  unitPrice: string;
  taxType: TaxType;
  memo: string;
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const blank = (): LineDraft => ({ key: newKey(), materialId: null, name: '', spec: '', unit: 'EA', qty: '', unitPrice: '', taxType: 'TAXABLE', memo: '' });
const trimDec = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

/** 소수 4자리까지의 수량 × 단가 → 원 미만 절사 (서버와 같은 규칙, 미리보기용) */
export function mulFloor(qty: string, price: string): bigint {
  const scale = (v: string) => {
    const [i, f = ''] = (v || '0').replace(/,/g, '').split('.');
    return BigInt((i || '0') + (f + '0000').slice(0, 4));
  };
  try {
    return (scale(qty) * scale(price)) / 100000000n;
  } catch {
    return 0n;
  }
}
const cleanNum = (v: string, dec = 4) => {
  const s = v.replace(/[^0-9.]/g, '');
  const [i, ...rest] = s.split('.');
  return rest.length ? `${i}.${rest.join('').slice(0, dec)}` : i;
};

/** 품명 칸: 입력하면 자재마스터에서 찾아 고를 수 있다 */
function NameCell({ line, vendorId, onPick, onChange, onKeyDown, cellRef }: { line: LineDraft; vendorId: string | null; onPick: (m: Material) => void; onChange: (v: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void; cellRef: (el: HTMLInputElement | null) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Material[]>([]);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open || line.name.trim().length < 1) return setItems([]);
    let alive = true;
    const t = setTimeout(() => {
      api<{ rows: Material[] }>(`/materials${qs({ q: line.name.trim(), size: 8, vendorId: vendorId ?? undefined })}`).then((r) => alive && (setItems(r.rows), setIdx(0))).catch(() => undefined);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [line.name, open, vendorId]);
  const show = open && items.length > 0 && rect;
  return (
    <>
      <input
        ref={(el) => {
          inputRef.current = el;
          cellRef(el);
        }}
        value={line.name}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setRect(e.currentTarget.getBoundingClientRect());
        }}
        onFocus={(e) => setRect(e.currentTarget.getBoundingClientRect())}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (show) {
            if (e.key === 'ArrowDown') return e.preventDefault(), setIdx((i) => Math.min(items.length - 1, i + 1));
            if (e.key === 'ArrowUp') return e.preventDefault(), setIdx((i) => Math.max(0, i - 1));
            if (e.key === 'Enter') return e.preventDefault(), onPick(items[idx]), setOpen(false);
            if (e.key === 'Escape') return setOpen(false);
          }
          onKeyDown(e);
        }}
        placeholder="품명 입력 또는 자재 검색"
        aria-label="품명"
        className="h-8 w-full min-w-[160px] bg-transparent px-2 outline-none placeholder:text-faint focus:bg-steel-soft/50"
        autoComplete="off"
      />
      {show &&
        createPortal(
          <ul className="animate-pop fixed z-[70] w-[420px] overflow-hidden rounded-[6px] border border-line bg-surface py-1 shadow-pop" style={{ top: rect.bottom + 2, left: rect.left }}>
            <li className="px-3 pb-1 text-[11px] text-faint">자재마스터 · ↑↓ 선택, Enter 넣기</li>
            {items.map((m, i) => (
              <li key={m.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onPick(m), setOpen(false))} onMouseEnter={() => setIdx(i)} className={clsx('flex w-full items-center gap-3 px-3 py-1.5 text-left', i === idx && 'bg-steel-soft')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name} <span className="text-muted">{m.spec}</span></span>
                    <span className="num block text-meta text-faint">{m.code} · {m.unit}{m.maker ? ` · ${m.maker}` : ''}</span>
                  </span>
                  <span className="num shrink-0 text-right text-meta">
                    {m.vendorPrice ? <><span className="block text-ink">{won(m.vendorPrice.unitPrice.split('.')[0])}</span><span className="block text-faint">이 거래처 최근</span></> : <span className="text-ink-2">{won(m.defaultPrice.split('.')[0], { blankZero: true })}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

const cellCls = 'h-8 w-full bg-transparent px-2 outline-none placeholder:text-faint focus:bg-steel-soft/50';

export interface PoSeed { requestId: string; requestCode: string; projectId: string; title: string; deliveryDate: string | null; memo: string | null; lines: { materialId: string | null; name: string; spec: string | null; unit: string; qty: string; memo: string | null }[] }

export function PoForm({ initial, seed, onSaved, onCancel }: { initial?: PoDetail; seed?: PoSeed; onSaved: (id: string, submitted: boolean) => void; onCancel: () => void }) {
  const { projects, project: ctxProject, me } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? seed?.projectId ?? ctxProject?.id ?? null);
  const [costCodeId, setCostCodeId] = useState<string | null>(initial?.costCodeId ?? null);
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(initial ? { id: initial.vendorId, name: initial.vendor.name } : null);
  const [h, setH] = useState({
    title: initial?.title ?? seed?.title ?? '', orderDate: initial?.orderDate ?? today, deliveryDate: initial?.deliveryDate ?? seed?.deliveryDate ?? '', deliveryPlace: initial?.deliveryPlace ?? '',
    paymentTerms: initial?.paymentTerms ?? '', ourContact: initial?.ourContact ?? me.user.name, ourPhone: initial?.ourPhone ?? '', vendorContact: initial?.vendorContact ?? '', memo: initial?.memo ?? seed?.memo ?? '',
  });
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial?.lines.length
      ? initial.lines.map((l) => ({ key: newKey(), materialId: l.materialId, name: l.name, spec: l.spec ?? '', unit: l.unit, qty: trimDec(l.qty), unitPrice: trimDec(l.unitPrice), taxType: l.taxType, memo: l.memo ?? '' }))
      : seed?.lines.length
        ? seed.lines.map((l) => ({ ...blank(), materialId: l.materialId, name: l.name, spec: l.spec ?? '', unit: l.unit, qty: trimDec(l.qty), memo: l.memo ?? '' }))
        : [blank(), blank(), blank()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const cells = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const formRef = useRef<HTMLFormElement>(null);
  const submitAfter = useRef(false);

  const proj = projects.find((p) => p.id === projectId) ?? null;
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<{ key: string; rate: string; effectiveFrom: string; effectiveTo: string | null }[]>('/settings/tax-rates'), staleTime: 3600_000 });
  const vatRate = useMemo(() => {
    const r = rates.data?.find((x) => x.key === 'VAT' && x.effectiveFrom <= h.orderDate && (!x.effectiveTo || x.effectiveTo >= h.orderDate));
    return r ? BigInt(Math.round(Number(r.rate) * 10000)) : 1000n;
  }, [rates.data, h.orderDate]);

  const used = lines.filter((l) => l.name.trim() || l.qty || l.unitPrice);
  const amounts = lines.map((l) => {
    const supply = mulFloor(l.qty, l.unitPrice);
    const vat = l.taxType === 'TAXABLE' ? (supply * vatRate) / 10000n : 0n;
    return { supply, vat };
  });
  const supplyTotal = amounts.reduce((a, b) => a + b.supply, 0n);
  const vatTotal = amounts.reduce((a, b) => a + b.vat, 0n);
  const total = supplyTotal + vatTotal;

  const preview = useQuery({
    queryKey: ['approval-preview', String(total)],
    queryFn: () => api<{ drafter: string; steps: { title: string; roleKey: string; approverNames: string | null }[] }>(`/approvals/preview${qs({ docType: 'PURCHASE_ORDER', amount: String(total) })}`),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });

  // 거래처를 고르면 결제조건·담당자를 채운다 (비어 있을 때만)
  const pickVendor = async (o: ComboOption | null) => {
    setVendor(o ? { id: o.id, name: o.label } : null);
    setErrors((e) => ({ ...e, vendorId: '' }));
    if (!o) return;
    try {
      const v = await api<VendorRow>(`/vendors/${o.id}`);
      setH((x) => ({ ...x, paymentTerms: x.paymentTerms || v.paymentTerms || '', vendorContact: x.vendorContact || v.contactName || '' }));
    } catch {
      /* 무시 */
    }
  };
  const searchVendors = useCallback(async (q: string) => {
    const r = await api<{ rows: VendorRow[] }>(`/vendors${qs({ q, size: 20 })}`);
    return r.rows.filter((v) => v.vendorType !== 'CLIENT').map((v) => ({ id: v.id, label: v.name, hint: [v.code, v.bizRegNo && `${v.bizRegNo.slice(0, 3)}-${v.bizRegNo.slice(3, 5)}-${v.bizRegNo.slice(5)}`, v.paymentTerms].filter(Boolean).join(' · ') }));
  }, []);
  const searchProjects = useCallback(async (q: string) => {
    return projects
      .filter((p) => p.status !== 'SETTLED' && (!q || p.name.includes(q) || p.code.toLowerCase().includes(q.toLowerCase())))
      .slice(0, 30)
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, hint: TRADE[p.tradeType].label }));
  }, [projects]);

  useEffect(() => {
    if (!h.title && proj && !initial) setH((x) => ({ ...x, title: `${proj.name} 자재 발주` }));
  }, [proj, initial, h.title]);

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickMaterial = (i: number, m: Material) => {
    const price = (m.vendorPrice?.unitPrice ?? m.defaultPrice).split('.')[0];
    setLine(i, { materialId: m.id, name: m.name, spec: m.spec ?? '', unit: m.unit, unitPrice: price === '0' ? '' : price, taxType: m.taxType });
    setTimeout(() => cells.current.get(`${lines[i].key}:qty`)?.focus(), 0);
  };
  const addRow = (focus = true) => {
    const l = blank();
    setLines((ls) => [...ls, l]);
    if (focus) setTimeout(() => cells.current.get(`${l.key}:name`)?.focus(), 0);
  };
  const removeRow = (i: number) => setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((_, j) => j !== i)));

  const COLS = ['name', 'spec', 'unit', 'qty', 'unitPrice', 'memo'] as const;
  /** 엑셀처럼 방향키·Enter 로 칸 이동, 마지막 행에서 Enter 면 새 행 */
  const nav = (i: number, col: (typeof COLS)[number]) => (e: KeyboardEvent<HTMLInputElement>) => {
    const ci = COLS.indexOf(col);
    const go = (ri: number, c: number) => cells.current.get(`${lines[ri]?.key}:${COLS[c]}`)?.focus();
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (i === lines.length - 1) addRow(false), setTimeout(() => go(i + 1, e.key === 'Enter' ? 0 : ci), 0);
      else go(i + 1, e.key === 'Enter' ? 0 : ci);
    } else if (e.key === 'ArrowUp') (e.preventDefault(), go(i - 1, ci));
    else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length && ci < COLS.length - 1) (e.preventDefault(), go(i, ci + 1));
    else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0 && ci > 0) (e.preventDefault(), go(i, ci - 1));
  };

  /** 엑셀에서 복사한 여러 행을 붙여넣기: 품명·규격·단위·수량·단가·비고 순서 */
  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.trim()).map((r) => r.split('\t'));
    const parsed: LineDraft[] = rows.map((c) => ({
      ...blank(), name: (c[0] ?? '').trim(), spec: (c[1] ?? '').trim(), unit: (c[2] ?? '').trim() || 'EA', qty: cleanNum(c[3] ?? ''), unitPrice: cleanNum(c[4] ?? ''), memo: (c[5] ?? '').trim(),
    }));
    setLines((ls) => {
      const before = ls.slice(0, i);
      const after = ls.slice(i + 1).filter((l) => l.name || l.qty || l.unitPrice);
      return [...before, ...parsed, ...after];
    });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const submit = submitAfter.current;
    submitAfter.current = false;
    setFormError(null);
    const local: Record<string, string> = {};
    if (!projectId) local.projectId = '현장을 선택해 주세요';
    if (!vendor) local.vendorId = '거래처를 선택해 주세요';
    if (!h.title.trim()) local.title = '발주 제목을 입력해 주세요';
    if (!used.length) local.lines = '품목을 하나 이상 입력해 주세요';
    used.forEach((l) => {
      const i = lines.indexOf(l);
      if (!l.name.trim()) local[`line.${i}.name`] = '품명';
      if (!l.qty || Number(l.qty) <= 0) local[`line.${i}.qty`] = '수량';
      if (l.unitPrice === '') local[`line.${i}.unitPrice`] = '단가';
    });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError(Object.keys(local).some((k) => k.startsWith('line.')) ? '빨간 칸의 품명·수량·단가를 입력해 주세요' : null);
      return;
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      const body = {
        projectId, vendorId: vendor!.id, ...h, deliveryDate: h.deliveryDate || null, costCodeId, ...(seed && !initial ? { requestId: seed.requestId } : {}),
        lines: used.map((l) => ({ materialId: l.materialId, name: l.name, spec: l.spec, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice || '0', taxType: l.taxType, memo: l.memo })),
      };
      const saved = initial
        ? await api<{ id: string; version: number }>(`/purchase-orders/${initial.id}`, { method: 'PUT', json: { ...body, version: initial.version } })
        : await api<{ id: string; version: number }>('/purchase-orders', { method: 'POST', json: body });
      if (submit) await api(`/purchase-orders/${saved.id}/submit`, { method: 'POST', json: { version: saved.version } });
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

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') (e.preventDefault(), formRef.current?.requestSubmit());
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const stepBoxes = [
    { title: '담당', name: me.user.name, state: 'waiting' as const },
    ...(preview.data?.steps ?? [{ title: '승인', roleKey: 'CEO', approverNames: null }]).map((s) => ({ title: s.title, name: s.approverNames ?? '대표이사', state: 'waiting' as const })),
  ];

  return (
    <form ref={formRef} onSubmit={save} noValidate className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-[6px] border border-line bg-surface">
          <header className="border-b border-line px-4 py-2.5"><h2 className="text-section font-semibold">발주 정보</h2></header>
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="현장" required error={errors.projectId} className="lg:col-span-2">
              <Combobox
                value={projectId}
                display={proj && <span className="flex items-center gap-2"><span aria-hidden className="h-3.5 w-1 rounded-[1px]" style={{ background: TRADE[proj.tradeType].color }} /><span className="num text-muted">{proj.code}</span>{proj.name}</span>}
                onChange={(o) => (setProjectId(o?.id ?? null), setErrors((e) => ({ ...e, projectId: '' })))}
                search={searchProjects}
                placeholder="현장 선택"
                invalid={!!errors.projectId}
              />
            </Field>
            <Field label="발주일" required error={errors.orderDate}><Input type="date" value={h.orderDate} onChange={(e) => setH({ ...h, orderDate: e.target.value })} /></Field>
            <Field label="거래처 (공급자)" required error={errors.vendorId} className="lg:col-span-2">
              <Combobox value={vendor?.id ?? null} display={vendor?.name} onChange={pickVendor} search={searchVendors} placeholder="거래처 검색" invalid={!!errors.vendorId} />
            </Field>
            <Field label="납품기한" error={errors.deliveryDate}><Input type="date" value={h.deliveryDate} onChange={(e) => setH({ ...h, deliveryDate: e.target.value })} aria-invalid={!!errors.deliveryDate} /></Field>
            <Field label="발주 제목" required error={errors.title} className="lg:col-span-2"><Input value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} aria-invalid={!!errors.title} /></Field>
            <Field label="원가항목" hint="현장 원가에 반영될 항목 (기본 재료비)"><CostCodeSelect value={costCodeId} onChange={(id) => setCostCodeId(id)} emptyLabel="재료비 (기본)" /></Field>
            <Field label="결제조건"><Input value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} placeholder="예: 월말 마감 익월 15일" /></Field>
            <Field label="납품장소" className="lg:col-span-2"><Input value={h.deliveryPlace} onChange={(e) => setH({ ...h, deliveryPlace: e.target.value })} placeholder="비워 두면 현장 주소" /></Field>
            <Field label="거래처 담당자"><Input value={h.vendorContact} onChange={(e) => setH({ ...h, vendorContact: e.target.value })} /></Field>
            <Field label="당사 담당자"><Input value={h.ourContact} onChange={(e) => setH({ ...h, ourContact: e.target.value })} /></Field>
            <Field label="당사 연락처"><Input value={h.ourPhone} onChange={(e) => setH({ ...h, ourPhone: e.target.value })} inputMode="tel" /></Field>
          </div>
        </section>

        <section className="rounded-[6px] border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div>
              <h2 className="text-section font-semibold">품목 <span className="num font-normal text-muted">{used.length}</span></h2>
              <p className="text-meta text-muted">품명 칸에 입력하면 자재마스터를 찾아 줍니다. 엑셀에서 품명·규격·단위·수량·단가 순으로 복사해 품명 칸에 붙여넣으면 여러 행이 한 번에 들어갑니다.</p>
            </div>
            <span className="flex items-center gap-1 text-meta text-faint"><ClipboardPaste className="size-3.5" />Ctrl+V 붙여넣기 · Enter 다음 행</span>
          </header>
          {errors.lines && <p className="border-b border-line bg-seal-soft px-4 py-2 text-meta text-seal">{errors.lines}</p>}
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-body">
              <thead>
                <tr className="bg-surface-2 text-meta text-muted">
                  <th className="w-9 border-b border-line py-2 text-center font-medium">#</th>
                  <th className="border-b border-line px-2 py-2 text-left font-medium">품명</th>
                  <th className="w-[150px] border-b border-line px-2 py-2 text-left font-medium">규격</th>
                  <th className="w-[64px] border-b border-line px-2 py-2 text-left font-medium">단위</th>
                  <th className="w-[84px] border-b border-line px-2 py-2 text-right font-medium">수량</th>
                  <th className="w-[108px] border-b border-line px-2 py-2 text-right font-medium">단가</th>
                  <th className="w-[112px] border-b border-line px-2 py-2 text-right font-medium">공급가액</th>
                  <th className="w-[92px] border-b border-line px-2 py-2 text-right font-medium">세액</th>
                  <th className="w-[68px] border-b border-line px-2 py-2 text-left font-medium">과세</th>
                  <th className="w-[120px] border-b border-line px-2 py-2 text-left font-medium">비고</th>
                  <th className="w-9 border-b border-line" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const bad = (c: string) => !!errors[`line.${i}.${c}`];
                  const ref = (c: string) => (el: HTMLInputElement | null) => void cells.current.set(`${l.key}:${c}`, el);
                  const td = (c: string, extra = '') => clsx('border-b border-line p-0', bad(c) && 'bg-seal-soft', extra);
                  return (
                    <tr key={l.key} className="group">
                      <td className="num border-b border-line text-center text-meta text-faint">{i + 1}</td>
                      <td className={td('name', 'border-l border-line/60')}>
                        <div className="flex items-center">
                          {l.materialId && <span title="자재마스터 연결됨" className="ml-2 size-1.5 shrink-0 rounded-full bg-steel" />}
                          <div className="min-w-0 flex-1" onPaste={onPaste(i) as never}>
                            <NameCell line={l} vendorId={vendor?.id ?? null} onPick={(m) => pickMaterial(i, m)} onChange={(v) => setLine(i, { name: v, materialId: null })} onKeyDown={nav(i, 'name')} cellRef={ref('name')} />
                          </div>
                        </div>
                      </td>
                      <td className={td('spec', 'border-l border-line/60')}><input ref={ref('spec')} value={l.spec} onChange={(e) => setLine(i, { spec: e.target.value })} onKeyDown={nav(i, 'spec')} className={cellCls} aria-label="규격" /></td>
                      <td className={td('unit', 'border-l border-line/60')}><input ref={ref('unit')} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} onKeyDown={nav(i, 'unit')} className={cellCls} aria-label="단위" /></td>
                      <td className={td('qty', 'border-l border-line/60')}><input ref={ref('qty')} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: cleanNum(e.target.value) })} onKeyDown={nav(i, 'qty')} className={clsx(cellCls, 'num text-right')} aria-label="수량" /></td>
                      <td className={td('unitPrice', 'border-l border-line/60')}>
                        <input ref={ref('unitPrice')} inputMode="numeric" value={l.unitPrice.includes('.') ? l.unitPrice : formatMoneyInput(l.unitPrice)} onChange={(e) => setLine(i, { unitPrice: cleanNum(e.target.value, 2) })} onKeyDown={nav(i, 'unitPrice')} className={clsx(cellCls, 'num text-right')} aria-label="단가" />
                      </td>
                      <td className="num border-b border-l border-line/60 bg-surface-2/50 px-2 text-right">{amounts[i].supply ? won(String(amounts[i].supply)) : ''}</td>
                      <td className="num border-b border-l border-line/60 bg-surface-2/50 px-2 text-right text-ink-2">{l.taxType === 'TAXABLE' ? (amounts[i].vat ? won(String(amounts[i].vat)) : '') : <span className="text-meta text-warn">{TAX_TYPE[l.taxType]}</span>}</td>
                      <td className="border-b border-l border-line/60 p-0">
                        <select value={l.taxType} onChange={(e) => setLine(i, { taxType: e.target.value as TaxType })} className="h-8 w-full bg-transparent px-1.5 text-meta outline-none focus:bg-steel-soft/50" aria-label="과세구분">
                          {Object.entries(TAX_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className={td('memo', 'border-l border-line/60')}><input ref={ref('memo')} value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} onKeyDown={nav(i, 'memo')} className={cellCls} aria-label="비고" /></td>
                      <td className="border-b border-line text-center">
                        <button type="button" onClick={() => removeRow(i)} className="grid size-7 place-items-center rounded-[4px] text-faint opacity-0 group-hover:opacity-100 hover:bg-seal-soft hover:text-seal focus-visible:opacity-100" aria-label={`${i + 1}행 삭제`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td colSpan={6} className="border-t-2 border-double border-line-strong px-3 py-2">
                    <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => addRow()}>행 추가</Button>
                  </td>
                  <td className="num border-t-2 border-double border-line-strong px-2 text-right">{won(String(supplyTotal))}</td>
                  <td className="num border-t-2 border-double border-line-strong px-2 text-right">{won(String(vatTotal))}</td>
                  <td colSpan={3} className="border-t-2 border-double border-line-strong" />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="rounded-[6px] border border-line bg-surface p-4">
          <Field label="특기사항" hint="발주서 아래 특기사항 칸에 인쇄됩니다. 기본 안내 문구(거래명세표 제출·세금계산서 발행 기준)는 자동으로 붙습니다.">
            <Textarea value={h.memo} onChange={(e) => setH({ ...h, memo: e.target.value })} rows={3} />
          </Field>
        </section>
      </div>

      <aside className="xl:sticky xl:top-[68px] xl:self-start">
        <div className="rounded-[6px] border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-meta text-muted">{initial ? <>발주번호 <span className="num text-ink">{initial.code}</span></> : '발주번호는 저장할 때 붙습니다'}</p>
          </div>
          <dl className="divide-y divide-line">
            <div className="flex items-baseline justify-between px-4 py-2"><dt className="text-muted">공급가액</dt><dd><Won value={String(supplyTotal)} unit /></dd></div>
            <div className="flex items-baseline justify-between px-4 py-2"><dt className="text-muted">부가세</dt><dd><Won value={String(vatTotal)} unit /></dd></div>
            <div className="flex items-baseline justify-between bg-surface-2 px-4 py-2.5"><dt className="font-medium">합계</dt><dd className="text-[17px] font-semibold"><Won value={String(total)} unit /></dd></div>
          </dl>
          <div className="border-t border-line px-4 py-3">
            <p className="mb-2 text-meta text-muted">결재선 — 상신하면 아래 순서로 결재합니다</p>
            <div className="overflow-x-auto"><ApprovalBox steps={stepBoxes} /></div>
          </div>
          {formError && <p role="alert" className="mx-4 mb-3 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{formError}</p>}
          <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
            <Button onClick={onCancel}>취소</Button>
            <Button type="submit" loading={busy === 'save'} disabled={!!busy}>임시저장</Button>
            <Button type="submit" variant="primary" className="col-span-2" loading={busy === 'submit'} disabled={!!busy} icon={<Send className="size-3.5" />} onClick={() => (submitAfter.current = true)}>
              {(preview.data?.steps.length ?? 1) > 1 ? '저장하고 결재 상신' : '저장하고 대표이사 결재 상신'}
            </Button>
          </div>
          <p className="px-4 pb-3 text-center text-[11px] text-faint">Ctrl+S 는 임시저장입니다</p>
        </div>
      </aside>
    </form>
  );
}

