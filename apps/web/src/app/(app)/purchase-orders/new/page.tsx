'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { PoForm, type PoSeed } from '@/components/po-form';
import { EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const requestId = sp.get('request');
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const rq = useQuery({ queryKey: ['purchase-request', company.id, requestId], queryFn: () => api<{ id: string; code: string; projectId: string; title: string; neededBy: string | null; memo: string | null; lines: PoSeed['lines'] }>(`/purchase-requests/${requestId}`), enabled: !!requestId });
  if (!can('purchase:create')) return <EmptyState title="발주서를 작성할 권한이 없습니다" description="관리자에게 '구매요청·발주 등록' 권한을 요청하세요." />;
  if (requestId && !rq.data) return rq.error ? <EmptyState title="구매요청을 불러오지 못했습니다" /> : <Skeleton className="h-96" />;
  const seed: PoSeed | undefined = rq.data ? { requestId: rq.data.id, requestCode: rq.data.code, projectId: rq.data.projectId, title: rq.data.title, deliveryDate: rq.data.neededBy, memo: rq.data.memo, lines: rq.data.lines } : undefined;
  return (
    <>
      <PageHeader title="발주서 작성" description={seed ? `구매요청 ${seed.requestCode}의 품목을 불러왔습니다. 거래처와 단가를 넣어 주세요.` : '모든 발주서는 대표이사 결재가 끝나야 효력이 생깁니다.'}>
        <Link href="/purchase-orders" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />발주서 목록</Link>
      </PageHeader>
      <PoForm
        seed={seed}
        onCancel={() => router.back()}
        onSaved={(id, submitted) => {
          qc.invalidateQueries({ queryKey: ['pos'] });
          qc.invalidateQueries({ queryKey: ['purchase-requests'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          qc.invalidateQueries({ queryKey: ['approval-counts'] });
          toast('ok', submitted ? '대표이사에게 결재를 올렸습니다' : '임시저장했습니다');
          router.replace(`/purchase-orders/${id}`);
        }}
      />
    </>
  );
}

export default function NewPoPage() {
  return <Suspense><Inner /></Suspense>;
}
