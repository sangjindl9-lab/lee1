'use client';

/**
 * 결재 문서 화면 공통 부품 — 결재 패널, 결재 이력, 사유 입력 대화상자, 진행 단계, 상태 탭, 요약 띠.
 * 발주서·지급결의·실행예산·기성 등 모든 결재 문서가 같은 모양과 동작을 쓴다.
 */
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pause, X } from 'lucide-react';
import { ReactNode, useCallback, useState } from 'react';
import { sealUrl, stampSteps } from './po-bits';
import { ApprovalBox, Badge, Button, Dialog, Field, Seal, Textarea, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, won } from '@/lib/format';
import type { Approval } from '@/lib/types';

/** 버튼 동작 공통: 진행 표시·성공/실패 알림·캐시 갱신 */
export function useRun(invalidate: string[] = []) {
  const toast = useToast();
  const qc = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, ok?: string) => {
      setActing(key);
      try {
        const r = await fn();
        if (ok) toast('ok', ok);
        for (const k of [...invalidate, 'dashboard', 'approval-counts', 'approvals']) qc.invalidateQueries({ queryKey: [k] });
        return r ?? true;
      } catch (e) {
        toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
        return false;
      } finally {
        setActing(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, qc, invalidate.join(',')],
  );
  return { run, acting };
}

export function ApprovalActionPanel({ approval, summary, onDone }: { approval: Approval; summary: ReactNode; onDone?: (action: string) => void }) {
  const [comment, setComment] = useState('');
  const { run, acting } = useRun();
  const cur = approval.steps.find((s) => s.stepNo === approval.currentStep);
  const act = async (action: 'approve' | 'reject' | 'hold') => {
    const ok = await run(action, () => api(`/approvals/${approval.id}/act`, { method: 'POST', json: { action, comment: comment || null, version: approval.version } }), { approve: '승인했습니다', reject: '반려했습니다', hold: '보류했습니다' }[action]);
    if (ok) {
      setComment('');
      onDone?.(action);
    }
  };
  return (
    <section className="mb-4 rounded-[6px] border-2 border-steel bg-surface p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">결재할 차례입니다 — {cur?.title}</p>
          <p className="mt-0.5 text-muted"><span className="num">{approval.drafterName} · {dateTime(approval.submittedAt)} 상신</span> · {summary}</p>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="의견 (반려할 때는 사유를 꼭 적어 주세요)" className="mt-3" aria-label="결재 의견" />
        </div>
        <div className="flex w-full gap-2 sm:w-auto sm:flex-col">
          <Button variant="primary" className="h-10! flex-1 px-6 sm:flex-none" icon={<Check className="size-4" />} loading={acting === 'approve'} disabled={!!acting} onClick={() => act('approve')}>승인</Button>
          <Button className="flex-1 sm:flex-none" icon={<Pause className="size-3.5" />} loading={acting === 'hold'} disabled={!!acting} onClick={() => act('hold')}>보류</Button>
          <Button variant="danger" className="flex-1 sm:flex-none" icon={<X className="size-3.5" />} loading={acting === 'reject'} disabled={!!acting || !comment.trim()} title={!comment.trim() ? '반려 사유를 입력해 주세요' : undefined} onClick={() => act('reject')}>반려</Button>
        </div>
      </div>
    </section>
  );
}

