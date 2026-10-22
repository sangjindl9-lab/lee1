'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, ChevronLeft, FilePlus2, LineChart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CostTable, type BudgetSummary, type CostRow } from '@/components/budget-bits';
import { SumStrip, useRun } from '@/components/doc-ui';
import { Badge, Button, Dialog, EmptyState, Field, Input, MoneyInput, Skeleton, Textarea, TradeTag } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, won } from '@/lib/format';
import { REV_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

function RevisionDialog({ s, focus, onClose, onDone }: { s: BudgetSummary; focus?: string | null; onClose: () => void; onDone: (id: string) => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(s.rows.map((r) => [r.costCodeId, r.planned.split('.')[0].replace(/^0$/, '')])));
  const [title, setTitle] = useState(s.hasBreakdown ? (focus ? `${s.rows.find((r) => r.costCodeId === focus)?.name} 증액` : '실행예산 변경') : '최초 실행예산 편성');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const before = s.rows.reduce((a, r) => a + BigInt(r.planned.split('.')[0]), 0n);
  const after = s.rows.reduce((a, r) => a + BigInt(amounts[r.costCodeId] || '0'), 0n);
  const contract = BigInt(s.revenue.contractCurrent.split('.')[0]);
  async function save(submit: boolean) {
    setErr(null);
    setBusy(submit ? 'submit' : 'save');
    try {
      const lines = s.rows.filter((r) => (amounts[r.costCodeId] || '0') !== r.planned.split('.')[0]).map((r) => ({ costCodeId: r.costCodeId, afterAmount: amounts[r.costCodeId] || '0' }));
      const rev = await api<{ id: string; version: number }>(`/budgets/${s.project.id}/revisions`, { method: 'POST', json: { title, reason, lines } });
      if (submit) await api(`/budget-revisions/${rev.id}/submit`, { method: 'POST', json: { version: rev.version } });
      onDone(rev.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open onClose={onClose} title={s.hasBreakdown ? '실행예산 변경 요청' : '실행예산 편성'} width={720}
      footer={<><Button onClick={onClose}>취소</Button><Button loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>임시저장</Button><Button variant="primary" loading={busy === 'submit'} disabled={!!busy || reason.trim().length < 2} onClick={() => save(true)}>저장하고 결재 상신</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Field label="제목" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="사유" required hint="결재자가 판단할 수 있게 구체적으로"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 안전난간 추가 설치로 안전관리비 부족" /></Field>
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-line">
        <table className="w-full min-w-[560px] text-body">
          <thead><tr className="bg-surface-2 text-meta text-muted"><th className="px-3 py-2 text-left font-medium">원가항목</th><th className="px-3 py-2 text-right font-medium">현재 계획</th><th className="px-3 py-2 text-right font-medium">사용액</th><th className="w-[170px] px-3 py-2 text-right font-medium">변경 후</th><th className="px-3 py-2 text-right font-medium">증감</th></tr></thead>
          <tbody>
            {s.rows.map((r: CostRow) => {
              const delta = BigInt(amounts[r.costCodeId] || '0') - BigInt(r.planned.split('.')[0]);
              const used = Math.max(Number(r.committed), Number(r.actual));
              return (
                <tr key={r.costCodeId} className={r.costCodeId === focus ? 'border-t border-line bg-steel-soft/40' : 'border-t border-line'}>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="num px-3 text-right text-ink-2">{won(r.planned)}</td>
                  <td className="num px-3 text-right text-ink-2">{won(String(used))}</td>
                  <td className="px-2 py-1"><MoneyInput value={amounts[r.costCodeId] ?? ''} onChange={(v) => setAmounts({ ...amounts, [r.costCodeId]: v })} aria-label={`${r.name} 변경 후`} autoFocus={r.costCodeId === focus} /></td>
                  <td className={`num px-3 text-right ${delta > 0n ? 'text-seal' : delta < 0n ? 'text-steel-ink' : 'text-faint'}`}>{delta === 0n ? '–' : `${delta > 0n ? '+' : '△'}${won(String(delta > 0n ? delta : -delta))}`}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td className="px-3 py-2">합계</td><td className="num px-3 text-right">{won(String(before))}</td><td /><td className="num px-3 text-right">{won(String(after))}</td><td className="num px-3 text-right">{after - before === 0n ? '–' : `${after > before ? '+' : '△'}${won(String(after > before ? after - before : before - after))}`}</td></tr></tfoot>
        </table>
      </div>
      <p className="mt-2 text-meta text-muted">계약 공급가액 <span className="num">{won(String(contract))}</span>원 대비 변경 후 계획 이익 <b className="num">{won(String(contract - after))}</b>원{contract > 0n && ` (${((Number(contract - after) / Number(contract)) * 100).toFixed(1)}%)`}</p>
      {err && <p role="alert" className="mt-3 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{err}</p>}
    </Dialog>
  );
}

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['budget', company.id, projectId], queryFn: () => api<BudgetSummary>(`/budgets/${projectId}`), retry: false });
  const [dlg, setDlg] = useState<null | { focus?: string | null }>(null);
  const { run } = useRun(['budget', 'budget-overview']);
  const s = q.data;
  const pending = useMemo(() => s?.revisions.find((r) => ['DRAFT', 'PENDING'].includes(r.status)), [s]);
  if (q.error) return <EmptyState title="현장을 찾을 수 없습니다" />;
  if (!s) return <Skeleton className="h-96" />;
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/budgets" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />실행예산</Link>
          <p className="mb-1 flex items-center gap-2 text-meta text-muted"><TradeTag trade={s.project.tradeType} /><span className="num">{s.project.code}</span></p>
          <h1 className="text-title font-semibold">{s.project.name}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {can('report:read') && <Link href={`/project-pl/${s.project.id}`}><Button icon={<LineChart className="size-3.5" />}>현장 손익</Button></Link>}
          {can('budget:create') && <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setDlg({})}>{s.hasBreakdown ? '예산 변경 요청' : '실행예산 편성'}</Button>}
        </div>
      </div>
      {!s.hasBreakdown && (
        <p className="mb-4 rounded-[6px] border border-warn/40 bg-warn-soft px-4 py-3 text-warn">
          원가항목별 실행예산이 아직 없습니다{Number(s.project.executionBudget) > 0 && <> (현장 등록 시 총액 <b className="num">{won(s.project.executionBudget)}</b>원만 입력됨)</>}. ‘실행예산 편성’으로 항목별로 나눠 결재를 받으면 항목별 초과 경고가 동작합니다.
        </p>
      )}
      {pending && <p className="mb-4 rounded-[6px] border border-line bg-surface px-4 py-2.5 text-meta">진행 중인 변경: <Link href={`/budgets/revisions/${pending.id}`} className="font-medium text-steel-ink underline">{pending.code} {pending.title}</Link> <Badge tone={REV_STATUS[pending.status].tone}>{REV_STATUS[pending.status].label}</Badge></p>}
      <SumStrip items={[
        { label: '① 계획 (실행예산)', value: s.totals.planned },
        { label: '② 발주확정', value: s.totals.committed, tone: 'steel' },
        { label: '③ 발생원가', value: s.totals.actual, hint: s.totals.costRate ? `원가율 ${(Number(s.totals.costRate) * 100).toFixed(1)}%` : undefined },
        { label: '④ 지급완료', value: s.totals.paid, tone: 'ok' },
        { label: '잔여예산', value: s.totals.remaining, tone: Number(s.totals.remaining) < 0 ? 'seal' : undefined },
      ]} />
      <section className="rounded-[6px] border border-line bg-surface">
        <CostTable rows={s.rows} totals={s.totals} onRowAction={(r) => (
          <div className="flex justify-end gap-1">
            {(r.level === 'OVER' || r.level === 'WARN' || r.level === 'UNBUDGETED') && !r.ack && <Button size="sm" variant="quiet" icon={<BellRing className="size-3" />} onClick={() => run('ack', () => api(`/budgets/${projectId}/alerts/${r.costCodeId}/ack`, { method: 'POST', json: { level: r.level === 'WARN' ? 'WARN' : 'OVER' } }), '경고를 확인했습니다')}>확인</Button>}
            {r.ack && <span className="text-[11px] text-faint" title={dateTime(r.ack.ackedAt)}>{r.ack.ackedByName} 확인</span>}
            {(r.level === 'OVER' || r.level === 'UNBUDGETED') && can('budget:create') && <Button size="sm" variant="quiet" onClick={() => setDlg({ focus: r.costCodeId })}>증액</Button>}
          </div>
        )} />
      </section>
      {s.revisions.length > 0 && (
        <section className="mt-4 rounded-[6px] border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2.5 font-semibold">편성·변경 이력</h2>
          <ul className="divide-y divide-line">
            {s.revisions.map((r) => (
              <li key={r.id}><Link href={`/budgets/revisions/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                <span className="num text-muted">{r.code}</span><span className="min-w-0 flex-1 font-medium">{r.title}</span>
                <span className="num text-meta text-ink-2">{won(r.totalBefore)} → {won(r.totalAfter)}</span>
                <Badge tone={REV_STATUS[r.status].tone}>{REV_STATUS[r.status].label}</Badge>
              </Link></li>
            ))}
          </ul>
        </section>
      )}
      {dlg && <RevisionDialog s={s} focus={dlg.focus} onClose={() => setDlg(null)} onDone={(id) => { setDlg(null); qc.invalidateQueries({ queryKey: ['budget'] }); router.push(`/budgets/revisions/${id}`); }} />}
    </>
  );
}
