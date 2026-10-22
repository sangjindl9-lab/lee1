'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Eye, Landmark, Plus, Wallet } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { AccountPicker } from '@/components/pickers';
import { Badge, Button, Checkbox, Drawer, EmptyState, Field, Input, MoneyInput, PageHeader, Select, Skeleton, Textarea, useToast, Won } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Bank { id: string; kind: 'BANK' | 'CARD' | 'CASH'; name: string; bankName: string | null; accountNoMask: string | null; holder: string | null; accountId: string; accountCode: string; accountName: string; openingBalance: string; openingDate: string | null; isActive: boolean; memo: string | null; bookBalance: string; lastEntryDate: string | null; version: number }
const KIND = { BANK: { label: '은행 계좌', icon: Landmark }, CARD: { label: '법인카드', icon: CreditCard }, CASH: { label: '현금', icon: Wallet } } as const;

function BankDrawer({ b, onClose, onSaved }: { b: Bank | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: b?.kind ?? 'BANK', name: b?.name ?? '', bankName: b?.bankName ?? '', accountNo: '', holder: b?.holder ?? '', accountId: b?.accountId ?? null as string | null, openingBalance: b?.openingBalance.split('.')[0].replace('-', '') ?? '', negative: b ? b.openingBalance.startsWith('-') : false, openingDate: b?.openingDate ?? '', isActive: b?.isActive ?? true, memo: b?.memo ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = { kind: f.kind, name: f.name, bankName: f.bankName || null, accountNo: f.accountNo || null, holder: f.holder || null, accountId: f.accountId, openingBalance: `${f.negative ? '-' : ''}${f.openingBalance || '0'}`, openingDate: f.openingDate || null, isActive: f.isActive, memo: f.memo || null };
      if (b) await api(`/bank-accounts/${b.id}`, { method: 'PUT', json: { ...body, version: b.version } });
      else await api('/bank-accounts', { method: 'POST', json: body });
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiError ? x.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open onClose={onClose} title={b ? b.name : '계좌·카드 등록'} subtitle="지급·수금할 때 어느 계좌로 처리했는지 고르면 계좌별 출납장이 만들어집니다" footer={<><Button onClick={onClose}>취소</Button><Button type="submit" form="bank-form" variant="primary" loading={busy}>저장</Button></>}>
      <form id="bank-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="종류" required><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Bank['kind'], accountId: null })} disabled={!!b}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="별칭" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 국민 운영계좌" /></Field>
          {f.kind !== 'CASH' && <Field label={f.kind === 'CARD' ? '카드사' : '은행'}><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>}
          {f.kind !== 'CASH' && (
            <Field label={f.kind === 'CARD' ? '카드번호' : '계좌번호'} hint={b?.accountNoMask ? <>현재 <span className="num">{revealed ?? b.accountNoMask}</span> {!revealed && <button type="button" className="inline-flex items-center gap-0.5 text-steel-ink underline" onClick={async () => setRevealed((await api<{ accountNo: string | null }>(`/bank-accounts/${b.id}/reveal`, { method: 'POST' })).accountNo)}><Eye className="size-3" />원문 보기</button>} · 바꿀 때만 입력</> : '암호화되어 저장되고 가려서 표시됩니다'}>
              <Input value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} inputMode="numeric" autoComplete="off" />
            </Field>
          )}
          {f.kind === 'BANK' && <Field label="예금주"><Input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></Field>}
          <Field label="연결 계정" hint="비우면 기본값 (계좌: 보통예금, 현금: 현금, 카드: 미지급금)" className="sm:col-span-2"><AccountPicker value={f.accountId} onChange={(a) => setF({ ...f, accountId: a?.id ?? null })} filter={(a) => (f.kind === 'CARD' ? a.type === 'LIABILITY' : a.type === 'ASSET')} /></Field>
        </div>
        <fieldset className="rounded-[4px] border border-line p-3">
          <h3 className="mb-1 text-meta font-medium text-ink-2">기초잔액</h3>
          <p className="mb-3 text-meta text-muted">ERP를 쓰기 시작한 날의 잔액을 넣으면 그날짜로 (계좌 / 이월이익잉여금) 기초 전표가 자동으로 만들어집니다.</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <Field label="기준일"><Input type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></Field>
            <Field label={f.kind === 'CARD' ? '미결제 사용액' : '잔액'}><MoneyInput value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} /></Field>
          </div>
          {f.kind !== 'CARD' && <Checkbox checked={f.negative} onChange={(v) => setF({ ...f, negative: v })} label={<span className="text-meta">마이너스 통장 (음수 잔액)</span>} />}
        </fieldset>
        <Field label="메모"><Textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
        {b && <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="사용 중 (끄면 지급 화면에서 숨김)" />}
        {err && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{err}</p>}
      </form>
    </Drawer>
  );
}

