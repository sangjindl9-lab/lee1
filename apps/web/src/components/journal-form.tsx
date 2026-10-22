'use client';

import clsx from 'clsx';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AccountPicker, CostCodeSelect, ProjectPicker, useAccounts, VendorPicker } from './pickers';
import { Button, Field, IconButton, Input, MoneyInput } from './ui';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';

interface Line { key: string; accountId: string | null; debit: string; credit: string; projectId: string | null; vendor: { id: string; name: string } | null; costCodeId: string | null; memo: string }
export interface JournalInitial {
  id: string; version: number; entryDate: string; description: string;
  lines: { accountId: string; debit: string; credit: string; projectId: string | null; vendorId: string | null; vendorName: string | null; costCodeId: string | null; memo: string | null }[];
}
let n = 0;
const k = () => `j${++n}`;
const blank = (): Line => ({ key: k(), accountId: null, debit: '', credit: '', projectId: null, vendor: null, costCodeId: null, memo: '' });
const big = (v: string) => (v ? BigInt(v) : 0n);

export function JournalForm({ initial, onSaved, onCancel }: { initial?: JournalInitial; onSaved: (id: string) => void; onCancel: () => void }) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [date, setDate] = useState(initial?.entryDate ?? today);
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [lines, setLines] = useState<Line[]>(() => initial?.lines.map((l) => ({ key: k(), accountId: l.accountId, debit: l.debit.split('.')[0].replace(/^0$/, ''), credit: l.credit.split('.')[0].replace(/^0$/, ''), projectId: l.projectId, vendor: l.vendorId ? { id: l.vendorId, name: l.vendorName ?? '' } : null, costCodeId: l.costCodeId, memo: l.memo ?? '' })) ?? [blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accounts = useAccounts();
  const formRef = useRef<HTMLFormElement>(null);
  const acc = (id: string | null) => accounts.data?.find((a) => a.id === id);
  const dr = lines.reduce((a, l) => a + big(l.debit), 0n);
  const cr = lines.reduce((a, l) => a + big(l.credit), 0n);
  const diff = dr - cr;
  const set = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  /** 차액을 채워 넣기: 비어 있는 마지막 줄(없으면 새 줄)에 반대편 금액으로 */
  const fillDiff = () => {
    if (diff === 0n) return;
    const amt = String(diff > 0n ? diff : -diff);
    const target = [...lines].reverse().find((l) => !l.debit && !l.credit);
    if (target) set(target.key, diff > 0n ? { credit: amt } : { debit: amt });
    else setLines((ls) => [...ls, { ...blank(), ...(diff > 0n ? { credit: amt } : { debit: amt }) }]);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const used = lines.filter((l) => l.accountId || l.debit || l.credit);
    if (!desc.trim()) return setErr('적요를 입력해 주세요');
    if (used.some((l) => !l.accountId)) return setErr('계정을 고르지 않은 줄이 있습니다');
    if (used.some((l) => l.debit && l.credit)) return setErr('한 줄에는 차변과 대변 중 하나만 입력해 주세요');
    for (const l of used) {
      const a = acc(l.accountId);
      if (a?.needsProject && !l.projectId) return setErr(`${a.code} ${a.name}: 현장을 선택해 주세요`);
      if (a?.needsVendor && !l.vendor) return setErr(`${a.code} ${a.name}: 거래처를 선택해 주세요`);
    }
    if (diff !== 0n) return setErr(`차변과 대변이 ${won(String(diff > 0n ? diff : -diff))}원 차이 납니다`);
    setBusy(true);
    try {
      const body = { entryDate: date, description: desc, lines: used.map((l) => ({ accountId: l.accountId, debit: l.debit || '0', credit: l.credit || '0', projectId: l.projectId, vendorId: l.vendor?.id ?? null, costCodeId: l.costCodeId, memo: l.memo || null })) };
      const r = initial
        ? await api<{ id: string }>(`/journal-entries/${initial.id}`, { method: 'PUT', json: { ...body, version: initial.version } })
        : await api<{ id: string }>('/journal-entries', { method: 'POST', json: body });
      onSaved(r.id);
    } catch (x) {
      setErr(x instanceof ApiError ? x.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') (e.preventDefault(), formRef.current?.requestSubmit());
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <form ref={formRef} onSubmit={save} noValidate className="space-y-4">
      <section className="grid gap-4 rounded-[6px] border border-line bg-surface p-4 sm:grid-cols-[160px_1fr]">
        <Field label="전표일자" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="적요" required><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="예: 10월 사무실 임차료" autoFocus={!initial} /></Field>
      </section>
      <section className="rounded-[6px] border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-body">
            <thead>
              <tr className="bg-surface-2 text-meta text-muted">
                <th className="w-8 px-2 py-2 font-medium">#</th>
                <th className="w-[230px] px-2 py-2 text-left font-medium">계정과목</th>
                <th className="w-[150px] px-2 py-2 text-right font-medium">차변</th>
                <th className="w-[150px] px-2 py-2 text-right font-medium">대변</th>
                <th className="px-2 py-2 text-left font-medium">현장 · 원가항목</th>
                <th className="w-[190px] px-2 py-2 text-left font-medium">거래처</th>
                <th className="w-[170px] px-2 py-2 text-left font-medium">적요</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const a = acc(l.accountId);
                return (
                  <tr key={l.key} className="border-t border-line align-top">
                    <td className="num px-2 py-2 text-center text-faint">{i + 1}</td>
                    <td className="px-1.5 py-1.5"><AccountPicker value={l.accountId} onChange={(x) => set(l.key, { accountId: x?.id ?? null })} compact /></td>
                    <td className="px-1.5 py-1.5"><MoneyInput value={l.debit} onChange={(v) => set(l.key, { debit: v, credit: v ? '' : l.credit })} aria-label={`${i + 1}행 차변`} suffix="" /></td>
                    <td className="px-1.5 py-1.5"><MoneyInput value={l.credit} onChange={(v) => set(l.key, { credit: v, debit: v ? '' : l.debit })} aria-label={`${i + 1}행 대변`} suffix="" /></td>
                    <td className="px-1.5 py-1.5">
                      <div className="space-y-1">
                        <ProjectPicker value={l.projectId} onChange={(id) => set(l.key, { projectId: id })} placeholder={a?.needsProject ? '현장 (필수)' : '현장 (선택)'} invalid={!!a?.needsProject && !l.projectId} />
                        {a?.category === 'CONSTRUCTION_COST' && <CostCodeSelect value={l.costCodeId} onChange={(id) => set(l.key, { costCodeId: id })} emptyLabel="원가항목 (계정 기준)" />}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5"><VendorPicker value={l.vendor?.id ?? null} display={l.vendor?.name} onChange={(v) => set(l.key, { vendor: v })} placeholder={a?.needsVendor ? '거래처 (필수)' : '거래처'} invalid={!!a?.needsVendor && !l.vendor} /></td>
                    <td className="px-1.5 py-1.5"><Input value={l.memo} onChange={(e) => set(l.key, { memo: e.target.value })} aria-label={`${i + 1}행 적요`} /></td>
                    <td className="py-1.5"><IconButton label="줄 삭제" onClick={() => setLines((ls) => (ls.length <= 2 ? ls.map((x) => (x.key === l.key ? blank() : x)) : ls.filter((x) => x.key !== l.key)))}><Trash2 className="size-4" /></IconButton></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold">
                <td colSpan={2} className="px-3 py-2">합계</td>
                <td className="num px-3 text-right">{won(String(dr))}</td>
                <td className="num px-3 text-right">{won(String(cr))}</td>
                <td colSpan={4} className="px-3">
                  <span className={clsx('inline-flex items-center gap-1.5 text-meta', diff === 0n ? (dr > 0n ? 'text-ok' : 'text-muted') : 'text-seal')}>
                    <Scale className="size-3.5" />
                    {diff === 0n ? (dr > 0n ? '차변 = 대변' : '금액을 입력하세요') : `${diff > 0n ? '대변' : '차변'}이 ${won(String(diff > 0n ? diff : -diff))}원 부족합니다`}
                  </span>
                  {diff !== 0n && <Button size="sm" variant="quiet" className="ml-2" onClick={fillDiff}>차액 채우기</Button>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-line px-3 py-2"><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, blank()])}>줄 추가</Button></div>
      </section>
      {err && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary" loading={busy}>저장 (Ctrl+S)</Button>
      </div>
      <p className="text-meta text-muted">저장한 전표는 '미승인' 상태입니다. 회계관리자가 승인해야 장부·재무제표에 반영됩니다.</p>
    </form>
  );
}
