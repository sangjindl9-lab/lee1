'use client';

/**
 * 결재선 지정 — 상신할 때 이번 문서만 결재선을 바꾼다.
 * 회사 결재선을 불러와 보여 주고, 마지막(최종 승인) 앞에 검토 단계를 더하거나 빼거나 순서를 바꿀 수 있다.
 * 마지막 결재자는 회사 결재선대로 고정 (서버에서도 다시 확인).
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApprovalBox, Button, Dialog, Input, Select, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface LineStep { title: string; roleKey?: string | null; userId?: string | null }
export interface Person { id: string; name: string; department: string | null; position: string | null; roles: string[]; roleKeys: string[] }
interface Preview { drafter: string; docLabel: string; steps: (LineStep & { approverNames: string | null })[] }
export interface RoleOpt { key: string; name: string }

export const personLabel = (p: Person) => [p.name, p.position, p.department && `(${p.department})`].filter(Boolean).join(' ');

/** 결재자 고르기 — 사람 또는 역할(그 역할을 가진 누구나) */
export function ApproverSelect({ step, people, roles, onChange, exclude, className }: { step: LineStep; people: Person[]; roles?: RoleOpt[]; onChange: (s: LineStep) => void; exclude?: string[]; className?: string }) {
  const value = step.userId ? `u:${step.userId}` : step.roleKey ? `r:${step.roleKey}` : '';
  return (
    <Select
      value={value}
      className={className}
      aria-label="결재자"
      onChange={(e) => {
        const v = e.target.value;
        onChange(v.startsWith('u:') ? { ...step, userId: v.slice(2), roleKey: null } : v.startsWith('r:') ? { ...step, roleKey: v.slice(2), userId: null } : { ...step, userId: null, roleKey: null });
      }}
    >
      <option value="">결재자 선택</option>
      <optgroup label="사람 지정">
        {people.filter((p) => !exclude?.includes(p.id) || `u:${p.id}` === value).map((p) => <option key={p.id} value={`u:${p.id}`}>{personLabel(p)}</option>)}
      </optgroup>
      {roles && roles.length > 0 && (
        <optgroup label="역할 (그 역할을 가진 누구나)">
          {roles.map((r) => <option key={r.key} value={`r:${r.key}`}>{r.name}</option>)}
        </optgroup>
      )}
    </Select>
  );
}

