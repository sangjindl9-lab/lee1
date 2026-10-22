'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { FileScan, ScanLine, Search, Upload } from 'lucide-react';
import { Suspense, useMemo, useRef, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs } from '@/components/doc-ui';
import { ProjectPicker } from '@/components/pickers';
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select, Spinner, Won, useToast } from '@/components/ui';
import { api, ApiError, qs, upload } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { DOC_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: string; code: string; docType: string; docTypeLabel: string; status: string; fileName: string; mimeType: string; vendorName: string | null; projectName: string | null; confidence: string | null; lineCount: number; totalAmount: string | null; duplicateOfId: string | null; createdAt: string; registeredType: string | null }
interface Resp { total: number; open: number; rows: Row[] }

function Uploader({ onDone }: { onDone: (id: string) => void }) {
  const toast = useToast();
  const { can } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const types = useQuery({ queryKey: ['doc-types'], queryFn: () => api<{ value: string; label: string }[]>('/documents/types'), staleTime: Infinity });
  const status = useQuery({ queryKey: ['integrations-status'], queryFn: () => api<Record<string, { provider: string; label: string; enabled: boolean } | null>>('/integrations/status') });
  const [docType, setDocType] = useState('STATEMENT');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ocr = status.data?.OCR;
  async function send(f: File) {
    setBusy(f.name);
    try {
      const fd = new FormData();
      fd.append('docType', docType);
      if (projectId) fd.append('projectId', projectId);
      fd.append('file', f);
      const r = await upload<{ id: string; status: string; errorMessage: string | null }>('/documents', fd);
      if (r.status === 'FAILED') toast('error', `읽지 못했습니다 — ${r.errorMessage ?? ''} 직접 입력해서 등록할 수 있습니다`);
      else toast('ok', '읽었습니다. 내용을 확인해 주세요');
      onDone(r.id);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '올리지 못했습니다');
    } finally {
      setBusy(null);
    }
  }
  if (!can('document:create')) return null;
  return (
    <section className="mb-4 grid gap-4 rounded-[6px] border border-line bg-surface p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-3">
        <Field label="문서 종류" required><Select value={docType} onChange={(e) => setDocType(e.target.value)}>{(types.data ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <Field label="현장" hint="알면 고르세요. 나중에 정해도 됩니다"><ProjectPicker value={projectId} onChange={setProjectId} /></Field>
      </div>
      <div>
        <button type="button" disabled={!!busy} onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); }}
          className={clsx('flex h-full min-h-[148px] w-full flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed p-5 text-center transition-colors', drag ? 'border-steel bg-steel-soft/60' : 'border-line-strong hover:border-steel hover:bg-steel-soft/30')}>
          {busy ? <><Spinner /><span>{busy} 읽는 중…</span></> : (
            <>
              <ScanLine className="size-8 text-steel" strokeWidth={1.4} />
              <span className="font-medium">PDF나 사진을 끌어 놓거나 눌러서 고르세요</span>
              <span className="text-meta text-muted">거래명세표·납품서·발주서·종이 세금계산서·영수증 · 20MB까지</span>
            </>
          )}
        </button>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) send(f); }} />
        {ocr && <p className="mt-1.5 text-meta text-faint">인식: {ocr.label}{ocr.provider === 'BUILTIN_PDF' ? ' — 글자가 들어 있는 PDF만 읽습니다. 사진을 읽으려면 관리 › 외부 연동에서 AI 인식을 켜세요' : ''}</p>}
      </div>
    </section>
  );
}

