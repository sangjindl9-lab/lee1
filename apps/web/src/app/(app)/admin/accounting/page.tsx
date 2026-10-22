'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, Suspense, useState } from 'react';
import { AccountPicker } from '@/components/pickers';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, Tabs, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { ACCOUNT_CATEGORY, ACCOUNT_TYPE, MAT_TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';

type Tab = 'accounts' | 'costcodes' | 'rules';
interface Account { id: string; code: string; name: string; type: string; category: string; needsVendor: boolean; needsProject: boolean; isSystem: boolean; isActive: boolean; memo: string | null; lineCount: number }
interface CostCode { id: string; code: string; name: string; accountId: string; accountCode: string; accountName: string; tradeType: string | null; sortOrder: number; isActive: boolean; isSystem: boolean }
interface Rule { key: string; label: string; description: string; accountId: string | null; code: string | null; name: string | null }
const CAT_TYPE: Record<string, string> = { CURRENT_ASSET: 'ASSET', NONCURRENT_ASSET: 'ASSET', CURRENT_LIABILITY: 'LIABILITY', NONCURRENT_LIABILITY: 'LIABILITY', EQUITY: 'EQUITY', SALES: 'REVENUE', NON_OP_INCOME: 'REVENUE', CONSTRUCTION_COST: 'EXPENSE', SGA: 'EXPENSE', NON_OP_EXPENSE: 'EXPENSE', TAX: 'EXPENSE' };

function AccountDialog({ a, onClose, onSaved }: { a: Account | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: a?.code ?? '', name: a?.name ?? '', category: a?.category ?? 'SGA', needsVendor: a?.needsVendor ?? false, needsProject: a?.needsProject ?? false, isActive: a?.isActive ?? true, memo: a?.memo ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, type: CAT_TYPE[f.category] };
      if (a) await api(`/accounts/${a.id}`, { method: 'PUT', json: body });
      else await api('/accounts', { method: 'POST', json: body });
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiError ? x.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  const locked = !!a && a.lineCount > 0;
  return (
    <Dialog open onClose={onClose} title={a ? `${a.code} ${a.name}` : '계정과목 추가'} footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" loading={busy} onClick={() => save()}>저장</Button></>}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="코드" required hint={locked ? '분개에 쓰인 계정은 코드를 바꿀 수 없습니다' : '숫자 3~6자리'}><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={locked} inputMode="numeric" /></Field>
        <Field label="이름" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="재무제표 구분" className="sm:col-span-2"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} disabled={locked}>{Object.entries(ACCOUNT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v} ({ACCOUNT_TYPE[CAT_TYPE[k]]})</option>)}</Select></Field>
        <div className="space-y-1.5 sm:col-span-2">
          <Checkbox checked={f.needsProject} onChange={(v) => setF({ ...f, needsProject: v })} label="분개할 때 현장을 반드시 지정 (공사원가·공사미수금 등)" />
          <Checkbox checked={f.needsVendor} onChange={(v) => setF({ ...f, needsVendor: v })} label="분개할 때 거래처를 반드시 지정 (채권·채무 계정)" />
          {a && <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="사용" />}
        </div>
        {err && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal sm:col-span-2">{err}</p>}
      </form>
    </Dialog>
  );
}

