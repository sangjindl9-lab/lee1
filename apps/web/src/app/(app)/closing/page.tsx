'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Lock, LockOpen, OctagonX } from 'lucide-react';
import { Suspense, useState } from 'react';
import { ReasonDialog, useRun } from '@/components/doc-ui';
import { Badge, Button, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { dateTime, wonShort } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Month { period: string; status: 'OPEN' | 'CLOSED'; closedAt: string | null; closedByName: string | null; note: string | null; entries: number; drafts: number; amount: string }
interface Check { key: string; label: string; state: 'ok' | 'warn' | 'block'; detail: string; href?: string }

function CloseDialog({ period, onClose, onDone }: { period: string; onClose: () => void; onDone: () => void }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['close-checks', company.id, period], queryFn: () => api<Check[]>(`/closing/${period}/checks`) });
  const { run, acting } = useRun(['closing', 'journals']);
  const blocked = q.data?.some((c) => c.state === 'block');
  const ICON = { ok: <CheckCircle2 className="size-4 text-ok" />, warn: <CircleAlert className="size-4 text-warn" />, block: <OctagonX className="size-4 text-seal" /> };
  return (
    <Dialog open onClose={onClose} title={`${period} 월마감`} width={560}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" icon={<Lock className="size-4" />} disabled={!q.data || blocked} loading={acting === 'close'} onClick={async () => { if (await run('close', () => api(`/closing/${period}/close`, { method: 'POST', json: {} }), `${period}을(를) 마감했습니다`)) onDone(); }}>마감하기</Button></>}>
      <p className="mb-3 text-muted">마감하면 이 달 날짜로는 전표·검수·지급을 기록할 수 없습니다. 아래 순서대로 확인하세요.</p>
      {!q.data ? <Skeleton className="h-48" /> : (
        <ol className="divide-y divide-line rounded-[4px] border border-line">
          {q.data.map((c, i) => (
            <li key={c.key} className="flex items-start gap-3 px-3 py-2.5">
              <span className="num mt-0.5 w-4 text-meta text-faint">{i + 1}</span>
              <span className="mt-0.5">{ICON[c.state]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.label}</p>
                <p className={clsx('text-meta', c.state === 'block' ? 'text-seal' : c.state === 'warn' ? 'text-warn' : 'text-muted')}>{c.detail}</p>
              </div>
              {c.href && c.state !== 'ok' && <Link href={c.href} className="shrink-0 text-meta text-steel-ink underline">확인하기</Link>}
            </li>
          ))}
        </ol>
      )}
      {blocked && <p className="mt-3 text-meta text-seal">빨간 항목을 해결해야 마감할 수 있습니다.</p>}
    </Dialog>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const year = sp.get('year') ?? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 4);
  const q = useQuery({ queryKey: ['closing', company.id, year], queryFn: () => api<{ year: string; today: string; yearClosed: boolean; months: Month[] }>(`/closing${qs({ year })}`) });
  const { run, acting } = useRun(['closing']);
  const [closing, setClosing] = useState<string | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['closing'] });
  if (!can('closing:read')) return <EmptyState title="마감 화면을 볼 권한이 없습니다" />;
  const d = q.data;
  const canClose = can('closing:approve');
  const lastClosed = d?.months.filter((m) => m.status === 'CLOSED').map((m) => m.period).sort().pop();
  // 다음에 마감할 달 (가장 이른 열린 달, 단 진행 중인 이번 달 제외)
  const nextToClose = d?.months.find((m) => m.status === 'OPEN' && m.period < d.today.slice(0, 7) && m.entries > 0)?.period;
  return (
    <>
      <PageHeader title="월마감" description="마감한 달에는 전표를 기록할 수 없습니다. 고쳐야 하면 최근 달부터 차례로 마감을 해제하세요."
        actions={<div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => router.replace(`/closing?year=${Number(year) - 1}`)} aria-label="이전 연도"><ChevronLeft className="size-4" /></Button><span className="num w-14 text-center font-semibold">{year}년</span><Button size="sm" variant="ghost" onClick={() => router.replace(`/closing?year=${Number(year) + 1}`)} aria-label="다음 연도"><ChevronRight className="size-4" /></Button></div>} />
      {!d ? <Skeleton className="h-80" /> : (
        <>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {d.months.map((m) => {
              const future = m.period > d.today.slice(0, 7);
              const current = m.period === d.today.slice(0, 7);
              return (
                <li key={m.period} className={clsx('rounded-[6px] border bg-surface p-3.5', m.status === 'CLOSED' ? 'border-line' : current ? 'border-steel' : 'border-line', future && 'opacity-50')}>
                  <div className="flex items-center justify-between">
                    <span className="num text-section font-semibold">{Number(m.period.slice(5))}월</span>
                    {m.status === 'CLOSED' ? <Badge tone="ink"><Lock className="size-3" />마감</Badge> : future ? <Badge tone="muted">예정</Badge> : <Badge tone="outline">진행</Badge>}
                  </div>
                  <p className="num mt-1.5 text-meta text-muted">전표 {m.entries}건 · {wonShort(m.amount)}원{m.drafts ? <span className="text-warn"> · 미승인 {m.drafts}</span> : null}</p>
                  {m.status === 'CLOSED' ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="num truncate text-[11px] text-faint">{m.closedByName} · {dateTime(m.closedAt)}</p>
                      {canClose && m.period === lastClosed && <Button size="sm" variant="quiet" icon={<LockOpen className="size-3" />} onClick={() => setReopen(m.period)}>해제</Button>}
                    </div>
                  ) : !future && canClose ? (
                    <Button size="sm" className="mt-2 w-full" variant={m.period === nextToClose ? 'primary' : 'secondary'} icon={<Lock className="size-3.5" />} onClick={() => setClosing(m.period)}>{current ? '마감 점검 (진행 중인 달)' : '마감 점검'}</Button>
                  ) : m.note ? <p className="mt-2 text-[11px] text-faint">{m.note}</p> : null}
                </li>
              );
            })}
          </ol>
          {canClose && (
            <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-surface p-4">
              <div>
                <p className="font-semibold">{year}년 연마감</p>
                <p className="text-meta text-muted">1~11월 마감 후 실행하면 손익 계정을 이월이익잉여금으로 대체(12월 31일)하고 12월을 마감합니다.</p>
              </div>
              {d.yearClosed ? <Badge tone="ink">연마감 완료</Badge> : <Button loading={acting === 'year'} onClick={() => run('year', () => api(`/closing/year/${year}/close`, { method: 'POST' }), `${year}년 연마감을 했습니다`).then(refresh)}>연마감 실행</Button>}
            </section>
          )}
        </>
      )}
      {closing && <CloseDialog period={closing} onClose={() => setClosing(null)} onDone={() => (setClosing(null), refresh())} />}
      <ReasonDialog open={!!reopen} title={`${reopen} 마감 해제`} confirm="마감 해제" body="마감을 해제하면 이 달에 다시 전표를 기록할 수 있습니다. 해제 사실과 사유는 감사로그에 남습니다." onClose={() => setReopen(null)}
        onConfirm={async (reason) => { if (await run('reopen', () => api(`/closing/${reopen}/reopen`, { method: 'POST', json: { reason } }), '마감을 해제했습니다')) { setReopen(null); refresh(); } }} />
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