export function JustApproved({ approval, text }: { approval: Approval | null; text: string }) {
  return (
    <section className="mb-4 flex items-center gap-4 rounded-[6px] border border-line bg-surface p-4">
      <Seal image={sealUrl(approval?.steps[approval.steps.length - 1]?.actedStampId)} name={approval?.steps[approval.steps.length - 1]?.actedByName ?? '승인'} date={new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')} size={64} animate />
      <div><p className="font-semibold">결재가 끝났습니다</p><p className="text-muted">{text}</p></div>
    </section>
  );
}

export function ApprovalHistory({ history }: { history: Approval[] }) {
  if (!history.length) return null;
  return (
    <section className="rounded-[6px] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2.5 font-semibold">결재 이력</h2>
      <ol className="space-y-3 px-4 py-3">
        {history.map((h, hi) => (
          <li key={h.id} className={clsx(hi > 0 && 'border-t border-dashed border-line pt-3')}>
            <p className="num mb-1.5 text-meta text-muted">{hi === 0 ? '현재 결재' : `이전 결재 ${history.length - hi}`} · {dateTime(h.submittedAt)} 상신 · {{ PENDING: '진행 중', HOLD: '보류', APPROVED: '승인 완료', REJECTED: '반려', CANCELLED: '회수' }[h.status]}</p>
            <ul className="space-y-1">
              {h.steps.map((s) => (
                <li key={s.id} className="flex gap-2 text-meta">
                  <span className="w-8 shrink-0 text-muted">{s.title}</span>
                  <span className={clsx('min-w-0 flex-1', s.state === 'REJECTED' ? 'text-seal' : s.state === 'APPROVED' ? 'text-ink' : 'text-faint')}>
                    {s.state === 'WAITING' ? `${s.approverNames ?? ''} 대기` : `${s.actedByName} ${{ APPROVED: s.stepNo === 0 ? '상신' : '승인', REJECTED: '반려', HOLD: '보류', SKIPPED: '생략', WAITING: '' }[s.state]}`}
                    {s.actedAt && <span className="num text-faint"> · {dateTime(s.actedAt)}</span>}
                    {s.comment && <span className="block text-ink-2">“{s.comment}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 결재란 (현재 결재 기준) */
export function StampBox({ approval, fallback }: { approval: Approval | null; fallback?: { title: string; name?: string }[] }) {
  return <ApprovalBox steps={stampSteps(approval && approval.status !== 'CANCELLED' ? approval : null, fallback)} />;
}

export function ReasonDialog({ open, title, body, confirm, danger, onClose, onConfirm, label = '사유', extra }: { open: boolean; title: string; body: ReactNode; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<unknown>; label?: string; extra?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      tone={danger ? 'danger' : undefined}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 2} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); setReason(''); } finally { setBusy(false); } }}>{confirm}</Button></>}
    >
      <div className="space-y-3">
        <div className="text-ink-2">{body}</div>
        {extra}
        <Field label={label} required hint="감사로그에 남습니다"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus /></Field>
      </div>
    </Dialog>
  );
}

/** 진행 단계 표시 (작성 → 결재 → 승인 → …) */
export function Progress({ steps, current, failed, done }: { steps: string[]; current: number; failed?: boolean; done?: boolean }) {
  return (
    <ol className="flex items-center">
      {steps.map((p, i) => {
        const isDone = i < current || (done && i === current);
        const cur = i === current && !done;
        return (
          <li key={p} className="flex flex-1 items-center last:flex-none">
            <span className="flex flex-col items-center gap-1">
              <span className={clsx('grid size-6 place-items-center rounded-full border text-[11px] font-semibold', isDone ? 'border-ok bg-ok text-white' : cur ? (failed ? 'border-seal text-seal' : 'border-steel text-steel') : 'border-line-strong text-faint')}>
                {isDone ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={clsx('text-meta whitespace-nowrap', cur ? 'font-medium text-ink' : 'text-muted')}>{p}</span>
            </span>
            {i < steps.length - 1 && <span className={clsx('mx-1 mb-5 h-px flex-1', i < current ? 'bg-ok' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** 목록 위 상태 필터 (라디오 탭) */
export function SegTabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-x-auto rounded-[4px] bg-surface-2 p-0.5 max-sm:w-full">
      {items.map((t) => (
        <button key={t.value} type="button" role="radio" aria-checked={value === t.value} onClick={() => onChange(t.value)} className={clsx('h-7 shrink-0 rounded-[3px] px-2.5 text-meta whitespace-nowrap', value === t.value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}

/** 회계 화면 상단 요약 — 총액·공급가액·부가세·미지급액을 한눈에 (지시서 17장) */
export function SumStrip({ items }: { items: { label: string; value: string | null | undefined; tone?: 'seal' | 'ok' | 'steel' | 'muted'; hint?: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="mb-4 grid grid-cols-2 overflow-hidden rounded-[6px] border border-line bg-surface sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {items.map((i) => (
        <div key={i.label} className="min-w-0 border-line px-4 py-3 not-last:border-r max-sm:border-b">
          <dt className="text-meta text-muted">{i.label}</dt>
          <dd className={clsx('num mt-0.5 truncate text-[18px] leading-7 font-semibold tracking-[-0.01em]', i.tone === 'seal' ? 'text-seal' : i.tone === 'ok' ? 'text-ok' : i.tone === 'steel' ? 'text-steel-ink' : i.tone === 'muted' ? 'text-muted' : 'text-ink')}>
            {won(i.value ?? '0')}<span className="ml-0.5 text-meta font-normal text-faint">원</span>
          </dd>
          {i.hint && <p className="mt-0.5 truncate text-meta text-faint">{i.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

export function DocStatus({ label, tone }: { label: string; tone: 'outline' | 'steel' | 'seal' | 'ok' | 'ink' | 'warn' | 'muted' }) {
  return <Badge tone={tone}>{label}</Badge>;
}
