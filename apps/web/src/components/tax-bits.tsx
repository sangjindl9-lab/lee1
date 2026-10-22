'use client';

/**
 * 세금계산서 화면 부품 — 홈택스 엑셀 올리기, 홈택스(CODEF) 수집, 세금계산서 양식(종이 모양)
 * 종이 세금계산서처럼 공급자 보관용은 붉은 선, 공급받는자 보관용은 푸른 선으로 그린다.
 */
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CloudDownload, FileSpreadsheet, Smartphone, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Dialog, Field, Input, Select, Spinner, useToast } from './ui';
import { api, ApiError, upload } from '@/lib/api';
import { bizNo, won } from '@/lib/format';

export interface TiLine { id?: string; lineNo: number; itemDate: string | null; name: string | null; spec: string | null; qty: string | null; unitPrice: string | null; supplyAmount: string; vatAmount: string; remark: string | null }
export interface TiParty { bizNo: string | null; name: string | null; ceo: string | null; address: string | null; bizType: string | null; bizItem: string | null; email: string | null }
export interface TiPaperData {
  direction: 'SALES' | 'PURCHASE'; docKind: string; approvalNo: string | null; writeDate: string; purpose: string; supplyAmount: string; vatAmount: string; totalAmount: string; remark: string | null;
  supplier: TiParty; buyer: TiParty; lines: TiLine[]; watermark?: string | null;
}

type ImportResp = { dryRun: boolean; errors: { row: number; message: string }[]; rows?: { approvalNo: string | null; writeDate: string; counterpart: string; supplyAmount: string; vatAmount: string; duplicate: boolean }[]; summary?: { total: number; duplicate: number; error: number }; inserted?: number; duplicates?: number; foreign?: number };

