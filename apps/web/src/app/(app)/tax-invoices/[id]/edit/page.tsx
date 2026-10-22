'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TiForm, type TiFormInitial } from '@/components/ti-form';
import type { TiLine } from '@/components/tax-bits';
import { EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface D { id: string; version: number; status: string; direction: 'SALES' | 'PURCHASE'; docKind: 'TAX' | 'EXEMPT'; approvalNo: string | null; writeDate: string; purpose: 'CHARGE' | 'RECEIPT'; remark: string | null; projectId: string | null; vendor: { id: string; name: string } | null; lines: TiLine[] }

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { company } = useSession();
  const q = useQuery({ queryKey: ['tax-invoice', company.id, id], queryFn: () => api<D>(`/tax-invoices/${id}`) });
  const d = q.data;
  if (!d) return <Skeleton className="h-[480px]" />;
  if (d.direction !== 'SALES' || d.status !== 'DRAFT') return <EmptyState title="고칠 수 없는 계산서입니다" description="작성중인 매출 세금계산서만 고칠 수 있습니다." />;
  const init: TiFormInitial = {
    id: d.id, version: d.version, direction: d.direction, docKind: d.docKind, approvalNo: d.approvalNo ?? '', writeDate: d.writeDate, purpose: d.purpose, vendor: d.vendor, projectId: d.projectId, remark: d.remark ?? '',
    lines: d.lines.map((l) => ({ name: l.name ?? '', spec: l.spec ?? '', qty: l.qty ? String(Number(l.qty)) : '', unitPrice: l.unitPrice ? String(Math.trunc(Number(l.unitPrice))) : '', supplyAmount: String(Math.trunc(Number(l.supplyAmount))), vatAmount: String(Math.trunc(Number(l.vatAmount))), vatTouched: true, remark: l.remark ?? '' })),
  };
  return (
    <>
      <PageHeader title="매출 세금계산서 수정">
        <Link href={`/tax-invoices/${id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />계산서로 돌아가기</Link>
      </PageHeader>
      <TiForm initial={init} onCancel={() => router.back()} onSaved={(sid, submitted) => { qc.invalidateQueries({ queryKey: ['tax-invoice'] }); qc.invalidateQueries({ queryKey: ['tax-invoices'] }); toast('ok', submitted ? '발행 결재를 올렸습니다' : '저장했습니다'); router.replace(`/tax-invoices/${sid}`); }} />
    </>
  );
}
