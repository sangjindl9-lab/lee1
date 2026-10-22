'use client';

import clsx from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, TriangleAlert } from 'lucide-react';
import { Fragment, Suspense } from 'react';
import { ProjectPicker } from '@/components/pickers';
import { Button, EmptyState, Field, Input, PageHeader, Skeleton, Tabs, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { pct, won } from '@/lib/format';
import { useSession } from '@/lib/session';

type Tab = 'income' | 'balance' | 'cost';
interface Sec { key?: string; label: string; rows: { id: string; code: string; name: string; amount: string }[]; total: string }

function Statement({ title, period, children }: { title: string; period: string; children: React.ReactNode }) {
  const { company } = useSession();
  return (
    <div className="mx-auto max-w-[760px] rounded-[2px] bg-white px-6 py-8 text-[13px] text-[#17202b] shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_24px_-12px_rgb(16_24_40/0.18)] ring-1 ring-black/5 sm:px-10 [color-scheme:light]">
      <h2 className="text-center text-[22px] font-bold tracking-[0.3em]">{title}</h2>
      <p className="num mt-1 text-center text-[12px] text-[#5b6573]">{period}</p>
      <p className="mt-4 flex justify-between border-b-2 border-[#17202b] pb-1 text-[12px]"><span>회사명: {company.name}</span><span>(단위: 원)</span></p>
      {children}
    </div>
  );
}

function IncomeStatement({ from, to, projectId }: { from: string; to: string; projectId: string }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['is', company.id, from, to, projectId], queryFn: () => api<{ sections: Sec[]; netIncome: string; grossMarginRate: string | null }>(`/ledger/income-statement${qs({ from, to, projectId: projectId || undefined })}`) });
  if (!q.data) return <Skeleton className="h-96" />;
  const subtotal = ['GROSS', 'OP', 'PRETAX', 'NET'];
  return (
    <Statement title={projectId ? '현장 손익계산서' : '손익계산서'} period={`${from} 부터 ${to} 까지`}>
      <table className="mt-2 w-full">
        <tbody>
          {q.data.sections.map((s) => (
            <Fragment key={s.key}>
              <tr className={clsx(subtotal.includes(s.key!) ? 'border-y border-[#17202b] font-bold' : 'font-semibold')}>
                <td className="py-1.5">{s.label}</td><td /><td className="num py-1.5 text-right"><Won value={s.total} /></td>
              </tr>
              {s.rows.map((r) => <tr key={r.id} className="text-[#3a4452]"><td className="py-0.5 pl-6">{r.name.replace('공사원가-', '')}</td><td className="num py-0.5 text-right"><Won value={r.amount} /></td><td /></tr>)}
            </Fragment>
          ))}
        </tbody>
      </table>
      {q.data.grossMarginRate && <p className="mt-3 text-right text-[12px] text-[#5b6573]">매출총이익률 {pct(q.data.grossMarginRate)}</p>}
    </Statement>
  );
}

function BalanceSheet({ to }: { to: string }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['bs', company.id, to], queryFn: () => api<{ assets: { sections: Sec[]; total: string }; liabilities: { sections: Sec[]; total: string }; equity: { rows: Sec['rows']; total: string }; balanced: boolean; difference: string }>(`/ledger/balance-sheet${qs({ to })}`) });
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  const block = (label: string, secs: Sec[], total: string) => (
    <>
      <tr className="border-t-2 border-[#17202b] font-bold"><td className="py-1.5">{label}</td><td /><td className="num text-right"><Won value={total} /></td></tr>
      {secs.map((s) => (
        <Fragment key={s.label}>
          <tr className="font-semibold"><td className="py-1 pl-3">{s.label}</td><td /><td className="num text-right"><Won value={s.total} /></td></tr>
          {s.rows.map((r) => <tr key={r.id} className="text-[#3a4452]"><td className="py-0.5 pl-8">{r.name}</td><td className="num text-right"><Won value={r.amount} /></td><td /></tr>)}
        </Fragment>
      ))}
    </>
  );
  return (
    <>
      <p className={clsx('mx-auto mb-3 flex max-w-[760px] items-center gap-1.5 text-meta', d.balanced ? 'text-ok' : 'text-seal')}>{d.balanced ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}{d.balanced ? '자산 = 부채 + 자본' : `자산과 부채+자본이 ${won(d.difference)}원 다릅니다 — 관리자에게 문의하세요`}</p>
      <Statement title="재무상태표" period={`${to} 현재`}>
        <table className="mt-2 w-full">
          <tbody>
            {block('자산', d.assets.sections, d.assets.total)}
            {block('부채', d.liabilities.sections, d.liabilities.total)}
            <tr className="border-t-2 border-[#17202b] font-bold"><td className="py-1.5">자본</td><td /><td className="num text-right"><Won value={d.equity.total} /></td></tr>
            {d.equity.rows.map((r) => <tr key={r.id} className="text-[#3a4452]"><td className="py-0.5 pl-8">{r.name}</td><td className="num text-right"><Won value={r.amount} /></td><td /></tr>)}
            <tr className="border-y-2 border-double border-[#17202b] font-bold"><td className="py-1.5">부채와 자본 총계</td><td /><td className="num text-right"><Won value={String(BigInt(d.liabilities.total.split('.')[0]) + BigInt(d.equity.total.split('.')[0]))} /></td></tr>
          </tbody>
        </table>
      </Statement>
    </>
  );
}

