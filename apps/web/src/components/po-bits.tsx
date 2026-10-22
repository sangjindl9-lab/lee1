'use client';

import { Badge } from './ui';
import { APPROVAL_STATUS, PO_STATUS } from '@/lib/labels';
import type { Approval, PoStatus } from '@/lib/types';

export function PoStatusBadge({ status }: { status: PoStatus }) {
  const s = PO_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ApprovalStatusBadge({ status }: { status: Approval['status'] }) {
  const s = APPROVAL_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** 결재 단계 → 결재란 표시값 */
export function stampSteps(a: Approval | null, fallback: { title: string; name?: string }[] = [{ title: '담당' }, { title: '승인', name: '대표이사' }]) {
  if (!a) return fallback.map((f) => ({ title: f.title, name: f.name, state: 'empty' as const }));
  const md = (v: string | null) => {
    if (!v) return undefined;
    const k = new Date(new Date(v).getTime() + 9 * 3600000).toISOString();
    return `${k.slice(5, 7)}.${k.slice(8, 10)}`;
  };
  return a.steps.map((s) => ({
    title: s.title,
    name: s.state === 'APPROVED' || s.state === 'REJECTED' ? s.actedByName ?? '' : s.state === 'HOLD' ? '보류' : s.approverNames ?? undefined,
    date: md(s.actedAt),
    state: s.state === 'APPROVED' ? ('done' as const) : s.state === 'REJECTED' ? ('rejected' as const) : a.status === 'CANCELLED' ? ('empty' as const) : ('waiting' as const),
  }));
}
