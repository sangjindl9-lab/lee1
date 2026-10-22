'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { ProjectForm } from '@/components/project-form';
import { EmptyState, PageHeader, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ProjectDetail } from '@/lib/types';

export default function NewProjectPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, setProject } = useSession();
  if (!can('project:create')) return <EmptyState title="현장을 등록할 권한이 없습니다" description="관리자에게 '현장 등록' 권한을 요청하세요." />;
  return (
    <>
      <PageHeader title="현장 등록">
        <Link href="/projects" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />현장 목록</Link>
      </PageHeader>
      <ProjectForm
        submitLabel="현장 등록"
        onCancel={() => router.back()}
        onSubmit={async (body) => {
          const p = await api<ProjectDetail>('/projects', { method: 'POST', json: body });
          await qc.invalidateQueries({ queryKey: ['project-options'] });
          qc.invalidateQueries({ queryKey: ['projects'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          setProject(p.id);
          toast('ok', `${p.code} 현장을 등록했습니다`);
          router.replace(`/projects/${p.id}`);
        }}
      />
    </>
  );
}
