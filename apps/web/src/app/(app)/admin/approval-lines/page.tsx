'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApprovalBox, Button, EmptyState, Field, Input, MoneyInput, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Line { minAmount: string; steps: { title: string; roleKey: string }[] }
interface Resp { lines: (Line & { docType: string })[]; roles: { key: string; name: string }[]; required: Record<string, string> }

export default function ApprovalLinesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['approval-lines', company.id], queryFn: () => api<Resp>('/approvals/lines'), enabled: can('approval:read') });
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setLines(q.data.lines.filter((l) => l.docType === 'PURCHASE_ORDER').map((l) => ({ minAmount: l.minAmount.split('.')[0], steps: l.steps })));
  }, [q.data]);
  const roleName = (k: string) => q.data?.roles.find((r) => r.key === k)?.name ?? k;
  const extra = (l: Line) => l.steps.slice(0, -1); // 마지막(대표이사)을 뺀 앞 단계들
  const setExtra = (i: number, steps: Line['steps']) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, steps: [...steps, { title: '승인', roleKey: 'CEO' }] } : l)));

  async function save() {
    setBusy(true);
    try {
      await api('/approvals/lines', { method: 'PUT', json: { docType: 'PURCHASE_ORDER', lines } });
      toast('ok', '결재선을 저장했습니다. 이후 상신하는 발주서부터 적용됩니다');
      qc.invalidateQueries({ queryKey: ['approval-lines'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  if (!can('approval:read')) return <EmptyState title="결재선 설정 권한이 없습니다" />;
  const sorted = [...lines].map((l, i) => ({ l, i })).sort((a, b) => Number(a.l.minAmount) - Number(b.l.minAmount));
  return (
    <>
      <PageHeader title="결재선 설정" description="발주서는 회사 규정에 따라 마지막 결재가 항상 대표이사입니다. 금액이 큰 발주서에는 대표이사 앞에 검토 단계를 더할 수 있습니다." />
      {!q.data ? <Skeleton className="h-64 max-w-4xl" /> : (
        <div className="max-w-4xl space-y-3">
          {sorted.map(({ l, i }, k) => {
            const next = sorted[k + 1]?.l.minAmount;
            return (
              <section key={i} className="rounded-[6px] border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="w-full sm:w-56">
                    <Field label="적용 금액 (합계 기준)" hint={next ? `${won(l.minAmount)}원 이상 ~ ${won(next)}원 미만` : `${won(l.minAmount)}원 이상`}>
                      <MoneyInput value={l.minAmount} onChange={(d) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, minAmount: d || '0' } : x)))} disabled={l.minAmount === '0' && k === 0} />
                    </Field>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-meta font-medium text-ink-2">결재 단계</p>
                    {extra(l).map((s, si) => (
                      <div key={si} className="flex items-center gap-2">
                        <Input value={s.title} onChange={(e) => setExtra(i, extra(l).map((x, xi) => (xi === si ? { ...x, title: e.target.value.slice(0, 10) } : x)))} className="w-24" aria-label="단계 이름" />
                        <Select value={s.roleKey} onChange={(e) => setExtra(i, extra(l).map((x, xi) => (xi === si ? { ...x, roleKey: e.target.value } : x)))} className="flex-1" aria-label="결재 역할">
                          {q.data!.roles.filter((r) => r.key !== 'CEO').map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                        </Select>
                        <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-seal-soft hover:text-seal" aria-label="단계 빼기" onClick={() => setExtra(i, extra(l).filter((_, xi) => xi !== si))}><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 rounded-[4px] bg-surface-2 px-3 py-2 text-ink-2"><Lock className="size-3.5 text-muted" /><span className="w-[84px]">승인</span><span>대표이사</span><span className="ml-auto text-meta text-muted">고정</span></div>
                    {extra(l).length < 3 && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setExtra(i, [...extra(l), { title: '검토', roleKey: 'ACCOUNTING_MANAGER' }])}>대표이사 앞에 단계 추가</Button>}
                  </div>
                  <div className="shrink-0">
                    <ApprovalBox steps={[{ title: '담당', state: 'empty' }, ...l.steps.map((s) => ({ title: s.title, name: roleName(s.roleKey), state: 'waiting' as const }))]} />
                    {k > 0 && <Button size="sm" variant="quiet" className="mt-2 text-meta text-seal" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>이 구간 삭제</Button>}
                  </div>
                </div>
              </section>
            );
          })}
          <div className="flex items-center justify-between">
            <Button icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, { minAmount: String(Math.max(...ls.map((l) => Number(l.minAmount))) + 10000000), steps: [{ title: '검토', roleKey: 'ACCOUNTING_MANAGER' }, { title: '승인', roleKey: 'CEO' }] }])}>금액 구간 추가</Button>
            {can('approval:update') && <Button variant="primary" loading={busy} onClick={save}>결재선 저장</Button>}
          </div>
        </div>
      )}
    </>
  );
}
