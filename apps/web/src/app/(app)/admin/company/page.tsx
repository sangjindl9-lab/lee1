'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Button, EmptyState, Field, Input, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Company { id: string; code: string; name: string; bizRegNo: string; ceoName: string | null; address: string | null; phone: string | null; email: string | null; businessType: string | null; businessItem: string | null; version: number }

export default function CompanyPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['company', company.id], queryFn: () => api<Company>('/companies/current') });
  const [f, setF] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF({ name: q.data.name, bizRegNo: bizNo(q.data.bizRegNo), ceoName: q.data.ceoName ?? '', address: q.data.address ?? '', phone: q.data.phone ?? '', email: q.data.email ?? '', businessType: q.data.businessType ?? '', businessItem: q.data.businessItem ?? '' });
  }, [q.data]);
  const editable = can('company:update');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/companies/current', { method: 'PUT', json: { ...f, version: q.data!.version } });
      toast('ok', '회사 정보를 저장했습니다');
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      if (err instanceof ApiError) (setErrors(err.fieldErrors()), toast('error', err.body.message));
    } finally {
      setBusy(false);
    }
  }
  if (!can('company:read')) return <EmptyState title="회사 정보 조회 권한이 없습니다" />;
  const field = (k: string, label: string, cls = '') => (
    <Field label={label} error={errors[k]} className={cls}><Input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!editable} /></Field>
  );
  return (
    <>
      <PageHeader title="회사 정보" description="세금계산서 공급자 정보와 출력물 머리글에 쓰입니다." />
      {!q.data ? <Skeleton className="h-80 max-w-3xl" /> : (
        <form onSubmit={save} className="max-w-3xl rounded-[6px] border border-line bg-surface">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="회사 코드" hint="번호 접두어로 쓰이며 바꿀 수 없습니다"><Input value={q.data.code} disabled /></Field>
            {field('name', '상호')}
            {field('bizRegNo', '사업자등록번호')}
            {field('ceoName', '대표자')}
            {field('businessType', '업태')}
            {field('businessItem', '종목')}
            {field('phone', '대표 전화')}
            {field('email', '대표 이메일')}
            {field('address', '사업장 주소', 'sm:col-span-2')}
          </div>
          {editable && <div className="flex justify-end border-t border-line px-4 py-3"><Button type="submit" variant="primary" loading={busy}>저장</Button></div>}
        </form>
      )}
    </>
  );
}
