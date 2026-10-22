'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileDown, Printer } from 'lucide-react';
import { useState } from 'react';
import { SegTabs, SumStrip } from '@/components/doc-ui';
import { Button, EmptyState, IconButton, Input, PageHeader, Panel, Skeleton, useToast, Won } from '@/components/ui';
import { api, ApiError, download } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Daily {
  date: string;
  accounts: { id: string; name: string; kind: string; bank_name: string | null; account_no_mask: string | null; opening: string; in: string; out: string; closing: string }[];
  totals: { opening: string; in: string; out: string; closing: string };
  lines: { entry_id: string; code: string; description: string; account_name: string; kind: string; debit: string; credit: string; memo: string | null; vendor_name: string | null; project_name: string | null }[];
  upcomingPay: { id: string; code: string; title: string; payee_name: string; amount: string; due_date: string | null }[];
  upcomingIn: { id: string; code: string; claim_no: number; project_name: string; vendor_name: string; due_date: string | null; amount: string }[];
}
interface Forecast { today: string; currentBalance: string; rows: { month: string; opening: string; expectedIn: string; expectedOut: string; pendingOut: string; net: string; closing: string }[]; undated: { in: string; out: string }; notes: { pendingClaims: string; subcontractBalance: string } }

const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const KIND = { BANK: '예금', CASH: '현금', CARD: '카드' } as Record<string, string>;

