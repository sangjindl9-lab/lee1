'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Scale } from 'lucide-react';
import { Fragment, Suspense } from 'react';
import { AccountPicker, BankSelect, ProjectPicker, useAccounts, VendorPicker } from '@/components/pickers';
import { Button, EmptyState, Field, Input, PageHeader, Skeleton, Tabs, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { bizNo, won } from '@/lib/format';
import { ACCOUNT_CATEGORY } from '@/lib/labels';
import { useSession } from '@/lib/session';

type Tab = 'account' | 'vendors' | 'tb' | 'general';
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

interface LedgerResp { account: { code: string; name: string; type: string }; opening: string; closing: string; totals: { debit: string; credit: string }; rows: { entry_id: string; code: string; entry_date: string; description: string; memo: string | null; debit: string; credit: string; balance: string; project_name: string | null; vendor_name: string | null }[] }

function AccountLedger({ p, set }: { p: Record<string, string>; set: (x: Record<string, string>) => void }) {
  const { company } = useSession();
  const accounts = useAccounts();
  const presets = [['101', '현금출납장'], ['103', '보통예금출납장'], ['251', '외상매입금'], ['108', '공사미수금'], ['501', '재료비']] as const;
  const q = useQuery({ queryKey: ['ledger-account', company.id, p], queryFn: () => api<LedgerResp>(`/ledger/account${qs(p)}`), enabled: !!p.accountId });
  const d = q.data;
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {presets.map(([code, label]) => {
          const a = accounts.data?.find((x) => x.code === code);
          return a ? <button key={code} type="button" onClick={() => set({ accountId: a.id })} className={clsx('h-7 rounded-[3px] border px-2.5 text-meta', p.accountId === a.id ? 'border-steel bg-steel-soft text-steel-ink' : 'border-line text-muted hover:text-ink')}>{label}</button> : null;
        })}
      </div>
      <div className="mb-4 grid gap-3 rounded-[6px] border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr_1.2fr]">
        <Field label="계정"><AccountPicker value={p.accountId || null} onChange={(a) => set({ accountId: a?.id ?? '' })} /></Field>
        <Field label="시작일"><Input type="date" value={p.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="종료일"><Input type="date" value={p.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        <Field label="현장"><ProjectPicker value={p.projectId || null} onChange={(id) => set({ projectId: id ?? '' })} placeholder="전체" includeSettled /></Field>
        <Field label={accounts.data?.find((a) => a.id === p.accountId)?.code === '103' ? '계좌' : '거래처'}>
          {accounts.data?.find((a) => a.id === p.accountId)?.code === '103' ? <BankSelect value={p.bankAccountId || null} onChange={(id) => set({ bankAccountId: id ?? '' })} includeKinds={['BANK']} /> : <VendorPicker value={p.vendorId || null} display={p.vendorName} onChange={(v) => set({ vendorId: v?.id ?? '', vendorName: v?.name ?? '' })} placeholder="전체" />}
        </Field>
      </div>
      {!p.accountId ? <EmptyState title="계정을 고르세요" description="위의 바로가기(현금출납장·보통예금출납장 등)를 누르거나 계정을 검색하세요." /> : !d ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[860px] text-body">
            <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-2 text-left font-medium">일자</th><th className="px-3 py-2 text-left font-medium">전표번호</th><th className="px-3 py-2 text-left font-medium">적요</th><th className="px-3 py-2 text-left font-medium">거래처·현장</th><th className="px-3 py-2 text-right font-medium">차변</th><th className="px-3 py-2 text-right font-medium">대변</th><th className="px-3 py-2 text-right font-medium">잔액</th></tr></thead>
            <tbody>
              <tr className="border-t border-line bg-surface-2/50 text-muted"><td className="num px-3 py-2">{p.from}</td><td /><td className="px-3">전기(월)이월</td><td /><td /><td /><td className="num px-3 text-right"><Won value={d.opening} /></td></tr>
              {d.rows.map((r, i) => (
                <tr key={i} className="border-t border-line hover:bg-surface-hover">
                  <td className="num px-3 py-1.5">{r.entry_date}</td>
                  <td className="px-3"><Link href={`/journals/${r.entry_id}`} className="num text-steel-ink hover:underline">{r.code}</Link></td>
                  <td className="px-3">{r.memo || r.description}</td>
                  <td className="px-3 text-meta text-muted">{[r.vendor_name, r.project_name].filter(Boolean).join(' · ')}</td>
                  <td className="num px-3 text-right">{Number(r.debit) ? won(r.debit) : ''}</td>
                  <td className="num px-3 text-right">{Number(r.credit) ? won(r.credit) : ''}</td>
                  <td className="num px-3 text-right"><Won value={r.balance} /></td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">이 기간에 승인된 거래가 없습니다</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td colSpan={4} className="px-3 py-2">합계 ({d.rows.length}건) · 차기이월</td><td className="num px-3 text-right">{won(d.totals.debit)}</td><td className="num px-3 text-right">{won(d.totals.credit)}</td><td className="num px-3 text-right"><Won value={d.closing} /></td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function VendorBalances({ p, set }: { p: Record<string, string>; set: (x: Record<string, string>) => void }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['ledger-vendors', company.id, p.to], queryFn: () => api<{ rows: { vendorId: string; vendorName: string; bizRegNo: string | null; receivable: string; payable: string; accounts: { code: string; name: string; balance: string }[] }[]; totals: { receivable: string; payable: string } }>(`/ledger/vendors${qs({ to: p.to })}`) });
  const accounts = useAccounts();
  const d = q.data;
  return (
    <>
      <div className="mb-4 flex items-end gap-3"><Field label="기준일"><Input type="date" value={p.to} onChange={(e) => set({ to: e.target.value })} className="w-[150px]" /></Field></div>
      {!d ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-body">
            <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-2 text-left font-medium">거래처</th><th className="px-3 py-2 text-left font-medium">계정별</th><th className="px-3 py-2 text-right font-medium">채권 (받을 돈)</th><th className="px-3 py-2 text-right font-medium">채무 (줄 돈)</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.vendorId} className="border-t border-line hover:bg-surface-hover">
                  <td className="px-3 py-2"><p className="font-medium">{r.vendorName}</p><p className="num text-meta text-muted">{bizNo(r.bizRegNo)}</p></td>
                  <td className="px-3 text-meta">
                    {r.accounts.map((a) => {
                      const acc = accounts.data?.find((x) => x.code === a.code);
                      return <button key={a.code} type="button" className="mr-2 text-steel-ink hover:underline" onClick={() => set({ tab: 'account', accountId: acc?.id ?? '', vendorId: r.vendorId, vendorName: r.vendorName, from: `${p.to.slice(0, 4)}-01-01` })}>{a.name} <span className="num"><Won value={a.balance} /></span></button>;
                    })}
                  </td>
                  <td className="num px-3 text-right"><Won value={r.receivable} blankZero /></td>
                  <td className="num px-3 text-right"><Won value={r.payable} blankZero /></td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted">잔액이 남은 거래처가 없습니다</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td colSpan={2} className="px-3 py-2">합계 {d.rows.length}곳</td><td className="num px-3 text-right">{won(d.totals.receivable)}</td><td className="num px-3 text-right">{won(d.totals.payable)}</td></tr></tfoot>
          </table>
          <p className="border-t border-line px-3 py-2 text-meta text-muted">음수(△) 채무는 세금계산서를 받기 전에 부가세까지 지급한 경우 등 선지급 상태입니다. 세금계산서를 등록하면 정리됩니다.</p>
        </div>
      )}
    </>
  );
}

function TrialBalance({ p, set }: { p: Record<string, string>; set: (x: Record<string, string>) => void }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['ledger-tb', company.id, p.to], queryFn: () => api<{ rows: { id: string; code: string; name: string; category: string; debitTotal: string; creditTotal: string; debitBalance: string; creditBalance: string }[]; totals: { debitTotal: string; creditTotal: string; debitBalance: string; creditBalance: string }; balanced: boolean; unapprovedDrafts: number }>(`/ledger/trial-balance${qs({ to: p.to })}`) });
  const d = q.data;
  let lastCat = '';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="기준일"><Input type="date" value={p.to} onChange={(e) => set({ to: e.target.value })} className="w-[150px]" /></Field>
        {d && <span className={clsx('mb-1.5 inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-meta font-medium', d.balanced ? 'bg-ok-soft text-ok' : 'bg-seal-soft text-seal')}><Scale className="size-3.5" />{d.balanced ? '차변 합계 = 대변 합계' : '차대 불일치 — 관리자에게 문의하세요'}</span>}
        {!!d?.unapprovedDrafts && <Link href="/journals?status=DRAFT" className="mb-1.5 text-meta text-warn underline">미승인 전표 {d.unapprovedDrafts}건은 포함되지 않았습니다</Link>}
      </div>
      {!d ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[760px] text-body">
            <thead>
              <tr className="bg-surface-2 text-meta text-muted"><th colSpan={2} className="border-b border-line px-3 py-1.5 font-medium">차변</th><th rowSpan={2} className="px-3 font-medium">계정과목</th><th colSpan={2} className="border-b border-line px-3 py-1.5 font-medium">대변</th></tr>
              <tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-1.5 text-right font-medium">잔액</th><th className="px-3 py-1.5 text-right font-medium">합계</th><th className="px-3 py-1.5 text-right font-medium">합계</th><th className="px-3 py-1.5 text-right font-medium">잔액</th></tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const head = r.category !== lastCat;
                lastCat = r.category;
                return (
                  <Fragment key={r.id}>
                    {head && <tr className="bg-surface-2/60"><td colSpan={5} className="px-3 py-1 text-meta font-medium text-muted">{ACCOUNT_CATEGORY[r.category] ?? r.category}</td></tr>}
                    <tr className="border-t border-line hover:bg-surface-hover">
                      <td className="num px-3 py-1.5 text-right">{Number(r.debitBalance) ? won(r.debitBalance) : ''}</td>
                      <td className="num px-3 text-right text-ink-2">{Number(r.debitTotal) ? won(r.debitTotal) : ''}</td>
                      <td className="px-3 text-center"><button type="button" className="hover:underline" onClick={() => r.id !== 'PRIOR' && set({ tab: 'account', accountId: r.id, from: `${p.to.slice(0, 4)}-01-01` })}><span className="num text-muted">{r.code}</span> {r.name}</button></td>
                      <td className="num px-3 text-right text-ink-2">{Number(r.creditTotal) ? won(r.creditTotal) : ''}</td>
                      <td className="num px-3 text-right">{Number(r.creditBalance) ? won(r.creditBalance) : ''}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td className="num px-3 py-2 text-right">{won(d.totals.debitBalance)}</td><td className="num px-3 text-right">{won(d.totals.debitTotal)}</td><td className="px-3 text-center">합계</td><td className="num px-3 text-right">{won(d.totals.creditTotal)}</td><td className="num px-3 text-right">{won(d.totals.creditBalance)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function GeneralLedger({ p, set }: { p: Record<string, string>; set: (x: Record<string, string>) => void }) {
  const { company } = useSession();
  const year = p.year || today().slice(0, 4);
  const q = useQuery({ queryKey: ['ledger-general', company.id, year], queryFn: () => api<{ id: string; code: string; name: string; opening: string; closing: string; months: { ym: string; debit: string; credit: string; balance: string }[] }[]>(`/ledger/general${qs({ year })}`) });
  return (
    <>
      <div className="mb-4 flex items-end gap-3"><Field label="연도"><Input type="number" value={year} onChange={(e) => set({ year: e.target.value })} className="w-[110px]" /></Field></div>
      {!q.data ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[1400px] text-meta">
            <thead><tr className="bg-surface-2 text-muted"><th className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium">계정과목</th><th className="px-2 py-2 text-right font-medium">기초</th>{Array.from({ length: 12 }, (_, i) => <th key={i} className="px-2 py-2 text-right font-medium">{i + 1}월</th>)}<th className="px-3 py-2 text-right font-medium">기말</th></tr></thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id} className="border-t border-line hover:bg-surface-hover">
                  <td className="sticky left-0 bg-surface px-3 py-1.5 whitespace-nowrap"><button type="button" className="hover:underline" onClick={() => set({ tab: 'account', accountId: a.id, from: `${year}-01-01`, to: `${year}-12-31` })}><span className="num text-muted">{a.code}</span> {a.name}</button></td>
                  <td className="num px-2 text-right text-muted"><Won value={a.opening} blankZero /></td>
                  {a.months.map((m) => <td key={m.ym} className="num px-2 text-right" title={`차변 ${won(m.debit)} / 대변 ${won(m.credit)}`}><Won value={m.balance} blankZero /></td>)}
                  <td className="num px-3 text-right font-medium"><Won value={a.closing} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-muted">각 칸은 그 달 말 잔액입니다. 칸에 마우스를 올리면 그 달 차변·대변 합계가 보입니다.</p>
        </div>
      )}
    </>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can } = useSession();
  const t = today();
  const p: Record<string, string> = { tab: sp.get('tab') ?? 'account', accountId: sp.get('accountId') ?? '', from: sp.get('from') ?? `${t.slice(0, 7)}-01`, to: sp.get('to') ?? t, projectId: sp.get('projectId') ?? '', vendorId: sp.get('vendorId') ?? '', vendorName: sp.get('vendorName') ?? '', bankAccountId: sp.get('bankAccountId') ?? '', year: sp.get('year') ?? '' };
  const set = (x: Record<string, string>) => router.replace(`/ledgers${qs({ ...p, ...x })}`, { scroll: false });
  const tab = p.tab as Tab;
  const exportKind = tab === 'account' ? 'account' : tab === 'vendors' ? 'vendors' : tab === 'tb' ? 'trial-balance' : null;
  if (!can('journal:read')) return <EmptyState title="장부를 볼 권한이 없습니다" />;
  return (
    <>
      <PageHeader
        title="원장·시산표"
        description="승인된 전표만 집계합니다. 금액을 누르면 해당 전표로 이동합니다."
        actions={exportKind && can('journal:export') ? <Button icon={<Download className="size-3.5" />} disabled={tab === 'account' && !p.accountId} onClick={() => download(`/ledger/export.xlsx${qs({ kind: exportKind, accountId: p.accountId || undefined, from: p.from, to: p.to, projectId: p.projectId || undefined, vendorId: p.vendorId || undefined, bankAccountId: p.bankAccountId || undefined })}`, '장부.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button> : undefined}
      />
      <Tabs<Tab> value={tab} onChange={(v) => set({ tab: v })} items={[{ value: 'account', label: '계정별원장' }, { value: 'vendors', label: '거래처 채권·채무' }, { value: 'tb', label: '합계잔액시산표' }, { value: 'general', label: '총계정원장' }]} />
      <div className="mt-4">
        {tab === 'account' && <AccountLedger p={p} set={set} />}
        {tab === 'vendors' && <VendorBalances p={p} set={set} />}
        {tab === 'tb' && <TrialBalance p={p} set={set} />}
        {tab === 'general' && <GeneralLedger p={p} set={set} />}
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
