'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Download, Eye, Plus, Trash2, UserPlus, Wallet } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ReasonDialog, SegTabs, SumStrip, useRun } from '@/components/doc-ui';
import { ProjectPicker } from '@/components/pickers';
import { Badge, Button, Checkbox, Drawer, EmptyState, Field, IconButton, Input, MoneyInput, PageHeader, Select, Skeleton, Textarea, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Worker { id: string; code: string; name: string; kind: string; trade: string | null; phone: string | null; residentNoMask: string | null; bankName: string | null; bankAccountMask: string | null; dailyWage: string; isActive: boolean; memo: string | null; version: number; hasResidentNo: boolean; hasBankAccount: boolean }
interface Rec { id: string; projectId: string; projectName: string; workerId: string; workerName: string; trade: string | null; workDate: string; workType: string | null; manDays: string; overtimeHours: string; dailyWage: string; amount: string; status: string; paid: boolean; inRequest: boolean; costCodeName: string; version: number }
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const calc = (wage: number, md: number, ot: number) => Math.floor(wage * md + (wage / 8) * ot * 1.5);

function WorkerDrawer({ w, onClose, onSaved }: { w: Worker | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [f, setF] = useState({ name: w?.name ?? '', kind: w?.kind ?? 'DAILY', trade: w?.trade ?? '', phone: w?.phone ?? '', residentNo: '', bankName: w?.bankName ?? '', bankAccount: '', dailyWage: w ? w.dailyWage.split('.')[0] : '', isActive: w?.isActive ?? true, memo: w?.memo ?? '' });
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<null | 'residentNo' | 'bankAccount'>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, residentNo: f.residentNo || null, bankAccount: f.bankAccount || null, trade: f.trade || null, phone: f.phone || null, bankName: f.bankName || null, memo: f.memo || null, dailyWage: f.dailyWage || '0' };
      await api(w ? `/labor/workers/${w.id}` : '/labor/workers', { method: w ? 'PUT' : 'POST', json: w ? { ...body, version: w.version } : body });
      toast('ok', '저장했습니다');
      onSaved();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open onClose={onClose} title={w ? `${w.name} 정보` : '작업자 등록'} subtitle="주민등록번호와 계좌번호는 암호화해 저장하고 가린 값만 보여 줍니다. 필요할 때만 입력하세요." width={520}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy} disabled={!f.name} onClick={save}>저장</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="이름" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="구분"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="DAILY">일용직</option><option value="STAFF">직원</option></Select></Field>
        <Field label="직종"><Input value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} list="trades" placeholder="전공·통신공·보통인부" /><datalist id="trades"><option value="전공" /><option value="내선전공" /><option value="통신내선공" /><option value="통신설비공" /><option value="보통인부" /><option value="특별인부" /></datalist></Field>
        <Field label="기본 일당"><MoneyInput value={f.dailyWage} onChange={(v) => setF({ ...f, dailyWage: v })} /></Field>
        <Field label="연락처"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
        <Field label="주민등록번호" hint={w?.residentNoMask ? <>저장됨 {w.residentNoMask}{shown.residentNo && <b className="num ml-1 text-ink">{shown.residentNo}</b>}{can('labor:approve') && !shown.residentNo && <button type="button" className="ml-1 text-steel-ink underline" onClick={() => setReveal('residentNo')}>원문 보기</button>}</> : '근로내용확인신고 등에 필요할 때만'}>
          <Input value={f.residentNo} onChange={(e) => setF({ ...f, residentNo: e.target.value.replace(/[^0-9-]/g, '').slice(0, 14) })} placeholder={w?.residentNoMask ? '바꿀 때만 입력' : '000000-0000000'} autoComplete="off" className="num" />
        </Field>
        <Field label="은행"><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
        <Field label="계좌번호" hint={w?.bankAccountMask ? <>저장됨 {w.bankAccountMask}{shown.bankAccount && <b className="num ml-1 text-ink">{shown.bankAccount}</b>}{can('labor:approve') && !shown.bankAccount && <button type="button" className="ml-1 text-steel-ink underline" onClick={() => setReveal('bankAccount')}>원문 보기</button>}</> : undefined}>
          <Input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} placeholder={w?.bankAccountMask ? '바꿀 때만 입력' : ''} autoComplete="off" className="num" />
        </Field>
        <Field label="메모" className="sm:col-span-2"><Textarea rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
        {w && <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="투입 중 (해제하면 작업일보 목록에서 숨김)" />}
      </div>
      <ReasonDialog open={!!reveal} title="원문을 볼까요?" confirm="보기" label="열람 사유" body="민감한 개인정보입니다. 열람 기록과 사유가 감사로그에 남습니다." onClose={() => setReveal(null)}
        onConfirm={async (reason) => {
          try {
            const r = await api<{ value: string }>(`/labor/workers/${w!.id}/reveal`, { method: 'POST', json: { field: reveal, reason } });
            setShown({ ...shown, [reveal!]: r.value });
            setReveal(null);
          } catch (e) {
            toast('error', e instanceof ApiError ? e.body.message : '볼 수 없습니다');
          }
        }} />
    </Drawer>
  );
}

