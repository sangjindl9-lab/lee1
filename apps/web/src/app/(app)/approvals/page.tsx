'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { Suspense } from 'react';
import { ApprovalStatusBadge, stampSteps } from '@/components/po-bits';
import { ApprovalBox, EmptyState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, relative, won } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Approval } from '@/lib/types';

type Box = 'todo' | 'mine' | 'done';
const DOC_HREF: Record<Approval['docType'], (id: string) => string> = { PURCHASE_ORDER: (id) => `/purchase-orders/${id}` };
const DOC_LABEL: Record<Approval['docType'], string> = { PURCHASE_ORDER: '발주서' };

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const box = (sp.get('box') as Box) || 'todo';
  const { company } = useSession();
  const counts = useQuery({ queryKey: ['approval-counts', company.id], queryFn: () => api<{ todo: number; minePending: number }>('/approvals/counts'), refetchInterval: 60_000 });
  const q = useQuery({ queryKey: ['approvals', company.id, box], queryFn: () => api<Approval[]>(`/approvals?box=${box}`) });
  const empty = { todo: ['결재할 문서가 없습니다', '올라온 결재가 생기면 여기에 쌓입니다.'], mine: ['상신한 문서가 없습니다', '발주서를 작성해 결재를 올리면 진행 상황을 여기서 봅니다.'], done: ['처리한 결재가 없습니다', ''] }[box];
  return (
    <>
      <PageHeader title="결재함" description="발주서는 모두 대표이사 결재를 거칩니다." />
      <Tabs<Box>
        value={box}
        onChange={(b) => router.replace(`/approvals?box=${b}`)}
        items={[
          { value: 'todo', label: <>결재할 문서 {!!counts.data?.todo && <span className="num ml-1 rounded-full bg-seal px-1.5 text-[11px] font-semibold text-white">{counts.data.todo}</span>}</> },
          { value: 'mine', label: <>내가 올린 문서 {!!counts.data?.minePending && <span className="num ml-1 text-faint">{counts.data.minePending}</span>}</> },
          { value: 'done', label: '처리한 문서' },
        ]}
      />
      <div className="mt-4 space-y-2">
        {q.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        {q.data && !q.data.length && <div className="rounded-[6px] border border-line bg-surface"><EmptyState icon={<Inbox className="size-8" strokeWidth={1.25} />} title={empty[0]} description={empty[1]} /></div>}
        {q.data?.map((a) => {
          const cur = a.steps.find((s) => s.stepNo === a.currentStep);
          return (
            <Link key={a.id} href={DOC_HREF[a.docType](a.docId)} className={clsx('flex flex-col gap-4 rounded-[6px] border bg-surface p-4 transition-colors hover:border-line-strong sm:flex-row sm:items-center', box === 'todo' ? 'border-l-[3px] border-l-steel border-line' : 'border-line')}>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
                  <span className="rounded-[3px] bg-surface-2 px-1.5 text-muted">{DOC_LABEL[a.docType]}</span>
                  <span className="num text-muted">{a.docCode}</span>
                  <ApprovalStatusBadge status={a.status} />
                </div>
                <p className="truncate font-medium">{a.title}</p>
                <p className="mt-1 text-meta text-muted">
                  <span className="num font-semibold text-ink">{won(a.amount)}원</span> · {a.drafterName} · <span title={dateTime(a.submittedAt)}>{relative(a.submittedAt)} 상신</span>
                  {(a.status === 'PENDING' || a.status === 'HOLD') && cur && <> · <span className="text-ink-2">{cur.title} 대기 ({cur.approverNames})</span></>}
                </p>
              </div>
              <div className="shrink-0 overflow-x-auto"><ApprovalBox steps={stampSteps(a)} /></div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export default function ApprovalsPage() {
  return <Suspense><Inner /></Suspense>;
}
