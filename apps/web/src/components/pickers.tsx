'use client';

import { useQuery } from '@tanstack/react-query';
import { ReactNode, useCallback } from 'react';
import { Combobox, type ComboOption } from './combobox';
import { Select } from './ui';
import { api, qs } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { VendorRow } from '@/lib/types';

export interface AccountOpt { id: string; code: string; name: string; type: string; category: string; needsProject: boolean; needsVendor: boolean }
export interface CostCodeOpt { id: string; code: string; name: string; accountId: string; accountCode: string; accountName: string; tradeType: string | null; isActive: boolean; sortOrder: number }
export interface BankOpt { id: string; kind: 'BANK' | 'CARD' | 'CASH'; name: string; bankName: string | null; accountNoMask: string | null }

export function useAccounts() {
  const { company } = useSession();
  return useQuery({ queryKey: ['account-options', company.id], queryFn: () => api<AccountOpt[]>('/accounts/options'), staleTime: 5 * 60_000 });
}
export function useCostCodes() {
  const { company } = useSession();
  return useQuery({ queryKey: ['cost-codes', company.id], queryFn: () => api<CostCodeOpt[]>('/cost-codes'), staleTime: 5 * 60_000 });
}
export function useBankOptions() {
  const { company } = useSession();
  return useQuery({ queryKey: ['bank-options', company.id], queryFn: () => api<BankOpt[]>('/bank-accounts/options'), staleTime: 60_000 });
}

export function ProjectPicker({ value, onChange, invalid, placeholder = '현장 선택', allowClear = true, includeSettled = false, className }: { value: string | null; onChange: (id: string | null) => void; invalid?: boolean; placeholder?: string; allowClear?: boolean; includeSettled?: boolean; className?: string }) {
  const { projects } = useSession();
  const proj = projects.find((p) => p.id === value) ?? null;
  const search = useCallback(async (q: string) => {
    const s = q.trim().toLowerCase();
    return projects
      .filter((p) => (includeSettled || p.status !== 'SETTLED') && (!s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)))
      .slice(0, 40)
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, hint: TRADE[p.tradeType].label }));
  }, [projects, includeSettled]);
  return (
    <Combobox
      className={className}
      value={value}
      allowClear={allowClear}
      display={proj && <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="h-3.5 w-1 shrink-0 rounded-[1px]" style={{ background: TRADE[proj.tradeType].color }} /><span className="num shrink-0 text-muted">{proj.code}</span><span className="truncate">{proj.name}</span></span>}
      onChange={(o) => onChange(o?.id ?? null)}
      search={search}
      placeholder={placeholder}
      invalid={invalid}
    />
  );
}

export function VendorPicker({ value, display, onChange, invalid, placeholder = '거래처 검색', types, className }: { value: string | null; display?: ReactNode; onChange: (o: { id: string; name: string } | null) => void; invalid?: boolean; placeholder?: string; types?: VendorRow['vendorType'][]; className?: string }) {
  const search = useCallback(async (q: string) => {
    const r = await api<{ rows: VendorRow[] }>(`/vendors${qs({ q, size: 20 })}`);
    return r.rows.filter((v) => !types || types.includes(v.vendorType)).map((v) => ({ id: v.id, label: v.name, hint: [v.code, bizNo(v.bizRegNo)].filter(Boolean).join(' · ') }));
  }, [types]);
  return <Combobox className={className} value={value} display={display} onChange={(o: ComboOption | null) => onChange(o ? { id: o.id, name: o.label } : null)} search={search} placeholder={placeholder} invalid={invalid} />;
}

const CAT_ORDER = ['CONSTRUCTION_COST', 'SGA', 'CURRENT_ASSET', 'NONCURRENT_ASSET', 'CURRENT_LIABILITY', 'NONCURRENT_LIABILITY', 'EQUITY', 'SALES', 'NON_OP_INCOME', 'NON_OP_EXPENSE', 'TAX'];

export function AccountPicker({ value, onChange, invalid, filter, placeholder = '계정 검색 (코드·이름)', className, compact }: { value: string | null; onChange: (a: AccountOpt | null) => void; invalid?: boolean; filter?: (a: AccountOpt) => boolean; placeholder?: string; className?: string; compact?: boolean }) {
  const q = useAccounts();
  const list = (q.data ?? []).filter((a) => !filter || filter(a));
  const cur = list.find((a) => a.id === value) ?? q.data?.find((a) => a.id === value);
  const search = useCallback(async (s: string) => {
    const t = s.trim();
    return list
      .filter((a) => !t || a.code.startsWith(t) || a.name.includes(t))
      .sort((a, b) => (t ? 0 : CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category)) || a.code.localeCompare(b.code))
      .slice(0, 60)
      .map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, hint: a.needsProject ? '현장 지정' : a.needsVendor ? '거래처 지정' : undefined }));
  }, [list]);
  return (
    <Combobox
      className={className}
      value={value}
      display={cur && <span className="truncate"><span className="num text-muted">{cur.code}</span> {cur.name}</span>}
      onChange={(o) => onChange(o ? (q.data ?? []).find((a) => a.id === o.id) ?? null : null)}
      search={search}
      placeholder={compact ? '계정' : placeholder}
      invalid={invalid}
    />
  );
}

export function CostCodeSelect({ value, onChange, className, allowEmpty = true, emptyLabel = '원가항목 선택', invalid }: { value: string | null; onChange: (id: string | null, c?: CostCodeOpt) => void; className?: string; allowEmpty?: boolean; emptyLabel?: string; invalid?: boolean }) {
  const q = useCostCodes();
  return (
    <Select className={className} value={value ?? ''} aria-invalid={invalid} onChange={(e) => onChange(e.target.value || null, q.data?.find((c) => c.id === e.target.value))}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {(q.data ?? []).filter((c) => c.isActive || c.id === value).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  );
}

export function BankSelect({ value, onChange, className, includeKinds }: { value: string | null; onChange: (id: string | null) => void; className?: string; includeKinds?: BankOpt['kind'][] }) {
  const q = useBankOptions();
  const KIND = { BANK: '계좌', CARD: '카드', CASH: '현금' } as const;
  return (
    <Select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">기본 계좌 (보통예금)</option>
      {(q.data ?? []).filter((b) => !includeKinds || includeKinds.includes(b.kind)).map((b) => <option key={b.id} value={b.id}>[{KIND[b.kind]}] {b.name}{b.accountNoMask ? ` ${b.accountNoMask}` : ''}</option>)}
    </Select>
  );
}
