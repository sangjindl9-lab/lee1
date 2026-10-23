'use client';

import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Field, Input, MoneyInput, Select, Textarea, Won } from '@/components/ui';
import { VendorPicker } from '@/components/pickers';
import { api, ApiError } from '@/lib/api';
import { addDigits, pct, previewVat } from '@/lib/format';
import { CONTRACT_ROLE, SECTOR, STATUS, TRADE, type ProjectStatus, type TradeType } from '@/lib/labels';
import type { ProjectDetail } from '@/lib/types';

export interface ProjectFormValues {
  name: string; tradeType: TradeType | ''; status: ProjectStatus; contractRole: keyof typeof CONTRACT_ROLE; clientSector: keyof typeof SECTOR;
  clientName: string; primeContractor: string; subContractor: string; siteAddress: string; contractType: string;
  contractDate: string; startDate: string; plannedEndDate: string; actualEndDate: string;
  supplyAmount: string; vatAmount: string; vatManual: boolean; executionBudget: string; jointShareRate: string; progressRate: string;
  managerName: string; siteManagerName: string; memo: string;
  clientVendor: { id: string; name: string } | null; advanceAmount: string; retentionPercent: string;
}

const intOf = (v: string) => (v ?? '0').split('.')[0];

export function toForm(p?: ProjectDetail): ProjectFormValues {
  return {
    name: p?.name ?? '', tradeType: p?.tradeType ?? '', status: p?.status ?? 'PLANNED', contractRole: p?.contractRole ?? 'PRIME', clientSector: p?.clientSector ?? 'PRIVATE',
    clientName: p?.clientName ?? '', primeContractor: p?.primeContractor ?? '', subContractor: p?.subContractor ?? '', siteAddress: p?.siteAddress ?? '', contractType: p?.contractType ?? '',
    contractDate: p?.contractDate ?? '', startDate: p?.startDate ?? '', plannedEndDate: p?.plannedEndDate ?? '', actualEndDate: p?.actualEndDate ?? '',
    supplyAmount: p ? intOf(p.supplyAmount) : '', vatAmount: p ? intOf(p.vatAmount) : '',
    // 저장된 부가세가 자동 계산값과 다르면 직접 입력했던 값이므로 그대로 유지
    vatManual: !!p && intOf(p.vatAmount) !== previewVat(intOf(p.supplyAmount), Number(p.vatRate)),
    executionBudget: p ? intOf(p.executionBudget) : '', jointShareRate: p?.jointSharePercent ?? '', progressRate: p ? String(Number(p.progressPercent)) : '0',
    managerName: p?.managerName ?? '', siteManagerName: p?.siteManagerName ?? '', memo: p?.memo ?? '',
    clientVendor: p?.clientVendorId ? { id: p.clientVendorId, name: p.clientName ?? '발주처' } : null, advanceAmount: p ? intOf(p.advanceAmount ?? '0') : '', retentionPercent: p ? String(Number(p.retentionPercent ?? 0)) : '0',
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-line bg-surface">
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-section font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-meta text-muted">{description}</p>}
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex rounded-[4px] border border-line-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('h-7 flex-1 rounded-[3px] px-2 text-body whitespace-nowrap', value === o.value ? 'bg-steel-soft font-medium text-steel-ink' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProjectForm({ initial, seed, submitLabel, onSubmit, onCancel, code }: { initial?: ProjectDetail; seed?: Partial<ProjectFormValues>; submitLabel: string; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void; code?: string }) {
  const [v, setV] = useState<ProjectFormValues>(() => ({ ...toForm(initial), ...seed }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof ProjectFormValues>(k: K, val: ProjectFormValues[K]) => {
    setV((o) => ({ ...o, [k]: val }));
    setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  };

  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<{ key: string; rate: string; effectiveFrom: string; effectiveTo: string | null }[]>('/settings/tax-rates'), staleTime: 3600_000 });
  const vatRate = useMemo(() => {
    const on = v.contractDate || new Date().toISOString().slice(0, 10);
    const r = rates.data?.find((x) => x.key === 'VAT' && x.effectiveFrom <= on && (!x.effectiveTo || x.effectiveTo >= on));
    return r ? Number(r.rate) : null;
  }, [rates.data, v.contractDate]);

  const autoVat = vatRate === null ? '' : previewVat(v.supplyAmount, vatRate);
  const vat = v.vatManual ? v.vatAmount : autoVat;
  const total = addDigits(v.supplyAmount, vat);
  const margin = v.executionBudget ? (BigInt(v.supplyAmount || '0') - BigInt(v.executionBudget || '0')).toString() : null;
  const marginRate = margin !== null && Number(v.supplyAmount) > 0 ? Number(margin) / Number(v.supplyAmount) : null;
  const vatDiff = v.vatManual && autoVat && v.vatAmount ? Number(v.vatAmount) - Number(autoVat) : 0;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!v.name.trim()) local.name = '공사명을 입력해 주세요';
    if (!v.tradeType) local.tradeType = '공사구분을 선택해 주세요';
    if (!v.supplyAmount) local.supplyAmount = '계약 공급가액을 입력해 주세요 (미정이면 0)';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: v.name, tradeType: v.tradeType, status: v.status, contractRole: v.contractRole, clientSector: v.clientSector,
        clientName: v.clientName, primeContractor: v.primeContractor, subContractor: v.subContractor, siteAddress: v.siteAddress, contractType: v.contractType,
        contractDate: v.contractDate || null, startDate: v.startDate || null, plannedEndDate: v.plannedEndDate || null, actualEndDate: v.actualEndDate || null,
        supplyAmount: v.supplyAmount || '0', vatAmount: v.vatManual ? v.vatAmount || '0' : null, executionBudget: v.executionBudget || '0',
        jointShareRate: v.contractRole === 'JOINT' && v.jointShareRate ? Number(v.jointShareRate) : null, progressRate: Number(v.progressRate || 0),
        clientVendorId: v.clientVendor?.id ?? null, advanceAmount: v.advanceAmount || '0', retentionPercent: Number(v.retentionPercent || 0),
        managerName: v.managerName, siteManagerName: v.siteManagerName, memo: v.memo,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.body.message);
      } else setFormError('저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  // Ctrl+S 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const err = (k: string) => errors[k] || undefined;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <Section title="기본 정보">
          <Field label="공사명" required error={err('name')} className="sm:col-span-2" htmlFor="name">
            <Input id="name" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 강서초등학교 전기설비 개선공사" aria-invalid={!!err('name')} autoFocus={!initial} />
          </Field>
          <Field label="공사구분" required error={err('tradeType')} className="sm:col-span-2">
            <div role="radiogroup" aria-label="공사구분" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(TRADE) as TradeType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={v.tradeType === t}
                  onClick={() => set('tradeType', t)}
                  className={clsx('flex h-10 items-center gap-2.5 rounded-[4px] border px-3 text-left', v.tradeType === t ? 'border-steel bg-steel-soft font-medium text-ink' : 'border-line-strong text-ink-2 hover:border-faint')}
                >
                  <span aria-hidden className="h-5 w-1.5 rounded-[1px]" style={{ background: TRADE[t].color }} />
                  {TRADE[t].label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="공사 상태">
            <Select value={v.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
              {(Object.keys(STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </Select>
          </Field>
          <Field label="공정률" error={err('progressRate')} hint="0~100%">
            <div className="relative">
              <Input inputMode="decimal" value={v.progressRate} onChange={(e) => set('progressRate', e.target.value.replace(/[^0-9.]/g, ''))} className="num pr-7 text-right" />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">%</span>
            </div>
          </Field>
          <Field label="현장 주소" className="sm:col-span-2">
            <Input value={v.siteAddress} onChange={(e) => set('siteAddress', e.target.value)} />
          </Field>
        </Section>

        <Section title="계약 당사자" description="원도급·하도급·공동도급 구분에 따라 기성과 정산 방식이 달라집니다.">
          <Field label="도급 구분">
            <Segmented name="도급 구분" value={v.contractRole} onChange={(x) => set('contractRole', x)} options={(Object.keys(CONTRACT_ROLE) as (keyof typeof CONTRACT_ROLE)[]).map((k) => ({ value: k, label: CONTRACT_ROLE[k] }))} />
          </Field>
          <Field label="발주 구분">
            <Segmented name="발주 구분" value={v.clientSector} onChange={(x) => set('clientSector', x)} options={(Object.keys(SECTOR) as (keyof typeof SECTOR)[]).map((k) => ({ value: k, label: SECTOR[k] }))} />
          </Field>
          <Field label="발주처" hint="거래처에서 고르면 기성·수금 채권이 그 거래처로 잡힙니다">
            <VendorPicker value={v.clientVendor?.id ?? null} display={v.clientVendor?.name} onChange={(o) => setV((x) => ({ ...x, clientVendor: o, clientName: o ? o.name : x.clientName }))} placeholder={v.clientName || '거래처 검색'} />
          </Field>
          <Field label="계약형태" hint="총액·단가·장기계속 등">
            <Input value={v.contractType} onChange={(e) => set('contractType', e.target.value)} list="contract-types" />
            <datalist id="contract-types"><option value="총액계약" /><option value="단가계약" /><option value="장기계속계약" /><option value="계속비계약" /></datalist>
          </Field>
          <Field label="원도급사">
            <Input value={v.primeContractor} onChange={(e) => set('primeContractor', e.target.value)} placeholder={v.contractRole === 'PRIME' ? '당사가 원도급이면 비워 두세요' : ''} />
          </Field>
          <Field label="하도급사">
            <Input value={v.subContractor} onChange={(e) => set('subContractor', e.target.value)} />
          </Field>
          {v.contractRole === 'JOINT' && (
            <Field label="공동도급 지분율" required error={err('jointShareRate')} hint="당사 지분">
              <div className="relative">
                <Input inputMode="decimal" value={v.jointShareRate} onChange={(e) => set('jointShareRate', e.target.value.replace(/[^0-9.]/g, ''))} className="num pr-7 text-right" aria-invalid={!!err('jointShareRate')} />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">%</span>
              </div>
            </Field>
          )}
        </Section>

        <Section title="일정">
          <Field label="계약일" error={err('contractDate')} hint="부가세율은 계약일 기준으로 적용됩니다"><Input type="date" value={v.contractDate} onChange={(e) => set('contractDate', e.target.value)} /></Field>
          <Field label="착공일" error={err('startDate')}><Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label="준공예정일" error={err('plannedEndDate')}><Input type="date" value={v.plannedEndDate} onChange={(e) => set('plannedEndDate', e.target.value)} aria-invalid={!!err('plannedEndDate')} /></Field>
          <Field label="실제 준공일" error={err('actualEndDate')}><Input type="date" value={v.actualEndDate} onChange={(e) => set('actualEndDate', e.target.value)} aria-invalid={!!err('actualEndDate')} /></Field>
        </Section>

        <Section title="계약금액·실행예산" description="부가세와 합계는 서버에서 다시 계산해 검증합니다. 공종·원가항목별 실행예산은 현장관리 > 실행예산에서 나누어 관리합니다.">
          <Field label="계약 공급가액" required error={err('supplyAmount')} htmlFor="supply">
            <MoneyInput id="supply" value={v.supplyAmount} onChange={(d) => set('supplyAmount', d)} aria-invalid={!!err('supplyAmount')} />
          </Field>
          <Field
            label="부가가치세"
            error={err('vatAmount')}
            hint={v.vatManual ? (vatDiff ? <span className={clsx(Math.abs(vatDiff) > 10 && 'text-seal')}>자동 계산값과 {vatDiff > 0 ? '+' : ''}{vatDiff.toLocaleString('ko-KR')}원 차이 (±10원까지 허용)</span> : '계약서 금액과 단수 차이가 있을 때만 직접 입력') : vatRate !== null ? `${(vatRate * 100).toFixed(0)}% 자동 계산 · 원 미만 절사` : '세율 설정이 없습니다'}
          >
            <MoneyInput value={vat} onChange={(d) => set('vatAmount', d)} disabled={!v.vatManual} />
          </Field>
          <div className="sm:col-span-2 -mt-2">
            <Checkbox checked={v.vatManual} onChange={(c) => setV((o) => ({ ...o, vatManual: c, vatAmount: c ? autoVat : '' }))} label={<span className="text-meta text-ink-2">부가세 직접 입력</span>} />
          </div>
          <Field label="실행예산" error={err('executionBudget')} hint="계획 원가 총액">
            <MoneyInput value={v.executionBudget} onChange={(d) => set('executionBudget', d)} />
          </Field>
          <Field label="선급금 (공급가)" hint="계약상 받을 선급금 — 기성에서 나누어 공제">
            <MoneyInput value={v.advanceAmount} onChange={(d) => set('advanceAmount', d)} />
          </Field>
          <Field label="기성 유보율" hint="기성마다 떼어 두는 비율 (없으면 0)">
            <div className="relative">
              <Input inputMode="decimal" value={v.retentionPercent} onChange={(e) => set('retentionPercent', e.target.value.replace(/[^0-9.]/g, ''))} className="num pr-7 text-right" />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">%</span>
            </div>
          </Field>
        </Section>

        <Section title="담당">
          <Field label="현장소장"><Input value={v.siteManagerName} onChange={(e) => set('siteManagerName', e.target.value)} /></Field>
          <Field label="현장담당자(공무)"><Input value={v.managerName} onChange={(e) => set('managerName', e.target.value)} /></Field>
          <Field label="메모" className="sm:col-span-2"><Textarea value={v.memo} onChange={(e) => set('memo', e.target.value)} rows={3} /></Field>
        </Section>
      </div>

      {/* 우측 고정 요약 */}
      <aside className="lg:sticky lg:top-[68px] lg:self-start">
        <div className="rounded-[6px] border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-meta text-muted">{code ? `공사관리번호 ${code}` : '공사관리번호는 저장할 때 자동으로 붙습니다'}</p>
          </div>
          <dl className="divide-y divide-line">
            {[
              ['공급가액', <Won key="s" value={v.supplyAmount || '0'} unit />],
              ['부가가치세', <Won key="v" value={vat || '0'} unit />],
            ].map(([k, val]) => (
              <div key={k as string} className="flex items-baseline justify-between px-4 py-2"><dt className="text-muted">{k}</dt><dd>{val}</dd></div>
            ))}
            <div className="flex items-baseline justify-between bg-surface-2 px-4 py-2.5">
              <dt className="font-medium">계약총액</dt>
              <dd className="text-[17px] font-semibold"><Won value={total || '0'} unit /></dd>
            </div>
            <div className="flex items-baseline justify-between px-4 py-2"><dt className="text-muted">실행예산</dt><dd><Won value={v.executionBudget || '0'} unit /></dd></div>
            <div className="flex items-baseline justify-between px-4 py-2">
              <dt className="text-muted">계획 이익</dt>
              <dd className="text-right">{margin === null ? <span className="text-faint">–</span> : <><Won value={margin} unit /><span className={clsx('num ml-2 text-meta', marginRate !== null && marginRate < 0 ? 'text-seal' : 'text-muted')}>{pct(marginRate)}</span></>}</dd>
            </div>
          </dl>
          {formError && <p role="alert" className="mx-4 mb-3 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{formError}</p>}
          <div className="flex gap-2 border-t border-line p-3">
            <Button type="button" onClick={onCancel} className="flex-1">취소</Button>
            <Button type="submit" variant="primary" loading={busy} className="flex-[2]">{submitLabel}</Button>
          </div>
          <p className="px-4 pb-3 text-center text-[11px] text-faint">Ctrl+S 로도 저장할 수 있습니다</p>
        </div>
      </aside>
    </form>
  );
}
