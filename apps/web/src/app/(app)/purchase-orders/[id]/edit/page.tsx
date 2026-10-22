'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { PoForm } from '@/components/po-form';
import { Button, EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { PoDetailFull } from '@/lib/types';

export default function EditPoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { company } = useSession();
  const q = useQuery({ queryKey: ['po', company.id, id], queryFn: () => api<PoDetailFull>(`/purchase-orders/${id}`) });
  if (q.error) return <EmptyState title="발주서를 찾을 수 없습니다" />;
  if (!q.data) return <Skeleton className="h-96" />;
  if (!['DRAFT', 'REJECTED'].includes(q.data.status)) {
    return <EmptyState title={`${q.data.statusLabel} 상태의 발주서는 수정할 수 없습니다`} description="승인된 발주서를 바꾸려면 상세 화면에서 '변경 재결재'를 누르세요." action={<Link href={`/purchase-orders/${id}`}><Button>발주서로 돌아가기</Button></Link>} />;
  }
  return (
    <>
      <PageHeader title={`${q.data.code} 수정`} description={q.data.status === 'REJECTED' ? '반려된 발주서입니다. 사유를 반영해 고친 뒤 다시 상신하세요.' : undefined}>
        <Link href={`/purchase-orders/${id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />발주서</Link>
      </PageHeader>
      <PoForm
        initial={q.data}
        onCancel={() => router.back()}
        onSaved={(pid, submitted) => {
          qc.invalidateQueries({ queryKey: ['po', company.id, pid] });
          qc.invalidateQueries({ queryKey: ['pos'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          qc.invalidateQueries({ queryKey: ['approval-counts'] });
          toast('ok', submitted ? '대표이사에게 결재를 올렸습니다' : '저장했습니다');
          router.replace(`/purchase-orders/${pid}`);
        }}
      />
    </>
  );
}