export default function Page() {
  const { can, company } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['banks', company.id], queryFn: () => api<Bank[]>('/bank-accounts') });
  const [edit, setEdit] = useState<Bank | null | 'new'>(null);
  if (!can('bank:read')) return <EmptyState title="계좌 정보를 볼 권한이 없습니다" />;
  const total = (kind: Bank['kind']) => (q.data ?? []).filter((b) => b.kind === kind && b.isActive).reduce((a, b) => a + BigInt(b.bookBalance.split('.')[0]), 0n);
  return (
    <>
      <PageHeader title="계좌·카드" description="장부상 잔액은 승인된 전표 기준입니다. 통장 실제 잔액과 다르면 미승인 전표나 누락된 거래가 있는지 확인하세요."
        actions={can('bank:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>계좌·카드 등록</Button>} />
      {!q.data ? <Skeleton className="h-64" /> : !q.data.length ? (
        <div className="rounded-[6px] border border-line bg-surface"><EmptyState icon={<Landmark className="size-8" strokeWidth={1.25} />} title="등록된 계좌가 없습니다" description="운영 계좌와 법인카드를 등록해 두면 지급할 때 출금 계좌를 고를 수 있고, 계좌별 출납장이 만들어집니다." action={can('bank:create') ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>계좌 등록</Button> : undefined} /></div>
      ) : (
        <>
          <dl className="mb-4 grid gap-3 sm:grid-cols-3">
            {(['BANK', 'CASH', 'CARD'] as const).map((k) => { const I = KIND[k].icon; return <div key={k} className="rounded-[6px] border border-line bg-surface px-4 py-3"><dt className="flex items-center gap-1.5 text-meta text-muted"><I className="size-3.5" />{k === 'CARD' ? '카드 미결제' : KIND[k].label} 합계</dt><dd className="num mt-0.5 text-[20px] font-semibold"><Won value={String(total(k))} /><span className="ml-0.5 text-meta font-normal text-faint">원</span></dd></div>; })}
          </dl>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.data.map((b) => {
              const I = KIND[b.kind].icon;
              return (
                <li key={b.id} className={`rounded-[6px] border border-line bg-surface p-4 ${b.isActive ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold"><I className="size-4 text-muted" />{b.name}</p><p className="num mt-0.5 truncate text-meta text-muted">{[b.bankName, b.accountNoMask, b.holder].filter(Boolean).join(' · ') || KIND[b.kind].label}</p></div>
                    {!b.isActive && <Badge tone="muted">사용 안 함</Badge>}
                  </div>
                  <p className="num mt-3 text-[22px] font-semibold"><Won value={b.bookBalance} /><span className="ml-0.5 text-meta font-normal text-faint">원</span></p>
                  <p className="text-meta text-muted">{b.kind === 'CARD' ? '미결제 사용액' : '장부 잔액'} · <span className="num">{b.accountCode} {b.accountName}</span>{b.lastEntryDate && <> · 최근 거래 <span className="num">{b.lastEntryDate}</span></>}</p>
                  <div className="mt-3 flex gap-1.5">
                    {can('journal:read') && <Link href={`/ledgers?tab=account&accountId=${b.accountId}&bankAccountId=${b.id}`}><Button size="sm">출납장</Button></Link>}
                    {can('bank:update') && <Button size="sm" variant="ghost" onClick={() => setEdit(b)}>수정</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {edit && <BankDrawer b={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['banks'] }); qc.invalidateQueries({ queryKey: ['bank-options'] }); toast('ok', '저장했습니다'); }} />}
    </>
  );
}