function DailyEntry({ workers, defaultProject, onSaved }: { workers: Worker[]; defaultProject: string | null; onSaved: () => void }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState<string | null>(defaultProject);
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<{ workerId: string; manDays: string; overtimeHours: string; dailyWage: string; workType: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const active = workers.filter((w) => w.isActive);
  const add = (id: string) => {
    const w = workers.find((x) => x.id === id);
    if (!w || rows.some((r) => r.workerId === id)) return;
    setRows([...rows, { workerId: id, manDays: '1', overtimeHours: '0', dailyWage: w.dailyWage.split('.')[0], workType: '' }]);
  };
  const total = rows.reduce((a, r) => a + calc(Number(r.dailyWage), Number(r.manDays), Number(r.overtimeHours)), 0);
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ count: number }>('/labor/records', { method: 'POST', json: { projectId, workDate: date, entries: rows.map((x) => ({ workerId: x.workerId, manDays: x.manDays, overtimeHours: x.overtimeHours || '0', dailyWage: x.dailyWage, workType: x.workType || null })) } });
      toast('ok', `${r.count}명의 작업을 기록했습니다`);
      setRows([]);
      onSaved();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-[6px] border border-line bg-surface">
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_160px_1fr]">
        <Field label="현장" required><ProjectPicker value={projectId} onChange={setProjectId} /></Field>
        <Field label="작업일" required><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="작업자 추가">
          <Select value="" onChange={(e) => add(e.target.value)}>
            <option value="">이름 선택…</option>
            {active.filter((w) => !rows.some((r) => r.workerId === w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}{w.trade ? ` (${w.trade})` : ''} · {won(w.dailyWage)}원</option>)}
          </Select>
        </Field>
      </div>
      {!rows.length ? <p className="px-4 py-6 text-center text-meta text-muted">오늘 투입된 작업자를 위에서 골라 넣으세요. 공수 1.0 = 하루, 0.5 = 반나절.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-1.5 text-left font-medium">작업자</th><th className="w-[160px] px-2 py-1.5 text-left font-medium">작업 내용</th><th className="w-[80px] px-2 py-1.5 text-right font-medium">공수</th><th className="w-[80px] px-2 py-1.5 text-right font-medium">연장(h)</th><th className="w-[130px] px-2 py-1.5 text-right font-medium">일당</th><th className="w-[120px] px-3 py-1.5 text-right font-medium">노무비</th><th className="w-9" /></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const w = workers.find((x) => x.id === r.workerId)!;
                const set = (p: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <tr key={r.workerId}>
                    <td className="px-3 py-1.5 font-medium">{w.name}<span className="ml-1 text-meta font-normal text-muted">{w.trade}</span></td>
                    <td className="px-2 py-1"><Input value={r.workType} onChange={(e) => set({ workType: e.target.value })} placeholder="배관·입선" aria-label="작업 내용" /></td>
                    <td className="px-2 py-1"><Input value={r.manDays} onChange={(e) => set({ manDays: e.target.value.replace(/[^0-9.]/g, '') })} className="num text-right" inputMode="decimal" aria-label="공수" /></td>
                    <td className="px-2 py-1"><Input value={r.overtimeHours} onChange={(e) => set({ overtimeHours: e.target.value.replace(/[^0-9.]/g, '') })} className="num text-right" inputMode="decimal" aria-label="연장시간" /></td>
                    <td className="px-2 py-1"><MoneyInput value={r.dailyWage} onChange={(v) => set({ dailyWage: v })} aria-label="일당" /></td>
                    <td className="num px-3 py-1.5 text-right">{won(String(calc(Number(r.dailyWage), Number(r.manDays), Number(r.overtimeHours))))}</td>
                    <td className="px-1"><IconButton label="빼기" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconButton></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
            <span className="text-meta text-muted">{rows.length}명 · 연장은 일당÷8×시간×1.5 (세전, 원 미만 버림)</span>
            <div className="flex items-center gap-3"><span className="num font-semibold">{won(String(total))}원</span><Button variant="primary" loading={busy} disabled={!projectId} onClick={save}>작업일보 저장</Button></div>
          </div>
        </div>
      )}
    </section>
  );
}

