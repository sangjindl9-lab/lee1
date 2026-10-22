'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Dialog, Field, Input, PageHeader, Panel, Spinner, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Rate { id: string; key: string; rate: string; effectiveFrom: string; effectiveTo: string | null; note: string | null; verifiedBy: string | null; createdAt: string }

export default function TaxRatesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<Rate[]>('/settings/tax-rates') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ratePercent: '', effectiveFrom: '', note: '' });
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  async function add() {
    try {
      await api('/settings/tax-rates', { method: 'POST', json: { key: 'VAT', ratePercent: Number(f.ratePercent), effectiveFrom: f.effectiveFrom, note: f.note } });
      toast('ok', '새 세율을 등록했습니다');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['tax-rates'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '등록하지 못했습니다');
    }
  }

  return (
    <>
      <PageHeader
        title="세율 설정"
        description="부가세율 등 법정 요율은 프로그램에 고정하지 않고 적용 기간별로 관리합니다. 법 개정 시 새 적용일로 추가하면 그 날짜 이후 계약부터 적용됩니다."
        actions={can('company:update') && <Button variant="primary" onClick={() => setOpen(true)}>새 세율 등록</Button>}
      />
      <Panel title="부가가치세" bodyClassName="p-0">
        {!q.data ? <div className="p-6 text-center"><Spinner /></div> : (
          <table className="w-full text-body">
            <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-4 py-2 text-left font-medium">적용 기간</th><th className="px-4 py-2 text-right font-medium">세율</th><th className="px-4 py-2 text-left font-medium">근거</th><th className="px-4 py-2 text-left font-medium max-sm:hidden">등록자</th></tr></thead>
            <tbody>
              {q.data.filter((r) => r.key === 'VAT').map((r) => {
                const current = r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today);
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="num px-4 py-2.5">{r.effectiveFrom} ~ {r.effectiveTo ?? ''} {current && <Badge tone="steel" className="ml-1">현재 적용</Badge>}</td>
                    <td className="num px-4 py-2.5 text-right font-semibold">{(Number(r.rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%</td>
                    <td className="px-4 py-2.5 text-ink-2">{r.note}</td>
                    <td className="px-4 py-2.5 text-muted max-sm:hidden">{r.verifiedBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <Dialog open={open} onClose={() => setOpen(false)} title="새 부가세율 등록" footer={<><Button onClick={() => setOpen(false)}>취소</Button><Button variant="primary" disabled={!f.ratePercent || !f.effectiveFrom || !f.note} onClick={add}>등록</Button></>}>
        <div className="space-y-4">
          <p className="rounded-[4px] bg-warn-soft px-3 py-2 text-meta text-warn">개정된 법령을 확인한 뒤 등록하세요. 기존 세율은 새 적용일 전날로 자동 종료됩니다.</p>
          <Field label="세율 (%)"><Input inputMode="decimal" value={f.ratePercent} onChange={(e) => setF({ ...f, ratePercent: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
          <Field label="적용 시작일"><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
          <Field label="근거 법령·공고" hint="예: 부가가치세법 제30조 개정 (2027.1.1 시행)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
