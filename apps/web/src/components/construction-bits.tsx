'use client';

/** 4단계 화면 부품 — 변경계약 작성, 수금 등록, 하도급 기성 신청 */
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BankSelect, CostCodeSelect, ProjectPicker, VendorPicker } from './pickers';
import { Button, Dialog, Drawer, Field, IconButton, Input, MoneyInput, Select, Textarea, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { won } from '@/lib/format';

const todayStr = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

export function RevisionDrawer({ open, onClose, projectId, onSaved }: { open: boolean; onClose: () => void; projectId: string | null; onSaved: (id: string) => void }) {
  const toast = useToast();
  const today = todayStr();
  const [f, setF] = useState({ projectId, revisionDate: today, sign: '+' as '+' | '-', amount: '', reason: '', afterEndDate: '', lines: [] as { costCodeId: string | null; sign: '+' | '-'; amount: string }[] });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/contract-revisions', { method: 'POST', json: {
        projectId: f.projectId, revisionDate: f.revisionDate, reason: f.reason, deltaAmount: `${f.sign === '-' ? '-' : ''}${f.amount || '0'}`, afterEndDate: f.afterEndDate || null,
        budgetLines: f.lines.filter((l) => l.costCodeId && l.amount).map((l) => ({ costCodeId: l.costCodeId, delta: `${l.sign === '-' ? '-' : ''}${l.amount}` })),
      } });
      toast('ok', '변경계약을 작성했습니다');
      onSaved(r.id);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open={open} onClose={onClose} title="변경계약 작성" subtitle="대표 결재 전에는 확정 계약금액에 들어가지 않습니다. 최초계약은 그대로 보존됩니다." width={560}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!f.projectId || !f.amount || f.reason.trim().length < 2} onClick={save}>저장</Button></>}>
      <div className="space-y-4">
        <Field label="현장" required><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="변경계약일" required><Input type="date" value={f.revisionDate} onChange={(e) => setF({ ...f, revisionDate: e.target.value })} /></Field>
          <Field label="변경 후 준공예정일" hint="공기 변경이 있을 때만"><Input type="date" value={f.afterEndDate} onChange={(e) => setF({ ...f, afterEndDate: e.target.value })} /></Field>
        </div>
        <Field label="계약금액 증감 (공급가)" required>
          <div className="flex gap-2">
            <div role="radiogroup" aria-label="증액·감액" className="flex rounded-[4px] bg-surface-2 p-0.5">
              {(['+', '-'] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={f.sign === s} onClick={() => setF({ ...f, sign: s })} className={clsx('h-7 rounded-[3px] px-3 text-meta', f.sign === s ? 'bg-surface font-medium shadow-sm' : 'text-muted')}>{s === '+' ? '증액' : '감액'}</button>)}
            </div>
            <Input inputMode="numeric" value={f.amount ? Number(f.amount).toLocaleString('ko-KR') : ''} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} className="num flex-1 text-right" placeholder="0" />
          </div>
        </Field>
        <Field label="변경 사유" required><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="예: 설계변경으로 분전반 2면 추가" /></Field>
        <div className="rounded-[4px] border border-line p-3">
          <div className="flex items-center justify-between"><p className="font-medium">실행예산 조정안 <span className="font-normal text-muted">(선택)</span></p><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setF({ ...f, lines: [...f.lines, { costCodeId: null, sign: '+', amount: '' }] })}>추가</Button></div>
          <p className="mt-0.5 text-meta text-muted">승인 후 이 내용으로 실행예산 변경 초안을 만들어 따로 결재받습니다.</p>
          {f.lines.map((l, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <CostCodeSelect className="flex-1" value={l.costCodeId} onChange={(v) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, costCodeId: v } : x)) })} />
              <button type="button" onClick={() => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, sign: x.sign === '+' ? '-' : '+' } : x)) })} className="h-8 w-8 rounded-[4px] border border-line-strong font-medium" aria-label="증감 바꾸기">{l.sign}</button>
              <Input inputMode="numeric" value={l.amount ? Number(l.amount).toLocaleString('ko-KR') : ''} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/\D/g, '') } : x)) })} className="num w-36 text-right" />
              <IconButton label="삭제" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}