function Inner() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const [tab, setTab] = useState<'entry' | 'records' | 'workers' | 'summary'>('entry');
  const [projectId, setProjectId] = useState<string | null>(sp.get('projectId'));
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Worker | null | 'new'>(null);
  const [dlg, setDlg] = useState<null | { kind: 'cancel' | 'unconfirm'; id: string }>(null);
  const { run, acting } = useRun(['labor-records']);
  const workers = useQuery({ queryKey: ['labor-workers', company.id], queryFn: () => api<Worker[]>('/labor/workers?all=1') });
  const recs = useQuery({ queryKey: ['labor-records', company.id, projectId, range, status], queryFn: () => api<{ rows: Rec[]; sums: { total: string; recorded: string; confirmed: string; paid: string; manDays: string } }>(`/labor/records${qs({ projectId, ...range, status: status || undefined })}`), enabled: tab === 'records' });
  const sum = useQuery({ queryKey: ['labor-summary', company.id, range], queryFn: () => api<{ from: string; to: string; byProject: Record<string, string>[]; byWorker: Record<string, string>[] }>(`/labor/summary${qs(range)}`), enabled: tab === 'summary' });
  useEffect(() => setSel(new Set()), [tab, projectId, range, status]);
  const recorded = useMemo(() => (recs.data?.rows ?? []).filter((r) => r.status === 'RECORDED'), [recs.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['labor-records'] });

  return (
    <>
      <PageHeader title="작업일보·노무비" description="현장별로 투입된 작업자와 공수를 기록하고, 확정하면 직접노무비로 원가에 반영합니다. 원천세·4대보험 공제는 지급결의에서 따로 처리합니다 (요율을 임의로 고정하지 않음)."
        actions={<>
          {can('labor:create') && <Button icon={<UserPlus className="size-3.5" />} onClick={() => setEdit('new')}>작업자 등록</Button>}
          {can('expense:create') && <Link href={`/payment-requests/new?kind=LABOR${projectId ? `&projectId=${projectId}` : ''}`}><Button icon={<Wallet className="size-3.5" />}>노무비 지급결의</Button></Link>}
        </>} />
      <div className="mb-4">        <div className=""><SegTabs label="보기" value={tab} onChange={setTab} items={[{ value: 'entry', label: '작업일보 입력' }, { value: 'records', label: '기록·확정' }, { value: 'workers', label: '작업자' }, { value: 'summary', label: '노무비 집계' }]} /></div>
      </div>

      {tab === 'entry' && (workers.data ? (workers.data.length ? <DailyEntry workers={workers.data} defaultProject={projectId} onSaved={refresh} /> : <EmptyState title="등록된 작업자가 없습니다" description="먼저 작업자를 등록하세요. 이름·직종·일당만 있으면 됩니다." action={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEdit('new')}>작업자 등록</Button>} />) : <Skeleton className="h-40" />)}

      {tab === 'records' && (
        <>
          {recs.data && <SumStrip items={[{ label: '노무비 합계', value: recs.data.sums.total, hint: `${recs.data.rows.length}건 · ${recs.data.sums.manDays}공수`, strong: true }, { label: '미확정', value: recs.data.sums.recorded, tone: 'muted' }, { label: '확정 · 미지급', value: recs.data.sums.confirmed, tone: 'steel' }, { label: '지급 완료', value: recs.data.sums.paid, tone: 'ok' }]} />}
          <div className="rounded-[6px] border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
              <div className="w-full sm:w-[260px]"><ProjectPicker value={projectId} onChange={setProjectId} placeholder="모든 현장" /></div>
              <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-[138px]" aria-label="시작일" /><span className="text-faint">~</span>
              <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-[138px]" aria-label="종료일" />
              <SegTabs label="상태" value={status} onChange={setStatus} items={[{ value: '', label: '전체' }, { value: 'RECORDED', label: '미확정' }, { value: 'CONFIRMED', label: '확정' }]} />
              {can('labor:approve') && sel.size > 0 && <Button variant="primary" className="ml-auto" icon={<CheckCheck className="size-4" />} loading={acting === 'confirm'} onClick={() => run('confirm', () => api('/labor/records/confirm', { method: 'POST', json: { ids: [...sel] } }), `${sel.size}건을 확정했습니다`).then(() => setSel(new Set()))}>{sel.size}건 확정</Button>}
            </div>
            {!recs.data ? <Skeleton className="m-4 h-40" /> : !recs.data.rows.length ? <EmptyState title="이 기간에 노무 기록이 없습니다" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-surface-2 text-meta text-muted"><tr>
                    <th className="w-10 px-3 py-2">{can('labor:approve') && recorded.length > 0 && <Checkbox checked={sel.size === recorded.length} indeterminate={sel.size > 0 && sel.size < recorded.length} onChange={(v) => setSel(v ? new Set(recorded.map((r) => r.id)) : new Set())} />}</th>
                    <th className="px-2 py-2 text-left font-medium">작업일</th><th className="px-2 py-2 text-left font-medium">작업자</th><th className="px-2 py-2 text-left font-medium">현장 · 작업</th><th className="px-2 py-2 text-right font-medium">공수</th><th className="px-2 py-2 text-right font-medium">연장</th><th className="px-2 py-2 text-right font-medium">노무비</th><th className="px-3 py-2 text-left font-medium">상태</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {recs.data.rows.map((r) => (
                      <tr key={r.id} className={clsx(sel.has(r.id) && 'bg-steel-soft/40')}>
                        <td className="px-3">{r.status === 'RECORDED' && can('labor:approve') && <Checkbox checked={sel.has(r.id)} onChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} />}</td>
                        <td className="num px-2 py-2">{r.workDate}</td>
                        <td className="px-2 py-2 font-medium">{r.workerName} <span className="text-meta font-normal text-muted">{r.trade}</span></td>
                        <td className="px-2 py-2 text-ink-2">{r.projectName}{r.workType && <span className="text-meta text-muted"> · {r.workType}</span>}</td>
                        <td className="num px-2 py-2 text-right">{Number(r.manDays)}</td><td className="num px-2 py-2 text-right text-muted">{Number(r.overtimeHours) || ''}</td>
                        <td className="px-2 py-2 text-right"><Won value={r.amount} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {r.paid ? <Badge tone="ok">지급</Badge> : r.inRequest ? <Badge tone="warn">결의 중</Badge> : r.status === 'CONFIRMED' ? <Badge tone="steel">확정</Badge> : <Badge tone="outline">미확정</Badge>}
                            {r.status === 'RECORDED' && can('labor:update') && <button className="text-meta text-muted hover:text-seal" onClick={() => setDlg({ kind: 'cancel', id: r.id })}>삭제</button>}
                            {r.status === 'CONFIRMED' && !r.inRequest && !r.paid && can('labor:approve') && <button className="text-meta text-muted hover:text-ink" onClick={() => setDlg({ kind: 'unconfirm', id: r.id })}>확정 취소</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'workers' && (
        <div className="rounded-[6px] border border-line bg-surface">
          {!workers.data ? <Skeleton className="m-4 h-40" /> : !workers.data.length ? <EmptyState title="등록된 작업자가 없습니다" action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>작업자 등록</Button>} /> : (
            <ul className="divide-y divide-line">
              {workers.data.map((w) => (
                <li key={w.id}>
                  <button onClick={() => setEdit(w)} className={clsx('flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-hover', !w.isActive && 'text-muted')}>
                    <span className="num w-20 text-meta text-muted">{w.code}</span>
                    <span className="min-w-0 flex-1"><span className="font-medium">{w.name}</span> <span className="text-meta text-muted">{w.kind === 'DAILY' ? '일용' : '직원'}{w.trade ? ` · ${w.trade}` : ''}{!w.isActive ? ' · 투입 안 함' : ''}</span></span>
                    <span className="num text-meta text-muted">{w.residentNoMask ?? '주민번호 없음'}</span>
                    <span className="num text-meta text-muted">{w.bankName} {w.bankAccountMask}</span>
                    <span className="num w-28 text-right">{won(w.dailyWage)}원</span>
                    <Eye className="size-3.5 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-[138px]" aria-label="시작일" /><span className="text-faint">~</span>
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-[138px]" aria-label="종료일" />
            {can('labor:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/labor/summary.xlsx${qs(range)}`, '노무비집계.xlsx')}>노무비 집계표 엑셀</Button>}
          </div>
          {!sum.data ? <Skeleton className="h-40" /> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-[6px] border border-line bg-surface">
                <h2 className="border-b border-line px-4 py-2.5 font-semibold">현장별</h2>
                {!sum.data.byProject.length ? <p className="px-4 py-3 text-meta text-muted">기록 없음</p> : <ul className="divide-y divide-line">{sum.data.byProject.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2"><span><span className="font-medium">{p.name}</span> <span className="text-meta text-muted">{p.workers}명 · {Number(p.man_days)}공수{Number(p.recorded) ? ` · 미확정 ${won(p.recorded)}` : ''}</span></span><Won value={p.amount} className="font-medium" /></li>)}</ul>}
              </section>
              <section className="rounded-[6px] border border-line bg-surface">
                <h2 className="border-b border-line px-4 py-2.5 font-semibold">작업자별</h2>
                {!sum.data.byWorker.length ? <p className="px-4 py-3 text-meta text-muted">기록 없음</p> : <ul className="divide-y divide-line">{sum.data.byWorker.map((w) => <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2"><span><span className="font-medium">{w.name}</span> <span className="text-meta text-muted">{w.trade} · {w.days}일 · {Number(w.man_days)}공수{Number(w.overtime) ? ` · 연장 ${Number(w.overtime)}h` : ''}</span></span><Won value={w.amount} className="font-medium" /></li>)}</ul>}
              </section>
            </div>
          )}
        </>
      )}

      {edit && <WorkerDrawer w={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['labor-workers'] }); }} />}
      <ReasonDialog open={!!dlg} title={dlg?.kind === 'cancel' ? '이 기록을 지울까요?' : '확정을 취소할까요?'} danger confirm={dlg?.kind === 'cancel' ? '삭제' : '확정 취소'}
        body={dlg?.kind === 'cancel' ? '기록은 취소 상태로 남습니다.' : '같이 확정한 기록 전체를 되돌리고 노무비 분개를 역분개합니다.'} onClose={() => setDlg(null)}
        onConfirm={async (reason) => { if (dlg && await run('x', () => api(`/labor/records/${dlg.id}/${dlg.kind === 'cancel' ? 'cancel' : 'unconfirm'}`, { method: 'POST', json: { reason } }), '처리했습니다')) setDlg(null); }} />
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
