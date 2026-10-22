'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { JournalForm } from '@/components/journal-form';
import { EmptyState, PageHeader, useToast } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Page() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  if (!can('journal:create')) return <EmptyState title="전표를 작성할 권한이 없습니다" />;
  return (
    <>
      <PageHeader title="전표 입력" description="검수·지급 등은 자동분개되므로, 그 밖의 거래(임차료·급여·차입 등)만 직접 입력합니다.">
        <Link href="/journals" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />전표 목록</Link>
      </PageHeader>
      <JournalForm onCancel={() => router.back()} onSaved={(id) => { qc.invalidateQueries({ queryKey: ['journals'] }); toast('ok', '전표를 저장했습니다'); router.replace(`/journals/${id}`); }} />
    </>
  );
}
