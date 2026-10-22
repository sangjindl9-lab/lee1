'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Link2, Sparkles, Upload } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { SegTabs } from '@/components/doc-ui';
import { AccountPicker, BankSelect, ProjectPicker } from '@/components/pickers';
import { Badge, Button, Dialog, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Spinner, useToast, Won } from '@/components/ui';
import { api, ApiError, qs, upload } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Tx {
  id: string; bankAccountId: string; accountName: string; txDate: string; txTime: string | null; direction: 'IN' | 'OUT'; amount: string; balance: string | null;
  description: string | null; counterparty: string | null; memo: string | null; status: 'UNMATCHED' | 'MATCHED' | 'IGNORED'; matchedType: string | null; ignoreReason: string | null;
  link: { label: string; href: string } | null;
}
interface ListResp { total: number; unmatched: number; sums: { in: string; out: string }; rows: Tx[] }
interface Acc { id: string; name: string; kind: string; bank_name: string | null; account_no_mask: string | null; statement_balance: string | null; last_tx: string | null; unmatched: number; book_balance: string }
interface Cand { existing: Record<string, string>[]; create: Record<string, string>[] }
interface Preview { summary: { total: number; fresh: number; duplicate: number; in: string; out: string; from: string | null; to: string | null }; errors: { row: number; message: string }[]; rows: { txDate: string; txTime: string | null; direction: 'IN' | 'OUT'; amount: string; balance: string | null; description: string | null; counterparty: string | null; duplicate: boolean }[] }

const STATUS = { UNMATCHED: { label: '미처리', tone: 'warn' }, MATCHED: { label: '처리됨', tone: 'ok' }, IGNORED: { label: '제외', tone: 'outline' } } as const;
const errMsg = (e: unknown, f: string) => (e instanceof ApiError ? e.body.message : f);

