'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Suspense } from 'react';
import { emptyTi, TiForm } from '@/components/ti-form';
import { EmptyState, PageHeader, useToast } from '@/components/ui';
import { useSession } from '@/lib/session';

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  const dir = sp.get('direction') === 'SALES' ? 'SALES' : 'PURCHASE';
  if (!can('taxinvoice:create')) return <EmptyState title="세금계산서를 작성할 권한이 없습니다" description="관리자에게 '세금계산서 등록' 권한을 요청하세요." />;
  return (
    <>
      <PageHeader title={dir === 'SALES' ? '매출 세금계산서 작성' : '매입 세금계산서 직접 입력'} description={dir === 'SALES' ? '저장 → 발행 결재 → 발행 순서입니다. 결재가 끝나기 전에는 국세청으로 보내지 않습니다.' : '종이로 받았거나 홈택스에 아직 없는 계산서를 입력합니다. 같은 승인번호·거래처·금액이면 중복으로 막습니다.'}>
        <Link href={`/tax-invoices${dir === 'SALES' ? '?direction=SALES' : ''}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />세금계산서 목록</Link>
      </PageHeader>
      <TiForm initial={emptyTi(dir)} onCancel={() => router.back()} onSaved={(id, submitted) => { qc.invalidateQueries({ queryKey: ['tax-invoices'] }); toast('ok', submitted ? '발행 결재를 올렸습니다' : '저장했습니다'); router.replace(`/tax-invoices/${id}`); }} />
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
