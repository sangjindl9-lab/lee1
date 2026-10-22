'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { ProjectPicker, VendorPicker } from '@/components/pickers';
import { Button, Checkbox, EmptyState, Field, IconButton, Input, MoneyInput, PageHeader, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { pct, previewVat, won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Prep {
  project: { id: string; code: string; name: string; retentionRate: string; advanceAmount: string; clientName: string | null };
  client: { id: string; name: string } | null;
  contract: { original: string; current: string; pending: string };
  prevCumulative: string; nextNo: number; remaining: string; advanceBalance: string;
  lines: { name: string; spec: string | null; unit: string | null; contract_amount: string; prev_amount: string }[];
}
interface L { name: string; spec: string; contractAmount: string; prevAmount: string; thisAmount: string }
const int = (v: string | null | undefined) => (v ?? '0').split('.')[0];
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, project: ctxProject } = useSession();
  const [projectId, setProjectId] = useState<string | null>(sp.get('projectId') ?? ctxProject?.id ?? null);
  const prep = useQuery({ queryKey: ['claim-prep', projectId], queryFn: () => api<Prep>(`/progress-claims/prepare${qs({ projectId })}`), enabled: !!projectId });
  const p = prep.data;
  const [f, setF] = useState({ vendor: null as { id: string; name: string } | null, claimDate: today(), periodFrom: '', periodTo: '', dueDate: '', advanceDeduction: '', retentionPercent: '0', isFinal: false, memo: '', byLines: true, thisSupply: '' });
  const [lines, setLines] = useState<L[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p) return;
    setF((x) => ({ ...x, vendor: p.client, retentionPercent: String(Number(p.project.retentionRate) * 100) }));
    setLines(p.lines.length ? p.lines.map((l) => ({ name: l.name, spec: l.spec ?? '', contractAmount: int(l.contract_amount), prevAmount: int(l.prev_amount), thisAmount: '' })) : [{ name: '', spec: '', contractAmount: '', prevAmount: '0', thisAmount: '' }]);
  }, [p]);
  if (!can('claim:create')) return <EmptyState title="기성을 작성할 권한이 없습니다" />;

  const thisSupply = f.byLines ? lines.reduce((a, l) => a + Number(l.thisAmount || 0), 0) : Number(f.thisSupply || 0);
  const vat = Number(previewVat(String(thisSupply)) || 0);
  const retention = Math.floor(thisSupply * Number(f.retentionPercent || 0) / 100);
  const adv = Number(f.advanceDeduction || 0);
  const receivable = thisSupply + vat - adv - retention;
  const contract = Number(p?.contract.current ?? 0);
  const cumulative = Number(p?.prevCumulative ?? 0) + thisSupply;
  const over = p && cumulative > contract;
  // 선급금은 기성률만큼 나누어 공제하는 것이 일반적 — 제안값
  const advSuggest = p && contract > 0 ? Math.min(Number(p.advanceBalance), Math.floor(Number(p.project.advanceAmount) * thisSupply / contract)) : 0;

  async function save(submit: boolean) {
    setBusy(true);
    try {
      const body = {
        projectId, vendorId: f.vendor?.id, claimDate: f.claimDate, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null, dueDate: f.dueDate || null,
        advanceDeduction: String(adv), retentionRate: (Number(f.retentionPercent || 0) / 100).toFixed(4), isFinal: f.isFinal, memo: f.memo || null,
        ...(f.byLines ? { lines: lines.filter((l) => l.name.trim() && Number(l.thisAmount) > 0).map((l) => ({ name: l.name, spec: l.spec || null, contractAmount: l.contractAmount || '0', thisAmount: l.thisAmount })) } : { thisSupply: f.thisSupply }),
      };
      const c = await api<{ id: string; version: number }>('/progress-claims', { method: 'POST', json: body });
      if (submit) await api(`/progress-claims/${c.id}/submit`, { method: 'POST', json: { version: c.version } });
      qc.invalidateQueries({ queryKey: ['claims'] });
      toast('ok', submit ? '대표 결재를 올렸습니다' : '저장했습니다');
      router.replace(`/claims/${c.id}`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="기성 작성" description="이번 기간에 시공한 금액을 공종별로 넣으면 전회·누적·기성률과 청구액을 계산합니다. 승인되면 매출로 인식됩니다.">
        <Link href="/claims" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />기성청구</Link>
      </PageHeader>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section className="grid gap-4 rounded-[6px] border border-line bg-surface p-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="현장" required className="md:col-span-2"><ProjectPicker value={projectId} onChange={setProjectId} /></Field>
            <Field label="발주처 (청구 상대)" required className="md:col-span-2"><VendorPicker value={f.vendor?.id ?? null} display={f.vendor?.name} onChange={(v) => setF({ ...f, vendor: v })} placeholder={p?.project.clientName ?? '거래처 검색'} /></Field>
            <Field label="청구일" required><Input type="date" value={f.claimDate} onChange={(e) => setF({ ...f, claimDate: e.target.value })} /></Field>
            <Field label="수금예정일"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
            <Field label="기성 기간 시작"><Input type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} /></Field>
            <Field label="기성 기간 끝"><Input type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} /></Field>
          </section>
          {!projectId ? <EmptyState title="현장을 먼저 고르세요" /> : !p ? <Skeleton className="h-60" /> : (
            <section className="rounded-[6px] border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <h2 className="font-semibold">제 {p.nextNo} 회 기성 내역</h2>
                <Checkbox checked={!f.byLines} onChange={(v) => setF({ ...f, byLines: !v })} label="공종 없이 금액만 입력" />
              </div>
              {f.byLines ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-2 py-1.5 text-left font-medium">공종·내역</th><th className="w-[120px] px-2 py-1.5 text-left font-medium">규격</th><th className="w-[140px] px-2 py-1.5 text-right font-medium">공종 계약금액</th><th className="w-[120px] px-2 py-1.5 text-right font-medium">전회 누적</th><th className="w-[140px] px-2 py-1.5 text-right font-medium">금회</th><th className="w-[90px] px-2 py-1.5 text-right font-medium">누적률</th><th className="w-9" /></tr></thead>
                    <tbody className="divide-y divide-line">
                      {lines.map((l, i) => {
                        const cum = Number(l.prevAmount || 0) + Number(l.thisAmount || 0);
                        const lineOver = Number(l.contractAmount) > 0 && cum > Number(l.contractAmount);
                        return (
                          <tr key={i} className={clsx(lineOver && 'bg-seal-soft/40')}>
                            <td className="px-2 py-1"><Input value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="공종" placeholder="예: 간선 설비" /></td>
                            <td className="px-2 py-1"><Input value={l.spec} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, spec: e.target.value } : x)))} aria-label="규격" /></td>
                            <td className="px-2 py-1"><MoneyInput value={l.contractAmount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, contractAmount: v } : x)))} aria-label="공종 계약금액" /></td>
                            <td className="num px-2 py-1 text-right text-muted">{won(l.prevAmount)}</td>
                            <td className="px-2 py-1"><MoneyInput value={l.thisAmount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, thisAmount: v } : x)))} aria-label="금회" /></td>
                            <td className={clsx('num px-2 py-1 text-right', lineOver ? 'font-medium text-seal' : 'text-muted')}>{Number(l.contractAmount) ? `${(cum / Number(l.contractAmount) * 100).toFixed(1)}%` : '–'}</td>
                            <td className="px-1"><IconButton label="줄 삭제" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="border-t border-line px-3 py-2"><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLines([...lines, { name: '', spec: '', contractAmount: '', prevAmount: '0', thisAmount: '' }])}>공종 추가</Button></div>
                </div>
              ) : (
                <div className="p-4"><Field label="금회 기성 (공급가)" required><MoneyInput value={f.thisSupply} onChange={(v) => setF({ ...f, thisSupply: v })} /></Field></div>
              )}
            </section>
          )}
          <Field label="비고"><Textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[68px] xl:self-start">
          {p && (
            <section className="rounded-[6px] border border-line bg-surface p-4">
              <h2 className="font-semibold">기성 집계</h2>
              <dl className="mt-2 space-y-1 text-body">
                <div className="flex justify-between"><dt className="text-muted">확정 계약금액</dt><dd className="num">{won(p.contract.current)}</dd></div>
                {Number(p.contract.pending) !== 0 && <div className="flex justify-between text-meta text-warn"><dt>결재 중 변경계약</dt><dd className="num">{won(p.contract.pending)} (미반영)</dd></div>}
                <div className="flex justify-between"><dt className="text-muted">전회 누적</dt><dd className="num">{won(p.prevCumulative)}</dd></div>
                <div className="flex justify-between font-medium"><dt>금회 기성</dt><dd className="num">{won(String(thisSupply))}</dd></div>
                <div className={clsx('flex justify-between', over && 'font-semibold text-seal')}><dt className="text-muted">누적 · 기성률</dt><dd className="num">{won(String(cumulative))} · {pct(contract ? cumulative / contract : 0)}</dd></div>
                <div className="flex justify-between text-meta text-muted"><dt>남은 계약</dt><dd className="num">{won(String(contract - cumulative))}</dd></div>
              </dl>
              {over && <p className="mt-2 text-meta text-seal">계약금액을 넘습니다. 변경계약을 먼저 승인받으세요.</p>}
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <Field label="선급금 공제" hint={<>남은 선급금 {won(p.advanceBalance)}원{advSuggest > 0 && <> · <button type="button" className="text-steel-ink underline" onClick={() => setF({ ...f, advanceDeduction: String(advSuggest) })}>기성률만큼 {won(String(advSuggest))}</button></>}</>}>
                  <MoneyInput value={f.advanceDeduction} onChange={(v) => setF({ ...f, advanceDeduction: v })} />
                </Field>
                <Field label="유보율">
                  <div className="relative"><Input inputMode="decimal" value={f.retentionPercent} onChange={(e) => setF({ ...f, retentionPercent: e.target.value.replace(/[^0-9.]/g, '') })} className="num pr-7 text-right" /><span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">%</span></div>
                </Field>
                <Checkbox checked={f.isFinal} onChange={(v) => setF({ ...f, isFinal: v })} label="준공 기성 (마지막 회차)" />
              </div>
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-body">
                <div className="flex justify-between"><dt className="text-muted">금회 공급가액</dt><dd className="num">{won(String(thisSupply))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">부가세</dt><dd className="num">{won(String(vat))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">선급금 공제</dt><dd className="num">△ {won(String(adv))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">유보금</dt><dd className="num">△ {won(String(retention))}</dd></div>
                <div className="flex justify-between border-t border-line pt-1.5 text-[16px] font-semibold"><dt>청구액</dt><dd className="num">{won(String(receivable))}</dd></div>
              </dl>
              <p className="mt-1 text-meta text-faint">최종 금액은 서버에서 다시 계산합니다 (원 미만 절사).</p>
            </section>
          )}
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={busy} disabled={!p || !f.vendor || thisSupply <= 0 || !!over} onClick={() => save(true)}>저장하고 대표 결재 올리기</Button>
            <Button loading={busy} disabled={!p || !f.vendor || thisSupply <= 0 || !!over} onClick={() => save(false)}>임시저장</Button>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
