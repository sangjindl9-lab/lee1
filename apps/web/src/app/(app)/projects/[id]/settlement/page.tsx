'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, ChevronLeft, Lock, OctagonX, Printer, Unlock } from 'lucide-react';
import { useState } from 'react';
import { ReasonDialog, useRun } from '@/components/doc-ui';
import { Badge, Button, Checkbox, EmptyState, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, pct, won } from '@/lib/format';
import { TRADE, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Check { key: string; label: string; level: 'BLOCK' | 'WARN' | 'OK'; detail: string; href?: string }
interface P {
  project: { id: string; code: string; name: string; tradeType: TradeType; status: string; contractDate: string | null; startDate: string | null; plannedEndDate: string | null; actualEndDate: string | null; clientName: string | null };
  figures: Record<string, string | null>;
  costRows: { costCodeId: string; code: string; name: string; planned: string; committed: string; actual: string; paid: string }[];
  subcontracts: { id: string; code: string; title: string; status: string; vendor_name: string; amount: string; claimed: string; retention: string; balance: string }[];
  checks: Check[]; canSettle: boolean;
  settlement: { id: string; settleDate: string; finalContract: string; profit: string; memo: string | null; createdAt: string } | null;
  history: { id: string; settleDate: string; status: string; profit: string; reopenReason: string | null; createdAt: string }[];
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['settlement', company.id, id], queryFn: () => api<P>(`/projects/${id}/settlement`), retry: false });
  const { run, acting } = useRun(['projects', 'project-pl']);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [f, setF] = useState({ settleDate: today, memo: '', acknowledge: false });
  const [reopen, setReopen] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['settlement', company.id, id] });
  if (q.error) return <EmptyState title="현장을 찾을 수 없습니다" />;
  if (!d) return <Skeleton className="h-[560px]" />;
  const g = d.figures;
  const settled = d.project.status === 'SETTLED';
  const warns = d.checks.filter((c) => c.level === 'WARN');
  const row = (label: string, v: string | null | undefined, opts: { strong?: boolean; tone?: string; sub?: string } = {}) => (
    <div className={clsx('flex items-baseline justify-between gap-3 py-1.5', opts.strong && 'border-t border-line pt-2 font-semibold')}>
      <dt className={clsx(!opts.strong && 'text-muted')}>{label}{opts.sub && <span className="ml-1 text-meta font-normal text-faint">{opts.sub}</span>}</dt>
      <dd className={clsx('num', opts.tone)}>{won(v ?? '0')}</dd>
    </div>
  );
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between print:hidden">
        <div>
          <Link href={`/projects/${id}`} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />{d.project.name}</Link>
          <h1 className="text-title font-semibold">준공정산 {settled && <Badge tone="ok">정산 완료</Badge>}</h1>
          <p className="text-meta text-muted">최종 계약·기성·수금·원가·지급을 한 장으로 확인하고 현장을 잠급니다.</p>
        </div>
        <div className="flex gap-1.5">
          <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>인쇄 · PDF 저장</Button>
          {settled && can('closing:approve') && <Button icon={<Unlock className="size-3.5" />} onClick={() => setReopen(true)}>다시 열기</Button>}
        </div>
      </div>

      <article className="rounded-[6px] bg-surface-2 p-2 sm:p-5 print:bg-white print:p-0">
        <div className="rounded-[2px] bg-white p-6 text-[13px] text-[#17202b] shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_24px_-12px_rgb(16_24_40/0.18)] ring-1 ring-black/5 sm:p-8 [color-scheme:light] print:shadow-none print:ring-0">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#17202b] pb-3">
            <div>
              <p className="text-[11px] text-[#5b6573]">{d.project.code}</p>
              <h2 className="text-[22px] font-bold tracking-[0.2em]">공사 준공정산서</h2>
            </div>
            <div className="text-right text-[12px]">
              <p className="font-semibold"><span aria-hidden className="mr-1.5 inline-block h-3 w-1 rounded-[1px] align-middle" style={{ background: TRADE[d.project.tradeType].color }} />{d.project.name}</p>
              <p className="num text-[#5b6573]">발주처 {d.project.clientName ?? '–'} · 계약 {d.project.contractDate ?? '–'} · 공기 {d.project.startDate ?? '–'} ~ {d.project.actualEndDate ?? d.project.plannedEndDate ?? '–'}</p>
            </div>
          </header>
          <div className="mt-5 grid gap-6 md:grid-cols-3">
            <dl>
              <p className="mb-1 font-semibold">계약·매출</p>
              {row('최초 계약금액', g.contractOriginal)}
              {row('최종 계약금액', g.contractFinal, { sub: '변경계약 반영' })}
              {row('인식 매출 (승인 기성)', g.recognized)}
              {row('미청구 기성', g.unbilled, { tone: Number(g.unbilled) ? 'text-[#b25e00]' : undefined })}
              {row('수금액', g.collected)}
              {row('미수금', g.receivable, { strong: true, tone: Number(g.receivable) ? 'text-[#c42b1c]' : undefined })}
            </dl>
            <dl>
              <p className="mb-1 font-semibold">원가·지급</p>
              {row('실행예산', g.budget)}
              {row('발주·계약 확정', g.committed)}
              {row('발생원가', g.cost)}
              {row('지급액', g.paid)}
              {row('미지급 원가', g.unpaid, { strong: true, tone: Number(g.unpaid) ? 'text-[#c42b1c]' : undefined })}
            </dl>
            <dl>
              <p className="mb-1 font-semibold">손익</p>
              {row('매출', g.recognized)}
              {row('원가', g.cost)}
              <div className="flex items-baseline justify-between border-t-2 border-[#17202b] pt-2 text-[16px] font-bold"><dt>공사 손익</dt><dd className={clsx('num', Number(g.profit) < 0 && 'text-[#c42b1c]')}>{won(g.profit)}</dd></div>
              <p className="mt-1 text-right text-[12px] text-[#5b6573]">이익률 {g.profitRate ? pct(g.profitRate) : '–'} · 실행 대비 원가율 {g.costRate ? pct(g.costRate) : '–'}</p>
            </dl>
          </div>
          <h3 className="mt-6 mb-1 font-semibold">원가항목별</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-[12px]">
              <thead><tr className="bg-[#eef1f4]">{['원가항목', '실행예산', '확정', '발생', '지급', '실행 대비'].map((h) => <th key={h} className="border border-[#c9ced6] px-2 py-1 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {d.costRows.filter((r) => Number(r.planned) || Number(r.actual) || Number(r.committed)).map((r) => (
                  <tr key={r.costCodeId}><td className="border border-[#c9ced6] px-2 py-1">{r.code} {r.name}</td>{[r.planned, r.committed, r.actual, r.paid].map((v, i) => <td key={i} className="num border border-[#c9ced6] px-2 py-1 text-right">{won(v)}</td>)}<td className={clsx('num border border-[#c9ced6] px-2 py-1 text-right', Number(r.planned) && Number(r.actual) > Number(r.planned) && 'font-semibold text-[#c42b1c]')}>{Number(r.planned) ? pct(Number(r.actual) / Number(r.planned)) : '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.subcontracts.length > 0 && (
            <>
              <h3 className="mt-6 mb-1 font-semibold">하도급 정산</h3>
              <table className="w-full border-collapse text-[12px]">
                <thead><tr className="bg-[#eef1f4]">{['협력업체 · 계약', '계약금액', '기성', '잔액', '유보금', '상태'].map((h) => <th key={h} className="border border-[#c9ced6] px-2 py-1 font-medium">{h}</th>)}</tr></thead>
                <tbody>{d.subcontracts.map((s) => <tr key={s.id}><td className="border border-[#c9ced6] px-2 py-1">{s.vendor_name} · {s.title}</td>{[s.amount, s.claimed, s.balance, s.retention].map((v, i) => <td key={i} className="num border border-[#c9ced6] px-2 py-1 text-right">{won(v)}</td>)}<td className="border border-[#c9ced6] px-2 py-1 text-center">{s.status === 'COMPLETED' ? '정산' : '진행'}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {d.settlement && <p className="mt-6 text-[12px] text-[#5b6573]">정산일 {d.settlement.settleDate} · 기록 {dateTime(d.settlement.createdAt)}{d.settlement.memo ? ` · ${d.settlement.memo}` : ''}</p>}
        </div>
      </article>

      {!settled && (
        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] print:hidden">
          <div className="rounded-[6px] border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-2.5 font-semibold">정산 전 확인</h2>
            <ul className="divide-y divide-line">
              {d.checks.map((c) => (
                <li key={c.key} className="flex items-center gap-3 px-4 py-2">
                  {c.level === 'OK' ? <CircleCheck className="size-4 text-ok" /> : c.level === 'WARN' ? <CircleAlert className="size-4 text-warn" /> : <OctagonX className="size-4 text-seal" />}
                  <span className="flex-1">{c.label}</span>
                  {c.href && c.level !== 'OK' ? <Link href={c.href} className={clsx('num text-meta underline-offset-2 hover:underline', c.level === 'BLOCK' ? 'text-seal' : 'text-ink-2')}>{c.detail}</Link> : <span className="num text-meta text-muted">{c.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
          {can('closing:approve') && (
            <div className="space-y-3 rounded-[6px] border-2 border-steel bg-surface p-4">
              <h2 className="font-semibold">정산 완료 처리</h2>
              <p className="text-meta text-muted">정산하면 현장이 '정산완료'로 바뀌고 기성·하도급·노무 입력이 막힙니다. 숫자는 지금 값으로 보관됩니다.</p>
              <Field label="정산일"><Input type="date" value={f.settleDate} onChange={(e) => setF({ ...f, settleDate: e.target.value })} /></Field>
              <Field label="메모"><Textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="예: 유보금은 하자기간 종료 후 수령" /></Field>
              {warns.length > 0 && <Checkbox checked={f.acknowledge} onChange={(v) => setF({ ...f, acknowledge: v })} label={`미결 사항 ${warns.length}건을 확인했습니다`} />}
              <Button variant="primary" className="w-full" icon={<Lock className="size-4" />} disabled={!d.canSettle || (warns.length > 0 && !f.acknowledge)} loading={acting === 'settle'}
                onClick={() => run('settle', () => api(`/projects/${id}/settlement`, { method: 'POST', json: f }), '준공정산을 완료했습니다').then(refresh)}>준공정산 완료</Button>
              {!d.canSettle && <p className="text-meta text-seal">결재 중인 문서를 먼저 처리하세요.</p>}
            </div>
          )}
        </section>
      )}
      {d.history.length > 0 && (
        <section className="mt-4 rounded-[6px] border border-line bg-surface print:hidden">
          <h2 className="border-b border-line px-4 py-2.5 font-semibold">정산 이력</h2>
          <ul className="divide-y divide-line">{d.history.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-body"><span className="num">{h.settleDate}</span><Badge tone={h.status === 'SETTLED' ? 'ok' : 'muted'}>{h.status === 'SETTLED' ? '유효' : '다시 열림'}</Badge><span className="num">손익 {won(h.profit)}</span>{h.reopenReason && <span className="text-meta text-muted">사유: {h.reopenReason}</span>}<span className="ml-auto text-meta text-faint">{dateTime(h.createdAt)}</span></li>)}</ul>
        </section>
      )}
      <ReasonDialog open={reopen} title="정산을 다시 열까요?" danger confirm="다시 열기" body="현장 상태가 '준공'으로 돌아가 기성·원가를 다시 입력할 수 있습니다. 기존 정산 기록은 보존됩니다." onClose={() => setReopen(false)}
        onConfirm={async (reason) => { if (await run('reopen', () => api(`/projects/${id}/settlement/reopen`, { method: 'POST', json: { reason } }), '다시 열었습니다')) { setReopen(false); refresh(); } }} />
    </>
  );
}
