'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { PayReqForm, type PayReqInitial } from '@/components/payreq-form';
import { EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { company } = useSession();
  const q = useQuery({ queryKey: ['payreq', company.id, id], queryFn: () => api<PayReqInitial & { status: string; code: string }>(`/payment-requests/${id}`) });
  if (q.error) return <EmptyState title="지급결의를 찾을 수 없습니다" />;
  if (!q.data) return <Skeleton className="h-96" />;
  if (!['DRAFT', 'REJECTED'].includes(q.data.status)) return <EmptyState title="지금은 고칠 수 없습니다" description="작성중이거나 반려된 결의만 고칠 수 있습니다." action={<Link href={`/payment-requests/${id}`} className="text-steel-ink underline">결의로 돌아가기</Link>} />;
  return (
    <>
      <PageHeader title={`지급결의 수정 · ${q.data.code}`}>
        <Link href={`/payment-requests/${id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />결의로 돌아가기</Link>
      </PageHeader>
      <PayReqForm initial={q.data} onCancel={() => router.back()} onSaved={(_, submitted) => { qc.invalidateQueries({ queryKey: ['payreq'] }); qc.invalidateQueries({ queryKey: ['payreqs'] }); toast('ok', submitted ? '결재를 올렸습니다' : '저장했습니다'); router.replace(`/payment-requests/${id}`); }} />
    </>
  );
}