/** 수금 등록 — 기성금(기성 선택 시)·선급금·유보금. 입금 계좌를 고르면 그 계좌로 분개 */
export function CollectDialog({ open, onClose, onDone, claim, projectId }: {
  open: boolean; onClose: () => void; onDone: () => void;
  claim?: { id: string; code: string; claimNo: number; outstanding: string } | null; projectId?: string | null;
}) {
  const toast = useToast();
  const [f, setF] = useState({ kind: claim ? 'CLAIM' : 'ADVANCE', projectId: projectId ?? null as string | null, vendor: null as { id: string; name: string } | null, collectDate: todayStr(), amount: claim ? claim.outstanding.split('.')[0] : '', method: 'TRANSFER', bankAccountId: null as string | null, memo: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/collections', { method: 'POST', json: { kind: f.kind, claimId: claim?.id ?? null, projectId: f.projectId, vendorId: f.vendor?.id ?? null, collectDate: f.collectDate, amount: f.amount, method: f.method, bankAccountId: f.bankAccountId, memo: f.memo || null } });
      toast('ok', '수금을 기록했습니다');
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={claim ? `${claim.claimNo}회 기성 수금` : '선급금·유보금 수금'} width={480}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!f.amount || (!claim && !f.projectId)} onClick={save}>수금 기록</Button></>}>
      <div className="space-y-3">
        {claim ? <p className="rounded-[4px] bg-surface-2 px-3 py-2 text-meta">남은 청구액 <b className="num text-[15px]">{won(claim.outstanding)}원</b> · 은행 입금을 확인한 뒤 기록하세요. 매출은 기성 승인 때 이미 잡혔고, 수금은 미수금만 줄입니다.</p> : (
          <>
            <Field label="구분">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="ADVANCE">선급금 (공사선수금 — 매출 아님)</option><option value="RETENTION">유보금 (준공 후 받는 유보분)</option></Select>
            </Field>
            <Field label="현장" required><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
            <Field label="발주처" hint="비워 두면 현장에 지정된 발주처"><VendorPicker value={f.vendor?.id ?? null} display={f.vendor?.name} onChange={(v) => setF({ ...f, vendor: v })} /></Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="입금일" required><Input type="date" value={f.collectDate} onChange={(e) => setF({ ...f, collectDate: e.target.value })} /></Field>
          <Field label="금액" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="방법"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="TRANSFER">계좌 입금</option><option value="BILL">어음</option><option value="CASH">현금</option><option value="OFFSET">상계</option></Select></Field>
          <Field label="입금 계좌"><BankSelect value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} includeKinds={['BANK', 'CASH']} /></Field>
        </div>
        <Field label="메모"><Input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="입금자명·통장 적요" /></Field>
      </div>
    </Dialog>
  );
}


/** 하도급 계약 작성 */
export function SubcontractDrawer({ projectId, onClose, onSaved }: { projectId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ projectId, vendor: null as { id: string; name: string } | null, costCodeId: null as string | null, title: '', contractDate: todayStr(), startDate: '', endDate: '', amount: '', retentionPercent: '0', guaranteeType: '', guaranteeNo: '', guaranteeAmount: '', guaranteeExpiry: '', scope: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/subcontracts', { method: 'POST', json: {
        projectId: f.projectId, vendorId: f.vendor?.id, costCodeId: f.costCodeId, title: f.title, contractDate: f.contractDate, startDate: f.startDate || null, endDate: f.endDate || null,
        amount: f.amount, retentionRate: (Number(f.retentionPercent || 0) / 100).toFixed(4), guaranteeType: f.guaranteeType || null, guaranteeNo: f.guaranteeNo || null,
        guaranteeAmount: f.guaranteeAmount || null, guaranteeExpiry: f.guaranteeExpiry || null, scope: f.scope || null,
      } });
      toast('ok', '하도급 계약을 작성했습니다. 대표 결재를 올리세요');
      onSaved(r.id);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open onClose={onClose} title="하도급 계약 작성" subtitle="대표 결재가 끝나면 '진행'이 되고 기성을 받을 수 있습니다." width={600}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!f.projectId || !f.vendor || !f.title || !f.amount} onClick={save}>저장</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="현장" required className="sm:col-span-2"><ProjectPicker value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
        <Field label="협력업체" required className="sm:col-span-2"><VendorPicker value={f.vendor?.id ?? null} display={f.vendor?.name} onChange={(v) => setF({ ...f, vendor: v })} /></Field>
        <Field label="계약명" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예: 정보통신 배관·배선 공사" /></Field>
        <Field label="원가항목" hint="비우면 외주·하도급비"><CostCodeSelect value={f.costCodeId} onChange={(v) => setF({ ...f, costCodeId: v })} /></Field>
        <Field label="계약일" required><Input type="date" value={f.contractDate} onChange={(e) => setF({ ...f, contractDate: e.target.value })} /></Field>
        <Field label="착공"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="준공"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="계약금액 (공급가)" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="유보율" hint="기성마다 떼어 두었다가 정산 때 지급">
          <div className="relative"><Input inputMode="decimal" value={f.retentionPercent} onChange={(e) => setF({ ...f, retentionPercent: e.target.value.replace(/[^0-9.]/g, '') })} className="num pr-7 text-right" /><span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">%</span></div>
        </Field>
        <Field label="보증서 종류"><Select value={f.guaranteeType} onChange={(e) => setF({ ...f, guaranteeType: e.target.value })}><option value="">없음</option><option>계약이행보증</option><option>선급금보증</option><option>하자보수보증</option><option>지급보증</option></Select></Field>
        <Field label="보증서 번호"><Input value={f.guaranteeNo} onChange={(e) => setF({ ...f, guaranteeNo: e.target.value })} /></Field>
        <Field label="보증금액"><MoneyInput value={f.guaranteeAmount} onChange={(v) => setF({ ...f, guaranteeAmount: v })} /></Field>
        <Field label="보증 만료일"><Input type="date" value={f.guaranteeExpiry} onChange={(e) => setF({ ...f, guaranteeExpiry: e.target.value })} /></Field>
        <Field label="공사 범위" className="sm:col-span-2"><Textarea rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

