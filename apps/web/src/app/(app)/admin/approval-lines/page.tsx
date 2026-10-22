'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApproverSelect, type LineStep, type Person } from '@/components/approval-line';
import { ApprovalBox, Button, EmptyState, Field, Input, MoneyInput, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Line { minAmount: string; steps: LineStep[] }
interface Resp { lines: (Line & { docType: string })[]; roles: { key: string; name: string }[]; people: Person[]; required: Record<string, string>; docTypes: Record<string, string>; defaults: Record<string, LineStep[]> }

const ORDER = ['PURCHASE_ORDER', 'PAYMENT_REQUEST', 'CLAIM', 'CONTRACT_CHANGE', 'SUBCONTRACT', 'SUB_CLAIM', 'BUDGET', 'TAX_ISSUE'];

export default function ApprovalLinesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['approval-lines', company.id], queryFn: () => api<Resp>('/approvals/lines'), enabled: can('approval:read') });
  const [docType, setDocType] = useState('PURCHASE_ORDER');
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const required = d?.required[docType];

  useEffect(() => {
    if (!d) return;
    const saved = d.lines.filter((l) => l.docType === docType).map((l) => ({ minAmount: l.minAmount.split('.')[0], steps: l.steps }));
    setLines(saved.length ? saved : [{ minAmount: '0', steps: d.defaults[docType] ?? [{ title: '승인', roleKey: 'CEO' }] }]);
    setDirty(false);
  }, [d, docType]);

  const update = (i: number, fn: (l: Line) => Line) => (setLines((ls) => ls.map((l, j) => (j === i ? fn(l) : l))), setDirty(true));
  const nameOf = (s: LineStep) => (s.userId ? d?.people.find((p) => p.id === s.userId)?.name : d?.roles.find((r) => r.key === s.roleKey)?.name) ?? '미지정';

  async function save() {
    setBusy(true);
    try {
      await api('/approvals/lines', { method: 'PUT', json: { docType, lines } });
      toast('ok', `${d?.docTypes[docType]} 결재선을 저장했습니다. 이후 상신하는 문서부터 적용됩니다`);
      qc.invalidateQueries({ queryKey: ['approval-lines'] });
      setDirty(false);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  if (!can('approval:read')) return <EmptyState title="결재선 설정 권한이 없습니다" />;
  const editable = can('approval:update');
  const sorted = lines.map((l, i) => ({ l, i })).sort((a, b) => Number(a.l.minAmount) - Number(b.l.minAmount));
  const types = d ? ORDER.filter((t) => d.docTypes[t]) : [];

  return (
    <>
      <PageHeader title="결재선 설정" description="문서 종류별 기본 결재선입니다. 검토 단계를 사람 또는 역할로 지정할 수 있고, 금액이 큰 문서에는 단계를 더 둘 수 있습니다. 상신하는 사람은 문서마다 최종 승인 앞 단계를 다시 고를 수 있습니다." />
      {!d ? <Skeleton className="h-64 max-w-5xl" /> : (
        <div className="grid max-w-5xl gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="문서 종류" className="self-start rounded-[6px] border border-line bg-surface p-1.5">
            {types.map((t) => (
              <button key={t} type="button" aria-current={t === docType ? 'page' : undefined}
                onClick={() => { if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 다른 문서로 넘어갈까요?')) return; setDocType(t); }}
                className={clsx('block w-full rounded-[4px] px-2.5 py-1.5 text-left', t === docType ? 'bg-steel-soft font-medium text-steel-ink' : 'hover:bg-surface-2')}>
                {d.docTypes[t]}
              </button>
            ))}
          </nav>
          <div className="min-w-0 space-y-3">
            {required && <p className="flex items-center gap-1.5 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-ink-2"><Lock className="size-3.5 text-muted" />{d.docTypes[docType]}는 회사 규정상 마지막 결재가 대표이사로 고정됩니다.</p>}
            {sorted.map(({ l, i }, k) => {
              const next = sorted[k + 1]?.l.minAmount;
              const fixedLast = !!required;
              const editableSteps = fixedLast ? l.steps.slice(0, -1) : l.steps;
              const setSteps = (steps: LineStep[]) => update(i, (x) => ({ ...x, steps: fixedLast ? [...steps, { title: '승인', roleKey: required, userId: null }] : steps }));
              const used = l.steps.map((s) => s.userId).filter(Boolean) as string[];
              return (
                <section key={i} className="rounded-[6px] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="w-full sm:w-52">
                      <Field label="적용 금액" hint={next ? `${won(l.minAmount)}원 이상 ~ ${won(next)}원 미만` : `${won(l.minAmount)}원 이상`}>
                        <MoneyInput value={l.minAmount} onChange={(v) => update(i, (x) => ({ ...x, minAmount: v || '0' }))} disabled={k === 0 && l.minAmount === '0'} />
                      </Field>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-meta font-medium text-ink-2">결재 단계 <span className="font-normal text-muted">(담당 다음부터 순서대로)</span></p>
                      {editableSteps.map((s, si) => (
                        <div key={si} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                          <span className="w-5 text-center text-meta text-faint">{si + 1}</span>
                          <Input value={s.title} onChange={(e) => setSteps(editableSteps.map((x, xi) => (xi === si ? { ...x, title: e.target.value.slice(0, 10) } : x)))} className="w-24" aria-label="단계 이름" />
                          <ApproverSelect step={s} people={d.people} roles={d.roles} exclude={used} onChange={(x) => setSteps(editableSteps.map((y, yi) => (yi === si ? x : y)))} className="min-w-0 flex-1" />
                          <span className="flex">
                            <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="위로" disabled={si === 0} onClick={() => { const n = [...editableSteps]; [n[si - 1], n[si]] = [n[si], n[si - 1]]; setSteps(n); }}><ArrowUp className="size-4" /></button>
                            <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="아래로" disabled={si === editableSteps.length - 1} onClick={() => { const n = [...editableSteps]; [n[si + 1], n[si]] = [n[si], n[si + 1]]; setSteps(n); }}><ArrowDown className="size-4" /></button>
                            <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-seal-soft hover:text-seal disabled:opacity-30" aria-label="단계 빼기" disabled={!fixedLast && editableSteps.length === 1} onClick={() => setSteps(editableSteps.filter((_, xi) => xi !== si))}><Trash2 className="size-4" /></button>
                          </span>
                        </div>
                      ))}
                      {fixedLast && <div className="flex items-center gap-2 rounded-[4px] bg-surface-2 px-3 py-2 text-ink-2"><span className="w-5 text-center text-meta text-faint">{editableSteps.length + 1}</span><span className="w-24">승인</span><span>대표이사</span><span className="ml-auto inline-flex items-center gap-1 text-meta text-muted"><Lock className="size-3.5" />고정</span></div>}
                      {l.steps.length < 6 && (
                        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setSteps(fixedLast ? [...editableSteps, { title: '검토', roleKey: null, userId: null }] : [...editableSteps.slice(0, -1), { title: '검토', roleKey: null, userId: null }, editableSteps[editableSteps.length - 1]])}>
                          최종 승인 앞에 단계 추가
                        </Button>
                      )}
                    </div>
                    <div className="shrink-0">
                      <div className="overflow-x-auto"><ApprovalBox steps={[{ title: '담당', state: 'empty' }, ...l.steps.map((s) => ({ title: s.title || '?', name: nameOf(s), state: 'waiting' as const }))]} /></div>
                      {k > 0 && <Button size="sm" variant="quiet" className="mt-2 text-meta text-seal" onClick={() => (setLines((ls) => ls.filter((_, j) => j !== i)), setDirty(true))}>이 금액 구간 삭제</Button>}
                    </div>
                  </div>
                </section>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button icon={<Plus className="size-3.5" />} onClick={() => (setLines((ls) => [...ls, { minAmount: String(Math.max(...ls.map((l) => Number(l.minAmount))) + 10000000), steps: ls[0].steps }]), setDirty(true))}>금액 구간 추가</Button>
              {editable && <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>결재선 저장</Button>}
            </div>
            <p className="text-meta text-muted">사람으로 지정한 단계는 그 사람만 결재할 수 있습니다 (휴가·퇴사 때는 결재선을 바꾸세요). 역할로 지정하면 그 역할을 가진 누구나 결재할 수 있습니다.</p>
          </div>
        </div>
      )}
    </>
  );
}
