'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { BookOpen, CheckCheck, Download, Plus, Search } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs, useRun } from '@/components/doc-ui';
import { Badge, Button, Checkbox, EmptyState, Input, PageHeader, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { JOURNAL_STATUS, SOURCE_LABEL } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; entryDate: string; description: string; status: string; sourceType: string; sourceLabel: string; sourceCode: string | null; totalDebit: string; debitAccounts: string; creditAccounts: string; projectNames: string; vendorNames: string; createdByName: string | null }
interface Resp { total: number; page: number; size: number; sums: { amount: string }; drafts: number; rows: Row[] }

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { can, company } = useSession();
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', sourceType: sp.get('sourceType') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const [q, setQ] = useState(f.q);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const set = (p: Partial<typeof f>) => {
    const n = { ...f, page: 1, ...p };
    setSel(new Set());
    router.replace(`/journals${qs({ ...n, page: n.page > 1 ? n.page : undefined })}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const params = { ...f, size: 100 };
  const list = useQuery({ queryKey: ['journals', company.id, params], queryFn: () => api<Resp>(`/journal-entries${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;
  const { run, acting } = useRun(['journals', 'closing']);
  const drafts = (d?.rows ?? []).filter((r) => r.status === 'DRAFT');
  const canApprove = can('journal:approve');

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    ...(canApprove ? [{
      id: 'sel', meta: { width: 36 },
      header: () => <Checkbox checked={!!drafts.length && drafts.every((r) => sel.has(r.id))} indeterminate={drafts.some((r) => sel.has(r.id)) && !drafts.every((r) => sel.has(r.id))} onChange={(v) => setSel(v ? new Set(drafts.map((r) => r.id)) : new Set())} label={<span className="sr-only">미승인 전체 선택</span>} />,
      cell: ({ row: { original: r } }: { row: { original: Row } }) => r.status === 'DRAFT' ? <span onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.has(r.id)} onChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })} label={<span className="sr-only">{r.code} 선택</span>} /></span> : null,
    } as ColumnDef<Row>] : []),
    { id: 'code', header: '전표번호', meta: { width: 112 }, cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
    { id: 'date', header: '일자', meta: { width: 96 }, cell: ({ row }) => <span className="num">{row.original.entryDate}</span> },
    { id: 'src', header: '구분', meta: { width: 84, hideBelow: 'md' }, cell: ({ row }) => <Badge tone={row.original.sourceType === 'MANUAL' ? 'outline' : 'steel'}>{row.original.sourceLabel}</Badge> },
    {
      id: 'desc', header: '적요 · 분개',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[240px]">
          <Link href={`/journals/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.description}</Link>
          <p className="mt-0.5 truncate text-meta text-muted"><span className="text-ink-2">(차) {r.debitAccounts}</span> / <span className="text-ink-2">(대) {r.creditAccounts}</span></p>
        </div>
      ),
    },
    { id: 'proj', header: '현장', meta: { hideBelow: 'xl' }, cell: ({ row }) => <span className="text-meta text-ink-2">{row.original.projectNames || '–'}</span> },
    { id: 'amt', header: '금액', meta: { align: 'right' }, cell: ({ row }) => <Won value={row.original.totalDebit} /> },
    { id: 'st', header: '상태', meta: { width: 80 }, cell: ({ row }) => <Badge tone={JOURNAL_STATUS[row.original.status].tone}>{JOURNAL_STATUS[row.original.status].label}</Badge> },
  ], [canApprove, drafts, sel]);

  const approveSel = () => run('approve', () => api<{ approved: number }>('/journal-entries/approve', { method: 'POST', json: { ids: [...sel] } }).then((r) => toast('ok', `${r.approved}건을 승인했습니다`))).then(() => setSel(new Set()));

  return (
    <>
      <PageHeader
        title="전표"
        description={<>검수·지급결의·지급 등에서 만든 자동분개와 직접 입력한 전표입니다. <b className="font-medium text-ink-2">승인된 전표만</b> 장부·재무제표에 들어갑니다.</>}
        actions={<>
          {can('journal:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/journal-entries/export.xlsx${qs(params)}`, '전표.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
          {can('journal:create') && <Link href="/journals/new"><Button variant="primary" icon={<Plus className="size-4" />}>전표 입력</Button></Link>}
        </>}
      />
      {!!d?.drafts && f.status !== 'DRAFT' && canApprove && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-warn/40 bg-warn-soft px-4 py-2.5">
          <span className="text-warn">승인을 기다리는 전표가 <b className="num">{d.drafts}</b>건 있습니다. 내용을 확인하고 승인하세요.</span>
          <Button size="sm" onClick={() => set({ status: 'DRAFT' })}>미승인 전표 보기</Button>
        </div>
      )}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="상태" value={f.status} onChange={(v) => set({ status: v })} items={[{ value: '', label: '전체' }, { value: 'DRAFT', label: '미승인' }, { value: 'APPROVED', label: '승인' }, { value: 'REVERSED', label: '역분개됨' }, { value: 'VOID', label: '무효' }]} />
          <select value={f.sourceType} onChange={(e) => set({ sourceType: e.target.value })} className="h-8 rounded-[4px] border border-line-strong bg-surface px-2 text-body" aria-label="구분">
            <option value="">모든 구분</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-[138px]" aria-label="시작일" />
            <span className="text-faint">~</span>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="w-[138px]" aria-label="종료일" />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="전표번호·적요·원천번호" className="pl-8" aria-label="검색" />
          </div>
          {sel.size > 0 && <Button variant="primary" icon={<CheckCheck className="size-4" />} loading={acting === 'approve'} onClick={approveSel}>선택 {sel.size}건 승인</Button>}
        </div>
        <DataTable
          columns={columns}
          data={d?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/journals/${r.id}`)}
          rowClassName={(r) => (r.status === 'VOID' ? 'text-muted line-through decoration-faint' : r.status === 'REVERSED' ? 'text-muted' : undefined)}
          page={d ? { page: f.page, size: 100, total: d.total, onPage: (p) => set({ page: p }) } : undefined}
          mobileRow={(r) => (
            <div>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.description}</span><Badge tone={JOURNAL_STATUS[r.status].tone}>{JOURNAL_STATUS[r.status].label}</Badge></div>
              <div className="mt-1 flex justify-between text-meta text-muted"><span className="num">{r.entryDate} · {r.sourceLabel}</span><Won value={r.totalDebit} className="text-ink-2" /></div>
            </div>
          )}
          empty={<EmptyState icon={<BookOpen className="size-8" strokeWidth={1.25} />} title="조건에 맞는 전표가 없습니다" description="검수·지급을 처리하면 전표가 자동으로 만들어집니다." />}
        />
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