export function ImportDialog({ open, direction, onClose, onDone }: { open: boolean; direction: 'SALES' | 'PURCHASE'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResp | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) (setFile(null), setPreview(null));
  }, [open]);
  const send = async (f: File, dry: boolean) => {
    const fd = new FormData();
    fd.append('file', f);
    return upload<ImportResp>(`/tax-invoices/import?direction=${direction}&dryRun=${dry}`, fd);
  };
  async function check(f: File) {
    setFile(f);
    setBusy(true);
    try {
      setPreview(await send(f, true));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '파일을 확인하지 못했습니다');
      setFile(null);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send(file, false);
      toast('ok', `새로 ${r.inserted}건 등록${r.duplicates ? `, 이미 있는 ${r.duplicates}건은 건너뜀` : ''}${r.foreign ? `, 다른 사업자 ${r.foreign}건 제외` : ''}`);
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  const s = preview?.summary;
  const fresh = s ? s.total - s.duplicate : 0;
  return (
    <Dialog open={open} onClose={onClose} title={`홈택스 엑셀로 ${direction === 'PURCHASE' ? '매입' : '매출'} 세금계산서 올리기`} width={660}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy && !!preview} disabled={!s || s.error > 0 || fresh === 0} onClick={commit}>{s ? `${fresh}건 등록` : '등록'}</Button></>}>
      <p className="mb-3 text-ink-2">홈택스 › 전자세금계산서 › 목록조회에서 <b>{direction === 'PURCHASE' ? '매입' : '매출'}</b> 목록을 엑셀로 내려받아 그대로 올리세요. 승인번호가 같은 계산서는 다시 등록되지 않습니다.</p>
      <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), e.dataTransfer.files[0] && check(e.dataTransfer.files[0]))}
        className="flex w-full items-center gap-3 rounded-[4px] border border-dashed border-line-strong p-4 text-left hover:border-steel hover:bg-steel-soft/40">
        {busy && !preview ? <Spinner /> : <FileSpreadsheet className="size-6 text-faint" strokeWidth={1.5} />}
        <span>{file ? <><b>{file.name}</b> <span className="text-muted">· 다른 파일로 바꾸려면 누르세요</span></> : '엑셀 파일(.xlsx) 선택 또는 끌어 놓기'}</span>
      </button>
      <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
      {s && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap gap-3 text-meta">
            <span>전체 <b className="num">{s.total}</b>건</span>
            <span className="text-ok">새로 등록 <b className="num">{fresh}</b>건</span>
            <span className="text-muted">이미 있음 <b className="num">{s.duplicate}</b>건</span>
            {s.error > 0 && <span className="text-seal">오류 <b className="num">{s.error}</b>건</span>}
          </p>
          {preview!.errors.length > 0 && <ul className="max-h-28 overflow-auto rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{preview!.errors.map((e) => <li key={e.row}>{e.row}행: {e.message}</li>)}</ul>}
          <div className="max-h-[260px] overflow-auto rounded-[4px] border border-line">
            <table className="w-full text-meta">
              <thead className="sticky top-0 bg-surface-2 text-muted"><tr><th className="px-2 py-1.5 text-left font-medium">작성일</th><th className="px-2 py-1.5 text-left font-medium">거래처</th><th className="px-2 py-1.5 text-right font-medium">공급가액</th><th className="px-2 py-1.5 text-right font-medium">세액</th><th className="px-2 py-1.5" /></tr></thead>
              <tbody className="divide-y divide-line">
                {preview!.rows!.map((r, i) => (
                  <tr key={i} className={clsx(r.duplicate && 'text-faint')}>
                    <td className="num px-2 py-1">{r.writeDate}</td><td className="truncate px-2 py-1">{r.counterpart}</td>
                    <td className="num px-2 py-1 text-right">{won(r.supplyAmount)}</td><td className="num px-2 py-1 text-right">{won(r.vatAmount)}</td>
                    <td className="px-2 py-1 text-right">{r.duplicate ? <Badge tone="muted">이미 있음</Badge> : <Badge tone="ok">새로</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface Job { id: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'WAITING_AUTH'; attempts: number; errorMessage: string | null; result: { kind?: string; method?: string; message?: string; inserted?: number; duplicates?: number; fetched?: number; foreign?: number } | null; authExpiresAt: string | null }

export function CollectDialog({ open, direction, onClose, onDone }: { open: boolean; direction: 'SALES' | 'PURCHASE'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const [f, setF] = useState({ from: monthStart, to: today, userName: '', loginIdentity: '', phoneNo: '', telecom: '' });
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['integrations-status'], queryFn: () => api<Record<string, { provider: string; mode: string; enabled: boolean; label: string } | null>>('/integrations/status'), enabled: open });
  const cfg = status.data?.HOMETAX;
  const job = useQuery({
    queryKey: ['collect-job', jobId], enabled: !!jobId, queryFn: () => api<Job>(`/tax-invoices/collect/${jobId}`),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'RUNNING' ? false : 1500),
  });
  const j = job.data;
  useEffect(() => {
    if (!open) (setJobId(null), setBusy(false));
  }, [open]);
  useEffect(() => {
    if (j?.status === 'SUCCESS') {
      qc.invalidateQueries({ queryKey: ['tax-invoices'] });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j?.status]);
  const simple = cfg?.provider === 'CODEF' && true;
  async function start() {
    setBusy(true);
    try {
      const login = f.userName ? { userName: f.userName, loginIdentity: f.loginIdentity, phoneNo: f.phoneNo, telecom: f.telecom } : undefined;
      const r = await api<{ jobId: string }>('/tax-invoices/collect', { method: 'POST', json: { direction, from: f.from, to: f.to, login } });
      setJobId(r.jobId);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '수집을 시작하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  async function cont() {
    setBusy(true);
    try {
      await api(`/tax-invoices/collect/${jobId}/continue`, { method: 'POST', json: { answer: { simpleAuth: '1' } } });
      await job.refetch();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '이어서 진행하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={`홈택스에서 ${direction === 'PURCHASE' ? '매입' : '매출'} 세금계산서 가져오기`} width={520}
      footer={!jobId ? <><Button onClick={onClose}>닫기</Button><Button variant="primary" icon={<CloudDownload className="size-4" />} loading={busy} disabled={!cfg?.enabled} onClick={start}>가져오기</Button></>
        : j?.status === 'WAITING_AUTH' ? <><Button onClick={onClose}>나중에</Button><Button variant="primary" icon={<Smartphone className="size-4" />} loading={busy} onClick={cont}>휴대폰 인증 완료</Button></>
        : <Button onClick={onClose}>{j?.status === 'RUNNING' ? '창 닫기 (계속 진행)' : '닫기'}</Button>}>
      {!cfg?.enabled ? (
        <div className="rounded-[4px] bg-warn-soft px-3 py-2.5 text-ink-2">
          <p className="font-medium">홈택스 수집 연동이 설정되지 않았습니다</p>
          <p className="mt-0.5 text-meta">관리 › 외부 연동에서 CODEF 키를 넣으면 버튼 한 번으로 가져올 수 있습니다. 키가 없으면 홈택스에서 엑셀을 내려받아 &lsquo;엑셀 올리기&rsquo;를 쓰세요.</p>
        </div>
      ) : !jobId ? (
        <div className="space-y-3">
          <p className="text-meta text-muted">{cfg.label} · {cfg.mode === 'LIVE' ? '운영' : '테스트(데모 서버)'} · 이미 있는 계산서는 건너뜁니다.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="작성일 시작" required><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="작성일 끝" required><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          {simple && (
            <details className="rounded-[4px] border border-line px-3 py-2">
              <summary className="cursor-pointer text-meta text-ink-2">간편인증으로 로그인할 때 (설정의 로그인 방식이 간편인증인 경우)</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="대표자 이름"><Input value={f.userName} onChange={(e) => setF({ ...f, userName: e.target.value })} autoComplete="off" /></Field>
                <Field label="생년월일 (8자리)"><Input value={f.loginIdentity} onChange={(e) => setF({ ...f, loginIdentity: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" autoComplete="off" /></Field>
                <Field label="휴대폰 번호"><Input value={f.phoneNo} onChange={(e) => setF({ ...f, phoneNo: e.target.value.replace(/\D/g, '').slice(0, 11) })} inputMode="numeric" autoComplete="off" /></Field>
                <Field label="통신사"><Select value={f.telecom} onChange={(e) => setF({ ...f, telecom: e.target.value })}><option value="">선택 안 함</option><option value="0">SKT</option><option value="1">KT</option><option value="2">LG U+</option></Select></Field>
              </div>
              <p className="mt-1 text-meta text-faint">이 값은 저장하지 않고 이번 수집에만 씁니다.</p>
            </details>
          )}
        </div>
      ) : (
        <div className="space-y-3" aria-live="polite">
          {(!j || j.status === 'RUNNING') && <p className="flex items-center gap-2"><Spinner />홈택스에서 가져오는 중입니다{j && j.attempts > 1 ? ` (재시도 ${j.attempts - 1}회)` : ''}… 기간이 길면 몇 분 걸릴 수 있습니다.</p>}
          {j?.status === 'WAITING_AUTH' && (
            <div className="rounded-[4px] border border-steel bg-steel-soft/50 px-3 py-3">
              <p className="flex items-center gap-2 font-medium"><Smartphone className="size-4" />휴대폰에서 인증을 완료해 주세요</p>
              <p className="mt-1 text-meta text-ink-2">{j.result?.message ?? '간편인증 앱(카카오·PASS 등)에 온 요청을 승인한 뒤 아래 버튼을 누르세요.'}</p>
              {j.authExpiresAt && <p className="num mt-1 text-meta text-muted">{new Date(j.authExpiresAt).toLocaleTimeString('ko-KR')}까지</p>}
            </div>
          )}
          {j?.status === 'SUCCESS' && (
            <p className="flex items-start gap-2 text-ok"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>가져오기 완료 — 조회 {j.result?.fetched ?? 0}건 중 새로 {j.result?.inserted ?? 0}건 등록{j.result?.duplicates ? `, 이미 있는 ${j.result.duplicates}건 건너뜀` : ''}</span></p>
          )}
          {j?.status === 'FAILED' && (
            <p className="flex items-start gap-2 text-seal"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>가져오지 못했습니다: {j.errorMessage}{j.attempts > 1 ? ` (${j.attempts}회 시도)` : ''}</span></p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** 세금계산서 양식 — 국세청 표준 서식의 칸 배치를 따른다 */
export function TaxInvoicePaper({ d }: { d: TiPaperData }) {
  const red = d.direction === 'SALES';
  const c = red ? '#c42b1c' : '#1f4e9c';
  const title = d.docKind === 'EXEMPT' ? '계산서' : '세금계산서';
  const party = (label: string, p: TiParty) => (
    <table className="w-full border-collapse" style={{ borderColor: c }}>
      <tbody>
        <tr>
          <th rowSpan={4} className="w-6 border px-0.5 text-[11px] leading-tight font-medium [writing-mode:vertical-rl]" style={{ borderColor: c, color: c }}>{label}</th>
          <th className="w-[62px] border px-1 py-0.5 text-left text-[10.5px] font-normal" style={{ borderColor: c, color: c }}>등록번호</th>
          <td colSpan={3} className="num border px-1.5 py-0.5 text-[13px] font-semibold tracking-wide" style={{ borderColor: c }}>{bizNo(p.bizNo) || '–'}</td>
        </tr>
        <tr>
          <th className="border px-1 py-0.5 text-left text-[10.5px] font-normal" style={{ borderColor: c, color: c }}>상호</th>
          <td className="border px-1.5 py-0.5" style={{ borderColor: c }}>{p.name}</td>
          <th className="w-[38px] border px-1 py-0.5 text-[10.5px] font-normal" style={{ borderColor: c, color: c }}>성명</th>
          <td className="w-[70px] border px-1.5 py-0.5" style={{ borderColor: c }}>{p.ceo}</td>
        </tr>
        <tr>
          <th className="border px-1 py-0.5 text-left text-[10.5px] font-normal" style={{ borderColor: c, color: c }}>사업장</th>
          <td colSpan={3} className="border px-1.5 py-0.5 text-[11px]" style={{ borderColor: c }}>{p.address}</td>
        </tr>
        <tr>
          <th className="border px-1 py-0.5 text-left text-[10.5px] font-normal" style={{ borderColor: c, color: c }}>업태·종목</th>
          <td colSpan={3} className="border px-1.5 py-0.5 text-[11px]" style={{ borderColor: c }}>{[p.bizType, p.bizItem].filter(Boolean).join(' / ')}</td>
        </tr>
      </tbody>
    </table>
  );
  const [y, m, dd] = d.writeDate.split('-');
  return (
    <div className="relative overflow-hidden rounded-[2px] bg-white p-4 text-[12px] leading-[1.45] text-[#17202b] shadow-[0_1px_2px_rgb(16_24_40/0.06),0_8px_24px_-12px_rgb(16_24_40/0.18)] ring-1 ring-black/5 sm:p-6 [color-scheme:light]">
      {d.watermark && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center"><span className="-rotate-[20deg] text-[34px] font-bold whitespace-nowrap select-none" style={{ color: `${c}22` }}>{d.watermark}</span></div>}
      <div className="border-2 p-2" style={{ borderColor: c }}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-2" style={{ borderColor: c }}>
          <h2 className="text-[20px] font-bold tracking-[0.3em]" style={{ color: c }}>전자{title}</h2>
          <p className="text-[11px]" style={{ color: c }}>({red ? '공급자 보관용' : '공급받는자 보관용'})</p>
          <p className="num text-[11px]">승인번호 <b className="text-[12px]">{d.approvalNo ?? '— (미발급)'}</b></p>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">{party('공급자', d.supplier)}{party('공급받는자', d.buyer)}</div>
        <table className="mt-2 w-full border-collapse">
          <thead><tr className="text-[10.5px]" style={{ color: c }}>{['작성일자', '공급가액', '세액', '수정사유'].map((h) => <th key={h} className="border px-1 py-0.5 font-normal" style={{ borderColor: c }}>{h}</th>)}</tr></thead>
          <tbody><tr>
            <td className="num border px-1.5 py-1 text-center" style={{ borderColor: c }}>{y}. {m}. {dd}.</td>
            <td className="num border px-1.5 py-1 text-right font-semibold" style={{ borderColor: c }}>{won(d.supplyAmount)}</td>
            <td className="num border px-1.5 py-1 text-right font-semibold" style={{ borderColor: c }}>{won(d.vatAmount)}</td>
            <td className="border px-1.5 py-1" style={{ borderColor: c }} />
          </tr></tbody>
        </table>
        {d.remark && <p className="mt-1 border px-1.5 py-0.5 text-[11px]" style={{ borderColor: c }}><span style={{ color: c }}>비고 </span>{d.remark}</p>}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[540px] border-collapse">
            <thead><tr className="text-[10.5px]" style={{ color: c }}>{['월', '일', '품목', '규격', '수량', '단가', '공급가액', '세액', '비고'].map((h) => <th key={h} className="border px-1 py-0.5 font-normal" style={{ borderColor: c }}>{h}</th>)}</tr></thead>
            <tbody>
              {(d.lines.length ? d.lines : [{ lineNo: 1, itemDate: d.writeDate, name: '(품목 없음)', spec: null, qty: null, unitPrice: null, supplyAmount: d.supplyAmount, vatAmount: d.vatAmount, remark: null }]).map((l) => (
                <tr key={l.lineNo}>
                  <td className="num w-7 border px-1 py-0.5 text-center" style={{ borderColor: `${c}88` }}>{l.itemDate?.slice(5, 7)}</td>
                  <td className="num w-7 border px-1 py-0.5 text-center" style={{ borderColor: `${c}88` }}>{l.itemDate?.slice(8, 10)}</td>
                  <td className="border px-1.5 py-0.5" style={{ borderColor: `${c}88` }}>{l.name}</td>
                  <td className="border px-1.5 py-0.5 text-[11px]" style={{ borderColor: `${c}88` }}>{l.spec}</td>
                  <td className="num border px-1.5 py-0.5 text-right" style={{ borderColor: `${c}88` }}>{l.qty ? Number(l.qty).toLocaleString('ko-KR') : ''}</td>
                  <td className="num border px-1.5 py-0.5 text-right" style={{ borderColor: `${c}88` }}>{l.unitPrice ? won(l.unitPrice) : ''}</td>
                  <td className="num border px-1.5 py-0.5 text-right" style={{ borderColor: `${c}88` }}>{won(l.supplyAmount)}</td>
                  <td className="num border px-1.5 py-0.5 text-right" style={{ borderColor: `${c}88` }}>{won(l.vatAmount)}</td>
                  <td className="border px-1.5 py-0.5 text-[11px]" style={{ borderColor: `${c}88` }}>{l.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border px-2 py-1.5" style={{ borderColor: c }}>
          <span className="text-[11px]" style={{ color: c }}>합계금액</span>
          <span className="num text-[16px] font-bold">₩{won(d.totalAmount)}</span>
          <span className="text-[11px]" style={{ color: c }}>이 금액을 {d.purpose === 'RECEIPT' ? '영수' : '청구'}함</span>
        </div>
      </div>
    </div>
  );
}