function CostCodeDialog({ c, onClose, onSaved }: { c: CostCode | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', accountId: c?.accountId ?? null as string | null, tradeType: c?.tradeType ?? 'COMMON', sortOrder: String(c?.sortOrder ?? 100), isActive: c?.isActive ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, sortOrder: Number(f.sortOrder) || 100 };
      if (c) await api(`/cost-codes/${c.id}`, { method: 'PUT', json: body });
      else await api('/cost-codes', { method: 'POST', json: body });
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiError ? x.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={c ? c.name : '원가항목 추가'} footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" loading={busy} onClick={save}>저장</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="코드" required hint="예: E01 (전기 전용)"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="이름" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 수변전설비" /></Field>
        <Field label="연결 공사원가 계정" required className="sm:col-span-2"><AccountPicker value={f.accountId} onChange={(a) => setF({ ...f, accountId: a?.id ?? null })} filter={(a) => a.type === 'EXPENSE'} /></Field>
        <Field label="공종"><Select value={f.tradeType} onChange={(e) => setF({ ...f, tradeType: e.target.value })}>{Object.entries(MAT_TRADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="표시 순서"><Input value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></Field>
        {c && <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="사용" />}
        {err && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal sm:col-span-2">{err}</p>}
      </div>
    </Dialog>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (sp.get('tab') ?? 'accounts') as Tab;
  const { can, company } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = can('journal:approve');
  const accs = useQuery({ queryKey: ['accounts-admin', company.id], queryFn: () => api<Account[]>('/accounts'), enabled: tab === 'accounts' });
  const ccs = useQuery({ queryKey: ['cost-codes', company.id], queryFn: () => api<CostCode[]>('/cost-codes'), enabled: tab === 'costcodes' });
  const rules = useQuery({ queryKey: ['posting-rules', company.id], queryFn: () => api<Rule[]>('/posting-rules'), enabled: tab === 'rules' });
  const [accDlg, setAccDlg] = useState<Account | null | 'new'>(null);
  const [ccDlg, setCcDlg] = useState<CostCode | null | 'new'>(null);
  const [cat, setCat] = useState('');
  const refresh = () => { ['accounts-admin', 'account-options', 'cost-codes', 'posting-rules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('ok', '저장했습니다'); };
  if (!can('journal:read')) return <EmptyState title="권한이 없습니다" />;
  return (
    <>
      <PageHeader title="계정과목·분개 규칙" description="회사 회계 기준에 맞게 계정과 원가항목, 업무별 자동분개에 쓰이는 계정을 정합니다." />
      <Tabs<Tab> value={tab} onChange={(t) => router.replace(`/admin/accounting?tab=${t}`)} items={[{ value: 'accounts', label: '계정과목' }, { value: 'costcodes', label: '원가항목(공종)' }, { value: 'rules', label: '자동분개 규칙' }]} />
      <div className="mt-4">
        {tab === 'accounts' && (!accs.data ? <Skeleton className="h-96" /> : (
          <div className="rounded-[6px] border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
              <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-[200px]"><option value="">모든 구분</option>{Object.entries(ACCOUNT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <span className="flex-1" />
              {edit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAccDlg('new')}>계정 추가</Button>}
            </div>
            <table className="w-full text-body">
              <thead><tr className="bg-surface-2 text-meta text-muted"><th className="w-20 px-3 py-2 text-left font-medium">코드</th><th className="px-3 py-2 text-left font-medium">계정과목</th><th className="px-3 py-2 text-left font-medium">구분</th><th className="px-3 py-2 text-left font-medium max-md:hidden">필수 지정</th><th className="px-3 py-2 text-right font-medium max-md:hidden">사용 건수</th></tr></thead>
              <tbody>
                {accs.data.filter((a) => !cat || a.category === cat).map((a) => (
                  <tr key={a.id} className={`border-t border-line ${edit ? 'cursor-pointer hover:bg-surface-hover' : ''} ${a.isActive ? '' : 'text-muted'}`} onClick={() => edit && setAccDlg(a)}>
                    <td className="num px-3 py-1.5">{a.code}</td>
                    <td className="px-3">{a.name} {!a.isActive && <Badge tone="muted">사용 안 함</Badge>}</td>
                    <td className="px-3 text-meta text-ink-2">{ACCOUNT_CATEGORY[a.category]}</td>
                    <td className="px-3 text-meta text-muted max-md:hidden">{[a.needsProject && '현장', a.needsVendor && '거래처'].filter(Boolean).join(' · ')}</td>
                    <td className="num px-3 text-right text-muted max-md:hidden">{a.lineCount || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tab === 'costcodes' && (!ccs.data ? <Skeleton className="h-96" /> : (
          <div className="rounded-[6px] border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line p-2.5"><p className="px-1 text-meta text-muted">실행예산·발주·경비를 이 항목으로 나눠 현장 원가를 봅니다. 전기·통신·건축 전용 공종을 추가할 수 있습니다.</p>{can('budget:update') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCcDlg('new')}>원가항목 추가</Button>}</div>
            <table className="w-full text-body">
              <thead><tr className="bg-surface-2 text-meta text-muted"><th className="w-20 px-3 py-2 text-left font-medium">코드</th><th className="px-3 py-2 text-left font-medium">원가항목</th><th className="px-3 py-2 text-left font-medium">공사원가 계정</th><th className="px-3 py-2 text-left font-medium">공종</th></tr></thead>
              <tbody>
                {ccs.data.map((c) => (
                  <tr key={c.id} className={`border-t border-line ${can('budget:update') ? 'cursor-pointer hover:bg-surface-hover' : ''} ${c.isActive ? '' : 'text-muted'}`} onClick={() => can('budget:update') && setCcDlg(c)}>
                    <td className="num px-3 py-1.5">{c.code}</td><td className="px-3 font-medium">{c.name}</td><td className="px-3 text-ink-2"><span className="num text-muted">{c.accountCode}</span> {c.accountName}</td><td className="px-3 text-meta">{c.tradeType ? MAT_TRADE[c.tradeType] : '공통'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tab === 'rules' && (!rules.data ? <Skeleton className="h-96" /> : (
          <div className="rounded-[6px] border border-line bg-surface">
            <p className="border-b border-line px-4 py-2.5 text-meta text-muted">검수·지급·기성 같은 업무를 처리하면 이 규칙의 계정으로 전표가 자동으로 만들어집니다. 공사원가 계정은 원가항목에서 정합니다.</p>
            <ul className="divide-y divide-line">
              {rules.data.map((r) => (
                <li key={r.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_280px] sm:items-center">
                  <div><p className="font-medium">{r.label}</p><p className="text-meta text-muted">{r.description}</p></div>
                  {edit ? <AccountPicker value={r.accountId} onChange={async (a) => { if (!a) return; try { await api(`/posting-rules/${r.key}`, { method: 'PUT', json: { accountId: a.id } }); refresh(); } catch (e) { toast('error', e instanceof ApiError ? e.body.message : '저장 실패'); } }} /> : <span className="num">{r.code} {r.name}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {accDlg && <AccountDialog a={accDlg === 'new' ? null : accDlg} onClose={() => setAccDlg(null)} onSaved={() => { setAccDlg(null); refresh(); }} />}
      {ccDlg && <CostCodeDialog c={ccDlg === 'new' ? null : ccDlg} onClose={() => setCcDlg(null)} onSaved={() => { setCcDlg(null); refresh(); }} />}
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