export default function Page() {
  const toast = useToast();
  const { can, company } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [tab, setTab] = useState<'daily' | 'forecast'>('daily');
  const [date, setDate] = useState(today);
  const [months, setMonths] = useState(6);
  const daily = useQuery({ queryKey: ['cash-daily', company.id, date], queryFn: () => api<Daily>(`/cash/daily?date=${date}`), enabled: tab === 'daily' });
  const fc = useQuery({ queryKey: ['cash-forecast', company.id, months], queryFn: () => api<Forecast>(`/cash/forecast?months=${months}`), enabled: tab === 'forecast' });
  const out = async (fmt: 'pdf' | 'xlsx') => {
    try {
      await download(`/reports/${tab === 'daily' ? 'cash-daily' : 'cash-forecast'}?format=${fmt}&date=${date}`, `${tab === 'daily' ? '자금일보' : '자금수지'}.${fmt}`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '출력하지 못했습니다');
    }
  };
  if (!can('bank:read')) return <EmptyState title="자금 현황을 볼 권한이 없습니다" />;
  const maxAbs = Math.max(1, ...(fc.data?.rows ?? []).flatMap((r) => [Number(r.expectedIn), Number(r.expectedOut) + Number(r.pendingOut)]));
  return (
    <>
      <PageHeader title="자금일보·수지" description="장부(계좌가 지정된 전표) 기준의 하루 자금 현황과, 받을 기성·지급할 결의로 계산한 앞으로의 자금 흐름입니다."
        actions={can('report:export') && <><Button icon={<Printer className="size-4" />} onClick={() => out('pdf')}>PDF</Button><Button icon={<FileDown className="size-4" />} onClick={() => out('xlsx')}>엑셀</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegTabs label="보기" value={tab} onChange={setTab} items={[{ value: 'daily', label: '자금일보' }, { value: 'forecast', label: '자금수지 전망' }]} />
        {tab === 'daily' ? (
          <span className="flex items-center gap-1">
            <IconButton label="전날" onClick={() => setDate(shift(date, -1))}><ChevronLeft className="size-4" /></IconButton>
            <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-[140px]" aria-label="기준일" />
            <IconButton label="다음날" onClick={() => setDate(shift(date, 1))} disabled={date >= today}><ChevronRight className="size-4" /></IconButton>
            {date !== today && <Button size="sm" onClick={() => setDate(today)}>오늘</Button>}
          </span>
        ) : (
          <SegTabs label="기간" value={String(months)} onChange={(v) => setMonths(Number(v))} items={[{ value: '3', label: '3개월' }, { value: '6', label: '6개월' }, { value: '12', label: '12개월' }]} />
        )}
      </div>

      {tab === 'daily' ? !daily.data ? <Skeleton className="h-80" /> : (
        <>
          <SumStrip items={[{ label: '전일 잔액', value: daily.data.totals.opening, tone: 'muted' }, { label: '입금', value: daily.data.totals.in, tone: 'ok' }, { label: '출금', value: daily.data.totals.out }, { label: '당일 잔액', value: daily.data.totals.closing, strong: true, tone: 'steel', hint: '예금·현금 합계 (카드 제외)' }]} />
          <Panel title="계좌별 현황" className="mb-4" bodyClassName="p-0">
            {!daily.data.accounts.length ? <p className="p-4 text-muted">등록된 계좌가 없습니다. <Link href="/bank" className="text-steel-ink underline">계좌 등록</Link></p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">계좌</th><th className="px-3 py-2 text-right font-medium">전일 잔액</th><th className="px-3 py-2 text-right font-medium">입금 (카드: 사용)</th><th className="px-3 py-2 text-right font-medium">출금 (카드: 결제)</th><th className="px-3 py-2 text-right font-medium">당일 잔액</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {daily.data.accounts.map((a) => (
                      <tr key={a.id} className={clsx(a.kind === 'CARD' && 'text-ink-2')}>
                        <td className="px-3 py-2"><span className="mr-1.5 text-meta text-faint">{KIND[a.kind]}</span><b className="font-medium">{a.name}</b>{a.account_no_mask && <span className="num ml-1.5 text-meta text-muted">{a.bank_name} {a.account_no_mask}</span>}</td>
                        <td className="px-3 py-2 text-right text-muted"><Won value={a.opening} /></td>
                        <td className="px-3 py-2 text-right text-ok"><Won value={a.in} blankZero /></td>
                        <td className="px-3 py-2 text-right"><Won value={a.out} blankZero /></td>
                        <td className="px-3 py-2 text-right font-semibold"><Won value={a.closing} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Panel title={`${date} 입출금 내역`} bodyClassName="p-0">
              {!daily.data.lines.length ? <p className="p-4 text-muted">이 날 계좌로 처리된 전표가 없습니다</p> : (
                <ul className="divide-y divide-line">
                  {daily.data.lines.map((l, i) => {
                    const inn = l.kind === 'CARD' ? Number(l.credit) > 0 : Number(l.debit) > 0;
                    return (
                      <li key={l.entry_id + i} className="flex items-center gap-3 px-4 py-2">
                        <span className="w-20 shrink-0 text-meta text-muted">{l.account_name}</span>
                        <Link href={`/journals/${l.entry_id}`} className="min-w-0 flex-1 truncate hover:underline">{l.description}<span className="ml-1 text-meta text-muted">{[l.vendor_name, l.project_name].filter(Boolean).join(' · ')}</span></Link>
                        <span className={clsx('num shrink-0', inn ? 'text-ok' : 'text-ink')}>{inn ? '+' : '−'}{won(Number(l.debit) > 0 ? l.debit : l.credit)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <div className="space-y-4">
              <Panel title="7일 안 지급 예정 (결재 완료)" bodyClassName="p-0">
                {!daily.data.upcomingPay.length ? <p className="p-4 text-meta text-muted">없음</p> : (
                  <ul className="divide-y divide-line">
                    {daily.data.upcomingPay.map((p) => (
                      <li key={p.id}><Link href={`/payment-requests/${p.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-2/60"><span className={clsx('num w-[78px] shrink-0 text-meta', p.due_date && p.due_date < date ? 'text-seal' : 'text-muted')}>{p.due_date ?? '예정일 없음'}</span><span className="min-w-0 flex-1 truncate">{p.payee_name} · {p.title}</span><Won value={p.amount} className="shrink-0" /></Link></li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="7일 안 수금 예정 (기성 미수금)" bodyClassName="p-0">
                {!daily.data.upcomingIn.length ? <p className="p-4 text-meta text-muted">없음</p> : (
                  <ul className="divide-y divide-line">
                    {daily.data.upcomingIn.map((c) => (
                      <li key={c.id}><Link href={`/claims/${c.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-2/60"><span className={clsx('num w-[78px] shrink-0 text-meta', c.due_date && c.due_date < date ? 'text-seal' : 'text-muted')}>{c.due_date ?? '예정일 없음'}</span><span className="min-w-0 flex-1 truncate">{c.project_name} {c.claim_no}회</span><Won value={c.amount} className="shrink-0 text-ok" /></Link></li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      ) : !fc.data ? <Skeleton className="h-80" /> : (
        <>
          <SumStrip items={[{ label: '현재 자금 (예금·현금)', value: fc.data.currentBalance, tone: 'steel', strong: true }, { label: '예정일 미정 입금', value: fc.data.undated.in, tone: 'muted', hint: '수금예정일 없는 기성' }, { label: '예정일 미정 출금', value: fc.data.undated.out, tone: 'muted', hint: '지급예정일 없는 결의' }, { label: '결재 중 기성', value: fc.data.notes.pendingClaims, tone: 'muted', hint: '승인되면 입금 예정에 포함' }, { label: '하도급 잔여 계약액', value: fc.data.notes.subcontractBalance, tone: 'muted', hint: '부가세 포함, 기성 미청구분' }]} />
          <Panel title="월별 예상 자금 흐름" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">월</th><th className="px-3 py-2 text-right font-medium">월초 잔액</th><th className="px-3 py-2 text-right font-medium">예상 입금</th><th className="px-3 py-2 text-right font-medium">지급 예정 (결재 완료)</th><th className="px-3 py-2 text-right font-medium">결재 중 지급</th><th className="w-[160px] px-3 py-2 font-medium"><span className="sr-only">입출금 비교</span></th><th className="px-3 py-2 text-right font-medium">월말 잔액</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {fc.data.rows.map((r, i) => {
                    const outs = Number(r.expectedOut) + Number(r.pendingOut);
                    const neg = Number(r.closing) < 0;
                    return (
                      <tr key={r.month} className={clsx(neg && 'bg-seal-soft/30')}>
                        <td className="num px-3 py-2 font-medium">{r.month}{i === 0 && <span className="ml-1 text-meta font-normal text-muted">(지난 예정 포함)</span>}</td>
                        <td className="px-3 py-2 text-right text-muted"><Won value={r.opening} /></td>
                        <td className="px-3 py-2 text-right text-ok"><Won value={r.expectedIn} blankZero /></td>
                        <td className="px-3 py-2 text-right"><Won value={r.expectedOut} blankZero /></td>
                        <td className="px-3 py-2 text-right text-muted"><Won value={r.pendingOut} blankZero /></td>
                        <td className="px-3 py-2" aria-hidden>
                          <span className="block h-1.5 rounded-r-[2px] bg-ok/70" style={{ width: `${(Number(r.expectedIn) / maxAbs) * 100}%` }} />
                          <span className="mt-[2px] block h-1.5 rounded-r-[2px] bg-ink-2/60" style={{ width: `${(outs / maxAbs) * 100}%` }} />
                        </td>
                        <td className={clsx('px-3 py-2 text-right font-semibold', neg && 'text-seal')}><Won value={r.closing} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 text-meta text-muted">막대: 위 <span className="text-ok">입금</span>, 아래 출금(결재 완료+결재 중). 월말 잔액이 음수인 달은 붉게 표시됩니다 — 자금 조달이 필요한 달입니다.</p>
          </Panel>
        </>
      )}
    </>
  );
}
