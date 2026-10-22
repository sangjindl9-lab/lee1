'use client';

/** 세금계산서 작성 (매출) / 종이 매입 계산서 입력 — 품목은 99줄까지, 세액은 공급가액의 10%를 기본으로 채운다 */
import { type LineStep, useApprovalLine } from '@/components/approval-line';
import { Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProjectPicker, VendorPicker } from './pickers';
import { Button, Field, IconButton, Input, MoneyInput, Select, Textarea, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { addDigits, previewVat, won } from '@/lib/format';

export interface TiFormLine { name: string; spec: string; qty: string; unitPrice: string; supplyAmount: string; vatAmount: string; vatTouched?: boolean; remark: string }
export interface TiFormInitial {
  id?: string; version?: number; direction: 'SALES' | 'PURCHASE'; docKind: 'TAX' | 'EXEMPT'; approvalNo: string; writeDate: string; purpose: 'CHARGE' | 'RECEIPT';
  vendor: { id: string; name: string } | null; projectId: string | null; remark: string; lines: TiFormLine[];
}
const blank = (): TiFormLine => ({ name: '', spec: '', qty: '', unitPrice: '', supplyAmount: '', vatAmount: '', remark: '' });
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export function emptyTi(direction: 'SALES' | 'PURCHASE'): TiFormInitial {
  return { direction, docKind: 'TAX', approvalNo: '', writeDate: today(), purpose: 'CHARGE', vendor: null, projectId: null, remark: '', lines: [blank()] };
}

export function TiForm({ initial, onSaved, onCancel }: { initial: TiFormInitial; onSaved: (id: string, submitted: boolean) => void; onCancel: () => void }) {
  const { pick: pickLine, node: lineNode } = useApprovalLine();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  const sales = f.direction === 'SALES';
  const exempt = f.docKind === 'EXEMPT';
  const setLine = (i: number, p: Partial<TiFormLine>) => setF((s) => ({
    ...s,
    lines: s.lines.map((l, j) => {
      if (j !== i) return l;
      const n = { ...l, ...p };
      if (('qty' in p || 'unitPrice' in p) && n.qty && n.unitPrice) n.supplyAmount = String(Math.floor(Number(n.qty) * Number(n.unitPrice)));
      if (!n.vatTouched && ('supplyAmount' in p || 'qty' in p || 'unitPrice' in p)) n.vatAmount = exempt ? '0' : previewVat(n.supplyAmount);
      return n;
    }),
  }));
  const supply = f.lines.reduce((a, l) => addDigits(a, l.supplyAmount || '0'), '0');
  const vat = f.lines.reduce((a, l) => addDigits(a, l.vatAmount || '0'), '0');

  async function save(submit: boolean) {
    setErrors({});
    const e: Record<string, string> = {};
    if (!f.vendor) e.vendor = sales ? '공급받는자(거래처)를 선택해 주세요' : '공급자(거래처)를 선택해 주세요';
    if (!f.lines.some((l) => l.name.trim())) e.lines = '품목을 하나 이상 입력해 주세요';
    if (Object.keys(e).length) return setErrors(e);
    let line: LineStep[] | undefined;
    if (submit) {
      const picked = await pickLine('TAX_ISSUE', addDigits(supply, vat));
      if (picked === null) return;
      line = picked;
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      const body = {
        direction: f.direction, docKind: f.docKind, approvalNo: f.approvalNo || null, writeDate: f.writeDate, purpose: f.purpose, vendorId: f.vendor!.id, projectId: f.projectId, remark: f.remark || null,
        lines: f.lines.filter((l) => l.name.trim()).map((l) => ({ itemDate: f.writeDate, name: l.name, spec: l.spec || null, qty: l.qty || null, unitPrice: l.unitPrice || null, supplyAmount: l.supplyAmount || '0', vatAmount: exempt ? '0' : l.vatAmount || '0', remark: l.remark || null })),
        ...(f.id ? { version: f.version } : {}),
      };
      const saved = await api<{ id: string; version: number }>(f.id ? `/tax-invoices/${f.id}` : '/tax-invoices', { method: f.id ? 'PUT' : 'POST', json: body });
      if (submit) await api(`/tax-invoices/${saved.id}/submit`, { method: 'POST', json: { version: saved.version, approvalLine: line } });
      onSaved(saved.id, submit);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.body.fields) setErrors(Object.fromEntries(err.body.fields.map((x) => [x.field.split('.')[0], x.message])));
        toast('error', err.body.message);
      } else toast('error', '저장하지 못했습니다');
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), save(false))} className="space-y-4">
      {lineNode}
      <section className="rounded-[6px] border border-line bg-surface p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label={sales ? '공급받는자 (거래처)' : '공급자 (거래처)'} required error={errors.vendor || errors.vendorId} className="md:col-span-2" hint={sales ? '사업자등록번호가 등록된 거래처만 발행할 수 있습니다' : undefined}>
            <VendorPicker value={f.vendor?.id ?? null} display={f.vendor?.name} onChange={(v) => setF({ ...f, vendor: v })} invalid={!!errors.vendor} />
          </Field>
          <Field label="현장" hint={sales ? '공사수입은 현장별로 집계됩니다' : undefined}><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
          <Field label="작성일자" required error={errors.writeDate}><Input type="date" value={f.writeDate} onChange={(e) => setF({ ...f, writeDate: e.target.value })} /></Field>
          <Field label="종류">
            <Select value={f.docKind} onChange={(e) => setF({ ...f, docKind: e.target.value as 'TAX' | 'EXEMPT', lines: e.target.value === 'EXEMPT' ? f.lines.map((l) => ({ ...l, vatAmount: '0' })) : f.lines })}>
              <option value="TAX">세금계산서 (과세)</option><option value="EXEMPT">계산서 (면세)</option>
            </Select>
          </Field>
          <Field label="영수·청구"><Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as 'CHARGE' | 'RECEIPT' })}><option value="CHARGE">청구</option><option value="RECEIPT">영수</option></Select></Field>
          {!sales && <Field label="승인번호" hint="종이 계산서면 비워 두세요" error={errors.approvalNo} className="md:col-span-2"><Input value={f.approvalNo} onChange={(e) => setF({ ...f, approvalNo: e.target.value })} placeholder="20261022-41000000-00000000" className="num" /></Field>}
        </div>
      </section>

      <section className="rounded-[6px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-semibold">품목</h2>
          {errors.lines && <span className="text-meta text-seal">{errors.lines}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-surface-2 text-meta text-muted"><tr>
              <th className="w-8 px-2 py-1.5 font-medium">No</th><th className="px-2 py-1.5 text-left font-medium">품목</th><th className="w-[120px] px-2 py-1.5 text-left font-medium">규격</th>
              <th className="w-[88px] px-2 py-1.5 text-right font-medium">수량</th><th className="w-[120px] px-2 py-1.5 text-right font-medium">단가</th><th className="w-[140px] px-2 py-1.5 text-right font-medium">공급가액</th><th className="w-[120px] px-2 py-1.5 text-right font-medium">세액</th><th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {f.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num px-2 py-1.5 text-center text-muted">{i + 1}</td>
                  <td className="px-2 py-1.5"><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} aria-label={`${i + 1}번 품목`} placeholder="예: 전기공사 3회 기성" /></td>
                  <td className="px-2 py-1.5"><Input value={l.spec} onChange={(e) => setLine(i, { spec: e.target.value })} aria-label="규격" /></td>
                  <td className="px-2 py-1.5"><Input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} className="num text-right" inputMode="decimal" aria-label="수량" /></td>
                  <td className="px-2 py-1.5"><MoneyInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} aria-label="단가" /></td>
                  <td className="px-2 py-1.5"><MoneyInput value={l.supplyAmount} onChange={(v) => setLine(i, { supplyAmount: v })} aria-label="공급가액" /></td>
                  <td className="px-2 py-1.5"><MoneyInput value={l.vatAmount} disabled={exempt} onChange={(v) => setLine(i, { vatAmount: v, vatTouched: true })} aria-label="세액" /></td>
                  <td className="px-1 py-1.5"><IconButton label="품목 삭제" disabled={f.lines.length === 1} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong bg-surface-2 font-semibold"><tr>
              <td colSpan={5} className="px-2 py-2"><Button type="button" size="sm" icon={<Plus className="size-3.5" />} disabled={f.lines.length >= 99} onClick={() => setF({ ...f, lines: [...f.lines, blank()] })}>품목 추가</Button></td>
              <td className="num px-3 py-2 text-right">{won(supply)}</td><td className="num px-3 py-2 text-right">{won(vat)}</td><td />
            </tr></tfoot>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-3">
          <span className="text-muted">합계금액</span><span className="num text-[20px] font-semibold">{won(addDigits(supply, vat))}<span className="ml-0.5 text-meta font-normal text-faint">원</span></span>
        </div>
      </section>

      <Field label="비고"><Textarea rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} maxLength={300} /></Field>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[6px] sm:border">
        <Button type="button" onClick={onCancel}>취소</Button>
        <Button type="submit" loading={busy === 'save'} disabled={!!busy}>{sales ? '임시저장' : '등록'}</Button>
        {sales && <Button type="button" variant="primary" icon={<Send className="size-3.5" />} loading={busy === 'submit'} disabled={!!busy} onClick={() => save(true)}>저장하고 발행 결재 올리기</Button>}
      </div>
    </form>
  );
}
