'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PayReqForm } from '@/components/payreq-form';
import { EmptyState, PageHeader, useToast } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Page() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const qc = useQueryClient();
  if (!can('expense:create')) return <EmptyState title="지급결의를 작성할 권한이 없습니다" description="관리자에게 '지급결의 등록' 권한을 요청하세요." />;
  return (
    <>
      <PageHeader title="지급결의 작성" description="결재가 끝난 뒤 회계 담당이 지급(이체)을 처리합니다.">
        <Link href="/payment-requests" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />지급결의 목록</Link>
      </PageHeader>
      <PayReqForm onCancel={() => router.back()} onSaved={(id, submitted) => { qc.invalidateQueries({ queryKey: ['payreqs'] }); qc.invalidateQueries({ queryKey: ['approval-counts'] }); toast('ok', submitted ? '결재를 올렸습니다' : '임시저장했습니다'); router.replace(`/payment-requests/${id}`); }} />
    </>
  );
}