function LineDialog({ docType, amount, myId, onDone }: { docType: string; amount: string; myId: string; onDone: (v: LineStep[] | undefined | null) => void }) {
  const pv = useQuery({ queryKey: ['approval-preview', docType, amount], queryFn: () => api<Preview>(`/approvals/preview?docType=${docType}&amount=${amount}`), staleTime: 0 });
  const ppl = useQuery({ queryKey: ['approval-candidates'], queryFn: () => api<Person[]>('/approvals/candidates'), staleTime: 60_000 });
  const [mid, setMid] = useState<LineStep[] | null>(null);
  const base = pv.data?.steps ?? [];
  const final = base[base.length - 1];
  useEffect(() => {
    if (pv.data && mid === null) setMid(pv.data.steps.slice(0, -1).map(({ title, roleKey, userId }) => ({ title, roleKey, userId })));
  }, [pv.data, mid]);
  const people = (ppl.data ?? []).filter((p) => p.id !== myId);
  const nameOf = (s: LineStep & { approverNames?: string | null }) => (s.userId ? people.find((p) => p.id === s.userId)?.name : s.approverNames ?? pv.data?.steps.find((x) => x.roleKey === s.roleKey)?.approverNames) ?? '미지정';
  const changed = useMemo(() => !!mid && JSON.stringify(mid) !== JSON.stringify(base.slice(0, -1).map(({ title, roleKey, userId }) => ({ title, roleKey, userId }))), [mid, base]);
  const incomplete = !!mid?.some((s) => !s.title.trim() || (!s.userId && !s.roleKey));
  const roles = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ppl.data ?? []) p.roleKeys.forEach((k, i) => m.set(k, p.roles[i] ?? k));
    return [...m.entries()].map(([key, name]) => ({ key, name }));
  }, [ppl.data]);
  const move = (i: number, d: -1 | 1) => setMid((m) => { const n = [...m!]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const set = (i: number, s: LineStep) => setMid((m) => m!.map((x, j) => (j === i ? s : x)));
  const used = (mid ?? []).map((s) => s.userId).filter(Boolean) as string[];

  return (
    <Dialog open onClose={() => onDone(null)} title={`결재선 지정${pv.data ? ` — ${pv.data.docLabel}` : ''}`} width={640}
      footer={<>
        <Button onClick={() => onDone(null)}>취소</Button>
        <Button variant="primary" disabled={!mid || incomplete || (mid.length + 1) > 6} onClick={() => onDone(changed ? [...mid!, { title: final.title, roleKey: final.roleKey ?? null, userId: final.userId ?? null }] : undefined)}>결재 상신</Button>
      </>}>
      {!pv.data || !mid || !ppl.data ? <Skeleton className="h-48" /> : (
        <div className="space-y-4">
          <p className="text-ink-2">회사 결재선이 채워져 있습니다. 이 문서만 <b>최종 승인 앞에</b> 검토 단계를 더하거나 빼고, 결재할 사람을 직접 고를 수 있습니다.</p>
          <ol className="space-y-2">
            <li className="flex items-center gap-2 rounded-[4px] bg-surface-2 px-3 py-2 text-ink-2"><span className="w-6 text-center text-meta text-faint">0</span><span className="w-24">담당</span><span>{pv.data.drafter} (나)</span></li>
            {mid.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <span className="w-6 text-center text-meta text-faint">{i + 1}</span>
                <Input value={s.title} onChange={(e) => set(i, { ...s, title: e.target.value.slice(0, 10) })} className="w-24" aria-label="단계 이름" placeholder="검토" />
                <ApproverSelect step={s} people={people} roles={roles} exclude={used} onChange={(x) => set(i, x)} className="min-w-0 flex-1" />
                <span className="flex">
                  <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></button>
                  <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="아래로" disabled={i === mid.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></button>
                  <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-seal-soft hover:text-seal" aria-label="단계 빼기" onClick={() => setMid(mid.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 rounded-[4px] bg-surface-2 px-3 py-2 text-ink-2">
              <span className="w-6 text-center text-meta text-faint">{mid.length + 1}</span><span className="w-24">{final.title}</span><span>{final.approverNames ?? '미지정'}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-meta text-muted"><Lock className="size-3.5" />최종 승인 고정</span>
            </li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {mid.length < 5 && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setMid([...mid, { title: '검토', userId: null, roleKey: null }])}>최종 승인 앞에 단계 추가</Button>}
            {changed && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setMid(base.slice(0, -1).map(({ title, roleKey, userId }) => ({ title, roleKey, userId })))}>회사 결재선으로 되돌리기</Button>}
          </div>
          <div className="overflow-x-auto">
            <ApprovalBox steps={[{ title: '담당', name: pv.data.drafter, state: 'waiting' }, ...mid.map((s) => ({ title: s.title || '?', name: nameOf(s), state: 'waiting' as const })), { title: final.title, name: final.approverNames ?? '', state: 'waiting' as const }]} />
          </div>
          {changed && <p className="text-meta text-steel-ink">이 문서에만 적용됩니다. 회사 기본 결재선은 '전자결재 › 결재선 설정'에서 바꿉니다.</p>}
        </div>
      )}
    </Dialog>
  );
}

/**
 * 사용: const { pick, node } = useApprovalLine(); … const line = await pick('PURCHASE_ORDER', amount);
 * null = 취소, undefined = 회사 결재선 그대로, 배열 = 이번 문서만 지정한 결재선 (요청 본문 approvalLine 으로 보냄)
 */
export function useApprovalLine() {
  const myId = useSession().me.user.id;
  const [req, setReq] = useState<{ docType: string; amount: string } | null>(null);
  const resolver = useRef<((v: LineStep[] | undefined | null) => void) | null>(null);
  const pick = useCallback((docType: string, amount: string | number | null | undefined) => new Promise<LineStep[] | undefined | null>((res) => {
    resolver.current = res;
    setReq({ docType, amount: String(Math.abs(Math.trunc(Number(amount ?? 0))) || 0) });
  }), []);
  const node = req ? <LineDialog key={req.docType + req.amount} docType={req.docType} amount={req.amount} myId={myId} onDone={(v) => { resolver.current?.(v); resolver.current = null; setReq(null); }} /> : null;
  return { pick, node };
}
