'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense } from 'react';
import { PayReqForm, type PayReqSeed } from '@/components/payreq-form';
import { EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Ti { id: string; code: string; writeDate: string; supplierName: string | null; supplyAmount: string; vatAmount: string; projectId: string | null; vendor: { id: string; name: string } | null }

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company } = useSession();
  const qc = useQueryClient();
  const tiId = sp.get('source') === 'TAX_INVOICE' ? sp.get('id') : null;
  const ti = useQuery({ queryKey: ['tax-invoice', company.id, tiId], queryFn: () => api<Ti>(`/tax-invoices/${tiId}`), enabled: !!tiId });
  const subVendorId = sp.get('source') === 'SUB' ? sp.get('vendorId') : null;
  const sv = useQuery({ queryKey: ['vendor', company.id, subVendorId], queryFn: () => api<{ id: string; name: string }>(`/vendors/${subVendorId}`), enabled: !!subVendorId });
  const kindParam = sp.get('kind');
  if (!can('expense:create')) return <EmptyState title="지급결의를 작성할 권한이 없습니다" description="관리자에게 '지급결의 등록' 권한을 요청하세요." />;
  if ((tiId && !ti.data) || (subVendorId && !sv.data)) return <Skeleton className="h-[480px]" />;
  const t = ti.data;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const seed: PayReqSeed | undefined = sv.data ? { kind: 'SUBCONTRACT', title: `${sv.data.name} 외주 대금`, requestDate: today, dueDate: null, projectId: null, vendorId: sv.data.id, payeeName: '', memo: null, vendor: { id: sv.data.id, name: sv.data.name }, lines: [] }
    : kindParam === 'LABOR' ? { kind: 'LABOR', title: '노무비 지급', requestDate: today, dueDate: null, projectId: sp.get('projectId'), vendorId: null, payeeName: '', memo: null, vendor: null, lines: [] }
    : t ? {
    kind: 'EXPENSE', title: `${t.supplierName ?? ''} 세금계산서 대금`, requestDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), dueDate: null, projectId: t.projectId, vendorId: t.vendor?.id ?? null, payeeName: '', memo: null, vendor: t.vendor,
    lines: [{ description: `세금계산서 ${t.supplierName} ${t.writeDate}`, accountId: null, costCodeId: null, supplyAmount: t.supplyAmount, vatAmount: t.vatAmount, vatDeductible: true, sourceType: 'TAX_INVOICE', sourceId: t.id, sourceCode: t.code }],
  } : undefined;
  return (
    <>
      <PageHeader title="지급결의 작성" description="결재가 끝난 뒤 회계 담당이 지급(이체)을 처리합니다.">
        <Link href="/payment-requests" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />지급결의 목록</Link>
      </PageHeader>
      <PayReqForm seed={seed} onCancel={() => router.back()} onSaved={(id, submitted) => { qc.invalidateQueries({ queryKey: ['payreqs'] }); qc.invalidateQueries({ queryKey: ['approval-counts'] }); toast('ok', submitted ? '결재를 올렸습니다' : '임시저장했습니다'); router.replace(`/payment-requests/${id}`); }} />
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