function CostStatement({ from, to, projectId }: { from: string; to: string; projectId: string }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['cs', company.id, from, to, projectId], queryFn: () => api<{ accounts: { code: string; name: string }[]; projects: { id: string | null; code: string | null; name: string; cells: Record<string, string>; total: string }[]; totals: Record<string, string>; grandTotal: string }>(`/ledger/cost-statement${qs({ from, to, projectId: projectId || undefined })}`) });
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  if (!d.projects.length) return <EmptyState title="이 기간에 승인된 공사원가가 없습니다" />;
  return (
    <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
      <table className="w-full text-body" style={{ minWidth: 360 + d.accounts.length * 120 }}>
        <thead><tr className="bg-surface-2 text-meta text-muted"><th className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium">현장</th>{d.accounts.map((a) => <th key={a.code} className="px-3 py-2 text-right font-medium whitespace-nowrap">{a.name.replace('공사원가-', '')}</th>)}<th className="px-3 py-2 text-right font-medium">합계</th></tr></thead>
        <tbody>
          {d.projects.map((p) => (
            <tr key={p.id ?? 'none'} className="border-t border-line hover:bg-surface-hover">
              <td className="sticky left-0 bg-surface px-3 py-2 whitespace-nowrap"><span className="num text-muted">{p.code}</span> {p.name}</td>
              {d.accounts.map((a) => <td key={a.code} className="num px-3 text-right"><Won value={p.cells[a.code]} blankZero /></td>)}
              <td className="num px-3 text-right font-medium"><Won value={p.total} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td className="sticky left-0 bg-surface-2 px-3 py-2">합계</td>{d.accounts.map((a) => <td key={a.code} className="num px-3 text-right"><Won value={d.totals[a.code]} /></td>)}<td className="num px-3 text-right"><Won value={d.grandTotal} /></td></tr></tfoot>
      </table>
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can } = useSession();
  const t = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const p = { tab: (sp.get('tab') ?? 'income') as Tab, from: sp.get('from') ?? `${t.slice(0, 4)}-01-01`, to: sp.get('to') ?? t, projectId: sp.get('projectId') ?? '' };
  const set = (x: Partial<typeof p>) => router.replace(`/statements${qs({ ...p, ...x })}`, { scroll: false });
  if (!can('journal:read')) return <EmptyState title="재무제표를 볼 권한이 없습니다" />;
  const kind = { income: 'income-statement', balance: 'balance-sheet', cost: 'cost-statement' }[p.tab];
  return (
    <>
      <PageHeader title="재무제표" description="승인된 전표 기준입니다. 미승인 전표는 반영되지 않습니다."
        actions={can('journal:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/ledger/export.xlsx${qs({ kind, from: p.from, to: p.to, projectId: p.projectId || undefined })}`, `${kind}.xlsx`).catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>} />
      <Tabs<Tab> value={p.tab} onChange={(v) => set({ tab: v })} items={[{ value: 'income', label: '손익계산서' }, { value: 'balance', label: '재무상태표' }, { value: 'cost', label: '공사원가명세서' }]} />
      <div className="my-4 flex flex-wrap items-end gap-3">
        {p.tab !== 'balance' && <Field label="시작일"><Input type="date" value={p.from} onChange={(e) => set({ from: e.target.value })} className="w-[150px]" /></Field>}
        <Field label={p.tab === 'balance' ? '기준일' : '종료일'}><Input type="date" value={p.to} onChange={(e) => set({ to: e.target.value })} className="w-[150px]" /></Field>
        {p.tab !== 'balance' && <Field label="현장 (현장별 보기)" className="w-[300px]"><ProjectPicker value={p.projectId || null} onChange={(id) => set({ projectId: id ?? '' })} placeholder="회사 전체" includeSettled /></Field>}
      </div>
      {p.tab === 'income' && <IncomeStatement from={p.from} to={p.to} projectId={p.projectId} />}
      {p.tab === 'balance' && <BalanceSheet to={p.to} />}
      {p.tab === 'cost' && <CostStatement from={p.from} to={p.to} projectId={p.projectId} />}
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
