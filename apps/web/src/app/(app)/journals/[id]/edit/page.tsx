'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { JournalForm, type JournalInitial } from '@/components/journal-form';
import { EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { company } = useSession();
  const q = useQuery({ queryKey: ['journal', company.id, id], queryFn: () => api<JournalInitial & { code: string; status: string; sourceType: string }>(`/journal-entries/${id}`) });
  if (q.error) return <EmptyState title="전표를 찾을 수 없습니다" />;
  if (!q.data) return <Skeleton className="h-96" />;
  if (q.data.status !== 'DRAFT' || q.data.sourceType !== 'MANUAL') return <EmptyState title="이 전표는 고칠 수 없습니다" description="미승인 수동 전표만 고칠 수 있습니다. 승인된 전표는 역분개 후 새로 입력하세요." />;
  return (
    <>
      <PageHeader title={`전표 수정 · ${q.data.code}`}>
        <Link href={`/journals/${id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />전표로 돌아가기</Link>
      </PageHeader>
      <JournalForm initial={q.data} onCancel={() => router.back()} onSaved={() => { qc.invalidateQueries({ queryKey: ['journal'] }); qc.invalidateQueries({ queryKey: ['journals'] }); toast('ok', '저장했습니다'); router.replace(`/journals/${id}`); }} />
    </>
  );
}
