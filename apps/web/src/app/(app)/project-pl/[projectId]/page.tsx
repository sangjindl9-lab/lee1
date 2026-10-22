'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Wallet } from 'lucide-react';
import { CostTable, type BudgetSummary } from '@/components/budget-bits';
import { Button, EmptyState, Skeleton, StatusBadge, TradeTag, Won } from '@/components/ui';
import { api } from '@/lib/api';
import { pct } from '@/lib/format';
import { useSession } from '@/lib/session';

/** 돈의 흐름 단계 — 설계서 1.2의 5단계 모델을 그대로 보여 준다 */
function Flow({ title, steps, tail }: { title: string; steps: { label: string; value: string; note?: string }[]; tail: { label: string; value: string; tone?: 'seal' | 'ok' } }) {
  const max = Math.max(...steps.map((s) => Number(s.value)), 1);
  return (
    <section className="rounded-[6px] border border-line bg-surface p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.label} className="grid grid-cols-[24px_96px_minmax(0,1fr)_120px] items-center gap-2">
            <span className="num grid size-5 place-items-center rounded-full border border-line-strong text-[11px] text-muted">{['①', '②', '③', '④', '⑤'][i] ?? i + 1}</span>
            <span className="text-meta text-ink-2">{s.label}</span>
            <span className="h-2 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-steel" style={{ width: `${(Number(s.value) / max) * 100}%`, opacity: 1 - i * 0.15 }} /></span>
            <span className="num text-right"><Won value={s.value} />{s.note && <span className="block text-[11px] text-faint">{s.note}</span>}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="font-medium">{tail.label}</span>
        <span className={clsx('num text-[20px] font-semibold', tail.tone === 'seal' ? 'text-seal' : tail.tone === 'ok' ? 'text-ok' : '')}><Won value={tail.value} /><span className="ml-0.5 text-meta font-normal text-faint">원</span></span>
      </div>
    </section>
  );
}

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const { company, can } = useSession();
  const q = useQuery({ queryKey: ['project-pl-one', company.id, projectId], queryFn: () => api<BudgetSummary>(`/project-pl/${projectId}`), retry: false });
  const s = q.data;
  if (q.error) return <EmptyState title="현장을 찾을 수 없습니다" />;
  if (!s) return <Skeleton className="h-96" />;
  const r = s.revenue;
  const profit = Number(s.forecast.estimatedProfit);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/project-pl" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />현장 손익</Link>
          <p className="mb-1 flex items-center gap-2 text-meta text-muted"><TradeTag trade={s.project.tradeType} /><span className="num">{s.project.code}</span><StatusBadge status={s.project.status as 'IN_PROGRESS'} /><span className="num">공정률 {pct(s.project.progressRate, 0)}</span></p>
          <h1 className="text-title font-semibold">{s.project.name}</h1>
        </div>
        <div className="flex gap-1.5">
          <Link href={`/projects/${s.project.id}`}><Button>현장 정보</Button></Link>
          {can('budget:read') && <Link href={`/budgets/${s.project.id}`}><Button icon={<Wallet className="size-3.5" />}>실행예산</Button></Link>}
        </div>
      </div>

      <section className="mb-4 grid overflow-hidden rounded-[6px] border border-line bg-surface sm:grid-cols-3">
        <div className="border-line p-4 max-sm:border-b sm:border-r">
          <p className="text-meta text-muted">예상 준공손익</p>
          <p className={clsx('num mt-1 text-[28px] leading-9 font-semibold tracking-[-0.02em]', profit < 0 && 'text-seal')}><Won value={s.forecast.estimatedProfit} /><span className="ml-1 text-meta font-normal text-faint">원</span></p>
          <p className="text-meta text-muted">이익률 {s.forecast.estimatedMarginRate ? pct(s.forecast.estimatedMarginRate) : '–'} · 계약 − 예상 준공원가</p>
        </div>
        <div className="border-line p-4 max-sm:border-b sm:border-r">
          <p className="text-meta text-muted">예상 준공원가</p>
          <p className="num mt-1 text-[22px] leading-9 font-semibold"><Won value={s.forecast.estimatedCost} /></p>
          <p className="text-meta text-muted">원가항목별 max(계획, 발주확정, 발생)의 합</p>
        </div>
        <div className="p-4">
          <p className="text-meta text-muted">현재까지 손익 (매출 인식 − 발생원가)</p>
          <p className={clsx('num mt-1 text-[22px] leading-9 font-semibold', Number(s.forecast.currentProfit) < 0 && 'text-seal')}><Won value={s.forecast.currentProfit} /></p>
          <p className="text-meta text-muted">미지급 원가 <Won value={s.forecast.unpaidCost} /></p>
        </div>
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Flow
          title="받을 돈 (매출 측)"
          steps={[
            { label: '최초 계약', value: r.contractOriginal },
            { label: '변경 반영 계약', value: r.contractCurrent, note: Number(r.contractPending) ? `승인 대기 ${Number(r.contractPending).toLocaleString('ko-KR')}` : undefined },
            { label: '기성 청구', value: r.claimed },
            { label: '매출 인식', value: r.recognized },
            { label: '수금', value: r.collected },
          ]}
          tail={{ label: '미수금', value: r.receivable, tone: Number(r.receivable) > 0 ? 'seal' : undefined }}
        />
        <Flow
          title="줄 돈 (원가 측)"
          steps={[
            { label: '실행예산', value: s.totals.planned },
            { label: '발주확정', value: s.totals.committed },
            { label: '발생원가', value: s.totals.actual },
            { label: '지급', value: s.totals.paid },
          ]}
          tail={{ label: '미지급 원가', value: s.forecast.unpaidCost }}
        />
      </div>
      {!r.available && <p className="mb-4 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted">기성청구·수금 기능을 쓰면 매출 측 단계가 채워집니다.</p>}
      {(Number(r.retention) > 0 || Number(r.advanceBalance) > 0) && <p className="mb-4 text-meta text-muted">유보금 <Won value={r.retention} /> · 선급금 잔액 <Won value={r.advanceBalance} /> (별도 계정 관리)</p>}

      <section className="rounded-[6px] border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-2.5 font-semibold">원가항목별 명세</h2>
        <CostTable rows={s.rows} totals={s.totals} />
      </section>
    </>
  );
}