/** 하도급 기성 신청 */
export function SubClaimDialog({ sub, onClose, onDone }: { sub: { id: string; title: string; currentAmount: string; claimed: string; retentionRate: string; nextNo: number }; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ claimDate: todayStr(), amount: '', memo: '' });
  const [busy, setBusy] = useState(false);
  const left = Number(sub.currentAmount) - Number(sub.claimed);
  const amt = Number(f.amount || 0);
  const ret = Math.floor(amt * Number(sub.retentionRate));
  return (
    <Dialog open onClose={onClose} title={`${sub.nextNo}회 하도급 기성 신청`} width={460}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!amt || amt > left} onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ id: string }>(`/subcontracts/${sub.id}/claims`, { method: 'POST', json: { claimDate: f.claimDate, thisAmount: f.amount, memo: f.memo || null } });
          toast('ok', '기성을 신청했습니다. 결재를 올리세요');
          onDone(r.id);
        } catch (e) {
          toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
        } finally {
          setBusy(false);
        }
      }}>신청</Button></>}>
      <div className="space-y-3">
        <p className="rounded-[4px] bg-surface-2 px-3 py-2 text-meta">{sub.title} · 계약잔액 <b className="num">{won(String(left))}원</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="신청일" required><Input type="date" value={f.claimDate} onChange={(e) => setF({ ...f, claimDate: e.target.value })} /></Field>
          <Field label="금회 기성 (공급가)" required error={amt > left ? '계약잔액을 넘습니다' : undefined}><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        {amt > 0 && <p className="text-meta text-muted">유보금 {won(String(ret))}원을 떼고, 부가세를 더해 지급합니다 (서버에서 다시 계산).</p>}
        <Field label="메모"><Input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

/** 하도급 변경계약 */
export function SubReviseDialog({ sub, onClose, onDone }: { sub: { id: string; version: number; currentAmount: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ revisionDate: todayStr(), sign: '+' as '+' | '-', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const after = Number(sub.currentAmount) + (f.sign === '-' ? -1 : 1) * Number(f.amount || 0);
  return (
    <Dialog open onClose={onClose} title="하도급 변경계약" width={460}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!f.amount || f.reason.trim().length < 2} onClick={async () => {
        setBusy(true);
        try {
          await api(`/subcontracts/${sub.id}/revise`, { method: 'POST', json: { revisionDate: f.revisionDate, deltaAmount: `${f.sign === '-' ? '-' : ''}${f.amount}`, reason: f.reason, version: sub.version } });
          toast('ok', '변경계약을 반영했습니다');
          onDone();
        } catch (e) {
          toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
        } finally {
          setBusy(false);
        }
      }}>반영</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="변경일" required><Input type="date" value={f.revisionDate} onChange={(e) => setF({ ...f, revisionDate: e.target.value })} /></Field>
          <Field label="증감">
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setF({ ...f, sign: f.sign === '+' ? '-' : '+' })} className={clsx('h-8 w-12 shrink-0 rounded-[4px] border border-line-strong text-meta font-medium', f.sign === '-' ? 'text-seal' : 'text-ok')}>{f.sign === '+' ? '증액' : '감액'}</button>
              <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            </div>
          </Field>
        </div>
        <p className="num text-meta text-muted">{won(sub.currentAmount)} → <b className="text-ink">{won(String(after))}</b>원</p>
        <Field label="사유" required><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
