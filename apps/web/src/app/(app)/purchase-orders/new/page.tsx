'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { PoForm } from '@/components/po-form';
import { EmptyState, PageHeader, useToast } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function NewPoPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  if (!can('purchase:create')) return <EmptyState title="발주서를 작성할 권한이 없습니다" description="관리자에게 '구매요청·발주 등록' 권한을 요청하세요." />;
  return (
    <>
      <PageHeader title="발주서 작성" description="모든 발주서는 대표이사 결재가 끝나야 효력이 생깁니다.">
        <Link href="/purchase-orders" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />발주서 목록</Link>
      </PageHeader>
      <PoForm
        onCancel={() => router.back()}
        onSaved={(id, submitted) => {
          qc.invalidateQueries({ queryKey: ['pos'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          qc.invalidateQueries({ queryKey: ['approval-counts'] });
          toast('ok', submitted ? '대표이사에게 결재를 올렸습니다' : '임시저장했습니다');
          router.replace(`/purchase-orders/${id}`);
        }}
      />
    </>
  );
}