function ImportDialog({ onClose, onDone, defaultAccount }: { onClose: () => void; onDone: () => void; defaultAccount: string | null }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [acc, setAcc] = useState<string | null>(defaultAccount);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const send = (f: File, dry: boolean) => {
    const fd = new FormData();
    fd.append('file', f);
    return upload<Preview & { inserted: number; duplicates: number; autoMatched: number }>(`/bank-transactions/import?bankAccountId=${acc}&dryRun=${dry}`, fd);
  };
  async function check(f: File) {
    if (!acc) return toast('error', '어느 계좌·카드의 내역인지 먼저 고르세요');
    setFile(f);
    setBusy(true);
    try {
      setPv(await send(f, true));
    } catch (e) {
      toast('error', errMsg(e, '파일을 읽지 못했습니다'));
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
      toast('ok', `새로 ${r.inserted}건 등록${r.duplicates ? ` · 이미 있는 ${r.duplicates}건 건너뜀` : ''}${r.autoMatched ? ` · ${r.autoMatched}건 자동 대사` : ''}`);
      onDone();
    } catch (e) {
      toast('error', errMsg(e, '저장하지 못했습니다'));
    } finally {
      setBusy(false);
    }
  }
  const s = pv?.summary;
  return (
    <Dialog open onClose={onClose} title="거래내역 올리기" width={720}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={busy && !!pv} disabled={!s || s.fresh === 0} onClick={commit}>{s ? `${s.fresh}건 등록` : '등록'}</Button></>}>
      <p className="mb-3 text-ink-2">인터넷뱅킹·카드사 홈페이지에서 거래내역을 엑셀(.xlsx) 또는 CSV로 내려받아 그대로 올리세요. 열 이름으로 거래일·입금·출금·잔액을 찾아 읽고, 이미 올린 거래는 다시 등록하지 않습니다.</p>
      <Field label="계좌·카드" required className="mb-3 max-w-sm"><BankSelect value={acc} onChange={(v) => (setAcc(v), setPv(null), setFile(null))} includeKinds={['BANK', 'CARD']} /></Field>
      <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), e.dataTransfer.files[0] && check(e.dataTransfer.files[0]))}
        className="flex w-full items-center gap-3 rounded-[4px] border border-dashed border-line-strong p-4 text-left hover:border-steel hover:bg-steel-soft/40">
        {busy && !pv ? <Spinner /> : <FileSpreadsheet className="size-6 text-faint" strokeWidth={1.5} />}
        <span>{file ? <><b>{file.name}</b> <span className="text-muted">· 다른 파일로 바꾸려면 누르세요</span></> : '엑셀·CSV 파일 선택 또는 끌어 놓기'}</span>
      </button>
      <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
      {s && pv && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
            <span>기간 <b className="num">{s.from} ~ {s.to}</b></span>
            <span>전체 <b className="num">{s.total}</b>건</span>
            <span className="text-ok">새로 <b className="num">{s.fresh}</b>건</span>
            <span className="text-muted">이미 있음 <b className="num">{s.duplicate}</b>건</span>
            <span>입금 <b className="num">{won(s.in)}</b> · 출금 <b className="num">{won(s.out)}</b></span>
          </p>
          {pv.errors.length > 0 && <ul className="max-h-24 overflow-auto rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{pv.errors.map((e) => <li key={e.row}>{e.row}행: {e.message}</li>)}</ul>}
          <div className="max-h-[260px] overflow-auto rounded-[4px] border border-line">
            <table className="w-full text-meta">
              <thead className="sticky top-0 bg-surface-2 text-muted"><tr><th className="px-2 py-1.5 text-left font-medium">거래일</th><th className="px-2 py-1.5 text-left font-medium">적요 · 상대</th><th className="px-2 py-1.5 text-right font-medium">입금</th><th className="px-2 py-1.5 text-right font-medium">출금</th><th className="px-2 py-1.5 text-right font-medium">잔액</th></tr></thead>
              <tbody className="divide-y divide-line">
                {pv.rows.map((r, i) => (
                  <tr key={i} className={clsx(r.duplicate && 'text-faint line-through decoration-faint')}>
                    <td className="num px-2 py-1">{r.txDate} {r.txTime?.slice(0, 5)}</td>
                    <td className="max-w-[220px] truncate px-2 py-1">{[r.description, r.counterparty].filter(Boolean).join(' · ')}</td>
                    <td className="num px-2 py-1 text-right text-ok">{r.direction === 'IN' ? won(r.amount) : ''}</td>
                    <td className="num px-2 py-1 text-right">{r.direction === 'OUT' ? won(r.amount) : ''}</td>
                    <td className="num px-2 py-1 text-right text-muted">{r.balance ? won(r.balance) : ''}</td>
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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-line">
      <header className="border-b border-line bg-surface-2 px-3 py-2"><h3 className="text-meta font-semibold text-ink-2">{title}</h3>{hint && <p className="text-meta text-muted">{hint}</p>}</header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function TxDrawer({ t, onClose, onDone }: { t: Tx; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const cand = useQuery({ queryKey: ['bank-cand', t.id], queryFn: () => api<Cand>(`/bank-transactions/${t.id}/candidates`), enabled: t.status === 'UNMATCHED' });
  const [busy, setBusy] = useState<string | null>(null);
  const [j, setJ] = useState<{ accountId: string | null; projectId: string | null; memo: string }>({ accountId: null, projectId: null, memo: '' });
  const [reason, setReason] = useState('');
  const out = t.direction === 'OUT';
  async function act(key: string, path: string, json: unknown, ok: string) {
    setBusy(key);
    try {
      await api(`/bank-transactions/${t.id}/${path}`, { method: 'POST', json });
      toast('ok', ok);
      onDone();
    } catch (e) {
      toast('error', errMsg(e, '처리하지 못했습니다'));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Drawer open onClose={onClose} width={600}
      title={<span className="flex items-center gap-2">{out ? <ArrowUpRight className="size-4 text-seal" /> : <ArrowDownLeft className="size-4 text-ok" />}<span className="num">{won(t.amount)}원</span> {out ? '출금' : '입금'}</span>}
      subtitle={`${t.accountName} · ${t.txDate} ${t.txTime?.slice(0, 5) ?? ''} · ${[t.description, t.counterparty].filter(Boolean).join(' · ') || '적요 없음'}`}>
      {t.status !== 'UNMATCHED' ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2"><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>{t.link ? <Link href={t.link.href} className="font-medium text-steel-ink hover:underline">{t.link.label}</Link> : t.ignoreReason && <span className="text-ink-2">사유: {t.ignoreReason}</span>}</p>
          {can('bank:update') && (
            <Section title="연결 해제" hint={t.matchedType === 'JOURNAL' ? '이 거래로 만든 전표는 역분개(무효)됩니다.' : '지급·수금 기록은 그대로 두고 통장 거래와의 연결만 끊습니다.'}>
              <div className="flex gap-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="해제 사유" /><Button variant="danger" disabled={reason.trim().length < 2} loading={busy === 'un'} onClick={() => act('un', 'unmatch', { reason }, '연결을 해제했습니다')}>해제</Button></div>
            </Section>
          )}
        </div>
      ) : !cand.data ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          <Section title={out ? '이미 지급 처리된 기록과 연결' : '이미 기록된 수금과 연결'} hint="금액이 같고 거래일 앞뒤 5일 안에 있는 기록입니다.">
            {!cand.data.existing.length ? <p className="text-meta text-muted">맞는 기록이 없습니다</p> : (
              <ul className="divide-y divide-line">
                {cand.data.existing.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1"><b className="num mr-1.5">{c.code}</b>{out ? `${c.payee_name} · ${c.title}` : `${c.project_name}`}<span className="ml-1 text-meta text-muted">{c.date}</span></span>
                    <Button size="sm" icon={<Link2 className="size-3.5" />} loading={busy === c.id} onClick={() => act(c.id, 'match', { type: c.type, targetId: c.id }, '연결했습니다')}>연결</Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {can('payment:create') && (
            <Section title={out ? '결재된 지급결의를 이 출금으로 지급 처리' : '기성 미수금을 이 입금으로 수금 기록'} hint={out ? '금액이 같은 결재 완료 지급결의입니다. 지급 처리 전표가 함께 만들어집니다.' : '이 입금액 이상 미수금이 남은 기성입니다. 수금 전표가 함께 만들어집니다.'}>
              {!cand.data.create.length ? <p className="text-meta text-muted">해당하는 {out ? '지급결의' : '기성'}가 없습니다</p> : (
                <ul className="divide-y divide-line">
                  {cand.data.create.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <b className="num mr-1.5">{c.code}</b>{out ? `${c.payee_name} · ${c.title}` : `${c.project_name} ${c.claim_no}회 · ${c.vendor_name}`}
                        <span className="ml-1 text-meta text-muted">{out ? `예정 ${c.date ?? '–'}` : `미수 ${won(c.outstanding)}원`}</span>
                      </span>
                      <Button size="sm" variant="primary" loading={busy === c.id} onClick={() => act(c.id, out ? 'pay' : 'collect', out ? { requestId: c.id } : { claimId: c.id }, out ? '지급 처리했습니다' : '수금을 기록했습니다')}>{out ? '지급 처리' : '수금 기록'}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {can('journal:create') && (
            <Section title="바로 전표 만들기" hint="수수료·이자·카드 사용처럼 지급결의·수금 기록이 없는 거래. 상대 계정만 고르면 통장 계정은 자동입니다.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="상대 계정" required className="sm:col-span-2"><AccountPicker value={j.accountId} onChange={(a) => setJ({ ...j, accountId: a?.id ?? null })} /></Field>
                <Field label="현장"><ProjectPicker value={j.projectId} onChange={(v) => setJ({ ...j, projectId: v })} placeholder="현장 없음" /></Field>
                <Field label="적요"><Input value={j.memo} onChange={(e) => setJ({ ...j, memo: e.target.value })} placeholder={t.description ?? ''} /></Field>
              </div>
              <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!j.accountId} loading={busy === 'j'} onClick={() => act('j', 'journal', { accountId: j.accountId, projectId: j.projectId, memo: j.memo || null }, '전표를 만들었습니다')}>전표 만들기</Button></div>
            </Section>
          )}
          {can('bank:update') && (
            <Section title="대사에서 제외" hint="계좌 간 이체, 결산 때 일괄 처리할 이자처럼 따로 맞출 필요가 없는 거래.">
              <div className="flex gap-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="제외 사유 (예: 운영계좌 → 급여계좌 이체)" /><Button disabled={reason.trim().length < 2} loading={busy === 'ig'} onClick={() => act('ig', 'ignore', { reason }, '제외했습니다')}>제외</Button></div>
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function Page() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, company } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [f, setF] = useState({ bankAccountId: '', status: 'UNMATCHED' as 'UNMATCHED' | 'MATCHED' | 'IGNORED' | '', direction: '', from: '', to: today });
  const [sel, setSel] = useState<Tx | null>(null);
  const [imp, setImp] = useState(false);
  const [auto, setAuto] = useState(false);
  const accs = useQuery({ queryKey: ['bank-tx-accounts', company.id], queryFn: () => api<Acc[]>('/bank-transactions/accounts') });
  const list = useQuery({ queryKey: ['bank-tx', company.id, f], queryFn: () => api<ListResp>(`/bank-transactions${qs({ ...f, size: 300 })}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bank-tx'] });
    qc.invalidateQueries({ queryKey: ['bank-tx-accounts'] });
  };
  useEffect(() => setSel(null), [company.id]);
  if (!can('bank:read')) return <EmptyState title="거래내역을 볼 권한이 없습니다" />;
  return (
    <>
      <PageHeader title="거래내역 대사" description="은행·카드 거래내역을 올려 ERP의 지급·수금·전표와 맞춥니다. 금액·날짜가 맞는 기록이 하나뿐이면 자동으로 연결되고, 나머지는 한 건씩 처리합니다."
        actions={<>
          {can('bank:update') && <Button icon={<Sparkles className="size-4" />} loading={auto} onClick={async () => { setAuto(true); try { const r = await api<{ matched: number }>('/bank-transactions/auto-match', { method: 'POST' }); toast('ok', r.matched ? `${r.matched}건을 자동으로 연결했습니다` : '자동으로 연결할 거래가 없습니다'); refresh(); } catch (e) { toast('error', errMsg(e, '자동 대사 실패')); } finally { setAuto(false); } }}>자동 대사</Button>}
          {can('bank:create') && <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setImp(true)}>거래내역 올리기</Button>}
        </>} />

      {!accs.data ? <Skeleton className="mb-4 h-20" /> : accs.data.length === 0 ? (
        <EmptyState title="등록된 계좌·카드가 없습니다" description="먼저 계좌·카드를 등록해야 거래내역을 올릴 수 있습니다." action={<Link href="/bank"><Button>계좌·카드 등록</Button></Link>} />
      ) : (
        <div className="mb-4 grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
          {accs.data.map((a) => {
            const diff = a.statement_balance !== null && a.kind !== 'CARD' ? Number(a.statement_balance) - Number(a.book_balance) : null;
            const on = f.bankAccountId === a.id;
            return (
              <button key={a.id} type="button" onClick={() => setF({ ...f, bankAccountId: on ? '' : a.id })} aria-pressed={on}
                className={clsx('rounded-[6px] border bg-surface px-3 py-2.5 text-left transition-colors', on ? 'border-steel ring-1 ring-steel' : 'border-line hover:border-line-strong')}>
                <span className="flex items-center justify-between gap-2"><b className="truncate">{a.name}</b>{a.unmatched > 0 ? <Badge tone="warn">미처리 {a.unmatched}</Badge> : <span className="text-meta text-faint">{a.last_tx ? `~${a.last_tx}` : '내역 없음'}</span>}</span>
                <span className="mt-1 grid grid-cols-2 gap-1 text-meta">
                  <span className="text-muted">통장 잔액<br /><span className="num text-ink">{a.statement_balance !== null ? won(a.statement_balance) : '–'}</span></span>
                  <span className="text-muted">장부 잔액<br /><span className="num text-ink">{won(a.book_balance)}</span></span>
                </span>
                {diff !== null && diff !== 0 && <span className="mt-1 block text-meta text-seal">차이 <span className="num">{won(String(diff))}</span>원 — 미처리 거래를 맞추면 줄어듭니다</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="처리 상태" value={f.status} onChange={(v) => setF({ ...f, status: v })} items={[{ value: 'UNMATCHED', label: `미처리${list.data && f.status === 'UNMATCHED' ? ` ${list.data.total}` : ''}` }, { value: 'MATCHED', label: '처리됨' }, { value: 'IGNORED', label: '제외' }, { value: '', label: '전체' }]} />
          <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className="w-[110px]" aria-label="입출금"><option value="">입·출금</option><option value="IN">입금만</option><option value="OUT">출금만</option></Select>
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="w-[138px]" aria-label="시작일" /><span className="text-faint">~</span>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="w-[138px]" aria-label="종료일" />
          {list.data && <span className="ml-auto text-meta text-muted">입금 <b className="num text-ok">{won(list.data.sums.in)}</b> · 출금 <b className="num text-ink">{won(list.data.sums.out)}</b></span>}
        </div>
        {!list.data ? <Skeleton className="m-4 h-48" /> : !list.data.rows.length ? (
          <EmptyState title={f.status === 'UNMATCHED' ? '처리할 거래가 없습니다' : '거래가 없습니다'} description={f.status === 'UNMATCHED' ? '새 거래내역을 올리면 여기에 미처리 거래가 나타납니다.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">거래일시</th><th className="px-3 py-2 text-left font-medium">계좌</th><th className="px-3 py-2 text-left font-medium">적요 · 상대</th><th className="px-3 py-2 text-right font-medium">입금</th><th className="px-3 py-2 text-right font-medium">출금</th><th className="px-3 py-2 text-right font-medium">잔액</th><th className="px-3 py-2 text-left font-medium">처리</th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.data.rows.map((t) => (
                  <tr key={t.id} onClick={() => setSel(t)} className="cursor-pointer hover:bg-surface-2/60">
                    <td className="num px-3 py-2 whitespace-nowrap">{t.txDate}<span className="ml-1 text-meta text-faint">{t.txTime?.slice(0, 5)}</span></td>
                    <td className="px-3 py-2 text-meta text-muted whitespace-nowrap">{t.accountName}</td>
                    <td className="max-w-[260px] px-3 py-2"><span className="block truncate">{t.description ?? '–'}</span>{t.counterparty && <span className="block truncate text-meta text-muted">{t.counterparty}</span>}</td>
                    <td className="px-3 py-2 text-right text-ok">{t.direction === 'IN' && <Won value={t.amount} />}</td>
                    <td className="px-3 py-2 text-right">{t.direction === 'OUT' && <Won value={t.amount} />}</td>
                    <td className="px-3 py-2 text-right text-meta text-muted"><Won value={t.balance} /></td>
                    <td className="max-w-[240px] px-3 py-2">{t.status === 'UNMATCHED' ? <Button size="sm">맞추기</Button> : <span className="flex items-center gap-1.5"><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge><span className="truncate text-meta text-muted">{t.link?.label ?? t.ignoreReason}</span></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sel && <TxDrawer key={sel.id} t={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); refresh(); }} />}
      {imp && <ImportDialog defaultAccount={f.bankAccountId || null} onClose={() => setImp(false)} onDone={() => { setImp(false); refresh(); }} />}
    </>
  );
}