const TABS = [{ value: 'OPEN', label: '확인할 문서' }, { value: '', label: '전체' }, { value: 'REGISTERED', label: '등록 완료' }, { value: 'REJECTED', label: '반려' }];

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { company } = useSession();
  const f = { status: sp.get('status') ?? 'OPEN', q: sp.get('q') ?? '' };
  const [q, setQ] = useState(f.q);
  const set = (p: Partial<typeof f>) => router.replace(`/scan${qs({ ...f, ...p, status: (p.status ?? f.status) === 'OPEN' ? undefined : p.status ?? f.status })}`, { scroll: false });
  const params = { status: f.status || undefined, q: f.q || undefined, size: 100 };
  const list = useQuery({ queryKey: ['documents', company.id, params], queryFn: () => api<Resp>(`/documents${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: 'code', header: '번호', meta: { width: 96 }, cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
    {
      id: 'file', header: '문서',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[200px]">
          <Link href={`/scan/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.fileName}</Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-meta text-muted"><Badge tone="muted">{r.docTypeLabel}</Badge>{r.vendorName ?? '거래처 미확인'}{r.projectName && ` · ${r.projectName}`}{r.duplicateOfId && <Badge tone="seal">중복 의심</Badge>}</p>
        </div>
      ),
    },
    { id: 'lines', header: '품목', meta: { width: 64, align: 'right', hideBelow: 'md' }, cell: ({ row }) => <span className="num text-ink-2">{row.original.lineCount || '–'}</span> },
    { id: 'conf', header: '인식률', meta: { width: 76, align: 'right', hideBelow: 'lg' }, cell: ({ row }) => row.original.confidence ? <span className={clsx('num', Number(row.original.confidence) < 0.7 ? 'text-warn' : 'text-ink-2')}>{Math.round(Number(row.original.confidence) * 100)}%</span> : <span className="text-faint">–</span> },
    { id: 'status', header: '상태', meta: { width: 92 }, cell: ({ row }) => <Badge tone={DOC_STATUS[row.original.status].tone}>{DOC_STATUS[row.original.status].label}</Badge> },
    { id: 'when', header: '올린 때', meta: { width: 130, hideBelow: 'xl' }, cell: ({ row }) => <span className="num text-meta text-muted">{dateTime(row.original.createdAt)}</span> },
    { id: 'total', header: '합계', meta: { align: 'right' }, cell: ({ row }) => row.original.totalAmount ? <Won value={row.original.totalAmount} /> : <span className="text-faint">–</span> },
  ], []);
  return (
    <>
      <PageHeader title="문서 스캔" description="종이·PDF 문서를 올리면 거래처·품목·금액을 읽어 초안을 만듭니다. 읽은 내용은 사람이 확인하고 고친 뒤에만 발주서·세금계산서·지급결의로 등록됩니다." />
      <Uploader onDone={(id) => { qc.invalidateQueries({ queryKey: ['documents'] }); router.push(`/scan/${id}`); }} />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="상태" value={f.status} onChange={(v) => set({ status: v })} items={TABS.map((t) => (t.value === 'OPEN' && d?.open ? { ...t, label: <>{t.label} <span className="num">{d.open}</span></> } : t))} />
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && set({ q })} placeholder="파일 이름·거래처 (Enter)" className="pl-8" aria-label="검색" />
          </div>
        </div>
        <DataTable columns={columns} data={d?.rows} loading={list.isLoading} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/scan/${r.id}`)} footerLabel={d ? `${d.total}건` : undefined}
          mobileRow={(r) => <div><div className="flex justify-between gap-2"><span className="truncate font-medium">{r.fileName}</span><Badge tone={DOC_STATUS[r.status].tone}>{DOC_STATUS[r.status].label}</Badge></div><p className="text-meta text-muted">{r.docTypeLabel} · {r.vendorName ?? '거래처 미확인'}</p></div>}
          empty={<EmptyState icon={<FileScan className="size-8" strokeWidth={1.25} />} title={f.status === 'OPEN' ? '확인할 문서가 없습니다' : '문서가 없습니다'} description="위에 PDF나 사진을 올리면 여기에 쌓입니다." action={<Button icon={<Upload className="size-3.5" />} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>문서 올리기</Button>} />} />
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
